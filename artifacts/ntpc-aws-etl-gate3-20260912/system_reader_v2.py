"""一次讀取固定一份有效清冊，避免同一頁混用兩次年度更新結果。"""
from pathlib import Path,PurePosixPath
import argparse,hashlib,json

class SystemReader:
    def __init__(self,root=None,bucket='ntpc-youth-data-000000000000',prefix='NTPC_Youth_System_V1_20260912/'):
        self.root=Path(root).resolve() if root else None;self.bucket=bucket;self.prefix=prefix;self.manifests={}
        if self.root:catalog='00_系統入口與版本/system-catalog-gate3.json';expected=None
        else:
            import boto3
            self.s3=boto3.client('s3',region_name='us-west-2')
            stream=self.s3.get_object(Bucket=bucket,Key='00_CURRENT_SYSTEM.json',ExpectedBucketOwner='000000000000')['Body']
            try:entry=json.loads(stream.read())
            finally:stream.close()
            catalog=self.relative(entry['catalog_key']);expected=entry.get('catalog_sha256')
        self.catalog=json.loads(self.get(catalog,expected))
    def relative(self,key):
        if not key.startswith(self.prefix):raise ValueError('不屬於本系統的S3路徑')
        return key[len(self.prefix):]
    def get(self,key,expected=None):
        p=PurePosixPath(key)
        if p.is_absolute() or '..' in p.parts or '\\' in key or ':' in key:raise ValueError('無效資料路徑')
        if self.root:
            target=(self.root/key).resolve()
            if not target.is_relative_to(self.root):raise ValueError('超出本機系統目錄')
            content=target.read_bytes()
        else:
            stream=self.s3.get_object(Bucket=self.bucket,Key=self.prefix+key,ExpectedBucketOwner='000000000000')['Body']
            try:content=stream.read()
            finally:stream.close()
        if expected and hashlib.sha256(content).hexdigest()!=expected:raise ValueError('資料雜湊不符')
        return content
    def load(self,name,format='json'):
        ref=self.catalog['datasets'][name]
        if ref.get('mode')=='validated-annual-batch':
            pointer_key=ref['pointer']
            if pointer_key not in self.manifests:
                pointer=json.loads(self.get(pointer_key))
                self.manifests[pointer_key]=json.loads(self.get(self.relative(pointer['manifest_key']),pointer['manifest_sha256']))
            file=self.manifests[pointer_key]['files'][ref['file']]
            return self.get(self.relative(file['key']),file['sha256'])
        if 'pointer' in ref:
            pointer_key=ref['pointer']
            if pointer_key not in self.manifests:
                pointer=json.loads(self.get(pointer_key))
                self.manifests[pointer_key]=json.loads(self.get(ref['base']+pointer['manifest_key'],pointer.get('manifest_sha256')))
            file=self.manifests[pointer_key]['files']['09_戶籍人口月度_長格式.csv' if format=='csv' else 'monthly-population.json']
            return self.get(ref['base']+file['key'],file['sha256'])
        return self.get(ref['path'],ref['sha256'])

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root');p.add_argument('--dataset');p.add_argument('--format',choices=['json','csv'],default='json');a=p.parse_args();reader=SystemReader(a.root)
    if not a.dataset:print('\n'.join(reader.catalog['datasets']))
    else:
        body=reader.load(a.dataset,a.format)
        print(json.dumps({'dataset':a.dataset,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()},ensure_ascii=False))
