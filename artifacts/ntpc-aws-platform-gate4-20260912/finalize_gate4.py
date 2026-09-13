from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import shutil, json, hashlib, mimetypes, datetime
import boto3

ROOT=Path(__file__).resolve().parent
SYSTEM=ROOT.parent/'NTPC_Youth_System_V1_20260912'
BUCKET='ntpc-youth-data-000000000000'; PREFIX=SYSTEM.name+'/'
s3=boto3.client('s3',region_name='us-west-2')
receipt=json.loads((ROOT/'deployment.json').read_text(encoding='utf-8'))
verification=json.loads((ROOT/'cloud-verification.json').read_text(encoding='utf-8'))
assert verification['status']=='PASS' and len(receipt['allow_ipv4'])==6
ai_verification=json.loads((ROOT/'ai-cloud-verification.json').read_text(encoding='utf-8'))
assert ai_verification['status']=='PASS' and all(ai_verification['checks'].values())
shutil.copy2(ROOT.parent/'ntpc-aws-etl-gate3-20260912/system_reader_v2.py', ROOT/'system_reader_v2.py')

def copy_tree(source,target):
    shutil.copytree(source,target,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules','.git','.wrangler','.next','dist','dist-public','dist-internal','__pycache__','.env','.env.local','.env.production','.dev.vars','*.zip','*.ZIP','live-bootstrap.json'))

# Original application code remains separate from the AWS adaptation.
original=Path('D:/github/work/019fe05e-e1a3-71f2-840e-c026180d9474/NtpcYouthAI/dashboard')
original_target=SYSTEM/'09_網站與完整原始碼/WeeklyBlend原站副本_G6V5.32'
if not original_target.exists():copy_tree(original,original_target)
target=SYSTEM/'09_網站與完整原始碼/AWS_Gate4/完整原始碼'
copy_tree(ROOT,target)
doc=SYSTEM/'13_AWS架構與部署/Gate4';doc.mkdir(parents=True,exist_ok=True)
for name in ['README.md','deployment.json','source-parity.json','AI問答操作與架構_V1.md','ai-deployment.json','ROA四象限說明與地方依據_V1.1.md']:shutil.copy2(ROOT/name,doc/name)
qa=SYSTEM/'10_品質查核與測試/Gate4';qa.mkdir(parents=True,exist_ok=True)
for name in ['cloud-verification.json','source-parity.json','ai-cloud-verification.json','ai-local-verification.json','ai-ui-verification.json']:shutil.copy2(ROOT/name,qa/name)
for name in ['roa-local-verification.json','roa-ui-verification.json','roa-axis-ui-verification.json']:
    if (ROOT/name).exists():shutil.copy2(ROOT/name,qa/name)
if (ROOT/'map-verification.json').exists():shutil.copy2(ROOT/'map-verification.json',qa/'map-verification.json')

manifest_path=SYSTEM/'00_系統入口與版本/Gate4網站原始碼清冊.json'
previous=json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {'files':[]}
known={item['path']:item['sha256'] for item in previous['files']}
files=[]
for base in [target,original_target,doc,qa]:
    for p in base.rglob('*'):
        if p.is_file() and p.suffix.lower()!='.zip': files.append(p)
def upload(p):
    body=p.read_bytes();relative=p.relative_to(SYSTEM).as_posix();sha=hashlib.sha256(body).hexdigest()
    if known.get(relative)!=sha:
        s3.put_object(Bucket=BUCKET,Key=PREFIX+relative,Body=body,ServerSideEncryption='AES256',ContentType=mimetypes.guess_type(p.name)[0] or 'application/octet-stream',Metadata={'sha256':sha})
    return {'path':relative,'bytes':len(body),'sha256':sha}
with ThreadPoolExecutor(max_workers=6) as executor: entries=list(executor.map(upload,files))
manifest={'version':'AWS-V1.0','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':entries,'website':receipt['url'],'internal':receipt['internal_url'],'original_preserved':True,'zip_uploaded':0}
manifest_path=SYSTEM/'00_系統入口與版本/Gate4網站原始碼清冊.json'
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8');upload(manifest_path)

# Add website routing only; retain the validated Gate3 data catalog and pointers.
old=s3.get_object(Bucket=BUCKET,Key='00_CURRENT_SYSTEM.json'); entry=json.loads(old['Body'].read())
entry['website']={'public_url':receipt['url'],'internal_url':receipt['internal_url'],'ui_version':'AWS V1.0','authorization':'six public IPv4 allowlist; no OAuth/password','source_prefix':PREFIX+target.relative_to(SYSTEM).as_posix()+'/','manifest_key':PREFIX+manifest_path.relative_to(SYSTEM).as_posix()}
entry['website_status']='DEPLOYED_CORE_ROA_AND_BEDROCK_AI_VERIFIED'
entry['website']['ai']={'model':'amazon.nova-lite-v1:0','external_mode':'reviewed_official_urls_live_fetch','native_web_search':False,'verification_key':PREFIX+qa.relative_to(SYSTEM).as_posix()+'/ai-cloud-verification.json'}
s3.put_object(Bucket=BUCKET,Key='00_CURRENT_SYSTEM.json',Body=json.dumps(entry,ensure_ascii=False,indent=2).encode(),ContentType='application/json',ServerSideEncryption='AES256',IfMatch=old['ETag'])
result={'status':'PASS','source_and_document_files':len(entries),'manifest':str(manifest_path),'public_url':receipt['url'],'internal_url':receipt['internal_url'],'old_site_unchanged':True,'zip_uploaded':0}
(ROOT/'gate4-completion.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False))
