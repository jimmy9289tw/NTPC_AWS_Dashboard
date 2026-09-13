"""建立 00–14 單一系統交付包；原來源檔不改寫；保留逐檔遷移對照。"""
from pathlib import Path
import csv,json,hashlib,shutil,re,html
from etl.common import encoded,now,digest
from bootstrap import ROOT,PACKAGE,RELEASE
BASE=ROOT.parent;OUT=BASE/'NTPC_Youth_System_V1_20260912'
FOLDERS=['00_系統入口與版本','01_官方原始資料','02_標準化與來源追溯','03_匯聚長表與資料字典','04_戶籍人口與地區分析','05_勞動市場與青年行業','06_薪資與發展','07_政策排名與比較','08_ROA與四象限','09_網站與完整原始碼','10_品質查核與測試','11_報告與操作說明','12_ETL與排程','13_AWS架構與部署','14_歷史沿革與移轉紀錄']
USE=['先讀系統地圖、有效資料入口與目前完成範圍','政府公開來源及新北市原始列，保留來源回執','来源主檔、資料列關聯與三母體介接規則','五份核心長表、月人口初始化快照及資料字典','年度人口、教育婚姻、地圖與月資料歷史基準','勞動市場、居住就業者與青年行業結構','青年薪資、行業薪資與既有估計方法','行政區排名、全市歷年及結構排名','目前採用的 ROA、分級規則與四象限','完整接手程式碼及既有本機原型；不代表 AWS 網站已上線','本次與上次的查核結果、測試程式及差異說明','ETL 執行碼、基準、原始擷取、版本與有效資料指標','Codex／boto3 操作、最小權限與部署實測紀錄','舊版說明、歷史 manifest、逐檔移轉及清除紀錄']
USE[2]='來源主檔、資料列關聯與三母體介接規則'
USE.insert(11,'解決方案、資料方法、閱讀順序與既有分析說明')
assert len(FOLDERS)==len(USE)==15
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def write(relative,text):
    p=OUT/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
def destination(rel):
    parts=Path(rel).parts;first=parts[0];tail=Path(*parts[1:])
    roots={'NTPC_Youth_ROA_Update_V1_20260912':'ROA正式套件','_ROA_build':'ROA建置工具','ntpc-youth-policy-quadrants-v1-20260912':'全類別四象限','ntpc-youth-population-quadrants-20260912':'人口四象限'}
    if first in roots:return Path(FOLDERS[8])/roots[first]/tail
    if first!='ntpc-lsf-v1-20260912':return Path(FOLDERS[14])/'前次上傳紀錄'/first
    if len(parts)<3 or parts[1]!=PACKAGE.name:return Path(FOLDERS[14])/'LSF外層紀錄'/tail
    section=parts[2];rest=Path(*parts[3:])
    mapping={'00_總覽與治理':11,'01_官方原始資料':1,'02_標準化與來源關聯':2,'03_分析方法與決策樹':8,'04_品質檢查與案例':10,'05_本機互動原型':9,'06_完整原始碼':9,'07_KIRO與AWS':14,'09_歷史完整成果':14}
    if section in mapping:
        sub={'03_分析方法與決策樹':'LSF背景分析方法','05_本機互動原型':'LSF本機原型','06_完整原始碼':'完整原始碼','07_KIRO與AWS':'舊KIRO與AWS說明_僅供沿革','09_歷史完整成果':'歷史資料說明'}.get(section,'LSF既有文件')
        return Path(FOLDERS[mapping[section]])/sub/rest
    if section!='08_發布資料包':return Path(FOLDERS[14])/'LSF原根目錄'/Path(*parts[2:])
    name=rest.name;top=rest.parts[0]
    if top=='政策排名_交付修正版':return Path(FOLDERS[7])/'目前排名'/Path(*rest.parts[1:])
    if top=='政策排名':return Path(FOLDERS[14])/'舊政策排名'/Path(*rest.parts[1:])
    if top=='地圖與教育婚姻交叉':return Path(FOLDERS[4])/rest
    if top=='網站最新快照':
        group=6 if any(x in name for x in ['wage','salary']) else 5 if 'employment' in name else 4
        if name=='export-code-book.json':group=3
        return Path(FOLDERS[group])/'既有網站資料快照'/name
    if name[:2] in ['01','02','03','06','11'] and name.endswith('.csv'):return Path(FOLDERS[3])/name
    if name[:2] in ['04','05','07','08'] and name.endswith('.csv'):return Path(FOLDERS[2])/name
    if name.startswith('code_book') or name=='external_metric_code_book.csv':return Path(FOLDERS[3])/name
    if name.startswith('09_月度'):return Path(FOLDERS[4])/'歷史110至114年月資料'/name
    if name.startswith('10_新北市居住'):return Path(FOLDERS[5])/name
    return Path(FOLDERS[14])/'原發布包目錄與附屬檔'/rest

def main():
    OUT.mkdir(exist_ok=True)
    for name,use in zip(FOLDERS,USE):
        (OUT/name).mkdir(exist_ok=True)
        write(name+'/README.md',f'# {name}\n\n{use}。\n\n回到 [系統入口](../00_系統入口與版本/README.md)。\n')
    sources=[];mapped={}
    def copy(p,relative,kind,old_key=None,expected=None):
        if p.is_symlink():raise ValueError('不複製符號連結')
        if p.suffix.lower()=='.zip':raise ValueError('不複製 ZIP')
        target=(OUT/relative).resolve()
        if not target.is_relative_to(OUT.resolve()):raise ValueError('路徑超出新版目錄')
        h=sha(p)
        if expected and h!=expected:raise ValueError('原始檔已與前次上傳不同：'+p.name)
        if target.exists() and sha(target)!=h:
            if kind in ['new-etl-code','new-engineering-code','gate2-evidence']:shutil.copy2(p,target)
            else:raise ValueError('目標檔案已存在且不同：'+str(relative))
        if not target.exists():target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
        assert sha(target)==h
        row={'new_path':Path(relative).as_posix(),'bytes':target.stat().st_size,'sha256':h,'kind':kind}
        if old_key:row['old_s3_key']=old_key;mapped[old_key]=row
        sources.append(row)
    previous=json.loads((BASE/'ntpc-s3-upload-20260912/upload-result.json').read_bytes())['files']
    for row in previous:
        rel=row['key'].removeprefix('releases/20260912-roa-v1/')
        p=BASE/rel
        if rel in ['00_本次上傳說明.md','upload-manifest.json']:p=BASE/'ntpc-s3-upload-20260912'/rel
        copy(p,destination(rel),'previous-upload-preserved',row['key'],row['sha256'])
    # 額外原始檔：必要舊 ZIP 成員已依同意取出，ZIP 本體留在本機。
    for folder in ['data/raw','deliverables']:
        for p in (ROOT/'legacy-rebuild'/folder).rglob('*'):
            if p.is_file() and p.suffix.lower()!='.zip':copy(p,Path(FOLDERS[1])/'年度重建必要來源'/p.relative_to(ROOT/'legacy-rebuild'),'restored-public-input')
    for p in (ROOT/'public-inputs').rglob('*'):
        if p.is_file():copy(p,Path(FOLDERS[1])/'教育婚姻_新北市原始列'/p.relative_to(ROOT/'public-inputs'),'official-ntpc-subset')
    for p in (ROOT/'runtime-local').rglob('*'):
        if p.is_file():copy(p,Path(FOLDERS[12])/'runtime'/p.relative_to(ROOT/'runtime-local'),'etl-runtime')
    for p in (ROOT/'etl').glob('*.py'):copy(p,Path(FOLDERS[12])/'程式/etl'/p.name,'new-etl-code')
    for p in ROOT.glob('*.py'):copy(p,Path(FOLDERS[12])/'程式'/p.name,'new-engineering-code')
    for p in ROOT.glob('*.json'):
        if not p.name.startswith('probe-'):copy(p,Path(FOLDERS[10])/'Gate2'/p.name,'gate2-evidence')
    for p in ROOT.glob('aws-*.json'):copy(p,Path(FOLDERS[13])/p.name,'gate2-evidence')
    for p in ROOT.glob('*.md'):copy(p,Path(FOLDERS[11])/'本次整合說明'/p.name,'new-engineering-code')
    copy(ROOT/'aws_deploy.py',Path(FOLDERS[13])/'aws_deploy.py','new-engineering-code')
    for p in (BASE/'ntpc-aws-gate1-20260912').iterdir():
        if p.is_file() and p.suffix in ['.md','.json','.csv','.ipynb','.py']:copy(p,Path(FOLDERS[10])/'Gate1_前次查核'/p.name,'gate1-evidence')
    for sub in ['scripts','config','src']:
        for p in (ROOT/'legacy-rebuild'/sub).rglob('*'):
            if p.is_file() and p.suffix in ['.py','.json','.toml']:copy(p,Path(FOLDERS[12])/'年度重建程式'/p.relative_to(ROOT/'legacy-rebuild'),'legacy-rebuilder')
    pointer=json.loads((ROOT/'runtime-local/current/monthly.json').read_bytes())
    manifest=json.loads((ROOT/'runtime-local'/pointer['manifest_key']).read_bytes())
    monthly=manifest['files']['monthly-population.json'];mdata=json.loads((ROOT/'runtime-local'/monthly['key']).read_bytes())
    csvref=manifest['files']['09_戶籍人口月度_長格式.csv']
    copy(ROOT/'runtime-local'/csvref['key'],Path(FOLDERS[3])/'月人口初始化快照_11001至11508.csv','initial-monthly-snapshot')
    datasets={}
    for key,row in mapped.items():
        if '/08_發布資料包/' in key and row['new_path'].startswith((FOLDERS[2],FOLDERS[3])):
            datasets[Path(row['new_path']).name]={'path':row['new_path'],'sha256':row['sha256'],'mode':'validated-fixed-snapshot'}
    datasets['月人口_有效版本']={'pointer':FOLDERS[12]+'/runtime/current/monthly.json','base':FOLDERS[12]+'/runtime/','mode':'validated-live-component','source_period_max_at_pack':mdata['meta']['sourcePeriodMax']}
    write(FOLDERS[0]+'/system-catalog.json',json.dumps({'system_version':'NTPC-System-V1-20260912','created_at':now(),'framework':'ROA','operator':'Codex','region':'us-west-2','datasets':datasets,'website_status':'尚未在本 AWS 帳號完成網站部署','annual_etl_status':'五長表離線重建數值一致；年度來源及衍生模型自動更新尚未啟用','monthly_status':'官方11001至11508月資料通過本機ETL；AWS實際狀態見13資料夾','policy_rules_changed':False,'old_source_untouched':True},ensure_ascii=False,indent=2))
    table='\n'.join(f'| [{name}](../{name}/README.md) | {use} |' for name,use in zip(FOLDERS,USE))
    write(FOLDERS[0]+'/README.md','# 新北青年政策決策工作台｜整合系統 V1\n\n這是 00–14 的單一交付入口。以 ROA 作為政策分析架構，Codex／boto3 作為 AWS 操作工具。ZIP 不上傳 S3。\n\n## 建議閱讀順序\n\n先看 03 的資料，再看 07 排名及 08 ROA；網站工程從 09 開始，更新流程看 12，AWS 實測看 13。\n\n| 目錄 | 放什麼 |\n|---|---|\n'+table+'\n\n## 哪一份是有效資料？\n\n- 程式統一讀取本資料夾的 `system-catalog.json`；月人口再解析指向的 current／manifest，不能只依檔名猜最新版本。\n- 年度戶籍與勞動保留 110–114 年；薪資維持可用的 110–113 年；服務與生活背景依各列 source_period。\n- 月人口補至 115 年 8 月，並新增 42 欄長表；03 的月資料是本次初始化快照，排程之後的新資料以 12 的有效版本為準。\n- 月度與年度的統計時間不同，不補造 115 年完整年度值。戶籍、居住就業者與工作場所薪資三母體不互換。\n- 09 保留既有完整接手程式碼，未冒稱已完成 AWS 網站、登入或 AI 問答串接。\n- 14 的舊 KI​​RO／ROAMEF 文件只作沿革，不能覆蓋本次 ROA／Codex 規格。\n\n## 查核與刪除順序\n\n逐檔本機校驗 → 上傳新路徑 → S3 讀回雜湊比對 → 更新唯一入口 → 只刪除已有完整映射的舊前綴物件。本機原檔及原 ZIP 保留。\n')
    write(FOLDERS[13]+'/README.md','# AWS 執行方式\n\n區域固定 us-west-2。使用 boto3 default credentials 或 AWS 執行角色，不在檔案寫入憑證。\n\n- 系統 S3：`s3://ntpc-youth-data-000000000000/NTPC_Youth_System_V1_20260912/`。\n- S3 四項公開存取封鎖維持啟用；資料預設 AES256 靜態加密。\n- 月資料用 Lambda 執行，最長 900 秒、1GB 記憶體、同時只執行 1 份；CloudWatch 紀錄保留 14 天。\n- Scheduler 預定臺灣時間每日 09:15；只有實際 Lambda 執行通過才啟用。狀態以本目錄最新 `aws-schedule.json` 為準，無檔案即不可視為已排程。\n- 年度五長表已驗證離線重建；自動擷取新版年報、重算行業／薪資模型及連動排名仍須逐項接通，不能以月資料排程代替。\n- 舊部署命令含既有正式站設定，只作架構參考；尚未在此 AWS 帳號完成網站部署。\n- Workshop 憑證或環境到期後，排程不保證繼續存在；重新取得授權後先用 STS 核對帳號，再檢查函式及排程。\n\n## 架構\n\n```mermaid\nflowchart TD\n  A[政府公開來源] --> B[月人口 ETL：完整分頁與欄位驗證]\n  T[Scheduler 每日 09:15] --> B\n  B --> C[私有 S3：原始擷取與版本]\n  C --> D{資料規則與發布讀回通過}\n  D -->|是| E[current 指標切換至完整版本]\n  D -->|否| F[保留上次成功資料並記錄錯誤]\n  G[年度五長表離線重建] --> H[年度自動化待接通]\n  E --> I[統一 system-catalog 供後續網站取用]\n```\n')
    write(FOLDERS[12]+'/README.md','# ETL 與排程\n\n月人口：擷取官方年月目錄、全部分頁，統一兩種官方欄位名稱，檢查村里重複、29 區、年齡、男女及全市加總。歷史年底值改動時先擋下，避免新月資料與年資料失配。\n\n每日重查最新兩月及輪替一個歷史月；有新月份一併補入。擷取或驗證失敗不切換有效版本。無變更只留檢查紀錄。來源時間與檢查時間分開。\n\n`runtime/current/monthly.json` → 不可覆寫的 manifest → JSON／CSV；發布使用 If-Match，避免兩個執行互相蓋掉。回復時先驗證舊 manifest 所列檔案，使用 current 的最新 ETag 條件式切回，不能直接刪新版本。\n\n年度重建驗證不等於年度自動更新：教育、婚姻、人力、薪資與服務仍依既有模型與已驗證快照；新資料須完成依賴驗證後才能更新全套排名與 ROA。\n\n本包工程腳本保留此次實作路徑，入口參數以 `bootstrap.py`、`aws_deploy.py` 為主；`年度重建程式` 為原方法重現，執行前將來源目錄指向 01，勿改原始資料包。\n')
    write(FOLDERS[14]+'/README.md','# 歷史沿革與移轉紀錄\n\n此處保留旧版來源描述與目前不使用的 Kiro 說明，供追溯，不是新系統操作入口。\n\n`migration-map.json` 逐筆記錄舊 S3 Key、新相對路徑、大小及 SHA-256；只有新物件讀回一致且舊物件未被他人改動，才列入刪除。原始資料與 ZIP 在本機保留，可依對照表重建舊路徑。\n'.replace('旧','舊'))
    write(FOLDERS[14]+'/migration-map.json',json.dumps({'previous_prefix':'releases/20260912-roa-v1/','new_prefix':OUT.name+'/','files':list(mapped.values())},ensure_ascii=False,indent=2))
    # 本機可點的純索引，不冒充正式網站。
    cards=''.join(f'<li><a href="{name}/README.md">{name}</a><p>{html.escape(use)}</p></li>' for name,use in zip(FOLDERS,USE))
    write('index.html','<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>新北青年整合系統｜目錄</title><style>body{font:17px/1.7 system-ui;max-width:1120px;margin:auto;padding:32px;background:#f5f8fa;color:#19324a}h1{font-size:30px}ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px;padding:0}li{list-style:none;background:white;border:1px solid #d9e2ec;border-radius:12px;padding:16px}a{color:#0b2f47;font-weight:700}p{font-size:15px}header{border-left:5px solid #0f766e;padding-left:20px}</style><header><h1>新北青年政策決策工作台</h1><p>00–14 整合系統交付目錄 · ROA · Codex / AWS</p><p>這是資料與程式碼索引；AWS 網站部署狀態請看 13。</p></header><ul>'+cards+'</ul></html>')
    # 新增的說明與檔案都納入目前快照 manifest；日後 runtime/current、runs 明列為動態。
    files=[];sensitive=[]
    for p in sorted(OUT.rglob('*')):
        if not p.is_file() or p.name=='system-manifest.json':continue
        if p.suffix.lower()=='.zip':raise ValueError('發現 ZIP')
        if p.suffix.lower() in ['.py','.js','.mjs','.ts','.tsx','.json','.md','.toml','.yaml','.yml','.env'] and p.stat().st_size<8_000_000:
            text=p.read_text('utf-8',errors='replace')
            if re.search(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{36,}',text):sensitive.append(p.relative_to(OUT).as_posix())
        rel=p.relative_to(OUT).as_posix();files.append({'path':rel,'bytes':p.stat().st_size,'sha256':sha(p),'mutable_runtime':rel.startswith(FOLDERS[12]+'/runtime/current/') or rel.startswith(FOLDERS[12]+'/runtime/runs/')})
    if sensitive:raise ValueError('敏感模式檢查未通過：'+str(sensitive))
    report={'created_at':now(),'version':'NTPC-System-V1-20260912','folders':FOLDERS,'files':files,'file_count':len(files),'total_bytes':sum(r['bytes'] for r in files),'migrated_original_objects':len(mapped),'zips':0,'secret_pattern_hits':0,'integrity_scope':'建立當下的快照；runtime/current 與 runs 之後會由已授權 ETL 更新'}
    write('system-manifest.json',json.dumps(report,ensure_ascii=False,indent=2))
    (ROOT/'system-build-result.json').write_bytes(encoded({k:v for k,v in report.items() if k!='files'}))
    print(json.dumps({k:v for k,v in report.items() if k not in ['files','folders']},ensure_ascii=False),flush=True)
if __name__=='__main__':main()
