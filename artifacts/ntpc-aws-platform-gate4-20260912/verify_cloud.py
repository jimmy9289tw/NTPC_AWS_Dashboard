from pathlib import Path
import base64, gzip, json, urllib.request, urllib.error, hashlib, datetime
import boto3
ROOT=Path(__file__).resolve().parent
receipt=json.loads((ROOT/'deployment.json').read_text(encoding='utf-8'))
s=boto3.Session(region_name='us-west-2'); cf=s.client('cloudfront'); lam=s.client('lambda')
checks=[]
def check(name,condition,detail=None):
    checks.append({'name':name,'status':'PASS' if condition else 'FAIL','detail':detail})
def get(path,base=None,headers=None):
    req=urllib.request.Request((base or receipt['url'])+path,headers=headers or {})
    try:r=urllib.request.urlopen(req,timeout=60)
    except urllib.error.HTTPError as e:r=e
    raw=r.read()
    if r.headers.get('Content-Encoding')=='gzip':raw=gzip.decompress(raw)
    return r.status,raw,dict(r.headers)
for path in ['/','/internal/','/api/health','/auth/status','/api/roa/rules','/api/roa/context','/api/export/authorize']:
    status,body,headers=get(path);check('本機實際請求 '+path,status==200,{'status':status})
    if path=='/api/health':check('AWS平台版本V1.0',json.loads(body).get('ui')=='AWS V1.0')
    if path in ['/','/internal/']:check('網站標題V1.0 '+path,'AWS V1.0' in body.decode('utf-8'))
    if path=='/api/roa/context':
        check('地方背景與本地查核快照相同',json.loads(body)==json.loads((ROOT/'roa-context.json').read_text(encoding='utf-8')))
        check('地方背景API不快取','no-store' in headers.get('cache-control',headers.get('Cache-Control','')))
status,raw,headers=get('/api/bootstrap');bootstrap=json.loads(raw)
(ROOT/'live-bootstrap.json').write_bytes(raw)
period=bootstrap['monthly']['meta']['periods'][-1]
check('有效年度與月度資料',status==200 and period=='11508' and bootstrap['dashboard']['meta']['years']==[110,111,112,113,114],{'latest_month':period,'sha256':hashlib.sha256(raw).hexdigest()})
check('API直接連線拒絕',get('/api/roa/rules',receipt['api_url'],{'x-ntpc-viewer-ip':'192.0.2.1','x-forwarded-for':'192.0.2.1'})[0]==403)
check('地方背景API直接連線拒絕',get('/api/roa/context',receipt['api_url'])[0]==403)
check('不公開原始資料包',get('/system-manifest.json')[0]==404)
config=lam.get_function_configuration(FunctionName=receipt['function'])
check('Lambda六個公網IP',set(config['Environment']['Variables']['ALLOW_IPS'].split(','))==set(receipt['allow_ipv4']) and len(receipt['allow_ipv4'])==6)
name='ntpc-youth-web-gate4-ip-access';desc=cf.describe_function(Name=name,Stage='LIVE')
for ip,allowed in [(x,True) for x in receipt['allow_ipv4']]+[('198.51.100.4',False),('172.21.10.170',False)]:
    for path in ['/internal/','/api/roa/rules','/api/roa/context','/api/export/authorize']:
        event={'version':'1.0','context':{'eventType':'viewer-request'},'viewer':{'ip':ip},'request':{'method':'GET','uri':path,'querystring':{},'headers':{'x-ntpc-viewer-ip':{'value':'192.0.2.1'},'x-ntpc-origin':{'value':'forged'}} ,'cookies':{}}}
        result=cf.test_function(Name=name,IfMatch=desc['ETag'],Stage='LIVE',EventObject=json.dumps(event).encode())['TestResult']
        wrapper=json.loads(result['FunctionOutput'])
        output=wrapper.get('request',wrapper.get('response',wrapper))
        valid=(output.get('headers',{}).get('x-ntpc-viewer-ip',{}).get('value')==ip and 'x-ntpc-origin' not in output.get('headers',{})) if allowed else output.get('statusCode')==403
        check('CloudFront LIVE '+ip+' '+path,valid)
blocked=s.client('s3').get_public_access_block(Bucket='ntpc-youth-data-000000000000')['PublicAccessBlockConfiguration']
check('S3維持四項公開封鎖',all(blocked.values()))
distribution=cf.get_distribution(Id=receipt['distribution_id'])['Distribution']
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS' if all(x['status']=='PASS' for x in checks) else 'FAIL','checks':checks,'distribution_status':distribution['Status'],'url':receipt['url']}
(ROOT/'cloud-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':report['status'],'checks':len(checks),'failed':[x for x in checks if x['status']=='FAIL'],'cloudfront':distribution['Status']},ensure_ascii=False))
