"""擷取已登錄政府原始檔。先保存回執；不在正式資料目錄覆寫。"""
from pathlib import Path
from datetime import datetime,timezone
import csv,hashlib,io,json,re,ssl,sys,urllib.parse,urllib.request,zipfile
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parent
WORK=ROOT/'work'
TLS_CONTEXT=ssl.create_default_context()
if (ROOT/'government-source-roots.pem').exists():TLS_CONTEXT.load_verify_locations(cafile=str(ROOT/'government-source-roots.pem'))
sys.path.insert(0,str(WORK/'dashboard/work/python-vendor'))
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def download(url,limit=75*1024*1024):
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https' or not (parsed.hostname or '').endswith('.gov.tw'):raise ValueError('下載網址不在政府 HTTPS 範圍')
    url=urllib.parse.urlunsplit((parsed.scheme,parsed.netloc,urllib.parse.quote(parsed.path,safe='/%'),parsed.query,''))
    req=urllib.request.Request(url,headers={'User-Agent':'NTPC-Public-Data-ETL/1.0'})
    with urllib.request.urlopen(req,timeout=90,context=TLS_CONTEXT) as r:
        if not (urllib.parse.urlsplit(r.url).hostname or '').endswith('.gov.tw'):raise ValueError('重新導向非政府網站')
        body=r.read(limit+1)
        if len(body)>limit:raise ValueError('超過核定下載大小')
        receipt={'url':url,'final_url':r.url,'checked_at':datetime.now(timezone.utc).isoformat(),'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'etag':r.headers.get('ETag'),'last_modified':r.headers.get('Last-Modified')}
    return body,receipt
def extract_ntpc(body,year):
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        members=[x for x in z.infolist() if x.filename.lower().endswith('.csv')]
        if len(members)!=1 or members[0].file_size>2_000_000_000:raise ValueError('官方 ZIP 結構改變')
        output=io.BytesIO();count=0;whole=hashlib.sha256()
        with z.open(members[0]) as f:
            for i,line in enumerate(f):
                whole.update(line)
                if i<2:output.write(line);continue
                normalized=line.removeprefix(b'\xef\xbb\xbf')
                if not normalized.strip():continue
                if not normalized.startswith(str(year).encode()+b','):raise ValueError('官方年度不符：'+repr(normalized[:30]))
                fields=normalized.split(b',',3)
                if len(fields)>2 and fields[2].decode('utf-8').startswith('新北市'):
                    output.write(line);count+=1
        if count<100000:raise ValueError('新北市原始列不完整')
        return output.getvalue(),{'whole_csv_sha256':whole.hexdigest(),'ntpc_rows':count,'member':members[0].filename}
def convert_xls(body):
    import xlrd,openpyxl
    original=xlrd.open_workbook(file_contents=body);book=openpyxl.Workbook();book.remove(book.active)
    for sheet in original.sheets():
        target=book.create_sheet(sheet.name)
        for i in range(sheet.nrows):target.append(sheet.row_values(i))
    out=io.BytesIO();book.save(out);return out.getvalue()
def fetch_one(item):
    try:body,receipt=download(item['url'])
    except Exception as error:raise RuntimeError('政府來源下載失敗：'+item['url']+'；'+str(error)) from error
    raw=ROOT/'fetched'/receipt['sha256']/item['source_name']
    raw.parent.mkdir(parents=True,exist_ok=True)
    if not raw.exists():raw.write_bytes(body)
    transformed=body
    if item.get('transform')=='ntpc_csv':
        cached=WORK/item['target']
        if receipt['sha256']==item.get('verified_archive_sha256') and cached.exists() and sha(cached)==item.get('verified_subset_sha256'):
            transformed=cached.read_bytes();receipt['normalization']='已重取官方 ZIP 並核對內容雜湊，重用已驗證的同內容新北市原始列'
        else:transformed,diag=extract_ntpc(body,item['year']);receipt.update(diag)
    elif item.get('transform')=='xls_to_xlsx':transformed=convert_xls(body)
    target=WORK/item['target'];target.parent.mkdir(parents=True,exist_ok=True)
    old=sha(target) if target.exists() else None
    receipt.update({'target':item['target'],'original_local_sha256':old,'normalized_sha256':hashlib.sha256(transformed).hexdigest(),'transform':item.get('transform','none'),'source_period':item.get('year'),'group':item['group']})
    target.write_bytes(transformed)
    raw.with_suffix(raw.suffix+'.receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    return receipt
def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--group',default='all');a=p.parse_args()
    registry=json.loads((ROOT/'fetch-registry.json').read_text(encoding='utf-8'))
    items=[r for r in registry['files'] if a.group=='all' or r['group']==a.group]
    results=[]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for r in pool.map(fetch_one,items):
            results.append(r);print(json.dumps({'target':r['target'],'same_content':r['original_local_sha256']==r['normalized_sha256']},ensure_ascii=False),flush=True)
    (ROOT/f'fetch-{a.group}.json').write_text(json.dumps({'status':'PASS','files':results},ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
