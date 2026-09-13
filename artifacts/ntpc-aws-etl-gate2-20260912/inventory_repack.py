from pathlib import Path
import json,zipfile
ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent
names=['NTPC_Youth_ROA_Update_V1_20260912','_ROA_build','ntpc-youth-policy-quadrants-v1-20260912','ntpc-youth-population-quadrants-20260912','ntpc-lsf-v1-20260912']
for name in names:
    files=[p for p in (BASE/name).rglob('*') if p.is_file() and p.suffix.lower()!='.zip']
    print(name,len(files),sum(p.stat().st_size for p in files))
restored=ROOT/'legacy-rebuild/data/raw'
zips=[]
for p in restored.rglob('*.zip'):
    with zipfile.ZipFile(p) as z:
        zips.append({'path':str(p.relative_to(restored)),'zip_bytes':p.stat().st_size,'members':[(m.filename,m.file_size) for m in z.infolist()]})
print(json.dumps(zips,ensure_ascii=False,indent=2))
