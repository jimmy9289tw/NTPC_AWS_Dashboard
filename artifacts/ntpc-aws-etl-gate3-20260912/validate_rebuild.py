"""逐列數值、母體、公式與缺值查核；時間及來源內容另存追溯表。"""
from pathlib import Path
from collections import Counter,defaultdict
import csv,json,math
ROOT=Path(__file__).resolve().parent;WORK=ROOT/'work'
SYSTEM=ROOT.parent/'NTPC_Youth_System_V1_20260912'
BASE=SYSTEM/'03_匯聚長表與資料字典'
def rows(path):
    with path.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def equivalent(a,b,tol=1e-6):
    if a==b:return True
    if a in ('',None) or b in ('',None):return False
    try:return math.isfinite(float(a)) and math.isfinite(float(b)) and abs(float(a)-float(b))<=tol
    except (ValueError,TypeError):return False
def csv_compare(left,right,key,ignored=()):
    a=rows(left);b=rows(right);ka={tuple(r[k] for k in key):r for r in a};kb={tuple(r[k] for k in key):r for r in b}
    changed=Counter();examples=[]
    for k in ka.keys()&kb.keys():
        for f in set(ka[k])|set(kb[k]):
            if f in ignored:continue
            if not equivalent(ka[k].get(f),kb[k].get(f)):
                changed[f]+=1
                if len(examples)<8:examples.append({'key':k,'field':f,'before':ka[k].get(f),'after':kb[k].get(f)})
    return {'name':right.name,'original_rows':len(a),'rebuilt_rows':len(b),'missing':len(ka.keys()-kb.keys()),'extra':len(kb.keys()-ka.keys()),'duplicate':len(a)-len(ka)+len(b)-len(kb),'changed_fields':dict(changed),'examples':examples,'status':'PASS' if not changed and set(ka)==set(kb) and len(a)==len(ka) and len(b)==len(kb) else 'FAIL'}
def compare_json_values(left,right):
    a=json.loads(left.read_text(encoding='utf-8'));b=json.loads(right.read_text(encoding='utf-8'));issues=[];count=0
    def walk(x,y,p):
        nonlocal count
        if isinstance(x,dict) and isinstance(y,dict):
            for k in x.keys()|y.keys():
                if k in {'meta','metadata','diagnostics','sourceFiles','sourceFile','sourceSha256','sources','generatedAt','updatedAt','sourcePath','sourceSha','sourceRowsRead','sourceSnapshot'}:continue
                walk(x.get(k),y.get(k),p+'/'+k)
        elif isinstance(x,list) and isinstance(y,list):
            if len(x)!=len(y):issues.append(p+':length')
            for i,(v,w) in enumerate(zip(x,y)):walk(v,w,p+'/'+str(i))
        elif isinstance(x,(int,float)) or isinstance(y,(int,float)):
            count+=1
            if not equivalent(x,y):issues.append(p+':'+repr((x,y)))
        elif x!=y and len(issues)<25:issues.append(p+':'+str((x,y))[:150])
    walk(a,b,'')
    return {'name':right.name,'numeric_checks':count,'differences':len(issues),'examples':issues[:12],'status':'PASS' if not issues else 'FAIL'}
def main():
    checks=[];pub=WORK/'result/09_發布資料包'
    for prefix in ['01','02','03','06']:
        left=next(BASE.rglob(prefix+'_*.csv'));right=pub/left.name
        checks.append(csv_compare(left,right,['record_id'],['retrieved_at','source_snapshot','source_sha256']))
    old=SYSTEM/'09_網站與完整原始碼/完整原始碼/dashboard'
    for name in ['resident-employment-industry.json','youth-industry-wage.json']:
        checks.append(compare_json_values(old/'app/data'/name,WORK/'dashboard/app/data'/name))
    for p in (old/'public/data/joint-education-marriage-districts').glob('650*.json'):
        checks.append(compare_json_values(p,WORK/'dashboard/public/data/joint-education-marriage-districts'/p.name))
    for name,key in [('01_新北市29行政區青年指標排名.csv',['新北市行政區','民國年度','年齡層','性別']),('02_新北市全市青年指標年度與結構排名.csv',['新北市地區名','民國年度','年齡層','性別','資料主題','指標名稱','分類維度','分類名稱'])]:
        checks.append(csv_compare(SYSTEM/'07_政策排名與比較/目前排名'/name,WORK/'dashboard/data/policy-ranking'/name,key,['資料更新日期','來源查核日期']))
    validations=[]
    labor=WORK/'deliverables/NTPC_Labor_18-35_Sprague_PCLM_Pilot_V1.1_20260825'
    for path in [labor/'annual_110_114/annual_validation_checks.csv',labor/'half_year_114H2/validation_checks.csv']:
        if path.exists():
            v=rows(path);validations.append({'file':path.name,'counts':dict(Counter(r['status'] for r in v)),'failures':[r for r in v if r['status']=='FAIL']})
    report={'status':'PASS' if all(c['status']=='PASS' for c in checks) and not any(v['failures'] for v in validations) else 'FAIL','checks':checks,'model_validations':validations}
    (ROOT/'rebuild-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':report['status'],'passed':sum(c['status']=='PASS' for c in checks),'failed':[c for c in checks if c['status']!='PASS'],'model_validations':validations},ensure_ascii=False))
if __name__=='__main__':main()
