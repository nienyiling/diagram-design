/*
 * e2e.mjs — 真的開一顆 Chromium，真的點按鈕、真的下載檔案。
 *
 * 這裡擋的是純函式測不到的三件事：
 *   1. 零對外連線（攔 page.on('request')，整趟只該打自己）
 *   2. 資料檔真的載得進來、150 張圖真的畫得出來（少一個檔案首頁看起來完全正常）
 *   3. 錯誤訊息真的「看得見」——.errbox 預設 display:none，只塞文字會被 CSS 蓋掉
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { serve, loadPlaywright, scoreboard } from './helpers.mjs';

const s = scoreboard('e2e');
const t = (name, fn) => s.t(name, fn);

const server = await serve();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();

/** 開一個新分頁，順便盯著 pageerror 與所有對外請求。 */
async function newPage(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(server.url) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  page.errors = errors;
  page.external = external;
  return page;
}

const ctx = await browser.newContext({ acceptDownloads: true });
const page = await newPage(ctx);
await page.goto(server.url, { waitUntil: 'networkidle' });

/* ── 首頁 ────────────────────────────────────────────────────────── */

await t('首頁打得開，標題是中文的', async () => {
  assert.equal(await page.title(), '公務用圖表範本庫');
  assert.equal(await page.locator('h1').first().innerText(), '公務用圖表範本庫');
});

await t('頂欄有回工具箱的路', async () => {
  const href = await page.locator('.topbar .back').getAttribute('href');
  assert.equal(href, 'https://gongwu-calc.netlify.app');
});

await t('標題底下標明範本的 GitHub 來源與授權，而且整頁只標一次', async () => {
  const src = page.locator('.source');
  assert.equal(await src.count(), 1, '來源標註應該只有一處');
  assert.equal(await src.isVisible(), true, '來源標註要看得見');
  const text = await src.innerText();
  assert.ok(text.includes('cathrynlavery/diagram-design'), text);
  assert.ok(text.includes('MIT'), text);
  assert.ok(text.includes('Cathryn Lavery'), text);
  /* 頁面上只留一處連到上游，不要在說明卡與頁尾各講一次 */
  assert.equal(
    await page.locator('a[href="https://github.com/cathrynlavery/diagram-design"]').count(), 1);
});

await t('隱私承諾寫在首頁上', async () => {
  assert.ok((await page.locator('.privacy').innerText()).includes('資料不離開這台裝置'));
});

await t('預設先給公務常用的類型，而且真的有圖', async () => {
  assert.equal(await page.locator('#commonChk').isChecked(), true);
  const n = await page.locator('.tile').count();
  assert.ok(n > 20, '常用類型只有 ' + n + ' 張');
});

await t('縮圖真的畫出 SVG（不是留在「載入中」）', async () => {
  await page.locator('.tile .thumb svg').first().waitFor({ state: 'attached', timeout: 10000 });
  const n = await page.locator('.tile .thumb svg').count();
  assert.ok(n > 3, '只畫出 ' + n + ' 張縮圖');
});

await t('計數那行說得出總數', async () => {
  const line = await page.locator('#countLine').innerText();
  assert.match(line, /找到 \d+ 張範本（其中 \d+ 張已寫好整份中文內容・全庫共 153 張）/);
});

await t('取消「只看常用」會看到全部 153 張', async () => {
  await page.locator('#commonChk').uncheck();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.tile').count(), 153);
});

await t('搜「流程」找得到流程圖', async () => {
  await page.locator('#q').fill('流程');
  await page.waitForTimeout(150);
  const n = await page.locator('.tile').count();
  assert.ok(n >= 3 && n < 153, '搜出 ' + n + ' 張');
  assert.ok((await page.locator('.tile .t1').first().innerText()).includes('圖'));
});

await t('搜不到東西時，錯誤提示是「看得見」的（不能只塞文字）', async () => {
  await page.locator('#q').fill('zzzz不存在的東西');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.tile').count(), 0);
  assert.equal(await page.locator('#galleryErr').isVisible(), true, '.errbox 沒有加 .show 就會被 CSS 蓋掉');
  assert.equal(await page.locator('#galleryErr').getAttribute('role'), 'alert');
});

await t('類型下拉選單有中文名與張數', async () => {
  await page.locator('#q').fill('');
  const opts = await page.locator('#typeSel option').allInnerTexts();
  assert.ok(opts.some((o) => /^流程圖（\d+）$/.test(o)), opts.slice(0, 5).join(' / '));
});

await t('依類型過濾', async () => {
  await page.locator('#typeSel').selectOption('gantt');
  await page.waitForTimeout(150);
  const n = await page.locator('.tile').count();
  assert.ok(n >= 1 && n <= 5, '甘特圖有 ' + n + ' 張');
  await page.locator('#typeSel').selectOption('');
});

await t('依深淺過濾', async () => {
  await page.locator('#themeSel').selectOption('dark');
  await page.waitForTimeout(150);
  const dark = await page.locator('.tile').count();
  await page.locator('#themeSel').selectOption('light');
  await page.waitForTimeout(150);
  const light = await page.locator('.tile').count();
  await page.locator('#themeSel').selectOption('');
  assert.ok(dark > 0 && light > 0 && dark + light === 153, `深 ${dark} + 淺 ${light}`);
});

/* ── 改字畫面 ────────────────────────────────────────────────────── */

await t('用網址直接開一張範本（可以把連結傳給同事）', async () => {
  await page.goto(server.url + '#/example-flowchart', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#editorView').isVisible(), true);
  assert.equal(await page.locator('#galleryView').isVisible(), false);
  assert.ok((await page.locator('#edKind').innerText()).includes('流程圖'));
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
});

await t('文字清單抓到圖上的每一段字', async () => {
  const rows = await page.locator('#textList .trow').count();
  assert.ok(rows > 10, '只抓到 ' + rows + ' 段');
  assert.ok((await page.locator('#textCount').innerText()).includes('共 ' + rows + ' 段'));
});

await t('每個輸入框都有標籤（螢幕報讀器要唸得出來）', async () => {
  const n = await page.locator('#textList textarea').count();
  const labels = await page.locator('#textList label').count();
  assert.equal(labels, n);
});

await t('把英文改成中文，圖上就是中文', async () => {
  const ta = page.locator('#textList textarea').first();
  await ta.fill('新的作業流程');
  await page.waitForTimeout(200);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('新的作業流程'), svgText.slice(0, 120));
});

await t('中文太長時字級會自動縮小（不然會爆出框線）', async () => {
  const ta = page.locator('#textList textarea').first();
  await ta.fill('這是一段刻意寫得非常非常長的中文字用來測試自動縮字有沒有生效');
  await page.waitForTimeout(250);
  const size = await page.evaluate(() => {
    const u = window.DDEditor._state().units[0];
    return u.node.style.fontSize;
  });
  assert.ok(size && parseFloat(size) > 0, '沒有套上縮小後的字級：' + size);
});

await t('關掉自動縮字就不縮', async () => {
  await page.locator('#fitChk').uncheck();
  await page.waitForTimeout(250);
  const size = await page.evaluate(() => window.DDEditor._state().units[0].node.style.fontSize);
  assert.equal(size, '');
  await page.locator('#fitChk').check();
  await page.waitForTimeout(200);
});

await t('一段字裡按 Enter 可以換行', async () => {
  const idx = await page.evaluate(() => window.DDEditor._state().units.findIndex((u) => u.multiline));
  assert.ok(idx >= 0, '這張圖沒有可換行的段落');
  await page.locator('#dd-t' + idx).fill('第一行\n第二行');
  await page.waitForTimeout(250);
  const tspans = await page.evaluate((i) => window.DDEditor._state().units[i].node.querySelectorAll('tspan').length, idx);
  assert.equal(tspans, 2);
});

await t('換配色會把底色換掉', async () => {
  const before = await page.evaluate(() => document.querySelector('#stage svg rect').getAttribute('fill'));
  await page.locator('#paletteSel').selectOption('gongwu');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => document.querySelector('#stage svg rect').getAttribute('fill'));
  assert.notEqual(before, after);
  assert.equal(after.toLowerCase(), '#f3f1e9', '應該換成工具箱的暖紙底');
});

await t('換配色不會沖掉剛才改的中文字', async () => {
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('第一行'), '換色後改過的字不見了');
});

await t('色票說明列出四個顏色', async () => {
  assert.equal(await page.locator('#swatches .swatch').count(), 4);
});

await t('點圖上的文字會跳到對應的欄位', async () => {
  await page.locator('#stage svg text').nth(2).click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#textList .trow.on').count(), 1);
  assert.equal(await page.locator('#stage .dd-highlight').count(), 1, '沒有畫出選取框');
});

/* ── 下載 ────────────────────────────────────────────────────────── */

async function grab(buttonId) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#' + buttonId).click()
  ]);
  const p = await download.path();
  return { name: download.suggestedFilename(), buf: fs.readFileSync(p) };
}

await t('下載 SVG：內容帶著改過的字、標題與來源標註', async () => {
  await page.locator('#edTitleIn').fill('本府案件處理流程');
  await page.waitForTimeout(150);
  const f = await grab('dlSvg');
  const text = f.buf.toString('utf8');
  assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(text.includes('本府案件處理流程'), '標題沒有寫進去');
  assert.ok(text.includes('第一行'), '改過的字沒有寫進去');
  assert.ok(text.includes('cathrynlavery/diagram-design'), '來源標註沒有寫進去');
  assert.ok(text.includes('MIT'), '授權沒有寫進去');
  assert.ok(!text.includes('dd-highlight'), '編輯用的選取框不該跟著下載');
});

await t('下載的 SVG 沒有任何對外網址', async () => {
  const f = await grab('dlSvg');
  const text = f.buf.toString('utf8');
  const urls = (text.match(/https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+/g) || [])
    .filter((u) => !u.startsWith('http://www.w3.org/'));
  /* 來源標註寫的是 github.com/...（不帶通訊協定），所以匯出檔裡連一個 http 開頭的網址都不該有 */
  assert.deepEqual([...new Set(urls)], []);
  assert.ok(text.includes('github.com/cathrynlavery/diagram-design'), '來源標註還是要在');
});

/* 檔名用英文標題驗：無頭 Chromium 在這個容器的語系下會把非 ASCII 檔名整個丟掉
   （實測 '測試檔.txt' 會變成 'download'），那是測試環境的事，不是站上的事。
   中文檔名的組法在 core.unit 的 safeFilename 已經測過了。 */
await t('下載的副檔名與檔名由標題決定', async () => {
  await page.locator('#edTitleIn').fill('Case flow 2026');
  await page.waitForTimeout(150);
  assert.equal((await grab('dlSvg')).name, 'Case flow 2026.svg');
  assert.equal((await grab('dlHtml')).name, 'Case flow 2026.html');
});

await t('下載 PNG：真的是一張 PNG，尺寸有照倍率放大', async () => {
  const f = await grab('dlPng');
  assert.equal(f.name, 'Case flow 2026.png');
  assert.deepEqual([...f.buf.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], '不是 PNG 檔頭');
  const w = f.buf.readUInt32BE(16);
  assert.ok(w >= 1900, '2 倍解析度應該有 2000 左右的寬度，實際 ' + w);
  assert.equal(await page.locator('#edOk').isVisible(), true);
});

await t('PNG 解析度選 1 倍就真的比較小', async () => {
  await page.locator('#scaleSel').selectOption('1');
  const f = await grab('dlPng');
  assert.ok(f.buf.readUInt32BE(16) < 1500, '1 倍應該是 1000 左右');
  await page.locator('#scaleSel').selectOption('2');
});

await t('下載 HTML：離線開得起來、以預覽框為準', async () => {
  await page.locator('#edTitleIn').fill('本府案件處理流程');
  await page.waitForTimeout(150);
  const f = await grab('dlHtml');
  const text = f.buf.toString('utf8');
  assert.ok(text.startsWith('<!doctype html>'));
  assert.ok(text.includes('本府案件處理流程'));
  assert.ok(text.includes('第一行'));
  assert.ok(text.includes('cathrynlavery/diagram-design'));
  assert.ok(!/<script/i.test(text), '下載的檔案裡不該有可執行的東西');
});

await t('全部復原會回到範本原本的樣子', async () => {
  await page.locator('#resetBtn').click();
  await page.waitForTimeout(250);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(!svgText.includes('第一行'));
  assert.equal(await page.locator('#paletteSel').inputValue(), 'source');
  assert.equal(await page.locator('#edOk').isVisible(), true);
});

await t('用到 foreignObject 的範本會停用 PNG 並說明原因', async () => {
  await page.goto(server.url + '#/example-medallion', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#dlPng').isDisabled(), true);
  assert.equal(await page.locator('#pngNote').isVisible(), true);
  assert.ok((await page.locator('#pngNote').innerText()).includes('foreignObject'));
});

await t('回列表的連結真的回得去', async () => {
  await page.locator('#backLink').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#galleryView').isVisible(), true);
  assert.equal(await page.locator('#editorView').isVisible(), false);
});

/* ── 中文層 ──────────────────────────────────────────────────────── */

await t('中文範本：一打開就是中文，標題也是中文', async () => {
  await page.goto(server.url + '#/example-swimlane', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#zhChk').isChecked(), true, '有中文就該預設套上');
  assert.equal(await page.locator('#zhRow').isVisible(), true);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('承辦人'), svgText.slice(0, 120));
  assert.ok(svgText.includes('草擬簽稿'), '內容沒有換成公務情境');
  assert.equal(await page.locator('#edTitleIn').inputValue(), '公文簽辦流程 · 誰負責哪一段');
});

await t('取消「先套上中文」會回到範本原文', async () => {
  await page.locator('#zhChk').uncheck();
  await page.waitForTimeout(300);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(!svgText.includes('承辦人'));
  assert.ok(svgText.includes('AUTHOR'), svgText.slice(0, 120));
  assert.equal(await page.locator('#edTitleIn').inputValue(), '');
  await page.locator('#zhChk').check();
  await page.waitForTimeout(300);
});

await t('自己改過的字不會被中文層蓋掉', async () => {
  await page.locator('#dd-t0').fill('本科承辦');
  await page.waitForTimeout(250);
  await page.locator('#zhChk').uncheck();
  await page.waitForTimeout(250);
  let svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('本科承辦'), '關掉中文層時使用者改的字不見了');
  await page.locator('#zhChk').check();
  await page.waitForTimeout(250);
  svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('本科承辦'), '打開中文層時使用者改的字被蓋掉了');
});

await t('沒有整份中文的範本，至少圖例那類固定用字是中文', async () => {
  await page.goto(server.url + '#/example-sankey', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  const note = await page.locator('#zhNote').innerText();
  assert.ok(note.includes('固定用字'), note);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('圖例'), '連圖例都沒換成中文');
});

await t('沒有對應中文的專有名詞留原文，不硬翻', async () => {
  await page.goto(server.url + '#/example-uml-class', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('繼承'), '圖例那類該換的沒換');
  assert.ok(svgText.includes('PaymentMethod'), '類別名稱這種專有名詞應該留原文');
});

await t('列表上看得出哪些是中文範本，也篩得出來', async () => {
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await page.locator('#commonChk').uncheck();
  await page.locator('#zhOnlyChk').check();
  await page.waitForTimeout(200);
  const n = await page.locator('.tile').count();
  assert.ok(n >= 30, '只篩出 ' + n + ' 張');
  assert.equal(await page.locator('.tile .badge.zh').count(), n, '每一張都該掛中文範本徽章');
  assert.ok((await page.locator('#countLine').innerText()).includes('已寫好整份中文'));
  await page.locator('#zhOnlyChk').uncheck();
  await page.locator('#commonChk').check();
  await page.waitForTimeout(200);
});

await t('下載的圖帶著中文內容', async () => {
  await page.goto(server.url + '#/example-flowchart', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#dlSvg').click()
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(text.includes('收到新型態案件'), '中文內容沒有寫進下載檔');
  assert.ok(text.includes('案件要不要訂成標準作業程序'), '中文標題沒有寫進下載檔');
});

/* ── 每一張圖都要畫得出來 ──────────────────────────────────────────── */

await t('153 張範本逐一開起來，都畫得出圖、都抓得到文字', async () => {
  const ids = await page.evaluate(() => window.DDApp._data().diagrams.map((d) => d.id));
  assert.equal(ids.length, 153);
  const bad = [];
  for (const id of ids) {
    await page.evaluate((i) => { location.hash = '#/' + i; }, id);
    await page.waitForTimeout(12);
    const info = await page.evaluate(() => {
      const svg = document.querySelector('#stage svg');
      const st = window.DDEditor._state();
      /* 純函式切出來的段數，一定要跟畫面上實際抓到的一樣：
         中文層是依序號對應的，兩邊切法一旦不同，中文就整批錯位，
         而畫面上只是「字怪怪的」，不會報錯——所以這一項是中文層的安全網 */
      return {
        has: !!svg,
        units: st ? st.orig.length : 0,
        rows: document.querySelectorAll('#textList .trow').length,
        pure: window.DD.extractTextSegments(st.d.svg).length,
        zh: st.d.zh ? st.d.zh.length : null
      };
    });
    if (!info.has) bad.push(id + '：畫不出 svg');
    else if (info.units !== info.rows) bad.push(id + '：文字清單對不上');
    else if (info.units !== info.pure) bad.push(`${id}：畫面切 ${info.units} 段、純函式切 ${info.pure} 段`);
    else if (info.zh != null && info.zh !== info.units) bad.push(id + '：中文層長度對不上');
  }
  assert.deepEqual(bad, []);
});

/* ── 零對外連線與 pageerror ────────────────────────────────────────── */

await t('整趟操作沒有任何對外請求', () => {
  assert.deepEqual([...new Set(page.external)], [], '打到外面去了');
});

await t('整趟操作沒有 pageerror、沒有 console error', () => {
  assert.deepEqual(page.errors, []);
});

/* ── 資料載不進來時要講人話 ────────────────────────────────────────── */

await t('資料檔掛掉時，畫面上看得見一句講得出下一步的錯誤訊息', async () => {
  const p2 = await newPage(ctx);
  await p2.route('**/data/diagrams.json', (r) => r.abort());
  await p2.goto(server.url, { waitUntil: 'domcontentloaded' });
  await p2.locator('#galleryErr.show').waitFor({ timeout: 5000 });
  assert.equal(await p2.locator('#galleryErr').isVisible(), true);
  const msg = await p2.locator('#galleryErr').innerText();
  assert.ok(msg.includes('範本資料載不進來'), msg);
  assert.ok(msg.includes('file://'), '要講出「直接點開檔案不會動」這件事');
  await p2.close();
});

/* ── 無障礙的最低限度 ────────────────────────────────────────────── */

await t('搜尋與篩選都有標籤', async () => {
  await page.goto(server.url, { waitUntil: 'networkidle' });
  for (const id of ['q', 'typeSel', 'themeSel']) {
    const n = await page.locator(`label[for="${id}"]`).count();
    assert.equal(n, 1, id + ' 沒有標籤');
  }
});

await t('狀態訊息有 aria-live，錯誤訊息有 role=alert', async () => {
  assert.equal(await page.locator('#countLine').getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('#galleryErr').getAttribute('role'), 'alert');
  await page.goto(server.url + '#/example-flowchart', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#edErr').getAttribute('role'), 'alert');
  assert.equal(await page.locator('#dlErr').getAttribute('role'), 'alert');
  assert.equal(await page.locator('#edOk').getAttribute('aria-live'), 'polite');
});

await t('沒有 JavaScript 時也講得出這個站在做什麼', async () => {
  const noscript = await page.locator('noscript').innerHTML();
  assert.ok(noscript.includes('JavaScript'));
});

await browser.close();
await server.close();
s.finish();
