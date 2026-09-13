"""隔離測試：任何輸出或清冊查核失敗都不能切換有效版本。"""
import io,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import run_annual as pipeline

class MemoryS3:
    def __init__(self,old=False,corrupt=None):
        self.objects={'annual/current/annual.json':b'old'} if old else {}
        self.calls=[];self.corrupt=corrupt
    def list_objects_v2(self,**kw):
        return {'Contents':[{'Key':k} for k in self.objects if k.startswith(kw['Prefix'])][:1]}
    def get_object(self,**kw):
        body=self.objects[kw['Key']]
        if self.corrupt and self.corrupt(kw['Key']):body=b'corrupt'
        return {'Body':io.BytesIO(body),'ETag':'"previous-etag"'}
    def put_object(self,**kw):
        self.calls.append(kw);self.objects[kw['Key']]=kw['Body']
        return {'ETag':'"new-etag"'}

class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory(prefix='ntpc-publication-test-')
        self.path=Path(self.directory.name)/'data.csv';self.path.write_bytes(b'id,value\na,10\n')
        self.env=patch.dict(os.environ,{'DATA_BUCKET':'private-test','ANNUAL_PREFIX':'annual/','DATA_ACCOUNT':'test-account'})
        self.env.start()
    def tearDown(self):self.env.stop();self.directory.cleanup()
    def publish(self,client,files=None):
        with patch('boto3.client',return_value=client):
            return pipeline.publish(files or {'long/data.csv':self.path},{'run_id':'test-run'})
    def test_first_publication_is_conditional(self):
        client=MemoryS3();self.publish(client)
        self.assertEqual(client.calls[-1]['IfNoneMatch'],'*')
        self.assertEqual(client.calls[-1]['Key'],'annual/current/annual.json')
    def test_existing_publication_uses_compare_and_swap(self):
        client=MemoryS3(old=True);self.publish(client)
        self.assertEqual(client.calls[-1]['IfMatch'],'"previous-etag"')
    def test_corrupt_data_preserves_old_pointer(self):
        client=MemoryS3(old=True,corrupt=lambda k:k.endswith('data.csv'))
        with self.assertRaises(ValueError):self.publish(client)
        self.assertEqual(client.objects['annual/current/annual.json'],b'old')
    def test_corrupt_manifest_preserves_old_pointer(self):
        client=MemoryS3(old=True,corrupt=lambda k:k.endswith('manifest.json'))
        with self.assertRaises(ValueError):self.publish(client)
        self.assertEqual(client.objects['annual/current/annual.json'],b'old')
    def test_zip_rejected(self):
        forbidden=self.path.with_suffix('.ZIP');forbidden.write_bytes(b'not-uploaded')
        client=MemoryS3(old=True)
        with self.assertRaises(ValueError):self.publish(client,{'raw/original.ZIP':forbidden})
        self.assertEqual(client.calls,[])
    def test_every_write_private_and_owner_bound(self):
        client=MemoryS3();self.publish(client)
        for call in client.calls:
            self.assertEqual(call['ServerSideEncryption'],'AES256')
            self.assertEqual(call['ExpectedBucketOwner'],'test-account')
            self.assertNotIn('ACL',call)
    def test_manifest_records_actual_file(self):
        client=MemoryS3();result=self.publish(client)
        manifest=json.loads(client.objects[result['manifest_key']])
        self.assertEqual(manifest['files']['long/data.csv']['sha256'],pipeline.sha(self.path))
        self.assertEqual(manifest['files']['long/data.csv']['bytes'],self.path.stat().st_size)

if __name__=='__main__':unittest.main(verbosity=2)
