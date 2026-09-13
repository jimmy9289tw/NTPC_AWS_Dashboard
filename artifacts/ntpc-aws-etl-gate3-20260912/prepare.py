"""隔離年度重建環境；僅複製本案必要來源，原檔不動。"""
from pathlib import Path
import hashlib,json,shutil,zipfile
ROOT=Path(__file__).resolve().parent
SYSTEM=ROOT.parent/'NTPC_Youth_System_V1_20260912'
SRC=SYSTEM/'09_網站與完整原始碼/完整原始碼'
G2=ROOT.parent/'ntpc-aws-etl-gate2-20260912'
WORK=ROOT/'work'
ARCHIVE=ROOT.parent/'ntpc-lsf-v1-20260912/NTPC_Youth_LSF_V1_20260912/09_歷史完整成果/NTPC_Youth_Complete_Data_Package_G6_V5.32_20260908_R1.zip'
def copy_tree(src,dst):
    for p in src.rglob('*'):
        if not p.is_file() or '__pycache__' in p.parts or p.suffix=='.pyc':continue
        out=dst/p.relative_to(src);out.parent.mkdir(parents=True,exist_ok=True)
        if not out.exists():shutil.copy2(p,out)
def main():
    WORK.mkdir(exist_ok=True)
    for name in ['scripts','config','src']:
        copy_tree(SRC/name,WORK/name)
    for name in ['data','deliverables']:
        copy_tree(G2/'legacy-rebuild'/name,WORK/name)
    for name in ['scripts','app/data','data/raw','data/policy-ranking','public/data']:
        copy_tree(SRC/'dashboard'/name,WORK/'dashboard'/name)
    original=ROOT.parent.parent/'work/019fe05e-e1a3-71f2-840e-c026180d9474/NtpcYouthAI'
    raw=original/'deliverables/NTPC_Youth_18-35_Government_Open_Data_Package_V2.3_20260825/02_失業率/raw'
    for p in raw.glob('DGBAS-NTPC-*T4*-114*.xlsx'):
        target=WORK/'additional-inputs'/p.name;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():shutil.copy2(p,target)
    for p in (original/'dashboard/work/official-source-check').glob('DGBAS_*'):
        if p.suffix.lower() not in ['.xlsx','.xls']:continue
        target=WORK/'dashboard/work/official-source-check'/p.name;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():shutil.copy2(p,target)
    copy_tree(original/'dashboard/work/python-vendor/xlrd',WORK/'dashboard/work/python-vendor/xlrd')
    joint=Path('C:/Users/jimmy/.codex/visualizations/2026/09/06/01a0744a-e020-7313-9bd6-d90fcdf9c42b/ntpc-joint-population-110-114')
    for name in ['新北市及29區_年齡性別教育婚姻交叉人口_110至114年.csv','build_joint_data.py','verification.json']:
        target=WORK/'additional-inputs'/name;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():shutil.copy2(joint/name,target)
    records=[]
    with zipfile.ZipFile(ARCHIVE) as z:
        matches=[i for i in z.infolist() if not i.is_dir() and any(x in i.filename for x in ['DGBAS-NTPC-UR-AGE-T41-11412','DGBAS-NTPC-LABOR-AGE-T42-114H2','年齡性別教育婚姻交叉人口','official-source-check/','python-vendor/xlrd/'])]
        for i in matches:
            name=Path(i.filename).name
            if i.file_size>40*1024*1024 or i.filename.endswith('.zip'):continue
            target=WORK/'additional-inputs'/name
            if 'official-source-check/' in i.filename:target=WORK/'dashboard/work/official-source-check'/name
            if 'python-vendor/xlrd/' in i.filename:
                target=WORK/'dashboard/work/python-vendor/xlrd'/i.filename.split('python-vendor/xlrd/',1)[1]
            if not target.resolve().is_relative_to(WORK.resolve()):raise ValueError('路徑超出範圍')
            target.parent.mkdir(parents=True,exist_ok=True)
            body=z.read(i)
            if not target.exists():target.write_bytes(body)
            records.append({'member':i.filename,'path':target.relative_to(WORK).as_posix(),'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
        candidates=[{'name':i.filename,'bytes':i.file_size} for i in z.infolist() if not i.is_dir() and any(x in i.filename.lower() for x in ['joint','交叉人口','table41','table42','annual/table'])]
    report={'extracted':records,'other_candidates':candidates}
    (ROOT/'restoration.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'extracted':len(records),'candidates':candidates[:18]},ensure_ascii=False))
if __name__=='__main__':main()
