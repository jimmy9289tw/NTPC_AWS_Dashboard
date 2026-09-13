# 任務卡 V3｜新北市青年政策公開資料 Harness AI Agent

## 1. 目標與完成定義

建立可部署於 AWS us-west-2 的初版研究 Agent 與可執行互動式儀表板，協助承辦人查找、比對及驗證青年政策公開資料。完成須同時具備：官方資料來源清冊、核定年齡分組、定義衝突阻擋、資料處理可重現、工具最小權限、操作稽核、人工核准關卡、問答介面、視覺化監測及冒煙測試證據。

## 2. 已核定範圍

| 決策代號 | 核定內容 | 實作位置 |
|---|---|---|
| G3-DEC-01 | 命題指定三平台皆納入；另納入政府資料開放平臺及戶政司 | `config/sources.json` |
| G3-DEC-02 | 第一批主題：人口、就業、薪資 | `config/sources.json` |
| G3-DEC-03 | 核心青年 18–35，分成 18–24、25–29、30–35；15–17 及 36–40 非核心 | `config/age-groups.json` |
| G3-DEC-04 | 新北市為主要地理範圍；居住地與工作場所不得混用 | system prompt、治理模組 |
| G3-DEC-05 | 本地驗證後部署 AWS us-west-2 | `config/deployment-settings.json` |
| G3-DEC-06 | 未經人工核准不得對外發布或外部寫入 | approval tool、system prompt |

## 3. AWS 初版架構

使用 Amazon Bedrock AgentCore Harness 作為受控執行面；Browser 只讀公開來源；Code Interpreter 執行確定性計算；Managed Knowledge Base 儲存核准研究文件並經 Gateway 檢索；CloudWatch 保存呼叫、錯誤與追蹤；S3 保存知識文件、企業瀏覽器政策與經核准的錄影。Memory 初版關閉。

互動式儀表板提供可提問介面、人口年齡軌、人口／薪資 KPI、來源介接清冊、品質風險及人工查核入口。AWS Harness 尚未連線或異常時，只能使用已驗證的本地證據回答，並明示 `LOCAL_EVIDENCE_FALLBACK`；不得補造雲端答案。

### 3.1 目前實際部署（2026-08-15）

- AWS：帳號 `787498376572`、角色 `WSParticipantRole/Participant`、區域 `us-west-2`。
- AgentCore Harness：`ntpc_youth_ai_v1`，資源 ID `ntpc_youth_ai_v1-jIOgOhhfaT`，DEFAULT endpoint 版本 3 已就緒。
- 模型：`global.amazon.nova-2-lite-v1:0`。Claude Sonnet 4.6 因工作坊帳號無 AWS Marketplace 訂閱權限而停用，未擴張 IAM。
- 工具 allowlist：`aws_browser_v1`、`aws_codeinterpreter_v1`、`request_human_approval`；未開放 Shell 或內建檔案操作。
- 網路：公有網路 MVP；Browser 仍為 AWS 內建工具，僅由系統提示限制官方網域。正式上線仍須 Custom Browser 企業政策。
- 儀表板：私人站台已部署至 `https://ntpc-youth-evidence-20260815.jimmyhuang9289.chatgpt.site`；目前問答採本地已驗證證據，尚未建立 IAM API bridge。

## 4. 硬性護欄

- 核心青年總數只能由單一年齡 18–35 加總；跨界年齡帶不得按比例拆分。
- 母體、地理角色、單位或測量型態衝突，一律阻擋正式發布並交人工裁示。
- Browser 僅准許官方來源網域；不得登入、送出表單、接受條款、發布或使用 Google 個人工作階段。
- Harness 不授予 `InvokeAgentRuntimeCommand`；不提供 Shell、任意檔案或任意 HTTP 工具。
- 任一外部寫入先產生核准請求與冪等鍵；沒有核准即停止。

## 5. Gate

| Gate | 驗收條件 | 狀態 |
|---|---|---|
| G4-A 本地治理 | CLI validate、單元測試與 preflight 全通過 | 已通過 |
| G4-B AWS 預檢 | 帳號／區域／權限／標籤／成本上限已記錄 | 條件式通過：帳號、角色、區域已記錄；成本責任待裁示 |
| G4-C 基礎資源 | S3、KB、Gateway、Custom Browser、Harness 建立完成 | 部分完成：Harness V3 已就緒；其餘待文件上傳及正式上線核准 |
| G4-D 冒煙測試 | 核准來源可讀、衝突會阻擋、禁止行為不執行 | 條件式通過：T02 已通過；T04–T06 待 Custom Browser／KB |
| G4-E 儀表板 | 可提問、篩選、來源連結、風險與查核表可用；建置及路由測試通過 | 已通過並私人部署 |
| G4-F 人工驗收 | 承辦人確認成本、保存期、負責人及發布規則 | 待人工確認 |
