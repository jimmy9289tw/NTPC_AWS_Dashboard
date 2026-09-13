"""以既有官方原檔內容比對目錄資源，避免把年度猜錯。"""
from pathlib import Path
import hashlib,json
from fetch_official import download,sha
ROOT=Path(__file__).resolve().parent;WORK=ROOT/'work'
def main():
    discovery=json.loads((ROOT/'discovery.json').read_text(encoding='utf-8'));registry=json.loads((ROOT/'fetch-registry.json').read_text(encoding='utf-8'));matches=[]
    for catalog,prefix in [('162821','BLI-AGE-REGION-SEX'),('46103','BLI-PENSION-AGE-WAGE')]:
        expected={sha(p):p for p in (WORK/'data/raw/WAGE-AUX/20260826').glob(prefix+'-*.csv')}
        for item in discovery[catalog]['links']:
            if item['label']!='CSV':continue
            body,receipt=download(item['url']);digest=receipt['sha256']
            if digest not in expected:continue
            p=expected[digest];year=int(p.stem[-3:]);target=p.relative_to(WORK).as_posix()
            entry={'url':item['url'],'source_name':p.name,'target':target,'group':'wage-aux','year':year,'transform':None}
            registry['files']=[r for r in registry['files'] if r['target']!=target];registry['files'].append(entry)
            matches.append({'target':target,**receipt});expected.pop(digest)
        if expected:raise ValueError('無法以官方原檔唯一定位年度：'+','.join(p.name for p in expected.values()))
    (ROOT/'fetch-registry.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'auxiliary-resolution.json').write_text(json.dumps({'status':'PASS','matches':matches},ensure_ascii=False,indent=2),encoding='utf-8');print('已確認 '+str(len(matches))+' 份薪資輔助官方來源')
if __name__=='__main__':main()
