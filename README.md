# NTPC AWS Dashboard

新北青年政策決策工作台。整合人口結構、就業與失業、青年就業行情及薪資，以可追溯的官方資料支援政策研議。

此儲存庫保存 **2026-09-13 最新整合程式碼**，包含 AWS 網站、生成式 AI 引用查閱、月人口 ETL、年度統計重建，以及已部署的自動產表、通知與具名簽核流程。AWS 帳號、私有資源識別、通知信箱與 IP 白名單已改為設定範例，憑證及操作紀錄不納入公開原始碼。

公開期限為 **2026-12-31 23:59:59（Asia/Taipei）**，預定於 **2027-01-01 00:00（UTC+8）**轉為私人。到期執行方式與限制見 [公開期限](docs/PUBLICATION_POLICY.md)。

## 程式位置

| 路徑 | 內容 |
|---|---|
| `artifacts/ntpc-aws-platform-gate4-20260912/dashboard/` | React／TypeScript 五大主題頁、地圖、四象限、ROA 與引用查閱介面 |
| `artifacts/ntpc-aws-platform-gate4-20260912/` | 網站 Lambda、AI 引用與回答邏輯、本機展示、部署與測試 |
| `artifacts/ntpc-aws-etl-gate2-20260912/` | 月人口擷取、資料查核、版本清冊與 Scheduler |
| `artifacts/ntpc-aws-etl-gate3-20260912/` | 年度 CodeBuild 重建、來源清冊、資料轉換、統計估計與完整 QA |
| `artifacts/ntpc-aws-review-gate5-20260913/` | 控制／產表／管理者 API 三個 Lambda、Cognito、SNS、SQS、DynamoDB 與簽核入口 |
| `artifacts/ntpc-aws-review-gate5-20260913/prepared/` | **目前實際使用的月人口與年度 ETL 入口**，已加入查核控制器 |
| `analysis/` | 統計方法、欄位定義、決策規則、模型程式與既有方法說明 |
| `docs/` | 架構、公開設定、驗證範圍與原始碼清單 |

Gate2／Gate3 原始入口保留作為整合基準；正式入口使用 Gate5 的 `prepared/`。Gate5 部署程式會建立整合版本，並限制 ETL 直接寫入有效版本指標。保留原模組目錄名稱，讓整合補丁仍可依相鄰路徑建立。

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
