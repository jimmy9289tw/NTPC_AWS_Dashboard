# Kiro／AWS交接：LSF V1

## 先讀這三份

1. `01_LSF政策分析與雙輪決策樹_V1.md`：問題、分流及計算定義。
2. `02_資料盤點與來源說明_V1.md`：已接與未接來源，不以抓取日充當統計期。
3. `dashboard/app/lsf-rules.json`與`lsf-engine.ts`：實際可執行規則。

## 在本機重現

以下命令從完整原始碼儲存庫執行。需要Node22.13以上、Python3與pypdf；既有`requirements.txt`/鎖檔仍保留。若尚未安裝JS依賴，先在dashboard執行`npm ci`。

```powershell
python scripts/lsf_build.py
python scripts/lsf_validate.py
cd dashboard
npx tsc -p tsconfig.lsf.json
node --import tsx --test tests/lsf-evidence.test.mts
node node_modules/vite/bin/vite.js --config vite.lsf.config.mts
```

瀏覽`http://127.0.0.1:4176/`。這是獨立的本機確認入口，不是正式環境認證替代品。

```powershell
node node_modules/vite/bin/vite.js build --config vite.lsf.config.mts
```

靜態原型輸出`dashboard/dist-lsf`。須透過HTTP伺服器檢視，不保證直接雙擊HTML的file協定能載入模組。原型因包含完整在地資料快照，壓縮前JS檔較大；正式整合前應拆分按需資料請求，不把政策規則或政策匯出放到公開靜態資產。

## 元件與資料流

| 元件 | 用途 |
| --- | --- |
| `lsf-workbench.tsx`與CSS | 人口起點、六支線、第二輪、右側支持證據、圖表資料表 |
| `lsf-engine.ts` | 同口徑人口比較、背景資料篩選、三值判斷（支持／不支持／未知） |
| `lsf-rules.json` | 規則版、六個問題、比較對象、下一輪及相反線索 |
| `lsf-evidence.json` | 從保留來源重建的本機UI快照，不是新增官方來源 |
| `chart-transition.ts` | 沿用兩秒位置與高度過渡；減少動畫偏好時關閉 |
| `chart-canvas.tsx`、`quadrant-chart-primitives.tsx` | 沿用可捲動圖表、數值提示與視窗邊界定位 |
| `modal-interaction.ts` | 焦點循環、Escape、關閉後返回啟動按鈕 |

## 未來併入正式政策頁前的驗收

- 保留ROAMEF，新增「探索生活條件／比較介入方案」兩個不同任務入口，不能把資料待補偽裝成推薦方案。
- 延用既有內網政策權限；後端驗證身分，資料請求、政策規則、AI答案及政策匯出同時受控。不要只用前端CSS隱藏。
- 原公開分析仍可用；不可將這個無認證的本機原型資料夾直接上傳成公開政策頁。
- 不建立新個資資料庫；只處理政府公開彙總。若日後需個別服務紀錄，另定授權、去識別及保留規則。
- 新北市才提供勞動、行業及薪資；地區頁絕不以全市比率推算區值。
- 114年青年薪資仍缺值；115年租金、據點分開顯示。原有模型範圍及官方身分保留。
- 新資料進來時重新檢查負擔及需求的可比較性，版本化閾值與議題定義，不任意讓AI回傳true。

## AWS：本次不建立任何資源

沿用原競賽合規文件中的最小必要架構。本次的新增工作是「抓取→驗證→發布」資料任務，不需要因LSF增加Spark叢集或長駐服務。

將來可把不可變原始與發布快照放在合規的物件儲存；用既有允許的排程與短任務執行器更新；需要容器依賴或執行時間過長才使用既有核准容器方案。查詢層優先讀小型版本化JSON/CSV，只有資料量及探索需求足夠時才評估Catalog/Athena。

實際服務名稱、區域、IAM、預算與外連條件，必須再次對照資料包所附20260722競賽限制及Supported AWS Services List；本版沒有宣稱任何新服務已獲賽事允許，也沒有申請金鑰或建立雲端資源。

## 完整包與歷史包

本次完整整合包把既有約620MB ZIP原封保留在歷史成果區，另加入目前儲存庫與LSF新增資料。不是以小型程式碼包取代歷史原始資料；舊ZIP內含原00–14分類及歷史報告。頂層說明會指出最新發布資料的位置，避免誤用歷史版。

GitHub既有私人儲存庫：https://github.com/jimmy9289tw/ntpc-youth-policy-workbench 。本次修改尚未commit/push；不可宣稱該連結已包含LSF V1。沒有部署或改正式網站版本。
