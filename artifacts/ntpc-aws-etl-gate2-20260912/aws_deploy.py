"""專案專用 IAM、Lambda、Scheduler；不更動 Workshop 管理資源。只用 boto3。"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone,timedelta
import argparse,io,json,zipfile,time,hashlib
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from etl.common import S3Store,encoded,now
ROOT=Path(__file__).resolve().parent
BUCKET='ntpc-youth-data-000000000000';ACCOUNT='000000000000';REGION='us-west-2'
SYSTEM='NTPC_Youth_System_V1_20260912/'
PREFIX=SYSTEM+'12_ETL與排程/runtime/'
FUNCTION='ntpc-youth-monthly-etl-v1';ROLE='ntpc-youth-monthly-etl-v1-role';SCHED_ROLE='ntpc-youth-etl-v1-scheduler-role';GROUP='ntpc-youth-etl-v1'
CONF=Config(region_name=REGION,connect_timeout=10,read_timeout=70,retries={'max_attempts':2})
def client(service):return boto3.client(service,config=CONF)
def save(name,data):(ROOT/name).write_bytes(encoded(data))
def identity():
    assert client('sts').get_caller_identity()['Account']==ACCOUNT,'非預期 AWS 帳號'
    s3=client('s3');assert s3.get_bucket_location(Bucket=BUCKET)['LocationConstraint']==REGION
    assert all(s3.get_public_access_block(Bucket=BUCKET)['PublicAccessBlockConfiguration'].values()),'S3 必須維持私有'
def ensure_role(name,principal,policy,extra=None):
    iam=client('iam');trust={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':principal},'Action':'sts:AssumeRole',**({'Condition':extra} if extra else {})}]}
    try:r=iam.get_role(RoleName=name)['Role']
    except ClientError as e:
        if e.response['Error']['Code']!='NoSuchEntity':raise
        r=iam.create_role(RoleName=name,AssumeRolePolicyDocument=json.dumps(trust),Description='NTPC youth scoped ETL role',Tags=[{'Key':'Project','Value':'NTPC-Youth-System-V1'}])['Role']
    else:
        tags=iam.list_role_tags(RoleName=name)['Tags']
        assert {'Key':'Project','Value':'NTPC-Youth-System-V1'} in tags,'既有角色不屬於本案；不修改'
        assert r['AssumeRolePolicyDocument']==trust,'信任原則不同；停止不覆寫'
    iam.put_role_policy(RoleName=name,PolicyName='ntpc-youth-scoped-etl',PolicyDocument=json.dumps({'Version':'2012-10-17','Statement':policy}))
    return r['Arn']
def provision():
    identity();arn=f'arn:aws:s3:::{BUCKET}/{PREFIX}'
    role=ensure_role(ROLE,'lambda.amazonaws.com',[
        {'Effect':'Allow','Action':['s3:GetObject'],'Resource':arn+'*'},
        {'Effect':'Allow','Action':['s3:PutObject'],'Resource':[arn+x+'/*' for x in ['raw','releases','current','runs']]},
        {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/{FUNCTION}:*'}])
    logs=client('logs')
    try:logs.create_log_group(logGroupName='/aws/lambda/'+FUNCTION,tags={'Project':'NTPC-Youth-System-V1'})
    except ClientError as e:
        if e.response['Error']['Code']!='ResourceAlreadyExistsException':raise
    logs.put_retention_policy(logGroupName='/aws/lambda/'+FUNCTION,retentionInDays=14)
    # 程式封裝僅在記憶體送至 Lambda API，S3 不放任何 ZIP。
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for path in (ROOT/'etl').glob('*.py'):archive.write(path,'etl/'+path.name)
    code=stream.getvalue();lam=client('lambda')
    try:existing=lam.get_function(FunctionName=FUNCTION)
    except ClientError as e:
        if e.response['Error']['Code']!='ResourceNotFoundException':raise
        existing=None
    env={'Variables':{'DATA_BUCKET':BUCKET,'ETL_PREFIX':PREFIX,'DATA_ACCOUNT':ACCOUNT}}
    if existing:
        assert existing.get('Tags',{}).get('Project')=='NTPC-Youth-System-V1','既有函式不是本案，停止'
        lam.update_function_code(FunctionName=FUNCTION,ZipFile=code)
        lam.get_waiter('function_updated_v2').wait(FunctionName=FUNCTION,WaiterConfig={'Delay':2,'MaxAttempts':25})
        lam.update_function_configuration(FunctionName=FUNCTION,Role=role,Runtime='python3.12',Handler='etl.handler.handler',Timeout=900,MemorySize=1024,Environment=env)
    else:
        for attempt in range(6):
            try:
                lam.create_function(FunctionName=FUNCTION,Runtime='python3.12',Role=role,Handler='etl.handler.handler',Code={'ZipFile':code},Timeout=900,MemorySize=1024,Environment=env,Tags={'Project':'NTPC-Youth-System-V1'},Architectures=['x86_64'])
                break
            except ClientError as e:
                if e.response['Error']['Code']=='InvalidParameterValueException' and 'assumed' in e.response['Error']['Message'] and attempt<5:time.sleep(3)
                else:raise
    lam.get_waiter('function_active_v2').wait(FunctionName=FUNCTION,WaiterConfig={'Delay':2,'MaxAttempts':25})
    lam.put_function_concurrency(FunctionName=FUNCTION,ReservedConcurrentExecutions=1)
    # 單機已驗證的新月資料及每頁來源，僅建立本案 runtime 前綴。
    store=S3Store(BUCKET,PREFIX);files=[p for p in (ROOT/'runtime-local').rglob('*') if p.is_file() and p.suffix.lower()!='.zip' and '/runs/' not in p.as_posix()]
    def upload(path):
        key=path.relative_to(ROOT/'runtime-local').as_posix();body=path.read_bytes()
        store.put(key,body,create=True)
        assert store.get(key)[0]==body
    with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(upload,files))
    result={'status':'PROVISIONED_NOT_SCHEDULED','checked_at':now(),'function':FUNCTION,'role':role,'prefix':PREFIX,'initialized_files':len(files),'function_code_sha256':hashlib.sha256(code).hexdigest()}
    save('aws-provision.json',result);print(json.dumps(result,ensure_ascii=False),flush=True)
def invoke():
    identity();lam=boto3.client('lambda',region_name=REGION,config=Config(connect_timeout=10,read_timeout=930,retries={'max_attempts':0}))
    r=lam.invoke(FunctionName=FUNCTION,InvocationType='RequestResponse',Payload=b'{"trigger":"gate2-validation"}')
    body=json.loads(r['Payload'].read());result={'checked_at':now(),'status':'PASS' if not r.get('FunctionError') and body.get('status') in ['NO_CHANGE','PUBLISHED'] else 'FAIL','function_error':r.get('FunctionError'),'result':body}
    save('aws-invoke.json',result);print(json.dumps(result,ensure_ascii=False),flush=True)
    assert result['status']=='PASS','實際 Lambda 執行未通過，不啟用排程'
def schedule():
    identity();assert json.loads((ROOT/'aws-invoke.json').read_bytes())['status']=='PASS','尚未通過實際 Lambda 測試'
    scheduler=client('scheduler')
    try:scheduler.create_schedule_group(Name=GROUP,Tags=[{'Key':'Project','Value':'NTPC-Youth-System-V1'}])
    except ClientError as e:
        if e.response['Error']['Code']!='ConflictException':raise
    fnarn=f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION}'
    role=ensure_role(SCHED_ROLE,'scheduler.amazonaws.com',[{'Effect':'Allow','Action':['lambda:InvokeFunction'],'Resource':fnarn}],{'StringEquals':{'aws:SourceAccount':ACCOUNT},'ArnEquals':{'aws:SourceArn':f'arn:aws:scheduler:{REGION}:{ACCOUNT}:schedule-group/{GROUP}'}})
    args={'Name':'monthly-population-daily-0915','GroupName':GROUP,'Description':'官方月人口 ETL；最新兩月及一個輪替歷史月；不重算其他模型','ScheduleExpression':'cron(15 9 * * ? *)','ScheduleExpressionTimezone':'Asia/Taipei','FlexibleTimeWindow':{'Mode':'OFF'},'State':'ENABLED','Target':{'Arn':fnarn,'RoleArn':role,'Input':'{"trigger":"daily-monthly-etl"}','RetryPolicy':{'MaximumRetryAttempts':1,'MaximumEventAgeInSeconds':3600}}}
    try:scheduler.get_schedule(Name=args['Name'],GroupName=GROUP)
    except ClientError as e:
        if e.response['Error']['Code']!='ResourceNotFoundException':raise
        for attempt in range(6):
            try:scheduler.create_schedule(**args);break
            except ClientError as delayed:
                if delayed.response['Error']['Code']=='ValidationException' and 'assume' in delayed.response['Error']['Message'] and attempt<5:time.sleep(3)
                else:raise
    else:scheduler.update_schedule(**args)
    actual=scheduler.get_schedule(Name=args['Name'],GroupName=GROUP)
    result={'checked_at':now(),'status':actual['State'],'schedule_arn':actual['Arn'],'schedule_expression':actual['ScheduleExpression'],'timezone':actual['ScheduleExpressionTimezone'],'target':actual['Target'],'scope':'僅月人口，年度五長表目前為離線重建驗證，尚未自動刷新'}
    save('aws-schedule.json',result);print(json.dumps(result,ensure_ascii=False),flush=True)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['provision','invoke','schedule']);args=parser.parse_args()
    try:globals()[args.phase]()
    except Exception as e:
        error={'phase':args.phase,'checked_at':now(),'status':'FAILED','error_type':type(e).__name__,'message':str(e)}
        save('aws-'+args.phase+'-error.json',error);print(json.dumps(error,ensure_ascii=False),flush=True);raise
