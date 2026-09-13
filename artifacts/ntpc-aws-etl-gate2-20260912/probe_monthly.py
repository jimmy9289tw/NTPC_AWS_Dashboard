from pathlib import Path
from urllib.request import Request,urlopen
import json

root=Path(__file__).resolve().parent
url='https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/11508?page=1'
with urlopen(Request(url,headers={'User-Agent':'NTPC-ETL/1.0'}),timeout=45) as r:body=r.read(24*1024*1024)
obj=json.loads(body.decode('utf-8-sig'))
(root/'probe-monthly-11508-p1.json').write_bytes(body)
rows=obj.get('responseData',[])
print(json.dumps({'metadata':{k:v for k,v in obj.items() if k!='responseData'},'rows':len(rows),'sample_fields':rows[0] if rows else {}},ensure_ascii=False))
