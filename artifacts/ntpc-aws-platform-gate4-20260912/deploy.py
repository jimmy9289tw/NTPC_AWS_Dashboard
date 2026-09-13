from pathlib import Path
import argparse, io, json, secrets, time, zipfile, mimetypes
import boto3
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parent
REGION='us-west-2'; ACCOUNT='000000000000'; BUCKET='ntpc-youth-data-000000000000'
NAME='ntpc-youth-web-gate4'; PREFIX='NTPC_Youth_System_V1_20260912/09_網站與完整原始碼/AWS_Gate4/web/'
IPS=['192.0.2.1','192.0.2.2','192.0.2.3','192.0.2.4','192.0.2.5','192.0.2.6']
s=boto3.Session(region_name=REGION)

def update_code():
    """Update only the existing web function, preserving all IAM, IP, AI and ETL settings."""
    assert s.client('sts').get_caller_identity()['Account']==ACCOUNT
    lam=s.client('lambda');before=lam.get_function_configuration(FunctionName=NAME)
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        for name in ['server.py','roa-rules.json','roa-context.json','ai_chat.py','ai_evidence.py','ai-official-sources.json']:
            z.write(ROOT/name,name)
        reader=ROOT/'system_reader_v2.py'
        if not reader.exists():reader=ROOT.parent/'ntpc-aws-etl-gate3-20260912/system_reader_v2.py'
        z.write(reader,'system_reader_v2.py')
    lam.update_function_code(FunctionName=NAME,ZipFile=buf.getvalue(),RevisionId=before['RevisionId'])
    lam.get_waiter('function_updated_v2').wait(FunctionName=NAME)
    after=lam.get_function_configuration(FunctionName=NAME)
    assert before['Environment']==after['Environment'] and before['Role']==after['Role']
    print(json.dumps({'updated':NAME,'configuration_unchanged':True,'code_sha256':after['CodeSha256']}))

def provision():
    assert s.client('sts').get_caller_identity()['Account']==ACCOUNT
    iam=s.client('iam'); lam=s.client('lambda'); api=s.client('apigatewayv2'); cf=s.client('cloudfront')
    role_name=NAME+'-role'
    try: role=iam.get_role(RoleName=role_name)['Role']
    except iam.exceptions.NoSuchEntityException:
        role=iam.create_role(RoleName=role_name,AssumeRolePolicyDocument=json.dumps({'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]}))['Role']
    iam.put_role_policy(RoleName=role_name,PolicyName='PrivateSystemReadAndOwnLogs',PolicyDocument=json.dumps({'Version':'2012-10-17','Statement':[
        {'Effect':'Allow','Action':['s3:GetObject'],'Resource':[f'arn:aws:s3:::{BUCKET}/00_CURRENT_SYSTEM.json',f'arn:aws:s3:::{BUCKET}/NTPC_Youth_System_V1_20260912/*']},
        {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/{NAME}:*'}]}))
    logs=s.client('logs')
    try: logs.create_log_group(logGroupName='/aws/lambda/'+NAME)
    except logs.exceptions.ResourceAlreadyExistsException: pass
    logs.put_retention_policy(logGroupName='/aws/lambda/'+NAME,retentionInDays=14)
    try: old=lam.get_function_configuration(FunctionName=NAME); secret=old['Environment']['Variables']['ORIGIN_SECRET']
    except lam.exceptions.ResourceNotFoundException: old=None; secret=secrets.token_urlsafe(40)
    env={**(old or {}).get('Environment',{}).get('Variables',{}),'ORIGIN_SECRET':secret,'ALLOW_IPS':','.join(IPS),'BUCKET':BUCKET}
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        for name in ['server.py','roa-rules.json','roa-context.json','ai_chat.py','ai_evidence.py','ai-official-sources.json']: z.write(ROOT/name,name)
        source_reader=ROOT/'system_reader_v2.py'
        if not source_reader.exists(): source_reader=ROOT.parent/'ntpc-aws-etl-gate3-20260912/system_reader_v2.py'
        z.write(source_reader,'system_reader_v2.py')
    if old:
        lam.update_function_code(FunctionName=NAME,ZipFile=buf.getvalue()); lam.get_waiter('function_updated_v2').wait(FunctionName=NAME)
        lam.update_function_configuration(FunctionName=NAME,Environment={'Variables':env},Timeout=60,MemorySize=1024)
    else:
        for attempt in range(8):
            try:
                lam.create_function(FunctionName=NAME,Role=role['Arn'],Runtime='python3.12',Handler='server.lambda_handler',Code={'ZipFile':buf.getvalue()},Timeout=60,MemorySize=1024,Environment={'Variables':env});break
            except lam.exceptions.InvalidParameterValueException:
                if attempt==7:raise
                time.sleep(3)
    lam.get_waiter('function_active_v2').wait(FunctionName=NAME)
    lam.put_function_concurrency(FunctionName=NAME,ReservedConcurrentExecutions=5)
    existing=next((x for x in api.get_apis()['Items'] if x['Name']==NAME),None)
    gateway=existing or api.create_api(Name=NAME,ProtocolType='HTTP',Target=f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{NAME}')
    aid=gateway['ApiId']
    try: lam.add_permission(FunctionName=NAME,StatementId='HttpApi',Action='lambda:InvokeFunction',Principal='apigateway.amazonaws.com',SourceArn=f'arn:aws:execute-api:{REGION}:{ACCOUNT}:{aid}/*/*')
    except lam.exceptions.ResourceConflictException: pass
    api.update_stage(ApiId=aid,StageName='$default',DefaultRouteSettings={'ThrottlingBurstLimit':20,'ThrottlingRateLimit':10})
    code=('function handler(event) { var r=event.request; var ip=event.viewer.ip; var ok='+json.dumps(IPS)+'.indexOf(ip)>=0; '
          'var p=r.uri; try { for(var i=0;i<3;i++){p=decodeURIComponent(p);} }catch(e){return {statusCode:400,statusDescription:"Bad Request"};} '
          'var guarded=p==="/internal"||p.indexOf("/internal/")===0||p.indexOf("/api/export")===0||p.indexOf("/api/roa")===0; '
          'if(guarded&&!ok){return {statusCode:403,statusDescription:"Forbidden",headers:{"cache-control":{value:"private, no-store"},"content-type":{value:"text/plain; charset=utf-8"}},body:"此入口限指定網路位置。請使用公開資料頁。"};} '
          'r.headers["x-ntpc-viewer-ip"]={value:ip}; delete r.headers["x-ntpc-origin"]; return r; }')
    fn=NAME+'-ip-access'
    try:
        desc=cf.describe_function(Name=fn,Stage='DEVELOPMENT')
        f=cf.update_function(Name=fn,IfMatch=desc['ETag'],FunctionConfig={'Comment':'Exact viewer IP allowlist; no login','Runtime':'cloudfront-js-2.0'},FunctionCode=code.encode())
    except cf.exceptions.NoSuchFunctionExists:
        f=cf.create_function(Name=fn,FunctionConfig={'Comment':'Exact viewer IP allowlist; no login','Runtime':'cloudfront-js-2.0'},FunctionCode=code.encode())
    published=cf.publish_function(Name=fn,IfMatch=f['ETag'])
    arn=published['FunctionSummary']['FunctionMetadata']['FunctionARN']
    cached=next((x for x in cf.list_distributions()['DistributionList'].get('Items',[]) if x.get('Comment')==NAME),None)
    host=gateway['ApiEndpoint'].split('//')[1]
    config={'CallerReference':NAME,'Comment':NAME,'Enabled':True,'IsIPV6Enabled':False,'PriceClass':'PriceClass_100',
      'Origins':{'Quantity':1,'Items':[{'Id':'gateway','DomainName':host,'CustomHeaders':{'Quantity':1,'Items':[{'HeaderName':'x-ntpc-origin','HeaderValue':secret}]},'CustomOriginConfig':{'HTTPPort':80,'HTTPSPort':443,'OriginProtocolPolicy':'https-only','OriginSslProtocols':{'Quantity':1,'Items':['TLSv1.2']}}}]},
      'DefaultCacheBehavior':{'TargetOriginId':'gateway','ViewerProtocolPolicy':'redirect-to-https','AllowedMethods':{'Quantity':7,'Items':['GET','HEAD','OPTIONS','PUT','PATCH','POST','DELETE'],'CachedMethods':{'Quantity':2,'Items':['GET','HEAD']}},'Compress':True,
        'CachePolicyId':'4135ea2d-6df8-44a3-9df3-4b5a84be39ad','OriginRequestPolicyId':'b689b0a8-53d0-40ab-baf2-68738e2966ac','FunctionAssociations':{'Quantity':1,'Items':[{'FunctionARN':arn,'EventType':'viewer-request'}]},'TrustedSigners':{'Enabled':False,'Quantity':0},'TrustedKeyGroups':{'Enabled':False,'Quantity':0}},
      'ViewerCertificate':{'CloudFrontDefaultCertificate':True}}
    if cached:
        # Only the six-IP function changes for this deployment. Reusing its ARN
        # automatically applies its LIVE revision, without rebuilding the distribution.
        distribution=cf.get_distribution(Id=cached['Id'])['Distribution']
        actual=distribution['DistributionConfig']
        assert actual['Origins']['Items'][0]['DomainName']==host
        assert actual['DefaultCacheBehavior']['FunctionAssociations']['Items'][0]['FunctionARN']==arn
        assert actual['DefaultCacheBehavior']['CachePolicyId']==config['DefaultCacheBehavior']['CachePolicyId']
        assert actual['Origins']['Items'][0]['CustomHeaders']['Items'][0]['HeaderValue']==secret
    else: distribution=cf.create_distribution(DistributionConfig=config)['Distribution']
    # Receipt deliberately excludes origin secret and credentials.
    receipt={'function':NAME,'api_id':aid,'api_url':gateway['ApiEndpoint'],'distribution_id':distribution['Id'],'url':'https://'+distribution['DomainName'],'internal_url':'https://'+distribution['DomainName']+'/internal/','allow_ipv4':IPS,'status':distribution['Status']}
    (ROOT/'deployment.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False))

def upload():
    # Fail before the first upload when the workshop session expires or changes account.
    assert s.client('sts').get_caller_identity()['Account']==ACCOUNT, 'Unexpected AWS account'
    s3=s.client('s3'); count=0; pending=[]
    for build, prefix in [('dist-public',''),('dist-internal','internal/')]:
        for p in (ROOT/'dashboard'/build).rglob('*'):
            if not p.is_file():continue
            rel=p.relative_to(ROOT/'dashboard'/build).as_posix()
            if rel.startswith('data/') and rel!='data/ntpc-districts.geojson': continue
            pending.append((p,prefix,rel))
    # Publish assets before the HTML that references them; keep older hashed assets intact.
    for p,prefix,rel in sorted(pending,key=lambda item:item[2]=='index.html'):
        s3.upload_file(str(p),BUCKET,PREFIX+prefix+rel,ExtraArgs={'ContentType':mimetypes.guess_type(p.name)[0] or 'application/octet-stream','ServerSideEncryption':'AES256','CacheControl':'private, no-store' if prefix else 'public, max-age=60'})
        count+=1
    print(json.dumps({'uploaded':count,'private_bucket':BUCKET,'prefix':PREFIX}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['provision','upload','update-code']);args=parser.parse_args()
    {'provision':provision,'upload':upload,'update-code':update_code}[args.action]()
