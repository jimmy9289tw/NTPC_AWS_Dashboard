"""Read-only evidence tools. No model-controlled paths, SQL, URLs or writes."""
import hashlib
import json
import math
import re
import statistics
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

AGES = ['18-35','18-24','25-29','30-35']
SEXES = ['合計','男','女']
VIEWS = ['overview','registered','district','labor','industry','wage','policy','custom','export']
PERSONAL = re.compile(r'(?i)(?:AKIA|ASIA)[A-Z0-9]{16}|(?:secret|token|password)\s*[:=]|[A-Z][12]\d{8}|09\d{8}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|身分證|身份證|病歷|信用卡|我的住址|我的地址|我的電話|我的姓名|我叫|名單|護照|通訊錄')
POLICY = re.compile(r'政策|研判|風險|象限|ROA|建議|應該|方案|改善|介入|預算|試辦', re.I)

def rounded(value):
    if isinstance(value,float): return None if not math.isfinite(value) else round(value,2)
    if isinstance(value,dict): return {k:rounded(v) for k,v in value.items()}
    if isinstance(value,list): return [rounded(v) for v in value]
    return value

def district_name(value):
    return value if value=='新北市' else value.removeprefix('新北市')

def validate_request(body, allowed, geographies):
    if not isinstance(body,dict): raise ValueError('請提供有效的問題。')
    q=body.get('question','')
    if not isinstance(q,str) or not 2<=len(q.strip())<=500: raise ValueError('問題請輸入2至500字。')
    if PERSONAL.search(q) or re.search(r'https?://|<[^>]+>',q,re.I):
        raise ValueError('請只詢問公開彙總資料，不要輸入姓名、聯絡方式、證號、憑證或網址。')
    raw=body.get('context',{})
    if not isinstance(raw,dict): raise ValueError('問答條件無效。')
    ctx={k:raw.get(k) for k in ['year','ageBand','sex','district','view']}
    if type(ctx['year']) is not int or not 109<=ctx['year']<=130: raise ValueError('請選擇有效年度。')
    if ctx['ageBand'] not in AGES or ctx['sex'] not in SEXES or ctx['view'] not in VIEWS: raise ValueError('請重新選擇年齡、性別與頁面。')
    places=[district_name(g['name']) for g in geographies]
    if not isinstance(ctx['district'],str) or district_name(ctx['district']) not in places: raise ValueError('行政區無效。')
    ctx['district']=district_name(ctx['district'])
    # Explicit question scope wins over page defaults; ambiguity is not silently resolved.
    mentioned=[g for g in places if g!='新北市' and g in q]
    if len(mentioned)>1: raise ValueError('這版問答一次查一個行政區並與全市比較，請分開提問。')
    if mentioned: ctx['district']=mentioned[0]
    elif '新北市' in q: ctx['district']='新北市'
    years=set(int(v) for v in re.findall(r'(?<!\d)(1[01]\d)年',q))
    if len(years)==1: ctx['year']=next(iter(years))
    bands=re.findall(r'(18[–－-]35|18[–－-]24|25[–－-]29|30[–－-]35)歲',q)
    if len(set(bands))==1: ctx['ageBand']=re.sub('[–－]','-',bands[0])
    if re.search('男性|男生',q) and not re.search('女性|女生',q): ctx['sex']='男'
    if re.search('女性|女生',q) and not re.search('男性|男生',q): ctx['sex']='女'
    private=body.get('audience')=='internal'
    if private and not allowed: raise PermissionError('政策問答限 IP 白名單的決策內網。')
    if not private and (ctx['view'] in ['policy','custom','export'] or POLICY.search(q)):
        raise PermissionError('公開問答提供數值、來源與現有服務資訊；政策研判請由指定網路進入決策內網。')
    mode=body.get('sourceMode','official')
    if mode not in ['official','platform']: raise ValueError('資料來源模式無效。')
    return {'question':q.strip(),'context':ctx,'sourceMode':mode,'private':private}

def build_evidence(payload, load):
    """Reuse released row values and documented displayed-value differences."""
    ctx=payload['context']; q=payload['question']; year=ctx['year']; age=ctx['ageBand']; sex=ctx['sex']; place=ctx['district']
    data=json.loads(load('charts/g5-dashboard-data.json'))
    evidence=[]; notices=[]
    def add(title, rows, universe, period, source, view):
        if not rows: return
        key='P'+str(len(evidence)+1)
        evidence.append({'id':key,'label':title,'kind':'platform','universe':universe,'period':period,
                         'rows':rounded(rows),'url':source,'view':view,'year':year,'ageBand':age,'sex':sex,'district':place})
    annual=[r for r in data['registered'] if r['ageBand']==age and r['sex']==sex and r['year']<=year]
    def find(y,g): return next((r for r in annual if r['year']==y and district_name(r['geography'])==g),None)
    for g in dict.fromkeys([place,'新北市']):
        rows=[]
        for y in sorted({r['year'] for r in annual}):
            r=find(y,g)
            if not r: continue
            previous=find(y-1,g)
            growth=round((r['population']/previous['population']-1)*100,2) if previous and previous['population'] else None
            rows.append({'年度':y,'地區':g,'人數':r['population'],'人口占比%':r['populationSharePct'],'人口密度(人/平方公里)':r.get('populationDensityPerKm2'),
                         '與前一年增減人數':r['population']-previous['population'] if previous else None,'年增率%':growth,'身分':r.get('populationOrigin')})
        add(g+'戶籍青年人口歷年比較',rows,'同地區、年齡與性別的戶籍人口','各年12月底','https://data.gov.tw/dataset/77132','district' if place!='新北市' else 'registered')
    current=find(year,place)
    if not current: notices.append(f'{place}{year}年{age}歲{sex}的年末戶籍人口尚無資料，不以其他年度替代。')
    if current:
        for category,title,source in [('education','教育程度','https://data.gov.tw/dataset/117988'),('marriage','婚姻狀態','https://data.gov.tw/dataset/117986')]:
            if any(word in q for word in [title,'婚','教育','學歷','綜合','所有','背景結構']):
                rows=[{'年度':y,'地區':g,**find(y,g)[category]} for y in [year-1,year] for g in dict.fromkeys([place,'新北市']) if find(y,g)]
                add(title+'占比（%）',rows,'同地區、年齡、性別戶籍人口；官方邊際校準模型估計','各年12月底',source,'district' if place!='新北市' else 'registered')
        peers=[r for r in annual if r['year']==year and district_name(r['geography'])!='新北市']
        ranks={}
        for field,label in [('population','人口數'),('populationDensityPerKm2','人口密度')]:
            values=[r[field] for r in peers if r.get(field) is not None]
            if len(values)==29 and current.get(field) is not None and place!='新北市':
                ranks[label]={'排名':1+sum(v>current[field] for v in values),'比較區數':29,'29區中位數':statistics.median(values)}
        add('行政區相對位置',ranks,'同年齡性別29行政區；相同數值同名次',str(year)+'年','https://data.gov.tw/dataset/77132','district')
    if ctx['view']=='overview' or any(w in q for w in ['每月','月人口','最新人口','月度']):
        monthly=json.loads(load('月人口_有效版本'))
        rows=[r for r in monthly['records'] if r['ageBand']==age and r['sex']==sex and district_name(r['geography'])==place]
        add('戶籍人口月度觀察',rows,'同地區、年齡及性別戶籍人口','每月底；含最新可用月份','https://data.gov.tw/dataset/77132','overview')
    labor=ctx['view']=='labor' or any(w in q for w in ['就業','失業','勞動'])
    wage=ctx['view']=='wage' or any(w in q for w in ['薪資','薪水','中位數','工資'])
    industry=ctx['view']=='industry' or any(w in q for w in ['行業','產業'])
    if place!='新北市' and (labor or wage or industry):
        notices.append('就業、青年行業及薪資只提供全新北市，不能作為所選行政區的數值。請另選新北市查詢。')
    elif place=='新北市':
        for needed,name,title,universe,source,view in [(labor,'labor','就業與失業','居住於新北市的民間人口與勞動力','https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078','labor'),
             (wage,'wage','全年總薪資','工作場所位於新北市的受僱員工','https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642','wage')]:
            if needed:
                if sex!='合計': notices.append(title+'這個資料層只有男女合計，未提供所選性別數值。'); continue
                rows=[r for r in data[name] if r['ageBand']==age and r['year']<=year]
                add(title,rows,universe,'全年平均或全年總量；以各指標單位為準',source,view)
                if not any(r['year']==year for r in rows): notices.append(f'{title}{year}年尚無資料；歷史資料保持原年度，不補造。')
        if industry:
            ind=json.loads(load('charts/resident-employment-industry.json'))
            rows=[r for r in ind['records'] if r['ageBand']==age and r['sex']==sex and r['year'] in [year-1,year]]
            add('青年就業者行業結構',rows,'平常居住於新北市的青年就業者；模型估計','全年平均','https://www.stat.gov.tw/News_Content.aspx?n=4001&s=236078','industry')
        if wage and industry and sex=='合計':
            wi=json.loads(load('charts/youth-industry-wage.json'))
            add('青年行業薪資（歷史模型資料）',[{'行業':r['industry'],'薪資':r.get('estimates',{}).get(age)} for r in wi['rows']],
                '工作場所位於新北市的青年受僱員工；行業交叉模型估計',str(wi['meta'].get('salaryYear',wi['meta'].get('rocYear','請依來源年度確認'))),
                'https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642','wage')
    if any(w in q for w in ['教育','學歷']) and any(w in q for w in ['婚','有偶','未婚','離婚','喪偶']):
        geo=next(g for g in data['geographies'] if district_name(g['name'])==place)
        logical='charts/joint-education-marriage.json' if place=='新北市' else f"charts/joint-education-marriage-districts/{geo['code']}.json"
        joint=json.loads(load(logical)); rows=[]
        for y in [year-1,year]:
            for edu in ['國中及以下','高中職','專科','大學','研究所']:
                group=[r for r in joint['records'] if r['year']==y and r['ageBand']==age and r['sex']==sex and r['education']==edu]
                if len(group)!=4 or len({r['marriage'] for r in group})!=4: continue
                total=sum(r['population'] for r in group); low=sum(r['populationLow'] for r in group); high=sum(r['populationHigh'] for r in group)
                if min(total,low,high)<=0: continue
                for r in group: rows.append({'年度':y,'教育':edu,'婚姻':r['marriage'],'占比%':r['population']/total*100,
                     '下限%':r['populationLow']/high*100,'上限%':min(100,r['populationHigh']/low*100),'身分':r['origin']})
        add('教育×婚姻',rows,'同年度、地區、年齡及性別，以每一教育類別人口為分母；模型敏感度範圍','各年12月底','https://data.gov.tw/dataset/117988','district' if place!='新北市' else 'registered')
    if any(w in q for w in ['據點','服務','青年局']) or payload['private']:
        service=data['service']; facilities=service.get('facilities',[])
        selected=[f for f in facilities if place=='新北市' or district_name(f.get('district',''))==place]
        add('列冊青年服務據點',[{k:f.get(k) for k in ['name','district','address','operatingStatus','sourceUrl']} for f in selected],
            '列冊服務設施；沒有年齡或性別分組',str(service.get('snapshotYear'))+'年清冊快照','https://www.youth.ntpc.gov.tw/youth/ch/app/folder/59','district')
        notices.append(f"青年據點是{service.get('snapshotYear')}年列冊快照，不代表{year}年的據點數或服務缺口。")
    return evidence,notices

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

def fact_cards(evidence,context):
    """Facts are rendered from exact source rows, never rewritten by a model."""
    cards=[]
    def fmt(v):return f'{v:,.2f}'.rstrip('0').rstrip('.') if isinstance(v,(float,int)) else str(v)
    def add(source,text):cards.append({'factId':source['id']+'F'+str(len(cards)+1),'text':text,'sources':[source['id']]})
    group=f"{context['ageBand']}歲、{context['sex']}"
    for s in evidence:
        rows=s.get('rows',[])
        if s.get('kind')=='external':
            if 'rows' in s:
                names='、'.join(str(r.get('名稱','')) for r in rows[:5])
                add(s,f"本次查閱的「{s['label']}」列有{context['district']}{len(rows)}筆設施"+(f'，包括{names}' if names else '')+'。原始名冊未標示統計年度，不能視為所選人口年度的設施數。')
            elif s.get('excerpt'):
                add(s,f"{s['label']}頁面摘錄：{s['excerpt'][:230]}（期別：{s['period']}）")
            continue
        if isinstance(rows,dict):
            for label,r in rows.items():
                if isinstance(r,dict) and '排名' in r:add(s,f"{s['period']}{context['district']}{group}，{label}排名第{r['排名']}／{r['比較區數']}。")
            continue
        if not isinstance(rows,list):continue
        if rows and 'month' in rows[0]:
            for r in [rows[0],rows[-1]]:add(s,f"{r['year']}年{r['month']}月底，{r['geography']}{group}戶籍人口為{fmt(r['population'])}人。")
            continue
        for r in rows:
            year=r.get('年度',r.get('year'))
            if year is not None and year not in [context['year'],context['year']-1]:continue
            prefix=f"{year}年{r.get('地區',context['district'])}{group}"
            if '人數' in r:
                text=f"{prefix}戶籍人口為{fmt(r['人數'])}人"
                delta=r.get('與前一年增減人數');growth=r.get('年增率%')
                if delta is not None:text+=f"，較{year-1}年{'增加' if delta>=0 else '減少'}{fmt(abs(delta))}人"
                if growth is not None:text+=f"（年增率{fmt(growth)}%）"
                add(s,text+'。')
                if r.get('人口密度(人/平方公里)') is not None:add(s,f"{prefix}青年戶籍人口密度為{fmt(r['人口密度(人/平方公里)'])}人／平方公里。")
                if r.get('人口占比%') is not None:add(s,f"{prefix}占地區戶籍人口比率為{fmt(r['人口占比%'])}%。")
            elif 'metrics' in r:
                for key,value in r['metrics'].items():
                    if value is None:continue
                    meta=r.get('meta',{}).get(key,{})
                    add(s,f"{prefix}{key}為{fmt(value)}{meta.get('unit','')}（{s['universe']}；{meta.get('origin','依來源身分')}）。")
            elif 'industry' in r:
                add(s,f"{prefix}就業者中，{r['industry']}占比為{fmt(r['sharePct'])}%（{r['origin']}）。")
            elif '教育' in r and '婚姻' in r:
                add(s,f"{prefix}、{r['教育']}人口中，{r['婚姻']}占比為{fmt(r['占比%'])}%（{r['身分']}；敏感度範圍{fmt(r['下限%'])}–{fmt(r['上限%'])}%）。")
            elif '行業' in r:
                add(s,f"{s['period']}年{context['district']}{group}，{r['行業']}薪資估計資料：{json.dumps(r['薪資'],ensure_ascii=False)}（{s['universe']}）。")
            elif 'name' in r:
                add(s,f"{s['period']}：{r['name']}，{r.get('address','')}，狀態：{r.get('operatingStatus','未列')}。")
            else:
                for key,value in r.items():
                    if isinstance(value,dict) and value.get('value') is not None:
                        add(s,f"{prefix}，{key}占比為{fmt(value['value'])}%（{value.get('origin','依來源身分')}）。")
    return cards

class PageText(HTMLParser):
    def __init__(self): super().__init__(); self.skip=0; self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag in ['script','style','nav','footer','header','noscript']: self.skip+=1
        if tag in ['p','br','div','li','h1','h2','h3']: self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ['script','style','nav','footer','header','noscript']: self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip: self.parts.append(data)

def external_evidence(question, context, fetch=None):
    """Only code-reviewed exact URLs; no arbitrary URL/redirect/network tool for the model."""
    registry=json.loads(Path(__file__).with_name('ai-official-sources.json').read_text(encoding='utf-8'))
    terms=question+' '+context['view']; scored=[]
    for source in registry:
        score=sum(1 for keyword in source['keywords'] if keyword in terms)
        if score: scored.append((score,source))
    chosen=[s for _,s in sorted(scored,key=lambda item:-item[0])[:3]]
    results=[]; notices=[]
    for source in chosen:
        url=source.get('endpoint',source['url']); parsed=urlsplit(url)
        if parsed.scheme!='https' or parsed.username or not (parsed.hostname.endswith('.gov.tw') or parsed.hostname.endswith('.govt.nz')): continue
        try:
            if fetch: raw=fetch(url)
            else:
                req=Request(url,headers={'User-Agent':'NTPC-Youth-Public-Data-Assistant/1.0','Accept':'text/html,application/json'})
                with build_opener(NoRedirect).open(req,timeout=8) as response:
                    raw=response.read(700001)
                    if len(raw)>700000: raise ValueError('page_too_large')
            html=raw.decode('utf-8-sig')
            if any(w in html[:3000] for w in ['Request Rejected','Access Denied','Cloudflare Ray ID']): raise ValueError('source_rejected')
            if source.get('format')=='facility_json':
                data=json.loads(html)
                if not isinstance(data,list) or len(data)>=1000: raise ValueError('incomplete_or_changed_schema')
                name_field='title' if '4182946c-9f01-4676-9992-d40047b232cf' in url else 'name'
                if not all(isinstance(r,dict) and name_field in r and 'town' in r for r in data): raise ValueError('facility_schema_changed')
                rows=[{'名稱':r[name_field],'行政區':r['town'],'設施地址':r.get('address')} for r in data if context['district']=='新北市' or district_name(r['town'])==context['district']]
                results.append({'id':'E'+str(len(results)+1),'kind':'external','label':source['label'],'url':source['url'],
                    'period':source['period'],'universe':source['universe'],'retrievedAt':datetime.now(timezone.utc).isoformat(),
                    'rows':rows,'excerpt':f"本次官方名冊回傳{len(data)}列，符合{context['district']}條件有{len(rows)}列。未提供收托容量、空缺或候補人數，不據此判定服務供需。",
                    'sha256':hashlib.sha256(raw).hexdigest(),'scope':'官方名冊API即時讀取；只保留設施名稱、地區與地址'})
                continue
            parser=PageText(); parser.feed(html)
            lines=[re.sub(r'\s+',' ',x).strip() for x in ''.join(parser.parts).splitlines()]
            relevant=[x for x in lines if len(x)>20 and any(k in x for k in source['keywords']) and not PERSONAL.search(x) and not re.search(r'電話|聯絡人|承辦人|傳真',x)]
            text='\n'.join(relevant)[:2400]
            if len(text)<50: raise ValueError('no_relevant_text')
            results.append({'id':'E'+str(len(results)+1),'kind':'external','label':source['label'],'url':source['url'],
                            'period':source['period'],'universe':source['universe'],'retrievedAt':datetime.now(timezone.utc).isoformat(),
                            'excerpt':text,'sha256':hashlib.sha256(raw).hexdigest(),'scope':'官方頁面即時摘錄；非全網搜尋'})
        except Exception:
            notices.append(source['label']+'：本次未能取得可用內容，未將它作為回答依據。')
    if not chosen: notices.append('這個問題尚未對應到已串接的外部官方來源；本次先使用平台資料。')
    return results,notices
