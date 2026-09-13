from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent
state=json.loads((ROOT/'final-system-status.json').read_bytes())
payload={'schemaVersion':1,'items':[
 {'id':'system-migration','title':'00–14 整合包與舊 S3 清理','queries':[{'id':'migration-result','source':{'label':'S3 移轉與讀回查核','files':[{'label':'final-system-status.json'},{'label':'system-upload-result.json'},{'label':'old-s3-cleanup-result.json'}],'filters':['範圍：本案既有私有 S3 桶','新目錄：NTPC_Youth_System_V1_20260912','舊目錄：releases/20260912-roa-v1'],'caveats':['本機原始檔與 ZIP 保留，可依移轉對照表還原舊路徑。']},'summary':f"新版本 {state['uploaded_and_hash_verified']} 個快照檔案完成 SHA-256 讀回比對，舊路徑刪除 {state['old_objects_deleted']} 個已映射物件；沒有上傳 ZIP。"}]},
 {'id':'monthly-etl','title':'月人口更新及每日排程','queries':[{'id':'real-scheduler-run','source':{'label':'官方月人口與 AWS 實測','files':[{'label':'aws-invoke.json'},{'label':'aws-schedule.json'},{'label':'scheduler-probe-result.json'}],'links':[{'label':'戶政司月人口資料目錄','href':'https://data.gov.tw/dataset/77132'}],'filters':['地理：新北市及29行政區','年齡：18–35、18–24、25–29、30–35歲','性別：男、女及合計'],'caveats':['更新範圍是月人口，不把115年月資料冒充完整年度值。']},'summary':f"月資料目前至115年8月，共 {state['monthly_rows']} 列。每日臺灣時間09:15排程已啟用；單次排程投遞實測通過，資料未變動時不重複發布。"}]},
 {'id':'remaining-integration','title':'年度重建已核對，完整網站尚未上線','queries':[{'id':'rebuild-and-gaps','source':{'label':'Gate 2 重建比對','files':[{'label':'rebuild-comparison.json'},{'label':'system-integration-check.json'}],'caveats':['五長表固定快照的數值重建一致，不代表新版年度資料、衍生模型與排名都已能排程自動刷新。','AWS 網站、登入授權、受控下載與AI問答仍待整合。']},'summary':'現有公式、資料母體與政策分級規則未更改；來源內容與檔案位置的雜湊差異另有記錄。'}]}
]}
(ROOT/'reviewed-sources.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
