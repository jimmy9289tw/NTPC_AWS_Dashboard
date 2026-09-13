import sys, os, unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'ntpc-aws-etl-gate3-20260912'))
os.environ['AWS_DEFAULT_REGION']='us-west-2'
with patch('boto3.client',return_value=MagicMock()):
    import server

class AccessTests(unittest.TestCase):
    def setUp(self): server.SECRET='unit-test-only'
    def event(self,path,ip='198.51.100.9',secret='unit-test-only'):
        return {'rawPath':path,'headers':{'x-ntpc-viewer-ip':ip,'x-ntpc-origin':secret,'x-forwarded-for':'192.0.2.1'}}
    def test_direct_origin_denied(self):
        self.assertEqual(server.lambda_handler(self.event('/auth/status',secret=''),None)['statusCode'],403)
    def test_private_paths_denied(self):
        for path in ['/internal','/internal/','/internal/assets/file.js','/api/export/authorize','/api/roa/rules','/%69nternal/','/%2569nternal/']:
            self.assertEqual(server.lambda_handler(self.event(path),None)['statusCode'],403,path)
    def test_forged_forwarding_header_ignored(self):
        self.assertEqual(server.lambda_handler(self.event('/api/export/authorize'),None)['statusCode'],403)
    def test_each_allowed_ip(self):
        for ip in server.ALLOW:
            self.assertEqual(server.lambda_handler(self.event('/api/export/authorize',ip),None)['statusCode'],200)
    def test_lan_ip_not_allowlisted(self):
        self.assertEqual(server.lambda_handler(self.event('/internal/','172.21.10.170'),None)['statusCode'],403)
    def test_traversal(self):
        for path in ['/internal/../data/secret','/assets/%252e%252e/source','/assets/\\secret']:
            self.assertEqual(server.lambda_handler(self.event(path),None)['statusCode'],400)
    def test_no_shared_internal_cache(self):
        self.assertIn('no-store',server.lambda_handler(self.event('/api/export/authorize','192.0.2.1'),None)['headers']['cache-control'])
    def test_public_status(self):
        self.assertEqual(server.lambda_handler(self.event('/auth/status'),None)['statusCode'],200)

if __name__=='__main__': unittest.main()
