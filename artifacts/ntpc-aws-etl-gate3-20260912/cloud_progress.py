"""讀取本案最新 CodeBuild 狀態與最近的雲端日誌，不讀取憑證內容。"""
import json,boto3,os
from pathlib import Path
ROOT=Path(__file__).resolve().parent
state=json.loads((ROOT/'aws-build.json').read_text(encoding='utf-8'))
session=boto3.Session(region_name='us-west-2')
build=session.client('codebuild').batch_get_builds(ids=[state['id']])['builds'][0]
report={'id':build['id'],'status':build['buildStatus'],'phase':build.get('currentPhase'),'phases':build.get('phases'),'logs':build.get('logs')}
(ROOT/'aws-build-status.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ['phases','logs']}))
if report['logs'].get('streamName'):
    try:
        rows=session.client('logs').get_log_events(logGroupName=report['logs']['groupName'],logStreamName=report['logs']['streamName'],limit=int(os.environ.get('NTPC_LOG_LINES','25')),startFromHead=False)['events']
        for row in rows:print(row['message'][:1500])
    except session.client('logs').exceptions.ResourceNotFoundException:print('日誌建立中')
