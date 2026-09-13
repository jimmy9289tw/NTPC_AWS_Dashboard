"""只取教育及婚姻全國原始檔中的新北市列；位元組原樣保留，無 ZIP 發布。"""
from pathlib import Path
import hashlib,json,zipfile
from etl.common import encoded
ROOT=Path(__file__).resolve().parent;SOURCE=ROOT/'legacy-rebuild/data/raw';OUT=ROOT/'public-inputs'
OUT.mkdir(exist_ok=True);entries=[]
for archive in sorted(SOURCE.rglob('*.zip')):
    relative=archive.relative_to(SOURCE)
    with zipfile.ZipFile(archive) as z:
        members=[m for m in z.infolist() if m.filename.lower().endswith('.csv')]
        if len(members)!=1:raise ValueError('來源 CSV 數量異常')
        member=members[0];target=OUT/relative.parent/member.filename
        target.parent.mkdir(parents=True,exist_ok=True)
        receipt_path=target.with_suffix('.csv.receipt.json')
        if target.exists() and receipt_path.exists():
            receipt=json.loads(receipt_path.read_bytes())
            with target.open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==receipt['subset_sha256']
            entries.append(receipt);continue
        rows=0;all_sha=hashlib.sha256();subset_sha=hashlib.sha256()
        with z.open(member) as source,target.open('xb') as dest:
            for i,line in enumerate(source):
                all_sha.update(line)
                cells=line.split(b',',3)
                retain=i<2 or (len(cells)>2 and cells[2].decode('utf-8-sig').startswith('新北市'))
                if retain:
                    dest.write(line);subset_sha.update(line)
                    if i>=2:rows+=1
        with archive.open('rb') as f:archive_sha=hashlib.file_digest(f,'sha256').hexdigest()
        receipt={'original_archive_relative':relative.as_posix(),'archive_sha256':archive_sha,'member':member.filename,'whole_csv_sha256':all_sha.hexdigest(),'whole_csv_bytes':member.file_size,'subset_path':target.relative_to(OUT).as_posix(),'subset_sha256':subset_sha.hexdigest(),'subset_bytes':target.stat().st_size,'rows':rows,'selection':'僅保留原兩列表頭及區域別以新北市開頭之資料列，逐列位元組不更動','original_archive_untouched':True,'zip_uploaded':False}
        receipt_path.write_bytes(encoded(receipt));entries.append(receipt)
        print(json.dumps({'file':str(relative),'rows':rows,'bytes':target.stat().st_size},ensure_ascii=False),flush=True)
(OUT/'subset-manifest.json').write_bytes(encoded({'files':entries,'count':len(entries)}))
