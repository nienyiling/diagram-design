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
const DD = require(path.join(ROOT, 'app', 'core.js'));

const s = scoreboard('gen.unit');
const t = (name, fn) => s.t(name, fn);

/** 一張圖上看得到的字：把標籤剝掉就好，跨標籤的字串本來就不該當成一個詞。 */
const words = (svg) => svg.replace(/<[^>]*>/g, '\n');
const defMeta = (gen) =>
  (gen.meta || []).reduce((m, f) => {
    m[f.key] = f.type === 'select' ? f.options[0].value : (f.placeholder || '');
    return m;
  }, {});
const buildExample = (gen) => gen.build(gen.example, defMeta(gen), {});

/* ── 五種都要長得像同一種東西：規格是表單引擎照著長出畫面的依據 ────────── */

await t('TYPES 是九種，id 不重複', () => {
  assert.equal(G.TYPES.length, 9);
  assert.deepEqual(G.TYPES.map((g) => g.id),
    ['flow', 'swimlane', 'org', 'relation', 'genogram', 'gantt', 'timeline', 'layers', 'quadrant']);
});

await t('每一種都有畫面要用的規格：名稱、用途、列名、欄位、範例、示意範本', () => {
  G.TYPES.forEach((g) => {
    assert.ok(g.name && g.use && g.rowName, g.id + ' 少了名稱／用途／列名');
    assert.ok(Array.isArray(g.fields) && g.fields.length, g.id + ' 沒有欄位');
    assert.ok(Array.isArray(g.example) && g.example.length >= 3, g.id + ' 範例太短');
    assert.ok(Array.isArray(g.help) && g.help.length, g.id + ' 沒有說明');
    /* 示意範本是可選的：家系圖這種在上游那 153 張裡沒有對應的就不掛 */
    if (g.sample) assert.match(g.sample, /^example-/, g.id + ' 的示意範本 id 不對');
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
    /* 整張圖共用的設定只收文字與下拉——表單引擎那一段只畫得出這兩種 */
    (g.meta || []).forEach((f) =>
      assert.ok(f.type === 'text' || f.type === 'select', g.id + ' 的 meta 只收文字與下拉'));
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
    /* 家系圖的姓名預設不畫在圖上（個案資料），這一項要把它打開才問得準 */
    const meta = Object.assign(defMeta(g), g.id === 'genogram' ? { names: 'on' } : {});
    const text = words(g.build(g.example, meta, {}).svg);
    g.example.forEach((row) => {
      g.fields.forEach((f) => {
        if (f.type !== 'text') return;
        const v = String(row[f.key] || '').trim();
        /* 日期欄位圖上顯示的是民國年排版過的樣子，不是使用者原本打的字 */
        if (!v || G.parseTwDate(v)) return;
        /* 「/」是使用者自己決定的斷行點，圖上本來就會拆成兩行 */
        v.split('/').forEach((part) => {
          const want = part.trim();
          if (want) assert.ok(text.includes(want), g.id + ' 的圖上找不到「' + want + '」');
        });
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


/* ── 關係圖：公文與簡報裡那種「示意圖」 ─────────────────────────────── */

const rel = G.TYPES.find((g) => g.id === 'relation');
const B = (text, extra) => Object.assign({ kind: 'box', text, line: 'solid', fill: 'paper' }, extra || {});
const L = (from, to, extra) => Object.assign({ kind: 'link', from, to, style: 'solid', arrow: 'one' }, extra || {});
const relSvg = (rows, meta) => rel.build(rows, meta || {}, {}).svg;
/** 某個方塊的文字畫在哪個 y（方塊的排列順序看這個就夠了）。 */
const relY = (svg, name) => {
  const before = svg.slice(0, svg.indexOf('>' + name + '<'));
  const m = /<text x="[\d.]+" y="([\d.]+)"/g;
  let last = null, r;
  while ((r = m.exec(before))) last = r;
  return +last[1];
};

await t('關係圖：方塊的框線實線／虛線／無框畫出來不一樣', () => {
  const solid = relSvg([B('甲')]);
  const dashed = relSvg([B('甲', { line: 'dashed' })]);
  const none = relSvg([B('甲', { line: 'none' })]);
  assert.ok(!/<rect[^>]*rx="6"[^>]*stroke-dasharray/.test(solid), '實線不該是虛線');
  assert.ok(/<rect[^>]*stroke-dasharray="6 4"/.test(dashed), '虛線框沒畫成虛線');
  assert.ok(/<rect[^>]*stroke="none"/.test(none), '無框還畫了框線');
});

await t('關係圖：連線的實線／虛線、單向／雙向／不加箭頭都分得出來', () => {
  const one = relSvg([B('甲'), B('乙'), L('甲', '乙')]);
  const both = relSvg([B('甲'), B('乙'), L('甲', '乙', { arrow: 'both' })]);
  const none = relSvg([B('甲'), B('乙'), L('甲', '乙', { arrow: 'none' })]);
  const dashed = relSvg([B('甲'), B('乙'), L('甲', '乙', { style: 'dashed' })]);
  assert.ok(/<polyline[^>]*marker-end/.test(one), '單向沒有箭頭');
  assert.ok(!/<polyline[^>]*marker-start/.test(one), '單向不該有回頭的箭頭');
  assert.ok(/<polyline[^>]*marker-start/.test(both), '雙向少了一頭');
  assert.ok(!/<polyline[^>]*marker-(end|start)/.test(none), '說了不加箭頭還是加了');
  assert.ok(/<polyline[^>]*stroke-dasharray="6 4"/.test(dashed), '虛線的連線沒畫成虛線');
});

await t('關係圖：線上的字畫得出來，而且墊了底色不會被線劃掉', () => {
  const svg = relSvg([B('甲'), B('乙'), L('甲', '乙', { label: '體制內不衡平' })]);
  assert.ok(words(svg).includes('體制內不衡平'), '線上的字不見了');
  const at = svg.indexOf('體制內不衡平');
  assert.ok(svg.lastIndexOf('<polyline', at) < svg.lastIndexOf('<rect', at),
    '線上的字沒有墊底色（rect 要在字前面）');
});

await t('關係圖：文字太長會折行，打「/」就從那裡斷', () => {
  const svg = relSvg([B('純勞工/（適用勞基法）')]);
  const t2 = words(svg);
  assert.ok(t2.includes('純勞工') && t2.includes('（適用勞基法）'), t2);
  assert.ok(!t2.includes('純勞工/（適用勞基法）'), '「/」沒有當成斷行點');
  /* 四個方塊一列時每格才窄，長文字就非折不可 */
  const long = relSvg([B('這是一段很長很長很長很長很長很長很長很長很長的說明文字'),
    B('乙'), B('丙'), B('丁')], { cols: '4' });
  assert.ok((long.match(/<text/g) || []).length >= 5, '長文字沒有折行');
});

await t('關係圖：排滿一列就換下一列，勾「另起一列」可以提早換', () => {
  const flat = relSvg([B('甲'), B('乙'), B('丙')], { cols: '3' });
  assert.equal(relY(flat, '甲'), relY(flat, '丙'), '說了一列三個卻沒排在同一列');
  const wrapped = relSvg([B('甲'), B('乙'), B('丙', { br: true })], { cols: '3' });
  assert.ok(relY(wrapped, '丙') > relY(wrapped, '甲'), '勾了另起一列還是排在同一列');
  const two = relSvg([B('甲'), B('乙'), B('丙')], { cols: '2' });
  assert.ok(relY(two, '丙') > relY(two, '甲'), '一列兩個時第三個沒有換列');
});

await t('關係圖：橫式時由上而下排、欄由左而右，直式時剛好相反', () => {
  const x = (svg, name) => {
    const before = svg.slice(0, svg.indexOf('>' + name + '<'));
    const m = /<text x="([\d.]+)"/g;
    let last = null, r;
    while ((r = m.exec(before))) last = r;
    return +last[1];
  };
  const rows = [B('甲'), B('乙'), B('丙')];
  const down = relSvg(rows, { dir: 'down', cols: '1' });
  /* 直式、一列一個：三個疊成一直行，x 相同、y 遞增 */
  assert.equal(x(down, '甲'), x(down, '丙'), '直式一列一個卻沒有對齊在同一直行');
  assert.ok(relY(down, '丙') > relY(down, '甲'), '直式沒有往下排');
  const right = relSvg(rows, { dir: 'right', cols: '1' });
  /* 橫式、一欄一個：三個排成一橫排，y 相同、x 遞增 */
  assert.equal(relY(right, '甲'), relY(right, '丙'), '橫式一欄一個卻沒有對齊在同一橫排');
  assert.ok(x(right, '丙') > x(right, '甲'), '橫式沒有往右排');
});

await t('關係圖：橫式的每一欄垂直置中，短的那一欄不會吊在上面', () => {
  const svg = relSvg([B('甲'), B('乙'), B('丙', { br: true })], { dir: 'right', cols: '2' });
  /* 左欄兩個、右欄一個：右欄那一個要落在左欄兩個的中間高度 */
  const mid = (relY(svg, '甲') + relY(svg, '乙')) / 2;
  assert.ok(Math.abs(relY(svg, '丙') - mid) < 12,
    '右欄沒有垂直置中：' + relY(svg, '丙') + ' vs ' + mid);
});

await t('關係圖 → 畫板：座標沿用預覽算好的那一份，一個都不會跑掉', () => {
  const rows = [B('甲'), B('乙', { line: 'dashed' }), B('丙', { line: 'none', fill: 'accent' }),
    L('甲', '乙', { label: '協辦', style: 'dashed' })];
  const meta = { dir: 'down', cols: '3' };
  const board = G.relationBoard(rows, meta);
  assert.equal(board.shapes.length, 3);
  assert.equal(board.links.length, 1);
  /* 框線與底色要對得上畫板那五種形狀 */
  assert.deepEqual(board.shapes.map((s2) => s2.kind), ['step', 'note', 'label']);
  assert.deepEqual(board.shapes.map((s2) => s2.color), ['plain', 'plain', 'accent']);
  assert.equal(board.links[0].label, '協辦');
  assert.equal(board.links[0].dash, true);
  /* 座標要跟預覽的那張圖一模一樣——重算一次就會差幾個像素，看起來像搬過去圖跑掉了 */
  const svg = relSvg(rows, meta);
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)]
    .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
  board.shapes.forEach((s2, i) => {
    assert.deepEqual({ x: s2.x, y: s2.y, w: s2.w, h: s2.h }, rects[i], '第 ' + (i + 1) + ' 個方塊的座標對不上');
  });
});

await t('關係圖 → 畫板：連線指不到方塊時就不要留一條指不到東西的線', () => {
  const board = G.relationBoard([B('甲'), L('甲', '沒這個方塊')], {});
  assert.equal(board.shapes.length, 1);
  assert.deepEqual(board.links, []);
  assert.deepEqual(G.relationBoard([], {}), { shapes: [], links: [] });
});

await t('關係圖：「每列幾個」填了看不懂的字要講一聲，而且照樣畫得出來', () => {
  const out = rel.build([B('甲'), B('乙')], { dir: 'down', cols: '兩個' }, {});
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /兩個/);
  assert.match(out.warnings[0], /自動/);
  assert.ok(words(out.svg).includes('甲'), '有警告就不畫了，那使用者會以為壞掉');
});

await t('關係圖：連線指到不存在的方塊時講清楚是第幾條', () => {
  const out = rel.build([B('甲'), L('甲', '沒這個方塊')], {}, {});
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /沒這個方塊/);
  assert.match(out.warnings[0], /第 2 條/);
});

await t('關係圖：同名的方塊要講一聲（不然連線分不出是哪一個）', () => {
  const out = rel.build([B('甲'), B('甲')], {}, {});
  assert.equal(out.count, 1);
  assert.match(out.warnings[0], /兩次/);
});

await t('關係圖：同一列的兩個方塊之間有字時，欄距要讓得下那句話', () => {
  const boxOf = (svg) => {
    const m = /<rect x="(\d+)" y="\d+" width="(\d+)"/g;
    const out = [];
    let r;
    while ((r = m.exec(svg))) out.push({ x: +r[1], w: +r[2] });
    return out;
  };
  const plain = boxOf(relSvg([B('甲'), B('乙'), L('甲', '乙')], { cols: '2' }));
  const tagged = boxOf(relSvg([B('甲'), B('乙'), L('甲', '乙', { label: '這是一句很長的說明' })], { cols: '2' }));
  const gap = (b) => b[1].x - (b[0].x + b[0].w);
  assert.ok(gap(tagged) > gap(plain) + 40, '線上有字時欄距沒有讓開：' + gap(plain) + ' → ' + gap(tagged));
});

/* ── 家系圖 ────────────────────────────────────────────────────────
   社工用的 genogram。符號慣例是這一種圖的全部價值——畫錯符號等於畫錯意思，
   所以這一段測的是「慣例有沒有守住」，不是版面好不好看。 */

const geno = G.byId('genogram');
/* 版面相關的斷言要靠姓名定位，所以測試一律把姓名打開；
   「預設不顯示」本身另外有一項專測。 */
const genoSvg = (rows, meta) => geno.build(rows, Object.assign({ names: 'on' }, meta || {}), {}).svg;
const P = (name, extra) => Object.assign({ kind: 'person', name, sex: 'm' }, extra || {});
/** 圖例本身也會畫一次符號與關係線，數東西時要先把它切掉，不然會多算一份。 */
const genoBody = (svg) => svg.slice(0, svg.indexOf('>圖例<') >= 0 ? svg.lastIndexOf('<line', svg.indexOf('>圖例<')) : svg.length);
/** 某個人的符號中心 x：名字是畫在 cx 上的，取它前面最後一個 <text 的 x。 */
const genoCx = (svg, name) => {
  const re = /<text x="([\d.]+)"/g;
  let last = null, r;
  const before = svg.slice(0, svg.indexOf('>' + name + '<'));
  while ((r = re.exec(before))) last = r;
  return +last[1];
};

await t('家系圖：男是方形、女是圓形、性別不明是菱形', () => {
  assert.ok(/<rect[^>]*width="46"/.test(genoSvg([P('甲', { sex: 'm' })])), '男不是方形');
  assert.ok(/<circle[^>]*r="23"/.test(genoSvg([P('乙', { sex: 'f' })])), '女不是圓形');
  assert.ok(/<polygon/.test(genoSvg([P('丙', { sex: 'u' })])), '性別不明不是菱形');
});

await t('家系圖：案主填深色加雙框（社工實務上就是這樣標，一眼看得到）', () => {
  const plain = genoBody(genoSvg([P('甲')]));
  const idx = genoBody(genoSvg([P('甲', { index: true })]));
  const accent = (svg) => (svg.match(new RegExp('<rect[^>]*stroke="' +
    DD.UPSTREAM_LIGHT.accent + '"', 'g')) || []).length;
  assert.equal(accent(plain), 0, '沒標案主卻用了強調色');
  assert.equal(accent(idx), 1, '案主的外框沒有用強調色');
  /* 外框填深色、裡面再一圈紙色的內框 */
  assert.ok(new RegExp('<rect[^>]*fill="' + DD.UPSTREAM_LIGHT.ink + '"[^>]*stroke="' +
    DD.UPSTREAM_LIGHT.accent + '"').test(idx), '案主沒有填深色');
  assert.ok(new RegExp('<rect[^>]*stroke="' + DD.UPSTREAM_LIGHT.paper + '"').test(idx),
    '深色底上少了看得見的內框');
  assert.ok(!new RegExp('<rect[^>]*fill="' + DD.UPSTREAM_LIGHT.ink + '"').test(plain),
    '沒標案主的人不該被填深色');
});

await t('家系圖：案主身上的字與叉要改成紙色，不然深色底上看不見', () => {
  const svg = genoBody(genoSvg([P('甲', { index: true, age: '16', dead: true })]));
  const paper = DD.UPSTREAM_LIGHT.paper;
  assert.ok(new RegExp('<text[^>]*fill="' + paper + '"[^>]*>16<').test(svg), '年齡看不見');
  assert.equal((svg.match(new RegExp('<line[^>]*stroke="' + paper + '"', 'g')) || []).length, 2,
    '已歿的叉沒有改成紙色');
});

await t('家系圖：姓名／稱謂預設不畫在圖上，改了設定才畫', () => {
  const rows = [P('陳小華', { age: '16' })];
  const off = geno.build(rows, {}, {}).svg;
  const on = geno.build(rows, { names: 'on' }, {}).svg;
  assert.ok(!words(off).includes('陳小華'), '預設就把個案的姓名畫上去了');
  assert.ok(words(off).includes('16'), '年齡不該跟著不見');
  assert.ok(words(on).includes('陳小華'), '設定改成顯示卻還是不畫');
});

await t('家系圖：學歷是選填的，填了才畫、亂填當成不填', () => {
  assert.ok(words(genoSvg([P('甲', { edu: '高中職' })])).includes('高中職'), '學歷沒畫出來');
  assert.ok(!words(genoSvg([P('甲')])).includes('高中職'));
  /* 上一版的設定檔可能存著別的字，照規格驗過就好，不要把它畫上去 */
  const odd = words(genoSvg([P('甲', { edu: '博士後研究' })]));
  assert.ok(!odd.includes('博士後研究'), '不在選項裡的學歷不該畫上去');
});

await t('家系圖：學歷排在姓名底下、註記上面', () => {
  const y = (svg, str) => {
    const before = svg.slice(0, svg.indexOf('>' + str + '<'));
    const m = /<text x="[\d.]+" y="([\d.]+)"/g;
    let last = null, r;
    while ((r = m.exec(before))) last = r;
    return +last[1];
  };
  const svg = genoSvg([P('甲', { edu: '大學', note: '獨居' })]);
  assert.ok(y(svg, '大學') > y(svg, '甲'), '學歷沒排在姓名底下');
  assert.ok(y(svg, '獨居') > y(svg, '大學'), '註記沒排在學歷底下');
});

await t('家系圖：已歿在符號上打一個叉', () => {
  const svg = genoBody(genoSvg([P('甲', { dead: true })]));
  const box = /<rect x="([\d.]+)" y="([\d.]+)" width="46" height="46"/.exec(svg);
  assert.ok(box, '找不到成員的符號');
  const x = +box[1], y = +box[2];
  const inside = (svg.match(/<line[^>]*>/g) || []).filter((l) => {
    const m = /x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/.exec(l);
    if (!m) return false;
    return m.slice(1).every((v, i) => +v >= (i % 2 ? y : x) - 1 && +v <= (i % 2 ? y : x) + 47);
  });
  assert.equal(inside.length, 2, '已歿沒有在符號上打叉（要兩條交叉線）');
});

await t('家系圖：一張圖標兩個案主要講一聲（慣例是只標一個）', () => {
  const out = geno.build([P('甲', { index: true }), P('乙', { index: true })], {}, {});
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /案主/);
});

await t('家系圖：世代由父母算出來，子女排在下一排', () => {
  const rows = [
    P('阿公'), P('阿嬤', { sex: 'f' }),
    P('爸爸', { father: '阿公', mother: '阿嬤' }),
    P('孫子', { father: '爸爸' })
  ];
  const svg = genoSvg(rows);
  const y = (name) => {
    const i = svg.indexOf('>' + name + '<');
    const m = /<text x="[\d.]+" y="([\d.]+)"/g;
    let last = null, r;
    const before = svg.slice(0, i);
    while ((r = m.exec(before))) last = r;
    return +last[1];
  };
  assert.ok(y('爸爸') > y('阿公'), '子女沒有排在父母下一排');
  assert.ok(y('孫子') > y('爸爸'), '第三代沒有排在第二代下面');
});

await t('家系圖：伴侶男左女右（慣例）', () => {
  const svg = genoSvg([P('太太', { sex: 'f' }), P('先生', { sex: 'm' }),
    { kind: 'union', a: '太太', b: '先生', union: 'married' }]);
  const cx = (name) => {
    const before = svg.slice(0, svg.indexOf('>' + name + '<'));
    const m = /<text x="([\d.]+)"/g;
    let last = null, r;
    while ((r = m.exec(before))) last = r;
    return +last[1];
  };
  assert.ok(cx('先生') < cx('太太'), '男沒有排在左邊');
});

await t('家系圖：再婚時結過兩次的那一位排中間（前任在左、現任在右）', () => {
  /* 照填的順序一路往右排的話，「父與繼母」那條線會從「前妻」頭上跨過去，
     看起來像前妻也在那段婚姻裡——再婚的家系圖最常畫錯的就是這裡。 */
  const svg = genoSvg([
    P('父'), P('前妻', { sex: 'f' }), P('繼母', { sex: 'f' }),
    { kind: 'union', a: '父', b: '前妻', union: 'divorced', year: '108' },
    { kind: 'union', a: '父', b: '繼母', union: 'married', year: '110' }
  ]);
  assert.ok(genoCx(svg, '前妻') < genoCx(svg, '父'), '前任沒有排在左邊');
  assert.ok(genoCx(svg, '父') < genoCx(svg, '繼母'), '現任沒有排在右邊');
  /* 兩段都跟隔壁相鄰，就不必繞路 */
  assert.ok(!new RegExp('<polyline[^>]*stroke="' + DD.UPSTREAM_LIGHT.ink + '"').test(genoBody(svg)),
    '兩段婚姻各自相鄰，不該還要繞路');
});

await t('家系圖：中間卡著人的婚姻線要繞到上面走，不從別人的符號正中間穿過', () => {
  const out = geno.build([
    P('父'), P('第一任', { sex: 'f' }), P('第二任', { sex: 'f' }), P('第三任', { sex: 'f' }),
    { kind: 'union', a: '父', b: '第一任', union: 'divorced' },
    { kind: 'union', a: '父', b: '第二任', union: 'divorced' },
    { kind: 'union', a: '父', b: '第三任', union: 'married' },
    P('么女', { sex: 'f', father: '父', mother: '第三任' })
  ], {}, {});
  assert.deepEqual(out.warnings, []);
  const body = genoBody(out.svg);
  const m = new RegExp('<polyline points="([^"]+)"[^>]*stroke="' + DD.UPSTREAM_LIGHT.ink + '"').exec(body);
  assert.ok(m, '三段婚姻沒有一條繞路的線');
  /* 繞過去的那一段要高過符號本身，不然還是從人身上穿過去 */
  const top = +/<rect x="[\d.]+" y="([\d.]+)"[^>]*width="46"/.exec(body)[1];
  const ys = m[1].trim().split(/\s+/).map((pt) => +pt.split(',')[1]);
  assert.ok(Math.min(...ys) < top, '繞路的線沒有走到符號上面：' + m[1]);
});

await t('家系圖：分居畫一撇、離婚畫兩撇（這是最要緊的一個資訊）', () => {
  const marks = (status) => {
    const svg = genoSvg([P('甲'), P('乙', { sex: 'f' }),
      { kind: 'union', a: '甲', b: '乙', union: status }]);
    return (svg.match(/<line/g) || []).length;
  };
  const base = marks('married');
  assert.equal(marks('separated') - base, 1, '分居不是一撇');
  assert.equal(marks('divorced') - base, 2, '離婚不是兩撇');
});

await t('家系圖：同性伴侶照樣畫得出來，順序照填的（沒有男左女右可套）', () => {
  const svg = genoSvg([P('甲', { sex: 'm' }), P('乙', { sex: 'm' }),
    { kind: 'union', a: '甲', b: '乙', union: 'married', year: '108' },
    { kind: 'bond', ba: '甲', bb: '乙', bond: 'close' }]);
  assert.ok(genoCx(svg, '甲') < genoCx(svg, '乙'), '同性伴侶被重排了，應該照填的順序');
  assert.ok(words(svg).includes('結婚 108'), '同性伴侶的婚姻狀態沒有標出來');
  assert.ok(svg.includes('<polyline'), '同性伴侶的情感關係沒有畫出來');
  /* 女女也一樣 */
  const ff = genoSvg([P('丙', { sex: 'f' }), P('丁', { sex: 'f' }),
    { kind: 'union', a: '丙', b: '丁', union: 'cohabit' }]);
  assert.ok(genoCx(ff, '丙') < genoCx(ff, '丁'), '女女伴侶被重排了');
});

await t('家系圖：同居畫虛線，結婚畫實線', () => {
  const co = genoSvg([P('甲'), P('乙', { sex: 'f' }),
    { kind: 'union', a: '甲', b: '乙', union: 'cohabit' }]);
  const mar = genoSvg([P('甲'), P('乙', { sex: 'f' }),
    { kind: 'union', a: '甲', b: '乙', union: 'married' }]);
  assert.ok(co.includes('stroke-dasharray'), '同居不是虛線');
  assert.ok(!mar.includes('stroke-dasharray'), '結婚不該是虛線');
});

await t('家系圖：婚姻狀態與年份標在線上', () => {
  const svg = genoSvg([P('甲'), P('乙', { sex: 'f' }),
    { kind: 'union', a: '甲', b: '乙', union: 'married', year: '85' }]);
  assert.ok(words(svg).includes('結婚 85'), words(svg));
});

await t('家系圖：收養畫虛線、寄養畫點線、親生畫實線', () => {
  const kid = (type) => genoSvg([P('爸'), P('媽', { sex: 'f' }),
    P('孩', { father: '爸', mother: '媽', childType: type })]);
  assert.ok(!kid('bio').includes('stroke-dasharray'), '親生不該是虛線');
  assert.ok(/stroke-dasharray="6 4"/.test(kid('adopt')), '收養不是虛線');
  assert.ok(/stroke-dasharray="2 3"/.test(kid('foster')), '寄養不是點線');
});

await t('家系圖：有共同子女但沒填伴侶關係時，照樣畫一條線（不然子女憑空垂下來）', () => {
  const out = geno.build([P('爸'), P('媽', { sex: 'f' }), P('孩', { father: '爸', mother: '媽' })], {}, {});
  assert.deepEqual(out.warnings, []);
  /* 那條線是隱含的，不該標「結婚」兩個字 */
  assert.ok(!words(out.svg).includes('結婚'), '隱含的伴侶線不該標成結婚');
  assert.ok((out.svg.match(/<line/g) || []).length >= 3, '子女線畫得太少');
});

await t('家系圖：情感關係走弧線，跟結構線分得開', () => {
  const svg = genoSvg([P('甲'), P('乙', { sex: 'f' }),
    { kind: 'bond', ba: '甲', bb: '乙', bond: 'close' }]);
  assert.ok(svg.includes('<polyline'), '情感關係不是弧線');
  assert.ok(svg.includes(DD.UPSTREAM_LIGHT.accent), '情感關係沒有用強調色');
});

await t('家系圖：六種情感關係畫出來的樣子都不一樣', () => {
  const seen = {};
  ['close', 'fused', 'distant', 'conflict', 'cutoff', 'abuse'].forEach((type) => {
    const svg = genoSvg([P('甲'), P('乙', { sex: 'f' }),
      { kind: 'bond', ba: '甲', bb: '乙', bond: type }]);
    const body = genoBody(svg);
    const shape = body.slice(body.indexOf('<polyline'));
    assert.ok(!seen[shape], type + ' 跟別的情感關係畫得一模一樣');
    seen[shape] = type;
  });
  /* 親近兩條、非常親近三條（圖例那一份要先切掉，不然會多算） */
  const count = (type) => (genoBody(genoSvg([P('甲'), P('乙', { sex: 'f' }),
    { kind: 'bond', ba: '甲', bb: '乙', bond: type }])).match(/<polyline/g) || []).length;
  assert.equal(count('close'), 2, '親近不是雙線');
  assert.equal(count('fused'), 3, '非常親近不是三線');
});

await t('家系圖：父母指不到前面的人時講清楚，不會繞成圈', () => {
  const out = geno.build([P('孩', { father: '還沒填的爸' }), P('還沒填的爸')], {}, {});
  assert.equal(out.count, 2);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /孩/);
  assert.match(out.warnings[0], /不在它前面/);
});

await t('家系圖：父母填成同一個人時，忽略母親並講一聲', () => {
  const out = geno.build([P('爸'), P('孩', { father: '爸', mother: '爸' })], {}, {});
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /同一個人/);
});

await t('家系圖：同名的成員要講一聲（不然父母欄分不出是哪一個）', () => {
  const out = geno.build([P('陳志明'), P('陳志明')], {}, {});
  assert.equal(out.count, 1);
  assert.match(out.warnings[0], /兩次/);
});

await t('家系圖：伴侶或情感關係指到不存在的人時講清楚', () => {
  const u = geno.build([P('甲'), { kind: 'union', a: '甲', b: '沒這個人', union: 'married' }], {}, {});
  assert.equal(u.warnings.length, 1);
  assert.match(u.warnings[0], /沒這個人/);
  const b = geno.build([P('甲'), { kind: 'bond', ba: '甲', bb: '沒這個人', bond: 'close' }], {}, {});
  assert.equal(b.warnings.length, 1);
  assert.match(b.warnings[0], /沒這個人/);
});

await t('家系圖：嫁進來、娶進來的那一位跟配偶排同一排', () => {
  const rows = [
    P('阿公'), P('阿嬤', { sex: 'f' }),
    P('兒子', { father: '阿公', mother: '阿嬤' }),
    P('媳婦', { sex: 'f' }),
    { kind: 'union', a: '兒子', b: '媳婦', union: 'married' }
  ];
  const svg = genoSvg(rows);
  const y = (name) => {
    const before = svg.slice(0, svg.indexOf('>' + name + '<'));
    const m = /<text x="[\d.]+" y="([\d.]+)"/g;
    let last = null, r;
    while ((r = m.exec(before))) last = r;
    return +last[1];
  };
  assert.equal(y('媳婦'), y('兒子'), '媳婦沒有跟兒子排同一排');
  assert.ok(y('兒子') > y('阿公'), '第二代沒有排在第一代下面');
});

await t('家系圖：人多時整張縮小，不會畫到框外', () => {
  const rows = [];
  for (let i = 0; i < 14; i++) rows.push(P('成員' + i));
  const out = geno.build(rows, {}, {});
  assert.equal(out.count, 14);
  assert.ok(out.warnings.some((w) => /縮小/.test(w)), out.warnings.join('／'));
  const xs = [];
  const m = /<(?:rect|circle)[^>]*?(?:x|cx)="([\d.]+)"/g;
  let r;
  while ((r = m.exec(out.svg))) xs.push(+r[1]);
  assert.ok(Math.min.apply(null, xs) >= 0, '有符號畫到左邊界外');
  assert.ok(Math.max.apply(null, xs) <= 1000, '有符號畫到右邊界外');
});

await t('家系圖：圖例只列這張圖真的用到的符號', () => {
  const plain = words(genoSvg([P('甲'), P('乙', { sex: 'f' })]));
  assert.ok(plain.includes('男') && plain.includes('女'));
  assert.ok(!plain.includes('已歿'), '沒有人過世卻列了「已歿」');
  assert.ok(!plain.includes('案主'), '沒有標案主卻列了「案主」');
  const rich = words(genoSvg([P('甲', { index: true, dead: true }), P('乙', { sex: 'u' })]));
  ['案主', '已歿', '性別不明'].forEach((w) => assert.ok(rich.includes(w), '圖例少了「' + w + '」'));
});

await t('家系圖：範例是一個看得懂的保護性個案（三代、有案主、有衝突與斷絕）', () => {
  const out = geno.build(geno.example, { names: 'on' }, {});
  assert.deepEqual(out.warnings, []);
  const text = words(out.svg);
  ['祖父', '祖母', '父', '母', '案主', '弟', '姑姑']
    .forEach((n) => assert.ok(text.includes(n), '範例裡少了「' + n + '」'));
  assert.ok(text.includes('分居 85'), '沒有標出分居');
  assert.ok(text.includes('衝突') && text.includes('斷絕往來'), '圖例少了情感關係');
});

s.finish();
