"""驗證成功才把年度批次接入單一00–14入口；原始Gate2快照保持不變。"""
from pathlib import Path
from datetime import datetime,timezone
from concurrent.futures import ThreadPoolExecutor
import boto3,hashlib,json,shutil
ROOT=Path(__file__).resolve().parent;SYSTEM=ROOT.parent/'NTPC_Youth_System_V1_20260912'
ACCOUNT='000000000000';BUCKET='codex-workshop-theweeklyblend-s3-'+ACCOUNT;PREFIX=SYSTEM.name+'/'
s3=boto3.client('s3',region_name='us-west-2')
def encoded(value):return json.dumps(value,ensure_ascii=False,indent=2,default=str).encode()
def get(key):
    response=s3.get_object(Bucket=BUCKET,Key=key,ExpectedBucketOwner=ACCOUNT)
    try:return response['Body'].read(),response['ETag']
    finally:response['Body'].close()
def put(key,body,etag=None):
    try:old,_=get(key)
    except s3.exceptions.NoSuchKey:old=None
    if old==body:return
    if old is not None and etag is None:raise ValueError('不可覆寫舊版本：'+key)
    s3.put_object(Bucket=BUCKET,Key=key,Body=body,ExpectedBucketOwner=ACCOUNT,ServerSideEncryption='AES256',**({'IfMatch':etag} if etag else {'IfNoneMatch':'*'}))
    actual,_=get(key)
    if hashlib.sha256(actual).digest()!=hashlib.sha256(body).digest():raise ValueError('上傳讀回不符：'+key)
def main():
    proof=json.loads((ROOT/'aws-annual-verified.json').read_bytes())
    if proof['status']!='PASS' or proof['mode']!='REFRESH':raise ValueError('尚未完成雲端最新來源重取驗收')
    pointer=json.loads(get(PREFIX+'12_ETL與排程/runtime-annual/current/annual.json')[0])
    if pointer['run_id']!=proof['run_id']:raise ValueError('有效批次已變動，須重新驗證')
    manifest=json.loads((ROOT/'cloud-annual-manifest.json').read_bytes())
    previous,etag=get('00_CURRENT_SYSTEM.json');entry=json.loads(previous)
    catalog=json.loads((SYSTEM/'00_系統入口與版本/system-catalog.json').read_bytes())
    annual_pointer='12_ETL與排程/runtime-annual/current/annual.json'
    for name in sorted(manifest['files'],key=lambda n:n.startswith('lsf/')):
        if name.startswith(('long/','lsf/')):logical=name.split('/',1)[1]
        elif name.startswith(('charts/','rankings/')):logical=name
        else:continue
        catalog['datasets'][logical]={'mode':'validated-annual-batch','pointer':annual_pointer,'file':name}
    schedule_path=ROOT/'aws-annual-schedule.json';schedule=json.loads(schedule_path.read_bytes()) if schedule_path.exists() else {'status':'NOT_ENABLED'}
    catalog.update(system_version='NTPC-System-Gate3-20260912',annual_etl_status='AWS官方來源重取、模型、長表及排名整批查核通過；未知新年度與服務PDF尚待適配',annual_schedule=schedule,annual_verified_run=proof['run_id'],updated_at=datetime.now(timezone.utc).isoformat(),reader='system_reader_v2.py',website_status='AWS網站尚未部署；原網站程式保留於09')
    catalog_body=encoded(catalog);digest=hashlib.sha256(catalog_body).hexdigest()
    catalog_key=PREFIX+'00_系統入口與版本/catalogs/gate3-'+digest+'.json'
    (SYSTEM/'00_系統入口與版本/system-catalog-gate3.json').write_bytes(catalog_body)
    files={}
    def include(path,relative):
        dest=SYSTEM/relative;dest.parent.mkdir(parents=True,exist_ok=True)
        body=path.read_bytes()
        if dest.exists() and dest.read_bytes()!=body:dest=dest.with_name(hashlib.sha256(body).hexdigest()[:12]+'-'+dest.name)
        if not dest.exists():shutil.copy2(path,dest)
        files[dest.relative_to(SYSTEM).as_posix()]=body
    include(ROOT/'自動化架構與驗收.md','12_ETL與排程/Gate3/自動化架構與驗收.md')
    include(ROOT/'system_reader_v2.py','00_系統入口與版本/system_reader_v2.py')
    for name in ['prepare_bundle.py','deploy_annual.py','bootstrap_annual.py','schedule_annual.py','verify_cloud.py','cloud_progress.py','export_public_tls_roots.py','finalize_gate3.py']:
        include(ROOT/name,'13_AWS架構與部署/Gate3/'+name)
    for name in ['test_publication.py','test_system_reader.py','run_annual.py','system_reader_v2.py','rebuild-validation.json','runtime-validation.json','aws-annual-verified.json','aws-build-status.json','government-source-roots.json']:
        include(ROOT/name,'10_品質查核與測試/Gate3/'+name)
    if schedule_path.exists():include(schedule_path,'13_AWS架構與部署/Gate3/aws-annual-schedule.json')
    include(ROOT/'cloud-annual-manifest.json','10_品質查核與測試/Gate3/cloud-annual-manifest.json')
    for path in (ROOT/'cloud-checks').glob('*.json'):include(path,'10_品質查核與測試/Gate3/雲端/'+path.name)
    previous_key=PREFIX+'14_歷史沿革與移轉紀錄/Gate3/previous-current-system-'+hashlib.sha256(previous).hexdigest()[:12]+'.json'
    put(previous_key,previous)
    def send(item):relative,body=item;put(PREFIX+relative,body)
    with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(send,files.items()))
    put(catalog_key,catalog_body)
    addendum={'version':'Gate3','base_manifest':entry['manifest_key'],'base_manifest_sha256':entry['manifest_sha256'],'annual_publication':pointer,'engine_bundle':json.loads((ROOT/'aws-provision.json').read_bytes())['bundle_key'],'files':{name:{'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)} for name,body in files.items()},'catalog_key':catalog_key,'catalog_sha256':digest}
    body=encoded(addendum);addendum_key=PREFIX+'00_系統入口與版本/manifests/gate3-'+hashlib.sha256(body).hexdigest()+'.json';put(addendum_key,body)
    new={**entry,'system_version':catalog['system_version'],'catalog_key':catalog_key,'catalog_sha256':digest,'addendum_manifest_key':addendum_key,'addendum_manifest_sha256':hashlib.sha256(body).hexdigest(),'annual_pointer_key':PREFIX+annual_pointer,'annual_run_verified':proof['run_id'],'reader_key':PREFIX+'00_系統入口與版本/system_reader_v2.py','switched_at':datetime.now(timezone.utc).isoformat(),'status':'MONTHLY_AND_KNOWN_ANNUAL_ETL_VERIFIED'}
    put('00_CURRENT_SYSTEM.json',encoded(new),etag)
    result={'status':'PASS','current_entry':'s3://'+BUCKET+'/00_CURRENT_SYSTEM.json','catalog_key':catalog_key,'uploaded_addendum_files':len(files),'annual_run':proof['run_id'],'annual_schedule':schedule,'old_snapshot_preserved':True,'deleted_objects':0}
    (ROOT/'gate3-completion.json').write_bytes(encoded(result));print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
