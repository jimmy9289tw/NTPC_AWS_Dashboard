# NTPC AWS Dashboard

新北青年政策決策工作台。整合人口結構、就業與失業、青年就業行情及薪資，以可追溯的官方資料支援政策研議。

此儲存庫保存 **2026-09-13 最新整合程式碼**，包含 AWS 網站、生成式 AI 引用查閱、月人口 ETL、年度統計重建，以及已部署的自動產表、通知與具名簽核流程。AWS 帳號、私有資源識別、通知信箱與 IP 白名單已改為設定範例，憑證及操作紀錄不納入公開原始碼。

公開期限為 **2026-12-31 23:59:59（Asia/Taipei）**，預定於 **2027-01-01 00:00（UTC+8）** 轉為私人。到期執行方式與限制見 [公開期限](docs/PUBLICATION_POLICY.md)。

## GitHub 資料夾結構與用途

先找要完成的工作，再進入對應目錄：[網站程式](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/)、[資料與來源](artifacts/ntpc-aws-etl-gate3-20260912/fetch-registry.json)、[AWS 架構](docs/ARCHITECTURE.md)、[資料查核與簽核](artifacts/ntpc-aws-review-gate5-20260913/)。下圖列出實際存在的主要目錄與關鍵檔案，右側說明各自用途。

```text
NTPC_AWS_Dashboard/
├── README.md                                              ← 專案首頁、資料夾導覽與本機操作入口
├── .gitignore                                             ← 排除憑證、本機設定、依賴與建置產物
├── requirements.txt                                       ← Python 執行與資料處理套件
├── requirements-reports.txt                               ← 既有 Word、PDF 報告腳本的額外套件
├── docs/                                                  ← 本次公開版本的架構、設定與驗證說明
│   ├── ARCHITECTURE.md                                    ← AWS 資料與簽核架構、ROAMEF 循環
│   ├── CODEX_MAINTENANCE.md                               ← Codex 維護入口、修改與驗證流程
│   ├── CONFIGURATION.md                                   ← 部署設定、機密管理及移轉注意事項
│   ├── PUBLICATION_POLICY.md                              ← GitHub 公開期限與到期轉私人條件
│   ├── PUBLIC_RELEASE_VALIDATION.json                     ← 公開副本建置、測試與憑證檢查結果
│   └── source-provenance.json                             ← 原始碼來源路徑與內容雜湊
├── analysis/                                              ← 研究方法、共用模型與既有分析文件
│   ├── config/                                            ← 年齡組別、來源登錄與資料治理設定
│   ├── src/ntpc_youth_ai/                                 ← 共用統計分析、資料管線與治理模組
│   ├── scripts/                                           ← 估計、轉換、驗證與研究報告產製腳本
│   ├── schemas/                                           ← 整合契約、工具契約及稽核事件欄位
│   ├── tests/                                             ← 分析管線與治理規則測試
│   └── docs/                                              ← 研究與交接背景文件
│       ├── competition/                                   ← 既有競賽規劃與操作說明
│       ├── statistical-methods/                           ← 既有統計方法與可重算腳本
│       ├── lsf/                                           ← 生命階段分析、資料盤點及驗收紀錄
│       └── history/                                       ← 歷史報告文字與品質處理紀錄
└── artifacts/                                             ← 各階段的實作原始碼與整合版本
    ├── ntpc-aws-etl-gate2-20260912/                       ← Gate2：月人口 ETL 整合基準
    │   ├── etl/                                           ← 月人口擷取、驗證與版本處理
    │   ├── reviewed-sources.json                          ← 已查核的資料來源清單
    │   └── aws_deploy.py                                  ← 月人口 Lambda、IAM 與每日排程
    ├── ntpc-aws-etl-gate3-20260912/                       ← Gate3：年度資料及統計模型重建
    │   ├── fetch-registry.json                            ← 官方來源網址、下載與解析登錄
    │   ├── fetch_official.py                              ← 依來源清單取得官方資料
    │   ├── run_annual.py                                  ← 年度重建基準入口；簽核版見 Gate5
    │   ├── validate_rebuild.py                            ← 年度重建資料與模型品質檢查
    │   ├── deploy_annual.py                               ← CodeBuild 建置環境及執行設定
    │   ├── schedule_annual.py                             ← 年度來源每週檢查與重建排程
    │   └── work/                                          ← 年度重建使用的程式與輸入快照
    │       ├── config/                                    ← 年齡、資料來源與更新設定
    │       ├── scripts/                                   ← 年度資料轉換、估計及驗證程式
    │       ├── src/                                       ← 重建流程使用的共用 Python 模組
    │       └── dashboard/                                 ← 圖表資料生成腳本與 JSON 快照
    ├── ntpc-aws-platform-gate4-20260912/                  ← Gate4：現行 AWS 網站、ROA 與 AI
    │   ├── dashboard/                                     ← 網站介面與前端專案
    │   │   ├── app/                                       ← 五大主題、圖表、ROA、問答與匯出
    │   │   │   ├── data/                                  ← 網站隨附的 JSON 資料與欄位字典
    │   │   │   ├── aws-roa-model.ts                       ← ROA 指標比較、門檻及敏感度邏輯
    │   │   │   ├── aws-roa-quadrants.tsx                  ← 四象限與方案研議介面
    │   │   │   └── api/                                   ← 保留的原版 API；AWS 路由見 server.py
    │   │   ├── public/                                    ← 圖示、29 區邊界與靜態資料
    │   │   ├── data/policy-ranking/                       ← 行政區與全市青年指標排名 CSV
    │   │   ├── scripts/                                   ← 人口、薪資、排名與交叉資料生成
    │   │   ├── tests/                                     ← 圖表、ROA、資料解讀與權限回歸測試
    │   │   ├── design-system/                             ← 色彩、版面與元件設計規格
    │   │   ├── docs/                                      ← 網站歷次改動與設計紀錄
    │   │   ├── worker/                                    ← 保留的 Cloudflare 入口與登入程式
    │   │   ├── db/                                        ← 保留的原版資料庫結構與存取程式
    │   │   ├── vite.aws.config.mts                        ← AWS 公開版與內部版建置設定
    │   │   ├── package.json                               ← 網站建置、測試指令與套件需求
    │   │   └── package-lock.json                          ← 鎖定前端套件版本
    │   ├── server.py                                      ← 現行網站 Lambda 路由、驗證與讀取
    │   ├── system_reader_v2.py                            ← 有效資料清冊、版本及檔案讀取
    │   ├── ai_chat.py                                     ← AI 問答工作、模型呼叫與結果管理
    │   ├── ai_evidence.py                                 ← 問答證據、數據卡與官方引用整理
    │   ├── ai-official-sources.json                       ← AI 可引用的官方來源清單
    │   ├── roa-rules.json                                 ← ROA 指標、門檻、比較母體及分流規則
    │   ├── roa-context.json                               ← ROA 地方背景與政策研議參考
    │   ├── live-bootstrap.json                            ← 本機展示使用的官方統計彙整快照
    │   ├── preview_roa.py                                 ← 本機展示入口；不提供正式簽核權限
    │   ├── deploy.py                                      ← 網站、CloudFront、API 與 IAM 部署
    │   ├── deploy_ai.py                                   ← AI 問答相關 AWS 資源部署
    │   └── tests/                                         ← 網站存取、AI 與模型品質檢查
    └── ntpc-aws-review-gate5-20260913/                    ← Gate5：資料查核、自動產表與簽核
        ├── README.md                                      ← 查核流程、部署紀錄與待驗收項目
        ├── review_core.py                                 ← 案件狀態、復驗與核可發布規則
        ├── aws_control.py                                 ← 控制 Lambda：案件與有效版本切換
        ├── report_worker.py                               ← 產表 Lambda：Excel、S3 與 SNS 通知
        ├── review_api.py                                  ← 管理者 API：驗證身分、查詢與處置
        ├── review-ui.html                                 ← 管理者查核頁面
        ├── review-ui.js                                   ← 登入、案件查閱與簽核操作
        ├── review_client.py                               ← ETL 與查核控制器之間的呼叫契約
        ├── prepare_integration.py                         ← 將查核控制接入月人口與年度 ETL
        ├── prepared/                                      ← 目前使用的 ETL 整合入口
        │   ├── monthly/                                   ← 已加入查核控制的月人口 Lambda 程式
        │   └── annual/                                    ← 已加入查核控制的年度 CodeBuild 程式
        ├── deploy.py                                      ← 查核資源、登入、通知及 ETL 整合部署
        ├── settings.example.json                          ← 部署設定範例；真實設定不納入 Git
        └── test_review.py                                 ← 案件、簽核、發布與 Excel 產表測試
```

這份儲存庫的 `artifacts/` 保存各階段的實作原始碼。Gate2／Gate3 保留整合基準，**目前加入資料查核的月人口與年度 ETL 入口位於 Gate5 的 `prepared/`**；網站介面與 AWS 網站 Lambda 位於 Gate4。

Gate4 中的 `dashboard/worker/`、`dashboard/app/api/` 與 `dashboard/db/` 保留原版移植脈絡；現行 AWS 路由與存取控制請從 `server.py`、`deploy.py` 及 Gate5 管理者 API 查閱。`analysis/docs/` 的既有文件可能提及舊版路徑或狀態，接手時請以本頁及 `docs/` 的本版說明核對。

## 依工作找資料夾

| 想完成的工作 | 從哪裡開始 | 可以找到什麼 |
|---|---|---|
| 理解解決方案與操作流程 | [整體架構](docs/ARCHITECTURE.md)、[網站說明](artifacts/ntpc-aws-platform-gate4-20260912/README.md)、[管理者流程](artifacts/ntpc-aws-review-gate5-20260913/README.md) | 五大資料主題、政策研議、AWS 資料更新及異常處理；先掌握使用者與管理者各自的操作 |
| 重現網站或修改畫面 | [dashboard/app](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/app/)、[設計規格](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/design-system/)、[本機展示說明](artifacts/ntpc-aws-platform-gate4-20260912/Live_Demo_%E6%9C%AC%E6%A9%9F%E6%93%8D%E4%BD%9C%E8%AA%AA%E6%98%8E.md) | 圖表、篩選、29 區地圖、自訂分析與匯出介面；啟動步驟見下方「本機展示」 |
| 檢查 ROAMEF、決策分流與四象限 | [ROA 規則](artifacts/ntpc-aws-platform-gate4-20260912/roa-rules.json)、[計算模型](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/app/aws-roa-model.ts)、[象限與地方依據](artifacts/ntpc-aws-platform-gate4-20260912/ROA%E5%9B%9B%E8%B1%A1%E9%99%90%E8%AA%AA%E6%98%8E%E8%88%87%E5%9C%B0%E6%96%B9%E4%BE%9D%E6%93%9A_V1.1.md) | 比較母體、X／Y 門檻、估計跨界與地方背景；現行政策頁使用 R／O／A，完整 ROAMEF 循環見整體架構 |
| 查 AWS 存取權限與資料讀取 | [網站 Lambda](artifacts/ntpc-aws-platform-gate4-20260912/server.py)、[網站部署](artifacts/ntpc-aws-platform-gate4-20260912/deploy.py)、[管理者 API](artifacts/ntpc-aws-review-gate5-20260913/review_api.py) | 公開／內部路由、CloudFront 來源驗證、IP 判斷、IAM 與 Cognito 具名身分檢查 |
| 理解 AI 回答與引用邏輯 | [AI 操作與架構](artifacts/ntpc-aws-platform-gate4-20260912/AI%E5%95%8F%E7%AD%94%E6%93%8D%E4%BD%9C%E8%88%87%E6%9E%B6%E6%A7%8B_V1.md)、[問答程式](artifacts/ntpc-aws-platform-gate4-20260912/ai_chat.py)、[證據組裝](artifacts/ntpc-aws-platform-gate4-20260912/ai_evidence.py) | 資料如何成為回答依據、官方引用如何整理、模型如何呼叫與保存結果；本機展示不呼叫即時 AI |
| 取用網站分析資料 | [JSON 快照](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/app/data/)、[靜態地圖與交叉資料](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/public/data/)、[本機彙整快照](artifacts/ntpc-aws-platform-gate4-20260912/live-bootstrap.json) | 人口、勞動、薪資、29 區地理邊界等隨附資料；正式雲端資料由有效版本清冊讀取 |
| 查青年指標排名 | [排名 CSV](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/data/policy-ranking/)、[排名生成程式](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/scripts/build-policy-ranking-csv.mjs) | 行政區排名、全市年度與結構排名，以及生成邏輯；跨版本比較前需核對資料期與口徑 |
| 確認欄位、來源與追溯關係 | [欄位字典](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/app/data/export-code-book.json)、[官方來源登錄](artifacts/ntpc-aws-etl-gate3-20260912/fetch-registry.json)、[來源設定](analysis/config/)、[原始碼追溯](docs/source-provenance.json) | 欄位含義、官方下載網址、來源設定與程式碼來源雜湊；原始碼清單不等同逐列資料來源 |
| 檢查統計方法與估計程序 | [年齡轉換方法](analysis/docs/%E5%B9%B4%E9%BD%A1%E5%8D%80%E9%96%93%E8%BD%89%E6%8F%9B%E6%96%B9%E6%B3%95%E8%88%87%E4%BE%86%E6%BA%90%E5%B0%8D%E7%85%A7_V1.0.md)、[共用模組](analysis/src/ntpc_youth_ai/)、[年度重建腳本](artifacts/ntpc-aws-etl-gate3-20260912/work/scripts/) | 年齡拆分、人口與勞動估計、轉換與驗證；完整重算需另外備妥官方原檔與輸入資料 |
| 修改資料匯入與定期排程 | [現行 ETL 入口](artifacts/ntpc-aws-review-gate5-20260913/prepared/)、[月人口排程](artifacts/ntpc-aws-etl-gate2-20260912/aws_deploy.py)、[年度來源排程](artifacts/ntpc-aws-etl-gate3-20260912/schedule_annual.py) | 月人口每日檢查、年度來源每週檢查，以及接入查核控制器的執行程式；「年度」指資料類型 |
| 修改自動產表、通知與簽核 | [查核說明](artifacts/ntpc-aws-review-gate5-20260913/README.md)、[控制程式](artifacts/ntpc-aws-review-gate5-20260913/aws_control.py)、[Excel 與通知](artifacts/ntpc-aws-review-gate5-20260913/report_worker.py)、[查核介面](artifacts/ntpc-aws-review-gate5-20260913/review-ui.js) | 異常開案、舊版保留、三工作表 Excel、SNS 通知、復驗及具名核可發布 |
| 部署或移轉 AWS | [設定說明](docs/CONFIGURATION.md)、[CodeBuild 部署](artifacts/ntpc-aws-etl-gate3-20260912/deploy_annual.py)、[網站部署](artifacts/ntpc-aws-platform-gate4-20260912/deploy.py)、[查核整合部署](artifacts/ntpc-aws-review-gate5-20260913/deploy.py) | 各模組部署入口與設定範例；使用自己的 AWS 資源與執行環境憑證 |
| 由 Codex 接續維護 | [Codex 維護說明](docs/CODEX_MAINTENANCE.md)、[設定與移轉](docs/CONFIGURATION.md)、[原始碼來源](docs/source-provenance.json) | 現行程式入口、修改順序、資料與政策邊界、測試及部署驗證方式 |
| 檢查交付品質與待驗收項目 | [本版驗證](docs/PUBLIC_RELEASE_VALIDATION.json)、[前端測試](artifacts/ntpc-aws-platform-gate4-20260912/dashboard/tests/)、[查核測試](artifacts/ntpc-aws-review-gate5-20260913/test_review.py)、[管理者待驗收](artifacts/ntpc-aws-review-gate5-20260913/README.md) | 已執行的建置與測試、可重跑的測試程式，以及 SNS 收件、首次登入與真人簽核的驗收範圍 |

資料範圍：本庫隨附網站快照與排名 CSV；完整官方原始檔、雲端 S3 版本資料及產生後的查核 Excel 另由資料管線管理。目錄中的程式與文件不表示其雲端資源已在新帳號建立。

## 本機展示

需要 Python 3.12 與 Node.js 22.13 以上。

```bash
python -m pip install -r requirements.txt
cd artifacts/ntpc-aws-platform-gate4-20260912/dashboard
npm ci
npm run build
cd ..
python preview_roa.py
```

開啟 `http://127.0.0.1:8893/internal/?view=policy`。本機展示使用隨附的官方統計彙整快照，支援圖表與 ROA 操作；不提供 AWS 簽核權限，也不呼叫即時 AI。正式 AI 與管理者功能需要自己的 AWS 部署設定。

## 測試

```bash
cd artifacts/ntpc-aws-review-gate5-20260913
python -m unittest test_review -v
```

網站測試在 `dashboard/` 執行 `npm test`。完整年度重建需先備妥來源資料；原始官方大型下載檔、歷史壓縮包及建置產物不屬於此公開程式碼快照。下載清冊位於 Gate3 的 `fetch-registry.json`，可用 `python fetch_official.py --group all` 擷取列出的官方來源。完整重建的其餘固定背景輸入與 S3 套件清冊須由部署者另外備妥，不宣稱 clone 後即可從零重建全部歷史資料。

## AWS 部署與資料治理

詳見 [AWS 架構](docs/ARCHITECTURE.md) 與 [設定說明](docs/CONFIGURATION.md)。第一次在自己的帳號部署前，先設定自己的 S3 資料桶、有效版本、網站與 ETL，再設定 Gate5 查核模組。

- 合格且沒有待辦異常的批次可自動發布。
- 資料不合格時保留前一有效版本、開立查核案件，並自動產生 Excel。
- 已有異常的管線，即使復驗通過仍須管理者具名核可。
- 受理、已讀、Email 回覆或修改 Excel 都不構成發布授權。
- ROAMEF 保留完整政策循環；現行研議以 R／O／A 為主。M／E／F 仍需實際政策執行、監測與評估資料。
- 決策分流與四象限用於比較證據與政策研議，不代表個人風險或因果效果。

## 版本與驗證

本次上傳沿用已部署版本；先前部署驗證包含 27 項本機查核測試、12 項隔離 AWS 儲存整合測試、一次成功的月人口 ETL，以及正式佇列產生三工作表 Excel。通知收件及真人簽核仍需部署者完成 SNS 訂閱確認、Cognito 首次登入及後續驗收。

公開副本的檔案檢查與測試結果記錄於 [公開版本驗證](docs/PUBLIC_RELEASE_VALIDATION.json)。來源與內容雜湊記錄於 [原始碼追溯清單](docs/source-provenance.json)。
