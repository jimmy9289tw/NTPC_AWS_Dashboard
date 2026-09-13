"""Read-only verification of the exact compiled web assets. No model/API mutations."""
from pathlib import Path
import hashlib,json,datetime,urllib.request,gzip,zlib
ROOT=Path(__file__).resolve().parent
URL='https://YOUR_DISTRIBUTION.cloudfront.net'
checks=[]
for build,prefix in [('dist-public','/'),('dist-internal','/internal/')]:
    base=ROOT/'dashboard'/build
    for p in [base/'index.html',*sorted((base/'assets').glob('*'))]:
        if not p.is_file():continue
        url=URL+prefix+p.relative_to(base).as_posix()
        req=urllib.request.Request(url,headers={'Cache-Control':'no-cache'})
        with urllib.request.urlopen(req,timeout=25) as r:
            body=r.read();encoding=r.headers.get('Content-Encoding','').lower()
        # Lambda compresses payloads >1KB. Compare decoded content, not transport bytes.
        if encoding=='gzip':body=gzip.decompress(body)
        elif encoding=='deflate':body=zlib.decompress(body)
        elif encoding not in ('','identity'):raise ValueError(f'Unsupported content encoding: {encoding}')
        local=hashlib.sha256(p.read_bytes()).hexdigest();remote=hashlib.sha256(body).hexdigest()
        checks.append({'path':prefix+p.relative_to(base).as_posix(),'matches':local==remote,'sha256':remote,'contentEncoding':encoding})
        assert local==remote,url
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':URL,'checks':checks,'status':'PASS','scope':'Compiled web assets only. No AI model invocation; no full infrastructure audit.'}
(ROOT/'web-ui-release-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'PASS','matchedFiles':len(checks),'url':URL}))
