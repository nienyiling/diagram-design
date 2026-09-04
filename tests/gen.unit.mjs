/*
 * gen.unit.mjs — 五種產生器的純函式測試。直接 require 站上那份 app/gen.js，不做副本。
 *
 * 這一層的價值在於「填什麼就得到什麼」：使用者填的每一格都要出現在圖上，
 * 填錯的每一格都要有一句講得出下一步的話。所以測的是 svg 的內容與 warnings，
 * 不是座標——座標調版面時本來就會動，寫死了只會讓人不敢改版面。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { scoreboard } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const G = require(path.join(ROOT, 'app', 'gen.js'));

const s = scoreboard('gen.unit');
const t = (name, fn) => s.t(name, fn);

/** 一張圖上看得到的字：把標籤剝掉就好，跨標籤的字串本來就不該當成一個詞。 */
const words = (svg) => svg.replace(/<[^>]*>/g, '\n');
const defMeta = (gen) =>
  (gen.meta || []).reduce((m, f) => { m[f.key] = f.placeholder || ''; return m; }, {});
const buildExample = (gen) => gen.build(gen.example, defMeta(gen), {});

/* ── 五種都要長得像同一種東西：規格是表單引擎照著長出畫面的依據 ────────── */

await t('TYPES 是五種，id 不重複', () => {
  assert.equal(G.TYPES.length, 5);
  assert.deepEqual(G.TYPES.map((g) => g.id), ['flow', 'gantt', 'timeline', 'layers', 'quadrant']);
});

await t('每一種都有畫面要用的規格：名稱、用途、列名、欄位、範例、示意範本', () => {
  G.TYPES.forEach((g) => {
    assert.ok(g.name && g.use && g.rowName, g.id + ' 少了名稱／用途／列名');
    assert.ok(Array.isArray(g.fields) && g.fields.length, g.id + ' 沒有欄位');
    assert.ok(Array.isArray(g.example) && g.example.length >= 3, g.id + ' 範例太短');
    assert.ok(Array.isArray(g.help) && g.help.length, g.id + ' 沒有說明');
    assert.match(g.sample, /^example-/, g.id + ' 的示意範本 id 不對');
    assert.ok(g.sampleTitle, g.id + ' 沒有預設標題');
    assert.equal(typeof g.build, 'function');
  });
});

await t('欄位型別只有表單引擎畫得出來的那幾種，select 一定附選項', () => {
  const ok = new Set(['text', 'select', 'check', 'rowref']);
  G.TYPES.forEach((g) => {
    g.fields.concat(g.meta || []).forEach((f) => {
      assert.ok(f.key && f.label, g.id + ' 有欄位少了 key／label');
      assert.ok(ok.has(f.type), g.id + '.' + f.key + ' 型別是 ' + f.type);
      if (f.type === 'select') {
        assert.ok(Array.isArray(f.options) && f.options.length, g.id + '.' + f.key + ' 沒有選項');
      }
    });
    /* 整張圖共用的設定不可以是下拉或勾選——表單引擎那一段只畫文字框 */
    (g.meta || []).forEach((f) => assert.equal(f.type, 'text', g.id + ' 的 meta 只收文字'));
    /* 每一種都要有一個文字欄位當「主要文字」，退回目標的下拉是照它長的 */
    assert.ok(g.fields.some((f) => f.type === 'text'), g.id + ' 沒有文字欄位');
  });
});

await t('每一種的範例都畫得出來，沒有半句抱怨', () => {
  G.TYPES.forEach((g) => {
    const out = buildExample(g);
    assert.deepEqual(out.warnings, [], g.id + ' 的範例自己就有警告：' + out.warnings.join('／'));
    assert.equal(out.count, g.example.length, g.id + ' 的列數對不上');
    assert.match(out.svg, /^<svg[\s\S]*<\/svg>$/, g.id + ' 產出的不是一份完整的 SVG');
    assert.match(out.svg, /viewBox="0 0 \d+ \d+"/, g.id + ' 沒有 viewBox');
  });
});

await t('範例填的每一格文字都真的出現在圖上', () => {
  G.TYPES.forEach((g) => {
    const text = words(buildExample(g).svg);
    g.example.forEach((row) => {
      g.fields.forEach((f) => {
        if (f.type !== 'text') return;
        const v = String(row[f.key] || '').trim();
        /* 日期欄位圖上顯示的是民國年排版過的樣子，不是使用者原本打的字 */
        if (!v || G.parseTwDate(v)) return;
        assert.ok(text.includes(v), g.id + ' 的圖上找不到「' + v + '」');
      });
    });
  });
});

await t('一列都沒填時給的是一句「該做什麼」，不是空白也不是壞掉', () => {
  G.TYPES.forEach((g) => {
    const out = g.build([], defMeta(g), {});
    assert.equal(out.count, 0);
    assert.match(out.svg, /^<svg[\s\S]*<\/svg>$/, g.id + ' 空的時候吐出來的不是 SVG');
    assert.match(words(out.svg), /左邊/, g.id + ' 空的時候沒有講該做什麼');
  });
});

await t('rows 給 null／undefined 也不會爆', () => {
  G.TYPES.forEach((g) => {
    assert.equal(g.build(null, null, null).count, 0, g.id);
    assert.equal(g.build(undefined, undefined, undefined).count, 0, g.id);
  });
});

await t('圖上不會出現 undefined／NaN 這種漏掉的值', () => {
  G.TYPES.forEach((g) => {
    const svg = buildExample(g).svg;
    assert.ok(!/undefined|NaN|\[object/.test(svg), g.id + ' 的圖上有沒填好的值');
  });
});

await t('使用者打的字被跳脫，不會變成標籤', () => {
  const out = G.byId('layers').build(
    [{ name: '<script>壞東西</script>', note: 'a & b' }], {}, {});
  assert.ok(!out.svg.includes('<script>'), '角括號沒有跳脫');
  assert.ok(out.svg.includes('&lt;script&gt;'));
  assert.ok(out.svg.includes('a &amp; b'));
});

await t('byId 找得到，找不到就回 null', () => {
  assert.equal(G.byId('gantt').name, '甘特圖');
  assert.equal(G.byId('沒這種'), null);
  assert.equal(G.byId(''), null);
});

/* ── 日期：公務一定要吃得下民國年 ──────────────────────────────────── */

const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);

await t('parseTwDate：民國年各種寫法都收', () => {
  ['114/3/5', '114.3.5', '114-3-5', '114年3月5日', '1140305', '１１４/３/５']
    .forEach((v) => assert.equal(iso(G.parseTwDate(v)), '2025-03-05', v));
});

await t('parseTwDate：西元也收，八碼當西元、七碼當民國', () => {
  assert.equal(iso(G.parseTwDate('2025-03-05')), '2025-03-05');
  assert.equal(iso(G.parseTwDate('20250305')), '2025-03-05');
  assert.equal(iso(G.parseTwDate('1140305')), '2025-03-05');
});

await t('parseTwDate：只寫到月就當月初', () => {
  assert.equal(iso(G.parseTwDate('114/3')), '2025-03-01');
  assert.equal(iso(G.parseTwDate('114年3月')), '2025-03-01');
});

await t('parseTwDate：不存在的日期回 null，不要偷偷跳到下個月', () => {
  ['114/2/30', '114/13/1', '114/0/5', '隨便打的', '', null, undefined]
    .forEach((v) => assert.equal(G.parseTwDate(v), null, String(v)));
});

await t('twLabel：民國年顯示', () => {
  const d = G.parseTwDate('114/3/5');
  assert.equal(G.twLabel(d), '114年3月');
  assert.equal(G.twLabel(d, true), '114年3月5日');
});

/* ── 流程圖：使用者自己決定步驟、分岔與退回 ──────────────────────────── */

const flow = G.byId('flow');

await t('流程圖：加一列就多一個節點', () => {
  const rows = flow.example.concat([{ kind: 'step', main: '後續追蹤' }]);
  const out = flow.build(rows, {}, {});
  assert.equal(out.count, rows.length);
  assert.ok(words(out.svg).includes('後續追蹤'));
});

await t('流程圖：判斷的分支結果畫在右邊，分支標籤標在線上', () => {
  const out = flow.build([
    { kind: 'decision', main: '是否本科權責？', branchLabel: '否', branchText: '移文他科' }
  ], {}, {});
  const text = words(out.svg);
  assert.ok(text.includes('移文他科'));
  assert.ok(text.includes('否'));
});

await t('流程圖：分支結果的斜線副標會拆成小字', () => {
  const out = flow.build([
    { kind: 'decision', main: '要退嗎？', branchLabel: '是', branchText: '退回 / 附說明' }
  ], {}, {});
  const text = words(out.svg);
  assert.ok(text.includes('退回'), text);
  assert.ok(text.includes('附說明'), text);
});

await t('流程圖：退回目標指不到前面的步驟時，講得出是哪一個判斷、指了什麼', () => {
  const out = flow.build([
    { kind: 'step', main: '承辦人擬稿' },
    { kind: 'decision', main: '要修正嗎？', branchLabel: '是', loopTo: '打錯的名字' }
  ], {}, {});
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /要修正嗎/);
  assert.match(out.warnings[0], /打錯的名字/);
});

await t('流程圖：退回只能指前面，指到後面一樣要講', () => {
  const out = flow.build([
    { kind: 'decision', main: '要修正嗎？', loopTo: '主管決行' },
    { kind: 'step', main: '主管決行' }
  ], {}, {});
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /不在它前面/);
});

await t('流程圖：兩條分支都填時，往下走的那條自動標相反的', () => {
  const out = flow.build([
    { kind: 'step', main: '擬稿' },
    { kind: 'decision', main: '要修正嗎？', branchLabel: '否', branchText: '送出', loopTo: '擬稿' }
  ], {}, {});
  assert.deepEqual(out.warnings, []);
  assert.ok(words(out.svg).includes('送出'));
});

await t('流程圖：那一列只填了副標沒填文字時，講一句就跳過，不畫空方塊', () => {
  const out = flow.build([
    { kind: 'step', main: '甲' }, { kind: 'step', main: '', sub: '收發室' }
  ], {}, {});
  assert.equal(out.count, 1);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /第 2 列/);
});

await t('流程圖：整列全空就安靜跳過，不要對著剛按出來的空白列碎唸', () => {
  const out = flow.build([{ kind: 'step', main: '甲' }, { kind: 'step', main: '' }], {}, {});
  assert.equal(out.count, 1);
  assert.deepEqual(out.warnings, []);
});

/* ── 甘特圖：長條的位置就是日期算出來的 ─────────────────────────────── */

const gantt = G.byId('gantt');

await t('甘特圖：日期看不懂時講得出是哪一項、打了什麼、可以怎麼打', () => {
  const out = gantt.build([{ name: '需求訪談', start: '三月初', end: '114/3/20' }], {}, {});
  assert.equal(out.count, 0);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /需求訪談/);
  assert.match(out.warnings[0], /三月初/);
  assert.match(out.warnings[0], /114\/3\/5/);
});

await t('甘特圖：迄日早於起日時當成同一天，並且講一聲', () => {
  const out = gantt.build([{ name: '甲', start: '114/3/20', end: '114/3/1' }], {}, {});
  assert.equal(out.count, 1);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /早於起日/);
});

await t('甘特圖：沒填迄日就當一天做完', () => {
  const out = gantt.build([{ name: '上簽', start: '114/3/5' }], {}, {});
  assert.equal(out.count, 1);
  assert.deepEqual(out.warnings, []);
  assert.ok(words(out.svg).includes('3月5日'));
});

await t('甘特圖：時間軸的總跨度是所有項目的最早到最晚', () => {
  const out = gantt.build([
    { name: '甲', start: '114/3/1', end: '114/3/10' },
    { name: '乙', start: '114/5/1', end: '114/6/30' }
  ], {}, {});
  const text = words(out.svg);
  assert.ok(text.includes('114年3月'), text.slice(0, 200));
  assert.ok(text.includes('114年6月'), text.slice(0, 200));
});

await t('甘特圖：查核點畫菱形不畫長條', () => {
  const count = (svg, tag) => (svg.match(new RegExp('<' + tag, 'g')) || []).length;
  const bar = gantt.build([{ name: '甲', start: '114/3/1', end: '114/3/10' }], {}, {});
  const mile = gantt.build([{ name: '甲', start: '114/3/1', end: '114/3/10', milestone: true }], {}, {});
  assert.ok(count(mile.svg, 'polygon') > count(bar.svg, 'polygon'), '查核點沒有畫成菱形');
});

await t('甘特圖：同一個階段連著幾列只標一次', () => {
  const out = gantt.build([
    { name: '甲', start: '114/3/1', phase: '需求盤點' },
    { name: '乙', start: '114/3/2', phase: '需求盤點' }
  ], {}, {});
  assert.equal((words(out.svg).match(/需求盤點/g) || []).length, 1);
});

/* ── 時間軸 ────────────────────────────────────────────────────────── */

const timeline = G.byId('timeline');

await t('時間軸：日期看不懂時原樣顯示，不要把使用者的字吃掉', () => {
  const out = timeline.build([{ date: '114 年上半年', title: '研議中' }], {}, {});
  assert.equal(out.count, 1);
  assert.equal(out.warnings.length, 1);
  assert.ok(words(out.svg).includes('114 年上半年'));
});

await t('時間軸：只填日期沒填事件時講一聲就跳過', () => {
  const out = timeline.build([{ date: '114/3', title: '' }], {}, {});
  assert.equal(out.count, 0);
  assert.match(out.warnings[0], /第 1 列/);
});

await t('時間軸：看得懂的日期照民國年排版', () => {
  const out = timeline.build([{ date: '2025-03-05', title: '甲' }], {}, {});
  assert.ok(words(out.svg).includes('114年3月'));
});

/* ── 分層堆疊圖 ────────────────────────────────────────────────────── */

const layers = G.byId('layers');

await t('分層圖：第一列畫在最上面', () => {
  const out = layers.build([{ name: '最上' }, { name: '中間' }, { name: '最下' }], {}, {});
  const ys = ['最上', '中間', '最下'].map((w) => out.svg.indexOf(w));
  assert.ok(ys[0] < ys[1] && ys[1] < ys[2], '順序不對');
});

await t('分層圖：上下的標示填了才出現', () => {
  const withLabel = layers.build([{ name: '甲' }], { topLabel: '前台', bottomLabel: '後台' }, {});
  assert.ok(words(withLabel.svg).includes('前台'));
  const without = layers.build([{ name: '甲' }], {}, {});
  assert.ok(!words(without.svg).includes('前台'));
});

/* ── 四象限 ────────────────────────────────────────────────────────── */

const quadrant = G.byId('quadrant');

await t('四象限：沒選分數就當 3，並且講一聲', () => {
  const out = quadrant.build([{ name: '甲' }], {}, {});
  assert.equal(out.count, 1);
  assert.equal(out.warnings.length, 2, out.warnings.join('／'));
  assert.match(out.warnings[0], /甲/);
});

await t('四象限：分數決定落點，高分在右上、低分在左下', () => {
  const svg = quadrant.build(
    [{ name: '高', x: '5', y: '5' }, { name: '低', x: '1', y: '1' }], {}, {}).svg;
  /* 每個項目都是「一個 circle 接著一個 text」，所以名字前面最後一個 circle 就是它 */
  const at = (name) => {
    const before = svg.slice(0, svg.indexOf('>' + name + '<'));
    const m = /<circle cx="([\d.]+)" cy="([\d.]+)"/g;
    let last = null, r;
    while ((r = m.exec(before))) last = r;
    return { x: +last[1], y: +last[2] };
  };
  const hi = at('高'), lo = at('低');
  assert.ok(hi.x > lo.x, '高分沒有畫在右邊');
  assert.ok(hi.y < lo.y, '高分沒有畫在上面');
});

await t('四象限：同一格的項目往下疊開，不會壓在同一點', () => {
  const svg = quadrant.build([
    { name: '甲', x: '3', y: '3' }, { name: '乙', x: '3', y: '3' }
  ], {}, {}).svg;
  const cys = (svg.match(/<circle cx="[\d.]+" cy="[\d.]+"/g) || []);
  assert.equal(new Set(cys).size, cys.length, '兩個項目畫在同一個位置');
});

await t('四象限：軸的名稱跟著使用者填的走', () => {
  const svg = quadrant.build([{ name: '甲', x: '3', y: '3' }],
    { xLabel: '急迫', yLabel: '重要' }, {}).svg;
  const text = words(svg);
  assert.ok(text.includes('急迫') && text.includes('重要'), text);
});

s.finish();
