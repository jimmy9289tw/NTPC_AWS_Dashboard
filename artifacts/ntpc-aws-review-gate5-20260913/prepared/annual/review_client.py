"""ETL-side adapter. Fail closed if review controller is unavailable."""
import hashlib
import json
import os
import time
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


class ReviewRequired(RuntimeError):
    pass


def control(payload):
    name = os.environ['REVIEW_CONTROL_FUNCTION']
    lam = boto3.client('lambda', region_name='us-west-2',
                       config=Config(connect_timeout=5, read_timeout=910, retries={'max_attempts': 0}))
    # Concurrency one intentionally serializes publishing and approvals. Retry a
    # busy controller; never fall back to directly writing current.
    for attempt in range(4):
        try:
            response = lam.invoke(FunctionName=name, Payload=json.dumps(payload).encode())
            result = json.loads(response['Payload'].read())
            if response.get('FunctionError'):
                raise RuntimeError('查核控制程序未完成：' + result.get('errorMessage', '未知錯誤'))
            return result
        except ClientError as e:
            if e.response['Error']['Code'] != 'TooManyRequestsException' or attempt == 3:
                raise
            time.sleep(2 ** attempt)


def annual_stage(s3, bucket, account, prefix, manifest_key, manifest_body, pointer, metadata, old_etag):
    result = control({'action': 'stage', 'pipeline': 'ANNUAL', 'run_id': metadata['run_id'],
                      'manifest_key': manifest_key, 'manifest_sha256': hashlib.sha256(manifest_body).hexdigest(),
                      'pointer': pointer, 'baseline_etag': old_etag})
    if result['status'] == 'REVIEW_REQUIRED':
        raise ReviewRequired(json.dumps(result, ensure_ascii=False))
    return result


def annual_failure(report):
    if report['status'] in ('PASS', 'REVIEW_REQUIRED'):
        return
    control({'action': 'anomaly', 'pipeline': 'ANNUAL', 'event_id': report['run_id'],
        'issue': {'rule': 'ANNUAL_EXECUTION', 'severity': 'BLOCKER',
                  'scope': '年度本次批次；中途未執行的檢查不視為通過',
                  'expected': '年度完整重建與資料查核通過',
                  'actual': report.get('error', '年度執行未完成'),
                  'evidence': os.environ['ANNUAL_PREFIX'] + 'runs/' + report['run_id'] + '.json'}})


def monthly_store(base):
    class ReviewStore(base):
        def review_pending(self):
            return bool(control({'action': 'status', 'pipeline': 'MONTHLY'})['active_case'])

        def put(self, key, data, expected=None, create=False):
            if key == 'current/monthly.json':
                pointer = json.loads(data)
                body = self.get(pointer['manifest_key'])[0]
                manifest = json.loads(body)
                result = control({'action': 'stage', 'pipeline': 'MONTHLY',
                    'run_id': manifest['metadata']['review_run_id'],
                    'manifest_key': self.prefix + pointer['manifest_key'],
                    'manifest_sha256': hashlib.sha256(body).hexdigest(),
                    'pointer': pointer, 'baseline_etag': expected})
                if result['status'] == 'REVIEW_REQUIRED':
                    raise ReviewRequired(json.dumps(result, ensure_ascii=False))
                return
            if key.endswith('.failure.json'):
                failure = json.loads(data)
                if failure.get('error_type') == 'ReviewRequired':
                    failure['status'] = 'REVIEW_REQUIRED'
                    return super().put(key, json.dumps(failure, ensure_ascii=False).encode(), expected, create)
                super().put(key, data, expected, create)
                control({'action': 'anomaly', 'pipeline': 'MONTHLY', 'event_id': failure['run_id'],
                    'issue': {'rule': failure.get('error_type', 'EXECUTION'), 'severity': 'BLOCKER',
                     'scope': '月人口本次批次；中途未執行檢查不視為通過',
                     'expected': '完整來源與資料驗證通過', 'actual': failure.get('message', '執行失敗'),
                     'evidence': self.prefix + key}})
                return
            return super().put(key, data, expected, create)
    return ReviewStore
