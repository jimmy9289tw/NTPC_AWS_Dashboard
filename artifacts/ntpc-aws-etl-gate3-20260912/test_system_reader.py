"""驗證讀取器固定同一批次，並拒絕越界及內容損壞。"""
import hashlib,json,unittest
from system_reader_v2 import SystemReader

class ReaderTests(unittest.TestCase):
    def test_two_datasets_share_one_manifest(self):
        reader=SystemReader.__new__(SystemReader);reader.prefix='system/';reader.manifests={}
        content={'a.csv':b'a,1','b.csv':b'b,2'}
        manifest={'files':{k:{'key':'system/release/'+k,'sha256':hashlib.sha256(v).hexdigest()} for k,v in content.items()}}
        raw=json.dumps(manifest).encode();calls=[]
        objects={'current.json':json.dumps({'manifest_key':'system/manifest.json','manifest_sha256':hashlib.sha256(raw).hexdigest()}).encode(),'manifest.json':raw,**{'release/'+k:v for k,v in content.items()}}
        def get(key,expected=None):
            calls.append(key);body=objects[key]
            if expected and hashlib.sha256(body).hexdigest()!=expected:raise ValueError('hash')
            return body
        reader.get=get;reader.catalog={'datasets':{k:{'mode':'validated-annual-batch','pointer':'current.json','file':k} for k in content}}
        self.assertEqual(reader.load('a.csv'),content['a.csv'])
        objects['current.json']=b'changed-after-first-read'
        self.assertEqual(reader.load('b.csv'),content['b.csv'])
        self.assertEqual(calls.count('current.json'),1)
    def test_reject_other_system_key(self):
        reader=SystemReader.__new__(SystemReader);reader.prefix='system/'
        with self.assertRaises(ValueError):reader.relative('other-system/data.csv')
    def test_reject_path_escape(self):
        reader=SystemReader.__new__(SystemReader)
        for path in ['../outside.csv','/outside.csv','C:/outside.csv','folder\\outside.csv']:
            with self.assertRaises(ValueError):reader.get(path)

if __name__=='__main__':unittest.main(verbosity=2)
