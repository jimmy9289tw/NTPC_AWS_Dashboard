"""Fetch allow-listed public sources with immutable local receipts. No credentials."""
from pathlib import Path
import hashlib, json, datetime, urllib.request, urllib.parse

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/lsf/raw/20260912'
SOURCES = {
    'ntpc-registration': 'https://data.ntpc.gov.tw/api/datasets/fa61db8d-79d1-447f-9f7a-fe4a8d4af96d/csv/file',
    'moi-rent-page': 'https://moisagis.moi.gov.tw/rent/index.html',
    'lsf-framework': 'https://lsfdashboard.treasury.govt.nz/wellbeing/',
    'rent-vuejs': 'https://moisagis.moi.gov.tw/rent/js/vuejs.js',
    'rent-vueset': 'https://moisagis.moi.gov.tw/rent/js/vueset.js',
    'rent-period': 'https://moisagis.moi.gov.tw/rent/cfm/getdatadate.cfm',
    'ntpc-yearbook-114': 'https://www.ca.ntpc.gov.tw/userfiles/1011000/files/%E6%96%B0%E5%8C%97%E5%B8%82%E6%94%BF%E5%BA%9C%E6%B0%91%E6%94%BF%E5%B1%80114%E5%B9%B4%E7%B5%B1%E8%A8%88%E5%B9%B4%E5%A0%B1(1).pdf',
}

def fetch(name, url, payload=None):
    RAW.mkdir(parents=True, exist_ok=True)
    suffix = '.pdf' if name.startswith('ntpc-yearbook') else '.csv' if name == 'ntpc-registration' else '.json' if name == 'rent-period' or payload else '.html'
    path = RAW / (name + suffix)
    if path.exists():
        return json.loads(path.with_suffix(path.suffix + '.receipt.json').read_text('utf-8'))
    req = urllib.request.Request(url, data=urllib.parse.urlencode(payload).encode() if payload else None, headers={'User-Agent': 'NTPC-research-source-audit/1.0'})
    with urllib.request.urlopen(req, timeout=45) as response:
        body = response.read()
        receipt = dict(source_id=name, url=url, final_url=response.url,
                       retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       content_type=response.headers.get('Content-Type'),
                       bytes=len(body), sha256=hashlib.sha256(body).hexdigest(), method=req.get_method(), arguments=payload)
    path.write_bytes(body)
    path.with_suffix(path.suffix + '.receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), 'utf-8')
    return receipt

if __name__ == '__main__':
    for name, url in SOURCES.items():
        try: print(json.dumps(fetch(name, url), ensure_ascii=False))
        except Exception as exc: print(json.dumps({'source': name, 'error': str(exc)}))
    for kind in ['全部類別', '整戶（層）', '獨立套房', '分租套（雅）房']:
        name = {'全部類別':'all','整戶（層）':'whole','獨立套房':'studio','分租套（雅）房':'room'}[kind]
        try:
            print(json.dumps(fetch('rent-ntpc-'+name, 'https://moisagis.moi.gov.tw/rent/cfm/calrent.cfm', dict(selectedlevel='u01to',selectedrentshow='中位數',selectedcounty='65000',selectedrenttype=kind,selectedbuildage='全部類別',selectedbuildfloor='全部類別',selectedamount='總價')), ensure_ascii=False))
        except Exception as exc: print(json.dumps({'source':name,'error':str(exc)}))
