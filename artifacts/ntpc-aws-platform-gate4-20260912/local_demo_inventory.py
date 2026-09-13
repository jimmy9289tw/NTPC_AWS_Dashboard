"""Inventory existing local architecture and verify the demo's real source assets. No network."""
from pathlib import Path
import hashlib,json,datetime
ROOT=Path(__file__).resolve().parent
SYSTEM=ROOT.parent/'NTPC_Youth_System_V1_20260912'
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
manifest=json.loads((SYSTEM/'system-manifest.json').read_text(encoding='utf-8'))
missing=[];changed=[]
for item in manifest['files']:
    p=(SYSTEM/item['path']).resolve()
    assert p.is_relative_to(SYSTEM.resolve())
    if not p.is_file():missing.append(item['path'])
    elif not item.get('mutable_runtime') and digest(p)!=item['sha256']:changed.append(item['path'])
demo_files=[ROOT/'live-bootstrap.json',ROOT/'roa-rules.json',ROOT/'roa-context.json',ROOT/'dashboard/dist-internal/index.html',ROOT/'dashboard/dist-public/index.html',ROOT/'dashboard/public/data/ntpc-districts.geojson',ROOT/'dashboard/public/data/joint-education-marriage.json']
demo_files+=list((ROOT/'dashboard/public/data/joint-education-marriage-districts').glob('*.json'))
for p in demo_files:assert p.is_file(),p
assert len(list((ROOT/'dashboard/public/data/joint-education-marriage-districts').glob('65*.json')))==29
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'systemFolder':str(SYSTEM),'manifestFiles':len(manifest['files']),'manifestBytes':sum(f['bytes'] for f in manifest['files']),'missing':missing,'changedSinceOriginalManifest':changed,'latestWebsiteSource':str(ROOT/'dashboard'),'demoFiles':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':digest(p)} for p in demo_files],'note':'既有00–14保存；新版網站與即時展示快照位於Gate4，不冒稱旧封存網站為最新版。AI離線停用，未改雲端排程。'}
(ROOT/'local-demo-inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'manifestFiles':report['manifestFiles'],'missing':len(missing),'changedSinceOriginalManifest':len(changed),'demoFiles':len(demo_files)},ensure_ascii=False))
assert not missing
