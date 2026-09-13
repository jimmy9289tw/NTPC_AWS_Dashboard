"""本案 CodeBuild 年度 ETL 基礎架構；不使用 AWS CLI。"""
from pathlib import Path
from datetime import datetime,timezone
from concurrent.futures import ThreadPoolExecutor
import argparse,boto3,hashlib,json,os,time
from botocore.exceptions import ClientError
ROOT=Path(__file__).resolve().parent;SYSTEM=ROOT.parent/'NTPC_Youth_System_V1_20260912'
ACCOUNT='000000000000';REGION='us-west-2';BUCKET='codex-workshop-theweeklyblend-s3-'+ACCOUNT
PREFIX='NTPC_Youth_System_V1_20260912/';RUNTIME=PREFIX+'12_ETL與排程/runtime-annual/'
NAME='ntpc-youth-annual-etl-v1';ROLE=NAME+'-role';LOG='/aws/codebuild/'+NAME
session=boto3.Session(region_name=REGION);s3=session.client('s3');iam=session.client('iam');build=session.client('codebuild');logs=session.client('logs')
def save(name,value):
    (ROOT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
def upload(item):
    p=Path(item['path']);body=p.read_bytes()
    if p.suffix.lower()=='.zip' or hashlib.sha256(body).hexdigest()!=item['sha256']:raise ValueError('上傳內容不符合清冊')
    try:
        old=s3.get_object(Bucket=BUCKET,Key=item['key'],ExpectedBucketOwner=ACCOUNT);stream=old['Body']
        try:
            if hashlib.sha256(stream.read()).hexdigest()==item['sha256']:return
            raise ValueError('不可覆寫不同內容的輸入版本')
        finally:stream.close()
    except ClientError as e:
        if e.response['Error']['Code'] not in ['NoSuchKey','404']:raise
    s3.put_object(Bucket=BUCKET,Key=item['key'],Body=body,ServerSideEncryption='AES256',ExpectedBucketOwner=ACCOUNT,IfNoneMatch='*')
    stream=s3.get_object(Bucket=BUCKET,Key=item['key'],ExpectedBucketOwner=ACCOUNT)['Body']
    try:
        if hashlib.sha256(stream.read()).hexdigest()!=item['sha256']:raise ValueError('上傳讀回不一致')
    finally:stream.close()
def provision(bundle_key=None):
    if session.client('sts').get_caller_identity()['Account']!=ACCOUNT:raise ValueError('AWS 帳號不符')
    public=s3.get_public_access_block(Bucket=BUCKET,ExpectedBucketOwner=ACCOUNT)['PublicAccessBlockConfiguration']
    if not all(public.values()):raise ValueError('S3 必須維持私有')
    if bundle_key:
        if not bundle_key.startswith(RUNTIME+'bundles/') or not bundle_key.endswith('.json'):raise ValueError('只能使用本案既有批次清冊')
        stream=s3.get_object(Bucket=BUCKET,Key=bundle_key,ExpectedBucketOwner=ACCOUNT)['Body']
        try:body=stream.read()
        finally:stream.close()
        digest=hashlib.sha256(body).hexdigest()
        if bundle_key.rsplit('/',1)[1]!=digest+'.json':raise ValueError('既有清冊內容雜湊不符')
        manifest={'key':bundle_key,'sha256':digest};plan={'needed_files':len(json.loads(body)['files']),'files':[]}
    else:
        plan=json.loads((ROOT/'bundle-upload.json').read_text(encoding='utf-8'))
        # 執行清冊使用內容定址，後續更版不覆寫舊檔。
        manifest=plan['files'][-1];manifest['key']=RUNTIME+'bundles/'+manifest['sha256']+'.json'
        print('正在核對年度批次輸入檔案',flush=True)
        with ThreadPoolExecutor(max_workers=4) as pool:
            for n,_ in enumerate(pool.map(upload,plan['files']),1):
                print(f'輸入檔案讀回查核 {n}/{len(plan["files"])}',flush=True)
    boot=ROOT/'bootstrap_annual.py';bootsha=hashlib.sha256(boot.read_bytes()).hexdigest();bootkey=RUNTIME+'bootstrap/'+bootsha+'.py';upload({'path':str(boot),'key':bootkey,'sha256':bootsha})
    trust={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'codebuild.amazonaws.com'},'Action':'sts:AssumeRole','Condition':{'StringEquals':{'aws:SourceAccount':ACCOUNT},'ArnEquals':{'aws:SourceArn':f'arn:aws:codebuild:{REGION}:{ACCOUNT}:project/{NAME}'}}}]}
    try:iam.create_role(RoleName=ROLE,AssumeRolePolicyDocument=json.dumps(trust),Tags=[{'Key':'Project','Value':'NTPC-Youth-System'},{'Key':'ManagedBy','Value':'Codex-Gate3'}])
    except iam.exceptions.EntityAlreadyExistsException:
        role=iam.get_role(RoleName=ROLE)['Role']
        if not any(t['Key']=='ManagedBy' and t['Value']=='Codex-Gate3' for t in role.get('Tags',[])):raise ValueError('同名IAM角色非本程式管理')
    policy={'Version':'2012-10-17','Statement':[
        {'Effect':'Allow','Action':['s3:GetObject'],'Resource':f'arn:aws:s3:::{BUCKET}/{PREFIX}*'},
        {'Effect':'Allow','Action':['s3:ListBucket'],'Resource':f'arn:aws:s3:::{BUCKET}','Condition':{'StringLike':{'s3:prefix':[RUNTIME+'current/*']}}},
        {'Effect':'Allow','Action':['s3:PutObject'],'Resource':[f'arn:aws:s3:::{BUCKET}/{RUNTIME}{p}*' for p in ['releases/','runs/','current/']]},
        {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:{LOG}:*'}]}
    iam.put_role_policy(RoleName=ROLE,PolicyName='NTPCAnnualETLOnly',PolicyDocument=json.dumps(policy))
    try:logs.create_log_group(logGroupName=LOG,tags={'Project':'NTPC-Youth-System'})
    except logs.exceptions.ResourceAlreadyExistsException:pass
    logs.put_retention_policy(logGroupName=LOG,retentionInDays=14)
    bootstrap="import boto3,hashlib; b=boto3.client('s3',region_name='us-west-2').get_object(Bucket='"+BUCKET+"',Key='"+bootkey+"',ExpectedBucketOwner='"+ACCOUNT+"')['Body'].read(); assert hashlib.sha256(b).hexdigest()=='"+bootsha+"'; exec(compile(b,'bootstrap_annual.py','exec'))"
    spec={'version':0.2,'phases':{'install':{'runtime-versions':{'python':'3.12','nodejs':'22'},'commands':['python -m pip install --disable-pip-version-check numpy==2.3.5 pandas==3.0.1 openpyxl==3.1.5 xlrd==2.0.2 pypdf==6.10.0 boto3==1.43.93']},'build':{'commands':['python -c '+json.dumps(bootstrap)]}}}
    env={'DATA_BUCKET':BUCKET,'DATA_ACCOUNT':ACCOUNT,'ANNUAL_PREFIX':RUNTIME,'BUNDLE_KEY':manifest['key'],'BUNDLE_SHA256':manifest['sha256'],'NTPC_NODE':'node','OPENBLAS_NUM_THREADS':'1','PYTHONUTF8':'1','REFRESH_OFFICIAL':'false'}
    config={'name':NAME,'description':'新北青年資料：官方來源、拆齡模型及排名整批驗證','source':{'type':'NO_SOURCE','buildspec':json.dumps(spec,ensure_ascii=False)},'artifacts':{'type':'NO_ARTIFACTS'},'serviceRole':f'arn:aws:iam::{ACCOUNT}:role/{ROLE}','environment':{'type':'LINUX_CONTAINER','image':'aws/codebuild/standard:7.0','computeType':'BUILD_GENERAL1_SMALL','privilegedMode':False,'environmentVariables':[{'name':k,'value':v,'type':'PLAINTEXT'} for k,v in env.items()]},'timeoutInMinutes':30,'queuedTimeoutInMinutes':10,'concurrentBuildLimit':1,'logsConfig':{'cloudWatchLogs':{'status':'ENABLED','groupName':LOG},'s3Logs':{'status':'DISABLED'}}}
    existing=build.batch_get_projects(names=[NAME])['projects']
    if existing:response=build.update_project(**config)
    else:response=build.create_project(**config,tags=[{'key':'Project','value':'NTPC-Youth-System'},{'key':'ManagedBy','value':'Codex-Gate3'}])
    result={'status':'PROVISIONED','project':response['project']['arn'],'region':REGION,'input_files':plan['needed_files'],'uploaded_hash_verified':len(plan['files'])+1,'bundle_key':manifest['key'],'public_access_block':public,'schedule':'尚未啟用，先實跑驗證'};save('aws-provision.json',result);print(json.dumps(result,ensure_ascii=False))
def main():
    p=argparse.ArgumentParser();p.add_argument('phase',choices=['provision','start','status']);p.add_argument('--refresh',action='store_true');p.add_argument('--bundle-key');a=p.parse_args()
    if a.phase=='provision':provision(a.bundle_key)
    elif a.phase=='start':
        r=build.start_build(projectName=NAME,idempotencyToken='gate3-'+str(int(time.time())),environmentVariablesOverride=[{'name':'REFRESH_OFFICIAL','value':'true' if a.refresh else 'false','type':'PLAINTEXT'}])['build'];save('aws-build.json',{'id':r['id'],'started_at':str(r['startTime']),'mode':'REFRESH' if a.refresh else 'REPRODUCE'});print(json.dumps({'id':r['id'],'status':r['buildStatus']}))
    else:
        state=json.loads((ROOT/'aws-build.json').read_text(encoding='utf-8'));r=build.batch_get_builds(ids=[state['id']])['builds'][0]
        result={'id':r['id'],'status':r['buildStatus'],'phase':r.get('currentPhase'),'phases':r.get('phases'),'logs':r.get('logs')};save('aws-build-status.json',result);print(json.dumps(result,default=str))
if __name__=='__main__':
    try:main()
    except Exception as error:
        save('aws-deployment-error.json',{'error_type':type(error).__name__,'message':str(error),'time':datetime.now(timezone.utc).isoformat()})
        raise
