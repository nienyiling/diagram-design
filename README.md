# 公務用圖表範本庫

153 張排好版的圖表範本，挑一張、把英文改成中文、換成公文用得上的配色，下載 PNG 貼進 Word 或簡報。

純靜態、純前端、零對外連線。所有運算都在使用者自己的瀏覽器裡跑，沒有後端、沒有追蹤、不呼叫 LLM。

## 圖表範本的來源

**範本全部取自 GitHub 上的公開專案
[`cathrynlavery/diagram-design`](https://github.com/cathrynlavery/diagram-design)
（MIT License，著作權人 Cathryn Lavery）。**

- 取用的是該專案 `skills/diagram-design/assets/` 底下的範例圖，原樣副本放在本 repo 的
  `vendor/upstream/`，同目錄附上游的 `LICENSE` 全文與 `SOURCE.json`（記著取用時的 commit）。
- 上游原本是一套給 AI 代理用的「畫圖規範」，本站沒有用到它的規範文件與腳本，只用它附的範例圖。
- 本站對這些範例圖做的加工：抽出 SVG、把頁面 CSS 收進 SVG 內並加上作用域、
  把 Geist／Instrument Serif 換成本機中文字族、移除所有對外連線、修掉三張深色範例
  被寫死成淺色的底色。**版面與圖形本身沒有動。**
- 範本的著作權仍屬原作者。站上首頁、頁尾，以及每一份下載的 SVG／PNG／HTML，
  都會帶上來源與授權標註。

本 repo 自己的程式碼同樣是 MIT。

## 這個工具能做什麼、不能做什麼

| | |
|---|---|
| 能改 | 圖上每一段文字、圖的標題與眉標、四個主要顏色（底色／文字／次要／強調） |
| 不能改 | 方塊的位置與大小、線怎麼連——那是範本畫死的 |
| 輸出 | PNG（貼 Word 與簡報）、SVG（向量，放大不糊）、HTML（離線開、瀏覽器列印成 PDF） |

中文比英文寬，同樣一句話常常寬一倍。字太長時本站會自動縮小字級塞進框裡，
縮到看不清楚就代表該把字改短——這是刻意的：把字撐爆框線比縮小更糟。

用到 SVG `foreignObject` 的三張「分層資料架構圖」不能轉 PNG（瀏覽器不會把 foreignObject
畫進圖片裡），畫面上會直接停用 PNG 按鈕並說明原因，請改用 SVG 或 HTML。

## 架構

```
index.html              介面與樣式（視覺與 gongwu-calc 對齊）
app/core.js             唯一的純函式層，不碰 DOM，Node 直接 require 得動（UMD，瀏覽器掛 window.DD）
app/app.js              載資料、畫範本列表、hash 路由
app/editor.js           改字畫面的流程層：渲染、換色、自動縮字、下載
data/diagrams.json      建置產物（2 MB），153 張自足 SVG＋中文分類。commit 進 repo，部署時直接送上去
scripts/build-data.mjs  vendor/upstream/*.html → data/diagrams.json
vendor/upstream/         上游範例圖的原樣副本＋LICENSE＋SOURCE.json（只在建置時用，不部署）
```

改了 `app/core.js` 的轉換規則，就要重跑 `npm run build`。忘了跑的話 `npm run test:unit`
會直接紅——`tests/data.mjs` 會重跑一次建置並跟 commit 進來的 JSON 逐字比對。

## 測試（推上去前必做，沒有例外）

| 指令 | 內容 |
|---|---|
| `npm test` | 全部：`core.unit`（97）＋`data`（18）＋`e2e`（40），約 90 秒 |
| `npm run test:unit` | 純函式＋資料一致性，約 3 秒 |
| `npm run test:e2e` | 真的開 Chromium 點按鈕、真的下載檔案 |
| `npm run build` | 重新產生 `data/diagrams.json` |
| `npm start` | 起一個本機伺服器，印出網址 |

- 單元測試直接 `require` 站上那份 `app/core.js`，**不做副本**——副本會跟站上的碼悄悄走鐘，
  「測試全過但測的是舊碼」比沒測試更危險。
- e2e 有一項專門攔 `page.on('request')` 驗證整趟操作沒有任何對外請求，**不要把它拿掉**，
  那是這個站存在的理由。另有一項逐一開完 153 張範本，確認每一張都畫得出來、文字都抓得到。
- 錯誤訊息的測試一律斷言 `isVisible()`，不能只斷言 `textContent`：`.errbox` 預設 `display:none`，
  只塞文字不加 `.show` 會被 CSS 蓋掉，使用者一次都看不到。
- **不能用 `file://` 開來測**：站上的資料是 `fetch()` 拿的，`file://` 底下會被瀏覽器擋。
  測試自己起一個隨機埠的靜態伺服器（`tests/helpers.mjs` 的 `serve()`）。
- playwright 只裝在全域也沒關係，`tests/helpers.mjs` 會自己找。

## 部署

**push 就自動上線**，走 `.github/workflows/deploy.yml`（測試 → 組 dist → `wrangler pages deploy`），
不必到 Cloudflare 後台按任何東西。這一套跟 `nienyiling/Pdftoword`、`nienyiling/dayoff` 是同一個模式。

- 憑證是 repo secret：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。
  GitHub 的 secret 每個 repo 各自獨立，**別的 repo 設過不等於這個 repo 有**，新 repo 要再設一次：
  <https://github.com/nienyiling/diagram-design/settings/secrets/actions/new>
- 部署包只放 `index.html`、`_headers`、`app/`、`data/`。`vendor/upstream/` 是建置來源，不上 CDN。
- Pages 專案的 production branch 寫死 `main`，不要用 `default_branch`：那個值只在專案建立當下生效，
  之後只能到 Cloudflare 後台改，弄錯的話推 main 會全部變成 preview 部署。
- 網址不要寫死在任何地方：Pages 子網域全球唯一，撞名會自動加後綴
  （dayoff → `dayoff-ala.pages.dev` 就是這樣來的），一律從 Actions 的摘要讀。
- 快取規則在根目錄的 `_headers`。`data/diagrams.json` 檔名固定、內容會換，
  所以給的是 `must-revalidate` 而不是長快取——給 immutable 的話改過的範本永遠送不到老使用者手上。
- **驗收不能只看首頁開不開得起來**：請點進一張範本、把字改成中文、真的下載一次 PNG，
  確認圖上是中文、下方有來源標註。
