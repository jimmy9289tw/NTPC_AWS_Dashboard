from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlsplit, quote
import hashlib, json, os, time, uuid

HOSTS={'www.ris.gov.tw','data.gov.tw','www.stat.gov.tw','ws.dgbas.gov.tw','data.ntpc.gov.tw','www.youth.ntpc.gov.tw','www.ca.ntpc.gov.tw','moisagis.moi.gov.tw'}
class DataError(ValueError):pass
class Conflict(RuntimeError):pass
class OfficialRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        parsed=urlsplit(newurl)
        if parsed.scheme!='https' or parsed.hostname not in HOSTS or parsed.username or parsed.password:raise DataError('重新導向不是允許的官方 HTTPS 來源')
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def now():return datetime.now(timezone.utc).isoformat()
def encoded(obj):return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')
def digest(data):return hashlib.sha256(data).hexdigest()
def safe_key(key):
    p=PurePosixPath(key)
    if not key or p.is_absolute() or '..' in p.parts or '\\' in key or ':' in key:raise DataError('不允許的儲存路徑')
    if key.lower().endswith('.zip'):raise DataError('ZIP 不得成為發布物件')
    return key

def request(url):
    parsed=urlsplit(url)
    if parsed.scheme!='https' or parsed.hostname not in HOSTS or parsed.username or parsed.password:raise DataError('非允許的官方來源')
    req=Request(quote(url,safe=':/?&=%'),headers={'User-Agent':'NTPC-Youth-ETL/1.0'})
    last=None
    for attempt in range(2):
        try:
            with build_opener(OfficialRedirect()).open(req,timeout=40) as response:
                if urlsplit(response.url).hostname not in HOSTS:raise DataError('來源重新導向至未允許網域')
                data=response.read(32*1024*1024+1)
                if len(data)>32*1024*1024:raise DataError('來源超過單次下載限制')
                if not data:raise DataError('來源回傳空內容')
                return data,{'url':url,'retrieved_at':now(),'sha256':digest(data),'bytes':len(data),'http_status':response.status}
        except DataError:raise
        except Exception as error:
            last=error
            if attempt==0:time.sleep(1)
    raise RuntimeError(f'來源擷取失敗：{parsed.hostname}；{type(last).__name__}') from last

class LocalStore:
    def __init__(self,root):self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True)
    def path(self,key):
        p=(self.root/safe_key(key)).resolve()
        if not p.is_relative_to(self.root):raise DataError('路徑超出儲存根目錄')
        return p
    def get(self,key):
        p=self.path(key)
        if not p.exists():return None,None
        data=p.read_bytes();return data,digest(data)
    def put(self,key,data,expected=None,create=False):
        p=self.path(key);p.parent.mkdir(parents=True,exist_ok=True)
        if create:
            try:
                with p.open('xb') as f:f.write(data)
            except FileExistsError:
                if p.read_bytes()!=data:raise Conflict('不可覆寫既有版本物件')
            return
        lock=p.with_name(p.name+'.lock')
        try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
        except FileExistsError:raise Conflict('已有發布者執行中')
        os.close(fd)
        temp=p.with_name(p.name+'.'+uuid.uuid4().hex+'.tmp')
        try:
            current=self.get(key)[1]
            if current!=expected:raise Conflict('有效版本已由其他執行更新')
            temp.write_bytes(data);os.replace(temp,p)
        finally:
            if temp.exists():temp.unlink()
            lock.unlink()

class S3Store:
    def __init__(self,bucket,prefix='etl-v1/',account='000000000000'):
        import boto3
        from botocore.config import Config
        self.client=boto3.client('s3',region_name='us-west-2',config=Config(connect_timeout=10,read_timeout=45,retries={'max_attempts':2}))
        self.bucket=bucket;self.prefix=prefix;self.account=account
    def get(self,key):
        from botocore.exceptions import ClientError
        try:r=self.client.get_object(Bucket=self.bucket,Key=self.prefix+safe_key(key),ExpectedBucketOwner=self.account)
        except ClientError as e:
            if e.response['Error']['Code'] in ('NoSuchKey','404'):return None,None
            raise
        try:return r['Body'].read(),r['ETag']
        finally:r['Body'].close()
    def put(self,key,data,expected=None,create=False):
        from botocore.exceptions import ClientError
        args={'Bucket':self.bucket,'Key':self.prefix+safe_key(key),'Body':data,'ServerSideEncryption':'AES256','ExpectedBucketOwner':self.account,'ContentType':'text/csv; charset=utf-8' if key.endswith('.csv') else 'application/json; charset=utf-8'}
        if create or expected is None:args['IfNoneMatch']='*'
        else:args['IfMatch']=expected
        try:self.client.put_object(**args)
        except ClientError as e:
            if e.response['Error']['Code'] in ('PreconditionFailed','ConditionalRequestConflict'):
                if create and self.get(key)[0]==data:return
                raise Conflict('S3 有效版本已更動或版本物件已存在') from e
            raise

def publish(store,component,payloads,metadata,prior_etag):
    content_hash=digest(encoded({name:digest(body) for name,body in sorted(payloads.items())}))
    release_id=content_hash[:24]
    manifest={'component':component,'release_id':release_id,'files':{},'metadata':metadata}
    for name,body in sorted(payloads.items()):
        key=f'releases/{component}/{release_id}/{safe_key(name)}'
        store.put(key,body,create=True)
        if store.get(key)[0]!=body:raise DataError('發布後讀回檢查失敗')
        manifest['files'][name]={'key':key,'sha256':digest(body),'bytes':len(body)}
    # Manifest is immutable per actual execution; content identity is separate from check time.
    manifest_key=f'releases/{component}/{release_id}/manifests/{uuid.uuid4().hex}.json'
    manifest_body=encoded(manifest)
    store.put(manifest_key,manifest_body,create=True)
    if store.get(manifest_key)[0]!=manifest_body:raise DataError('Manifest 讀回檢查失敗')
    pointer={'manifest_key':manifest_key,'release_id':release_id,'published_at':now()}
    store.put(f'current/{component}.json',encoded(pointer),expected=prior_etag)
    return pointer
