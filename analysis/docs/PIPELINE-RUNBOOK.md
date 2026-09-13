# 資料產製與發布 Runbook V1.0

## A. 執行前

- [ ] 確認 `config/sources.json` 與 `config/integration-contracts.json` 已完成變更審查。
- [ ] 確認核心青年仍為 18–35；15–17、36–40 不計入核心總數。
- [ ] 確認執行環境日期、時區、資料期別與網路來源網域。
- [ ] 確認本次是否需要 OAS 人工匯出或 OCR；若需要，先建立人工查核單。

## B. 執行

```powershell
python scripts/preflight.py
python scripts/run_pipeline.py --period 11507
python -m unittest discover -s tests -p "test_*.py"
```

管線先保存 `data/raw/<SOURCE>/<runId>/`，再產生 `data/manifests/<runId>.json` 與 `data/curated/policy-indicators-<runId>.json`。任一必要來源失敗時，保留失敗 manifest，但不更新 `latest`。

## C. 自動檢查

- [ ] 原始檔格式與簽章符合 JSON／XLSX。
- [ ] 期別、列數、bytes、URL、擷取時間、SHA-256 皆存在。
- [ ] 18–35 人口由 18 至 35 各單一年齡加總。
- [ ] 資料欄位標籤及工作表 selector 存在。
- [ ] 資料母體、地理角色、單位與年齡對齊狀態已輸出。
- [ ] 預測標記為 `SCENARIO_NOT_OFFICIAL_FORECAST` 且含回測 MAE。

## D. 人工查核

- [ ] 依 `docs/HUMAN-REVIEW-SOP.md` 完成所有阻擋發布項目。
- [ ] OAS 若納入正式數字，查詢條件、原檔、截圖、雜湊與覆核人齊全。
- [ ] 教育與薪資只作群體描述，不寫成個人因果關係。
- [ ] 工作場所薪資未寫成新北居住青年薪資。
- [ ] 線性外推未寫成官方預測或政策成效。

## E. 發布

1. 把 curated JSON 與 pipeline manifest 複製到儀表板唯讀資料區。
2. 執行 lint、build、前端測試與 API 路由測試。
3. 私人環境先驗證資料值、來源連結、限制說明與問答結果。
4. 記錄版本、部署 ID、網址、查核人、日期與回復方式。
5. 未取得發布 Gate 核准，不改為公開存取。

## F. 回復

- 資料異常：將儀表板指回前一個成功 curated 快照與 manifest。
- AWS bridge 異常：移除 `AGENT_ASK_URL`、`AGENT_API_KEY`，回到本地證據模式。
- 欄位改版：停止新版本發布，保留舊版服務與失敗證據，待 crosswalk 核定。
