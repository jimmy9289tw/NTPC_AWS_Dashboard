"""只發布指定的小型程式／公開憑證變更；其他已驗證來源沿用原清冊。"""
from pathlib import Path
import hashlib,json,subprocess,sys
import deploy_annual as deploy
ROOT=Path(__file__).resolve().parent
proof=json.loads((ROOT/'aws-provision.json').read_bytes());key=proof['bundle_key']
stream=deploy.s3.get_object(Bucket=deploy.BUCKET,Key=key,ExpectedBucketOwner=deploy.ACCOUNT)['Body']
try:body=stream.read()
finally:stream.close()
if key.rsplit('/',1)[1]!=hashlib.sha256(body).hexdigest()+'.json':raise ValueError('既有清冊雜湊錯誤')
manifest=json.loads(body);targets={r['target']:r for r in manifest['files']}
for name in sys.argv[1:]:
    if name not in targets or '/' in name or '\\' in name:raise ValueError('只允許既有根目錄程式或公開憑證')
    path=ROOT/name;digest=hashlib.sha256(path.read_bytes()).hexdigest()
    dest=deploy.RUNTIME+'engine-files/'+digest+'/'+name
    deploy.upload({'path':str(path),'key':dest,'sha256':digest})
    targets[name].update(key=dest,sha256=digest,bytes=path.stat().st_size)
body=json.dumps(manifest,ensure_ascii=False,indent=2).encode();digest=hashlib.sha256(body).hexdigest()
path=ROOT/'delta-bundle-manifest.json';path.write_bytes(body);key=deploy.RUNTIME+'bundles/'+digest+'.json'
deploy.upload({'path':str(path),'key':key,'sha256':digest});deploy.provision(key)
print(json.dumps({'bundle_key':key,'changed':sys.argv[1:]},ensure_ascii=False))
