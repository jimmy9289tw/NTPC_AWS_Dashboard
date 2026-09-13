"""實跑與讀回通過後，建立每週一次的年度來源重取排程。"""
from pathlib import Path
import boto3,json
ROOT=Path(__file__).resolve().parent
ACCOUNT='000000000000';REGION='us-west-2';PROJECT='ntpc-youth-annual-etl-v1'
GROUP='ntpc-youth-etl-v1';NAME='annual-sources-weekly-sun-0945';ROLE=PROJECT+'-scheduler-role'
def main():
    proof=json.loads((ROOT/'aws-annual-verified.json').read_bytes())
    if proof['status']!='PASS' or proof['mode']!='REFRESH':raise ValueError('必須先通過雲端官方重取與發布驗證')
    s=boto3.Session(region_name=REGION)
    if s.client('sts').get_caller_identity()['Account']!=ACCOUNT:raise ValueError('AWS帳號不符')
    iam=s.client('iam');scheduler=s.client('scheduler')
    trust={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'scheduler.amazonaws.com'},'Action':'sts:AssumeRole','Condition':{'StringEquals':{'aws:SourceAccount':ACCOUNT},'ArnEquals':{'aws:SourceArn':f'arn:aws:scheduler:{REGION}:{ACCOUNT}:schedule-group/{GROUP}'}}}]}
    try:iam.create_role(RoleName=ROLE,AssumeRolePolicyDocument=json.dumps(trust),Tags=[{'Key':'ManagedBy','Value':'Codex-Gate3'},{'Key':'Project','Value':'NTPC-Youth-System'}])
    except iam.exceptions.EntityAlreadyExistsException:
        role=iam.get_role(RoleName=ROLE)['Role']
        if not any(t['Key']=='ManagedBy' and t['Value']=='Codex-Gate3' for t in role.get('Tags',[])):raise ValueError('不可覆寫其他系統角色')
    iam.put_role_policy(RoleName=ROLE,PolicyName='StartNTPCAnnualOnly',PolicyDocument=json.dumps({'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'codebuild:StartBuild','Resource':f'arn:aws:codebuild:{REGION}:{ACCOUNT}:project/{PROJECT}'}]}))
    config={'Name':NAME,'GroupName':GROUP,'Description':'每週重新取得已登錄年度政府資料，模型與長表查核通過才發布','ScheduleExpression':'cron(45 9 ? * SUN *)','ScheduleExpressionTimezone':'Asia/Taipei','State':'ENABLED','FlexibleTimeWindow':{'Mode':'OFF'},'Target':{'Arn':'arn:aws:scheduler:::aws-sdk:codebuild:startBuild','RoleArn':f'arn:aws:iam::{ACCOUNT}:role/{ROLE}','Input':json.dumps({'ProjectName':PROJECT,'EnvironmentVariablesOverride':[{'Name':'REFRESH_OFFICIAL','Value':'true','Type':'PLAINTEXT'}]}),'RetryPolicy':{'MaximumEventAgeInSeconds':3600,'MaximumRetryAttempts':1}}}
    try:scheduler.get_schedule(Name=NAME,GroupName=GROUP);scheduler.update_schedule(**config)
    except scheduler.exceptions.ResourceNotFoundException:scheduler.create_schedule(**config)
    actual=scheduler.get_schedule(Name=NAME,GroupName=GROUP)
    for key in ['State','ScheduleExpression','ScheduleExpressionTimezone','Target']:
        if actual[key]!=config[key]:raise ValueError('排程讀回不符：'+key)
    result={'status':'ENABLED_CONFIG_VERIFIED','arn':actual['Arn'],'schedule':'每週日09:45，Asia/Taipei','manual_refresh_build':proof['build_id'],'scheduled_delivery':'尚未到首次固定排程；不得宣稱已由排程實際觸發','scope':'已登錄110–114年來源，薪資110–113年；不含未知新年度自動適配','role':ROLE}
    (ROOT/'aws-annual-schedule.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
