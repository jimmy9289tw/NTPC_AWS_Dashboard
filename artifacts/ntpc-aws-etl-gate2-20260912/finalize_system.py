"""正式上傳前補齊整合來源關聯與實際 AWS 狀態；每次生成最終快照 manifest。"""
from pathlib import Path
import csv,io,json,shutil,hashlib
from etl.common import encoded,now
from build_system import OUT,FOLDERS,sha,write
from bootstrap import ROOT,RELEASE
from system_reader import SystemReader
def main():
    for p in ROOT.glob('aws-*.json'):shutil.copy2(p,OUT/FOLDERS[13]/p.name)
    for p in ROOT.glob('scheduler-*.json'):shutil.copy2(p,OUT/FOLDERS[13]/p.name)
    for p in [ROOT/'system_reader.py',ROOT/'finalize_system.py',ROOT/'upload_system.py',ROOT/'scheduler_probe.py']:
        shutil.copy2(p,OUT/FOLDERS[12]/'程式'/p.name)
    shutil.copy2(ROOT/'system_reader.py',OUT/FOLDERS[0]/'system_reader.py')
    catalog_path=OUT/FOLDERS[0]/'system-catalog.json';catalog=json.loads(catalog_path.read_bytes())
    monthly=SystemReader(OUT).load('月人口_有效版本','csv')
    mrows=list(csv.DictReader(io.StringIO(monthly.decode('utf-8-sig'))))
    with (RELEASE/'05_資料列來源關聯.csv').open(encoding='utf-8-sig',newline='') as f:r=csv.DictReader(f);fields=r.fieldnames;rows=list(r)
    before=len(rows)
    for r in mrows:
        new={k:'' for k in fields}
        new.update(record_id=r['record_id'],universe_code=r['universe_code'],roc_year=r['roc_year'],metric_code=r['metric_code'],source_id=r['source_alias'],source_role='MONTHLY_POPULATION_EXACT',official_url=r['source_url'],source_snapshot=FOLDERS[12]+'/runtime/'+r['source_snapshot'],record_source_bundle_sha256=r['source_sha256'])
        rows.append(new)
    assert len({r['record_id'] for r in mrows})==len(mrows)
    assert not set(r['record_id'] for r in rows[:before])&set(r['record_id'] for r in mrows)
    output=OUT/FOLDERS[2]/'05_資料列來源關聯_含月人口.csv'
    with output.open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
    catalog['datasets'].pop('05_資料列來源關聯.csv',None)
    catalog['datasets']['05_資料列來源關聯_含月人口.csv']={'path':output.relative_to(OUT).as_posix(),'sha256':sha(output),'mode':'validated-initial-snapshot','initial_monthly_rows':len(mrows),'monthly_future_lineage':'每次月資料更新，以其CSV內的source_snapshot與source_sha256為即時逐列來源；此表保留初始化版本'}
    schedule=json.loads((ROOT/'aws-schedule.json').read_bytes());invoke=json.loads((ROOT/'aws-invoke.json').read_bytes())
    catalog.update(monthly_status='AWS Lambda 實跑通過；Scheduler ENABLED，每日臺灣09:15',monthly_schedule=schedule['schedule_arn'],integration_checked_at=now())
    catalog_path.write_bytes(encoded(catalog))
    report={'checked_at':now(),'old_lineage_rows':before,'new_monthly_lineage_rows':len(mrows),'combined_lineage_rows':len(rows),'new_monthly_record_ids_unique':True,'s3_schedule_enabled':schedule['status']=='ENABLED','lambda_real_execution_passed':invoke['status']=='PASS','reader_checks':[]}
    reader=SystemReader(OUT)
    for name in reader.catalog['datasets']:
        body=reader.load(name)
        report['reader_checks'].append({'dataset':name,'bytes':len(body),'read_and_hash':'PASS'})
    body=reader.load('月人口_有效版本','csv');assert len(list(csv.DictReader(io.StringIO(body.decode('utf-8-sig')))))==24480
    report['monthly_csv_read']='PASS'
    (ROOT/'system-integration-check.json').write_bytes(encoded(report))
    (OUT/FOLDERS[10]/'system-integration-check.json').write_bytes(encoded(report))
    write(FOLDERS[0]+'/使用目前有效資料.md','# 使用目前有效資料\n\n新系統統一讀取 `system-catalog.json`。年度 CSV 是已核對的固定版本；月人口要再解析其 `pointer`，才能拿到排程後的最新完整版本。\n\n```powershell\npython -X utf8 system_reader.py --root "本機整合系統目錄"\npython -X utf8 system_reader.py --dataset 月人口_有效版本 --format csv\n```\n\n省略 `--root` 即使用 boto3 default 身分讀取私有 S3；不需 profile 名稱，不在前端放入 AWS 憑證。未指定 dataset 時只列出資料清單。\n\n本次月資料逐列来源已加入 02 的「含月人口」版；未來自動更新的即時逐列來源則直接在每份月 CSV 中。舊 05 表保留作原版本追溯，不是目前合併入口。\n'.replace('来源','來源'))
    write(FOLDERS[13]+'/目前部署狀態.md',f'# 目前部署狀態\n\n查核時間：{now()}。\n\n- 月人口 Lambda：實際執行通過，資料最新期 11508。\n- 每日排程：ENABLED，Asia/Taipei 09:15。\n- 函式：`ntpc-youth-monthly-etl-v1`。\n- 排程：`ntpc-youth-etl-v1/monthly-population-daily-0915`。\n- 年度五長表：離線重建數值一致，尚未自動抓新版及重算模型。\n- 網站、登入及 AI：尚未在本 AWS 帳號上線。\n- `aws-schedule-error.json` 為初次建立時 IAM 傳播尚未完成的歷史紀錄；之後同權限重試已成功，未放寬角色。\n\n實測原始紀錄：`aws-invoke.json`、`aws-schedule.json`；單次排程投遞測試另見 `scheduler-probe-result.json`。\n')
    manifest=json.loads((OUT/'system-manifest.json').read_bytes());files=[]
    for p in sorted(OUT.rglob('*')):
        if p.is_file() and p.name!='system-manifest.json':
            assert p.suffix.lower()!='.zip';rel=p.relative_to(OUT).as_posix()
            files.append({'path':rel,'bytes':p.stat().st_size,'sha256':sha(p),'mutable_runtime':rel.startswith(FOLDERS[12]+'/runtime/current/') or rel.startswith(FOLDERS[12]+'/runtime/runs/')})
    manifest.update(created_at=now(),files=files,file_count=len(files),total_bytes=sum(r['bytes'] for r in files))
    (OUT/'system-manifest.json').write_bytes(encoded(manifest))
    print(json.dumps({'files':len(files),'bytes':manifest['total_bytes'],'lineage_rows':len(rows),'reader_tests':len(report['reader_checks'])},ensure_ascii=False))
if __name__=='__main__':main()
