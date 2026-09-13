from datetime import datetime,timezone,timedelta
from pathlib import Path
import argparse,json
from botocore.exceptions import ClientError
from aws_deploy import client,identity,ROOT,GROUP,FUNCTION,ACCOUNT,REGION,PREFIX,BUCKET
from etl.common import encoded,now
NAME='gate2-once-delivery-proof'
def begin():
    identity();daily=client('scheduler').get_schedule(Name='monthly-population-daily-0915',GroupName=GROUP)
    due=datetime.now(timezone.utc)+timedelta(minutes=2)
    target=daily['Target'];target['Input']='{"trigger":"gate2-scheduler-proof"}'
    args={'Name':NAME,'GroupName':GROUP,'ScheduleExpression':due.strftime('at(%Y-%m-%dT%H:%M:%S)'),'ScheduleExpressionTimezone':'UTC','FlexibleTimeWindow':{'Mode':'OFF'},'State':'ENABLED','Target':target,'ActionAfterCompletion':'DELETE','Description':'單次驗證排程實際觸发，完成後刪除此測試排程'}
    client('scheduler').create_schedule(**args)
    (ROOT/'scheduler-probe-request.json').write_bytes(encoded({'created_at':now(),'due':due.isoformat(),'name':NAME,'daily_unchanged':True}))
    print(json.dumps({'due':due.isoformat(),'name':NAME},ensure_ascii=False))
def check():
    request=json.loads((ROOT/'scheduler-probe-request.json').read_bytes());s3=client('s3');runs=[]
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=BUCKET,Prefix=PREFIX+'runs/monthly/',ExpectedBucketOwner=ACCOUNT):
        for obj in page.get('Contents',[]):
            if obj['LastModified']>=datetime.fromisoformat(request['due']):
                stream=s3.get_object(Bucket=BUCKET,Key=obj['Key'],ExpectedBucketOwner=ACCOUNT)['Body']
                try:record=json.loads(stream.read())
                finally:stream.close()
                runs.append({'key':obj['Key'],'status':record['status'],'checked_at':record['checked_at'],'rows':record.get('rows'),'latest_available':record.get('latest_available')})
    try:client('scheduler').get_schedule(Name=NAME,GroupName=GROUP);deleted=False
    except ClientError as e:
        if e.response['Error']['Code']!='ResourceNotFoundException':raise
        deleted=True
    result={'checked_at':now(),'status':'PASS' if deleted and runs and all(r['status'] in ['NO_CHANGE','PUBLISHED'] for r in runs) else 'WAITING','one_time_schedule_completed':deleted,'runs':runs,'basis':'單次排程送出後出現對應時間的 Lambda S3 執行紀錄；本期間未手動呼叫 Lambda'}
    (ROOT/'scheduler-probe-result.json').write_bytes(encoded(result));print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('phase',choices=['begin','check']);a=p.parse_args();globals()[a.phase]()
