"""Validate retained data, local derivations and provenance without network access."""
from pathlib import Path
import csv,json,hashlib
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'data/lsf/raw/20260912'
OUT=ROOT/'data/lsf/qa';OUT.mkdir(parents=True,exist_ok=True)
def load(p):return json.loads(p.read_text('utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
checks=[]
def check(name,condition):
    checks.append({'check':name,'pass':bool(condition)})
    assert condition,name
for p in RAW.glob('*.receipt.json'):
    source=p.with_name(p.name.removesuffix('.receipt.json'))
    check('raw-sha:'+source.name,sha(source)==load(p)['sha256'])
new=rows(ROOT/'data/lsf/published/11_生活條件與公共服務_長格式.csv')
check('793 records / 99 explicitly unavailable',len(new)==793 and sum(r['value']=='' for r in new)==99)
check('unique row IDs',len(set(r['record_id'] for r in new))==793)
check('same 42-column long format',len(new[0])==42 and list(new[0])==list(rows(ROOT/'data/published/03_受僱員工薪資母體_長格式.csv')[0]))
registry={r['source_id'] for r in rows(ROOT/'data/lsf/published/04_來源主檔.csv')}
links=rows(ROOT/'data/lsf/published/05_資料列來源關聯.csv');linked={r['record_id'] for r in links}
check('every row has retained raw source, registry and lineage',all(r['source_alias'] in registry and r['record_id'] in linked and (ROOT/r['source_snapshot']).exists() for r in new))
check('unknown-period API quarantined',all(r['source_alias']!='ntpc-registration' for r in new))
check('no synthetic youth/single-sex contextual rows',all(r['age_band']=='ALL_AGES' and r['sex_code']=='ALL' for r in new))
check('rental period separate / suppressed is missing not zero',all(r['source_period']=='11503' and (r['value']=='' or float(r['value'])>0) for r in new if r['metric_code'].startswith('RENT_')))
check('count difference has no misleading denominator',all(r['numerator']==r['denominator']=='' for r in new if r['metric_code'] in ['NET_MIGRATION','NATURAL_CHANGE']))
def value(name,year,metric):return float(next(r['value'] for r in new if r['geography_name_zh']==name and r['roc_year']==str(year) and r['metric_code']==metric))
districts=sorted(set(r['geography_name_zh'] for r in new if r['geography_level']=='DISTRICT'))
check('all 29 districts',len(districts)==29)
for name in districts:
    delta=value(name,114,'TOTAL_POP_END')-value(name,113,'TOTAL_POP_END')
    check('population-balance:'+name,delta==value(name,114,'NET_MIGRATION')+value(name,114,'NATURAL_CHANGE'))
check('Tamsui birth decline verified 112 to 114',value('新北市淡水區',112,'CRUDE_BIRTH_RATE')==4.53 and value('新北市淡水區',114,'CRUDE_BIRTH_RATE')==3.52)
check('city birth count is sum not mean',value('新北市',114,'BIRTH_COUNT')==15337==sum(value(n,114,'BIRTH_COUNT') for n in districts))
# Gate 3 允許核心長表由當次官方來源重算。
# 原「永遠等於交付日檔案 SHA」不再適用；核心公式、母體及排名由
# validate_runtime.py 獨立查核。此處仍驗證 LSF 原始檔回執與全部衍生值。
snapshot=load(ROOT/'dashboard/app/data/lsf-evidence.json')
cases=[]
for name in ['新北市淡水區','新北市八里區','新北市瑞芳區','新北市']:
    p=[r for r in snapshot['registered'] if r['geography']==name and r['ageBand']=='18-35' and r['sex']=='合計']
    now=next(r['population'] for r in p if r['year']==114);previous=next(r['population'] for r in p if r['year']==113)
    cases.append({'geography':name,'roc_year':114,'age_band':'18-35','sex':'合計','population':now,'previous_population':previous,'yoy_pct':round((now/previous-1)*100,2),'crude_birth_rate_114_permille':value(name,114,'CRUDE_BIRTH_RATE'),'net_migration_all_ages':value(name,114,'NET_MIGRATION'),'natural_change_all_ages':value(name,114,'NATURAL_CHANGE')})
(OUT/'case-validation.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),'utf-8')
result={'checkedAt':datetime.now(timezone.utc).isoformat(),'passed':len(checks),'failed':0,'checks':checks,'scope':'offline data and derivation checks; browser QA separate'}
(OUT/'data-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8')
print(json.dumps({'passed':len(checks),'failed':0,'cases':cases},ensure_ascii=False))
try:
    import fitz
    doc=fitz.open(RAW/'ntpc-yearbook-114.pdf')
    for page in [20,21,22,23]:doc[page].get_pixmap(matrix=fitz.Matrix(1.4,1.4)).save(OUT/f'official-yearbook-p{page+1}.png')
except ImportError:
    print('PDF visual extraction unavailable: install PyMuPDF to render; data tests completed.')
