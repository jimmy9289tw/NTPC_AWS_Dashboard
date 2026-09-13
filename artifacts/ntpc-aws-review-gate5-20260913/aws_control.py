"""Serialized AWS adapter for case transitions and publication.

Only this role writes effective-version pointers. SNS/report roles cannot approve.
"""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import PurePosixPath
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from review_core import Engine, ReviewError, encoded

SYSTEM = 'NTPC_Youth_System_V1_20260912/'
PIPES = {
    'MONTHLY': SYSTEM + '12_ETL與排程/runtime/',
    'ANNUAL': SYSTEM + '12_ETL與排程/runtime-annual/'}
REGION = os.environ.get('AWS_REGION', 'us-west-2')
CONF = Config(connect_timeout=5, read_timeout=45, retries={'max_attempts': 3})


def client(name):
    return boto3.client(name, region_name=REGION, config=CONF)


class Port:
    def __init__(self):
        self.bucket = os.environ['DATA_BUCKET']
        self.account = os.environ['DATA_ACCOUNT']
        self.prefix = os.environ['REVIEW_PREFIX']
        self.table = boto3.resource('dynamodb', region_name=REGION).Table(os.environ['CASE_TABLE'])
        self.s3 = client('s3')

    def now(self):
        return datetime.now(timezone.utc).isoformat()

    def log(self, event, case_id):
        print(json.dumps({'event': event, 'case_id': case_id}))

    def read(self, key):
        if key.startswith(self.prefix):
            found = self.s3.list_objects_v2(Bucket=self.bucket, Prefix=key, MaxKeys=1,
                                            ExpectedBucketOwner=self.account)
            if not any(x['Key'] == key for x in found.get('Contents', [])):
                return None, None
        try:
            r = self.s3.get_object(Bucket=self.bucket, Key=key, ExpectedBucketOwner=self.account)
        except ClientError as e:
            if e.response['Error']['Code'] in ('NoSuchKey', '404'):
                return None, None
            raise
        try:
            return r['Body'].read(), r['ETag']
        finally:
            r['Body'].close()

    def write_once(self, key, body):
        try:
            self.s3.put_object(Bucket=self.bucket, Key=key, Body=body,
                               ServerSideEncryption='AES256', ExpectedBucketOwner=self.account,
                               IfNoneMatch='*', ContentType='application/json; charset=utf-8')
        except ClientError as e:
            if e.response['Error']['Code'] != 'PreconditionFailed' or self.read(key)[0] != body:
                raise

    def current(self, pipeline):
        prefix = PIPES[pipeline]
        raw, etag = self.read(prefix + 'current/' + pipeline.lower() + '.json')
        return {'pointer': json.loads(raw) if raw else None, 'etag': etag}

    def case(self, case_id):
        item = self.table.get_item(Key={'pk': 'CASE#' + case_id}, ConsistentRead=True).get('Item')
        return json.loads(self.read(item['snapshot_key'])[0]) if item else None

    def active(self, pipeline):
        item = self.table.get_item(Key={'pk': 'PIPE#' + pipeline}, ConsistentRead=True).get('Item')
        if item and item.get('active_case'):
            return self.case(item['active_case'])
        return None

    def event_case(self, pipeline, event_id):
        key = 'EVENT#' + pipeline + '#' + hashlib.sha256(event_id.encode()).hexdigest()
        item = self.table.get_item(Key={'pk': key}, ConsistentRead=True).get('Item')
        return self.case(item['case_id']) if item else None

    def snapshot_key(self, case):
        suffix = hashlib.sha256(encoded(case)).hexdigest()[:20]
        return f"{self.prefix}cases/{case['case_id']}/revision-{case['revision']:06}-{suffix}.json"

    def save(self, case):
        from boto3.dynamodb.types import TypeSerializer
        ser = TypeSerializer()
        key = self.snapshot_key(case)
        self.write_once(key, encoded(case))
        item = {'pk': 'CASE#' + case['case_id'], 'case_id': case['case_id'],
                'pipeline': case['pipeline'], 'revision': case['revision'],
                'status': case['status'], 'updated_at': case['updated_at'],
                'snapshot_key': key, 'issue_count': len(case.get('issues', []))}
        active = case['case_id'] if case['status'] not in ('PUBLISHED', 'CLOSED_NO_CHANGE') else ''
        pipe = {'pk': 'PIPE#' + case['pipeline'], 'active_case': active,
                'updated_at': case['updated_at']}
        # Optimistic revision protects against stale actions even across retries.
        put = {'TableName': self.table.name, 'Item': {k: ser.serialize(v) for k, v in item.items()},
               'ConditionExpression': 'attribute_not_exists(pk)' if case['revision'] == 1 else 'revision = :old'}
        if case['revision'] > 1:
            put['ExpressionAttributeValues'] = {':old': {'N': str(case['revision'] - 1)}}
        writes = [{'Put': put}, {'Put': {
            'TableName': self.table.name, 'Item': {k: ser.serialize(v) for k, v in pipe.items()}}}]
        if case.get('event_ids'):
            event_key = 'EVENT#' + case['pipeline'] + '#' + hashlib.sha256(case['event_ids'][-1].encode()).hexdigest()
            writes.append({'Put': {'TableName': self.table.name, 'Item': {
                'pk': {'S': event_key}, 'case_id': {'S': case['case_id']}}}})
        client('dynamodb').transact_write_items(TransactItems=writes)

    def enqueue(self, case):
        # Do not send routine clean publications as anomaly mail.
        if not case.get('issues'):
            return
        key = self.snapshot_key(case)
        client('sqs').send_message(QueueUrl=os.environ['REPORT_QUEUE_URL'],
                                   MessageBody=json.dumps({'snapshot_key': key}))

    def verify_candidate(self, request):
        pipeline = request.get('pipeline')
        if pipeline not in PIPES:
            raise ReviewError('未知資料管線')
        prefix = PIPES[pipeline]
        key = request.get('manifest_key', '')
        path = PurePosixPath(key)
        if not key.startswith(prefix + 'releases/') or '..' in path.parts or '\\' in key:
            raise ReviewError('候選清冊路徑不屬於本管線')
        raw, _ = self.read(key)
        if not raw or hashlib.sha256(raw).hexdigest() != request.get('manifest_sha256'):
            raise ReviewError('候選清冊雜湊不符')
        manifest = json.loads(raw)
        files = manifest.get('files')
        if not isinstance(files, dict) or not files:
            raise ReviewError('清冊沒有完整資料檔案')
        bodies = {}
        for name, row in files.items():
            object_key = row.get('key', '')
            # Monthly manifests contain paths relative to monthly runtime.
            if pipeline == 'MONTHLY':
                object_key = prefix + object_key
            if not object_key.startswith(SYSTEM) or '..' in PurePosixPath(object_key).parts or '\\' in object_key:
                raise ReviewError('候選檔案不屬於本案')
            body, _ = self.read(object_key)
            if body is None or hashlib.sha256(body).hexdigest() != row.get('sha256'):
                raise ReviewError('候選檔案雜湊不符：' + name)
            if len(body) != row.get('bytes'):
                raise ReviewError('候選檔案大小不符：' + name)
            if name in ('monthly-population.json', 'checks/runtime-validation.json'):
                bodies[name] = json.loads(body)
        meta = manifest.get('metadata', {})
        if pipeline == 'MONTHLY':
            data = bodies.get('monthly-population.json', {})
            if data.get('qa', {}).get('status') != 'PASS' or not data.get('records'):
                raise ReviewError('缺月人口完整復驗通過證據')
            if manifest.get('component') != 'monthly':
                raise ReviewError('月人口清冊類型不符')
            pointer = request.get('pointer', {})
            expected_relative = key.removeprefix(prefix)
            if pointer.get('manifest_key') != expected_relative or pointer.get('release_id') != manifest.get('release_id'):
                raise ReviewError('月人口候選指標不符')
        else:
            qa = bodies.get('checks/runtime-validation.json', {})
            if meta.get('status') != 'PASS' or qa.get('status') != 'PASS':
                raise ReviewError('缺年度完整復驗通過證據')
            pointer = request.get('pointer', {})
            if pointer.get('manifest_key') != key or pointer.get('manifest_sha256') != request['manifest_sha256']:
                raise ReviewError('年度候選指標不符')
        run = request.get('run_id')
        if not isinstance(run, str) or not run:
            raise ReviewError('缺復驗執行編號')
        actual_run = meta.get('review_run_id') if pipeline == 'MONTHLY' else meta.get('run_id')
        if run != actual_run:
            raise ReviewError('復驗執行編號與清冊不符')
        if pipeline == 'ANNUAL' and pointer.get('run_id') != run:
            raise ReviewError('年度指標執行編號不符')
        allowed = {'manifest_key', 'manifest_sha256', 'release_id', 'run_id', 'published_at'}
        if set(pointer) - allowed:
            raise ReviewError('候選指標包含未允許欄位')
        return {'pipeline': pipeline, 'run_id': run, 'manifest_key': key,
                'manifest_sha256': request['manifest_sha256'], 'pointer': pointer,
                'baseline_etag': request.get('baseline_etag')}

    def publish(self, pipeline, pointer, etag):
        self.s3.put_object(Bucket=self.bucket,
                           Key=PIPES[pipeline] + 'current/' + pipeline.lower() + '.json',
                           Body=encoded(pointer), ExpectedBucketOwner=self.account,
                           ServerSideEncryption='AES256', ContentType='application/json',
                           **({'IfMatch': etag} if etag else {'IfNoneMatch': '*'}))


def anomaly(pipeline, event_id, actual, evidence='', rule='EXECUTION', severity='BLOCKER'):
    return {'pipeline': pipeline, 'event_id': event_id, 'issue': {
        'rule': rule, 'severity': severity, 'expected': '執行完成且完整資料查核通過',
        'actual': actual, 'evidence': evidence,
        'scope': '本次批次；若中途停止，尚未執行的檢查不視為通過'}}


def handler(event, context):
    p = Port()
    engine = Engine(p)
    action = event.get('action')
    if action == 'stage':
        return engine.stage(event)
    if action == 'anomaly':
        return engine.anomaly(event)
    if action == 'status':
        c = p.active(event['pipeline'])
        return {'active_case': c['case_id'] if c else None, 'status': c['status'] if c else 'CLEAR'}
    if action == 'decision':
        # Verify access-token possession at Cognito again. ETL invoke permission
        # does not let its caller fabricate a JWT-authorizer context or reviewer.
        user = client('cognito-idp').get_user(AccessToken=event.pop('access_token'))
        attrs = {x['Name']: x['Value'] for x in user['UserAttributes']}
        if attrs.get('sub') != os.environ['ADMIN_SUB']:
            raise ReviewError('不具本案管理者權限')
        return engine.decision(event, attrs['sub'] + '|' + user['Username'])
    if event.get('source') == 'aws.codebuild':
        d = event.get('detail', {})
        if d.get('project-name') != os.environ['ANNUAL_PROJECT'] or d.get('build-status') not in ('FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED'):
            raise ReviewError('非本案建置異常')
        return engine.anomaly(anomaly('ANNUAL', d['build-id'],
                                       'CodeBuild 狀態：' + d['build-status'], d['build-id']))
    if event.get('source') == 'aws.cloudwatch':
        d = event.get('detail', {})
        known = json.loads(os.environ.get('ALARM_PIPELINES', '{}'))
        name = d.get('alarmName', '')
        if name not in known or d.get('state', {}).get('value') != 'ALARM':
            raise ReviewError('非本案告警')
        return engine.anomaly(anomaly(known[name], event['id'],
                                       name + '：' + d['state'].get('reason', '需查核'), name))
    if action == 'reconcile':
        # Recover commits and unsent report jobs; never invent a successful check.
        items = []
        args = {}
        while True:
            page = p.table.scan(**args)
            items.extend(page.get('Items', []))
            if 'LastEvaluatedKey' not in page:
                break
            args['ExclusiveStartKey'] = page['LastEvaluatedKey']
        for item in items:
            if not item['pk'].startswith('CASE#'):
                continue
            case = p.case(item['case_id'])
            if case['status'] == 'PUBLISHING':
                try:
                    engine.resume(case)
                except ReviewError:
                    p.log('PUBLICATION_NEEDS_REVIEW', case['case_id'])
            receipt = f"{p.prefix}reports/{case['case_id']}/r{case['revision']}/delivery.json"
            if case.get('issues') and p.read(receipt)[0] is None:
                p.enqueue(case)
        return {'status': 'RECONCILED'}
    raise ReviewError('不支援的控制事件')
