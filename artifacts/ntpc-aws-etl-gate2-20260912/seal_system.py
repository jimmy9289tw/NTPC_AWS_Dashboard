"""上傳與清理完成後的即時驗收紀錄；不改寫已驗證的資料快照。"""
import json,hashlib,csv,io
from pathlib import Path
from aws_deploy import client,BUCKET,SYSTEM,PREFIX,ROOT,GROUP,identity
from etl.common import encoded,now
from system_reader import SystemReader
def main():
    identity();s3=client('s3');local=ROOT.parent/SYSTEM.rstrip('/')
    upload=json.loads((ROOT/'system-upload-result.json').read_bytes());cleanup=json.loads((ROOT/'old-s3-cleanup-result.json').read_bytes())
    assert upload['status']==cleanup['status']=='PASS'
    prefixes=[]
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=BUCKET,Prefix=SYSTEM,Delimiter='/',ExpectedBucketOwner='000000000000'):
        prefixes.extend(p['Prefix'].removeprefix(SYSTEM).rstrip('/') for p in page.get('CommonPrefixes',[]))
    assert [p[:2] for p in sorted(prefixes)]==[f'{i:02}' for i in range(15)]
    assert not s3.list_objects_v2(Bucket=BUCKET,Prefix='releases/20260912-roa-v1/',MaxKeys=1).get('Contents')
    current=client('scheduler').get_schedule(Name='monthly-population-daily-0915',GroupName=GROUP)
    reader=SystemReader();body=reader.load('月人口_有效版本');monthly=json.loads(body)
    assert monthly['meta']['sourcePeriodMax']=='11508' and len(monthly['records'])==24480
    probe=json.loads((ROOT/'scheduler-probe-result.json').read_bytes());assert probe['status']=='PASS'
    source=ROOT.parent/'ntpc-aws-gate1-20260912/07_ETL逐表盤點.csv'
    with source.open(encoding='utf-8-sig',newline='') as f:previous=list(csv.DictReader(f))
    coverage=[]
    for r in previous:
        name=r['資料項目'];is_monthly=name=='月人口'
        rebuilt=name in ['戶籍人口母體','民間人口與勞動市場母體','受僱員工薪資母體','政策服務與曝光','生活條件與公共服務']
        result='固定快照重建數值一致' if rebuilt else '保留既有快照；全鏈自動重算尚未接通'
        if name in ['民間人口與勞動市場母體','受僱員工薪資母體']:result+='；沿用封存模型／權重結果，非新版來源完整重算'
        if is_monthly:result='官方11001–11508月資料；本機、Lambda及Scheduler實測通過'
        coverage.append({'資料項目':name,'原發布檔案':r['發布檔案'],'目前驗證':result,'排程狀態':'已啟用，每日臺灣09:15' if is_monthly else '尚未啟用自動刷新','錯誤處理':'失敗保留上次成功版本' if is_monthly else '維持已驗證快照，不宣稱已更新','查核時間':now()})
    text=io.StringIO(newline='');w=csv.DictWriter(text,fieldnames=list(coverage[0]));w.writeheader();w.writerows(coverage)
    data=('\ufeff'+text.getvalue()).encode('utf-8');rel='12_ETL與排程/ETL目前覆蓋清單.csv';(local/rel).write_bytes(data)
    s3.put_object(Bucket=BUCKET,Key=SYSTEM+rel,Body=data,ServerSideEncryption='AES256',ContentType='text/csv; charset=utf-8')
    for name in ['system-upload-result.json','old-s3-cleanup-plan.json','old-s3-cleanup-result.json','system-cutover.json','scheduler-probe-result.json']:
        source=ROOT/name;destination=local/'14_歷史沿革與移轉紀錄/即時驗收紀錄'/name;destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(source.read_bytes())
        key=SYSTEM+destination.relative_to(local).as_posix();data=source.read_bytes()
        s3.put_object(Bucket=BUCKET,Key=key,Body=data,ServerSideEncryption='AES256',ContentType='application/json; charset=utf-8')
        stream=s3.get_object(Bucket=BUCKET,Key=key)['Body']
        try:assert hashlib.sha256(stream.read()).hexdigest()==hashlib.sha256(data).hexdigest()
        finally:stream.close()
    for name in ['TASK.md','seal_system.py']:
        data=(ROOT/name).read_bytes();relative='14_歷史沿革與移轉紀錄/即時驗收紀錄/'+name
        (local/relative).write_bytes(data)
        s3.put_object(Bucket=BUCKET,Key=SYSTEM+relative,Body=data,ServerSideEncryption='AES256',ContentType='text/plain; charset=utf-8')
    state={'checked_at':now(),'status':'PACKAGE_CUTOVER_AND_MONTHLY_ETL_VERIFIED','folders':sorted(prefixes),'uploaded_and_hash_verified':upload['verified'],'uploaded_bytes':upload['bytes'],'old_objects_deleted':cleanup['deleted_count'],'old_prefix_remaining':cleanup['remaining_count'],'zips_uploaded':0,'monthly_rows':len(monthly['records']),'monthly_latest_period':monthly['meta']['sourcePeriodMax'],'schedule_state':current['State'],'schedule_timezone':current['ScheduleExpressionTimezone'],'schedule_local_time':'09:15','scheduler_delivery_test':'PASS','private_s3':all(s3.get_public_access_block(Bucket=BUCKET)['PublicAccessBlockConfiguration'].values()),'local_originals_preserved':True,'not_complete':['年度來源新版自動擷取與模型重算','教育婚姻交叉、青年行業薪資與排名連動自動發布','AWS 網站、登入授權、受控下載與 AI 問答整合'],'operational_evidence_note':'本檔與即時驗收紀錄為發布後追加的操作證據，不改寫 system-manifest 列出的初始資料快照。'}
    data=encoded(state);(ROOT/'final-system-status.json').write_bytes(data)
    relative='14_歷史沿革與移轉紀錄/即時驗收紀錄/final-system-status.json';(local/relative).write_bytes(data)
    s3.put_object(Bucket=BUCKET,Key=SYSTEM+relative,Body=data,ContentType='application/json; charset=utf-8',ServerSideEncryption='AES256')
    print(json.dumps(state,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
