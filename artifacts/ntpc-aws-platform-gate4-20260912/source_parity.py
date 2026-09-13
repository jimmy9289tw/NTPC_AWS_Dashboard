from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parent
original=Path('D:/github/work/019fe05e-e1a3-71f2-840e-c026180d9474/NtpcYouthAI/dashboard')
archived=ROOT.parent/'NTPC_Youth_System_V1_20260912/09_網站與完整原始碼/完整原始碼/dashboard'
checks=[]
for folder in ['app','worker','build','scripts','tests']:
    for p in (archived/folder).rglob('*'):
        if p.is_file():
            relative=p.relative_to(archived);current=original/relative
            checks.append({'path':relative.as_posix(),'same':current.exists() and hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256(current.read_bytes()).digest()})
report={'online_observed_ui':'G6 UI V5.31','online_url':'https://ntpc-youth.the-weekly-blend.com/','local_source_ui':'G6 UI V5.32','migration_base':'本機最新完整版本，保留原平台功能，AWS副本更新ROA及存取','files_compared':len(checks),'differences':[x for x in checks if not x['same']],'all_files_match':all(x['same'] for x in checks)}
(ROOT/'source-parity.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
