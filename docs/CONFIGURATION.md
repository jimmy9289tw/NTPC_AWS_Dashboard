# 公開副本設定

1. 使用部署者自己的 AWS 帳號與 IAM 角色，不將 AWS keys、session token、密碼或 ORIGIN_SECRET 寫入 Git。
2. 將 Gate5 的 `settings.example.json` 複製為同目錄 `settings.json`，填入自己的 account、region、bucket、CloudFront distribution、website、ETL 名稱及管理者 Email。`settings.json` 已列入 `.gitignore`。
3. `000000000000`、`YOUR_DISTRIBUTION_ID`、`YOUR_DISTRIBUTION.cloudfront.net`、`admin@example.com` 與 `192.0.2.x` 是不可直接部署的範例值。既有 Gate2／Gate3／Gate4 部署程式中的帳號、資源常數也必須換成自己的環境。
4. 大型官方原始資料與現行 S3 發布套件不隨原始碼上傳。Gate3 來源 URL、轉換方式與來源版本保留在 `fetch-registry.json`；先備妥完整輸入與原始有效版本，再進行年度重建或查核模組整合。
5. Gate5 預設 `python deploy.py` 僅建立本機部署計畫；指定 `--apply` 才會呼叫 AWS 修改資源。它是既有系統的查核整合部署器，不是單獨從零建立所有資料的安裝程式。

本機 `preview_roa.py` 僅綁定 127.0.0.1，提供展示用的本機權限狀態；不得把它直接當作公開伺服器。正式入口使用 CloudFront、來源驗證、指定 IP 與 Cognito。

歷史方法報告、移轉及打包腳本保留其背景路徑作為來源紀錄；跨機器使用時需調整輸入位置。一般網站啟動與查核測試請使用根目錄 README 的指令。

## 機密資訊管理

AWS 執行環境使用 IAM 角色取得暫時憑證；本機使用 AWS CLI 設定檔或環境變數提供驗證資訊。API Token、來源驗證密鑰與資料庫密碼應由執行環境或 AWS Secrets Manager 提供，不可寫進原始碼、README、部署輸出或 Git 提交。前端打包變數（例如 `VITE_*`）會送到瀏覽器，不可存放機密。

`.gitignore` 排除 `.env`、本機 `settings.json`、AWS 設定目錄、憑證檔、私鑰與雲端操作紀錄。公開設定檔僅提供範例值。忽略規則不會移除已追蹤的檔案，因此每次發布前仍須檢查 Git 暫存內容；若曾提交真實憑證，必須先停用或輪替憑證，再處理 Git 歷史。
