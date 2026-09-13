"""CodeBuild 只以 boto3 取得已鎖定雜湊的本案程式與資料。"""
from pathlib import Path,PurePosixPath
from concurrent.futures import ThreadPoolExecutor
import boto3,hashlib,json,os,subprocess,sys
ROOT=Path('/tmp/ntpc-annual');ROOT.mkdir(exist_ok=True)
s3=boto3.client('s3',region_name='us-west-2');bucket=os.environ['DATA_BUCKET'];account=os.environ['DATA_ACCOUNT']
def body(key):
    stream=s3.get_object(Bucket=bucket,Key=key,ExpectedBucketOwner=account)['Body']
    try:return stream.read()
    finally:stream.close()
manifest=body(os.environ['BUNDLE_KEY'])
if hashlib.sha256(manifest).hexdigest()!=os.environ['BUNDLE_SHA256']:raise ValueError('執行清冊雜湊不符')
(ROOT/'input-bundle-manifest.json').write_bytes(manifest)
def fetch(item):
    relative=PurePosixPath(item['target']);target=(ROOT/item['target']).resolve()
    if relative.is_absolute() or '..' in relative.parts or not target.is_relative_to(ROOT) or target.suffix.lower()=='.zip':raise ValueError('不允許的執行檔路徑')
    content=body(item['key'])
    if hashlib.sha256(content).hexdigest()!=item['sha256']:raise ValueError('來源雜湊不符：'+item['target'])
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(content)
with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(fetch,json.loads(manifest)['files']))
args=[sys.executable,'-X','utf8',str(ROOT/'run_annual.py'),'--publish']
if os.environ.get('REFRESH_OFFICIAL')=='true':args.append('--refresh')
raise SystemExit(subprocess.run(args,cwd=ROOT).returncode)
