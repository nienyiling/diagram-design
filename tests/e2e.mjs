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
  assert.equal(await page.title(), '公務用圖表工具');
  assert.equal(await page.locator('h1').first().innerText(), '公務用圖表工具');
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

/** 範本區預設是收起來的，測它之前要先打開。 */
async function openMore(p) {
  await p.evaluate(() => { document.getElementById('moreBox').open = true; });
  await p.waitForTimeout(120);
}

await t('首頁只有「你要做哪一種圖」，範本區預設收起來', async () => {
  assert.equal(await page.locator('#moreBox').evaluate((n) => n.open), false,
    '範本區不該預設打開');
  assert.equal(await page.locator('.tile').isVisible().catch(() => false), false);
  /* 收起來歸收起來，來源標註要一直看得見（授權要求） */
  assert.equal(await page.locator('.source').isVisible(), true);
});

await t('首頁最上面就是八個「自己做一張」的入口，縮圖是產生器自己畫的', async () => {
  const makes = page.locator('.make');
  assert.equal(await makes.count(), 8, '八種產生器');
  assert.equal(await makes.first().getAttribute('href'), '#/make/flow');
  assert.ok((await makes.first().innerText()).includes('流程圖'));
  /* 縮圖不是圖片檔也不是範本，是產生器當場畫出來的 SVG */
  assert.equal(await page.locator('.make .shot svg').count(), 8);
});

await t('範本的快捷入口還在，只是退到收合區裡', async () => {
  await openMore(page);
  const starters = page.locator('.starter');
  assert.equal(await starters.count(), 7, '七張範本');
  assert.equal(await starters.first().getAttribute('href'), '#/example-flowchart');
});

await t('預設只給 Excel 做不到的那種圖：長條圖、折線圖不在預設視野裡', async () => {
  await openMore(page);
  assert.equal(await page.locator('#commonChk').isChecked(), true);
  const n = await page.locator('.tile').count();
  assert.ok(n > 20, '預設只有 ' + n + ' 張');
  const names = await page.locator('.tile .t1').allInnerTexts();
  assert.ok(!names.includes('長條圖'), '長條圖不該出現在預設視野');
  assert.ok(!names.includes('折線圖'), '折線圖不該出現在預設視野');
  assert.ok(names.includes('流程圖') && names.includes('泳道圖'), names.slice(0, 6).join(' / '));
});

await t('縮圖真的畫出 SVG（不是留在「載入中」）', async () => {
  await openMore(page);
  /* 清單在第一屏外，跟使用者一樣先捲下去 */
  await page.locator('#tiles').scrollIntoViewIfNeeded();
  await page.locator('.tile .thumb svg').first().waitFor({ state: 'attached', timeout: 10000 });
  const n = await page.locator('.tile .thumb svg').count();
  assert.ok(n > 3, '只畫出 ' + n + ' 張縮圖');
});

await t('計數那行說得出總數', async () => {
  await openMore(page);
  const line = await page.locator('#countLine').innerText();
  assert.match(line, /找到 \d+ 張範本（其中 \d+ 張已寫好整份中文內容・全庫共 153 張）/);
});

await t('取消「只看常用」會看到全部 153 張', async () => {
  await openMore(page);
  await page.locator('#commonChk').uncheck();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.tile').count(), 153);
});

await t('搜「流程」找得到流程圖', async () => {
  await openMore(page);
  await page.locator('#q').fill('流程');
  await page.waitForTimeout(150);
  const n = await page.locator('.tile').count();
  assert.ok(n >= 3 && n < 153, '搜出 ' + n + ' 張');
  assert.ok((await page.locator('.tile .t1').first().innerText()).includes('圖'));
});

await t('搜不到東西時，錯誤提示是「看得見」的（不能只塞文字）', async () => {
  await openMore(page);
  await page.locator('#q').fill('zzzz不存在的東西');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.tile').count(), 0);
  assert.equal(await page.locator('#galleryErr').isVisible(), true, '.errbox 沒有加 .show 就會被 CSS 蓋掉');
  assert.equal(await page.locator('#galleryErr').getAttribute('role'), 'alert');
});

await t('類型下拉選單有中文名與張數', async () => {
  await openMore(page);
  await page.locator('#q').fill('');
  const opts = await page.locator('#typeSel option').allInnerTexts();
  assert.ok(opts.some((o) => /^流程圖（\d+）$/.test(o)), opts.slice(0, 5).join(' / '));
});

await t('依類型過濾', async () => {
  await openMore(page);
  await page.locator('#typeSel').selectOption('gantt');
  await page.waitForTimeout(150);
  const n = await page.locator('.tile').count();
  assert.ok(n >= 1 && n <= 5, '甘特圖有 ' + n + ' 張');
  await page.locator('#typeSel').selectOption('');
});

await t('依深淺過濾', async () => {
  await openMore(page);
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
  await openMore(page);
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

/* ── 後來加的幾個省事功能 ────────────────────────────────────────── */

await t('換成標楷體，圖上的字族真的換掉', async () => {
  await page.goto(server.url + '#/example-flowchart', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#fontSel').selectOption('kai');
  await page.waitForTimeout(300);
  const fam = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#stage svg text')).fontFamily);
  assert.ok(/DFKai-SB|BiauKai|Kaiti|標楷體/.test(fam), fam);
  await page.locator('#fontSel').selectOption('source');
  await page.waitForTimeout(200);
});

await t('從 Excel 貼一整欄，依序填進去', async () => {
  await page.locator('#textCard details.paste summary').click();
  await page.locator('#dd-t4').focus();
  await page.locator('#pasteBox').fill('人事室\n主計室\n政風室');
  await page.locator('#pasteBtn').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#dd-t4').inputValue(), '人事室');
  assert.equal(await page.locator('#dd-t5').inputValue(), '主計室');
  assert.equal(await page.locator('#dd-t6').inputValue(), '政風室');
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('政風室'));
  assert.ok((await page.locator('#edOk').innerText()).includes('填入了 3 段'));
  assert.equal(await page.locator('#pasteBox').inputValue(), '', '填完要清空，不然會重複貼');
});

await t('貼上空白內容時，錯誤訊息是看得見的', async () => {
  await page.locator('#pasteBox').fill('   ');
  await page.locator('#pasteBtn').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#pasteErr').isVisible(), true);
  assert.ok((await page.locator('#pasteErr').innerText()).includes('Excel'));
  await page.locator('#pasteBox').fill('');
});

await t('存出設定檔：是 JSON、記著改了什麼、不含圖檔', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#saveProjBtn').click()
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  const json = JSON.parse(text);
  assert.equal(json.format, 'gongwu-diagram');
  assert.equal(json.diagram, 'example-flowchart');
  assert.equal(json.edits['4'], '人事室');
  assert.ok(!text.includes('<svg'), '設定檔不該包含圖檔');
  fs.writeFileSync('/tmp/dd-proj.json', text);
});

await t('載入設定檔：文字回到存檔當時的樣子', async () => {
  await page.locator('#resetBtn').click();
  await page.waitForTimeout(300);
  assert.notEqual(await page.locator('#dd-t4').inputValue(), '人事室');
  await page.locator('#loadProjInput').setInputFiles('/tmp/dd-proj.json');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#dd-t4').inputValue(), '人事室');
  assert.equal(await page.locator('#edOk').isVisible(), true);
  assert.ok((await page.locator('#edOk').innerText()).includes('已載入設定'));
});

await t('載入別張範本的設定檔時，說得出該去哪一張', async () => {
  fs.writeFileSync('/tmp/dd-other.json', JSON.stringify({
    format: 'gongwu-diagram', version: 1, diagram: 'example-gantt',
    diagramName: '甘特圖：期程', edits: {}
  }));
  await page.locator('#loadProjInput').setInputFiles('/tmp/dd-other.json');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#dlErr').isVisible(), true);
  const msg = await page.locator('#dlErr').innerText();
  assert.ok(msg.includes('甘特圖'), msg);
  assert.ok(msg.includes('example-gantt'), msg);
});

await t('載入壞掉的檔案時講人話，不是丟出 JSON 的英文錯誤', async () => {
  fs.writeFileSync('/tmp/dd-bad.json', '這不是設定檔');
  await page.locator('#loadProjInput').setInputFiles('/tmp/dd-bad.json');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#dlErr').isVisible(), true);
  assert.ok((await page.locator('#dlErr').innerText()).includes('不是本站存出來的設定檔'));
});

await t('複製圖片到剪貼簿', async () => {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#copyPngBtn').click();
  await page.waitForTimeout(1200);
  const err = await page.locator('#dlErr').isVisible()
    ? await page.locator('#dlErr').innerText() : '';
  assert.equal(err, '', '複製失敗：' + err);
  assert.ok((await page.locator('#edOk').innerText()).includes('已複製到剪貼簿'));
});

await t('不能轉 PNG 的範本，複製按鈕也一起停用', async () => {
  await page.goto(server.url + '#/example-medallion', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#copyPngBtn').isDisabled(), true);
});

/* ── 五種產生器：這是「範本只能換字」的解法 ─────────────────────────── */

await t('五種產生器都打得開，一進去就有一份公務情境的範例', async () => {
  for (const [id, name, word] of [
    ['flow', '流程圖', '收到來文'],
    ['gantt', '甘特圖', '各科室需求訪談'],
    ['timeline', '時間軸', '修正草案預告'],
    ['layers', '分層堆疊圖', '受理與分辦'],
    ['quadrant', '四象限圖', '線上申辦改版']
  ]) {
    await page.goto(server.url + '#/make/' + id, { waitUntil: 'networkidle' });
    await page.locator('#stage svg').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#makeCard').isVisible(), true, id + ' 的表單沒出現');
    assert.ok((await page.locator('#makeTitle').innerText()).includes(name), id);
    const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
    assert.ok(svgText.includes(word), id + ' 的圖上找不到「' + word + '」');
  }
});

await t('舊網址 #/flow 轉到新的流程圖產生器', async () => {
  await page.goto(server.url + '#/flow', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(new URL(page.url()).hash, '#/make/flow');
});

await t('產生器不給逐段改字，也不給設定檔（表單是唯一真相）', async () => {
  assert.equal(await page.locator('#textCard').isVisible(), false);
  assert.equal(await page.locator('#zhRow').isVisible(), false);
  assert.equal(await page.locator('#projBox').isVisible(), false);
});

await t('改一格字，圖就跟著改', async () => {
  await page.goto(server.url + '#/make/flow', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#f_flow_1_main').fill('登記並掃描');
  await page.waitForTimeout(500);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('登記並掃描'), svgText.slice(0, 200));
  assert.ok(!svgText.includes('登記收文'));
});

await t('按「加一列」就多一個方塊，而且游標會落在新的那一列', async () => {
  const before = await page.locator('.frow').count();
  await page.locator('#makeAddBtn').click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.frow').count(), before + 1);
  const focused = await page.evaluate(() => document.activeElement.id);
  assert.ok(focused.startsWith('f_flow_' + before + '_'), focused);
  await page.locator('#f_flow_' + before + '_main').fill('後續追蹤');
  await page.waitForTimeout(500);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('後續追蹤'), svgText.slice(0, 200));
});

await t('刪掉那一列，圖上就沒有了', async () => {
  const rows = await page.locator('.frow').count();
  await page.locator('.frow').last().locator('button', { hasText: '✕' }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.frow').count(), rows - 1);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(!svgText.includes('後續追蹤'));
});

await t('上移下移換得動順序', async () => {
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(400);
  const first = await page.locator('#f_flow_0_main').inputValue();
  const second = await page.locator('#f_flow_1_main').inputValue();
  await page.locator('.frow').nth(1).locator('button[aria-label^="上移"]').click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#f_flow_0_main').inputValue(), second);
  assert.equal(await page.locator('#f_flow_1_main').inputValue(), first);
});

await t('第一列不能再上移、最後一列不能再下移', async () => {
  assert.equal(await page.locator('.frow').first()
    .locator('button[aria-label^="上移"]').isDisabled(), true);
  assert.equal(await page.locator('.frow').last()
    .locator('button[aria-label^="下移"]').isDisabled(), true);
});

await t('型別改成「判斷」才長出分岔的欄位', async () => {
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#f_flow_1_branchLabel').count(), 0, '步驟不該有分支欄位');
  await page.locator('#f_flow_1_kind').selectOption('decision');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#f_flow_1_branchLabel').count(), 1, '判斷該有分支欄位');
  assert.equal(await page.locator('#f_flow_1_loopTo').count(), 1);
  assert.equal(await page.locator('#f_flow_1_branchEnds').count(), 1);
});

await t('分支步驟：加在判斷底下，圖上就多一條岔出去的路', async () => {
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(400);
  /* 範例第 4、5 列本來就是分支步驟 */
  assert.equal(await page.locator('#f_flow_3_kind').inputValue(), 'branch');
  await page.locator('#f_flow_3_main').fill('轉陳他機關');
  await page.waitForTimeout(500);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('轉陳他機關'), svgText.slice(0, 200));
  assert.ok(svgText.includes('分支步驟'), '圖例沒有標出分支步驟');
});

await t('「退回到」的選項只有前面那幾列', async () => {
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(400);
  const opts = await page.locator('#f_flow_7_loopTo option').allInnerTexts();
  assert.ok(opts.includes('承辦人擬稿'), opts.join('／'));
  assert.ok(!opts.includes('主管決行'), '後面的步驟不該出現在退回目標裡：' + opts.join('／'));
});

await t('日期打錯時，錯誤訊息是看得見的，而且說得出是哪一項', async () => {
  await page.goto(server.url + '#/make/gantt', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#f_gantt_0_start').fill('三月初');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#makeErr').isVisible(), true, '錯誤訊息沒有顯示出來');
  const msg = await page.locator('#makeErr').innerText();
  assert.ok(msg.includes('各科室需求訪談'), msg);
  assert.ok(msg.includes('三月初'), msg);
});

await t('「填入範例」把整份還原', async () => {
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#f_gantt_0_start').inputValue(), '114/3/3');
  assert.equal(await page.locator('#makeErr').isVisible(), false);
});

await t('「全部清空」留一列空的，並且講得出下一步', async () => {
  await page.locator('#makeClearBtn').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.frow').count(), 1);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('左邊'), svgText);
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(400);
});

await t('整張圖共用的設定（軸名）改得動', async () => {
  await page.goto(server.url + '#/make/quadrant', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#m_quadrant_xLabel').fill('急迫程度');
  await page.waitForTimeout(500);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('急迫程度'), svgText.slice(0, 200));
});

await t('沒有共用設定的那幾種，那一塊就不出現', async () => {
  await page.goto(server.url + '#/make/flow', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#makeMetaWrap').isVisible(), false);
});

await t('自己做的圖一樣能換配色、換字體', async () => {
  await page.locator('#paletteSel').selectOption('gongwu');
  await page.waitForTimeout(400);
  const fill = await page.evaluate(() =>
    document.querySelector('#stage svg rect').getAttribute('fill'));
  assert.equal(String(fill).toLowerCase(), '#f3f1e9');
  await page.locator('#fontSel').selectOption('kai');
  await page.waitForTimeout(400);
  const fam = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#stage svg text')).fontFamily);
  assert.ok(/DFKai-SB|BiauKai|Kaiti|標楷體/.test(fam), fam);
  await page.locator('#fontSel').selectOption('source');
  await page.locator('#paletteSel').selectOption('source');
  await page.waitForTimeout(300);
});

await t('自己做的圖下載得出來，而且一樣帶著來源標註', async () => {
  await page.locator('#edTitleIn').fill('本府案件審查流程');
  await page.waitForTimeout(400);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#dlSvg').click()
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(text.includes('本府案件審查流程'));
  assert.ok(text.includes('收到來文'));
  assert.ok(text.includes('cathrynlavery/diagram-design'));
});

await t('每一格都有自己的標籤（不是靠位置猜的）', async () => {
  const n = await page.locator('.frow .fcell').evaluateAll((cells) =>
    cells.filter((c) => {
      const label = c.querySelector('label[for]');
      const input = c.querySelector('input, select');
      return !label || !input || label.getAttribute('for') !== input.id;
    }).length);
  assert.equal(n, 0, '有 ' + n + ' 格沒有對得上的標籤');
});

/* ── 不要讓使用者白做工：復原、留在瀏覽器裡、設定檔 ─────────────────── */

await t('刪錯一列可以復原，而且畫面上講得出可以復原', async () => {
  await page.goto(server.url + '#/make/gantt', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  const before = await page.locator('.frow').count();
  const name = await page.locator('#f_gantt_2_name').inputValue();
  await page.locator('.frow').nth(2).locator('button[aria-label^="刪除"]').click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.frow').count(), before - 1);
  assert.equal(await page.locator('#makeTip').isVisible(), true, '沒有告訴使用者可以復原');
  assert.ok((await page.locator('#makeTip').innerText()).includes('復原'));
  await page.locator('#makeUndoBtn').click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.frow').count(), before, '復原沒有把那一列救回來');
  assert.equal(await page.locator('#f_gantt_2_name').inputValue(), name);
});

await t('沒有東西可以復原時，復原鈕是停用的', async () => {
  await page.goto(server.url + '#/make/timeline', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#makeUndoBtn').isDisabled(), true);
  await page.locator('#makeClearBtn').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#makeUndoBtn').isDisabled(), false);
  await page.locator('#makeUndoBtn').click();
  await page.waitForTimeout(300);
});

await t('填的內容留在這台電腦裡，重新整理還在（純本機，不上傳）', async () => {
  await page.goto(server.url + '#/make/layers', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#f_layers_0_name').fill('民眾臨櫃');
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#f_layers_0_name').inputValue(), '民眾臨櫃',
    '重新整理之後填的東西不見了');
  /* 存的是本機 localStorage，不是傳出去 */
  const keys = await page.evaluate(() => Object.keys(window.localStorage));
  assert.ok(keys.some((k) => k.indexOf('gongwu-diagram') === 0), keys.join('／'));
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(600);
});

await t('從 Excel 貼一整塊：一行一列、一個 Tab 一欄', async () => {
  await page.goto(server.url + '#/make/gantt', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#makeCard details.paste summary').click();
  await page.locator('#makePasteBox').fill('需求訪談\t114/3/1\t114/3/20\n系統開發\t114/4/1\t114/6/30');
  await page.locator('#makePasteBtn').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.frow').count(), 2, '沒有取代成兩列');
  assert.equal(await page.locator('#f_gantt_0_name').inputValue(), '需求訪談');
  assert.equal(await page.locator('#f_gantt_1_start').inputValue(), '114/4/1');
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('系統開發'), svgText.slice(0, 200));
  assert.equal(await page.locator('#makePasteBox').inputValue(), '', '填完要清空，不然會重複貼');
});

await t('貼上時可以選「接在後面」', async () => {
  await page.locator('#makePasteBox').fill('結案報告\t114/7/1\t114/7/10');
  await page.locator('#makePasteAddBtn').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.frow').count(), 3);
  assert.equal(await page.locator('#f_gantt_2_name').inputValue(), '結案報告');
});

await t('貼上空白內容時，錯誤訊息是看得見的', async () => {
  await page.locator('#makePasteBox').fill('   ');
  await page.locator('#makePasteBtn').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#makePasteErr').isVisible(), true);
  assert.ok((await page.locator('#makePasteErr').innerText()).includes('Excel'));
});

await t('產生器的設定檔：存得出來、載得回去', async () => {
  await page.goto(server.url + '#/make/quadrant', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#f_quadrant_0_name').fill('線上申辦二期');
  await page.locator('#m_quadrant_xLabel').fill('投入人力');
  await page.waitForTimeout(500);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#makeSaveBtn').click()
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  const json = JSON.parse(text);
  assert.equal(json.format, 'gongwu-diagram');
  assert.equal(json.kind, 'generator');
  assert.equal(json.type, 'quadrant');
  assert.equal(json.rows[0].name, '線上申辦二期');
  assert.equal(json.meta.xLabel, '投入人力');
  assert.ok(!text.includes('<svg'), '設定檔不該包含圖檔');
  const projPath = '/tmp/dd-gen-proj.json';
  fs.writeFileSync(projPath, text);

  /* 改掉再載回來，要回到存檔當下的樣子 */
  await page.locator('#f_quadrant_0_name').fill('被改掉了');
  await page.waitForTimeout(400);
  await page.locator('#makeLoadInput').setInputFiles(projPath);
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#f_quadrant_0_name').inputValue(), '線上申辦二期');
  assert.equal(await page.locator('#m_quadrant_xLabel').inputValue(), '投入人力');
});

await t('載入到別種圖的設定檔會自己跳過去那一種', async () => {
  await page.goto(server.url + '#/make/layers', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#makeLoadInput').setInputFiles('/tmp/dd-gen-proj.json');
  await page.waitForTimeout(900);
  assert.equal(new URL(page.url()).hash, '#/make/quadrant');
});

await t('載入壞掉的設定檔時，錯誤訊息看得見而且講人話', async () => {
  const bad = '/tmp/dd-gen-bad.json';
  fs.writeFileSync(bad, '{ this is not json');
  await page.locator('#makeLoadInput').setInputFiles(bad);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#makeErr').isVisible(), true);
  const msg = await page.locator('#makeErr').innerText();
  assert.ok(msg.includes('設定檔'), msg);
  assert.ok(!/JSON\.parse|Unexpected/.test(msg), '錯誤訊息不是人話：' + msg);
});

/* ── Word：圖要能在 Word 裡再編輯 ─────────────────────────────────── */

await t('下載 Word 檔：整張圖是 Word 圖案，圖上的字一段都不能少', async () => {
  await page.goto(server.url + '#/make/org', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#edTitleIn').fill('Org 2026');
  await page.waitForTimeout(400);
  /* 圖上有幾段字，Word 檔裡就要有幾個文字方塊——Word 自己的「轉換成圖形」
     就是在這一步把字整批弄丟的（實測 2019：32 段字全沒了） */
  const words = await page.evaluate(() =>
    [...document.querySelectorAll('#stage svg text')].map((n) => n.textContent).filter(Boolean));
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('#dlDocx').click()
  ]);
  assert.equal(download.suggestedFilename(), 'Org 2026.docx');
  const buf = fs.readFileSync(await download.path());
  assert.equal(buf[0], 0x50, '不是 zip');
  assert.equal(buf[1], 0x4b, '不是 zip');
  const utf = buf.toString('utf8');
  assert.ok(utf.includes('<wpg:wgp>'), '圖沒有變成 Word 圖案群組');
  assert.ok(words.length > 3, '這張圖上本來就沒幾個字，測不到東西');
  /* 下載的那份還多了標題與來源標註，所以是「不少於」；重點是一段都不能掉 */
  assert.ok((utf.match(/<wps:txbx>/g) || []).length >= words.length,
    '文字方塊比圖上的字還少，掉字了');
  words.forEach((w) => assert.ok(utf.includes(w), '.docx 裡少了「' + w + '」'));
  assert.ok(!buf.toString('latin1').includes('word/media/'), '已經是圖案了還塞圖片進去');
  assert.ok((await page.locator('#edOk').innerText()).includes('不必再按'),
    '沒有告訴使用者這張圖打開就能改');
});

/* ── 版面：預覽要跟著看得到，手機上一列要是一張卡 ─────────────────── */

await t('捲動表單時預覽還黏在畫面上（改一格馬上看到才有意義）', async () => {
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 390, height: 780 });
  await p2.goto(server.url + '#/make/gantt', { waitUntil: 'networkidle' });
  await p2.locator('#stage svg').waitFor({ timeout: 5000 });
  await p2.evaluate(() => window.scrollTo(0, 1400));
  await p2.waitForTimeout(300);
  const box = await p2.locator('#stageCard').boundingBox();
  const vh = await p2.evaluate(() => window.innerHeight);
  assert.ok(box && box.y < vh * 0.4, '捲下去之後預覽跑掉了：y=' + (box && box.y));
  /* 預覽在表單「上面」，不然它永遠在畫面外。
     捲動之後不能用視窗座標比（黏住的那一塊 top 會是 50，表單則是負的），
     要回到頁頂用文件座標量。 */
  await p2.evaluate(() => window.scrollTo(0, 0));
  await p2.waitForTimeout(200);
  const order = await p2.evaluate(() => {
    const y = (s) => document.querySelector(s).getBoundingClientRect().top + window.scrollY;
    return y('#stageCard') < y('.col-a');
  });
  assert.ok(order, '窄螢幕的預覽沒有排在表單上面');
  await p2.close();
});

await t('手機寬度：一列是一張卡，不是七個欄位各佔一行', async () => {
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 390, height: 780 });
  await p2.goto(server.url + '#/make/gantt', { waitUntil: 'networkidle' });
  await p2.locator('#stage svg').waitFor({ timeout: 5000 });
  /* 甘特圖一列有五個欄位。各佔一行的話是 5×70＋ ≈ 380px 以上；
     排成卡片（文字獨佔一行、其餘兩兩並排）大約 300px。門檻抓在中間。 */
  const h = await p2.locator('.frow').first().evaluate((n) => n.getBoundingClientRect().height);
  assert.ok(h < 340, '一列在手機上高達 ' + Math.round(h) + 'px，等於每個欄位各佔一行');
  /* 起日與迄日要並排，不要上下堆 */
  const sameRow = await p2.evaluate(() => {
    const a = document.getElementById('f_gantt_0_start').getBoundingClientRect();
    const b = document.getElementById('f_gantt_0_end').getBoundingClientRect();
    return Math.abs(a.top - b.top) < 4;
  });
  assert.ok(sameRow, '起日與迄日沒有並排');
  await p2.close();
});

await t('寬螢幕：表單在左、預覽在右，而且預覽會黏著', async () => {
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 1400, height: 900 });
  await p2.goto(server.url + '#/make/flow', { waitUntil: 'networkidle' });
  await p2.locator('#stage svg').waitFor({ timeout: 5000 });
  const side = await p2.evaluate(() => {
    const a = document.querySelector('.col-a').getBoundingClientRect();
    const b = document.getElementById('stageCard').getBoundingClientRect();
    return b.left > a.right - 4;
  });
  assert.ok(side, '寬螢幕沒有排成左右兩欄');
  await p2.evaluate(() => window.scrollTo(0, 1200));
  await p2.waitForTimeout(300);
  const box = await p2.locator('#stageCard').boundingBox();
  assert.ok(box && box.y >= 0 && box.y < 200, '預覽沒有黏住：y=' + (box && box.y));
  await p2.close();
});

await t('勾選欄位講得出勾了會怎樣', async () => {
  await page.goto(server.url + '#/make/gantt', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  const hint = await page.locator('#f_gantt_0_milestone').getAttribute('title');
  assert.ok(hint && hint.length > 4, '查核點沒有說明：' + hint);
});

await t('從產生器回首頁，表單卡就收起來', async () => {
  await page.goto(server.url, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#makeCard').isVisible(), false);
  await page.goto(server.url + '#/example-flowchart', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#makeCard').isVisible(), false);
  assert.equal(await page.locator('#textCard').isVisible(), true, '範本模式要看得到文字清單');
  assert.equal(await page.locator('#projBox').isVisible(), true, '範本模式要看得到設定檔');
});

/* ── 家系圖：社工用的 genogram ─────────────────────────────────────── */

await t('家系圖打得開，一列可以是成員／伴侶關係／情感關係', async () => {
  await page.goto(server.url + '#/make/genogram', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.ok((await page.locator('#makeTitle').innerText()).includes('家系圖'));
  const kinds = await page.locator('#f_genogram_0_kind option').allInnerTexts();
  assert.deepEqual(kinds, ['成員', '伴侶關係', '情感關係']);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  ['祖父', '姑姑', '分居 85'].forEach((w) =>
    assert.ok(svgText.includes(w), '範例的圖上少了「' + w + '」：' + svgText.slice(0, 120)));
});

await t('家系圖：型別換成「伴侶關係」時，欄位跟著換一整組', async () => {
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(400);
  /* 第 1 列是成員 */
  assert.equal(await page.locator('#f_genogram_0_sex').count(), 1);
  assert.equal(await page.locator('#f_genogram_0_union').count(), 0);
  /* 第 8 列是伴侶關係 */
  assert.equal(await page.locator('#f_genogram_7_kind').inputValue(), 'union');
  assert.equal(await page.locator('#f_genogram_7_union').count(), 1);
  assert.equal(await page.locator('#f_genogram_7_sex').count(), 0);
  /* 第 10 列是情感關係 */
  assert.equal(await page.locator('#f_genogram_9_kind').inputValue(), 'bond');
  assert.equal(await page.locator('#f_genogram_9_bond').count(), 1);
});

await t('家系圖：「父親」的下拉只列前面已經填過的成員', async () => {
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(400);
  const opts = await page.locator('#f_genogram_5_father option').allInnerTexts();
  assert.ok(opts.includes('父'), opts.join('／'));
  assert.ok(!opts.includes('弟'), '後面才填的成員不該出現在父親欄：' + opts.join('／'));
});

await t('家系圖：改一個人的名字，圖上跟著改', async () => {
  await page.locator('#f_genogram_5_name').fill('小美');
  await page.waitForTimeout(500);
  const svgText = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(svgText.includes('小美'), svgText.slice(0, 150));
});

await t('家系圖：勾「已歿」圖上就打叉，勾「案主」就變雙框', async () => {
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(400);
  const glyphs = () => page.evaluate(() => {
    const svg = document.querySelector('#stage svg').outerHTML;
    const body = svg.slice(0, svg.indexOf('>圖例<'));
    return { lines: (body.match(/<line/g) || []).length,
      accent: (body.match(/stroke="#eb6c36"/g) || []).length };
  });
  const before = await glyphs();
  await page.locator('#f_genogram_1_dead').check();
  await page.waitForTimeout(500);
  const after = await glyphs();
  assert.ok(after.lines >= before.lines + 2, '勾了已歿卻沒有打叉');
  await page.locator('#f_genogram_1_dead').uncheck();
  await page.locator('#f_genogram_1_index').check();
  await page.waitForTimeout(500);
  const idx = await glyphs();
  assert.ok(idx.accent > before.accent, '勾了案主卻沒有用強調色畫雙框');
  await page.locator('#f_genogram_1_index').uncheck();
  await page.waitForTimeout(300);
});

await t('家系圖：父母指到後面的人時，錯誤訊息看得見而且說得出是誰', async () => {
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(400);
  /* 把第 1 列（祖父）的父親改成後面才出現的人 */
  await page.evaluate(() => {
    const st = window.DDForms._state();
    st.rows[0].father = '案主';
  });
  await page.locator('#f_genogram_0_name').fill('祖父 ');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#makeErr').isVisible(), true, '錯誤訊息沒有顯示出來');
  const msg = await page.locator('#makeErr').innerText();
  assert.ok(msg.includes('祖父'), msg);
  assert.ok(msg.includes('不在它前面'), msg);
});

await t('家系圖沒有現成範本，就不要留一個死連結', async () => {
  await page.goto(server.url + '#/make/genogram', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#makeSampleWrap').isVisible(), false);
  await page.goto(server.url + '#/make/gantt', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#makeSampleWrap').isVisible(), true, '甘特圖有範本，連結該在');
});

await t('家系圖也下載得出來，而且一樣帶著來源標註', async () => {
  await page.goto(server.url + '#/make/genogram', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#edTitleIn').fill('Case 2026');
  await page.waitForTimeout(400);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#dlSvg').click()
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(text.includes('Case 2026'));
  assert.ok(text.includes('姑姑'));
  assert.ok(text.includes('cathrynlavery/diagram-design'));
});

/* ── 自由畫板：拖形狀、連線、改大小顏色 ─────────────────────────────── */

/** SVG 是等比縮放的：x 與 y 都要用「寬度的比例」換算，用高度會整個歪掉。 */
async function boardXY(p, x, y) {
  return p.evaluate(([x, y]) => {
    const r = document.querySelector('#bdStage svg').getBoundingClientRect();
    const k = r.width / 1000;
    return { x: r.left + x * k, y: r.top + y * k };
  }, [x, y]);
}
const bdShapes = (p) => p.evaluate(() => window.DDCanvas._board().shapes);
const bdLinks = (p) => p.evaluate(() => window.DDCanvas._board().links);
async function bdDrag(p, fx, fy, tx, ty) {
  const a = await boardXY(p, fx, fy), b = await boardXY(p, tx, ty);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(b.x, b.y, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(250);
}
async function bdClick(p, x, y) {
  const c = await boardXY(p, x, y);
  await p.mouse.click(c.x, c.y);
  await p.waitForTimeout(220);
}
const bdMid = (s) => [s.x + s.w / 2, s.y + s.h / 2];
const bdTool = (p, name) => p.locator('#bdTools button', { hasText: name });

await t('畫板是從流程圖裡進去的，首頁沒有它自己的入口（它只是自己畫流程圖）', async () => {
  await page.goto(server.url, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('a[href="#/board"]').count(), 0,
    '首頁不該有畫板的獨立入口');
  await page.goto(server.url + '#/make/flow', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#toBoardWrap').isVisible(), true);
  assert.equal(await page.locator('#blankBoardBtn').isVisible(), true, '缺了「開空白畫板」');
  await page.locator('#blankBoardBtn').click();
  await page.waitForTimeout(600);
  assert.equal(new URL(page.url()).hash, '#/board');
  /* 麵包屑要看得出這是流程圖底下的一種畫法 */
  assert.ok((await page.locator('#edKind').innerText()).includes('流程圖'),
    await page.locator('#edKind').innerText());
  /* 而且要有一條回填表的路 */
  assert.ok(await page.locator('#bdCard a[href="#/make/flow"]').count() >= 1,
    '畫板裡沒有回填表畫面的路');
});

await t('畫板打得開，工具列是照 board.js 的規格長出來的', async () => {
  await page.goto(server.url + '#/board', { waitUntil: 'networkidle' });
  await page.locator('#bdStage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#bdCard').isVisible(), true);
  const names = await page.evaluate(() => window.DDBoard.KINDS.map((k) => k.name));
  assert.equal(await page.locator('#bdTools button').count(), names.length);
  const shown = await page.locator('#bdTools button').allInnerTexts();
  names.forEach((n) => assert.ok(shown.some((s) => s.includes(n)), '工具列少了「' + n + '」'));
  /* 空畫板要講得出下一步 */
  const svgText = await page.evaluate(() => document.querySelector('#bdStage svg').textContent);
  assert.ok(svgText.includes('挑一個形狀'), svgText.slice(0, 80));
});

await t('加形狀：連按會往下排，不會疊在一起（疊著就會拖到別的）', async () => {
  for (const [kind, text] of [['起訖', '收件'], ['步驟', '初審'], ['判斷', '資料齊全？']]) {
    await bdTool(page, kind).click();
    await page.locator('#bdText').fill(text);
    await page.waitForTimeout(200);
  }
  const S = await bdShapes(page);
  assert.equal(S.length, 3);
  assert.deepEqual(S.map((s) => s.text), ['收件', '初審', '資料齊全？']);
  assert.deepEqual(S.map((s) => s.kind), ['start', 'step', 'decision']);
  for (let i = 1; i < S.length; i++) {
    assert.ok(S[i].y >= S[i - 1].y + S[i - 1].h, '第 ' + (i + 1) + ' 個疊到前一個上面了');
  }
});

await t('拖一個形狀，它就到新的位置（而且對到格線）', async () => {
  const S = await bdShapes(page);
  const target = S[2];
  await bdDrag(page, ...bdMid(target), 760, 300);
  const after = (await bdShapes(page))[2];
  assert.notEqual(after.x, target.x, '拖了沒動');
  assert.equal(after.x % 10, 0, '沒有對到格線：' + after.x);
  assert.equal(after.y % 10, 0, '沒有對到格線：' + after.y);
});

await t('連線：點「連線」再點兩個形狀就接起來', async () => {
  const S = await bdShapes(page);
  await page.locator('#bdLinkBtn').click();
  assert.equal(await page.locator('#bdLinkBtn').getAttribute('aria-pressed'), 'true');
  await bdClick(page, ...bdMid(S[0]));
  assert.ok((await page.locator('#bdTip').innerText()).includes('要連到'), '沒有提示下一步');
  await bdClick(page, ...bdMid(S[1]));
  const L = await bdLinks(page);
  assert.equal(L.length, 1);
  assert.equal(L[0].from, S[0].id);
  assert.equal(L[0].to, S[1].id);
  assert.equal(await page.locator('#bdLinkBtn').getAttribute('aria-pressed'), 'false', '連完要退出連線模式');
});

await t('**拖動形狀時，線跟著跑**（這是畫板存在的前提）', async () => {
  const S = await bdShapes(page);
  const linkEnd = () => page.evaluate(() => {
    const d = document.querySelector('#bdStage svg path[marker-end]').getAttribute('d');
    return d.split(' L ').pop();
  });
  const before = await linkEnd();
  await bdDrag(page, ...bdMid(S[1]), 200, 480);
  const after = await linkEnd();
  assert.notEqual(before, after, '方塊移動了，線卻停在原地');
  /* 線的終點要落在移動後那個方塊上 */
  const moved = (await bdShapes(page))[1];
  const [ex, ey] = after.split(' ').map(Number);
  assert.ok(ex >= moved.x - 2 && ex <= moved.x + moved.w + 2, '線沒接到移動後的方塊：' + after);
  assert.ok(ey >= moved.y - 2 && ey <= moved.y + moved.h + 2, '線沒接到移動後的方塊：' + after);
});

await t('拉角落的把手可以改大小，而且拉不成一條線', async () => {
  const S = await bdShapes(page);
  await page.evaluate((id) => window.DDCanvas._select(id), S[0].id);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#bdStage svg [data-handle]').count(), 8, '沒有八個把手');
  const s0 = S[0];
  await bdDrag(page, s0.x + s0.w, s0.y + s0.h, s0.x + s0.w + 80, s0.y + s0.h + 40);
  const after = (await bdShapes(page))[0];
  assert.ok(after.w > s0.w && after.h > s0.h, '拉了沒變大：' + after.w + 'x' + after.h);
  /* 往回拉到底也不能變成一條線 */
  await bdDrag(page, after.x + after.w, after.y + after.h, after.x, after.y);
  const tiny = (await bdShapes(page))[0];
  assert.ok(tiny.w >= 60 && tiny.h >= 28, '被拉成一條線了：' + tiny.w + 'x' + tiny.h);
});

await t('改文字、小字、形狀與顏色', async () => {
  const S = await bdShapes(page);
  await page.evaluate((id) => window.DDCanvas._select(id), S[1].id);
  await page.waitForTimeout(200);
  await page.locator('#bdText').fill('初審與分辦');
  await page.locator('#bdSub').fill('承辦人 3 日內');
  await page.locator('#bdColor').selectOption('accent');
  await page.locator('#bdKind').selectOption('note');
  await page.waitForTimeout(300);
  const after = (await bdShapes(page))[1];
  assert.equal(after.text, '初審與分辦');
  assert.equal(after.sub, '承辦人 3 日內');
  assert.equal(after.color, 'accent');
  assert.equal(after.kind, 'note');
  const svgText = await page.evaluate(() => document.querySelector('#bdStage svg').textContent);
  assert.ok(svgText.includes('初審與分辦') && svgText.includes('承辦人 3 日內'), svgText.slice(0, 120));
});

await t('線上可以標字、改虛線、刪掉', async () => {
  const S = await bdShapes(page);
  await page.evaluate((id) => window.DDCanvas._select(id), S[0].id);
  await page.waitForTimeout(250);
  const row = page.locator('#bdLinks .bdlink').first();
  assert.equal(await row.count(), 1, '沒有列出這個形狀身上的線');
  await row.locator('input').fill('收件完成');
  await page.waitForTimeout(300);
  assert.equal((await bdLinks(page))[0].label, '收件完成');
  await row.locator('button[aria-label*="虛線"]').click();
  await page.waitForTimeout(250);
  assert.equal((await bdLinks(page))[0].dash, true);
  await row.locator('button[aria-label="刪掉這條線"]').click();
  await page.waitForTimeout(250);
  assert.equal((await bdLinks(page)).length, 0);
});

await t('刪掉形狀時，連著它的線一起走（不然會留下飄在半空的箭頭）', async () => {
  await bdTool(page, '步驟').click();
  await page.locator('#bdText').fill('會被刪掉的');
  await page.waitForTimeout(200);
  let S = await bdShapes(page);
  await page.locator('#bdLinkBtn').click();
  await bdClick(page, ...bdMid(S[0]));
  await bdClick(page, ...bdMid(S[S.length - 1]));
  assert.equal((await bdLinks(page)).length, 1);
  S = await bdShapes(page);
  await page.evaluate((id) => window.DDCanvas._select(id), S[S.length - 1].id);
  await page.waitForTimeout(200);
  await page.locator('#bdDelBtn').click();
  await page.waitForTimeout(300);
  assert.equal((await bdLinks(page)).length, 0, '形狀刪了，線還留著');
});

await t('復原救得回刪掉的形狀', async () => {
  const before = (await bdShapes(page)).length;
  await page.evaluate(() => {
    const s = window.DDCanvas._board().shapes[0];
    window.DDCanvas._select(s.id);
  });
  await page.waitForTimeout(200);
  await page.locator('#bdDelBtn').click();
  await page.waitForTimeout(300);
  assert.equal((await bdShapes(page)).length, before - 1);
  assert.ok((await page.locator('#bdTip').innerText()).includes('復原'), '沒有告訴使用者可以復原');
  await page.locator('#bdUndoBtn').click();
  await page.waitForTimeout(300);
  assert.equal((await bdShapes(page)).length, before, '復原沒有救回來');
});

await t('鍵盤：方向鍵推一格、Delete 刪掉', async () => {
  const S = await bdShapes(page);
  await page.evaluate((id) => window.DDCanvas._select(id), S[0].id);
  await page.waitForTimeout(200);
  await page.locator('#bdStage').click({ position: { x: 5, y: 5 } });
  await page.evaluate((id) => window.DDCanvas._select(id), S[0].id);
  await page.waitForTimeout(150);
  const x0 = (await bdShapes(page))[0].x;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  assert.equal((await bdShapes(page))[0].x, x0 + 10, '方向鍵沒有推一格');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(250);
});

await t('畫的東西留在這台電腦裡，重新整理還在', async () => {
  const before = await bdShapes(page);
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#bdStage svg').waitFor({ timeout: 5000 });
  const after = await bdShapes(page);
  assert.equal(after.length, before.length, '重新整理之後畫的東西不見了');
  assert.equal(after[0].text, before[0].text);
});

await t('畫板的設定檔：存得出來、載得回去，而且座標不會被推歪', async () => {
  const before = await bdShapes(page);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#bdSaveBtn').click()
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  const json = JSON.parse(text);
  assert.equal(json.kind, 'board');
  assert.equal(json.shapes.length, before.length);
  const projPath = '/tmp/dd-board-proj.json';
  fs.writeFileSync(projPath, text);

  await page.locator('#bdClearBtn').click();
  await page.waitForTimeout(300);
  assert.equal((await bdShapes(page)).length, 0);
  await page.locator('#bdLoadInput').setInputFiles(projPath);
  await page.waitForTimeout(700);
  const after = await bdShapes(page);
  assert.equal(after.length, before.length);
  assert.deepEqual(after.map((s) => s.x + ',' + s.y), before.map((s) => s.x + ',' + s.y),
    '載回來之後座標被推歪了');
});

await t('載入填表用的設定檔時，講得出「這是另一種設定檔」', async () => {
  await page.locator('#bdLoadInput').setInputFiles('/tmp/dd-gen-proj.json');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#bdErr').isVisible(), true);
  const msg = await page.locator('#bdErr').innerText();
  assert.ok(msg.includes('填表'), msg);
});

await t('把填表的那張圖搬到畫板：每一格都在，而且拖得動', async () => {
  await page.goto(server.url + '#/make/flow', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  await page.locator('#makeExampleBtn').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#toBoardWrap').isVisible(), true, '流程圖應該看得到搬過去的按鈕');
  page.once('dialog', (d) => d.accept());
  await page.locator('#toBoardBtn').click();
  await page.waitForTimeout(900);
  assert.equal(new URL(page.url()).hash, '#/board');
  const S = await bdShapes(page);
  assert.equal(S.length, 10, '搬過去之後形狀數不對：' + S.length);
  const texts = S.map((s) => s.text);
  ['收到來文', '是否本科權責？', '移文他科', '發文並歸檔']
    .forEach((w) => assert.ok(texts.includes(w), '搬過去之後少了「' + w + '」'));
  assert.ok((await bdLinks(page)).length >= 8, '線太少');
  /* 真的拖得動 */
  const x0 = S[0].x;
  await bdDrag(page, ...bdMid(S[0]), 200, 60);
  assert.notEqual((await bdShapes(page))[0].x, x0, '搬過去之後拖不動');
});

await t('其他六種圖沒有「搬到畫板」那個按鈕（搬過去沒有意義）', async () => {
  await page.goto(server.url + '#/make/gantt', { waitUntil: 'networkidle' });
  await page.locator('#stage svg').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#toBoardWrap').isVisible(), false);
});

await t('畫板的圖下載得出來，而且一樣帶著來源標註', async () => {
  await page.goto(server.url + '#/board', { waitUntil: 'networkidle' });
  await page.locator('#bdStage svg').waitFor({ timeout: 5000 });
  await page.locator('#edTitleIn').fill('Board 2026');
  await page.waitForTimeout(400);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#dlSvg').click()
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(text.includes('Board 2026'));
  assert.ok(text.includes('cathrynlavery/diagram-design'));
  assert.ok(!text.includes('url(#ddb-grid)'), '匯出的圖不該有格線');
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
  assert.ok(msg.includes('照常可以用'), '要講清楚只有範本受影響');
  /* 做圖那七種完全不需要範本資料，資料掛了它們還是要能用 */
  assert.equal(await p2.locator('.make').count(), 8, '資料掛了就連做圖入口都不見了');
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
