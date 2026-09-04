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
| 能改 | 圖上每一段文字、標題與眉標、四個主要顏色、整張圖的字體（含標楷體） |
| 不能改 | 方塊的位置與大小、線怎麼連——那是範本畫死的 |
| 輸出 | 複製到剪貼簿直接 Ctrl+V、PNG、SVG（向量）、HTML（離線開、列印成 PDF） |
| 省事的地方 | 從 Excel 貼一整欄依序填入、存出／載入設定檔接著改 |

## 兩條路：挑範本，或自己排

| | 範本庫（153 張） | 流程圖產生器（`#/flow`） |
|---|---|---|
| 你決定的 | 每一段文字、標題、配色、字體 | **步驟幾個、判斷幾個、往哪裡分岔**，加上文字與配色 |
| 你不能決定的 | 方塊的位置與大小、線怎麼連 | 版面（由程式算） |
| 適合 | 形狀剛好對得上你的流程 | 形狀對不上——大部分時候 |

範本庫的限制是真的：**方塊是畫死的**，你的流程有五步而範本畫四步就沒辦法。
所以另外做了流程圖產生器：打大綱，方塊大小、位置與連線由程式排。

大綱語法只有三件事：

```
開始 收到來文
步驟 登記收文 / 收發室          ← 斜線後面是小字副標
判斷 是否本科權責？
  否 → 移文他科                 ← 縮排一行＝往右接一個結果
步驟 承辦人擬稿 / 附法令依據
判斷 內容是否需要修正？
  是 ↑ 承辦人擬稿               ← 退回前面某一步（文字要一模一樣）
結束 發文並歸檔
```

開頭寫 `開始`／`結束` 是橢圓、`判斷` 是菱形，其餘一律是矩形步驟。
只標一條分支，往下走的那條會自動標相反的那個（是↔否）。
打不出箭頭時 `->` 和 `^` 也可以。看不懂的行會直接回報「第 N 行怎麼了」，不會靜靜吞掉。

產生器產出的圖跟範本庫走同一條後路：同樣的四個色票（所以換配色有效）、
同樣的字體切換、同樣的下載與複製到剪貼簿。**產生器不給逐段改字——大綱是唯一真相**，
兩個地方都能改的話，改完大綱會發現下面改的字被蓋掉。

**焦點放在「Excel 做不到的圖」。** 長條圖、折線圖、圓餅圖 Excel 兩下就有，
不必來這裡；真正難的是流程圖、泳道圖、組織圖這種要對齊方塊與連線的。
所以首頁最上面是七個快捷入口（流程圖、泳道圖、跨科室流轉、組織圖、甘特圖、時間軸、
案件狀態流轉），清單預設也只給這一類。**長條圖與折線圖仍在庫裡**，
把「只看 Excel 做不到的那種圖」取消勾選就看得到——只是不放在預設的視野裡。

## 中文層

上游範本是英文的，而且內容是軟體專案的示範資料（Sprint velocity、OAuth、Kubernetes）。
逐字直譯對公務同仁沒有用——那些字他本來就要整段換掉。所以中文分兩層：

| 層 | 做法 | 涵蓋 |
|---|---|---|
| **公務範例**（`content/zh-samples.json`） | 人工把整張圖改寫成公務情境，不是翻譯 | 46 張、16 種圖 |
| **骨架字典**（`app/core.js` 的 `GLOSSARY`） | 圖例、月份、季別、是／否、狀態欄位這類「換掉內容之後還留在圖上」的固定用字 | 141 張都吃得到 |

合計 4,829 段裡有 1,515 段（31%）預先中文化。畫面上有「先套上中文」的開關，
有中文的預設打開；使用者自己改過的字永遠優先，切換開關不會蓋掉。

**沒有通用中文譯名的專有名詞刻意留原文**（UML、Sankey、Wardley、draw.io、Mermaid、
類別名稱、欄位名等）。硬翻成中文反而更難懂，`GLOSSARY` 查不到就回 `null`，原文保留。

已寫好公務範例的 16 種：流程圖、泳道圖、流程階段圖（跨科室流轉）、組織圖、甘特圖、時間軸、
狀態機圖、分層堆疊圖、樹狀圖、四象限、金字塔、文氏圖、長條圖、折線圖、使用者旅程圖、看板。

要再加一張：`node scripts/dump-segments.mjs <範本id>` 印出每一段與序號，
照序號寫進 `content/zh-samples.json`，再 `npm run build`。段數對不上建置會直接紅。

中文比英文寬，同樣一句話常常寬一倍。字太長時本站會自動縮小字級塞進框裡，
縮到看不清楚就代表該把字改短——這是刻意的：把字撐爆框線比縮小更糟。

用到 SVG `foreignObject` 的三張「分層資料架構圖」不能轉 PNG（瀏覽器不會把 foreignObject
畫進圖片裡），畫面上會直接停用 PNG 按鈕並說明原因，請改用 SVG 或 HTML。

## 架構

```
index.html              介面與樣式（視覺與 gongwu-calc 對齊）
app/core.js             唯一的純函式層，不碰 DOM，Node 直接 require 得動（UMD，瀏覽器掛 window.DD）
app/app.js              載資料、畫範本列表、hash 路由
app/editor.js           改字畫面的流程層：渲染、換色、換字體、自動縮字、下載、剪貼簿、設定檔
app/flow.js             流程圖產生器的畫面層（大綱 → core.js 算版面 → 交給 editor 預覽與匯出）
data/diagrams.json      建置產物（2 MB），153 張自足 SVG＋中文分類＋中文層。commit 進 repo，部署時直接送上去
content/zh-samples.json 人工寫的公務情境中文範例（建置來源，不部署）
scripts/build-data.mjs  vendor/upstream/*.html ＋ content/zh-samples.json → data/diagrams.json
scripts/dump-segments.mjs  印出一張圖的每一段文字與序號，寫中文範例時用
vendor/upstream/         上游範例圖的原樣副本＋LICENSE＋SOURCE.json（只在建置時用，不部署）
```

改了 `app/core.js` 的轉換規則，就要重跑 `npm run build`。忘了跑的話 `npm run test:unit`
會直接紅——`tests/data.mjs` 會重跑一次建置並跟 commit 進來的 JSON 逐字比對。

## 測試（推上去前必做，沒有例外）

| 指令 | 內容 |
|---|---|
| `npm test` | 全部：`core.unit`（156）＋`data`（25）＋`e2e`（65），約 2 分鐘 |
| `npm run test:unit` | 純函式＋資料一致性，約 3 秒 |
| `npm run test:e2e` | 真的開 Chromium 點按鈕、真的下載檔案 |
| `npm run build` | 重新產生 `data/diagrams.json` |
| `npm start` | 起一個本機伺服器，印出網址 |

- 單元測試直接 `require` 站上那份 `app/core.js`，**不做副本**——副本會跟站上的碼悄悄走鐘，
  「測試全過但測的是舊碼」比沒測試更危險。
- e2e 有一項專門攔 `page.on('request')` 驗證整趟操作沒有任何對外請求，**不要把它拿掉**，
  那是這個站存在的理由。另有一項逐一開完 153 張範本，確認每一張都畫得出來、文字都抓得到，
  並比對「畫面切出來的段數」與「純函式切出來的段數」——中文層是依序號對應的，
  兩邊切法一旦不同，中文會整批錯位，而畫面上只是「字怪怪的」，不會報錯。
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
