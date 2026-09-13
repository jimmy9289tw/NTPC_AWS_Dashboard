"""Smoke tests through the real CloudFront origin; only canned public-data questions."""
import gzip,json,secrets,time,uuid,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parent
BASE='https://YOUR_DISTRIBUTION.cloudfront.net'
session=secrets.token_hex(32)
def request(path,body=None,token=None):
    req=urllib.request.Request(BASE+path,data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None,
        headers={'Content-Type':'application/json','x-ntpc-chat-session':token or session})
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            data=r.read()
            return r.status,json.loads(gzip.decompress(data) if r.headers.get('Content-Encoding')=='gzip' else data)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
def ask(question,private=False,mode='platform'):
    body={'question':question,'context':{'year':114,'ageBand':'30-35','sex':'合計','district':'淡水區','view':'policy' if private else 'district'},
          'sourceMode':mode,'audience':'internal' if private else 'public','requestId':str(uuid.uuid4())}
    status,job=request('/api/ask',body);assert status==202,(status,job)
    # Repeated HTTP submit with the same ID must not enqueue another model call.
    status2,duplicate=request('/api/ask',body);assert status2==202 and duplicate['jobId']==job['jobId']
    assert request('/api/ask/'+job['jobId'],token=secrets.token_hex(32))[0]==404
    for _ in range(75):
        time.sleep(2);status,result=request('/api/ask/'+job['jobId'])
        if result['status'] in ['complete','failed']:
            assert result['status']=='complete',result
            print(json.dumps({'mode':mode,'summary':result['summary'],'directions':result['directions'],'external':[s['label'] for s in result['sources'] if s['kind']=='external'],'notices':result['notices']},ensure_ascii=False),flush=True)
            return result
    raise TimeoutError('AI job not completed')

public=ask('114年淡水區30–35歲人口與前一年相比如何變化？')
assert public['mode']=='BEDROCK_NOVA' and not public['directions'] and public['summary']
assert public['sources'][0]['rows'][-1]['人數']==17449
assert public['sources'][0]['rows'][-1]['年增率%']==6.07
internal=ask('114年淡水區30–35歲人口增加，托育有哪些官方資料可參考？可以朝什麼方向了解？',True,'official')
assert internal['summary']
assert any('未標示統計年度' in b['text'] for b in internal['summary'] if any(s.startswith('E') for s in b['sources']))
checks={'public_model_reply':True,'public_no_policy_section':True,'idempotent_submit':True,'cross_session_denied':True,'exact_population_17449':True,'exact_growth_6_07':True,
        'internal_model_reply':True,'external_official_retrieved':any(s['kind']=='external' for s in internal['sources']),'external_period_not_relabelled':True}
result={'status':'PASS' if all(checks.values()) else 'PARTIAL','checks':checks,'checkedAt':time.time(),'public':public,'internal':internal}
(ROOT/'ai-cloud-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':result['status'],'checks':checks},ensure_ascii=False))
