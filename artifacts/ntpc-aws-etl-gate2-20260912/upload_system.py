"""只處理既有授權桶與精確前綴；先全量驗證新版，才可清除已遷移舊物件。"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from urllib.parse import quote
import argparse,hashlib,json,mimetypes,threading
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from boto3.s3.transfer import TransferConfig
from etl.common import encoded,now
from aws_deploy import BUCKET,ACCOUNT,REGION,SYSTEM,identity
ROOT=Path(__file__).resolve().parent;LOCAL=ROOT.parent/SYSTEM.rstrip('/')
OLD='releases/20260912-roa-v1/'
CONF=Config(region_name=REGION,connect_timeout=10,read_timeout=80,retries={'max_attempts':3},max_pool_connections=8)
s3=boto3.client('s3',config=CONF)
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(name,data):
    (ROOT/name).write_bytes(encoded(data))
def remote_hash(key):
    r=s3.get_object(Bucket=BUCKET,Key=key,ExpectedBucketOwner=ACCOUNT);h=hashlib.sha256();size=0
    try:
        for chunk in r['Body'].iter_chunks(chunk_size=1024*1024):h.update(chunk);size+=len(chunk)
    finally:r['Body'].close()
    return {'sha256':h.hexdigest(),'bytes':size,'etag':r['ETag'],'aes256':r.get('ServerSideEncryption')=='AES256'}
def publish_audit(name,data):
    body=encoded(data);key=SYSTEM+'14_歷史沿革與移轉紀錄/'+name
    s3.put_object(Bucket=BUCKET,Key=key,Body=body,ContentType='application/json; charset=utf-8',ServerSideEncryption='AES256',ExpectedBucketOwner=ACCOUNT)
    assert remote_hash(key)['sha256']==hashlib.sha256(body).hexdigest()
def objects(prefix):
    result={}
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=BUCKET,Prefix=prefix,ExpectedBucketOwner=ACCOUNT):
        result.update({r['Key']:r for r in page.get('Contents',[])})
    return result
def upload():
    identity();manifest=json.loads((LOCAL/'system-manifest.json').read_bytes())
    rows=manifest['files']+[{'path':'system-manifest.json','bytes':(LOCAL/'system-manifest.json').stat().st_size,'sha256':sha(LOCAL/'system-manifest.json')}]
    done=[];errors=[]
    def one(row):
        rel=row['path'];path=(LOCAL/rel).resolve()
        assert path.is_relative_to(LOCAL.resolve()) and path.suffix.lower()!='.zip'
        assert sha(path)==row['sha256'] and path.stat().st_size==row['bytes'],'本機檔案在打包後改動'
        key=SYSTEM+rel
        try:head=s3.head_object(Bucket=BUCKET,Key=key,ExpectedBucketOwner=ACCOUNT)
        except ClientError as e:
            if e.response['Error']['Code'] not in ['404','NoSuchKey']:raise
            head=None
        if head:
            existing=remote_hash(key)
            if existing['sha256']==row['sha256'] and existing['bytes']==row['bytes'] and existing['aes256']:
                return {**row,'key':key,'action':'existing-verified','verified':True}
            raise ValueError('新版路徑已有不同內容，停止覆寫：'+rel)
        mime=mimetypes.guess_type(rel)[0] or 'application/octet-stream'
        s3.upload_file(str(path),BUCKET,key,ExtraArgs={'ServerSideEncryption':'AES256','ExpectedBucketOwner':ACCOUNT,'ContentType':mime,'Metadata':{'sha256':row['sha256']}},Config=TransferConfig(multipart_threshold=16*1024*1024,multipart_chunksize=16*1024*1024,max_concurrency=2))
        actual=remote_hash(key)
        assert actual['sha256']==row['sha256'] and actual['bytes']==row['bytes'] and actual['aes256'],'上傳讀回不符'
        return {**row,'key':key,'action':'uploaded-verified','verified':True}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(one,r):r['path'] for r in rows}
        for future in as_completed(futures):
            try:done.append(future.result())
            except Exception as e:errors.append({'path':futures[future],'type':type(e).__name__,'message':str(e)})
            if (len(done)+len(errors))%100==0:print(json.dumps({'verified':len(done),'errors':len(errors),'expected':len(rows)}),flush=True)
    result={'checked_at':now(),'bucket':BUCKET,'prefix':SYSTEM,'status':'PASS' if not errors and len(done)==len(rows) else 'FAIL','expected':len(rows),'verified':len(done),'bytes':sum(r['bytes'] for r in done),'zips':0,'errors':errors,'files':done}
    save('system-upload-result.json',result)
    publish_audit('system-upload-result.json',result)
    assert result['status']=='PASS','新版未全數驗證，不切換、不刪除'
    pointer={'system_version':manifest['version'],'system_prefix':SYSTEM,'catalog_key':SYSTEM+'00_系統入口與版本/system-catalog.json','manifest_key':SYSTEM+'system-manifest.json','manifest_sha256':sha(LOCAL/'system-manifest.json'),'switched_at':now(),'status':'DATA_AND_SOURCE_PACKAGE_VERIFIED','website_status':'AWS 網站尚未上線；本入口為整合資料與原始碼'}
    body=encoded(pointer);entry='00_CURRENT_SYSTEM.json'
    try:r=s3.head_object(Bucket=BUCKET,Key=entry,ExpectedBucketOwner=ACCOUNT);condition={'IfMatch':r['ETag']}
    except ClientError as e:
        if e.response['Error']['Code'] not in ['404','NoSuchKey']:raise
        condition={'IfNoneMatch':'*'}
    s3.put_object(Bucket=BUCKET,Key=entry,Body=body,ServerSideEncryption='AES256',ContentType='application/json; charset=utf-8',ExpectedBucketOwner=ACCOUNT,**condition)
    assert remote_hash(entry)['sha256']==hashlib.sha256(body).hexdigest()
    save('system-cutover.json',pointer)
    print(json.dumps({k:v for k,v in result.items() if k not in ['files','errors']},ensure_ascii=False),flush=True)
def cleanup():
    identity();result=json.loads((ROOT/'system-upload-result.json').read_bytes());assert result['status']=='PASS'
    cutover=json.loads((ROOT/'system-cutover.json').read_bytes());assert cutover['system_prefix']==SYSTEM
    entry=json.loads(s3.get_object(Bucket=BUCKET,Key='00_CURRENT_SYSTEM.json',ExpectedBucketOwner=ACCOUNT)['Body'].read())
    assert entry==cutover,'系統入口已被其他執行更動'
    mapping=json.loads((LOCAL/'14_歷史沿革與移轉紀錄/migration-map.json').read_bytes())['files']
    targets={r['old_s3_key']:r for r in mapping}
    assert len(targets)==672 and all(k.startswith(OLD) and k!=OLD for k in targets)
    current=objects(OLD);unknown=set(current)-set(targets)
    assert not unknown,'發現未映射的舊物件，不清除'
    # 刪除前再驗證新、舊兩端內容；任何不同即整批停止。
    checks=[]
    def check(key):
        r=targets[key];old=remote_hash(key);new=remote_hash(SYSTEM+r['new_path'])
        assert old['sha256']==new['sha256']==r['sha256'] and old['bytes']==new['bytes']==r['bytes'],key
        assert current[key]['ETag']==old['etag'],'舊物件在檢查期間被修改'
        return {'key':key,'ETag':old['etag'],'sha256':r['sha256'],'new_key':SYSTEM+r['new_path']}
    with ThreadPoolExecutor(max_workers=4) as pool:checks=list(pool.map(check,current))
    plan={'checked_at':now(),'bucket':BUCKET,'only_prefix':OLD,'new_prefix':SYSTEM,'matched':len(checks),'unknown':list(unknown),'objects':checks,'recovery':'本機原始檔與00–14對照表保留；可依new_key逐檔複製回old key'}
    save('old-s3-cleanup-plan.json',plan);publish_audit('old-s3-cleanup-plan.json',plan)
    # 防止讀回後競態改寫；DeleteObjects 的 ETag 條件只刪仍是剛才版本的物件。
    deleted=[];errors=[]
    for start in range(0,len(checks),500):
        batch=checks[start:start+500]
        response=s3.delete_objects(Bucket=BUCKET,ExpectedBucketOwner=ACCOUNT,Delete={'Objects':[{'Key':r['key'],'ETag':r['ETag']} for r in batch],'Quiet':False})
        deleted.extend(x['Key'] for x in response.get('Deleted',[]));errors.extend(response.get('Errors',[]))
    remaining=list(objects(OLD))
    final={'finished_at':now(),'status':'PASS' if not errors and not remaining else 'PARTIAL','old_prefix':OLD,'deleted_count':len(deleted),'remaining_count':len(remaining),'errors':errors,'deleted':deleted,'remaining':remaining,'local_originals_preserved':True,'recovery_map':SYSTEM+'14_歷史沿革與移轉紀錄/migration-map.json'}
    save('old-s3-cleanup-result.json',final);publish_audit('old-s3-cleanup-result.json',final)
    print(json.dumps({k:v for k,v in final.items() if k not in ['deleted','remaining']},ensure_ascii=False),flush=True)
    assert final['status']=='PASS','部分舊檔未刪除，請依報告確認'
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['upload','cleanup']);args=parser.parse_args();globals()[args.phase]()
