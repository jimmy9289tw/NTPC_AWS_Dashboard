# AWS V1.0 本機 Live demo

## 檔案位置

- 最新網站原始碼、AWS Lambda／AI 程式、部署工具：本資料夾及 `dashboard`。
- 00–14 完整資料、原始公開來源、長表、ETL 與方法文件：`D:\github\artifacts\NTPC_Youth_System_V1_20260912`。這是本機既有完整保存，不需再下載。
- 最新展示快照：本資料夾的 `live-bootstrap.json`、`roa-rules.json`、`roa-context.json`；教育×婚姻及地圖在 `dashboard/public/data`。
- 本次編譯：`dashboard/dist-public` 及 `dashboard/dist-internal`；網站使用這份新版程式，不使用 00–14 內的舊網站封存副本。
- 所有來源檔仍保留；本次未重新同步 00–14 至 S3，未變更 ETL 排程或模型。

## 開始錄製

1. 雙擊 `Start_Live_Demo.cmd`。會以本機 Python 啟動背景服務並開啟瀏覽器，不需 AWS 憑證、Node 或重新編譯。
2. 公開入口：<http://127.0.0.1:8893/>。
3. 決策入口：<http://127.0.0.1:8893/internal/?view=policy>。
4. 建議流程：首頁月人口 → 同月份跨年 → 29 區選淡水 → 114年／30–35歲／合計 → ROA → 點本次象限及支持證據 → 切 110 年展示「缺比較、仍可看證據」→ 自訂分析依性別比較。
5. 結束後執行 `Stop_Live_Demo.ps1`，只會停止此資料夾啟動的 Python demo 服務。

若電腦封鎖 PowerShell 腳本，可在此資料夾的終端機直接執行：

```powershell
& 'C:\Users\jimmy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -X utf8 .\preview_roa.py
```

手動開啟上述本機網址；結束按 Ctrl+C。請勿雙擊 HTML 檔，瀏覽器需要本機資料 API。

## 可以離線展示什麼？

人口、教育婚姻、就業失業、青年行業、薪資、29區地圖、ROA、資料表及 DIY 篩選都讀取固定本機公開統計快照。快照不在展示途中更新。年度與月度資料的實際期間仍分開標示。

AI 產生新回答、即時官方網頁查詢與官方外部連結需要網路及雲端服務。本機版遇到 AI 送出時會清楚說明未啟用，不用預製答案冒充即時 AI。錄製 AI 請切換正式 AWS 網站：<https://YOUR_DISTRIBUTION.cloudfront.net/>。

本機的公開／內網入口用於錄製流程，不模擬公網 IP 白名單。服務只監聽 `127.0.0.1`，其他電腦不能連入。本機啟动檔不部署 AWS、不啟用付費服務，也不自動執行 ETL。

搬到另一台電腦時，複製此資料夾（略過 `node_modules`、`.next`、快取）並安裝 Python 3.10+。已編譯版本不需要 Node；需要重新修改前端時，再依套件鎖定檔安裝相依套件。
