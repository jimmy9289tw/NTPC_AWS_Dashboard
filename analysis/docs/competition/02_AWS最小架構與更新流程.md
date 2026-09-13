## 13 最小必要AWS架構

先分成兩個可交付層次：核心展示只需可重現的快照、網站、受保護API及監測；每日更新與AI在確認需要展示且權限可用後加入。Glue、Athena、AgentCore、RDS、EMR、SageMaker不列為最小版必建資源。

![AWS最小架構](architecture.png)

|層次|資源|用途與取捨|
|---|---|---|
|核心展示|CloudFront＋私有S3|靜態前端與公開統計快照；OAC只允許指定發佈存取|
|核心API|API Gateway＋Lambda|查詢、資料匯出、政策角色權限；限制欄位與查詢範圍|
|共同管理|IAM＋CloudWatch/Logs|最小權限、錯誤與成本觀測；記錄不含真實帳號和聊天內容|
|啟用每日更新時|Scheduler＋Step Functions＋Lambda|09:15來源檢查、條件分支、候選版本驗證與發布|
|重算超出Lambda時|ECS Fargate＋ECR|完整Python環境的PCLM/IPF或較長批次；先驗配額與執行時間|
|啟用AI時|SQS＋DynamoDB＋Lambda＋Bedrock|共同佇列、冪等與限流；快取命中不再呼叫模型|

CloudFront使用一般S3來源與OAC，不使用S3網站公開端點。政策內容不能包在人人可下載的靜態JS／JSON裡；須由伺服器依角色授權回傳。CloudFront的API路徑不快取帶身分的政策回應，或以經驗證的權限範圍隔離。

現有程式是Vinext／Cloudflare Worker架構，不能把dist整包丟入S3就說完成AWS移植。移植時需把純展示部分抽出為靜態資源，並將Worker的登入、路由、靜態保護及匯出轉成Lambda介面；若保留SSR，則須另評估Lambda或容器執行，不套用純靜態架構假設。

## 14 資料分流與每日更新

分流依據是執行時間、記憶體、依賴環境、資料規模及是否需要跨節點計算，不依「戶籍／勞動／薪資」名稱決定資源。相同母體也可能同時有輕量下載與較長模型批次。

|工作型態|優先資源|升級條件|
|---|---|---|
|來源HEAD／GET、雜湊、少量欄位檢查|Lambda|逾時、記憶體或依賴封裝不適合時再分批／容器化|
|PCLM、IPF、數值最佳化及多情境重算|先本機量測；可在Lambda內完成者保留Lambda|接近15分鐘上限、有大型原生依賴或記憶體需求時採Fargate|
|大量檔案分散式join、清洗與分區ETL|未列入最小版|確實需要Spark平行化才導入Glue Spark|
|人工SQL查詢與探索|先讀已發布CSV／JSON|需求成立時再以Glue Catalog描述S3資料，Athena查詢|

Glue Catalog是資料表與欄位等中繼資料目錄，Athena是查詢S3資料的SQL服務；程式開發與雲端排程分工處理，執行排程由 AWS 服務負責。

![每日更新流程](daily-flow.png)

|步驟|輸入與動作|留下的紀錄／失敗處理|
|---|---|---|
|1 檢查來源|Scheduler採Asia/Taipei，每日09:15；讀來源清單|run_id、來源、檢查時間；來源未變寫NO_CHANGE|
|2 保存原檔|來源有變時存raw版本；記ETag、Last-Modified、下載URL與SHA-256|來源失敗保留原發布版，不用空檔覆寫|
|3 重建受影響資料|以依賴關係決定哪些母體或交叉表重算|方法版、參數、輸入hash、執行時間；任務可重入|
|4 候選版驗證|欄位、列鍵、分母、期間、上下限、來源關聯與權限檢查|失敗留candidate及錯誤報告，不改published|
|5 發布|寫入不可變release目錄，最後才更新單一manifest指標|manifest含所有檔案hash與版本；讀者只讀同一release|
|6 回復與追蹤|若使用驗證失敗，將manifest指回前版|保留失敗版，記錄回復原因，修復後重新發布|

每日更新是每天檢查，不是把年資料插值成每日或每月資料。勞動與薪資未發布新年度時顯示最近可用年度，不假裝已更新。

## 15 AWS動作與環境查核清單

下表對應使用者提供的服務清單工作表列號。列出的動作已見於允許清單；仍需確認實際角色、SCP、資源條件、區域及配額。這不是完整部署IAM政策，建置工具額外的讀取、列舉與清理動作須於實作Gate列齊。

|服務及工作表列號|核心IAM動作例|使用層次|
|---|---|---|
|s3，第246列|CreateBucket、PutBucketPublicAccessBlock、PutBucketPolicy、GetObject、PutObject、PutEncryptionConfiguration|核心|
|cloudfront，第60列|CreateDistribution、CreateOriginAccessControl、UpdateDistribution、CreateInvalidation|核心|
|lambda，第176列；apigateway，第16列|CreateFunction、UpdateFunctionCode、InvokeFunction；GET／POST／PUT等控制平面動作|核心|
|iam，第152列；logs，第181列；cloudwatch，第65列|CreateRole、PassRole；PutLogEvents；PutMetricData|核心|
|scheduler，第258列；states，第286列|CreateSchedule；CreateStateMachine、StartExecution|每日更新|
|ecs，第113列；ecr，第111列|RunTask、RegisterTaskDefinition；GetAuthorizationToken、PutImage|長批次時|
|sqs，第277列；dynamodb，第106列|SendMessage、ReceiveMessage、DeleteMessage；GetItem、PutItem、UpdateItem|AI佇列及協調|
|bedrock，第46列|InvokeModel、InvokeModelWithResponseStream|模型問答|
|glue，第145列；athena，第33列|CreateTable、GetTable；StartQueryExecution|後續擴充|

API名稱不一定等於IAM動作，例如S3加密使用PutEncryptionConfiguration權限；Bedrock Converse呼叫通常由InvokeModel權限控制，不因表中沒有「Converse」字樣就判定不能使用。Fargate也不是獨立IAM命名空間，需連同ECS／ECR及配額判斷。

附件EC2表顯示部分GPU家族vCPU配額為0；最小版不依賴GPU訓練。SageMaker端點與訓練配額不同，不能由單一列推論全數可用。也不因配額高就配置額外資源。

## 16 AI、權限與資料安全

最小AI展示採問題範本ID與篩選參數，模型只讀已發布的彙整統計。不要收集使用者Email、姓名、參與人員清單或任意自由文字後直接傳入競賽環境。自由問答若要開放，另設敏感資料檢查與不保存原文的流程，並取得使用者操作同意。

Bedrock全部請求，包括多使用者、多模型、重試與代理中的第二次呼叫，都要進同一節流入口。採單一消費者、DynamoDB條件式租約與下一次允許時間；每次請求開始至少間隔2秒。失敗重試亦排隊，不以SDK自動重試繞過間隔。租約須涵蓋呼叫期間並可安全續租；冪等鍵防止重送重複執行。

Lambda reserved concurrency=1只能限制同時執行數，不能保證每秒少於1次。驗收需用全域時間戳檢查所有相鄰開始時間，並模擬逾時、重試、租約到期及快取命中。若未驗證，不開啟真實模型展示。

Viewer只能讀公開彙整統計；目前資料匯出與政策研判、政策API均須具授權角色。AWS移植應保留這項邊界。角色必須來自經伺服器驗證的身分，不採用瀏覽器傳入的isAdmin。競賽版先用無個資、具簽章且短效的測試角色憑證，登入供應者實際配置留到部署Gate。

## 17 AWS六大支柱如何落在本案

|支柱|本案做法|可交給評審的佐證|
|---|---|---|
|卓越營運|版本manifest、SOP、來源檢查、可重現測試|一次更新與一次失敗回復紀錄|
|安全性|私有S3、最小IAM、角色API、去識別化、秘密不入Git|匿名拒絕、越權匯出拒絕、敏感掃描|
|可靠性|不可變release、冪等、重試與前版回復|來源失敗不改發布版、回復演練|
|效能效率|預先產製JSON/CSV、前端讀快照、按量分流|冷／熱查詢時間與模型批次量測|
|成本最佳化|無變更不重算、AI快取與限流、不建立不必要服務|資源清單、呼叫量及成本預估式|
|永續性|重用既有快照、只更新受影響項目、按需運算|省略重算次數、總運算時間|

不虛填省錢比例或碳排量。成本先以請求數、執行時間、儲存量、傳輸量及模型輸入／輸出Token估算，於確認區域、模型、配額與預算後再套官方價格。預算通知門檻及資源保存日由使用者或主辦方指定。
