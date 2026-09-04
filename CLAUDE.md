# 公務用圖表工具

純靜態、純前端。主體是**五種填表產生器**（流程圖、甘特圖、時間軸、分層堆疊圖、四象限），
另附 153 張現成範本可改字。使用者是公務同仁，要做的是簡報與公文裡那張圖。
**「資料不離開這台裝置」是這個站存在的理由**，任何修改都不得違反。

**產生器不靠 AI，也不准靠。** 使用者填表時結構就已經給定了（哪一列是判斷、哪一項幾號開始），
剩下的只是算術。要 AI 的是「從一段自由文字猜出結構」——本站不做那件事。

## 鐵律

1. **零對外連線**。不加 CDN、不加後端、不加追蹤、不呼叫 LLM、不載 webfont。
   e2e 有一項專門攔 `page.on('request')` 驗證整趟操作沒有任何外部請求，不要把它拿掉。
2. **來源標註不可拿掉**。範本取自 `cathrynlavery/diagram-design`（MIT，Cathryn Lavery），
   首頁說明卡、頁尾、以及每一份下載的 SVG／PNG／HTML 都要帶上來源與授權。
   字串集中在 `core.js` 的 `SOURCE`，`core.unit` 有一組測試盯著它，不要各處各寫一份。
   `vendor/upstream/` 裡的 LICENSE 與 SOURCE.json 不可刪。
3. **純函式不碰 DOM**。純函式層是 `app/core.js` 與 `app/gen.js`（後者只相依前者），
   Node 直接 require 得動；`app/app.js`／`app/editor.js`／`app/forms.js` 才碰 DOM 與下載。
   混在一起就測不了。
4. **`data/diagrams.json` 是建置產物，但要 commit**。部署時直接送上 CDN，不在 CDN 上跑建置。
   改了 `core.js` 的轉換規則就要 `npm run build`，忘了跑 `tests/data.mjs` 會直接紅。

## 架構

- `index.html`：介面與樣式。視覺刻意跟公務用工具箱（gongwu-calc）對齊：暖紙底 `#f3f1e9`、
  印章紅 `#9d2b25`、標題襯線體、卡片白底暖灰框。**字型只寫字族名、絕不載 webfont。**
- `app/core.js`：抽 SVG、收 CSS、換字型、換色、折行、組匯出檔、分類與篩選。
  UMD 包法，瀏覽器掛 `window.DD`，Node `require` 同一份。零相依。
- `app/gen.js`：**五種產生器的純函式層**。掛 `window.DDGen`，Node `require` 同一份。
  每一種是一個 descriptor：`{id, name, use, rowName, sample, sampleTitle, help, fields, meta, example, build(rows, meta, opts)}`。
  `fields`／`meta` 是**畫面照著長出表單的規格**，不是註解——新增一種圖只要在這裡加一個
  descriptor，`forms.js` 不必動。
- `app/app.js`：載 `data/diagrams.json`、畫做圖入口與範本列表、hash 路由
  （`#/` 首頁、`#/make/<類型>` 產生器、`#/範本id` 改字；舊的 `#/flow` 轉到 `#/make/flow`）。
- `app/editor.js`：預覽與匯出。掛 `window.DDEditor`。
- `app/forms.js`：產生器的畫面層。掛 `window.DDForms`。
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

## 五種產生器：這個站的主體

範本庫只能換掉別人排好的字——**方塊是畫死的**，使用者的流程有五步而範本畫四步就沒轍。
用現成範本直接改字就能上的機會太小，所以主路徑改成「填表產生」，範本退成示意與備案。

每一種產生器的 `build(rows, meta, opts)` 收一堆平的物件、吐一整份 SVG。共通紀律：

- **`fields`／`meta` 是規格，`forms.js` 照著長出表單。** 欄位型別只有四種：
  `text`、`select`（要附 `options`）、`check`、`rowref`（下拉，選項來自前面幾列的主要文字）。
  `only: 'decision'` 表示那一格只在型別是判斷時出現。`meta` 只收 `text`。
  加新型別要同步改 `forms.js` 的 `fieldNode()`，`gen.unit` 有一項盯著。
- **產出的 SVG 用上游那四個色票的字面值**（`#f5f5f5`／`#2d3142`／`#4f5d75`／`#eb6c36`），
  換配色與換字體那兩條路才吃得到它。改成別的顏色會讓自己做的圖換不了色。
- **使用者打的字一律 `escapeXml`**——那是使用者輸入，直接進 SVG 會變成標籤。
- **填錯絕不靜靜少畫一塊**。每一種錯都要進 `warnings`，講得出是第幾列（或哪一項）、
  使用者實際打了什麼、可以怎麼打。顯示在看得見的 `.errbox` 裡。
  **整列全空要安靜跳過**——對著剛按出來的空白列碎唸很煩。
- **一列都沒填時回一張 `emptyCanvas()`**，上面寫「在左邊填什麼」。空白畫面看起來就像壞了。
- **產生器把整張圖當成一張「臨時的範本」交給 `DDEditor.open()`**，
  預覽、換配色、換字體、下載、複製剪貼簿整套沿用，不要再寫一遍。
  每打一個字就重開一次，所以 `open()` 有 `opts.keepTitle`，不然標題會被洗掉。
- **不給逐段改字，也不給設定檔**（`opts.flow`）。表單是唯一真相；
  兩個地方都能改字的話，使用者改完表單會發現剛才在下面改的字被蓋掉，那更難用。
- **日期一律吃得下民國年**（`parseTwDate`）：`114/3/5`、`114.3.5`、`114年3月5日`、`1140305`、
  全形數字、西元 `2025-03-05`／`20250305`。年份 ≤ 200 當民國、7 碼當民國、8 碼當西元。

### forms.js 的兩種重畫

- **打字（改欄位內容）→ 只重畫預覽**（debounce 220ms），不要動表單的 DOM，不然游標會跳走。
- **結構改變（新增／刪除／上移下移／改型別／改退回目標）→ 整個表單重建**，
  因為「這一列該出現哪些欄位」「退回目標有哪些選項」會跟著變。

`meta` 那一列的 class 是 `.mrow` 不是 `.frow`——共用的話「有幾列」會多算一列，
e2e 的上移下移會點到那一列去。

### 首頁的縮圖是產生器當場畫的

五個做圖入口的縮圖，是 `gen.build(gen.example, ...)` 真的畫出來的，不是範本、也不是圖片檔。
拿範本當縮圖會騙人：使用者看到別人排的形狀，填完卻拿到另一種東西。

## 產品取捨：焦點是「Excel 做不到的圖」

使用者的痛點是**流程圖超難做**；長條圖、折線圖、圓餅圖 Excel 兩下就有。
所以五種產生器全部是 Excel 做不到的那類；範本清單預設也只給 `COMMON_TYPES`——
那份清單的判準是「Excel 做不到、自己排會排到崩潰」，**不是**「公務常見」。
長條圖與折線圖仍留在庫裡（有人就是想在這裡做各種事），只是不放在預設的視野裡。

`core.js` 的 `STARTERS`（七張範本快捷入口）退到範本區裡。改它時記得：
`tests/data.mjs` 會檢查每一張都存在且已寫好整份中文——點下去卻是滿滿英文，比沒有更糟。

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
   不要在旁邊偷偷維護一份看不見的結構。產生器則是「表單是唯一真相」，同一個道理。
5. 使用者的真實需求是「把英文範本改成中文」，而中文比英文寬。改任何跟字級、折行、
   框線有關的東西之前，先拿一張真的塞滿中文的圖看過。

## 測試（推上去前必做，沒有例外）

| 指令 | 內容 |
|---|---|
| `npm test` | 全部：`core.unit`（156）＋`gen.unit`（38）＋`data`（25）＋`e2e`（77），約 2 分鐘 |
| `npm run test:unit` | 純函式＋資料一致性，約 3 秒 |
| `npm run test:e2e` | 只跑瀏覽器實測 |

- 單元測試直接 `require` 站上那份 `app/core.js` 與 `app/gen.js`，**不做副本**。
- `gen.unit` 測「填什麼就得到什麼」與「填錯時有沒有講人話」，**不測座標**——
  座標調版面時本來就會動，寫死了只會讓人不敢改版面。
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
- workflow 裡有一份部署包必要檔案清單，**新增 `app/*.js` 時要同步加進去**，不然
  首頁看起來完全正常，使用者一點做圖入口才發現整支壞掉。
- Pages 專案的 production branch 寫死 `main`，不要用 `default_branch`。
- 網址一律從 Actions 的部署摘要讀，不要猜——Pages 子網域撞名會自動加後綴。
- 驗收不能只看首頁：要進一支產生器改一格字、加一列、真的下載一次 PNG，範本那條路也點一張。

## 跟工具箱的關係

這是「公務用工具箱」（gongwu-calc）的衛星站台，入口卡片掛在工具箱的 `index.html`
（`diagramTemplateTool()`）。更新這支工具＝改這個 repo，工具箱的 index.html 不用動；
只有網址變了才要回去改那張卡片。
