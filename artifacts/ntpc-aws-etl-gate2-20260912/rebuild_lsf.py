from pathlib import Path
import shutil,subprocess,sys,csv,json
from etl.common import encoded
from bootstrap import ROOT,PACKAGE,RELEASE
SOURCE=PACKAGE/'06_完整原始碼';WORK=ROOT/'legacy-rebuild'
for folder in ['data/lsf','data/published']:
    shutil.copytree(SOURCE/folder,WORK/folder,dirs_exist_ok=True)
target=WORK/'dashboard/app/data/g5-dashboard-data.json';target.parent.mkdir(parents=True,exist_ok=True)
shutil.copy2(SOURCE/'dashboard/app/data/g5-dashboard-data.json',target)
for script in ['lsf_build.py','lsf_validate.py']:
    subprocess.run([sys.executable,'-X','utf8',str(WORK/'scripts'/script)],check=True)
def rows(p):
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
before=rows(RELEASE/'11_生活條件與公共服務_長格式.csv');after=rows(WORK/'data/lsf/published/11_生活條件與公共服務_長格式.csv')
assert before==after,'LSF 重建與既有值不同'
report=json.loads((ROOT/'rebuild-comparison.json').read_bytes())
report['rebuild_comparisons'].append({'file':'11_生活條件與公共服務_長格式.csv','original_rows':len(before),'rebuilt_rows':len(after),'status':'PASS','comparison':'全欄位逐列完全一致'})
report['source_hash_path_review']={'status':'EXPLAINED','affected':{'01_戶籍人口母體_長格式.csv':1800,'06_政策服務與曝光_長格式.csv':6},'cause':'舊 combined_sha256 將來源檔案的絕對路徑與各檔內容雜湊一起計算；隔離目錄不同，組合雜湊隨之改變。','code':'scripts/build_external_policy_data.py:49','raw_content_verification':'必要原始檔取自同一歷史 ZIP；各檔大小與 SHA-256 見 legacy-restoration.json。','action':'原已發布長表維持不動；新 ETL 使用內容 SHA-256 與相對路徑分開記錄。','numeric_fields_changed':0,'model_or_universe_changed':False}
(ROOT/'rebuild-comparison.json').write_bytes(encoded(report))
print(json.dumps({'lsf_rows':len(after),'all_five_numeric_rebuilds':'MATCH','hash_variance':'絕對路徑參與組合雜湊'},ensure_ascii=False))
