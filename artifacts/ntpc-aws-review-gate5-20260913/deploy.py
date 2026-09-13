"""Scoped deployment. Default writes a local plan only; --apply deploys.

No credential values are read into logs or receipts. Existing ETL/site resources
are read from AWS and preserved except for the reviewed integration patch.
"""
from pathlib import Path
import argparse
import base64
import copy
import hashlib
import io
import json
import time
import zipfile
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError
import prepare_integration

ROOT = Path(__file__).resolve().parent
S = json.loads((ROOT / 'settings.json').read_text(encoding='utf-8'))
REGION = S['region']; ACCOUNT = S['account']; NAME = S['name']; BUCKET = S['bucket']; PREFIX = S['prefix']
ARN = f'arn:aws:s3:::{BUCKET}/'
SYSTEM = 'NTPC_Youth_System_V1_20260912/'
MONTH = SYSTEM + '12_ETL與排程/runtime/'
ANNUAL = SYSTEM + '12_ETL與排程/runtime-annual/'
TAG = {'Project': 'NTPC-Youth-System', 'ManagedBy': 'Codex-Review-V1'}
CONF = Config(connect_timeout=7, read_timeout=45, retries={'max_attempts': 3})


def client(name):
    return boto3.client(name, region_name=REGION, config=CONF)


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding='utf-8')


def allow(actions, resources):
    return {'Effect': 'Allow', 'Action': actions, 'Resource': resources}


def list_review():
    return {**allow(['s3:ListBucket'], 'arn:aws:s3:::' + BUCKET),
            'Condition': {'StringLike': {'s3:prefix': [PREFIX + '*']}}}


def role(name, service, statements):
    iam = client('iam')
    try:
        old = iam.get_role(RoleName=name)['Role']
        if not all(old.get('Tags') and {'Key': k, 'Value': v} in old['Tags'] for k, v in TAG.items()):
            raise ValueError('同名角色不屬於本次查核模組')
    except iam.exceptions.NoSuchEntityException:
        old = iam.create_role(RoleName=name, AssumeRolePolicyDocument=json.dumps({'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Principal': {'Service': service}, 'Action': 'sts:AssumeRole'}]}), Tags=[{'Key': k, 'Value': v} for k, v in TAG.items()])['Role']
    iam.put_role_policy(RoleName=name, PolicyName='NTPCReviewOnly', PolicyDocument=json.dumps({'Version': '2012-10-17', 'Statement': statements}))
    return old['Arn']


def package(names, folder=ROOT):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in names:
            z.write(folder / name, name)
    return buf.getvalue()


def function(suffix, handler, files, env, statements, timeout=60, memory=512, concurrency=2):
    name = NAME + '-' + suffix
    log = '/aws/lambda/' + name
    logs = client('logs')
    try:
        logs.create_log_group(logGroupName=log, tags=TAG)
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    logs.put_retention_policy(logGroupName=log, retentionInDays=S['log_retention_days'])
    statements = statements + [allow(['logs:CreateLogStream', 'logs:PutLogEvents'], f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:{log}:*')]
    arn = role(name + '-role', 'lambda.amazonaws.com', statements)
    lam = client('lambda'); code = package(files)
    try:
        old = lam.get_function(FunctionName=name)
        if old.get('Tags', {}).get('ManagedBy') != TAG['ManagedBy']:
            raise ValueError('同名 Lambda 非本模組管理')
    except lam.exceptions.ResourceNotFoundException:
        old = None
    config = {'FunctionName': name, 'Role': arn, 'Runtime': 'python3.12',
              'Handler': handler, 'Timeout': timeout, 'MemorySize': memory,
              'Environment': {'Variables': env}}
    if old:
        if old['Configuration']['CodeSha256'] != base64.b64encode(hashlib.sha256(code).digest()).decode():
            lam.update_function_code(FunctionName=name, ZipFile=code, RevisionId=old['Configuration']['RevisionId'])
            lam.get_waiter('function_updated_v2').wait(FunctionName=name, WaiterConfig={'Delay': 2, 'MaxAttempts': 40})
        if any(old['Configuration'].get(k) != v for k, v in config.items() if k != 'FunctionName'):
            lam.update_function_configuration(**config)
            lam.get_waiter('function_updated_v2').wait(FunctionName=name, WaiterConfig={'Delay': 2, 'MaxAttempts': 40})
    else:
        for attempt in range(8):
            try:
                lam.create_function(**config, Code={'ZipFile': code}, Tags=TAG)
                break
            except lam.exceptions.InvalidParameterValueException as e:
                if 'assum' not in str(e).lower() or attempt == 7:
                    raise
                time.sleep(3)
        lam.get_waiter('function_active_v2').wait(FunctionName=name, WaiterConfig={'Delay': 2, 'MaxAttempts': 40})
    if concurrency is not None:
        lam.put_function_concurrency(FunctionName=name, ReservedConcurrentExecutions=concurrency)
    return f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{name}'


def add_permission(function_arn, statement, principal, source):
    lam = client('lambda')
    try:
        lam.add_permission(FunctionName=function_arn, StatementId=statement,
                           Action='lambda:InvokeFunction', Principal=principal,
                           SourceArn=source, SourceAccount=ACCOUNT)
    except lam.exceptions.ResourceConflictException:
        pass


def cognito():
    c = client('cognito-idp')
    pools = []
    args = {'MaxResults': 60}
    while True:
        page = c.list_user_pools(**args); pools += page['UserPools']
        if not page.get('NextToken'):
            break
        args['NextToken'] = page['NextToken']
    pool = next((p for p in pools if p['Name'] == NAME), None)
    if pool:
        pid = pool['Id']
        tags = c.describe_user_pool(UserPoolId=pid)['UserPool'].get('UserPoolTags', {})
        if tags != TAG:
            raise ValueError('同名身分池非本模組管理')
    else:
        pid = c.create_user_pool(PoolName=NAME, UsernameAttributes=['email'],
            AutoVerifiedAttributes=['email'], UsernameConfiguration={'CaseSensitive': False},
            AdminCreateUserConfig={'AllowAdminCreateUserOnly': True},
            Policies={'PasswordPolicy': {'MinimumLength': 12, 'RequireUppercase': True,
                      'RequireLowercase': True, 'RequireNumbers': True, 'RequireSymbols': True,
                      'TemporaryPasswordValidityDays': 7}},
            UserPoolTags=TAG)['UserPool']['Id']
    try:
        c.create_resource_server(UserPoolId=pid, Identifier='ntpc-review', Name='NTPC review',
                                 Scopes=[{'ScopeName': 'access', 'ScopeDescription': 'Named review administrator'}])
    except c.exceptions.InvalidParameterException:
        existing = c.describe_resource_server(UserPoolId=pid, Identifier='ntpc-review')['ResourceServer']
        if not any(s['ScopeName'] == 'access' for s in existing['Scopes']):
            raise
    domain = 'ntpc-youth-review-' + ACCOUNT
    d = c.describe_user_pool_domain(Domain=domain)['DomainDescription']
    if d:
        if d['UserPoolId'] != pid:
            raise ValueError('登入網域不屬於本案')
    else:
        c.create_user_pool_domain(Domain=domain, UserPoolId=pid)
    found = c.list_user_pool_clients(UserPoolId=pid, MaxResults=60)['UserPoolClients']
    app = next((x for x in found if x['ClientName'] == NAME), None)
    if not app:
        app = c.create_user_pool_client(UserPoolId=pid, ClientName=NAME, GenerateSecret=False,
            SupportedIdentityProviders=['COGNITO'], AllowedOAuthFlowsUserPoolClient=True,
            AllowedOAuthFlows=['code'], AllowedOAuthScopes=['openid', 'email', 'ntpc-review/access', 'aws.cognito.signin.user.admin'],
            CallbackURLs=[S['website'] + '/review/'], LogoutURLs=[S['website'] + '/review/'],
            PreventUserExistenceErrors='ENABLED', EnableTokenRevocation=True,
            AccessTokenValidity=1, IdTokenValidity=1, RefreshTokenValidity=1,
            TokenValidityUnits={'AccessToken': 'hours', 'IdToken': 'hours', 'RefreshToken': 'days'})['UserPoolClient']
    try:
        user = c.admin_get_user(UserPoolId=pid, Username=S['admin_email'])
        created = False
    except c.exceptions.UserNotFoundException:
        user = c.admin_create_user(UserPoolId=pid, Username=S['admin_email'],
            UserAttributes=[{'Name': 'email', 'Value': S['admin_email']}],
            MessageAction='SUPPRESS')['User']; created = True
    attrs = user.get('UserAttributes', user.get('Attributes', []))
    sub = next(x['Value'] for x in attrs if x['Name'] == 'sub')
    invitation_pending = user.get('UserStatus') == 'FORCE_CHANGE_PASSWORD' and not (ROOT / 'admin-invitation.json').exists()
    return {'pool_id': pid, 'client_id': app['ClientId'], 'admin_sub': sub,
            'invite_new_user': created or invitation_pending,
            'login_origin': f'https://{domain}.auth.{REGION}.amazoncognito.com'}


def event_rule(name, pattern, target):
    events = client('events')
    arn = events.put_rule(Name=name, EventPattern=json.dumps(pattern), State='ENABLED',
                           Tags=[{'Key': k, 'Value': v} for k, v in TAG.items()])['RuleArn']
    add_permission(target, name, 'events.amazonaws.com', arn)
    result = events.put_targets(Rule=name, Targets=[{'Id': 'review', 'Arn': target,
        'RetryPolicy': {'MaximumEventAgeInSeconds': 86400, 'MaximumRetryAttempts': 185}}])
    if result['FailedEntryCount']:
        raise ValueError('EventBridge 目標建立失敗')


def integrate_website(api_id, api_endpoint, env):
    api = client('apigatewayv2'); cf = client('cloudfront')
    issuer = f"https://cognito-idp.{REGION}.amazonaws.com/{env['POOL_ID']}"
    auths = api.get_authorizers(ApiId=api_id).get('Items', [])
    auth = next((x for x in auths if x['Name'] == NAME), None)
    if not auth:
        auth = api.create_authorizer(ApiId=api_id, Name=NAME, AuthorizerType='JWT',
            IdentitySource=['$request.header.Authorization'],
            JwtConfiguration={'Audience': [env['CLIENT_ID']], 'Issuer': issuer})
    integration = api.get_integrations(ApiId=api_id)['Items'][0]['IntegrationId']
    existing = {x['RouteKey']: x for x in api.get_routes(ApiId=api_id)['Items']}
    routes = ['GET /review', 'GET /review/app.js', 'GET /review/config',
              'GET /api/review/cases', 'GET /api/review/cases/{proxy+}', 'POST /api/review/decision']
    # Remove no existing routes, but make the quick-create default deny unless JWT
    # authenticated. Explicit public login assets are still origin/IP restricted.
    for route in routes + ['$default']:
        guarded = route.startswith(('GET /api/', 'POST /api/')) or route == '$default'
        args = {'ApiId': api_id, 'RouteKey': route, 'Target': 'integrations/' + integration,
                'AuthorizationType': 'JWT' if guarded else 'NONE'}
        if guarded:
            args.update(AuthorizerId=auth['AuthorizerId'], AuthorizationScopes=['ntpc-review/access'])
        if route in existing:
            api.update_route(RouteId=existing[route]['RouteId'], **args)
        else:
            api.create_route(**args)
    desc = cf.get_distribution_config(Id=S['distribution_id'])
    cfg = desc['DistributionConfig']; origin_id = NAME + '-api'
    fn_name = NAME + '-network'
    ips = env['ALLOW_IPS'].split(',')
    code = 'function handler(event){var r=event.request;var ip=event.viewer.ip;var ok=' + json.dumps(ips) + '.indexOf(ip)>=0;if(!ok){return {statusCode:403,statusDescription:"Forbidden",body:"此入口限指定網路位置。",headers:{"cache-control":{value:"no-store"},"content-type":{value:"text/plain; charset=utf-8"}}};}r.headers["x-ntpc-viewer-ip"]={value:ip};delete r.headers["x-ntpc-origin"];if(r.uri==="/review/"){r.uri="/review";}return r;}'
    try:
        old = cf.describe_function(Name=fn_name, Stage='DEVELOPMENT')
        fn = cf.update_function(Name=fn_name, IfMatch=old['ETag'], FunctionConfig={'Comment': NAME, 'Runtime': 'cloudfront-js-2.0'}, FunctionCode=code.encode())
    except cf.exceptions.NoSuchFunctionExists:
        fn = cf.create_function(Name=fn_name, FunctionConfig={'Comment': NAME, 'Runtime': 'cloudfront-js-2.0'}, FunctionCode=code.encode())
    fn_arn = cf.publish_function(Name=fn_name, IfMatch=fn['ETag'])['FunctionSummary']['FunctionMetadata']['FunctionARN']
    origins = cfg['Origins']['Items']
    new_origin = {'Id': origin_id, 'DomainName': api_endpoint.split('//')[1],
        'OriginPath': '', 'ConnectionAttempts': 3, 'ConnectionTimeout': 10,
        'OriginShield': {'Enabled': False}, 'OriginAccessControlId': '',
        'CustomHeaders': {'Quantity': 1, 'Items': [{'HeaderName': 'x-ntpc-origin', 'HeaderValue': env['ORIGIN_SECRET']}]},
        'CustomOriginConfig': {'HTTPPort': 80, 'HTTPSPort': 443, 'OriginProtocolPolicy': 'https-only',
                               'OriginSslProtocols': {'Quantity': 1, 'Items': ['TLSv1.2']},
                               'OriginReadTimeout': 30, 'OriginKeepaliveTimeout': 5}}
    origins = [o for o in origins if o['Id'] != origin_id] + [new_origin]
    cfg['Origins'] = {'Quantity': len(origins), 'Items': origins}
    items = [x for x in cfg.get('CacheBehaviors', {}).get('Items', []) if x['PathPattern'] not in ('review*', 'api/review*')]
    for pattern in ('review*', 'api/review*'):
        behavior = copy.deepcopy(cfg['DefaultCacheBehavior'])
        behavior.update(PathPattern=pattern, TargetOriginId=origin_id,
            FunctionAssociations={'Quantity': 1, 'Items': [{'FunctionARN': fn_arn, 'EventType': 'viewer-request'}]},
            CachePolicyId='4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
            OriginRequestPolicyId='b689b0a8-53d0-40ab-baf2-68738e2966ac')
        items.insert(0, behavior)
    cfg['CacheBehaviors'] = {'Quantity': len(items), 'Items': items}
    cf.update_distribution(Id=S['distribution_id'], IfMatch=desc['ETag'], DistributionConfig=cfg)


def integrate_etl(control_arn):
    lam = client('lambda'); cb = client('codebuild'); s3 = client('s3')
    # Refuse to patch over a changed local baseline.
    for path, sha in json.loads((ROOT / 'baseline-hashes.json').read_text(encoding='utf-8')).items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != sha:
            raise ValueError('本機 ETL 基準已變更，需重新建立補丁')
    monthly = lam.get_function_configuration(FunctionName=S['monthly_function'])
    annual = cb.batch_get_projects(names=[S['annual_project']])['projects'][0]
    running = cb.list_builds_for_project(projectName=S['annual_project'], sortOrder='DESCENDING').get('ids', [])[:10]
    if running and any(x['buildStatus'] == 'IN_PROGRESS' for x in cb.batch_get_builds(ids=running)['builds']):
        raise ValueError('年度建置正在執行；本次未更換 ETL，請完成後重跑部署')
    for role_arn, key in [(monthly['Role'], MONTH + 'current/monthly.json'), (annual['serviceRole'], ANNUAL + 'current/annual.json')]:
        client('iam').put_role_policy(RoleName=role_arn.rsplit('/', 1)[1], PolicyName='ReviewControllerInvoke',
            PolicyDocument=json.dumps({'Version': '2012-10-17', 'Statement': [allow(['lambda:InvokeFunction'], control_arn)]}))
    folder = ROOT / 'prepared' / 'monthly'
    data = package([p.relative_to(folder).as_posix() for p in folder.rglob('*.py')], folder)
    lam.update_function_code(FunctionName=S['monthly_function'], ZipFile=data, RevisionId=monthly['RevisionId'])
    lam.get_waiter('function_updated_v2').wait(FunctionName=S['monthly_function'], WaiterConfig={'Delay': 2, 'MaxAttempts': 40})
    menv = dict(monthly['Environment']['Variables']); menv['REVIEW_CONTROL_FUNCTION'] = control_arn
    lam.update_function_configuration(FunctionName=S['monthly_function'], Environment={'Variables': menv})
    lam.get_waiter('function_updated_v2').wait(FunctionName=S['monthly_function'], WaiterConfig={'Delay': 2, 'MaxAttempts': 40})
    aenv = copy.deepcopy(annual['environment'])
    variables = {x['name']: x for x in aenv['environmentVariables']}
    ref = s3.get_object(Bucket=BUCKET, Key=variables['BUNDLE_KEY']['value'], ExpectedBucketOwner=ACCOUNT)
    with ref['Body'] as stream:
        raw = stream.read()
    if hashlib.sha256(raw).hexdigest() != variables['BUNDLE_SHA256']['value']:
        raise ValueError('年度既有執行清冊雜湊不符')
    manifest = json.loads(raw); files = {x['target']: x for x in manifest['files']}
    for name in ('run_annual.py', 'review_client.py'):
        body = (ROOT / 'prepared' / 'annual' / name).read_bytes(); sha = hashlib.sha256(body).hexdigest()
        key = ANNUAL + 'engine-files/' + sha + '/' + name
        put_immutable(s3, key, body)
        files[name] = {'target': name, 'key': key, 'sha256': sha, 'bytes': len(body)}
    manifest['files'] = list(files.values())
    raw = json.dumps(manifest, ensure_ascii=False, indent=2).encode(); sha = hashlib.sha256(raw).hexdigest()
    key = ANNUAL + 'bundles/' + sha + '.json'; put_immutable(s3, key, raw)
    bundle_key = key
    for k, v in {'BUNDLE_KEY': key, 'BUNDLE_SHA256': sha, 'REVIEW_CONTROL_FUNCTION': control_arn}.items():
        variables[k] = {'name': k, 'value': v, 'type': 'PLAINTEXT'}
    aenv['environmentVariables'] = list(variables.values())
    cb.update_project(name=S['annual_project'], environment=aenv)
    # Explicit Deny overrides older broad PutObject grants. A future accidental
    # old-code redeploy fails closed instead of bypassing review.
    for role_arn, key in [(monthly['Role'], MONTH + 'current/monthly.json'), (annual['serviceRole'], ANNUAL + 'current/annual.json')]:
        client('iam').put_role_policy(RoleName=role_arn.rsplit('/', 1)[1], PolicyName='CurrentWriteRequiresReviewController',
            PolicyDocument=json.dumps({'Version': '2012-10-17', 'Statement': [{'Effect': 'Deny', 'Action': ['s3:PutObject', 's3:DeleteObject'], 'Resource': ARN + key}]}))
    return {'monthly_review_hook': True, 'annual_review_hook': True, 'annual_bundle_key': bundle_key,
            'direct_etl_pointer_writes_denied': True}


def put_immutable(s3, key, body):
    try:
        s3.put_object(Bucket=BUCKET, Key=key, Body=body, ExpectedBucketOwner=ACCOUNT,
                      ServerSideEncryption='AES256', IfNoneMatch='*')
    except ClientError as e:
        if e.response['Error']['Code'] != 'PreconditionFailed':
            raise
        r = s3.get_object(Bucket=BUCKET, Key=key, ExpectedBucketOwner=ACCOUNT)
        with r['Body'] as stream:
            if stream.read() != body:
                raise ValueError('不可覆寫不同內容的既有物件')


def apply():
    if client('sts').get_caller_identity()['Account'] != ACCOUNT:
        raise ValueError('AWS 帳號不符')
    print('PREFLIGHT_ACCOUNT_VERIFIED', flush=True)
    s3 = client('s3')
    if not all(s3.get_public_access_block(Bucket=BUCKET, ExpectedBucketOwner=ACCOUNT)['PublicAccessBlockConfiguration'].values()):
        raise ValueError('資料桶必須保持私有')
    # Capture deployment baseline before mutation; never persist secret-bearing configuration.
    web = client('lambda').get_function_configuration(FunctionName='ntpc-youth-web-gate4')
    old_env = web['Environment']['Variables']
    if not (ROOT / 'cloud-baseline.json').exists():
        pointers = {}
        for label, key in [('MONTHLY', MONTH + 'current/monthly.json'), ('ANNUAL', ANNUAL + 'current/annual.json')]:
            obj = s3.get_object(Bucket=BUCKET, Key=key, ExpectedBucketOwner=ACCOUNT)
            with obj['Body'] as stream:
                raw = stream.read()
            pointers[label] = {'key': key, 'etag': obj['ETag'], 'sha256': hashlib.sha256(raw).hexdigest(), 'pointer': json.loads(raw)}
        save('cloud-baseline.json', {'site_code_sha256': web['CodeSha256'],
            'monthly_code_sha256': client('lambda').get_function_configuration(FunctionName=S['monthly_function'])['CodeSha256'],
            'verified_account': ACCOUNT, 'data_bucket_private': True, 'pointers': pointers})
    print('BASELINE_SAVED_PRIVATE_BUCKET_VERIFIED', flush=True)
    ddb = client('dynamodb')
    try:
        ddb.describe_table(TableName=NAME)
    except ddb.exceptions.ResourceNotFoundException:
        ddb.create_table(TableName=NAME, KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST', SSESpecification={'Enabled': True},
            Tags=[{'Key': k, 'Value': v} for k, v in TAG.items()])
        ddb.get_waiter('table_exists').wait(TableName=NAME, WaiterConfig={'Delay': 2, 'MaxAttempts': 40})
    ddb.update_continuous_backups(TableName=NAME, PointInTimeRecoverySpecification={'PointInTimeRecoveryEnabled': True})
    table_arn = f'arn:aws:dynamodb:{REGION}:{ACCOUNT}:table/{NAME}'
    sqs = client('sqs')
    dlq = sqs.create_queue(QueueName=NAME + '-report-dlq', Attributes={'SqsManagedSseEnabled': 'true', 'MessageRetentionPeriod': '1209600'}, tags=TAG)['QueueUrl']
    dlq_arn = sqs.get_queue_attributes(QueueUrl=dlq, AttributeNames=['QueueArn'])['Attributes']['QueueArn']
    queue = sqs.create_queue(QueueName=NAME + '-reports', Attributes={'SqsManagedSseEnabled': 'true', 'VisibilityTimeout': '900', 'MessageRetentionPeriod': '1209600', 'RedrivePolicy': json.dumps({'deadLetterTargetArn': dlq_arn, 'maxReceiveCount': 5})}, tags=TAG)['QueueUrl']
    queue_arn = sqs.get_queue_attributes(QueueUrl=queue, AttributeNames=['QueueArn'])['Attributes']['QueueArn']
    sns = client('sns')
    topic = sns.create_topic(Name=NAME, Tags=[{'Key': k, 'Value': v} for k, v in TAG.items()])['TopicArn']
    identity = cognito()
    print('STORAGE_QUEUES_IDENTITY_READY', flush=True)
    env = {'DATA_BUCKET': BUCKET, 'DATA_ACCOUNT': ACCOUNT, 'REVIEW_PREFIX': PREFIX,
        'CASE_TABLE': NAME, 'REPORT_QUEUE_URL': queue, 'TOPIC_ARN': topic,
        'NOTIFICATION_EMAIL': S['notification_email'], 'REVIEW_URL': S['website'] + '/review/',
        'ADMIN_SUB': identity['admin_sub'], 'ANNUAL_PROJECT': S['annual_project']}
    alarms = {NAME + '-monthly-errors': 'MONTHLY', NAME + '-monthly-throttles': 'MONTHLY'}
    env['ALARM_PIPELINES'] = json.dumps(alarms)
    control_arn = function('control', 'aws_control.handler', ['aws_control.py', 'review_core.py'], env,
        [allow(['s3:GetObject'], ARN + SYSTEM + '*'), list_review(),
         allow(['s3:PutObject'], [ARN + PREFIX + 'cases/*', ARN + MONTH + 'current/monthly.json', ARN + ANNUAL + 'current/annual.json']),
         allow(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Scan', 'dynamodb:TransactWriteItems'], table_arn),
         allow(['sqs:SendMessage'], queue_arn)], timeout=900, memory=2048, concurrency=1)
    reporter_arn = function('report', 'report_worker.handler', ['report_worker.py'], env,
        [allow(['s3:GetObject'], ARN + PREFIX + '*'), list_review(), allow(['s3:PutObject'], ARN + PREFIX + 'reports/*'),
         allow(['sns:Publish', 'sns:ListSubscriptionsByTopic'], topic),
         allow(['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ChangeMessageVisibility'], queue_arn)], timeout=120, memory=512)
    lam = client('lambda')
    mappings = lam.list_event_source_mappings(FunctionName=reporter_arn, EventSourceArn=queue_arn)['EventSourceMappings']
    if not mappings:
        lam.create_event_source_mapping(FunctionName=reporter_arn, EventSourceArn=queue_arn, BatchSize=1,
            Enabled=True, FunctionResponseTypes=['ReportBatchItemFailures'])
    api_env = {**env, 'POOL_ID': identity['pool_id'], 'CLIENT_ID': identity['client_id'],
        'LOGIN_ORIGIN': identity['login_origin'], 'CONTROL_FUNCTION': control_arn,
        'ORIGIN_SECRET': old_env['ORIGIN_SECRET'], 'ALLOW_IPS': old_env['ALLOW_IPS']}
    api_arn = function('api', 'review_api.handler', ['review_api.py', 'review-ui.html', 'review-ui.js'], api_env,
        [allow(['s3:GetObject'], ARN + PREFIX + '*'), allow(['dynamodb:GetItem', 'dynamodb:Scan'], table_arn),
         allow(['lambda:InvokeFunction'], control_arn)], timeout=29, memory=512, concurrency=None)
    api = client('apigatewayv2')
    gateway = next((x for x in api.get_apis()['Items'] if x['Name'] == NAME), None)
    if not gateway:
        gateway = api.create_api(Name=NAME, ProtocolType='HTTP', Target=api_arn, Tags=TAG)
    add_permission(api_arn, 'ReviewHTTPAPI', 'apigateway.amazonaws.com', f'arn:aws:execute-api:{REGION}:{ACCOUNT}:{gateway["ApiId"]}/*/*')
    api.update_stage(ApiId=gateway['ApiId'], StageName='$default', DefaultRouteSettings={'ThrottlingBurstLimit': 10, 'ThrottlingRateLimit': 5})
    integrate_website(gateway['ApiId'], gateway['ApiEndpoint'], api_env)
    print('LAMBDAS_API_CLOUDFRONT_CONFIGURED', flush=True)
    event_rule(NAME + '-build-failures', {'source': ['aws.codebuild'], 'detail-type': ['CodeBuild Build State Change'],
        'detail': {'project-name': [S['annual_project']], 'build-status': ['FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED']}}, control_arn)
    cw = client('cloudwatch')
    for metric, alarm in [('Errors', NAME + '-monthly-errors'), ('Throttles', NAME + '-monthly-throttles')]:
        cw.put_metric_alarm(AlarmName=alarm, Namespace='AWS/Lambda', MetricName=metric,
            Dimensions=[{'Name': 'FunctionName', 'Value': S['monthly_function']}],
            Statistic='Sum', Period=300, EvaluationPeriods=1, Threshold=1,
            ComparisonOperator='GreaterThanOrEqualToThreshold', TreatMissingData='notBreaching')
    event_rule(NAME + '-lambda-failures', {'source': ['aws.cloudwatch'], 'detail-type': ['CloudWatch Alarm State Change'],
        'detail': {'alarmName': list(alarms), 'state': {'value': ['ALARM']}}}, control_arn)
    events = client('events')
    rec_arn = events.put_rule(Name=NAME + '-reconcile', ScheduleExpression='rate(1 hour)', State='ENABLED')['RuleArn']
    add_permission(control_arn, 'ReviewReconcile', 'events.amazonaws.com', rec_arn)
    result = events.put_targets(Rule=NAME + '-reconcile', Targets=[{'Id': 'review', 'Arn': control_arn, 'Input': '{"action":"reconcile"}'}])
    if result['FailedEntryCount']:
        raise ValueError('查核對帳排程設定失敗')
    integration = integrate_etl(control_arn)
    print('ETL_REVIEW_HOOKS_CONFIGURED', flush=True)
    subscriptions = sns.list_subscriptions_by_topic(TopicArn=topic)['Subscriptions']
    subscription = next((x for x in subscriptions if x.get('Protocol') == 'email' and x.get('Endpoint') == S['notification_email']), None)
    if not subscription:
        subscription = sns.subscribe(TopicArn=topic, Protocol='email', Endpoint=S['notification_email'], ReturnSubscriptionArn=True)
    if identity['invite_new_user']:
        client('cognito-idp').admin_create_user(UserPoolId=identity['pool_id'], Username=S['admin_email'],
            MessageAction='RESEND', DesiredDeliveryMediums=['EMAIL'])
        save('admin-invitation.json', {'pool_id': identity['pool_id'], 'email': S['admin_email'],
            'status': 'COGNITO_INVITATION_REQUESTED', 'meaning': '寄送已請求，不代表已收信或已完成登入'})
    receipt = {'status': 'DEPLOYED_AWAITING_END_TO_END_VERIFICATION', 'region': REGION,
        'topic_arn': topic, 'subscription_status': subscription['SubscriptionArn'],
        'notification_email': S['notification_email'], 'review_url': S['website'] + '/review/',
        'user_pool_id': identity['pool_id'], 'controller': control_arn, 'reporter': reporter_arn,
        'api': api_arn, 'table': NAME, 'cloudfront_propagation': 'CHECK_REQUIRED', **integration}
    save('deployment.json', receipt)
    print(json.dumps(receipt, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--apply', action='store_true'); args = parser.parse_args()
    prepare_integration.build()
    plan = {'status': 'PREPARED_NOT_DEPLOYED', 'notification_email': S['notification_email'],
        'new_services': ['3 Lambda', 'DynamoDB', 'SNS Email', 'SQS + DLQ', 'Cognito', 'HTTP API', 'EventBridge rules'],
        'preserved': ['private S3', 'existing data versions', 'public dashboard', 'AI answering', 'existing ETL schedules'],
        'changes': ['review portal CloudFront routes', 'monthly and annual ETL hooks', 'current writes restricted to controller'],
        'authentication': 'Cognito named admin + existing IP allowlist',
        'needs_user_action': ['AWS access to deploy', 'SNS email subscription confirmation', 'first admin login and password setup']}
    save('deployment-plan.json', plan)
    if not args.apply:
        print(json.dumps(plan, ensure_ascii=False)); return
    try:
        apply()
    except NoCredentialsError:
        save('deployment-blocker.json', {'status': 'BLOCKED_NO_CREDENTIALS', 'cloud_mutations_attempted': False})
        raise SystemExit('尚無可用 AWS 憑證；未更動雲端。')


if __name__ == '__main__':
    main()
