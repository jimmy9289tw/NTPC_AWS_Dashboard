# 新北市青年證據台

目前介面版本為 `G6 UI V5.19`、政策規則版為 `G6-POL V2`、核心資料版本為 `G5 V3.6（18–35歲青年薪資層）`：儀表板由可重現資料管線產生的 JSON 快照驅動，分別呈現戶籍人口、民間人口及勞動市場、受僱員工薪資三個母體；行政區只影響戶籍人口區塊。

V5.19依最新裁示將薪資公開範圍收斂為18–35歲：110–113年呈現平均數、中位數、差額、偏斜代理值、成長率與行業薪資估計；114年同口徑青年資料尚未發布，維持缺值。平均數採官方薪資錨定與PCLM輔助年齡輪廓，中位數以官方寬年齡帶平均／中位數校準對數常態分布，再依PCLM受僱人數權重求混合分布第50百分位。細分年齡仍可作內部方法驗證，但不在薪資頁、政策排名、自訂分析或CSV匯出發布。

## 競賽交付包

`competition-submission/` 收錄解決方案說明、12頁完整提案簡報、Live Demo錄製腳本與主辦方連結狀態。文件將已完成的網站與資料能力，和仍待人工完成的評審登入、影片上傳及GitHub專案網址分開標示，避免把待辦誤列為完成。

政策建議以「建議處理方向＋摘要清單＋獨立展開區」串接圖表。摘要清單固定顯示資料訊號、可選政策工具、建議主責／協辦及後續監測指標；證據、執行條件、資料缺口與版本化規則則按需展開。這些內容不取代業務、統計與法制判斷。

G6-POL V2將各分析頁原有的政策區塊集中到決策內網「政策研判」頁，並依英國Green Book 2026的ROAMEF順序呈現理由、目標、選項評估、監測、評估與回饋。每項訊號至少比較維持現況、最低調整及小規模試辦；在成本、成果或可比較基準不足時，不指定首選方案。Magenta Book與Test and Learn只作政策評估方法參考，不宣稱符合英國法定程序。

「自訂分析」頁提供欄位拖曳與鍵盤選單兩種操作，可選X軸、Y軸、圖例、圖表類型及其餘篩選條件。每次只能使用單一母體；圖表角色不等於統計模型的自變項或應變項，描述性比較不得改寫成因果或政策效果。

2026-09-07來源查核結果：戶籍人口官方月資料已到115年，但依完整年度窗規則仍顯示110–114年；教育婚姻、勞動及青年行業已到114年。新北市×年齡全年總薪資官方表6仍以113年為最新，因此114年18–35歲青年薪資保持缺值；全年齡提繳工資不納入薪資頁或政策分析。

官方行政區面積與青年人口密度已介接；政策服務場次、人次、服務參與／曝光強度、據點與公開量能另由第4份分析CSV `06_政策服務與曝光_長格式.csv` 提供。這是輔助證據層，不是第四個人口母體。曝光強度＝參與人次÷活動場次，單位是人次／場；同一人重複參與會重複計入，不能解讀為不同人數占比。

資料匯出中心已提供三母體分檔CSV、一般／研究查核／自訂欄位方案、可搜尋Code Book及UTF-8 BOM輸出。G6 UI V5.7起，CSV與Code Book由伺服器端權限檢查後產生；正式大批資料、ZIP、manifest與短效下載連結規劃由AWS工作流處理。

## 決策內網與資料檢視權限

外網首頁不要求登入，任何使用者都只能查看已發布資料、來源、方法與限制。`ALLOWED_EMAILS` 是可登入帳號；`DECISION_EMAILS` 只包含可查看政策初篩與執行資料匯出的特定帳號。決策帳號會看到「觀察到什麼／建議怎麼做／持續看什麼」三段式政策卡；公開使用者與一般資料檢視帳號不顯示政策卡、政策問答或匯出入口，伺服器也會對政策問答及 `/api/export` 回傳403。

`DECISION_EMAILS` 應以Cloudflare Worker secret管理，不寫入版本庫。為維持既有部署相容性，未設定時會暫以目前全部 `ALLOWED_EMAILS` 作為決策帳號；新增一般檢視者之前，必須先設定 `DECISION_EMAILS`，避免把新帳號誤授予決策及匯出權限。

私人 Sites 儀表板。2026-08-15 已完成 AWS AgentCore Harness V3 狀態回寫；目前站內問答使用已驗證本地證據，雲端即時問答須待 IAM API bridge 完成後才啟用。

# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build並驗證登入、三母體資料、第4份政策服務輔助資料、人口密度公式、ChatBot、缺值與匯出中心基本語意
- `npm run db:generate`: generate Drizzle migrations after schema changes

## 全市戶籍人口年度分析資料

「全年度比較分析」固定比較民國110至114年，包含人口與密度、人口與占比、婚姻、教育四象限，以及教育×婚姻聯合分析。前四圖沿用 `app/data/g5-dashboard-data.json`；聯合分析由政府資料開放平臺資料集117988建置為 `public/data/joint-education-marriage.json`，進入該區塊時才載入。

聯合表的25–29歲是官方原生五歲年齡組。18–24、30–35與18–35歲先以全市PCLM建立單一年齡種子，再於各行政區、性別及官方五歲年齡組內使用IPF，同時校準官方單一年齡人口與官方教育×婚姻聯合格數，最後加總29區為全市值。比例種子IPF只作方法敏感度包絡，不是信賴區間。

重建指令：

```powershell
python scripts/build-joint-education-marriage.py --source "<新北市及29區_年齡性別教育婚姻交叉人口_110至114年.csv>"
```

建置腳本會檢查：1,200筆維度組合、非負值、25–29歲與官方原生值一致、各教育程度下四種婚姻狀態占比合計100%、IPF邊際誤差，以及全市目標年齡人口閉合。

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
