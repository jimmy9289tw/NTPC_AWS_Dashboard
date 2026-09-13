from collections import defaultdict
from datetime import datetime
from html import unescape
import csv, io, json, re, uuid
from .common import DataError,request,encoded,digest,now,publish

BANDS={'18-24':range(18,25),'25-29':range(25,30),'30-35':range(30,36),'18-35':range(18,36)}
SEXES=('男','女','合計')
CATALOG='https://data.gov.tw/dataset/77132'
API='https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{period}?page={page}'

def period_range(start,end):
    def index(p):
        if not re.fullmatch(r'\d{3}(0[1-9]|1[0-2])',p):raise DataError('無效年月')
        return int(p[:3])*12+int(p[3:])-1
    a,b=index(start),index(end)
    if b<a:raise DataError('結束期間早於開始期間')
    return [f'{i//12:03d}{i%12+1:02d}' for i in range(a,b+1)]

def discover(content):
    text=re.sub(r'<[^>]+>','',unescape(content.decode('utf-8-sig')))
    periods=sorted(set(re.findall(r'(?<!\d)(1\d{2}(?:0[1-9]|1[0-2]))[-－]?村里戶數',text)))
    if not periods:raise DataError('官方目錄找不到年月；保留舊版')
    return periods

def integer(value):
    if isinstance(value,bool) or not re.fullmatch(r'\d+',str(value)):raise DataError('人口值缺漏或不是非負整數')
    return int(value)

def normalize(row):
    aliases={'statistic_yyymm':'統計年月','district_code':'區域別代碼','site_id':'區域別'}
    aliases.update({f'people_age_{age:03d}_{sex}':f'{age}歲-{label}' for age in range(18,36) for sex,label in [('m','男'),('f','女')]})
    output=dict(row)
    for key,alias in aliases.items():
        if key in row and alias in row and str(row[key])!=str(row[alias]):raise DataError('同列中英文欄位衝突')
        if key not in output and alias in row:output[key]=row[alias]
    return output

def parse_pages(pages,period):
    if not pages:raise DataError('未取得來源分頁')
    first=pages[0];total=int(first['totalDataSize']);count=int(first['totalPage'])
    if len(pages)!=count or count>20:raise DataError('分頁數不完整')
    records=[];keys=set()
    for page_number,p in enumerate(pages,1):
        if p.get('responseCode')!='OD-0101-S' or int(p['page'])!=page_number:raise DataError('API 分頁或回應狀態不符')
        if int(p['totalDataSize'])!=total or int(p['totalPage'])!=count:raise DataError('來源在擷取途中變更')
        rows=p.get('responseData')
        if not isinstance(rows,list) or len(rows)!=int(p['pageDataSize']):raise DataError('分頁筆數不符')
        for r in rows:
            r=normalize(r)
            if str(r.get('statistic_yyymm'))!=period:raise DataError('資料年月不符')
            key=r.get('district_code')
            if not key or key in keys:raise DataError('村里代碼缺漏或重複')
            keys.add(key);records.append(r)
    if len(records)!=total:raise DataError('全國分頁總數不符')
    return records

def aggregate(rows,period,geographies):
    sums=defaultdict(int);count=0;found=set()
    for r in rows:
        site=str(r.get('site_id',''));code=str(r.get('district_code',''))
        if not (site.startswith('新北市') or code.startswith('65')):continue
        if not site.startswith('新北市') or not code.startswith('65') or site not in geographies:raise DataError('新北市地區代碼與名稱不一致')
        if geographies[site]!=code[:8]:raise DataError('行政區代碼不符')
        found.add(site);count+=1
        male={age:integer(r.get(f'people_age_{age:03d}_m')) for age in range(18,36)}
        female={age:integer(r.get(f'people_age_{age:03d}_f')) for age in range(18,36)}
        for band,ages in BANDS.items():
            m=sum(male[a] for a in ages);f=sum(female[a] for a in ages)
            for geography in (site,'新北市'):
                for sex,value in [('男',m),('女',f),('合計',m+f)]:sums[(geography,band,sex)]+=value
    if found!=set(geographies)-{'新北市'}:raise DataError('29 行政區未完整取得')
    output=[{'period':period,'year':int(period[:3]),'month':int(period[3:]),'geography':g,'ageBand':b,'sex':s,'population':v} for (g,b,s),v in sorted(sums.items())]
    validate(output,geographies,[period])
    return output,{'ntpc_villages':count,'districts':len(found),'national_rows':len(rows)}

def validate(rows,geographies,periods):
    keys={};expected={(p,g,b,s) for p in periods for g in geographies for b in BANDS for s in SEXES}
    for r in rows:
        key=(r['period'],r['geography'],r['ageBand'],r['sex'])
        if key in keys:raise DataError('月人口主鍵重複')
        if r['year']!=int(r['period'][:3]) or r['month']!=int(r['period'][3:]):raise DataError('年月欄位不符')
        keys[key]=integer(r['population'])
    if set(keys)!=expected:raise DataError('月度／地區／年齡／性別組合不完整')
    for p in periods:
        for g in geographies:
            for s in SEXES:
                if keys[p,g,'18-35',s]!=sum(keys[p,g,b,s] for b in ('18-24','25-29','30-35')):raise DataError('年齡加總不符')
            for b in BANDS:
                if keys[p,g,b,'合計']!=keys[p,g,b,'男']+keys[p,g,b,'女']:raise DataError('男女加總不符')
        for b in BANDS:
            for s in SEXES:
                if keys[p,'新北市',b,s]!=sum(keys[p,g,b,s] for g in geographies if g!='新北市'):raise DataError('全市與29區加總不符')

def long_csv(rows,contract,provenance):
    text=io.StringIO(newline='');writer=csv.DictWriter(text,fieldnames=contract['fields']);writer.writeheader()
    for r in rows:
        p=provenance[r['period']];geo=contract['geographies'][r['geography']];sex={'男':'M','女':'F','合計':'ALL'}[r['sex']]
        row={k:'' for k in contract['fields']}
        row.update(record_id=f"MONTHLY-{r['period']}-{geo}-{r['ageBand']}-{sex}",roc_year=r['year'],gregorian_year=r['year']+1911,source_period=r['period'],period_basis='每月月底存量',universe_code='REGISTERED_POPULATION',universe_name_zh='戶籍登記現住人口',geography_code=geo,geography_name_zh=r['geography'],geography_level='CITY' if r['geography']=='新北市' else 'DISTRICT',geography_role_zh='戶籍登記地',age_band=r['ageBand'],sex_code=sex,sex_name_zh=r['sex'],category_dimension_code='TOTAL',category_dimension_name_zh='總計',category_code='TOTAL',category_name_zh='總計',metric_code='REGISTERED_POPULATION_COUNT',metric_name_zh='戶籍人口數',value=r['population'],unit='人',formula_zh='所選單一年齡與性別之村里戶籍人口直接加總',value_origin_class='DERIVED_FROM_OFFICIAL_ADMIN_EXACT',value_origin_label_zh='官方行政資料直接加總',method_code='EXACT_SINGLE_AGE_SUM',method_name_zh='單一年齡精確加總',model_version='不適用',source_alias='MOI-POP1Y',source_name='村里戶數、單一年齡人口',source_url=CATALOG,source_snapshot=p['snapshot'],source_sha256=p['sha256'],retrieved_at=p.get('retrieved_at',''),publish_status='PUBLISH_EXACT_DERIVED',qa_status='PASS',note_zh='未以年資料插補月份；歷史來源與本次重查範圍見版本紀錄')
        writer.writerow(row)
    return ('\ufeff'+text.getvalue()).encode('utf-8')

def run(store,fetch=request,limit_new=12):
    run_id=datetime.now().strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8]
    checked_at=now();key=f'runs/monthly/{run_id}.json';committed=None
    try:
        contract=json.loads(store.get('config/monthly-contract.json')[0])
        previous,etag=store.get('current/monthly.json')
        if previous:
            manifest=json.loads(store.get(json.loads(previous)['manifest_key'])[0]);ref=manifest['files']['monthly-population.json']
            body=store.get(ref['key'])[0]
            if digest(body)!=ref['sha256']:raise DataError('已發布月資料雜湊不符')
            old=json.loads(body)
        else:
            body=store.get('baseline/monthly-population.json')[0]
            if digest(body)!=contract['baseline_sha256']:raise DataError('基準檔雜湊不符')
            old=json.loads(body)
        periods=sorted({r['period'] for r in old['records']});validate(old['records'],contract['geographies'],periods)
        catalog,receipt=fetch(CATALOG);available=discover(catalog)
        latest=available[-1]
        if latest<periods[-1]:raise DataError('官方目錄期間倒退')
        additions=period_range(periods[-1],latest)[1:]
        if len(additions)>limit_new:raise DataError('待補月份超過單次限制，須先回補')
        # 每日重查最新月、前一月與輪替的一個歷史月，避免有快取就永不驗證修訂。
        desired=period_range(periods[0],latest)
        rotating=periods[datetime.now().toordinal()%len(periods)]
        refresh=sorted(set(additions+desired[-2:]+[rotating]))
        updated={};details=[];provenance=dict(old.get('provenance',{}))
        for period in periods:
            provenance.setdefault(period,{'snapshot':'baseline/monthly-population.json','sha256':contract['baseline_sha256'],'retrieved_at':''})
        for period in refresh:
            page_body,page_receipt=fetch(API.format(period=period,page=1));page=json.loads(page_body.decode('utf-8-sig'))
            pages=[page];receipts=[page_receipt]
            count=int(page.get('totalPage',0))
            if not 1<=count<=20:raise DataError('來源分頁數異常')
            for n in range(2,count+1):
                raw,meta=fetch(API.format(period=period,page=n));pages.append(json.loads(raw.decode('utf-8-sig')));receipts.append(meta)
            raw_rows=parse_pages(pages,period);new,qa=aggregate(raw_rows,period,contract['geographies'])
            for r in new:
                annual_key='|'.join((r['period'],r['geography'],r['ageBand'],r['sex']))
                expected=contract.get('annual_december_values',{}).get(annual_key)
                if expected is not None and expected!=r['population']:raise DataError('歷史年底人口已修訂；須先同步年度資料，暫不發布新月資料')
            raw=encoded({'period':period,'pages':pages});raw_key=f'raw/monthly/{period}/{digest(raw)}.json'
            store.put(raw_key,raw,create=True)
            provenance[period]={'snapshot':raw_key,'sha256':digest(raw),'retrieved_at':receipts[0]['retrieved_at']}
            updated[period]=new;details.append({'period':period,**qa,'sources':receipts})
        records=[r for r in old['records'] if r['period'] not in updated]+[r for p in refresh for r in updated[p]]
        records=sorted(records,key=lambda r:(r['period'],r['geography'],r['ageBand'],r['sex']))
        validate(records,contract['geographies'],desired)
        old_records=sorted(old['records'],key=lambda r:(r['period'],r['geography'],r['ageBand'],r['sex']))
        changed=encoded(records)!=encoded(old_records)
        result={'run_id':run_id,'checked_at':checked_at,'latest_available':latest,'source_catalog':receipt,'checked_periods':refresh,'period_checks':details,'rows':len(records),'status':'NO_CHANGE','mutations':'僅新增本案ETL紀錄／版本，不修改原始資料包'}
        if changed or not previous:
            dataset={'meta':{**old['meta'],'generatedAt':checked_at,'periods':desired,'method':'官方全部分頁完整性驗證後，直接加總18–35歲至29區及全市；保留歷史序列','etlVersion':'1.0.0','sourcePeriodMax':latest},'records':records,'provenance':provenance,'qa':{'status':'PASS','checks':['完整分頁','29區','四年齡群組','男女加總','全市加總'],'historical_revalidation':'每日重查最新兩月及輪替歷史一月'}}
            payloads={'monthly-population.json':encoded(dataset),'09_戶籍人口月度_長格式.csv':long_csv(records,contract,provenance)}
            pointer=publish(store,'monthly',payloads,{'source_period_max':latest,'period_count':len(desired),'rows':len(records),'checked_at':checked_at,'annual_window_unchanged':'110–114'},etag)
            result.update(status='PUBLISHED',**pointer)
            committed=pointer
        store.put(key,encoded(result),create=True)
        return result
    except Exception as error:
        failure={'run_id':run_id,'checked_at':checked_at,'status':'PUBLISHED_LOG_FAILED' if committed else 'FAILED','error_type':type(error).__name__,'message':str(error),'publication':committed or '本次未切換有效版本'}
        try:store.put(key+'.failure.json',encoded(failure),create=True)
        except Exception:pass
        raise
