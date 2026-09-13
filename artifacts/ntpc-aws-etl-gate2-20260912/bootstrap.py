"""建立隔離月資料基準與年度重建差異報告；原資料唯讀。"""
from pathlib import Path
import csv,json
from collections import Counter
from etl.common import LocalStore,encoded,digest
ROOT=Path(__file__).resolve().parent
PACKAGE=ROOT.parent/'ntpc-lsf-v1-20260912/NTPC_Youth_LSF_V1_20260912'
RELEASE=PACKAGE/'08_發布資料包'

def main():
    original=RELEASE/'網站最新快照/monthly-population.json'
    body=original.read_bytes();data=json.loads(body)
    with (RELEASE/'01_戶籍人口母體_長格式.csv').open(encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
    geos={r['geography_name_zh']:r['geography_code'] for r in rows}
    # 月資料原結構使用「新北市板橋區」，長表使用「板橋區」。保留 API 原始地名。
    geos={g if g=='新北市' or g.startswith('新北市') else '新北市'+g:c for g,c in geos.items()}
    monthly_geos=sorted({r['geography'] for r in data['records']})
    if set(monthly_geos)!=set(geos):raise ValueError((monthly_geos,list(geos)))
    annual={}
    for r in rows:
        if r['metric_code']=='REGISTERED_POPULATION_COUNT':
            geo=r['geography_name_zh'];geo=geo if geo.startswith('新北市') else '新北市'+geo
            annual['|'.join((r['roc_year']+'12',geo,r['age_band'],r['sex_name_zh']))]=int(float(r['value']))
    store=LocalStore(ROOT/'runtime-local')
    store.put('baseline/monthly-population.json',body,create=True)
    store.put('config/monthly-contract.json',encoded({'version':'1.0.0','fields':fields,'geographies':geos,'baseline_sha256':digest(body),'annual_december_values':annual}),create=True)
    result=[]
    for prefix in ['01','02','03','06']:
        source=next(RELEASE.glob(prefix+'_*.csv'))
        target=ROOT/'legacy-rebuild/result/09_發布資料包'/source.name
        def read(p):
            with p.open(encoding='utf-8-sig',newline='') as f:return {r['record_id']:r for r in csv.DictReader(f)}
        before=read(source);after=read(target);changes=Counter();examples=[]
        # 僅執行時間與本機路徑可能因重建而異；值、分母、方法、身分與來源雜湊皆必須一致。
        ignored={'retrieved_at','source_snapshot'}
        for key in before.keys()&after.keys():
            for field in before[key]:
                if field not in ignored and before[key][field]!=after[key][field]:
                    changes[field]+=1
                    if len(examples)<8:examples.append({'record_id':key,'field':field,'before':before[key][field],'after':after[key][field]})
        item={'file':source.name,'original_rows':len(before),'rebuilt_rows':len(after),'missing':len(before.keys()-after.keys()),'extra':len(after.keys()-before.keys()),'changed_fields':dict(changes),'examples':examples,'ignored_fields':sorted(ignored)}
        item['status']='PASS' if not changes and not item['missing'] and not item['extra'] else 'REVIEW'
        result.append(item)
    report={'monthly_baseline_sha256':digest(body),'monthly_baseline_rows':len(data['records']),'annual_december_constraints':len(annual),'rebuild_comparisons':result}
    (ROOT/'rebuild-comparison.json').write_bytes(encoded(report));print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
