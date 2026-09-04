# 公務用圖表範本庫

純靜態、純前端的圖表範本挑選與改字工具。使用者是公務同仁，要做的是簡報與公文裡那張圖。
**「資料不離開這台裝置」是這個站存在的理由**，任何修改都不得違反。

## 鐵律

1. **零對外連線**。不加 CDN、不加後端、不加追蹤、不呼叫 LLM、不載 webfont。
   e2e 有一項專門攔 `page.on('request')` 驗證整趟操作沒有任何外部請求，不要把它拿掉。
2. **來源標註不可拿掉**。範本取自 `cathrynlavery/diagram-design`（MIT，Cathryn Lavery），
   首頁說明卡、頁尾、以及每一份下載的 SVG／PNG／HTML 都要帶上來源與授權。
   字串集中在 `core.js` 的 `SOURCE`，`core.unit` 有一組測試盯著它，不要各處各寫一份。
   `vendor/upstream/` 裡的 LICENSE 與 SOURCE.json 不可刪。
3. **純函式不碰 DOM**。`app/core.js` 是唯一的純函式層，Node 直接 require 得動；
   `app/app.js`／`app/editor.js` 才碰 DOM 與下載。混在一起就測不了。
4. **`data/diagrams.json` 是建置產物，但要 commit**。部署時直接送上 CDN，不在 CDN 上跑建置。
   改了 `core.js` 的轉換規則就要 `npm run build`，忘了跑 `tests/data.mjs` 會直接紅。

## 架構

- `index.html`：介面與樣式。視覺刻意跟公務用工具箱（gongwu-calc）對齊：暖紙底 `#f3f1e9`、
  印章紅 `#9d2b25`、標題襯線體、卡片白底暖灰框。**字型只寫字族名、絕不載 webfont。**
- `app/core.js`：抽 SVG、收 CSS、換字型、換色、折行、組匯出檔、分類與篩選。
  UMD 包法，瀏覽器掛 `window.DD`，Node `require` 同一份。零相依。
- `app/app.js`：載 `data/diagrams.json`、畫範本列表、hash 路由（`#/` 列表、`#/範本id` 改字）。
- `app/editor.js`：改字畫面。掛 `window.DDEditor`。
- `scripts/build-data.mjs`：`vendor/upstream/*.html` ＋ `content/zh-samples.json` → `data/diagrams.json`。
- `content/zh-samples.json`：人工寫的公務情境中文範例，一張圖一筆，`texts` 依序號對應圖上每一段。
  用 `node scripts/dump-segments.mjs <範本id>` 查序號。**只在建置時用，不部署。**
- `vendor/upstream/`：上游範例圖的原樣副本（153 個 HTML）＋ LICENSE ＋ SOURCE.json。
  只在建置時用，**不部署**（部署包只有 `index.html`、`_headers`、`app/`、`data/`）。

### 幾個踩過的坑

- **`<svg>` 的抽取要「第一個 `<svg` 到最後一個 `</svg>`」**。上游有 9 張圖在主 SVG 裡放了
  巢狀的小 svg 當圖示，用非貪婪比對會在第一個內層圖示就收尾，整張圖只剩前幾百個位元組——
  而且畫面上看起來只是「這張圖怪怪的」，不會報錯。
- **收進 SVG 的 CSS 一定要冠上那張圖自己的 class**。`<style>` 是整份文件共用的，
  首頁一次排 150 張圖，不冠的話 A 圖的 `.node{fill:...}` 會把 B 圖的 `.node` 一起改掉，
  而且只在「兩張圖同時出現在畫面上」時才看得出來。`@keyframes` 也要改名，同理。
- **`:root` 不能原封不動搬進 SVG**。inline 在 HTML 裡時 `:root` 指的是 `<html>`，
  會把整站的設計語彙變數蓋掉。一律改寫成 `.dd-<id>`。
- **字型藏在三個地方**：SVG 的 `font-family` 屬性、CSS 的 `font-family` 宣告，
  還有 `--sans`／`--serif`／`--mono`／`--font-sans` 這類自訂屬性。
  漏掉自訂屬性那一種，整張圖看起來沒事，實際上還在指名要 Geist——中文就變成方塊或退回預設字。
- **換色要先換成暫時色再換成目標色**。`ink→paper`、`paper→ink` 這種對調直接換的話，
  第二輪會把第一輪剛換好的顏色再換一次，整張圖只剩一個顏色。
- **巢狀 `<svg>` 一定要明寫 `x`／`y`／`width`／`height`**。只給 viewBox 的話它會撐滿整個外框，
  直接蓋掉上面剛加的標題。
- **量文字寬度前要先讓元素看得見**。`getComputedTextLength()` 在 `display:none` 底下一律回 0，
  自動縮字就整個失效。路由要先把 `#editorView` 顯示出來，再呼叫 `DDEditor.open()`。
- **字級要換算回 SVG 的座標單位**。`getComputedStyle().fontSize` 給的是畫面上的 px，
  SVG 被縮放過，直接拿去設會整個跑掉。除以「畫面寬 ÷ viewBox 寬」才是使用者單位。
  另外用 inline style 設而不是設屬性——CSS class 的規則會蓋掉屬性。
- **折行時行首的空白要丟掉**。留著會佔掉下一行的寬度，連鎖起來每一行都少一個字，
  最後一個字被擠成單獨一行（實測 `alpha beta gamma` 折成 `alpha / beta / gamm / a`）。
- **上游有三張深色範例把滿版底色寫死成淺色**（長條圖、甘特圖、散布圖），
  白底配白網點幾乎看不見。`fixDarkBackdrop()` 只換那一塊滿版的底，
  其餘的 `#f5f5f5` 在深色圖裡是文字色，不能一起換。
- **`<foreignObject>` 不會被畫進 PNG**。三張分層資料架構圖用到它，
  建置時就標成 `png:false`，畫面上直接停用 PNG 按鈕並說明原因。悄悄產出一張缺一塊的圖更糟。
- **`package.json` 不要加 `"type": "module"`**。加了之後 `app/core.js` 會被 Node 當成 ESM，
  UMD 的 `module.exports` 那一支就走不到，`require()` 拿回來的是空的。測試檔本來就是 `.mjs`，
  不需要那個欄位。
- **無頭 Chromium 在容器裡會把非 ASCII 的下載檔名整個丟掉**（`測試檔.txt` → `download`）。
  那是測試環境的語系問題，不是站上的問題；e2e 的檔名斷言改用英文標題，
  中文檔名的組法在 `core.unit` 的 `safeFilename` 測。

## 中文層

上游範本是英文的，內容是軟體專案的示範資料。**逐字直譯沒有用**——那些字使用者本來就要整段
換掉。所以分兩層，都在建置時算好，站上不呼叫 LLM：

1. **公務範例**（`content/zh-samples.json`）：人工把整張圖改寫成公務情境，不是翻譯。
   46 張、16 種圖。深色版與完整版自動沿用標準版那一筆，**但段數不同時就不套**
   （完整版常多畫幾個方塊，硬套會整批錯位）。
2. **骨架字典**（`core.js` 的 `GLOSSARY`）：圖例、月份、季別、是／否、狀態欄位這類
   「換掉內容之後還會留在圖上」的固定用字，141 張都吃得到。

**沒有通用中文譯名的專有名詞一律留原文**（UML、Sankey、Wardley、draw.io、Mermaid、
類別名稱、資料庫欄位名…）。`glossaryLookup` 查不到就回 `null`，原文保留——硬翻更難懂。
`GLOSSARY` 也**不收內容字**（Sprint velocity、Kubernetes、Athena 那些），`core.unit` 有一項盯著。

**中文層是「依序號對應」的**：`extractTextSegments()`（純函式）切出來的段數，必須跟
`editor.js` 的 `collectUnits()`（DOM）切出來的完全一致。兩邊切法一旦不同，中文就整批錯位，
而畫面上只是「字怪怪的」，不會報錯。e2e 逐張比對兩邊的段數，那是這一層唯一的安全網。

畫面上的優先序：**使用者自己改的 → 中文層（開關打開時）→ 範本原文**，
三者共用 `effectiveText(i)`，畫面、文字清單、下載才不會各說各話。

## 產品取捨：焦點是「Excel 做不到的圖」

使用者的痛點是**流程圖超難做**；長條圖、折線圖、圓餅圖 Excel 兩下就有。
所以首頁最上面是七個快捷入口（`core.js` 的 `STARTERS`，全部已中文化），
清單預設也只給 `COMMON_TYPES`——那份清單的判準是「Excel 做不到、自己排會排到崩潰」，
**不是**「公務常見」。長條圖與折線圖仍留在庫裡（有人就是想在這裡做各種事），
只是不放在預設的視野裡；取消「只看 Excel 做不到的那種圖」就看得到。

改 `STARTERS` 時記得：`tests/data.mjs` 會檢查每一張都存在且已寫好整份中文——
快捷入口點下去卻是滿滿英文，比沒有快捷入口更糟。

## 幾個後來加的省事功能

- **複製圖片到剪貼簿**：`navigator.clipboard.write` ＋ `ClipboardItem`。
  需要安全內容（https 或 localhost），不支援時要明講「請改按下載 PNG」，不要靜靜失敗。
- **從 Excel 貼一整欄**：一行對一段，從「目前選取的那一段」開始依序填。
  一行裡有多欄（tab）併成「甲 · 乙」，**不拆成兩段**——拆了後面每一段都會錯位。
- **存出／載入設定檔**：存的是「使用者改了什麼」，不是整張 SVG，範本更新後舊設定照樣套得上。
  `parseProjectFile` 的每一種失敗都要講人話，不能讓使用者看到 `JSON.parse` 的英文錯誤；
  設定檔是使用者給的輸入，序號 key 要驗過再用。
- **整張換字體**：`forceFontFamily()`，公文常用標楷體。一樣只寫字族名，
  沒裝標楷體的機器要退回襯線體才不會變成預設字。

## 修改紀律

1. 行為改了，就要同步改畫面上的 `hint` 說明文字與 `README.md`。
2. 信任邊界的輸入驗證、防資料遺失的錯誤處理、無障礙屬性不可省
   （e2e 有一組專測 label／`role=alert`／`aria-live`）。
3. 錯誤訊息一律講人話、講得出下一步該做什麼（例：「這張圖轉不成 PNG，請改用 SVG 或 HTML 下載」）。
4. **預覽框是唯一真相**：使用者在畫面上看到什麼，下載的檔案就是什麼。
   不要在旁邊偷偷維護一份看不見的結構。
5. 使用者的真實需求是「把英文範本改成中文」，而中文比英文寬。改任何跟字級、折行、
   框線有關的東西之前，先拿一張真的塞滿中文的圖看過。

## 測試（推上去前必做，沒有例外）

| 指令 | 內容 |
|---|---|
| `npm test` | 全部：`core.unit`（132）＋`data`（25）＋`e2e`（57），約 2 分鐘 |
| `npm run test:unit` | 純函式＋資料一致性，約 3 秒 |
| `npm run test:e2e` | 只跑瀏覽器實測 |

- 單元測試直接 `require` 站上那份 `app/core.js`，**不做副本**。
- `tests/data.mjs` 會重跑一次 `scripts/build-data.mjs` 並跟 commit 進來的 JSON 逐字比對，
  這是唯一擋得住「建置產物走鐘」的關卡。
- e2e 逐一開完 153 張範本，確認每一張都畫得出來、文字清單都對得上，
  並比對純函式與 DOM 兩邊切出來的段數（中文層的安全網，見上）。
  新增或移除範本時，張數寫死在 `tests/e2e.mjs`（多處）與 `index.html` 的說明文字裡；
  中文範本的張數也寫在 `index.html` 的說明卡與 `README.md`。
- 錯誤訊息的測試要斷言**看得見**（`isVisible()`），不能只斷言 `textContent`。
- 不能用 `file://` 開來測，`fetch()` 會被擋。

## 部署

**push 就自動上線**，走 `.github/workflows/deploy.yml`。細節與注意事項見 `README.md` 的「部署」段。

- 憑證是 repo secret：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`（每個 repo 各自獨立）。
- Pages 專案的 production branch 寫死 `main`，不要用 `default_branch`。
- 網址一律從 Actions 的部署摘要讀，不要猜——Pages 子網域撞名會自動加後綴。
- 驗收不能只看首頁：要點進一張範本、改成中文、真的下載一次 PNG。

## 跟工具箱的關係

這是「公務用工具箱」（gongwu-calc）的衛星站台，入口卡片掛在工具箱的 `index.html`
（`diagramTemplateTool()`）。更新這支工具＝改這個 repo，工具箱的 index.html 不用動；
只有網址變了才要回去改那張卡片。
