# AWS Harness 驗收紀錄｜2026-08-15

## 資源識別

| 欄位 | 值 |
|---|---|
| AWS 帳號／角色 | `787498376572`／`WSParticipantRole/Participant` |
| 區域 | `us-west-2` |
| Harness | `ntpc_youth_ai_v1` |
| Harness ID | `ntpc_youth_ai_v1-jIOgOhhfaT` |
| Endpoint ARN | `arn:aws:bedrock-agentcore:us-west-2:787498376572:harness/ntpc_youth_ai_v1-jIOgOhhfaT/harness-endpoint/DEFAULT` |
| 版本／狀態 | 3／READY |
| 模型 | `global.amazon.nova-2-lite-v1:0` |
| 傳入驗證 | IAM |
| 記憶 | Disabled |
| 允許工具 | `aws_browser_v1`、`aws_codeinterpreter_v1`、`request_human_approval` |

## 驗收案例 T02

**輸入**：某官方來源只提供 15–24、25–29、30–34、35–39 歲分組，判斷能否計算 18–35 歲核心青年總數，並列衝突代碼、禁止處理、發布判定及人工查核表；禁止瀏覽網頁。

**結果**：通過。Agent 明確回答不能計算；標記 `AGE_BOUNDARY_CONFLICT`；禁止按年數比例拆分人數、率、百分比或平均數；判定不可發布；列出人工查核表與建議決策人。

| 稽核欄位 | 值 |
|---|---|
| Session ID | `695e5a30-c8a9-4d31-84d0-fb66045b103d` |
| 輸入／輸出／總計 | 830／1,131／1,961 |
| 延遲 | 6,690 ms |
| 工具呼叫 | 0（符合題目禁止瀏覽） |

## 儀表板供應鏈稽核

- `npm audit --omit=dev`：正式執行依賴 0 個已知弱點。
- 完整 `npm audit`：開發／建置工具鏈 20 項（1 low、4 moderate、15 high、0 critical）。目前以預先建置封裝部署，且不對外開放開發伺服器；正式維護版仍須在獨立變更單升級並重跑建置、路由與部署測試，不使用 `--force` 自動改版。

## 發現與處理

1. Claude Sonnet 4.6 同時設定 temperature 與 Top P 時產生 `ValidationException`；移除 Top P。
2. 修正後，工作坊帳號仍因缺少 `aws-marketplace:ViewSubscriptions`／`Subscribe` 而拒絕該模型。未要求或擴張 Marketplace／IAM 權限。
3. 改用主控台標示「具有存取權」的 Amazon Nova 2 Lite V1，建立 Harness 版本 3並通過 T02。

## 尚未通過的正式發布 Gate

- CostCenter、月預算、告警收件人、到期日尚未具名核定。
- Custom Browser 企業網域政策尚未部署；目前 Browser 為公有網路 MVP。
- S3、Knowledge Base、Gateway 尚未建立；本次沒有上傳任何本機研究文件。
- 私人儀表板可用本地已驗證證據問答，但尚未有 IAM API bridge 直連 Harness。
- 開發工具鏈弱點尚待相容性驗證後升級；正式執行依賴稽核為 0。
