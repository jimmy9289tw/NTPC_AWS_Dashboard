# AWS 資料查核、產表、通知與具名簽核

2026-09-13｜**AWS 部署已完成；雲端查核機制與自動產表已驗證。SNS 訂閱確認、管理者首次登入及真人簽核驗收尚待完成。**

通知地址與初始管理者地址已寫入 `settings.json`：`admin@example.com`。

正式管理者入口：[新北青年資料｜管理者查核](https://YOUR_DISTRIBUTION.cloudfront.net/review/)。入口沿用本案指定 IP 限制。Cognito 登入頁已在瀏覽器開啟並填入管理者 Email，密碼由管理者自行輸入及設定。

## 本次部署與驗證結果

| 項目 | 已取得的證據 | 驗證範圍 |
|---|---|---|
| 雲端資源 | 三個 Lambda 均 Active／Successful；DynamoDB ACTIVE，時間點還原已啟用；CloudFront Deployed | 實際 AWS 讀回 |
| 發布權限 | 月人口與年度 ETL 只能交由控制器更新 current；原角色直接寫入受到 Explicit Deny 限制 | 實際 IAM 政策及 ETL 設定 |
| 網站與登入入口 | 公開入口、查核 HTML 與登入設定均 HTTP 200；未登入查案件 HTTP 401；瀏覽器正常顯示查核頁及 Cognito 登入頁 | 尚未完成管理者首次密碼設定與登入後操作 |
| 月人口 ETL | 成功執行，NO_CHANGE，24,480 筆，最新資料期 11508；約 109 秒 | 真實雲端 Lambda 執行，詳見 monthly-live-result.json |
| 舊版保留與簽核控制 | 12 項隔離 AWS 儲存整合檢查通過；包含未復驗不可核可、過期修訂、錯誤雜湊、S3 ETag 衝突、延遲重送與發布回執 | 使用真實 S3／DynamoDB 和相同狀態機；測試身分不是實際 Cognito 管理者 |
| 自動產表 | 正式 SQS → 產表 Lambda → 私有 S3，成功產生三張工作表；已下載並以獨立 Excel 讀取器確認 | DRILL-20260913T023124Z 是已結案的部署測試，不是真實資料異常，也不發布資料 |
| Email | SNS 訂閱已建立；Cognito 已接受寄送管理者邀請的請求 | SNS 仍為 PendingConfirmation，尚未宣稱查核通知寄達 |
| 原有資料與網站 | 月人口及年度有效指標雜湊與部署前相同，網站 Lambda 程式雜湊不變 | 實際 AWS 讀回 |

管理者需在 `admin@example.com` 點選 SNS 郵件的 **Confirm subscription**，並使用 Cognito 邀請完成首次密碼設定。完成後，登入查核入口下載部署測試表。首次真人登入、通知收件與實際異常案件簽核尚未驗收；年度 CodeBuild 本次完成串接與設定核對，未另外啟動整年度重建。

部署過程依 Workshop 額度調整：控制 Lambda 保留併發 1、產表 Lambda 保留併發 2，查核 API 使用帳號共用併發額度，HTTP API 另設每秒 5 次、突發 10 次的節流。所有臨時 AWS 憑證交接檔均於程序啟動前刪除，不納入交付檔。

## 處理流程

1. 月人口 Lambda／年度 CodeBuild 依原排程執行。來源、解析、資料或模型查核失敗時，保留目前有效版本，保存失敗紀錄，交由控制 Lambda 開案。
2. 控制 Lambda 保存不可覆寫的案件修訂快照，以 DynamoDB 維護案件狀態及管線待辦。重複事件回到同案，不重複核可；已結案的重送事件不重新開案。
3. 控制 Lambda 送出 SQS 產表工作。產表／通知 Lambda 產生完整 Excel，包含「管理者查核表」「問題明細」「處置與簽核紀錄」，存入私有 S3。問題數不限於原範本的 30 列；單一儲存格超過 Excel 容量時明確失敗，不靜默截斷。
4. 收件人完成 SNS Email 訂閱確認後，寄送案件摘要及管理者入口。SNS 接受寄送不代表已寄達或已讀。訂閱未確認時，查核表先保存，工作依 SQS 重試與失敗佇列追蹤。
5. 管理者從原 CloudFront 網站的 `/review/` 入口，以 Cognito 具名登入。原本指定 IP 限制保留；IP 不當成人的簽核身分。
6. 管理者可受理、退回、等待官方補件或駁回。這些處置都不發布資料。修正責任人修正來源／程式後重跑原 ETL；網站未提供自動修資料或一鍵更改官方值功能。
7. 已有異常案件的管線，即使重跑通過也先成為待簽核候選。管理者確認候選雜湊、理由及復驗資料後，由控制 Lambda 再驗證 Cognito 身分、清冊、每個檔案、QA 及 current 基準，再以條件式寫入切換有效版本。
8. 發布完成保存回執；在 S3 切換成功後遇到紀錄寫入中斷，定期對帳會依目前指標回復結案，不重複切換。若核可前 current 或候選內容已變更，停止放行並重新查核。

一般沒有異常、也沒有管線待辦案件的完整合格批次仍可自動發布。四象限與既有統計估計規則不因新增簽核而改變。

## 為何拆成三個 Lambda

| 元件 | 責任 | 不授予的能力 |
|---|---|---|
| 查核／發布控制 Lambda | 案件狀態、事件去重、候選驗證、具名核可複核、current 切換、回執對帳 | 不代替人員決定政策、不接受 Excel 內的姓名當成簽核 |
| 產表／通知 Lambda | 依案件快照產生 Excel、保存檔案、SNS 摘要通知、失敗重試 | 沒有寫入 current 或核可案件的權限 |
| 管理者 API Lambda | 查閱案件、下載查核表、接受處置請求；API Gateway JWT 與伺服器再驗證身分 | 沒有直接改 current 的權限 |

產表與 Email 較容易因暫時性服務錯誤重試，故放進獨立 SQS 工作佇列。控制 Lambda 保留併發 1，搭配 DynamoDB 修訂條件及 S3 If-Match，串行處理發布與簽核。長時間復核若超過網頁等待時間，介面回覆「結果尚未確認」，要求重新整理案件，不宣稱已核可成功。

## 資料與權限

- 新增資源命名以 `ntpc-youth-review-v1` 為前綴，區域為 `us-west-2`，帳號限定 `000000000000`。
- 使用既有私有 S3 的 `NTPC_Youth_System_V1_20260912/13_資料查核與簽核/` 前綴保存案件與報表。
- 發布資料仍沿用既有月人口與年度發布清冊及版本格式，網站／ROA／AI 繼續讀取有效版本。
- 月人口及年度 ETL 的角色加上只能呼叫本案控制 Lambda 的權限，並以獨立 Explicit Deny 禁止直接改寫／刪除 current；原有其他政策保留。
- 管理者登入採 OAuth authorization code＋PKCE；access token 只在瀏覽器記憶體中保存。Cognito subject 由伺服器驗證，不能由填寫姓名、Email 或 Excel 修改取代。
- 查核表全部以明確文字儲存外部內容，不把 `=HYPERLINK(...)` 等來源內容寫成公式；不匯入 Excel 做簽核。
- 新增 Lambda 日誌保留 30 天。案件與簽核快照不套用 AI 短期 TTL。長期稽核資料保留政策應依正式作業規範決定，這版不自動刪除。

## 執行與驗證

預設只建立本機整合補丁與部署計畫，不呼叫 AWS 寫入 API：

```powershell
python deploy.py
python -m unittest -v test_review
```

`prepared/` 內含本次已部署的月人口與年度 ETL 版本；既有 Gate2／Gate3 原始檔不覆寫。`baseline-hashes.json` 鎖定補丁基準，`integration.patch` 可直接檢視差異。

在使用者授權的 AWS Workshop 臨時工作階段中，本次已執行：

```powershell
python deploy.py --apply
```

部署會建立專案資源與具名入口、套入 ETL 補丁、限制 current 寫入者，最後建立 SNS Email 訂閱並向初始管理者寄送 Cognito 邀請。初次登入設定密碼及 SNS 訂閱確認由收件人完成；程式不代替收件人確認。

本機已通過 **27 項測試**，包含狀態機、舊版保留、未復驗不可核可、具名身分、重複事件、候選雜湊、版本衝突、提交後中斷回復、首次產表與未確認訂閱、完整問題列、公式注入防護，以及獨立 XLSX 讀取。Python 編譯與 JavaScript 語法檢查通過。

本機測試以外，本次已完成上表所列 AWS 驗證。完整證據分別記錄在 `deployment.json`、`cloud-verification.json`、`cloud-drill-verification.json` 與 `monthly-live-result.json`。原始部署回執保留當時狀態，最新整合狀態為 `DEPLOYED_USER_ACTIVATION_PENDING`。目前沒有從另一個實際外部 IP 測試網路限制，也沒有取得管理者的真實簽核或收件證據；不能將隔離測試記載成正式人員核可。

## 此版監控的範圍

接收 ETL 主動異常事件、指定 CodeBuild 的失敗／停止／逾時事件、月人口 Lambda 的 Errors／Throttles 告警。每小時對帳補送最新待寄案件並修復待結案發布紀錄。SQS 具有失敗佇列。

此版未加入「排程完全未啟動且沒有任何執行事件」的獨立時限看門狗，也未變更既有 Scheduler 的失敗佇列設定；不能宣稱能偵測所有靜默漏跑。完整自動修正資料、Excel 回傳匯入、多人會簽及硬體式數位簽章亦不在此版範圍。

## 管理者啟用與待驗收項目

使用者已明確授權存取已登入的 AWS Workshop 頁面；先前的存取阻礙已解除。剩餘步驟是信箱擁有者確認 SNS 訂閱、設定管理者密碼，並完成真人登入、收件及簽核驗收。訂閱未確認時，查核表仍保存於私有 S3；產表工作會依 SQS 重試和每小時對帳補送。電子郵件、已讀與 Excel 修改都不構成核可。

## 技術依據

- [Amazon SNS Email 訂閱](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html)
- [API Gateway HTTP API JWT authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [Cognito 管理者建立使用者](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html)
- [Cognito GetUser 與 access token 所需 scope](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html)
- [Amazon S3 條件式寫入](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- 現行 Gate2 `etl/monthly.py`、`etl/common.py` 與 Gate3 `run_annual.py`、已驗證發布清冊格式。
