"""逐項核對有效年度清冊與必要輸出；只讀AWS，另存驗收回執。"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import boto3,hashlib,json
ROOT=Path(__file__).resolve().parent
BUCKET='ntpc-youth-data-000000000000';ACCOUNT='000000000000'
PREFIX='NTPC_Youth_System_V1_20260912/';RUNTIME=PREFIX+'12_ETL與排程/runtime-annual/'
s=boto3.Session(region_name='us-west-2');s3=s.client('s3')
def get(key):
    stream=s3.get_object(Bucket=BUCKET,Key=key,ExpectedBucketOwner=ACCOUNT)['Body']
    try:return stream.read()
    finally:stream.close()
def main():
    build_id=json.loads((ROOT/'aws-build.json').read_bytes())['id']
    build=s.client('codebuild').batch_get_builds(ids=[build_id])['builds'][0]
    if build['buildStatus']!='SUCCEEDED':raise ValueError('雲端批次尚未成功')
    pointer=json.loads(get(RUNTIME+'current/annual.json'));raw=get(pointer['manifest_key'])
    if hashlib.sha256(raw).hexdigest()!=pointer['manifest_sha256']:raise ValueError('年度清冊不一致')
    manifest=json.loads(raw);metadata=manifest['metadata']
    if metadata['status']!='PASS':raise ValueError('查核狀態未通過')
    if metadata.get('input_bundle_sha256')!=next(v['value'] for v in build['environment']['environmentVariables'] if v['name']=='BUNDLE_SHA256'):raise ValueError('有效資料不屬於本次程式清冊')
    entries=[(name,item) for name,item in manifest['files'].items() if not name.startswith('sources/')]
    def verify(pair):
        name,item=pair;body=get(item['key'])
        if hashlib.sha256(body).hexdigest()!=item['sha256'] or len(body)!=item['bytes']:raise ValueError('輸出不同：'+name)
        if name.startswith('checks/'):
            dest=ROOT/'cloud-checks'/name.removeprefix('checks/');dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)
        return name
    with ThreadPoolExecutor(max_workers=4) as pool:verified=list(pool.map(verify,entries))
    (ROOT/'cloud-annual-pointer.json').write_text(json.dumps(pointer,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'cloud-annual-manifest.json').write_bytes(raw)
    result={'status':'PASS','build_id':build_id,'run_id':metadata['run_id'],'mode':metadata['mode'],'output_files_reverified':len(verified),'source_files_in_manifest':len(manifest['files'])-len(verified),'input_bundle_sha256':metadata.get('input_bundle_sha256'),'publication':pointer}
    (ROOT/'aws-annual-verified.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
