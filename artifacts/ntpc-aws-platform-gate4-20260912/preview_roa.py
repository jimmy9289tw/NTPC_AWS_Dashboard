"""Loopback-only UI verification fixture. Not deployed and never provides AWS access."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import mimetypes,json,math
ROOT=Path(__file__).resolve().parent
BOOT=json.loads((ROOT/'live-bootstrap.json').read_text(encoding='utf-8'))
def monthly(query):
    age,sex,geo=(query.get(k,[default])[0] for k,default in [('ageBand','18-35'),('sex','合計'),('geography','新北市')])
    data=BOOT['monthly'];rows=[r for r in data['records'] if (r['ageBand'],r['sex'],r['geography'])==(age,sex,geo)]
    lookup={r['period']:r['population'] for r in rows};result=[]
    for row in rows:
        y,m,n=row['year'],row['month'],row['population']
        previous=lookup.get(f'{y-1}12' if m==1 else f'{y}{m-1:02d}');previous_year=lookup.get(f'{y-1}{m:02d}')
        result.append({**row,'monthChange':(n/previous-1)*100 if previous else None,'yearChange':(n/previous_year-1)*100 if previous_year else None})
    values=[r['population'] for r in rows];lo,hi=(min(values),max(values)) if values else (0,1)
    step=10**max(0,math.floor(math.log10(max(hi-lo,1))))
    return {'rows':result,'meta':data['meta'],'scale':{'minimum':math.floor(lo/step)*step,'maximum':math.ceil(hi/step)*step,'rule':'同地區年齡性別採全部可用月份固定Y軸'}}
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.send_response(503);self.send_header('Content-Type','application/json; charset=utf-8');self.end_headers()
        self.wfile.write(json.dumps({'error':'本機展示不呼叫 AI 或外部查詢。要展示即時回答，請開啟 AWS 網站並保持網路連線。'},ensure_ascii=False).encode())
    def do_GET(self):
        path=urlsplit(self.path).path
        mappings={'/api/bootstrap':ROOT/'live-bootstrap.json','/api/roa/rules':ROOT/'roa-rules.json','/api/roa/context':ROOT/'roa-context.json'}
        body=None;mime='application/json'
        if path in mappings:body=mappings[path].read_bytes()
        elif path=='/api/monthly-population':body=json.dumps(monthly(parse_qs(urlsplit(self.path).query)),ensure_ascii=False).encode()
        elif path=='/api/export/authorize':body=b'{"allowed":true}'
        elif path=='/api/health':body=b'{"status":"ok","mode":"LOCAL_DEMO","ai":"OFFLINE_DISABLED"}'
        elif path=='/auth/status':body=json.dumps({'authenticated':True,'name':'Local preview','role':'decision','permissions':{'viewPolicy':True,'exportData':True}}).encode()
        elif path.startswith('/data/'):
            permitted=path in ['/data/ntpc-districts.geojson','/data/joint-education-marriage.json'] or path.startswith('/data/joint-education-marriage-districts/') and path.endswith('.json') and '..' not in path
            if permitted:
                try:
                    fixture=ROOT/'dashboard/public'/path.lstrip('/')
                    body=fixture.read_bytes()
                except Exception:pass
        else:
            internal=path.startswith('/internal')
            relative=path.removeprefix('/internal/').lstrip('/')
            relative='index.html' if not relative else relative
            base=(ROOT/'dashboard'/('dist-internal' if internal else 'dist-public')).resolve();target=(base/relative).resolve()
            if target.is_relative_to(base) and target.is_file() and not relative.startswith('data/'):
                body=target.read_bytes();mime=mimetypes.guess_type(relative)[0] or 'application/octet-stream'
        if body is None:self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def log_message(self,*args):pass
if __name__=='__main__':
    print('LOCAL_PREVIEW_ONLY http://127.0.0.1:8893/internal/?view=policy',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8893),Handler).serve_forever()
