/*
 * core.unit.mjs — 純函式測試。直接 require 站上那份 app/core.js，不做副本。
 * 副本會跟站上的碼悄悄走鐘，「測試全過但測的是舊碼」比沒測試更危險。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { scoreboard } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DD = require(path.join(ROOT, 'app', 'core.js'));

const s = scoreboard('core.unit');
const t = (name, fn) => s.t(name, fn);

/* ── 來源標註：這是授權要求，不能被人不小心改掉 ─────────────────────── */
await t('SOURCE 指向上游 repo', () => {
  assert.equal(DD.SOURCE.repo, 'cathrynlavery/diagram-design');
  assert.equal(DD.SOURCE.url, 'https://github.com/cathrynlavery/diagram-design');
  assert.equal(DD.SOURCE.license, 'MIT');
  assert.equal(DD.SOURCE.author, 'Cathryn Lavery');
});
await t('credit 這行字同時有 repo、授權與作者', () => {
  assert.match(DD.SOURCE.credit, /cathrynlavery\/diagram-design/);
  assert.match(DD.SOURCE.credit, /MIT/);
  assert.match(DD.SOURCE.credit, /Cathryn Lavery/);
});

/* ── escapeXml ───────────────────────────────────────────────────── */
await t('escapeXml 處理五個字元', () => {
  assert.equal(DD.escapeXml('<a & "b" \'c\'>'), '&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;');
});
await t('escapeXml 對 null／undefined 回空字串', () => {
  assert.equal(DD.escapeXml(null), '');
  assert.equal(DD.escapeXml(undefined), '');
});
await t('escapeXml 不會二次轉義成 &amp;lt;', () => {
  assert.equal(DD.escapeXml('&lt;'), '&amp;lt;');
});

/* ── 顏色 ────────────────────────────────────────────────────────── */
await t('normalizeHex 收三碼與大寫', () => {
  assert.equal(DD.normalizeHex('#ABC'), '#aabbcc');
  assert.equal(DD.normalizeHex('#EB6C36'), '#eb6c36');
});
await t('normalizeHex 對亂寫的回 null', () => {
  assert.equal(DD.normalizeHex('red'), null);
  assert.equal(DD.normalizeHex('#12345'), null);
  assert.equal(DD.normalizeHex(''), null);
  assert.equal(DD.normalizeHex(null), null);
});
await t('hexToRgb 算得對', () => {
  assert.deepEqual(DD.hexToRgb('#2d3142'), { r: 45, g: 49, b: 66 });
  assert.equal(DD.hexToRgb('nope'), null);
});
await t('recolor 換 hex（含大小寫）', () => {
  assert.equal(DD.recolor('fill="#EB6C36"', '#eb6c36', '#9d2b25'), 'fill="#9d2b25"');
});
await t('recolor 換 rgba 並保留透明度', () => {
  assert.equal(DD.recolor('stroke="rgba(45,49,66,0.10)"', '#2d3142', '#9d2b25'),
    'stroke="rgba(157,43,37,0.10)"');
});
await t('recolor 換 rgb() 時補上不透明', () => {
  assert.equal(DD.recolor('fill="rgb(45, 49, 66)"', '#2d3142', '#000000'), 'fill="rgba(0,0,0,1)"');
});
await t('recolor 也認三碼縮寫', () => {
  assert.equal(DD.recolor('fill="#fff"', '#ffffff', '#1a1a1a'), 'fill="#1a1a1a"');
});
await t('recolor 不會把 #ffffff00 這種八碼前綴誤切', () => {
  /* 縮寫比對有加 \b，八碼色不該被當成三碼命中 */
  const out = DD.recolor('fill="#ffff00"', '#ffffff', '#000000');
  assert.equal(out, 'fill="#ffff00"');
});
await t('recolor 遇到無效顏色時原樣回傳', () => {
  assert.equal(DD.recolor('fill="#abc"', 'red', '#000000'), 'fill="#abc"');
});
await t('applyPalette 對調兩個顏色不會連環相撞', () => {
  const from = { paper: '#ffffff', ink: '#000000', muted: '#888888', accent: '#ff0000' };
  const to = { paper: '#000000', ink: '#ffffff', muted: '#888888', accent: '#00ff00' };
  const out = DD.applyPalette('a=#ffffff b=#000000', from, to);
  assert.equal(out, 'a=#000000 b=#ffffff');
});
await t('applyPalette 少一邊時原樣回傳', () => {
  assert.equal(DD.applyPalette('x', null, {}), 'x');
  assert.equal(DD.applyPalette('x', {}, null), 'x');
});
await t('fixDarkBackdrop 只換鋪滿整張的那塊底色', () => {
  const svg = '<svg><rect width="100%" height="100%" fill="#f5f5f5"/>'
    + '<text fill="#f5f5f5">白字</text></svg>';
  const out = DD.fixDarkBackdrop(svg);
  assert.ok(out.includes('<rect width="100%" height="100%" fill="#2d3142"/>'));
  assert.ok(out.includes('<text fill="#f5f5f5">'), '文字色是 #f5f5f5，不能一起換掉');
});
await t('fixDarkBackdrop 對本來就正常的深色圖不動作', () => {
  const svg = '<svg><rect width="100%" height="100%" fill="#2d3142"/></svg>';
  assert.equal(DD.fixDarkBackdrop(svg), svg);
});
await t('paletteById 找不到就給原版', () => {
  assert.equal(DD.paletteById('nope').id, 'source');
  assert.equal(DD.paletteById('gongwu').id, 'gongwu');
});
await t('每一組色票的四個顏色都是合法的 hex', () => {
  DD.PALETTES.forEach((p) => {
    ['light', 'dark'].forEach((k) => {
      if (!p[k]) return;
      ['paper', 'ink', 'muted', 'accent'].forEach((c) => {
        assert.ok(DD.normalizeHex(p[k][c]), `${p.id}.${k}.${c} = ${p[k][c]}`);
      });
    });
  });
});
await t('resolveColors：選原版時沿用上游色', () => {
  const r = DD.resolveColors('source', false);
  assert.equal(r.to, null);
  assert.deepEqual(r.colors, DD.UPSTREAM_LIGHT);
});
await t('resolveColors：深色圖要用深色那組來源色', () => {
  const r = DD.resolveColors('gongwu', true);
  assert.deepEqual(r.from, DD.UPSTREAM_DARK);
  assert.equal(r.colors.paper, '#1d2a30');
});

/* ── 抽取 ────────────────────────────────────────────────────────── */
const SAMPLE = `<!doctype html><html><head><title>Sample title</title>
<link href="https://fonts.googleapis.com/css2?family=Geist" rel="stylesheet">
<style>*{margin:0}
body{background:#f5f5f5}
:root{--color-ink:#2d3142;--font-sans:'Geist',system-ui,sans-serif}
.node{fill:var(--color-ink)}
.frame{max-width:1200px}
</style></head><body><div class="frame">
<p class="eyebrow">Flowchart · Diagram Design</p><h1>Should you <em>write</em> this?</h1>
<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"><desc>A desc</desc>
<!-- a comment -->
<text class="node" font-family="'Geist', sans-serif">Hi</text>
<svg viewBox="0 0 10 10"><circle r="1"/></svg>
</svg></div></body></html>`;

await t('extractSvg 抓到最外層那一個，不會在內層圖示就收尾', () => {
  const svg = DD.extractSvg(SAMPLE);
  assert.ok(svg.startsWith('<svg viewBox="0 0 100 50"'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes('<circle r="1"/>'), '內層的巢狀 svg 要留著');
});
await t('extractSvg 沒有 svg 時回空字串', () => {
  assert.equal(DD.extractSvg('<p>nope</p>'), '');
  assert.equal(DD.extractSvg(''), '');
});
await t('extractDocument 抓 title／eyebrow／heading／desc', () => {
  const d = DD.extractDocument(SAMPLE);
  assert.equal(d.title, 'Sample title');
  assert.equal(d.eyebrow, 'Flowchart · Diagram Design');
  assert.equal(d.heading, 'Should you write this?');
  assert.equal(d.desc, 'A desc');
  assert.ok(d.css.includes('.node'));
});
await t('extractDocument 對沒有這些標籤的輸入不會爆', () => {
  const d = DD.extractDocument('<svg viewBox="0 0 1 1"></svg>');
  assert.equal(d.title, '');
  assert.equal(d.eyebrow, '');
  assert.ok(d.svg.length > 0);
});
await t('stripComments 拿掉註解', () => {
  assert.equal(DD.stripComments('a<!-- x -->b'), 'ab');
  assert.equal(DD.stripComments('a<!--\nmulti\n-->b'), 'ab');
});

/* ── 圖上的文字：切段與中文層 ────────────────────────────────────── */
const SEGSVG = '<svg viewBox="0 0 10 10">'
  + '<defs><text>藏起來的</text></defs>'
  + '<marker><text>箭頭裡的</text></marker>'
  + '<text>單獨一段</text>'
  + '<text><tspan>第一行</tspan><tspan>第二行</tspan></text>'
  + '<text>  多餘   空白  </text>'
  + '<text></text>'
  + '</svg>';

await t('extractTextSegments 不收 defs／marker 裡的文字（那些畫不出來）', () => {
  const segs = DD.extractTextSegments(SEGSVG).map((x) => x.text);
  assert.ok(!segs.includes('藏起來的'));
  assert.ok(!segs.includes('箭頭裡的'));
});
await t('extractTextSegments 有 tspan 就一個 tspan 一段', () => {
  const segs = DD.extractTextSegments(SEGSVG).map((x) => x.text);
  assert.deepEqual(segs, ['單獨一段', '第一行', '第二行', '多餘 空白', '']);
});
await t('extractTextSegments 留著空白段（序號要對得上）', () => {
  assert.equal(DD.extractTextSegments(SEGSVG).length, 5);
});
await t('extractTextSegments 標出哪些可以換行（整個 text 才可以，tspan 不行）', () => {
  const segs = DD.extractTextSegments(SEGSVG);
  assert.equal(segs[0].multiline, true);
  assert.equal(segs[1].multiline, false);
  assert.equal(segs[2].multiline, false);
});
await t('extractTextSegments 把實體字元還原', () => {
  const segs = DD.extractTextSegments('<svg><text>a &amp; b &lt;c&gt;</text></svg>');
  assert.equal(segs[0].text, 'a & b <c>');
});
await t('extractTextSegments 對沒有文字的圖回空陣列', () => {
  assert.deepEqual(DD.extractTextSegments('<svg><rect/></svg>'), []);
});
await t('extractTextSegments 只收最內層的 tspan，不重複收外層', () => {
  const segs = DD.extractTextSegments('<svg><text><tspan><tspan>裡</tspan></tspan></text></svg>');
  assert.deepEqual(segs.map((x) => x.text), ['裡']);
});

await t('glossaryLookup 不分大小寫、前後空白不算', () => {
  assert.equal(DD.glossaryLookup('LEGEND'), '圖例');
  assert.equal(DD.glossaryLookup('  legend  '), '圖例');
  assert.equal(DD.glossaryLookup('Yes'), '是');
});
await t('glossaryLookup 查不到就回 null（留原文，不亂猜）', () => {
  assert.equal(DD.glossaryLookup('Sprint velocity'), null);
  assert.equal(DD.glossaryLookup(''), null);
  assert.equal(DD.glossaryLookup(null), null);
});
await t('骨架字典不收會被使用者整段換掉的內容字', () => {
  ['sprint velocity', 'kubernetes', 'oauth', 'athena', 'shopify']
    .forEach((k) => assert.equal(DD.glossaryLookup(k), null, k));
});
await t('骨架字典的值都是中文，不會有人漏填成英文', () => {
  Object.keys(DD.GLOSSARY).forEach((k) => {
    const v = DD.GLOSSARY[k];
    assert.ok(v && v.length > 0, k);
    assert.ok(/[\u4e00-\u9fff]/.test(v), `${k} 的中文是「${v}」`);
  });
});

await t('translateSegments 長度一定跟原文一樣（序號要對得上）', () => {
  const segs = DD.extractTextSegments(SEGSVG);
  assert.equal(DD.translateSegments(segs, null).length, segs.length);
  assert.equal(DD.translateSegments(segs, ['只寫一筆']).length, segs.length);
});
await t('translateSegments：人工範例優先於骨架字典', () => {
  const segs = [{ text: 'LEGEND' }];
  assert.deepEqual(DD.translateSegments(segs, ['自己寫的']), ['自己寫的']);
  assert.deepEqual(DD.translateSegments(segs, null), ['圖例']);
});
await t('translateSegments：範例留空字串時退回骨架字典', () => {
  assert.deepEqual(DD.translateSegments([{ text: 'YES' }], ['']), ['是']);
});
await t('translateSegments：兩邊都沒有就回 null（留原文）', () => {
  assert.deepEqual(DD.translateSegments([{ text: 'Sprint velocity' }], null), [null]);
});
await t('hasTranslation 認得出「一筆中文都沒有」', () => {
  assert.equal(DD.hasTranslation(null), false);
  assert.equal(DD.hasTranslation([null, null]), false);
  assert.equal(DD.hasTranslation([null, '', null]), false);
  assert.equal(DD.hasTranslation([null, '圖例']), true);
});

/* ── 字型 ────────────────────────────────────────────────────────── */
await t('mapFontValue 分得出 mono／serif／sans', () => {
  assert.equal(DD.mapFontValue("'Geist Mono', monospace"), DD.FONTS.mono);
  assert.equal(DD.mapFontValue("'Instrument Serif', serif"), DD.FONTS.serif);
  assert.equal(DD.mapFontValue("'Geist', system-ui, sans-serif"), DD.FONTS.sans);
});
await t('sans-serif 不會被誤判成 serif', () => {
  assert.equal(DD.mapFontValue('system-ui, sans-serif'), DD.FONTS.sans);
});
await t('mono 優先於 serif（Geist Mono 不是襯線體）', () => {
  assert.equal(DD.mapFontValue("'Some Serif Mono', monospace"), DD.FONTS.mono);
});
await t('mapFonts 換掉 SVG 屬性裡的字型', () => {
  const out = DD.mapFonts(`<text font-family="'Geist', sans-serif">x</text>`);
  assert.ok(out.includes('Noto Sans TC'));
  assert.ok(!out.includes('Geist'));
});
await t('mapFonts 換掉 CSS 自訂屬性裡的字型（--sans／--font-sans 都要）', () => {
  assert.ok(!DD.mapFonts("--sans: 'Geist', system-ui, sans-serif;").includes('Geist'));
  assert.ok(!DD.mapFonts("--font-mono:'Geist Mono',monospace;").includes('Geist'));
  assert.ok(!DD.mapFonts("--serif: 'Instrument Serif', serif;").includes('Instrument'));
});
await t('mapFonts 換掉 CSS 的 font-family 宣告', () => {
  assert.ok(!DD.mapFonts('.x{font-family: \'Geist\', sans-serif;}').includes('Geist'));
});
await t('字族堆疊只用單引號（SVG 屬性是雙引號包的，用雙引號會炸掉）', () => {
  Object.values(DD.FONTS).forEach((v) => assert.ok(!v.includes('"'), v));
});
await t('字族堆疊都留了通用字族當退路', () => {
  assert.match(DD.FONTS.sans, /sans-serif$/);
  assert.match(DD.FONTS.serif, /serif$/);
  assert.match(DD.FONTS.mono, /monospace$/);
});

/* ── 整張圖換字體 ────────────────────────────────────────────────── */
await t('forceFontFamily 把屬性、CSS 宣告與自訂屬性一起換掉', () => {
  const svg = '<svg><style>.a{font-family: x;} :root{--sans: y;}</style>'
    + '<text font-family="z">字</text></svg>';
  const out = DD.forceFontFamily(svg, "'標楷體',serif");
  assert.equal((out.match(/標楷體/g) || []).length, 3, out);
});
await t('forceFontFamily 給 null 就不動（維持範本原本的搭配）', () => {
  const svg = '<text font-family="z">字</text>';
  assert.equal(DD.forceFontFamily(svg, null), svg);
});
await t('字體選項都只寫字族名，沒有 webfont', () => {
  DD.FONT_CHOICES.forEach((c) => {
    if (!c.stack) return;
    assert.ok(!c.stack.includes('"'), c.id + ' 用了雙引號，SVG 屬性會炸掉');
    assert.ok(!/url\(|http/.test(c.stack), c.id);
  });
});
await t('標楷體那組留了襯線體當退路（沒裝標楷體的機器也看得到字）', () => {
  assert.match(DD.fontChoiceById('kai').stack, /serif$/);
});
await t('fontChoiceById 找不到就給原版', () => {
  assert.equal(DD.fontChoiceById('nope').id, 'source');
  assert.equal(DD.fontChoiceById('kai').id, 'kai');
});

/* ── 從 Excel 貼一整欄 ──────────────────────────────────────────── */
await t('splitPastedColumn 一行一段，空行丟掉', () => {
  assert.deepEqual(DD.splitPastedColumn('人事室\n\n主計室\n政風室\n'),
    ['人事室', '主計室', '政風室']);
});
await t('splitPastedColumn 一行多欄併成一段，不拆成兩段（拆了後面全錯位）', () => {
  assert.deepEqual(DD.splitPastedColumn('甲\t乙\n丙\t丁'), ['甲 · 乙', '丙 · 丁']);
});
await t('splitPastedColumn 吃得下 Windows 換行與前後空白', () => {
  assert.deepEqual(DD.splitPastedColumn('  甲  \r\n 乙 '), ['甲', '乙']);
});
await t('splitPastedColumn 空白輸入回空陣列', () => {
  assert.deepEqual(DD.splitPastedColumn(''), []);
  assert.deepEqual(DD.splitPastedColumn('   \n  '), []);
  assert.deepEqual(DD.splitPastedColumn(null), []);
});

/* ── 設定檔 ─────────────────────────────────────────────────────── */
await t('設定檔存的是「改了什麼」，不是整張圖', () => {
  const json = JSON.parse(DD.buildProjectFile({ id: 'example-flowchart', edits: { 0: '甲' } }));
  assert.equal(json.format, 'gongwu-diagram');
  assert.equal(json.diagram, 'example-flowchart');
  assert.deepEqual(json.edits, { 0: '甲' });
  assert.ok(!JSON.stringify(json).includes('<svg'), '不該把圖檔存進去');
  assert.ok(json.source.includes('cathrynlavery'), '設定檔也帶著來源標註');
});
await t('設定檔存得回、讀得回，內容一致', () => {
  const o = {
    id: 'example-gantt', palette: 'gongwu', font: 'kai', fit: false, zhOn: true,
    eyebrow: '甘特圖', heading: '期程', edits: { 3: '需求盤點' }
  };
  const back = DD.parseProjectFile(DD.buildProjectFile(o));
  ['id', 'palette', 'font', 'fit', 'zhOn', 'eyebrow', 'heading'].forEach((k) => {
    assert.deepEqual(back[k], o[k], k);
  });
  assert.deepEqual(back.edits, { 3: '需求盤點' });
});
await t('讀到不是 JSON 的檔案時講人話', () => {
  assert.throws(() => DD.parseProjectFile('這不是 json'), /不是本站存出來的設定檔/);
});
await t('讀到別的工具的 JSON 時講人話', () => {
  assert.throws(() => DD.parseProjectFile('{"a":1}'), /不是本站存出來的設定檔/);
});
await t('讀到更新版的設定檔時講人話，而不是靜靜套錯', () => {
  const future = JSON.stringify({ format: 'gongwu-diagram', version: 99, diagram: 'x' });
  assert.throws(() => DD.parseProjectFile(future), /較新版本/);
});
await t('設定檔沒記錄範本時擋下來', () => {
  const bad = JSON.stringify({ format: 'gongwu-diagram', version: 1 });
  assert.throws(() => DD.parseProjectFile(bad), /沒有記錄是哪一張範本/);
});
await t('設定檔裡不是數字序號的 key 會被丟掉（別人手改壞的檔案不該炸掉頁面）', () => {
  const messy = JSON.stringify({
    format: 'gongwu-diagram', version: 1, diagram: 'x',
    edits: { 0: '好的', abc: '壞的', 2: null }
  });
  assert.deepEqual(DD.parseProjectFile(messy).edits, { 0: '好的' });
});

/* ── 首頁快捷入口 ───────────────────────────────────────────────── */
await t('快捷入口指到的都是真的範本 id，而且有中文標籤', () => {
  DD.STARTERS.forEach((st) => {
    assert.match(st.id, /^example-/, st.id);
    assert.ok(st.label && /[\u4e00-\u9fff]/.test(st.label), st.id);
    assert.ok(st.note && st.note.length > 0, st.id);
  });
});
await t('預設視野不放 Excel 本來就做得到的圖', () => {
  ['bar', 'line', 'scatter', 'polar'].forEach((t2) => {
    assert.ok(DD.COMMON_TYPES.indexOf(t2) < 0, t2 + ' 不該在預設視野裡');
  });
  ['flowchart', 'swimlane', 'org-chart'].forEach((t2) => {
    assert.ok(DD.COMMON_TYPES.indexOf(t2) >= 0, t2);
  });
});

/* ── CSS 收攏 ────────────────────────────────────────────────────── */
await t('splitRules 切得出巢狀大括號的規則', () => {
  const r = DD.splitRules('a{b:1}@media (x){c{d:2}}e{f:3}');
  assert.equal(r.length, 3);
  assert.equal(r[1], '@media (x){c{d:2}}');
});
await t('splitRules 會先把 CSS 註解拿掉', () => {
  assert.deepEqual(DD.splitRules('/* hi */a{b:1}'), ['a{b:1}']);
});
await t('scopeCss 把 :root 換成那張圖自己的 class', () => {
  const out = DD.scopeCss(':root{--x:1}', 'dd-a');
  assert.equal(out, '.dd-a{--x:1}');
});
await t('scopeCss 丟掉 HTML 外殼的規則', () => {
  const out = DD.scopeCss('body{margin:0}*{box-sizing:border-box}.frame{width:1px}h1{font-size:2rem}svg{width:100%}', 'dd-a');
  assert.equal(out, '');
});
await t('scopeCss 把其他選擇器冠上 class（不然會汙染同一頁的其他圖）', () => {
  const out = DD.scopeCss('.node{fill:red}', 'dd-a');
  assert.ok(out.includes('.dd-a .node'));
  assert.ok(out.includes('.dd-a.node'), '規則也可能打在 svg 根元素上');
});
await t('scopeCss 不會把 .frame-x 誤判成 .frame', () => {
  const out = DD.scopeCss('.frame-x{fill:red}', 'dd-a');
  assert.ok(out.includes('.frame-x'));
});
await t('scopeCss 保留 @media 並照樣冠 class', () => {
  const out = DD.scopeCss('@media (min-width:1px){.node{fill:red}}', 'dd-a');
  assert.ok(out.startsWith('@media (min-width:1px){'));
  assert.ok(out.includes('.dd-a .node'));
});
await t('scopeCss 丟掉整段變空的 @media', () => {
  assert.equal(DD.scopeCss('@media print{body{margin:0}}', 'dd-a'), '');
});
await t('scopeCss 丟掉 @font-face（載 webfont 就違反零對外連線）', () => {
  assert.equal(DD.scopeCss('@font-face{src:url(x.woff)}', 'dd-a'), '');
});
await t('prefixKeyframes 把動畫改名，避免兩張圖撞名', () => {
  const out = DD.prefixKeyframes('@keyframes pulse{from{opacity:0}}.x{animation: pulse 1s linear}', 'dd-a');
  assert.ok(out.includes('@keyframes dd-a-pulse'));
  assert.ok(out.includes('animation: dd-a-pulse 1s linear'));
});
await t('prefixKeyframes 不動同名的 class', () => {
  const out = DD.prefixKeyframes('@keyframes pulse{}.pulse{fill:red}', 'dd-a');
  assert.ok(out.includes('.pulse{fill:red}'));
});
await t('prefixKeyframes 沒有動畫時原樣回傳', () => {
  assert.equal(DD.prefixKeyframes('.x{fill:red}', 'dd-a'), '.x{fill:red}');
});
await t('inlineCssIntoSvg 把 style 塞進去並掛上 class', () => {
  const out = DD.inlineCssIntoSvg('<svg viewBox="0 0 1 1"><g/></svg>', '.dd-a{--x:1}', 'dd-a');
  assert.ok(out.includes('class="dd-a"'));
  assert.ok(out.includes('<style>.dd-a{--x:1}</style>'));
  assert.ok(out.indexOf('<style>') < out.indexOf('<g/>'));
});
await t('inlineCssIntoSvg 保留原本就有的 class', () => {
  const out = DD.inlineCssIntoSvg('<svg class="a" viewBox="0 0 1 1"></svg>', '', 'dd-a');
  assert.ok(out.includes('class="a dd-a"'));
});
await t('inlineCssIntoSvg 沒有 CSS 時不塞空的 style', () => {
  const out = DD.inlineCssIntoSvg('<svg viewBox="0 0 1 1"></svg>', '   ', 'dd-a');
  assert.ok(!out.includes('<style>'));
});

/* ── 版面 ────────────────────────────────────────────────────────── */
await t('parseViewBox 讀得出四個數字', () => {
  assert.deepEqual(DD.parseViewBox('<svg viewBox="0 0 1000 600">'), { x: 0, y: 0, w: 1000, h: 600 });
});
await t('parseViewBox 吃得下逗號與負數', () => {
  assert.deepEqual(DD.parseViewBox('<svg viewBox="-5,-5, 10 , 20">'), { x: -5, y: -5, w: 10, h: 20 });
});
await t('parseViewBox 沒有就回 null', () => {
  assert.equal(DD.parseViewBox('<svg>'), null);
});
await t('textUnits：中文算一格、英文算半格', () => {
  assert.equal(DD.textUnits('中文'), 2);
  assert.ok(Math.abs(DD.textUnits('abcd') - 2.2) < 1e-9);
  assert.equal(DD.textUnits(''), 0);
  assert.equal(DD.textUnits(null), 0);
});
await t('textUnits 把全形標點算成一格', () => {
  assert.equal(DD.textUnits('，'), 1);
});
await t('wrapLabel 折中文', () => {
  assert.deepEqual(DD.wrapLabel('一二三四五六', 3), ['一二三', '四五六']);
});
await t('wrapLabel 折英文時優先斷在空白，不會把單字切一半', () => {
  assert.deepEqual(DD.wrapLabel('alpha beta gamma', 6), ['alpha', 'beta gamma']);
  assert.deepEqual(DD.wrapLabel('alpha beta gamma', 3), ['alpha', 'beta', 'gamma']);
});
await t('wrapLabel 空字串回空陣列', () => {
  assert.deepEqual(DD.wrapLabel('', 10), []);
  assert.deepEqual(DD.wrapLabel('   ', 10), []);
  assert.deepEqual(DD.wrapLabel(null, 10), []);
});
await t('wrapLabel 寬度沒給就不折', () => {
  assert.deepEqual(DD.wrapLabel('一二三四', 0), ['一二三四']);
});
await t('wrapLabel 折出來的每一行都不是空的', () => {
  DD.wrapLabel('公務人員年終工作獎金發給注意事項一二三四五六七八', 4)
    .forEach((l) => assert.ok(l.trim().length > 0));
});
await t('shrinkToFit：塞得下就不動', () => {
  assert.equal(DD.shrinkToFit(12, 50, 100), 12);
});
await t('shrinkToFit：塞不下就按比例縮', () => {
  assert.equal(DD.shrinkToFit(12, 100, 50, 1), 6);
});
await t('shrinkToFit：不縮到比下限還小', () => {
  assert.equal(DD.shrinkToFit(12, 1000, 10, 7), 7);
});
await t('shrinkToFit：量不到寬度時原樣回傳（別把字縮成 0）', () => {
  assert.equal(DD.shrinkToFit(12, 0, 100), 12);
  assert.equal(DD.shrinkToFit(12, 100, 0), 12);
});

/* ── 匯出 ────────────────────────────────────────────────────────── */
await t('setSvgAttrs 新增與覆寫都行', () => {
  assert.equal(DD.setSvgAttrs('<svg x="1"><g/></svg>', { x: 9, y: 2 }), '<svg x="9" y="2"><g/></svg>');
});
const INNER = '<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
await t('composeExportSvg 把原圖整個當巢狀 svg 放進去', () => {
  const out = DD.composeExportSvg({ svg: INNER, heading: '標題', eyebrow: '流程圖' });
  assert.ok(out.includes('<rect/>'));
  assert.ok(out.includes('viewBox="0 0 200 100"'));
});
await t('composeExportSvg 明寫巢狀 svg 的 x／y／width／height', () => {
  const out = DD.composeExportSvg({ svg: INNER, heading: '標題' });
  const nested = out.slice(out.indexOf('<svg viewBox="0 0 200 100"'));
  ['x="0"', 'width="200"', 'height="100"'].forEach((a) => assert.ok(nested.includes(a), a));
  assert.match(nested, /\sy="\d+"/);
});
await t('composeExportSvg 一定帶上來源標註', () => {
  const out = DD.composeExportSvg({ svg: INNER, heading: '標題' });
  assert.ok(out.includes('cathrynlavery/diagram-design'));
  assert.ok(out.includes('MIT'));
});
await t('composeExportSvg 明確關掉時才沒有來源標註', () => {
  const out = DD.composeExportSvg({ svg: INNER, heading: '標題', credit: false });
  assert.ok(!out.includes('cathrynlavery'));
});
await t('composeExportSvg 沒有標題時不留空白區塊', () => {
  const bare = DD.composeExportSvg({ svg: INNER, heading: '', eyebrow: '', credit: false });
  assert.ok(bare.includes('viewBox="0 0 200 100"'));
  assert.match(bare, /^<svg[^>]*viewBox="0 0 200 100"/);
});
await t('composeExportSvg 標題長就換行，整張圖跟著變高', () => {
  const short = DD.composeExportSvg({ svg: INNER, heading: '短' });
  const long = DD.composeExportSvg({ svg: INNER, heading: '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十' });
  const h = (s) => +s.match(/height="(\d+)"/)[1];
  assert.ok(h(long) > h(short));
});
await t('composeExportSvg 會把標題裡的角括號轉義', () => {
  const out = DD.composeExportSvg({ svg: INNER, heading: '<script>x</script>' });
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});
await t('composeExportSvg 沒有 viewBox 時退回預設尺寸而不是爆掉', () => {
  const out = DD.composeExportSvg({ svg: '<svg><rect/></svg>', heading: 'x' });
  assert.ok(out.includes('<rect/>'));
});
await t('svgFile 加上 XML 宣告', () => {
  assert.ok(DD.svgFile('<svg/>').startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
});
await t('buildStandaloneHtml 是完整的一頁，且不含任何對外網址', () => {
  const html = DD.buildStandaloneHtml({ svg: INNER, heading: '標題' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<html lang="zh-Hant">'));
  /* 網址字元集只收 ASCII：來源標註後面接的是全形括號，不切掉會被當成網址的一部分 */
  const urls = (html.match(/https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+/g) || [])
    .filter((u) => !u.startsWith('http://www.w3.org/'));
  assert.deepEqual(urls, [DD.SOURCE.url], '除了來源標註以外不該有任何網址');
});
await t('buildStandaloneHtml 的字型只寫字族名', () => {
  const html = DD.buildStandaloneHtml({ svg: INNER });
  assert.ok(!/@font-face|fonts\.googleapis/.test(html));
});
await t('safeFilename 保留中文、換掉路徑字元', () => {
  assert.equal(DD.safeFilename('流程圖/測試', 'png'), '流程圖_測試.png');
  assert.equal(DD.safeFilename('a:b*c?d', 'svg'), 'a_b_c_d.svg');
});
await t('safeFilename 保留空白與連字號（那兩個檔名收得下，換掉只是難讀）', () => {
  assert.equal(DD.safeFilename('Case flow 2026', 'svg'), 'Case flow 2026.svg');
  assert.equal(DD.safeFilename('甲案-乙案', 'png'), '甲案-乙案.png');
});
await t('safeFilename 把控制字元清掉', () => {
  assert.equal(DD.safeFilename('a' + String.fromCharCode(0) + 'b', 'svg'), 'ab.svg');
});
await t('safeFilename 空的時候有預設名字', () => {
  assert.equal(DD.safeFilename('', 'png'), '圖表.png');
  assert.equal(DD.safeFilename('   ', 'png'), '圖表.png');
  assert.equal(DD.safeFilename(null, 'png'), '圖表.png');
});
await t('safeFilename 太長會截短', () => {
  assert.ok(DD.safeFilename('字'.repeat(200), 'png').length <= 64);
});

/* ── 流程圖的版面引擎 ─────────────────────────────────────────────
   大綱語法已經拿掉了（現在是填表），所以這裡測的是「節點 → 版面 → SVG」，
   節點長什麼樣子由 gen.js 決定，gen.unit 測那一段。 */

const fnode = (kind, main, extra) =>
  Object.assign({ kind, main, sub: '', branch: null, loop: null, downLabel: '', branchEnds: false },
    extra || {});

await t('flowOpposite：是↔否 這種成對的才自動標，其他留空', () => {
  assert.equal(DD.flowOpposite('是'), '否');
  assert.equal(DD.flowOpposite('否'), '是');
  assert.equal(DD.flowOpposite('隨便'), '');
});

await t('splitFlowText：斜線後面是副標，全形半形都收', () => {
  assert.deepEqual(DD.splitFlowText('登記收文 / 收發室'), { main: '登記收文', sub: '收發室' });
  assert.deepEqual(DD.splitFlowText('擬稿 ／ 附法令'), { main: '擬稿', sub: '附法令' });
  assert.deepEqual(DD.splitFlowText('只有主文'), { main: '只有主文', sub: '' });
});

await t('layoutFlow：主線由上往下排，不重疊', () => {
  const lay = DD.layoutFlow([fnode('start', '甲'), fnode('step', '乙'), fnode('end', '丙')]);
  assert.equal(lay.items.length, 3);
  lay.items.forEach((it, i) => {
    assert.equal(it.col, 'main');
    if (i) assert.ok(it.top > lay.items[i - 1].bottom, '第 ' + (i + 1) + ' 格疊到前一格');
  });
  assert.ok(lay.height > lay.items[2].bottom);
});

await t('layoutFlow：字多的方塊會變高（不然字會爆出框）', () => {
  const short = DD.layoutFlow([fnode('step', '甲')]).items[0];
  const long = DD.layoutFlow([fnode('step', '這是一段刻意寫得非常長的步驟名稱用來把方塊撐高')]).items[0];
  assert.ok(long.h > short.h, short.h + ' vs ' + long.h);
});

await t('layoutFlow：分支步驟排在右邊那一欄，第一格跟判斷同高', () => {
  const lay = DD.layoutFlow([
    fnode('decision', '要不要？'), fnode('branch', '不要就這樣'), fnode('step', '要就繼續')
  ]);
  const [dec, side, main] = lay.items;
  assert.equal(side.col, 'side');
  assert.ok(side.cx > dec.cx, '分支沒有排在右邊');
  assert.equal(Math.round(side.cy), Math.round(dec.cy), '分支第一格沒有跟判斷同高');
  assert.equal(side.owner, 0);
  assert.equal(main.col, 'main');
});

await t('layoutFlow：分支走好幾步時，主線讓到分支底下（匯回線要有地方走）', () => {
  const lay = DD.layoutFlow([
    fnode('decision', '要不要？'),
    fnode('branch', '甲'), fnode('branch', '乙'), fnode('branch', '丙'),
    fnode('step', '匯回這裡')
  ]);
  const side = lay.items.filter((i) => i.col === 'side');
  const target = lay.items[lay.items.length - 1];
  assert.equal(side.length, 3);
  side.forEach((s, i) => { if (i) assert.ok(s.top > side[i - 1].bottom, '分支自己疊在一起'); });
  assert.ok(target.top > side[side.length - 1].bottom, '主線沒有讓到分支底下');
});

await t('layoutFlow：分支接不到判斷時就當主線畫，不會掉到 side 欄', () => {
  const lay = DD.layoutFlow([fnode('step', '甲'), fnode('branch', '乙')]);
  assert.equal(lay.items[1].col, 'main');
});

await t('flowMainIndexes：只回主線那幾格', () => {
  const lay = DD.layoutFlow([
    fnode('decision', '甲'), fnode('branch', '乙'), fnode('step', '丙')
  ]);
  assert.deepEqual(DD.flowMainIndexes(lay.items), [0, 2]);
});

await t('renderFlowSvg：畫得出完整的一張 svg', () => {
  const svg = DD.renderFlowSvg({ nodes: [fnode('start', '收到來文'), fnode('end', '發文')] }, {});
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(svg, /viewBox="0 0 1000 \d+"/);
  assert.ok(svg.includes('收到來文') && svg.includes('發文'));
});

await t('renderFlowSvg：判斷是菱形、起訖是圓角、退回是虛線', () => {
  const svg = DD.renderFlowSvg({
    nodes: [
      fnode('start', '甲'),
      fnode('decision', '乙？', { loop: { label: '是', target: '甲', index: 0 } })
    ]
  }, {});
  assert.ok(svg.includes('<polygon'), '沒有菱形');
  assert.match(svg, /rx="\d/, '沒有圓角');
  assert.ok(svg.includes('stroke-dasharray'), '退回線不是虛線');
});

await t('renderFlowSvg：分支走完會有一條匯回主線的線，勾了不回主線就沒有', () => {
  const nodes = () => [
    fnode('decision', '要不要？'), fnode('branch', '不要'), fnode('step', '匯回這裡')
  ];
  const joined = DD.renderFlowSvg({ nodes: nodes() }, {});
  const ends = nodes();
  ends[0].branchEnds = true;
  const cut = DD.renderFlowSvg({ nodes: ends }, {});
  /* 匯流點是半徑 2.6 的實心點；網點底圖也用 circle，所以要指名半徑才問得準 */
  assert.ok(joined.includes('r="2.6"'), '沒有畫匯流點');
  assert.ok(!cut.includes('r="2.6"'), '勾了不回主線還是畫了匯回線');
});

await t('renderFlowSvg：往下那條線的字，使用者填了就照填的，沒填才自動標相反的', () => {
  const auto = DD.renderFlowSvg({
    nodes: [fnode('decision', '甲？', { branch: { label: '否' } }), fnode('step', '乙')]
  }, {});
  assert.ok(auto.includes('>是<'), '沒有自動標成相反的');
  const manual = DD.renderFlowSvg({
    nodes: [fnode('decision', '甲？', { branch: { label: '否' }, downLabel: '通過' }), fnode('step', '乙')]
  }, {});
  assert.ok(manual.includes('>通過<'), '沒有照使用者填的標');
});

await t('renderFlowSvg：顏色用上游那四個色票，換配色才吃得到', () => {
  const svg = DD.renderFlowSvg({ nodes: [fnode('start', '甲'), fnode('end', '乙')] }, {});
  assert.ok(svg.includes(DD.UPSTREAM_LIGHT.paper));
  assert.ok(svg.includes(DD.UPSTREAM_LIGHT.ink));
  assert.ok(svg.includes(DD.UPSTREAM_LIGHT.accent));
});

await t('renderFlowSvg：使用者打的角括號會被轉義，不會變成標籤', () => {
  const svg = DD.renderFlowSvg({ nodes: [fnode('step', '<script>x</script>')] }, {});
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
});

await t('renderFlowSvg：一個節點都沒有時畫一張說明用的空圖，不是壞掉的 svg', () => {
  const svg = DD.renderFlowSvg({ nodes: [] }, {});
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.ok(svg.includes('左邊'));
});

await t('renderFlowSvg：產出的字族是本機字族，沒有 webfont', () => {
  const svg = DD.renderFlowSvg({ nodes: [fnode('step', '甲')] }, {});
  /* xmlns 是命名空間識別字，不是連線，要排除掉才問得準 */
  const links = svg.replace(/xmlns(:\w+)?="[^"]*"/g, '');
  assert.ok(!/@import|https?:\/\//.test(links), '產出的 SVG 有對外連線');
  assert.ok(svg.includes('Noto Sans TC') || svg.includes('system-ui'), '不是本機字族');
});

/* ── .docx：Word 開得起來，圖還能轉成可編輯的圖案 ──────────────────── */

await t('crc32：對得上已知值', () => {
  assert.equal(DD.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.equal(DD.crc32(new Uint8Array(0)), 0);
});

await t('zipStore：組出來的是合法 ZIP（有本地檔頭與中央目錄）', () => {
  const enc = new TextEncoder();
  const z = DD.zipStore([{ name: 'a.txt', bytes: enc.encode('hello') }]);
  assert.equal(z[0], 0x50); assert.equal(z[1], 0x4b);
  const tail = Array.from(z.slice(-22, -18));
  assert.deepEqual(tail, [0x50, 0x4b, 0x05, 0x06], '沒有中央目錄結尾');
  assert.ok(z.length > 5 + 30 + 46);
});

await t('zipStore：同樣的內容壓出同樣的位元組（時間固定成 1980-01-01）', () => {
  const enc = new TextEncoder();
  const a = DD.zipStore([{ name: 'a.txt', bytes: enc.encode('hello') }]);
  const b = DD.zipStore([{ name: 'a.txt', bytes: enc.encode('hello') }]);
  assert.deepEqual(Array.from(a), Array.from(b));
});

/* Word 自己的「轉換成圖形」會把圖上的文字整批丟掉（實測 Word 2019：一張家系圖
   68 個圖形進去、51 個圖案出來、32 段文字一個都沒留）。所以這一段測的是
   「我們自己換成 Word 圖案時，字有沒有跟著進去」——那正是 Word 會弄丟的東西。 */

const wordSvg = '<svg viewBox="0 0 200 100">' +
  '<rect x="10" y="20" width="60" height="30" rx="6" fill="#ffffff" stroke="#2d3142" stroke-width="1.4"/>' +
  '<circle cx="150" cy="35" r="15" fill="#ffffff" stroke="#2d3142" stroke-width="1.4"/>' +
  '<line x1="70" y1="35" x2="135" y2="35" stroke="#2d3142" stroke-width="1.3"/>' +
  '<polyline points="10,80 60,90 110,80" fill="none" stroke="#eb6c36" stroke-width="1.2"/>' +
  '<path d="M 10 60 H 60 V 70" fill="none" stroke="#4f5d75" stroke-width="1.2" stroke-dasharray="6 4"/>' +
  '<text x="40" y="40" fill="#2d3142" font-size="12" font-family="標楷體, DFKai-SB, serif" ' +
  'font-weight="600" text-anchor="middle">陳小華</text></svg>';

await t('svgToWordGroup：自己畫的圖換得成 Word 圖案，而且每一段字都在', () => {
  const g = DD.svgToWordGroup(wordSvg, { scale: 1, title: '測試圖' });
  assert.ok(g, '換不出來');
  assert.equal((g.match(/<wps:wsp>/g) || []).length, 6, '圖案數不對');
  assert.equal((g.match(/<wps:txbx>/g) || []).length, 1, '文字沒有變成文字方塊');
  assert.ok(g.includes('陳小華'), '字掉了——那正是 Word 自己轉會出的錯');
  assert.ok(g.includes('w:eastAsia="標楷體"'), '中文字型沒帶進去');
  assert.ok(/<a:prstGeom prst="roundRect"/.test(g), '圓角方塊不見了');
  assert.ok(/<a:prstGeom prst="ellipse"/.test(g), '圓不見了');
  assert.ok(/<a:prstGeom prst="line"/.test(g), '直線不見了');
  assert.equal((g.match(/<a:custGeom>/g) || []).length, 2, '折線與 path 沒有變成自訂形狀');
  assert.ok(g.includes('<a:prstDash val="dash"/>'), '虛線沒有帶過去');
});

await t('svgToWordGroup：座標跟原圖對得上（x1/y1 這種帶數字的屬性最容易漏讀）', () => {
  const g = DD.svgToWordGroup(wordSvg, { scale: 1, title: 'x' });
  const EMU = 9525;
  /* 直線 70,35 → 135,35：左上角在 (70,35)，寬 65、高 0 */
  const m = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm><a:prstGeom prst="line"/.exec(g);
  assert.ok(m, '找不到那條直線');
  assert.equal(+m[1], 70 * EMU, '線的起點 x 不對（屬性名字讀錯會變成 0）');
  assert.equal(+m[2], 35 * EMU);
  assert.equal(+m[3], 65 * EMU, '線的長度不對');
  assert.equal(+m[4], 0);
  /* 圓 cx=150 r=15：外框左上角在 (135,20)、寬高各 30 */
  const c = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm><a:prstGeom prst="ellipse"/.exec(g);
  assert.equal(+c[1], 135 * EMU);
  assert.equal(+c[3], 30 * EMU);
});

await t('svgToWordGroup：字級換算成半點，縮圖時字也跟著縮', () => {
  const big = DD.svgToWordGroup(wordSvg, { scale: 1, title: 'x' });
  const half = DD.svgToWordGroup(wordSvg, { scale: 0.5, title: 'x' });
  assert.equal(+/<w:sz w:val="(\d+)"\/>/.exec(big)[1], 18, '12px 應該是 9pt＝18 半點');
  assert.equal(+/<w:sz w:val="(\d+)"\/>/.exec(half)[1], 9, '縮一半字沒有跟著縮');
});

await t('svgToWordGroup：認不得的 SVG 一律回 null，不要猜著轉', () => {
  assert.equal(DD.svgToWordGroup('<svg viewBox="0 0 10 10"><g><rect width="5" height="5" fill="#fff"/></g></svg>', {}), null, '有 g 還硬轉');
  assert.equal(DD.svgToWordGroup('<svg viewBox="0 0 10 10"><style>.a{fill:red}</style><rect class="a" width="5" height="5"/></svg>', {}), null, '有 style 還硬轉');
  assert.equal(DD.svgToWordGroup('<svg><rect width="5" height="5" fill="#fff"/></svg>', {}), null, '沒有 viewBox 還硬轉');
  assert.equal(DD.svgToWordGroup('<svg viewBox="0 0 10 10"></svg>', {}), null, '空的圖不該產出空群組');
  assert.equal(DD.wordShapesOk(wordSvg), true);
  assert.equal(DD.wordShapesOk('<svg viewBox="0 0 10 10"><g/></svg>'), false);
});

await t('buildDocx：換得成圖案時不放圖片，關聯裡也不留指不到的檔案', () => {
  const bytes = DD.buildDocx({ svg: wordSvg, png: new Uint8Array([1, 2, 3]), w: 200, h: 100, title: '測試圖' });
  const text = Buffer.from(bytes).toString('utf8');
  assert.ok(text.includes('<wpg:wgp>'), '沒有用 Word 圖案群組');
  assert.ok(text.includes('陳小華'), '字沒有進 Word 檔');
  assert.ok(!text.includes('word/media/image1.png'), '不用的圖片還留著');
  assert.ok(!text.includes('media/image1.svg'), '關聯指到不存在的檔案，Word 會說檔案毀損');
  assert.ok(!text.includes('轉換成圖形'), '已經是圖案了還叫人去轉換');
});

await t('buildDocx：範本那種認不得的 SVG 退回圖片，六個檔案都在', () => {
  const tpl = '<svg viewBox="0 0 100 50"><g><text>甲</text></g></svg>';
  const bytes = DD.buildDocx({ svg: tpl, png: new Uint8Array([1, 2, 3]), w: 100, h: 50, title: '測試圖' });
  const text = Buffer.from(bytes).toString('latin1');
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml',
    'word/_rels/document.xml.rels', 'word/media/image1.png', 'word/media/image1.svg']
    .forEach((n) => assert.ok(text.includes(n), '少了 ' + n));
  const utf = Buffer.from(bytes).toString('utf8');
  assert.ok(utf.includes('asvg:svgBlip'), '沒有 SVG 擴充，Word 只會看到圖片');
  assert.ok(utf.includes('r:embed="rId2"'), 'SVG 沒有掛上關聯');
  assert.ok(utf.includes('轉換成圖形'), '沒有告訴使用者怎麼把圖變成可編輯的');
});

await t('buildDocx：帶著來源標註（授權要求）', () => {
  const bytes = DD.buildDocx({ svg: '<svg viewBox="0 0 10 10"></svg>', png: new Uint8Array(0), w: 10, h: 10 });
  assert.ok(Buffer.from(bytes).toString('utf8').includes('cathrynlavery/diagram-design'));
});

await t('buildDocx：標題裡的角括號會被轉義，不會弄壞 XML', () => {
  const bytes = DD.buildDocx({ svg: '<svg viewBox="0 0 10 10"></svg>', png: new Uint8Array(0), w: 10, h: 10, title: '<壞>&' });
  const text = Buffer.from(bytes).toString('utf8');
  assert.ok(text.includes('&lt;壞&gt;&amp;'));
  assert.ok(!text.includes('name="<壞>'));
});

await t('buildDocx：圖太寬時縮到 A4 版面寬度，不會撐出頁面', () => {
  const wide = DD.buildDocx({ svg: '<svg viewBox="0 0 4000 1000"></svg>', png: new Uint8Array(0), w: 4000, h: 1000 });
  const cx = +/wp:extent cx="(\d+)"/.exec(Buffer.from(wide).toString('utf8'))[1];
  assert.ok(cx <= 628 * 9525 + 10, 'cx=' + cx);
  const small = DD.buildDocx({ svg: '<svg viewBox="0 0 200 100"></svg>', png: new Uint8Array(0), w: 200, h: 100 });
  const cx2 = +/wp:extent cx="(\d+)"/.exec(Buffer.from(small).toString('utf8'))[1];
  assert.equal(cx2, 200 * 9525, '小圖不該被放大');
});

/* ── 分類與篩選 ──────────────────────────────────────────────────── */
await t('parseAssetName 切得出類型與變體', () => {
  assert.deepEqual(DD.parseAssetName('example-flowchart.html'), { type: 'flowchart', variant: '' });
  assert.deepEqual(DD.parseAssetName('example-flowchart-dark.html'), { type: 'flowchart', variant: 'dark' });
  assert.deepEqual(DD.parseAssetName('example-org-chart-full.html'), { type: 'org-chart', variant: 'full' });
});
await t('parseAssetName 長的類型名優先（high-level-vertical 不能被 high-level 吃掉）', () => {
  assert.deepEqual(DD.parseAssetName('example-high-level-vertical-dark.html'),
    { type: 'high-level-vertical', variant: 'dark' });
  assert.deepEqual(DD.parseAssetName('example-high-level-dark.html'),
    { type: 'high-level', variant: 'dark' });
});
await t('parseAssetName 認得空白範本', () => {
  assert.deepEqual(DD.parseAssetName('template.html'), { type: 'template', variant: '' });
  assert.deepEqual(DD.parseAssetName('template-dark.html'), { type: 'template', variant: 'dark' });
});
await t('typeLabel／variantLabel 給中文，沒有對照就原樣回傳', () => {
  assert.equal(DD.typeLabel('flowchart'), '流程圖');
  assert.equal(DD.typeLabel('nope'), 'nope');
  assert.equal(DD.variantLabel(''), '標準');
  assert.equal(DD.variantLabel('dark'), '深色');
  assert.equal(DD.variantLabel('oauth'), 'oauth');
});
await t('COMMON_TYPES 裡的每一個都要有中文名', () => {
  DD.COMMON_TYPES.forEach((t2) => assert.ok(DD.TYPE_META[t2], t2));
});
await t('TYPE_META 每一筆都有中文名與用途', () => {
  Object.keys(DD.TYPE_META).forEach((k) => {
    assert.ok(DD.TYPE_META[k].zh && DD.TYPE_META[k].zh.length > 0, k);
    assert.ok(DD.TYPE_META[k].use && DD.TYPE_META[k].use.length > 0, k);
  });
});

const LIST = [
  { id: 'a', type: 'flowchart', typeZh: '流程圖', heading: 'Should you write', use: '有判斷分支', dark: false, variantZh: '標準' },
  { id: 'b', type: 'flowchart', typeZh: '流程圖', heading: 'Dark one', use: '有判斷分支', dark: true, variantZh: '深色' },
  { id: 'c', type: 'sankey', typeZh: '桑基圖（流量分布）', heading: 'Budget flow', use: '預算分流', dark: false, variantZh: '標準' }
];
await t('filterDiagrams 不給條件時全都回', () => {
  assert.equal(DD.filterDiagrams(LIST, {}).length, 3);
  assert.equal(DD.filterDiagrams(LIST).length, 3);
});
await t('filterDiagrams 依類型過濾', () => {
  assert.equal(DD.filterDiagrams(LIST, { type: 'sankey' }).length, 1);
});
await t('filterDiagrams 依深淺過濾', () => {
  assert.equal(DD.filterDiagrams(LIST, { theme: 'dark' }).length, 1);
  assert.equal(DD.filterDiagrams(LIST, { theme: 'light' }).length, 2);
});
await t('filterDiagrams 搜中文名', () => {
  assert.equal(DD.filterDiagrams(LIST, { q: '流程' }).length, 2);
});
await t('filterDiagrams 搜用途說明', () => {
  assert.equal(DD.filterDiagrams(LIST, { q: '預算' }).length, 1);
});
await t('filterDiagrams 搜英文時不分大小寫', () => {
  assert.equal(DD.filterDiagrams(LIST, { q: 'BUDGET' }).length, 1);
});
await t('filterDiagrams 的中文篩選只留寫好整份中文的', () => {
  const list = [{ type: 'flowchart', zhKind: 'sample' }, { type: 'flowchart', zhKind: 'gloss' },
    { type: 'flowchart', zhKind: '' }];
  assert.equal(DD.filterDiagrams(list, { zhOnly: true }).length, 1);
  assert.equal(DD.filterDiagrams(list, {}).length, 3);
});
await t('filterDiagrams 的常用篩選只留常用類型', () => {
  const out = DD.filterDiagrams(LIST, { common: true });
  assert.equal(out.length, 2);
  assert.ok(out.every((d) => d.type === 'flowchart'));
});
await t('filterDiagrams 條件疊起來用', () => {
  assert.equal(DD.filterDiagrams(LIST, { q: '流程', theme: 'light' }).length, 1);
});
await t('filterDiagrams 對空清單不會爆', () => {
  assert.deepEqual(DD.filterDiagrams(null, { q: 'x' }), []);
});

/* ── 端到端：一份上游 HTML 走完整條轉換管線 ──────────────────────── */
await t('整條管線：抽出 → 收 CSS → 換字型，結果零外部網址且沒有 webfont', () => {
  const doc = DD.extractDocument(SAMPLE);
  let svg = DD.inlineCssIntoSvg(DD.stripComments(doc.svg), DD.scopeCss(doc.css, 'dd-x'), 'dd-x');
  svg = DD.mapFonts(svg);
  assert.ok(!svg.includes('Geist'));
  assert.ok(!svg.includes('googleapis'));
  assert.ok(!svg.includes('a comment'));
  assert.ok(svg.includes('.dd-x{'), ':root 要變成這張圖自己的 class');
  assert.ok(!svg.includes('body{'), 'HTML 外殼的規則不該被搬進來');
  assert.ok(svg.includes('Hi'));
});

s.finish();
