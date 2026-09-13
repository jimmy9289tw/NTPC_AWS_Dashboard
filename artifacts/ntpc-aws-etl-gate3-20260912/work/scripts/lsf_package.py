"""Create a NEW local release. Never remove or overwrite the historical archive."""
from pathlib import Path
import shutil,hashlib,json,zipfile
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
OUTPUT=Path('D:/github/artifacts/ntpc-lsf-v1-20260912')
STAGE=OUTPUT/'NTPC_Youth_LSF_V1_20260912'
HISTORY=Path('D:/github/artifacts/ntpc-complete-v532/NTPC_Youth_Complete_Data_Package_G6_V5.32_20260908_R1.zip')
EXPECTED='d205bdd1691cd8721ad753aa94c88022ddc68019d9398c621d6d98af3af48673'
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()
def copy(src,dst):
    dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
def tree(src,dst,filter_source=False):
    for p in src.rglob('*'):
        if not p.is_file():continue
        rel=p.relative_to(src)
        if filter_source and any(s in {'.git','node_modules','dist','dist-lsf','.next','.vinext','.wrangler','.vite','__pycache__','.venv','cdk.out','.openai','qa-local'} for s in rel.parts):continue
        if filter_source and ((p.name.startswith(('.env','.dev.vars')) and not p.name.endswith('.example')) or p.suffix in {'.pem','.key','.p12','.log','.tsbuildinfo'} or p.name in {'credentials','.DS_Store','Thumbs.db'}):continue
        copy(p,dst/rel)
assert HISTORY.exists() and sha(HISTORY)==EXPECTED,'Historical archive identity mismatch'
assert not STAGE.exists(),'This version already exists; use a new release directory, never overwrite'
STAGE.mkdir(parents=True)
tree(ROOT/'docs/lsf',STAGE/'00_總覽與治理')
tree(ROOT/'data/lsf/raw',STAGE/'01_官方原始資料')
tree(ROOT/'data/lsf/published',STAGE/'02_標準化與來源關聯')
tree(ROOT/'docs/lsf',STAGE/'03_分析方法與決策樹')
copy(ROOT/'dashboard/app/lsf-rules.json',STAGE/'03_分析方法與決策樹/lsf-rules.json')
tree(ROOT/'data/lsf/qa',STAGE/'04_品質檢查與案例')
tree(ROOT/'dashboard/dist-lsf',STAGE/'05_本機互動原型')
tree(ROOT,STAGE/'06_完整原始碼',True)
tree(ROOT/'docs/competition',STAGE/'07_KIRO與AWS/原競賽合規說明')
copy(ROOT/'docs/lsf/03_KIRO與執行交接_V1.md',STAGE/'07_KIRO與AWS/LSF交接_V1.md')
tree(ROOT/'data/published',STAGE/'08_發布資料包')
tree(ROOT/'data/lsf/published',STAGE/'08_發布資料包')
# Mirrors resolve source_snapshot relative paths without depending on the historical zip.
tree(ROOT/'data/lsf/raw',STAGE/'08_發布資料包/data/lsf/raw')
copy(HISTORY,STAGE/'09_歷史完整成果'/HISTORY.name)
readme='''# 新北青年 LSF V1：完整整合資料包

本版先確認人口變化，再依六個生活面向整理支持或相反證據與下一轮問題。

## 從這裡開始

1. 讀00_總覽與治理的政策分析說明與雙輪決策樹。
2. 看04_品質檢查與案例的淡水、八里與瑞芳。
3. 最新發布CSV在08_發布資料包；11為本次新增背景層。
4. 06_完整原始碼保留目前儲存庫，含LSF原型、既有網站與KIRO資料。
5. 09_歷史完整成果包含原約620MB完整ZIP，原00–14分類、舊報告與大量原始資料全數原封保留，並非都展開在新版頂層。

## 原型操作

本機已有Python時，可在本資料夾執行：

    python -m http.server 4177 --bind 127.0.0.1 --directory 05_本機互動原型

接著開http://127.0.0.1:4177/。若需修改程式，依07_KIRO與AWS的交接文件啟動原始碼。

這是本機研究原型，不是正式網站更新。未commit/push/部署，也沒有啟用AWS或每日排程。不能把無認證的本機原型直接作公開政策頁。

## 資料範圍

新增793列、42欄，其中99列租金官方未提供值。出生與遷徙為全年齡；115年3月租金及115年據點為另期背景。青年薪資仍只到113年。交通、用電、幼兒人口及服務負擔尚待介接。

## 路徑說明

06為可重建的儲存庫根目錄，所有程式內相對路徑以它為準。08內附新來源鏡像可解讀11CSV；舊列來源仍依舊資料包與06的原目錄說明解析。舊catalog保持原樣，新來源請看lsf-catalog.json。manifest.json記錄本包每個檔案的SHA-256。
'''.replace('下一轮','下一輪')
(STAGE/'先讀我.md').write_text(readme,'utf-8')
manifest=[dict(path=p.relative_to(STAGE).as_posix(),bytes=p.stat().st_size,sha256=sha(p)) for p in sorted(STAGE.rglob('*')) if p.is_file()]
(STAGE/'manifest.json').write_text(json.dumps({'createdAt':datetime.now(timezone.utc).isoformat(),'historicalZipSha256':EXPECTED,'files':manifest},ensure_ascii=False,indent=2),'utf-8')
target=OUTPUT/'NTPC_Youth_LSF_V1_Full_20260912.zip'
assert not target.exists(),'Do not overwrite an existing release archive'
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
    for p in sorted(STAGE.rglob('*')):
        if p.is_file():z.write(p,arcname=STAGE.name+'/'+p.relative_to(STAGE).as_posix(),compress_type=zipfile.ZIP_STORED if p.suffix=='.zip' else zipfile.ZIP_DEFLATED)
with zipfile.ZipFile(target) as z:
    bad=z.testzip();assert bad is None,bad
    history_member=STAGE.name+'/09_歷史完整成果/'+HISTORY.name
    with z.open(history_member) as f:
        h=hashlib.sha256()
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    assert h.hexdigest()==EXPECTED,'Nested historical archive changed'
report={'archive':str(target),'bytes':target.stat().st_size,'sha256':sha(target),'files':len(manifest)+1,'crcPassed':True,'historicalArchivePreserved':True,'noExternalUpload':True}
(OUTPUT/'package-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
print(json.dumps(report,ensure_ascii=False))
