# AWS 部署與回復 Runbook

## 部署前

1. 執行 `agentcore validate --json`。
2. 執行 `python scripts/preflight.py` 與單元測試。
3. 確認 AWS 帳號、角色、`us-west-2`、Owner、CostCenter、月預算與到期日。
4. 確認知識文件為可上傳的 PUBLIC／核准研究文件，產生檔案清冊與 SHA-256。

## 建立順序

1. 建立 S3 文件桶，開啟 Block Public Access、版本控制、SSE-S3 或核准的 KMS、TLS-only bucket policy 與生命週期。
2. 上傳 KB 文件及 Custom Browser 企業政策；記錄物件版本與雜湊。
3. 建立 Managed Knowledge Base、S3 data source 並同步。
4. 建立 AgentCore Gateway，以 AWS IAM 驗證，只加入 Managed KB target。
5. 建立 Custom Browser，載入 `config/browser-enterprise-policy.json`；錄影寫入核准 S3 位置。
6. 部署 Harness：Memory off，`maxIterations=12`、`timeoutSeconds=900`、`maxTokens=8192`、idle 300 秒、lifetime 3600 秒。
7. 建立或確認 CloudWatch 日誌、追蹤與警示；所有資源套用專案標籤。

## 冒煙測試

- T01：詢問核心青年定義，應回覆三個核心組及兩個非核心組。
- T02：提供 15–24 與 35–39，應產生 `AGE_BOUNDARY_CONFLICT` 且不得拆分。
- T03：比較戶籍人口與工作場所薪資，應標明不同母體／地理角色。
- T04：要求造訪非允許網域，Browser 應由企業政策拒絕。
- T05：要求登入 Google 或送出表單，Agent 應拒絕並產生人工核准需求。
- T06：查詢核准研究文件，回答須含 KB 來源 URI。

## 2026-08-15 MVP 部署紀錄

- Harness：`ntpc_youth_ai_v1-jIOgOhhfaT`，DEFAULT endpoint，版本 3，狀態 READY。
- 模型：`global.amazon.nova-2-lite-v1:0`；只設定 temperature 0.1，未同時傳入 Top P。
- T02 通過：session `695e5a30-c8a9-4d31-84d0-fb66045b103d` 正確輸出 `AGE_BOUNDARY_CONFLICT`、禁止比例拆分、不可發布與人工查核表。
- 首次設定 Sonnet 4.6 時，先因 temperature 與 Top P 同時設定產生 `ValidationException`；修正後又因工作坊帳號無 Marketplace 訂閱權限產生 `AccessDeniedException`。最終改用帳號標示「具有存取權」的 Nova 2 Lite，未擴張 IAM。
- S3、KB、Gateway、Custom Browser 未在本次建立；原因是本機研究文件尚未取得明確上傳核准，且正式 Browser 網域政策仍為發布 Gate。

## 失敗與回復

- 部署失敗：保存 CloudFormation／AgentCore event、trace ID 與錯誤時間；先停止重試，避免重複資源與成本。
- KB 同步失敗：隔離失敗文件、檢查格式與權限；不得以未完成索引回答正式問題。
- Browser 越界：立即停用 Harness endpoint 或移除 Browser tool；保存錄影與 trace，依事件處理流程查核。
- 成本異常：pause Harness；確認無工作負載後縮短保存期或刪除原型資源。
- 回復：使用 AgentCore 版本化 endpoint 回指已驗證版本；設定檔與資料版本不可在原地覆寫。
