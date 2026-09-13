"""供新系統後端使用的統一資料讀取器；本機／S3 使用相同目錄，無 profile 參數。"""
from pathlib import Path,PurePosixPath
import argparse,csv,hashlib,io,json
class SystemReader:
    def __init__(self,root=None,bucket='ntpc-youth-data-000000000000',prefix='NTPC_Youth_System_V1_20260912/'):
        self.root=Path(root).resolve() if root else None;self.bucket=bucket;self.prefix=prefix
        if not self.root:
            import boto3
            self.s3=boto3.client('s3',region_name='us-west-2')
        self.catalog=json.loads(self.get('00_系統入口與版本/system-catalog.json'))
    def get(self,key,expected=None):
        p=PurePosixPath(key)
        if p.is_absolute() or '..' in p.parts or '\\' in key or ':' in key:raise ValueError('無效資料路徑')
        if self.root:
            target=(self.root/key).resolve()
            if not target.is_relative_to(self.root):raise ValueError('超出本機系統目錄')
            body=target.read_bytes()
        else:
            stream=self.s3.get_object(Bucket=self.bucket,Key=self.prefix+key,ExpectedBucketOwner='000000000000')['Body']
            try:body=stream.read()
            finally:stream.close()
        if expected and hashlib.sha256(body).hexdigest()!=expected:raise ValueError('資料雜湊不符')
        return body
    def load(self,name,format='json'):
        ref=self.catalog['datasets'][name]
        if 'pointer' in ref:
            pointer=json.loads(self.get(ref['pointer']));manifest=json.loads(self.get(ref['base']+pointer['manifest_key']))
            file=manifest['files']['09_戶籍人口月度_長格式.csv' if format=='csv' else 'monthly-population.json']
            return self.get(ref['base']+file['key'],file['sha256'])
        return self.get(ref['path'],ref['sha256'])
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root');p.add_argument('--dataset');p.add_argument('--format',choices=['json','csv'],default='json');a=p.parse_args();reader=SystemReader(a.root)
    if not a.dataset:print('\n'.join(reader.catalog['datasets']))
    else:
        body=reader.load(a.dataset,a.format)
        print(json.dumps({'dataset':a.dataset,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()},ensure_ascii=False))
