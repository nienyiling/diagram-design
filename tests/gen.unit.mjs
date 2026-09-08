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
  assert.equal(G.TYPES.length, 7);
  assert.deepEqual(G.TYPES.map((g) => g.id),
    ['flow', 'swimlane', 'org', 'gantt', 'timeline', 'layers', 'quadrant']);
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

await t('流程圖：判斷底下的「分支步驟」畫在右邊，分支標籤標在線上', () => {
  const out = flow.build([
    { kind: 'decision', main: '是否本科權責？', branchLabel: '否', branchEnds: true },
    { kind: 'branch', main: '移文他科', sub: '副知來文機關' }
  ], {}, {});
  const text = words(out.svg);
  assert.deepEqual(out.warnings, []);
  assert.ok(text.includes('移文他科'), text);
  assert.ok(text.includes('副知來文機關'), text);
  assert.ok(text.includes('否'), text);
});

await t('流程圖：分支可以連走好幾步，走完匯回主線', () => {
  const out = flow.build([
    { kind: 'decision', main: '資料齊全？', branchLabel: '否' },
    { kind: 'branch', main: '通知補件' },
    { kind: 'branch', main: '等待補件' },
    { kind: 'step', main: '實質審查' }
  ], {}, {});
  assert.deepEqual(out.warnings, []);
  assert.equal(out.count, 4);
  assert.ok(out.svg.includes('r="2.6"'), '沒有畫匯回主線的匯流點');
});

await t('流程圖：分支步驟上面不是判斷時，講一聲並當成一般步驟', () => {
  const out = flow.build([
    { kind: 'step', main: '甲' }, { kind: 'branch', main: '乙' }
  ], {}, {});
  assert.equal(out.count, 2);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /第 2 列/);
  assert.match(out.warnings[0], /乙/);
});

await t('流程圖：分支後面沒有主線可以匯回時，講得出兩條路怎麼走', () => {
  const out = flow.build([
    { kind: 'decision', main: '要不要？' }, { kind: 'branch', main: '不要' }
  ], {}, {});
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /不回主線/);
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

await t('流程圖：往下那條線的字沒填時，自動標成往右那條的相反詞', () => {
  const out = flow.build([
    { kind: 'decision', main: '要修正嗎？', branchLabel: '否', branchEnds: true },
    { kind: 'branch', main: '退件' },
    { kind: 'step', main: '繼續辦' }
  ], {}, {});
  assert.deepEqual(out.warnings, []);
  const text = words(out.svg);
  assert.ok(text.includes('否'), text);
  assert.ok(text.includes('是'), '沒有自動標成相反的：' + text);
});

await t('流程圖：三條線的字各自有欄位，填了就照填的', () => {
  const out = flow.build([
    { kind: 'step', main: '擬稿' },
    { kind: 'decision', main: '要修正嗎？', branchLabel: '甲', downLabel: '乙',
      loopTo: '擬稿', loopLabel: '丙', branchEnds: true },
    { kind: 'branch', main: '退件' },
    { kind: 'step', main: '決行' }
  ], {}, {});
  assert.deepEqual(out.warnings, []);
  const text = words(out.svg);
  ['甲', '乙', '丙'].forEach((w) => assert.ok(text.includes(w), '線上少了「' + w + '」：' + text));
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


/* ── 泳道圖 ────────────────────────────────────────────────────────── */

const swim = G.byId('swimlane');

await t('泳道圖：泳道的順序＝各單位第一次出現的順序', () => {
  const svg = swim.build([
    { lane: '乙科', main: '甲步驟' },
    { lane: '甲科', main: '乙步驟' },
    { lane: '乙科', main: '丙步驟' }
  ], {}, {}).svg;
  assert.ok(svg.indexOf('乙科') < svg.indexOf('甲科'), '泳道順序不對');
  /* 同一個單位不會開兩條泳道 */
  assert.equal((words(svg).match(/乙科/g) || []).length, 1);
});

await t('泳道圖：換單位那條線用強調色（那條線就是交接）', () => {
  const same = swim.build([{ lane: '甲', main: 'a' }, { lane: '甲', main: 'b' }], {}, {}).svg;
  const cross = swim.build([{ lane: '甲', main: 'a' }, { lane: '乙', main: 'b' }], {}, {}).svg;
  /* defs 裡本來就有這個 marker，要問「有沒有被用到」而不是「存不存在」 */
  const used = (svg) => svg.includes('marker-end="url(#ddg-arrow-accent)"');
  assert.ok(!used(same), '同單位不該用強調色');
  assert.ok(used(cross), '換單位沒有用強調色');
});

await t('泳道圖：沒填單位時放第一條泳道，並且講一聲', () => {
  const out = swim.build([{ lane: '甲科', main: 'a' }, { lane: '', main: 'b' }], {}, {});
  assert.equal(out.count, 2);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /b/);
});

await t('泳道圖：步驟編號從 1 開始，看得出先後', () => {
  const svg = swim.build([{ lane: '甲', main: 'a' }, { lane: '甲', main: 'b' }], {}, {}).svg;
  const text = words(svg);
  assert.ok(text.includes('1') && text.includes('2'));
});

/* ── 組織圖 ────────────────────────────────────────────────────────── */

const org = G.byId('org');

await t('組織圖：沒填上級的就是最上層', () => {
  const out = org.build([{ name: '本處' }, { name: '甲科', parent: '本處' }], {}, {});
  assert.equal(out.count, 2);
  assert.deepEqual(out.warnings, []);
});

await t('組織圖：父節點置中在自己的子節點上方', () => {
  const svg = org.build([
    { name: '頭' }, { name: '左', parent: '頭' }, { name: '右', parent: '頭' }
  ], {}, {}).svg;
  const at = (name) => {
    const before = svg.slice(0, svg.indexOf('>' + name + '<'));
    const m = /<rect x="([\d.]+)"[^>]*width="([\d.]+)"/g;
    let last = null, r;
    while ((r = m.exec(before))) last = r;
    return +last[1] + +last[2] / 2;
  };
  assert.ok(Math.abs(at('頭') - (at('左') + at('右')) / 2) < 1.5, '父節點沒有置中');
  assert.ok(at('左') < at('右'), '子節點沒有由左而右');
});

await t('組織圖：上級指到後面（會繞成圈）時講清楚，不會當掉', () => {
  const out = org.build([
    { name: '甲', parent: '乙' }, { name: '乙' }
  ], {}, {});
  assert.equal(out.count, 2);
  assert.match(out.warnings[0], /甲/);
  assert.match(out.warnings[0], /不在它前面/);
  /* 補一句「有幾個沒有上級」是對的：兩個都變成最上層，使用者要知道 */
  assert.ok(out.warnings.length <= 2, out.warnings.join('／'));
});

await t('組織圖：上級指到自己也不會當掉', () => {
  const out = org.build([{ name: '甲', parent: '甲' }], {}, {});
  assert.equal(out.count, 1);
  assert.equal(out.warnings.length, 1);
});

await t('組織圖：同名的單位要講一聲（不然「上級」分不出是哪一個）', () => {
  const out = org.build([{ name: '甲' }, { name: '甲' }], {}, {});
  assert.equal(out.count, 1);
  assert.match(out.warnings[0], /兩次/);
});

await t('組織圖：單位很多時整張縮小，不會畫到框外', () => {
  const rows = [{ name: '頭' }];
  for (let i = 0; i < 14; i++) rows.push({ name: '單位' + i, parent: '頭' });
  const out = org.build(rows, {}, {});
  assert.equal(out.count, 15);
  assert.ok(out.warnings.some((w) => /縮小/.test(w)), out.warnings.join('／'));
  const xs = [];
  const m = /<rect x="([\d.]+)"[^>]*width="([\d.]+)"/g;
  let r;
  while ((r = m.exec(out.svg))) xs.push(+r[1], +r[1] + +r[2]);
  assert.ok(Math.min.apply(null, xs) >= 0, '有方塊畫到左邊界外');
  assert.ok(Math.max.apply(null, xs) <= 1000, '有方塊畫到右邊界外');
});

/* ── 從 Excel 貼一整塊 ────────────────────────────────────────────── */

await t('parsePasteRows：一行一列、一個 Tab 一欄', () => {
  const res = G.parsePasteRows(G.byId('gantt'), '甲\t114/3/1\t114/3/5\t階段一\n乙\t114/4/1\t114/4/9\t階段二');
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].name, '甲');
  assert.equal(res.rows[0].start, '114/3/1');
  assert.equal(res.rows[1].phase, '階段二');
  assert.deepEqual(res.warnings, []);
});

await t('parsePasteRows：勾選欄吃「是／Y／1／V／✓」這幾種寫法', () => {
  const g = G.byId('gantt');
  ['是', 'Y', 'y', '1', 'V', '✓', 'true'].forEach((v) => {
    assert.equal(G.parsePasteRows(g, '甲\t114/3/1\t114/3/5\t\t' + v).rows[0].milestone, true, v);
  });
  ['', '否', '0', 'N'].forEach((v) => {
    assert.equal(G.parsePasteRows(g, '甲\t114/3/1\t114/3/5\t\t' + v).rows[0].milestone, false, v);
  });
});

await t('parsePasteRows：下拉欄位吃的是中文標籤，不是內部代號', () => {
  const res = G.parsePasteRows(G.byId('flow'), '判斷\t要不要？\n步驟\t做事');
  assert.equal(res.rows[0].kind, 'decision');
  assert.equal(res.rows[1].kind, 'step');
});

await t('parsePasteRows：看不懂的下拉值退回第一個選項，不會生出壞掉的列', () => {
  const res = G.parsePasteRows(G.byId('flow'), '亂打的\t甲');
  assert.equal(res.rows[0].kind, 'step');
});

await t('parsePasteRows：欄位比需要的多時講一聲，並且說出欄位順序', () => {
  const res = G.parsePasteRows(G.byId('layers'), '甲\t乙\t丙\t丁\t戊');
  assert.equal(res.rows.length, 1);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /層名/);
});

await t('parsePasteRows：只有一欄時就填第一個欄位', () => {
  const res = G.parsePasteRows(G.byId('layers'), '甲\n乙\n丙');
  assert.equal(res.rows.length, 3);
  assert.equal(res.rows[2].name, '丙');
});

await t('parsePasteRows：空白行跳過，全空時講得出下一步', () => {
  const res = G.parsePasteRows(G.byId('layers'), '甲\n\n   \n乙\n');
  assert.equal(res.rows.length, 2);
  const empty = G.parsePasteRows(G.byId('layers'), '   \n');
  assert.equal(empty.rows.length, 0);
  assert.match(empty.warnings[0], /Excel/);
});

/* ── 設定檔：下個月改一下日期再送一次 ─────────────────────────────── */

await t('設定檔：存出再讀回來，內容一模一樣', () => {
  const g = G.byId('gantt');
  const json = G.buildGenProject({ type: 'gantt', typeName: '甘特圖', title: '期程', eyebrow: '甘特圖', rows: g.example, meta: {} });
  const back = G.parseGenProject(json);
  assert.equal(back.type, 'gantt');
  assert.equal(back.title, '期程');
  assert.equal(back.rows.length, g.example.length);
  assert.equal(back.rows[0].name, g.example[0].name);
  assert.equal(back.rows[3].milestone, true);
});

await t('設定檔：帶著來源標註（授權要求）', () => {
  const json = G.buildGenProject({ type: 'layers', rows: [{ name: '甲' }], meta: {} });
  assert.match(JSON.parse(json).source, /cathrynlavery\/diagram-design/);
});

await t('設定檔：壞掉的檔案每一種都講人話', () => {
  const bad = [
    ['不是 JSON', '{{{'],
    ['不是本站的', '{"format":"別的"}'],
    ['是範本改字用的', '{"format":"gongwu-diagram","version":1,"diagram":"x"}'],
    ['版本太新', '{"format":"gongwu-diagram","kind":"generator","version":99}'],
    ['圖表種類不存在', '{"format":"gongwu-diagram","kind":"generator","version":1,"type":"沒這種"}'],
    ['一列都沒有', '{"format":"gongwu-diagram","kind":"generator","version":1,"type":"gantt","rows":[]}']
  ];
  bad.forEach(([why, text]) => {
    let msg = '';
    try { G.parseGenProject(text); } catch (e) { msg = e.message; }
    assert.ok(msg, why + ' 應該要擋下來');
    assert.ok(!/JSON\.parse|undefined|Unexpected token/.test(msg), why + ' 的訊息不是人話：' + msg);
    assert.ok(/。$/.test(msg), why + ' 的訊息沒有講完：' + msg);
  });
});

await t('設定檔：多餘的欄位丟掉、缺的欄位補空白（這是使用者給的輸入）', () => {
  const json = JSON.stringify({
    format: 'gongwu-diagram', kind: 'generator', version: 1, type: 'layers',
    rows: [{ name: '甲', 亂加的: 'x' }, { focal: 'yes' }],
    meta: { topLabel: '上', 亂加的: 'y' }
  });
  const back = G.parseGenProject(json);
  assert.equal(back.rows.length, 2);
  assert.equal(back.rows[0]['亂加的'], undefined);
  assert.equal(back.rows[1].name, '');
  assert.equal(back.rows[1].focal, true);
  assert.equal(back.meta.topLabel, '上');
  assert.equal(back.meta['亂加的'], undefined);
});

await t('設定檔：讀回來的內容真的畫得出圖', () => {
  const g = G.byId('quadrant');
  const json = G.buildGenProject({ type: 'quadrant', rows: g.example, meta: { xLabel: '投入', yLabel: '影響' } });
  const back = G.parseGenProject(json);
  const out = back.gen.build(back.rows, back.meta, {});
  assert.equal(out.count, g.example.length);
  assert.deepEqual(out.warnings, []);
});

s.finish();
