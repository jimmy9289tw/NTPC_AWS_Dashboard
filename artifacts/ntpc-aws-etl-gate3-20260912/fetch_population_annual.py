"""以完整分頁重新取得各年12月戶籍母數，任何缺欄停止。"""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re
from fetch_official import download
ROOT=Path(__file__).resolve().parent;WORK=ROOT/'work'
def validate_pages(pages,period):
    first=pages[0];rows=[];seen=set()
    if len(pages)!=int(first['totalPage']):raise ValueError('戶籍 API 分頁不完整')
    for i,p in enumerate(pages,1):
        if p.get('responseCode')!='OD-0101-S' or int(p['page'])!=i or p['totalDataSize']!=first['totalDataSize']:raise ValueError('API 狀態或分頁總數不一致')
        if len(p['responseData'])!=int(p['pageDataSize']):raise ValueError('API 單頁筆數不符')
        for r in p['responseData']:
            code=r.get('district_code')
            if not code or code in seen or str(r.get('statistic_yyymm'))!=period:raise ValueError('戶籍代碼重複、缺漏或年月不符')
            seen.add(code)
            if code.startswith('65'):
                for suffix in ['m','f']:
                    for k in [f'people_total_{suffix}']+[f'people_age_{a:03d}_{suffix}' for a in range(100)]:
                        if not re.fullmatch(r'\d+',str(r.get(k,''))):raise ValueError('戶籍來源數值缺漏：'+k)
            rows.append(r)
    if len(rows)!=int(first['totalDataSize']) or len({r['district_code'][:8] for r in rows if r['district_code'].startswith('65')})!=29:raise ValueError('戶籍全量或29區不完整')
    return rows
def main():
    results=[]
    for year in range(110,115):
        period=f'{year}12';pages=[];receipts=[]
        body,r=download(f'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{period}?page=1',limit=32*1024*1024)
        pages.append(json.loads(body));receipts.append(r)
        total=int(pages[0]['totalPage'])
        if not 1<=total<=20:raise ValueError('API 分頁數超過契約')
        for page in range(2,total+1):
            body,r=download(f'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{period}?page={page}',limit=32*1024*1024);pages.append(json.loads(body));receipts.append(r)
        rows=validate_pages(pages,period);target=WORK/f'data/raw/MOI-POP1Y/annual-refresh-{year}/MOI-POP1Y.json';target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps({'period':period,'totalDataSize':len(rows),'responseData':rows},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        results.append({'period':period,'pages':receipts,'rows':len(rows),'normalized_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'target':target.relative_to(WORK).as_posix()});print(period, len(rows),flush=True)
    (ROOT/'fetch-december.json').write_text(json.dumps({'status':'PASS','files':results},ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
