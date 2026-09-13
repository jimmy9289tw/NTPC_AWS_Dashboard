# Codex 專案維護與驗證

目前專案由 Codex 建置與維護。接續工作時，先閱讀[專案首頁](../README.md)、[AWS 架構](ARCHITECTURE.md)及[公開副本設定](CONFIGURATION.md)，再依實際需求修改對應模組。

## 程式入口

| 要修改的內容 | 主要位置 |
|---|---|
| 網站介面、圖表與四象限 | [Gate4 dashboard](../artifacts/ntpc-aws-platform-gate4-20260912/dashboard/) |
| 網站路由、權限與資料讀取 | [Gate4 server.py](../artifacts/ntpc-aws-platform-gate4-20260912/server.py) |
| AI 問答與資料引用 | [ai_chat.py](../artifacts/ntpc-aws-platform-gate4-20260912/ai_chat.py)、[ai_evidence.py](../artifacts/ntpc-aws-platform-gate4-20260912/ai_evidence.py) |
| 現行月人口及年度 ETL | [Gate5 prepared](../artifacts/ntpc-aws-review-gate5-20260913/prepared/) |
| 異常查核、自動產表、通知與簽核 | [Gate5 查核模組](../artifacts/ntpc-aws-review-gate5-20260913/) |
| 研究方法及共用統計程式 | [analysis](../analysis/) |

## 修改與驗證

1. 檢查 Git 工作目錄與目前版本，保留尚未提交的使用者修改。
2. 修改前核對資料年度、年齡區間、地區及統計母體；保留來源、方法、估計範圍與缺值標記。
3. 按修改範圍執行驗證。網站變更在 Gate4 的 `dashboard/` 執行 `npm test` 與 `npm run build`；查核流程變更在 Gate5 執行 `python -m unittest test_review -v`。來源或統計公式變更，另依該管線的驗證程序核對結果。
4. 修改 ETL 整合時，同時核對 Gate2／Gate3 基準與 Gate5 的 `prepare_integration.py`，避免重新產生 `prepared/` 時覆蓋修正。
5. 更新受影響的操作說明、架構及驗證紀錄；公開版本不得寫入真實憑證或本機機密設定。
6. 推送後核對遠端提交。GitHub 原始碼更新與 AWS 部署分別處理；雲端變更依當次已授權範圍執行並讀回驗證。

## 資料與政策邊界

- 戶籍人口、民間人口與勞動市場、受僱員工薪資的母體及分母分開處理。
- 缺值不填成零；估計值不可改標為官方原生數值。敏感度包絡不稱為信賴區間。
- 保留 ROAMEF 的政策循環；現行政策頁以 R／O／A 為主，四象限與決策分流仍須呈現比較基準及證據限制。
- 資料異常時保留前一有效版本，依查核案件、復驗及具名核可流程發布。
- SNS 收件、管理者首次登入與真人簽核須有各自的驗收證據；本機測試通過不代表已完成這些步驟。

`analysis/docs/` 與既有報告生成腳本保留研究沿革，其歷史版本、路徑與部署狀態需對照本版 README。它們不作為目前專案的維護操作入口。
