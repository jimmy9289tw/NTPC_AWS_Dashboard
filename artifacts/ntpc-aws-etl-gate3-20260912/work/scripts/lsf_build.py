"""Rebuild the additive LSF layer from retained official snapshots (offline)."""
from pathlib import Path
import csv, json, re, hashlib
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/lsf/raw/20260912'
OUT = ROOT / 'data/lsf/published'
OUT.mkdir(parents=True, exist_ok=True)
BASE = ROOT / 'data/published'
VERSION = 'NTPC-LSF-DATA-V1-20260912'
def read(p): return json.loads(Path(p).read_text('utf-8-sig'))
def save(p, data):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    Path(p).write_text(json.dumps(data, ensure_ascii=False, indent=2), 'utf-8')
def write_csv(p, columns, rows):
    with Path(p).open('w', encoding='utf-8-sig', newline='') as f:
        w=csv.DictWriter(f, fieldnames=columns); w.writeheader(); w.writerows(rows)
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()

dashboard = read(ROOT / 'dashboard/app/data/g5-dashboard-data.json')
geographies = dashboard['geographies']
geo = {g['name']:g for g in geographies}
fields = next(csv.reader((BASE/'01_戶籍人口母體_長格式.csv').open(encoding='utf-8-sig')))
reader = PdfReader(RAW/'ntpc-yearbook-114.pdf')
pages = [p.extract_text() for p in reader.pages]
receipt = read(RAW/'ntpc-yearbook-114.pdf.receipt.json')
external = []

def emit(name, year, metric, label, value, unit='人', source=receipt, page='', category='ALL', category_label='全部類別', formula='官方公布值原樣摘錄', numerator='', denominator='', basis='全年登記流量', universe='REGISTERED_POPULATION', missing_reason=''):
    r = dict.fromkeys(fields, '')
    identity = '|'.join([name,str(year),metric,category,source['source_id']])
    r.update(record_id=hashlib.sha256(identity.encode()).hexdigest()[:24],roc_year=year,gregorian_year=year+1911,
             source_period=str(year) if year!=115 else '11503',period_basis=basis,universe_code=universe,
             universe_name_zh='戶籍人口背景層（全年齡）' if universe=='REGISTERED_POPULATION' else '租金補貼有效租約背景層',
             geography_code=geo[name]['code'],geography_name_zh=name,geography_level=geo[name]['level'],
             geography_role_zh='戶籍登記地' if universe=='REGISTERED_POPULATION' else '租賃房屋所在地',age_band='ALL_AGES',sex_code='ALL',sex_name_zh='合計',
             category_dimension_code='HOUSING_TYPE' if metric.startswith('RENT') else 'DEMOGRAPHIC_FLOW',
             category_dimension_name_zh='租屋型態' if metric.startswith('RENT') else '戶籍動態',category_code=category,category_name_zh=category_label,
             metric_code=metric,metric_name_zh=label,value='' if value is None else value,unit=unit,numerator=numerator,denominator=denominator,formula_zh=formula,
             value_origin_class='OFFICIAL_DERIVED' if formula!='官方公布值原樣摘錄' else 'OFFICIAL_PUBLISHED',value_origin_label_zh='官方值計算' if formula!='官方公布值原樣摘錄' else '官方公布值',
             method_code='LSF_CONTEXT_DERIVATION' if formula!='官方公布值原樣摘錄' else 'M0',method_name_zh=formula,model_version=VERSION,
             source_alias=source['source_id'],source_name='新北市政府民政局114年統計年報' if source==receipt else '內政部租金查詢系統',
             source_url=source['url'],source_snapshot='data/lsf/raw/20260912/'+source['source_id']+('.pdf' if source==receipt else '.json'),source_sha256=source['sha256'],retrieved_at=source['retrieved_at'],
             publish_status='AVAILABLE_CONTEXT_ONLY' if value is not None else 'UNAVAILABLE',qa_status='PASS' if value is not None else 'SOURCE_SUPPRESSED',
             note_zh=(f'PDF第{page}頁。' if page else '')+'未提供青年年齡與性別交叉。'+missing_reason)
    external.append(r)

# Table 11: fixed 10 numeric columns; never infer periods from download timestamps.
table11={}
for pi in [20,21]:
    for line in pages[pi].splitlines():
        m=re.match(r'^([\u4e00-\u9fff]{2})\s+((?:[-\d,.]+\s+){9}[-\d,.]+)\s*$',line.strip())
        if m:
            vals=[float(x.replace(',','')) for x in m[2].split()]
            if len(vals)==10: table11['新北市'+m[1]+'區']=(vals,pi+1)
assert len(table11)==29, f'Table 11 extraction incomplete: {len(table11)}'
metrics=[('TOTAL_POP_END_PREV','全年齡年底戶籍人口',113,'人'),('TOTAL_POP_END','全年齡年底戶籍人口',114,'人'),('TOTAL_POP_MID','全年齡年中戶籍人口',114,'人'),('BIRTH_COUNT','出生登記人數',114,'人'),('DEATH_COUNT','死亡登記人數',114,'人'),('NATURAL_RATE_PERMILLE','自然增加率',114,'‰'),('MIGRATION_IN','遷入登記人數',114,'人'),('MIGRATION_OUT','遷出登記人數',114,'人'),('SOCIAL_RATE_PERMILLE','社會增加率',114,'‰'),('TOTAL_RATE_PERMILLE','總增加率（年中人口分母）',114,'‰')]
for name,(vals,page) in table11.items():
    for (metric,label,year,unit),value in zip(metrics,vals):
        # Both years use one stable metric code.
        emit(name,year,'TOTAL_POP_END' if metric=='TOTAL_POP_END_PREV' else metric,label,value,unit,page=page,basis='年末存量' if 'END' in metric else '年中人口' if 'MID' in metric else '全年登記流量')
    emit(name,114,'NET_MIGRATION','遷入減遷出人數',vals[6]-vals[7],page=page,formula='遷入登記人數−遷出登記人數')
    emit(name,114,'NATURAL_CHANGE','出生減死亡人數',vals[3]-vals[4],page=page,formula='出生登記人數−死亡登記人數')
    assert vals[1]-vals[0] == vals[3]-vals[4]+vals[6]-vals[7], name+' population identity'

# Table 13: 112–114 crude birth rates. Not the marriage stock share or fertility rate.
birth={}
for pi in [22,23]:
    for line in pages[pi].splitlines():
        m=re.match(r'^([\u4e00-\u9fff]{2})\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s*$',line.strip())
        if m: birth['新北市'+m[1]+'區']=([float(m[i]) for i in range(2,5)],pi+1)
assert len(birth)==29
for name,(rates,page) in birth.items():
    for year,rate in zip([112,113,114],rates): emit(name,year,'CRUDE_BIRTH_RATE','粗出生率',rate,'‰',page=page)

# City context derived from mutually exclusive districts; rates recomputed, not averaged.
sums=[sum(x[0][i] for x in table11.values()) for i in range(10)]
mid=(sums[0]+sums[1])/2
for index,metric in [(0,'TOTAL_POP_END'),(1,'TOTAL_POP_END'),(3,'BIRTH_COUNT'),(4,'DEATH_COUNT'),(6,'MIGRATION_IN'),(7,'MIGRATION_OUT')]:
    emit('新北市',113 if index==0 else 114,metric,metrics[index][1],sums[index],page='21–22',formula='加總29個互斥行政區官方人數',basis='年末存量' if index<2 else '全年登記流量')
emit('新北市',114,'TOTAL_POP_MID','全年齡年中戶籍人口',mid,page='21–22',formula='（113年底人口＋114年底人口）÷2',basis='年中人口')
for metric,label,value in [('NET_MIGRATION','遷入減遷出人數',sums[6]-sums[7]),('NATURAL_CHANGE','出生減死亡人數',sums[3]-sums[4])]:
    emit('新北市',114,metric,label,value,page='21–22',formula='加總29個互斥行政區之對應人數差')
emit('新北市',114,'CRUDE_BIRTH_RATE','粗出生率',round(sums[3]/mid*1000,2),'‰',page='21–22',formula='全市出生登記人數÷全市年中人口×1000',numerator=sums[3],denominator=mid)

rent={}
for code,label in [('all','全部類別'),('whole','整戶（層）'),('studio','獨立套房'),('room','分租套（雅）房')]:
    p=RAW/f'rent-ntpc-{code}.json'; d=read(p); sr=read(p.with_suffix('.json.receipt.json'))
    geometries=d['objects'][next(iter(d['objects']))]['geometries']
    assert len(geometries)==29
    for obj in geometries:
        props=obj['properties']; name=props['空間單元']; rent.setdefault(name,{})
        values={}
        for field,suffix,title in [('RENT25','P25','租金第25百分位數'),('RENT50','MEDIAN','租金中位數'),('RENT75','P75','租金第75百分位數')]:
            raw=props.get(field); val=raw if isinstance(raw,(int,float)) and raw>0 else None
            values[suffix]=val
            emit(name,115,'RENT_'+suffix,title,val,'元／月',source=sr,category=code.upper(),category_label=label,basis='115年3月31日有效租約快照',universe='AUXILIARY_CONTEXT',missing_reason='租金補貼有效租約，非全部租屋市場；分位數為租金分布，非估計信賴區間。'+('官方未提供此值。' if val is None else ''))
        if all(v is not None for v in values.values()): assert values['P25']<=values['MEDIAN']<=values['P75']
        rent[name][code]=values

write_csv(OUT/'11_生活條件與公共服務_長格式.csv',fields,external)
assert len({r['record_id'] for r in external})==len(external)
sources=[dict(source_id='ntpc-yearbook-114',source_name_zh='新北市政府民政局114年統計年報',owner_zh='新北市政府民政局',official_url=receipt['url'],refresh_cadence='年度',default_role='戶籍生活條件背景',data_class='OFFICIAL',registry_version=VERSION)]
for code in ['all','whole','studio','room']:
    sr=read(RAW/f'rent-ntpc-{code}.json.receipt.json')
    sources.append(dict(source_id=sr['source_id'],source_name_zh='內政部租金查詢系統 '+code,owner_zh='內政部統計處',official_url=sr['url'],refresh_cadence='依官方發布',default_role='租金有效租約背景',data_class='OFFICIAL_SAMPLE_CONTEXT',registry_version=VERSION))
for number,name in [('04','來源主檔'),('05','資料列來源關聯'),('07','三母體與外部政策資料整合狀態'),('08','外部政策資料與三母體介接規則')]:
    src=BASE/f'{number}_{name}.csv'; existing=list(csv.DictReader(src.open(encoding='utf-8-sig'))); columns=list(existing[0])
    if number=='04': additions=sources
    elif number=='05': additions=[dict(record_id=r['record_id'],universe_code=r['universe_code'],roc_year=r['roc_year'],metric_code=r['metric_code'],source_id=r['source_alias'],source_role='LSF_CONTEXT',official_url=r['source_url'],source_snapshot=r['source_snapshot'],record_source_bundle_sha256=r['source_sha256']) for r in external]
    elif number=='07': additions=[dict(file='11_生活條件與公共服務_長格式.csv',external_item='出生遷徙與租金',integration_action='新增背景層；01–03及06原樣保留',rows_after=len(external),governance_reason='全年齡／有效租約，不推算青年；115租金不回填114')]
    else: additions=[dict(external_metric_code=code,外部指標=next(r['metric_name_zh'] for r in external if r['metric_code']==code),target_file='11_生活條件與公共服務_長格式.csv',介接狀態='獨立背景層',允許連結鍵='地區代碼＋明示各自期間；同型態租金僅同快照比較',允許用途='多面向證據並列、研究問題定位',禁止用途='人級交叉、青年拆分、城市數值灌入行政區、跨期回填',啟用條件='保留原母體及觀察日期；缺值分支') for code in sorted({r['metric_code'] for r in external})]
    write_csv(OUT/src.name,columns,existing+additions)
metric_book=[dict(metric_code=code,metric_name_zh=next(r['metric_name_zh'] for r in external if r['metric_code']==code),unit=next(r['unit'] for r in external if r['metric_code']==code),age_scope='ALL_AGES；不可套用青年篩選',null_meaning='官方未提供／不可計算，不等於0',role='背景層，非新增核心母體') for code in sorted({r['metric_code'] for r in external})]
write_csv(OUT/'code_book_LSF.csv',list(metric_book[0]),metric_book)
latest_retrieval=max(read(p)['retrieved_at'] for p in RAW.glob('*.receipt.json'))
snapshot=dict(version=VERSION,generatedAt=latest_retrieval,sourceYearbook=receipt,geographies=geographies,registered=dashboard['registered'],labor=dashboard['labor'],wage=dashboard['wage'],service=dashboard['service'],external=external,rent=rent,
              industry=[r for r in read(ROOT/'dashboard/app/data/resident-employment-industry.json')['records'] if r['ageBand']!='ALL'],publication='validated-batch-candidate',rulesVersion='NTPC-LSF-RULES-V1',rentPeriod='115年3月31日')
save(ROOT/'dashboard/app/data/lsf-evidence.json',snapshot)
# 核心資料已由同批 ETL 重算，不以交付日 SHA 鎖死新版。
# 實際數值、母體、模型收斂與排名仍須通過同批 validate_runtime 閘門。
summary=dict(version=VERSION,rows=len(external),missingValues=sum(r['value']=='' for r in external),districts=29,coreValidation='同批次 validate_runtime.py 必須通過',datasets=[dict(file=p.name,sha256=sha(p),bytes=p.stat().st_size) for p in OUT.glob('*.csv')])
save(OUT/'lsf-catalog.json',summary)
print(json.dumps(summary,ensure_ascii=False))
