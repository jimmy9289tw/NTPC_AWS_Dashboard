"""在本機與 CodeBuild 共用的年度抓取、重算、查核及整批發布入口。"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,csv,hashlib,json,os,shutil,subprocess,sys,time,uuid
from review_client import annual_stage, annual_failure, ReviewRequired
ROOT=Path(__file__).resolve().parent;WORK=ROOT/'work'
def command(*args):
    result=subprocess.run([sys.executable,'-X','utf8',*map(str,args)],cwd=ROOT,env={**os.environ,'PYTHONUTF8':'1','OPENBLAS_NUM_THREADS':'1'})
    if result.returncode:raise RuntimeError('步驟失敗：'+str(args[0]))
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def output_files():
    pub=WORK/'result/09_發布資料包';files={}
    for p in pub.glob('*.csv'):files['long/'+p.name]=p
    for p in (WORK/'data/lsf/published').glob('*.csv'):files['lsf/'+p.name]=p
    for name in ['g5-dashboard-data.json','resident-employment-industry.json','youth-industry-wage.json']:
        files['charts/'+name]=WORK/'dashboard/app/data'/name
    for p in (WORK/'dashboard/public/data/joint-education-marriage-districts').glob('*.json'):files['charts/joint-education-marriage-districts/'+p.name]=p
    files['charts/joint-education-marriage.json']=WORK/'dashboard/public/data/joint-education-marriage.json'
    for p in (WORK/'dashboard/data/policy-ranking').glob('*.csv'):files['rankings/'+p.name]=p
    for p in ROOT.glob('*validation.json'):files['checks/'+p.name]=p
    for p in ROOT.glob('fetch-*.json'):files['checks/'+p.name]=p
    if (ROOT/'input-bundle-manifest.json').exists():files['checks/input-bundle-manifest.json']=ROOT/'input-bundle-manifest.json'
    # 保存這次實際投入計算的來源；ZIP 僅保留下載回執，不上傳壓縮檔。
    for receipt_name in ['fetch-all.json','fetch-december.json']:
        receipt=ROOT/receipt_name
        if receipt.exists():
            for row in json.loads(receipt.read_bytes())['files']:
                p=WORK/row['target'];files['sources/normalized/'+row['target']]=p
    for p in (ROOT/'fetched').rglob('*'):
        if p.is_file() and p.suffix.lower()!='.zip':files['sources/original/'+p.relative_to(ROOT/'fetched').as_posix()]=p
    labor=WORK/'deliverables/NTPC_Labor_18-35_Sprague_PCLM_Pilot_V1.1_20260825'
    for folder in ['annual_110_114','half_year_114H2']:
        for p in (labor/folder).glob('*.csv'):files['models/labor/'+folder+'/'+p.name]=p
    for p in (WORK/'result/08_人工查核與異常處理/machine_qa').glob('*.json'):files['checks/'+p.name]=p
    return files
def publish(files,metadata):
    import boto3
    from botocore.exceptions import ClientError
    s3=boto3.client('s3',region_name='us-west-2');bucket=os.environ['DATA_BUCKET'];prefix=os.environ['ANNUAL_PREFIX'];account=os.environ['DATA_ACCOUNT']
    pointer_key=prefix+'current/annual.json'
    listed=s3.list_objects_v2(Bucket=bucket,Prefix=pointer_key,MaxKeys=1,ExpectedBucketOwner=account)
    if any(r['Key']==pointer_key for r in listed.get('Contents',[])):
        old=s3.get_object(Bucket=bucket,Key=pointer_key,ExpectedBucketOwner=account);old_etag=old['ETag'];old['Body'].close()
    else:old_etag=None
    run=metadata['run_id'];manifest={'run_id':run,'metadata':metadata,'files':{}}
    input_manifest=ROOT/'input-bundle-manifest.json'
    known={row['sha256']:row for row in json.loads(input_manifest.read_bytes())['files']} if input_manifest.exists() else {}
    for name,p in files.items():
        if p.suffix.lower()=='.zip':raise ValueError('禁止 ZIP 發布')
        key=prefix+'releases/'+run+'/'+name;digest=sha(p);body=p.read_bytes()
        if name.startswith('sources/') and digest in known:
            manifest['files'][name]={'key':known[digest]['key'],'sha256':digest,'bytes':len(body),'reused_verified_input':True}
            continue
        s3.put_object(Bucket=bucket,Key=key,Body=body,ServerSideEncryption='AES256',ExpectedBucketOwner=account,IfNoneMatch='*')
        stream=s3.get_object(Bucket=bucket,Key=key,ExpectedBucketOwner=account)['Body']
        try:actual=hashlib.sha256(stream.read()).hexdigest()
        finally:stream.close()
        if actual!=digest:raise ValueError('S3 讀回雜湊不符')
        manifest['files'][name]={'key':key,'sha256':digest,'bytes':len(body)}
    manifest_key=prefix+'releases/'+run+'/manifest.json';body=json.dumps(manifest,ensure_ascii=False,separators=(',',':')).encode()
    s3.put_object(Bucket=bucket,Key=manifest_key,Body=body,ServerSideEncryption='AES256',ExpectedBucketOwner=account,IfNoneMatch='*')
    stream=s3.get_object(Bucket=bucket,Key=manifest_key,ExpectedBucketOwner=account)['Body']
    try:
        if hashlib.sha256(stream.read()).hexdigest()!=hashlib.sha256(body).hexdigest():raise ValueError('發布清冊讀回雜湊不符')
    finally:stream.close()
    pointer={'manifest_key':manifest_key,'manifest_sha256':hashlib.sha256(body).hexdigest(),'run_id':run,'published_at':datetime.now(timezone.utc).isoformat()}
    annual_stage(s3,bucket,account,prefix,manifest_key,body,pointer,metadata,old_etag)
    return pointer
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--refresh',action='store_true');parser.add_argument('--publish',action='store_true');args=parser.parse_args()
    start=time.monotonic();report={'run_id':datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8],'started_at':datetime.now(timezone.utc).isoformat(),'mode':'REFRESH' if args.refresh else 'REPRODUCE','status':'RUNNING','zip_upload':False,'input_bundle_key':os.environ.get('BUNDLE_KEY'),'input_bundle_sha256':os.environ.get('BUNDLE_SHA256')}
    try:
        if args.refresh:
            command(ROOT/'fetch_official.py');command(ROOT/'fetch_population_annual.py')
        # 原始交叉表必須由同次官方教育列生成，不沿用先前的模型輸出。
        command(ROOT/'build_joint_input.py')
        for stage in ['labor','core','external','dashboard','industry','joint','wage-industry','rankings']:command(ROOT/'rebuild.py','--stage',stage)
        command(WORK/'scripts/build_g5_normalized_lineage.py','--package',WORK/'result')
        # LSF 既有官方期間重建；換年報或租金期別須先完成新版來源契約。
        (WORK/'data/published').mkdir(parents=True,exist_ok=True)
        for p in (WORK/'result/09_發布資料包').glob('*.csv'):shutil.copy2(p,WORK/'data/published'/p.name)
        command(WORK/'scripts/lsf_build.py');command(WORK/'scripts/lsf_validate.py')
        command(ROOT/'validate_runtime.py')
        report.update(status='PASS',seconds=round(time.monotonic()-start,2),supported_years=[110,111,112,113,114],wage_years=[110,111,112,113],service_refresh='已驗證來源快照；新版 PDF／據點人工整理欄位不自動推估',lsf_refresh='已驗證112–114年及11503租金快照；未宣稱新版自動解析')
        files=output_files();report['files']={k:{'sha256':sha(p),'bytes':p.stat().st_size} for k,p in files.items()}
        if args.publish:report['publication']=publish(files,report)
    except ReviewRequired as e:report.update(status='REVIEW_REQUIRED',review=json.loads(str(e)),seconds=round(time.monotonic()-start,2))
    except Exception as e:report.update(status='FAILED_OLD_RELEASE_PRESERVED',error=type(e).__name__+': '+str(e),seconds=round(time.monotonic()-start,2))
    (ROOT/'annual-run.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    if os.environ.get('DATA_BUCKET'):
        import boto3
        boto3.client('s3',region_name='us-west-2').put_object(Bucket=os.environ['DATA_BUCKET'],Key=os.environ['ANNUAL_PREFIX']+'runs/'+report['run_id']+'.json',Body=json.dumps(report,ensure_ascii=False).encode(),ServerSideEncryption='AES256',ExpectedBucketOwner=os.environ['DATA_ACCOUNT'])
    if os.environ.get('DATA_BUCKET'):annual_failure(report)
    print(json.dumps({k:v for k,v in report.items() if k!='files'},ensure_ascii=False))
    return 0 if report['status'] in ('PASS','REVIEW_REQUIRED') else 1
if __name__=='__main__':raise SystemExit(main())
