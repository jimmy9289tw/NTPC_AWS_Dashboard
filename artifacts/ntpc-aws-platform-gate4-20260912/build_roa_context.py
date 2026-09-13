"""Build a reviewed geographic context snapshot. Never alters source CSV or ROA axes."""
import csv, hashlib, json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT.parent/'ntpc-lsf-v1-20260912/NTPC_Youth_LSF_V1_20260912/02_標準化與來源關聯'
csv_path=SOURCE/'11_生活條件與公共服務_長格式.csv'
catalog=json.loads((SOURCE/'lsf-catalog.json').read_text(encoding='utf-8'))
expected=next(d['sha256'] for d in catalog['datasets'] if d['file']==csv_path.name)
assert hashlib.sha256(csv_path.read_bytes()).hexdigest()==expected, 'LSF snapshot hash changed; review before rebuilding'
rows=list(csv.DictReader(csv_path.open(encoding='utf-8-sig',newline='')))
keep={'CRUDE_BIRTH_RATE','BIRTH_COUNT','NET_MIGRATION','RENT_MEDIAN','RENT_P25','RENT_P75'}
facts=[]
for r in rows:
    if r['metric_code'] not in keep or not r['value'] or r['qa_status']!='PASS':continue
    facts.append({'id':r['record_id'],'district':r['geography_name_zh'].removeprefix('新北市') or '新北市','metric':r['metric_code'],'label':r['metric_name_zh'],'category':r['category_name_zh'],'period':r['source_period'],'value':float(r['value']),'unit':r['unit'],'universe':r['universe_name_zh'],'url':r['source_url'],'sourceName':r['source_name'],'sourceHash':r['source_sha256'],'retrievedAt':r['retrieved_at']})
assert len({r['geography_name_zh'] for r in rows if r['metric_code']=='RENT_MEDIAN'})==29
rent_districts=len({r['district'] for r in facts if r['metric']=='RENT_MEDIAN'})
payload={'version':'ROA-CONTEXT-V1.1','reviewedAt':'2026-09-13','sourceVersion':catalog['version'],'sourceCsvSha256':expected,'rentDistrictsWithAnyValue':rent_districts,'usage':'行政區環境背景；不改四象限、不作青年個人條件、不同期資料不合併計分。缺租金數值的行政區不補值。','facts':facts}
(ROOT/'roa-context.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'facts':len(facts),'rentDistrictsWithAnyValue':rent_districts,'sourceSha256':expected,'output':'roa-context.json'},ensure_ascii=False))
