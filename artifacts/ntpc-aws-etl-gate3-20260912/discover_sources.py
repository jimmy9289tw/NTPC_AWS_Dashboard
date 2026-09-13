"""唯讀官方資源目錄；保存擷取回執，辨識下載連結。"""
import hashlib,json,re,urllib.request,urllib.parse
from pathlib import Path
from html.parser import HTMLParser
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parent
class Links(HTMLParser):
    def __init__(self):super().__init__();self.links=[];self.href=None;self.label=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.href=dict(attrs).get('href');self.label=[]
    def handle_data(self,data):
        if self.href:self.label.append(data)
    def handle_endtag(self,tag):
        if tag=='a' and self.href:self.links.append({'url':self.href,'label':''.join(self.label).strip()});self.href=None
def main():
    sources={str(i):f'https://data.gov.tw/dataset/{i}' for i in [117988,117986,162821,46103]}
    sources['wage']='https://www.stat.gov.tw/News_Content.aspx?n=4580&s=232642'
    for year,page in [(110,207903),(111,231112),(112,234726),(113,234885),(114,236078)]:sources[f'labor-{year}']=f'https://www.stat.gov.tw/News_Content.aspx?n=4001&s={page}'
    out=ROOT/'discovery';out.mkdir(exist_ok=True);results={}
    for name,url in sources.items():
        req=urllib.request.Request(url,headers={'User-Agent':'NTPC-Public-Data-ETL/1.0'})
        try:
            with urllib.request.urlopen(req,timeout=40) as r:body=r.read();final=r.url
            (out/f'{name}.html').write_bytes(body)
            parser=Links();parser.feed(body.decode('utf-8',errors='replace'))
            links=[{**a,'url':urllib.parse.urljoin(final,a['url'])} for a in parser.links]
            links=[a for a in links if re.search(r'\.csv|\.zip|\.xlsx?|\.ods|download|Download',a['url'])]
            results[name]={'url':url,'final_url':final,'checked_at':datetime.now(timezone.utc).isoformat(),'sha256':hashlib.sha256(body).hexdigest(),'links':links}
            print(json.dumps({'source':name,'resources':len(links),'examples':links[:2]},ensure_ascii=False),flush=True)
        except Exception as e:results[name]={'url':url,'error':type(e).__name__+': '+str(e)}
    (ROOT/'discovery.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
