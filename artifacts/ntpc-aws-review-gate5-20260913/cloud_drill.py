"""Test real S3 conditional writes and DynamoDB transactions in an isolated table.

Uses the exact deployed Engine and Port; no production pointers or active cases
are changed. Actor is explicitly a test actor, not a real Cognito sign-off.
"""
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
import boto3
import deploy as d
from review_core import Engine, ReviewError, encoded

def main():
    assert d.client('sts').get_caller_identity()['Account']==d.ACCOUNT
    ident=datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    table=d.NAME+'-drill-'+ident
    prefix=d.PREFIX+'verification/'+ident+'/'
    os.environ.update(DATA_BUCKET=d.BUCKET,DATA_ACCOUNT=d.ACCOUNT,REVIEW_PREFIX=prefix,CASE_TABLE=table)
    import aws_control
    aws_control.PIPES={'MONTHLY':prefix+'monthly/','ANNUAL':prefix+'annual/'}
    class TestPort(aws_control.Port):
        def enqueue(self, case): pass  # No notification from each test transition.
    ddb=d.client('dynamodb'); s3=d.client('s3')
    production={}
    for key in (d.MONTH+'current/monthly.json',d.ANNUAL+'current/annual.json'):
        production[key]=s3.head_object(Bucket=d.BUCKET,Key=key)['ETag']
    ddb.create_table(TableName=table,KeySchema=[{'AttributeName':'pk','KeyType':'HASH'}],AttributeDefinitions=[{'AttributeName':'pk','AttributeType':'S'}],BillingMode='PAY_PER_REQUEST',Tags=[{'Key':'Purpose','Value':'NTPC-isolated-verification'}])
    ddb.get_waiter('table_exists').wait(TableName=table,WaiterConfig={'Delay':2,'MaxAttempts':30})
    checks=[]
    def check(name, value):
        assert value,name
        checks.append(name);print('PASS '+name,flush=True)
    try:
        mp=aws_control.PIPES['MONTHLY']; old={'manifest_key':'TEST_OLD_VERSION'}
        d.put_immutable(s3,mp+'current/monthly.json',encoded(old))
        port=TestPort(); engine=Engine(port); before=port.current('MONTHLY')
        req={'pipeline':'MONTHLY','event_id':'DRILL-'+ident,'issue':{'rule':'DRILL_MISSING_DISTRICT','actual':'部署隔離測試：28區','expected':'29區','severity':'TEST','scope':'合成測試資料，非正式資料'}}
        case=engine.anomaly(req)
        check('AWS anomaly retains previous pointer',port.current('MONTHLY')==before)
        check('AWS duplicate event is idempotent',engine.anomaly(req)==case)
        def decision(c, action='APPROVE', **extra):
            return {'case_id':c['case_id'],'revision':c['revision'],'decision':action,'reason':'隔離部署測試，非管理者實際核可','manifest_sha256':(c.get('candidate') or {}).get('manifest_sha256'),**extra}
        try:engine.decision(decision(case),'TEST_ACTOR_NOT_COGNITO');blocked=False
        except ReviewError:blocked=True
        check('AWS cannot approve without complete retest',blocked)
        case=engine.decision(decision(case,'ACKNOWLEDGE'),'TEST_ACTOR_NOT_COGNITO')
        check('AWS acknowledgment cannot publish',port.current('MONTHLY')==before)
        data=encoded({'qa':{'status':'PASS'},'records':[{'synthetic':True,'district':'TEST_ONLY'}]})
        relative='releases/test-candidate/monthly-population.json'
        d.put_immutable(s3,mp+relative,data)
        manifest={'component':'monthly','release_id':'TEST-'+ident,'metadata':{'review_run_id':'TEST-'+ident},'files':{'monthly-population.json':{'key':relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}}}
        raw=encoded(manifest); key=mp+'releases/test-candidate/manifest.json'; d.put_immutable(s3,key,raw)
        candidate={'pipeline':'MONTHLY','run_id':'TEST-'+ident,'manifest_key':key,'manifest_sha256':hashlib.sha256(raw).hexdigest(),'baseline_etag':before['etag'],'pointer':{'manifest_key':key.removeprefix(mp),'release_id':'TEST-'+ident}}
        result=engine.stage(candidate);case=port.active('MONTHLY')
        check('AWS complete retest still requires review',result['status']=='REVIEW_REQUIRED' and port.current('MONTHLY')==before)
        for name,extra in [('stale revision',{'revision':case['revision']-1}),('wrong hash',{'manifest_sha256':'0'*64})]:
            try:engine.decision(decision(case,**extra),'TEST_ACTOR_NOT_COGNITO');blocked=False
            except ReviewError:blocked=True
            check('AWS rejects '+name,blocked)
        result=engine.decision(decision(case),'TEST_ACTOR_NOT_COGNITO')
        check('AWS isolated signed candidate commits with receipt',result['status']=='PUBLISHED' and port.current('MONTHLY')['pointer']==candidate['pointer'])
        check('AWS closed case clears active pointer',port.active('MONTHLY') is None)
        check('AWS delayed duplicate does not reopen',engine.anomaly(req)['status']=='PUBLISHED' and port.active('MONTHLY') is None)
        try:port.publish('MONTHLY',{'manifest_key':'SHOULD_NOT_PUBLISH'},before['etag']);blocked=False
        except Exception as e:blocked=getattr(e,'response',{}).get('Error',{}).get('Code')=='PreconditionFailed'
        check('AWS S3 rejects obsolete ETag conditional write',blocked)
        check('Production effective pointers untouched',all(s3.head_object(Bucket=d.BUCKET,Key=k)['ETag']==v for k,v in production.items()))
        result={'status':'ISOLATED_AWS_STORAGE_TESTS_PASS','at':datetime.now(timezone.utc).isoformat(),'checks':checks,'count':len(checks),'test_prefix':prefix,'temporary_table':table,'authentication_limit':'Test actor only. Real Cognito login and administrator sign-off remain a separate user acceptance test.'}
        (d.ROOT/'cloud-drill-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    finally:
        # Delete only the unique, explicitly created verification table.
        arn=ddb.describe_table(TableName=table)['Table']['TableArn']
        tags=ddb.list_tags_of_resource(ResourceArn=arn)['Tags']
        if table==d.NAME+'-drill-'+ident and {'Key':'Purpose','Value':'NTPC-isolated-verification'} in tags:
            ddb.delete_table(TableName=table)
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
