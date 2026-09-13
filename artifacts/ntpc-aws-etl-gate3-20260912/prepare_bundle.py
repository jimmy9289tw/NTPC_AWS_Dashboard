"""把執行需要的原始檔與程式加入同一00–14架構；同內容沿用原S3物件。"""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parent;WORK=ROOT/'work';SYSTEM=ROOT.parent/'NTPC_Youth_System_V1_20260912';PREFIX=SYSTEM.name+'/'
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def main():
    registry=json.loads((ROOT/'fetch-registry.json').read_text(encoding='utf-8'));receipts=json.loads((ROOT/'fetch-population.json').read_text(encoding='utf-8'))
    by={r['target']:r for r in receipts['files']}
    for r in registry['files']:
        if r['target'] in by:r.update(verified_archive_sha256=by[r['target']]['sha256'],verified_subset_sha256=by[r['target']]['normalized_sha256'])
    (ROOT/'fetch-registry.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2),encoding='utf-8')
    index={r['sha256']:r for r in json.loads((SYSTEM/'system-manifest.json').read_bytes())['files'] if not r['mutable_runtime']}
    needed={}
    for name in ['run_annual.py','rebuild.py','fetch_official.py','fetch_population_annual.py','build_joint_input.py','validate_runtime.py','fetch-registry.json','government-source-roots.pem','government-source-roots.json']:
        needed[name]=ROOT/name
    scripts=['analyze_annual_labor_age_graduation_v24.py','analyze_labor_age_graduation_v24.py','process_marital_status_v23.py','build_g5_v3_data.py','build_external_policy_data.py','export_g5_dashboard_json.py','build_g5_normalized_lineage.py','lsf_build.py','lsf_validate.py']
    scripts+=['../config/g5-refresh-policy.json','../config/source-registry-normalized.json','../config/external-policy-service-data.json']
    for name in scripts:
        p=(WORK/'scripts'/name).resolve();needed['work/'+p.relative_to(WORK).as_posix()]=p
    for name in ['build_youth_resident_employment_industry_data.py','build-joint-education-marriage.py','build-youth-industry-wage.py','build-policy-ranking-csv.mjs']:
        p=WORK/'dashboard/scripts'/name;needed['work/'+p.relative_to(WORK).as_posix()]=p
    folders=['data/raw','data/lsf/raw','dashboard/data/raw','dashboard/work/official-source-check','deliverables/NTPC_Labor_18-35_Sprague_PCLM_Pilot_V1.1_20260825/raw/annual']
    for folder in folders:
        for p in (WORK/folder).rglob('*'):
            if p.is_file() and p.suffix.lower() in ['.csv','.json','.html','.pdf','.xls','.xlsx'] and '__pycache__' not in p.parts:
                needed['work/'+p.relative_to(WORK).as_posix()]=p
    for name in ['DGBAS-NTPC-UR-AGE-T41-11412.xlsx','DGBAS-NTPC-LABOR-AGE-T42-114H2.xlsx']:
        needed['work/additional-inputs/'+name]=WORK/'additional-inputs'/name
    for name in ['mol-salary-context.json','district-population-baseline-109.json']:
        needed['work/dashboard/app/data/'+name]=WORK/'dashboard/app/data'/name
    # 介接規則是固定方法中繼資料，不是可由模型產生的人口或估計值。
    name='08_外部政策資料與三母體介接規則.csv'
    needed['work/data/published/'+name]=WORK/'data/published'/name
    entries=[];added=[]
    for target,p in sorted(needed.items()):
        digest=sha(p)
        if digest in index:key=PREFIX+index[digest]['path']
        else:
            relative=('12_ETL與排程/年度自動化/程式/' if p.suffix in ['.py','.mjs'] or not target.startswith('work/') else '01_官方原始資料/年度ETL補齊/')+target
            destination=SYSTEM/relative;destination.parent.mkdir(parents=True,exist_ok=True)
            if destination.exists() and sha(destination)!=digest:
                relative=relative.rsplit('/',1)[0]+'/'+digest[:12]+'-'+destination.name;destination=SYSTEM/relative
            if not destination.exists():shutil.copy2(p,destination)
            key=PREFIX+relative;added.append({'path':str(destination),'key':key,'sha256':digest})
        entries.append({'target':target,'key':key,'sha256':digest,'bytes':p.stat().st_size})
    manifest={'version':'G3-annual-engine-1','files':entries,'no_zip':True}
    dest=SYSTEM/'12_ETL與排程/年度自動化/bundle-manifest.json';dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    added.append({'path':str(dest),'key':PREFIX+dest.relative_to(SYSTEM).as_posix(),'sha256':sha(dest)})
    (ROOT/'bundle-upload.json').write_text(json.dumps({'files':added,'manifest_key':added[-1]['key'],'manifest_sha256':sha(dest),'needed_files':len(entries)},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'needed':len(entries),'new_files':len(added),'new_bytes':sum(Path(r['path']).stat().st_size for r in added)},ensure_ascii=False))
if __name__=='__main__':main()
