"""Provision only the approved minimal AI additions; private S3 and website stay intact."""
from pathlib import Path
import io,json,time,zipfile
import boto3
from botocore.exceptions import ClientError

ROOT=Path(__file__).resolve().parent
REGION='us-west-2';ACCOUNT='000000000000';NAME='ntpc-youth-ai-v1';WEB='ntpc-youth-web-gate4'
BUCKET='ntpc-youth-data-000000000000'
s=boto3.Session(region_name=REGION)

def main():
    assert s.client('sts').get_caller_identity()['Account']==ACCOUNT
    dynamo=s.client('dynamodb');sqs=s.client('sqs');iam=s.client('iam');lam=s.client('lambda');logs=s.client('logs')
    try:dynamo.describe_table(TableName=NAME)
    except dynamo.exceptions.ResourceNotFoundException:
        dynamo.create_table(TableName=NAME,KeySchema=[{'AttributeName':'pk','KeyType':'HASH'}],AttributeDefinitions=[{'AttributeName':'pk','AttributeType':'S'}],
                            BillingMode='PAY_PER_REQUEST',SSESpecification={'Enabled':True},Tags=[{'Key':'Project','Value':'NTPC-Youth-AI-V1'}])
        dynamo.get_waiter('table_exists').wait(TableName=NAME)
    ttl=dynamo.describe_time_to_live(TableName=NAME)['TimeToLiveDescription']
    if ttl.get('TimeToLiveStatus')=='DISABLED':dynamo.update_time_to_live(TableName=NAME,TimeToLiveSpecification={'Enabled':True,'AttributeName':'expires'})
    qurl=sqs.create_queue(QueueName=NAME+'.fifo',Attributes={'FifoQueue':'true','ContentBasedDeduplication':'false','VisibilityTimeout':'720','MessageRetentionPeriod':'900','SqsManagedSseEnabled':'true'})['QueueUrl']
    qarn=sqs.get_queue_attributes(QueueUrl=qurl,AttributeNames=['QueueArn'])['Attributes']['QueueArn'];tarn=f'arn:aws:dynamodb:{REGION}:{ACCOUNT}:table/{NAME}'
    role_name=NAME+'-role'
    try:role=iam.get_role(RoleName=role_name)['Role']
    except iam.exceptions.NoSuchEntityException:
        role=iam.create_role(RoleName=role_name,AssumeRolePolicyDocument=json.dumps({'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]}))['Role']
    policy={'Version':'2012-10-17','Statement':[
      {'Effect':'Allow','Action':['s3:GetObject'],'Resource':[f'arn:aws:s3:::{BUCKET}/00_CURRENT_SYSTEM.json',f'arn:aws:s3:::{BUCKET}/NTPC_Youth_System_V1_20260912/*']},
      {'Effect':'Allow','Action':['bedrock:InvokeModel'],'Resource':f'arn:aws:bedrock:{REGION}::foundation-model/amazon.nova-lite-v1:0'},
      {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:UpdateItem'],'Resource':tarn},
      {'Effect':'Allow','Action':['sqs:ReceiveMessage','sqs:DeleteMessage','sqs:GetQueueAttributes','sqs:ChangeMessageVisibility'],'Resource':qarn},
      {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/{NAME}:*'}]}
    iam.put_role_policy(RoleName=role_name,PolicyName='ReadPublicEvidenceAndOneModel',PolicyDocument=json.dumps(policy))
    iam.put_role_policy(RoleName=WEB+'-role',PolicyName='SubmitAndReadOwnedAIJobs',PolicyDocument=json.dumps({'Version':'2012-10-17','Statement':[
      {'Effect':'Allow','Action':['sqs:SendMessage'],'Resource':qarn},
      {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem'],'Resource':tarn}]}))
    try:logs.create_log_group(logGroupName='/aws/lambda/'+NAME)
    except logs.exceptions.ResourceAlreadyExistsException:pass
    logs.put_retention_policy(logGroupName='/aws/lambda/'+NAME,retentionInDays=7)
    archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for file in ['ai_chat.py','ai_evidence.py','ai-official-sources.json','system_reader_v2.py']:z.write(ROOT/file,file)
    env={'AI_TABLE':NAME}
    try:
        lam.get_function_configuration(FunctionName=NAME)
        lam.update_function_code(FunctionName=NAME,ZipFile=archive.getvalue());lam.get_waiter('function_updated_v2').wait(FunctionName=NAME)
        lam.update_function_configuration(FunctionName=NAME,Environment={'Variables':env},Timeout=120,MemorySize=1024,Role=role['Arn'])
        lam.get_waiter('function_updated_v2').wait(FunctionName=NAME)
    except lam.exceptions.ResourceNotFoundException:
        for attempt in range(8):
            try:
                lam.create_function(FunctionName=NAME,Runtime='python3.12',Handler='ai_chat.worker',Role=role['Arn'],Code={'ZipFile':archive.getvalue()},
                                      Environment={'Variables':env},Timeout=120,MemorySize=1024);break
            except lam.exceptions.InvalidParameterValueException:
                if attempt==7:raise
                time.sleep(3)
        lam.get_waiter('function_active_v2').wait(FunctionName=NAME)
    lam.put_function_concurrency(FunctionName=NAME,ReservedConcurrentExecutions=1)
    if not lam.list_event_source_mappings(EventSourceArn=qarn,FunctionName=NAME)['EventSourceMappings']:
        lam.create_event_source_mapping(EventSourceArn=qarn,FunctionName=NAME,BatchSize=1,Enabled=True)
    web=lam.get_function_configuration(FunctionName=WEB)
    web_env=web['Environment']['Variables'];web_env.update(AI_TABLE=NAME,AI_QUEUE_URL=qurl)
    lam.update_function_configuration(FunctionName=WEB,Environment={'Variables':web_env});lam.get_waiter('function_updated_v2').wait(FunctionName=WEB)
    receipt={'region':REGION,'model':'amazon.nova-lite-v1:0','worker':NAME,'table':NAME,'queue':qurl,
             'reserved_concurrency':1,'minimum_model_gap_ms':2100,'ip_hourly_limit':20,'global_daily_limit':200,
             'external_mode':'reviewed_official_urls_live_fetch','native_web_search':'NOT_ENABLED_NOT_LISTED_IN_COMPETITION_ALLOWLIST',
             'source_write_permissions':False,'raw_prompt_logs':False,'queue_retention_seconds':900,'answer_ttl_seconds':1800}
    (ROOT/'ai-deployment.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False))

if __name__=='__main__':main()
