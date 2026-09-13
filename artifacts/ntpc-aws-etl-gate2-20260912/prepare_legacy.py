"""依使用者同意，僅還原既有公開來源到隔離目錄，不改原 ZIP。"""
from pathlib import Path
import csv, hashlib, json, re, shutil, zipfile
ROOT=Path(__file__).resolve().parent
PACKAGE=ROOT.parent/'ntpc-lsf-v1-20260912/NTPC_Youth_LSF_V1_20260912'
SOURCE=PACKAGE/'06_完整原始碼'
DEST=ROOT/'legacy-rebuild'
ARCHIVE=PACKAGE/'09_歷史完整成果/NTPC_Youth_Complete_Data_Package_G6_V5.32_20260908_R1.zip'

def sha(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def safe(relative):
    path=(DEST/relative).resolve()
    if not path.is_relative_to(DEST.resolve()):raise ValueError('還原路徑超出隔離目錄')
    return path

def main():
    DEST.mkdir(exist_ok=True)
    for folder in ['scripts','config','src']:
        for p in (SOURCE/folder).rglob('*'):
            if p.is_file() and p.suffix in ['.py','.json','.toml']:
                dest=safe(p.relative_to(SOURCE));dest.parent.mkdir(parents=True,exist_ok=True)
                if not dest.exists():shutil.copy2(p,dest)
    needed=set()
    for table in ['01','02','03','06']:
        with next((PACKAGE/'08_發布資料包').glob(table+'_*.csv')).open(encoding='utf-8-sig',newline='') as stream:
            for row in csv.DictReader(stream):needed.update(p.strip() for p in re.split(r'[|;；]|\s+\+\s+',row['source_snapshot']) if p.strip())
    needed.add('data/raw/NTPC-LAND-AREA/20260831/dataset-page.html')
    records=[]
    with zipfile.ZipFile(ARCHIVE) as z:
        names=z.namelist()
        for relative in sorted(needed):
            if not relative.startswith(('data/raw/','deliverables/NTPC_Labor_18-35_')):raise ValueError('非允許的來源目錄')
            dest=safe(relative)
            if relative.startswith('data/raw/'):
                suffix='/專案data/'+relative.removeprefix('data/')
            else:
                suffix='/勞動年齡拆分完整算例/'+relative.split('/',2)[2]
            matches=[name for name in names if name.replace('\\','/').endswith(suffix)]
            if len(matches)!=1:
                records.append({'path':relative,'status':'未能唯一定位','matches':len(matches)});continue
            info=z.getinfo(matches[0])
            if info.file_size>100*1024*1024:raise ValueError('單檔超出必要來源大小限制')
            dest.parent.mkdir(parents=True,exist_ok=True)
            if not dest.exists():
                with z.open(info) as src,dest.open('xb') as out:shutil.copyfileobj(src,out)
            records.append({'path':relative,'archive_member':info.filename,'bytes':dest.stat().st_size,'sha256':sha(dest),'status':'已還原'})
    result={'original_archive_unchanged':True,'source_root':str(SOURCE),'target_root':str(DEST),'files':records,'missing':[r for r in records if r['status']!='已還原'],'zip_upload':False}
    (ROOT/'legacy-restoration.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'restored':len(records)-len(result['missing']),'missing':result['missing'],'bytes':sum(r.get('bytes',0) for r in records)},ensure_ascii=False))

if __name__=='__main__':main()
