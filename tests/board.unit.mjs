/*
 * board.unit.mjs — 自由畫板的純函式測試。直接 require 站上那份 app/board.js，不做副本。
 *
 * 這一層最要緊的是「連線黏在形狀上」：連線記的是 id，座標每次重畫現算。
 * 記座標的話使用者一拖動就會出現一堆飄在半空的箭頭，而且不會報錯。
 * 所以這裡測的是「移動形狀之後，線的端點有沒有跟著跑」。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { scoreboard } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const B = require(path.join(ROOT, 'app', 'board.js'));
const DD = require(path.join(ROOT, 'app', 'core.js'));
const G = require(path.join(ROOT, 'app', 'gen.js'));

const s = scoreboard('board.unit');
const t = (name, fn) => s.t(name, fn);

const words = (svg) => svg.replace(/<[^>]*>/g, '\n');
const shape = (o) => B.normShape(o, 0);
const boardOf = (shapes, links) => B.normBoard({ shapes, links });

/* ── 規格：畫面上的工具列與下拉是照這個長出來的 ─────────────────────── */

await t('形狀與顏色的清單都有 id、名稱與預設尺寸', () => {
  assert.ok(B.KINDS.length >= 4);
  B.KINDS.forEach((k) => {
    assert.ok(k.id && k.name && k.hint, JSON.stringify(k));
    assert.ok(k.w >= 60 && k.h >= 28, k.id + ' 的預設尺寸太小');
  });
  assert.ok(B.COLORS.length >= 3);
  B.COLORS.forEach((c) => assert.ok(c.id && c.name && c.fill && c.stroke && c.text, JSON.stringify(c)));
});

await t('認不得的形狀與顏色退回第一個，不會生出壞掉的東西', () => {
  assert.equal(B.kindById('沒這種').id, B.KINDS[0].id);
  assert.equal(B.colorById(undefined).id, B.COLORS[0].id);
  assert.equal(shape({ kind: '亂打的', color: '亂打的' }).kind, B.KINDS[0].id);
});

/* ── 形狀：這是信任邊界，設定檔是使用者給的輸入 ──────────────────────── */

await t('normShape：只驗證與夾範圍，不對格線（對格線是拖曳那一刻的事）', () => {
  const a = shape({ x: 37, y: 44, w: 183, h: 61 });
  assert.equal(a.x, 37, '讀資料時把座標對到格線，會把排好的位置推歪');
  assert.equal(a.y, 44);
  assert.equal(a.w, 183);
  assert.equal(B.snap(37), 40, 'snap() 本身要會對格線');
  const tiny = shape({ w: 1, h: 1 });
  assert.ok(tiny.w >= 60 && tiny.h >= 28, '沒有擋住最小尺寸');
  const far = shape({ x: 99999, w: 200 });
  assert.ok(far.x + far.w <= B.W, '形狀畫到右邊界外');
  assert.ok(shape({ x: -500 }).x >= 0, '形狀畫到左邊界外');
  assert.ok(shape({ y: -500 }).y >= 0, '形狀畫到上邊界外');
});

await t('normShape：壞掉的數字不會變成 NaN', () => {
  const a = shape({ x: 'abc', y: null, w: undefined, h: NaN, size: 'x' });
  [a.x, a.y, a.w, a.h, a.size].forEach((v) => assert.ok(isFinite(v), JSON.stringify(a)));
});

await t('normShape：字級擋在看得清楚的範圍內', () => {
  assert.equal(shape({ size: 999 }).size, 28);
  assert.equal(shape({ size: 1 }).size, 9);
});

await t('normBoard：指不到形狀的線會被丟掉（不然會留下飄在半空的箭頭）', () => {
  const b = boardOf(
    [{ id: 'a' }, { id: 'b' }],
    [{ from: 'a', to: 'b' }, { from: 'a', to: '不存在' }, { from: 'a', to: 'a' }]
  );
  assert.equal(b.links.length, 1);
  assert.equal(b.links[0].to, 'b');
});

await t('連線的箭頭有三種：單向、雙向、不加', () => {
  const b = boardOf([{ id: 'a', y: 40 }, { id: 'b', y: 300 }], [
    { id: 'l1', from: 'a', to: 'b', arrow: 'one' },
    { id: 'l2', from: 'a', to: 'b', arrow: 'both' },
    { id: 'l3', from: 'a', to: 'b', arrow: 'none' }
  ]);
  assert.deepEqual(b.links.map((l) => l.arrow), ['one', 'both', 'none']);
  const svg = (arrow) => B.renderBoard(boardOf([{ id: 'a', y: 40 }, { id: 'b', y: 300 }],
    [{ from: 'a', to: 'b', arrow: arrow }]), {});
  const one = svg('one'), both = svg('both'), none = svg('none');
  assert.ok(/<path[^>]*marker-end/.test(one), '單向沒有箭頭');
  assert.ok(!/<path[^>]*marker-start/.test(one), '單向不該有回頭的箭頭');
  assert.ok(/<path[^>]*marker-start/.test(both), '雙向少了一頭');
  assert.ok(/<path[^>]*marker-end/.test(both), '雙向少了另一頭');
  assert.ok(!/<path[^>]*marker-(end|start)/.test(none), '說了不加箭頭還是加了');
});

await t('連線沒寫箭頭時當成單向（舊的設定檔打開不能整批變成沒箭頭）', () => {
  const b = boardOf([{ id: 'a' }, { id: 'b', y: 300 }], [{ from: 'a', to: 'b' }]);
  assert.equal(b.links[0].arrow, 'one');
  assert.equal(boardOf([{ id: 'a' }, { id: 'b', y: 300 }],
    [{ from: 'a', to: 'b', arrow: '亂打的' }]).links[0].arrow, 'one');
});

await t('存出載入之後箭頭還在（設定檔要記得住）', () => {
  const b = boardOf([{ id: 'a' }, { id: 'b', y: 300 }],
    [{ from: 'a', to: 'b', arrow: 'both', label: '互相', dash: true }]);
  const back = B.parseBoardProject(B.buildBoardProject({ board: b }));
  assert.equal(back.board.links[0].arrow, 'both');
  assert.equal(back.board.links[0].label, '互相');
  assert.equal(back.board.links[0].dash, true);
});

await t('normBoard：不是陣列也不會爆', () => {
  assert.deepEqual(B.normBoard(null).shapes, []);
  assert.deepEqual(B.normBoard({ shapes: '亂打的', links: 5 }).links, []);
});

/* ── 連線：黏在形狀上 ────────────────────────────────────────────── */

await t('連線的端點停在形狀邊界上，不是停在中心', () => {
  const a = shape({ id: 'a', x: 400, y: 100, w: 200, h: 60 });
  const b = shape({ id: 'b', x: 400, y: 300, w: 200, h: 60 });
  const pts = B.routeLink(a, b, [a, b]);
  assert.equal(pts[0].y, a.y + a.h, '起點沒有停在下緣');
  assert.equal(pts[pts.length - 1].y, b.y, '終點沒有停在上緣');
});

await t('菱形的端點貼著斜邊，不是貼著外接矩形', () => {
  const d = shape({ id: 'd', kind: 'decision', x: 400, y: 100, w: 200, h: 100 });
  const below = shape({ id: 'x', x: 400, y: 400, w: 200, h: 60 });
  const pts = B.routeLink(d, below, [d, below]);
  /* 正下方：菱形的下頂點 */
  assert.equal(Math.round(pts[0].x), Math.round(d.x + d.w / 2));
  assert.equal(Math.round(pts[0].y), d.y + d.h);
  /* 斜下方：anchor 要落在斜邊上，不能落在外接矩形的角。
     （routeLink 走直角，會從正右或正下的頂點出去，所以這裡直接問 anchor） */
  const p2 = B.anchor(d, 900, 400);
  assert.ok(p2.x < d.x + d.w - 1 && p2.y > d.y + d.h / 2 + 1,
    '端點落在菱形外：' + JSON.stringify(p2));
  /* 落在菱形邊上：|dx|/hw + |dy|/hh 應該等於 1 */
  const k = Math.abs(p2.x - (d.x + d.w / 2)) / (d.w / 2) + Math.abs(p2.y - (d.y + d.h / 2)) / (d.h / 2);
  assert.ok(Math.abs(k - 1) < 0.01, '端點不在菱形邊上，k=' + k);
});

await t('**移動形狀之後，線的端點跟著跑**（這是畫板存在的前提）', () => {
  const a = shape({ id: 'a', x: 400, y: 100, w: 200, h: 60 });
  const b = shape({ id: 'b', x: 400, y: 300, w: 200, h: 60 });
  const before = B.routeLink(a, b, [a, b]);
  const moved = Object.assign({}, b, { x: 100, y: 600 });
  const after = B.routeLink(a, moved, [a, moved]);
  assert.notDeepEqual(before, after, '形狀移動了，線卻沒有跟著動');
  const end = after[after.length - 1];
  assert.ok(end.x >= moved.x - 1 && end.x <= moved.x + moved.w + 1, '線沒有接到移動後的形狀上');
  assert.ok(end.y >= moved.y - 1 && end.y <= moved.y + moved.h + 1, '線沒有接到移動後的形狀上');
});

await t('往回接的線繞邊走，不會直直穿過中間夾著的方塊', () => {
  const top = shape({ id: 't', x: 400, y: 60, w: 200, h: 60 });
  const midBox = shape({ id: 'm', x: 400, y: 220, w: 200, h: 60 });
  const bottom = shape({ id: 'b', x: 400, y: 380, w: 200, h: 60 });
  const pts = B.routeLink(bottom, top, [top, midBox, bottom]);
  /* 中間那一段必須整條走在夾著的方塊左右兩側之外 */
  const lane = pts[1].x;
  assert.ok(lane < midBox.x || lane > midBox.x + midBox.w,
    '退回線的巷道 x=' + lane + ' 壓在中間那個方塊上');
  assert.ok(lane >= 0 && lane <= B.W, '巷道跑到畫布外：' + lane);
});

await t('左邊沒空間時，繞邊改走右邊', () => {
  const a = shape({ id: 'a', x: 0, y: 300, w: 200, h: 60 });
  const c = shape({ id: 'c', x: 0, y: 60, w: 200, h: 60 });
  const pts = B.routeLink(a, c, [a, c]);
  assert.ok(pts[1].x > 200, '左邊沒空間卻還是往左繞：' + pts[1].x);
});

await t('中心只差一點時走一條直線，不要轉出一個小階梯（看起來像畫錯）', () => {
  /* 常見成因：使用者把其中一個方塊拉寬了，中心跟著移了十幾個像素 */
  const wide = shape({ id: 'a', x: 400, y: 100, w: 240, h: 80 });
  const below = shape({ id: 'b', x: 400, y: 280, w: 200, h: 60 });
  assert.equal(B.routeLink(wide, below, [wide, below]).length, 2,
    '差 ' + ((wide.x + wide.w / 2) - (below.x + below.w / 2)) + 'px 就轉彎了');
  /* 真的排在旁邊的還是要走直角，不然會變成一條長斜線 */
  const aside = shape({ id: 'c', x: 700, y: 280, w: 200, h: 60 });
  assert.equal(B.routeLink(wide, aside, [wide, aside]).length, 4, '離得遠的應該走直角');
});

await t('linkMid 落在線上，標籤才不會飄在旁邊', () => {
  const a = shape({ id: 'a', x: 400, y: 100, w: 200, h: 60 });
  const b = shape({ id: 'b', x: 400, y: 300, w: 200, h: 60 });
  const pts = B.routeLink(a, b, [a, b]);
  const m = B.linkMid(pts);
  assert.ok(m.y > a.y + a.h && m.y < b.y, JSON.stringify(m));
});

/* ── 畫 ──────────────────────────────────────────────────────────── */

await t('renderBoard：畫得出完整的一張 svg，而且高度跟著內容長', () => {
  const svg = B.renderBoard(boardOf([{ id: 'a', text: '甲', y: 40 }]), {});
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(svg, /viewBox="0 0 1000 \d+"/);
  const tall = B.renderBoard(boardOf([{ id: 'a', text: '甲', y: 1200 }]), {});
  const h1 = +/viewBox="0 0 1000 (\d+)"/.exec(svg)[1];
  const h2 = +/viewBox="0 0 1000 (\d+)"/.exec(tall)[1];
  assert.ok(h2 > h1, '形狀放到很下面時畫布沒有變高');
});

await t('renderBoard：空的時候給一句「該做什麼」，不是空白也不是壞掉', () => {
  const svg = B.renderBoard({ shapes: [], links: [] }, {});
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(words(svg), /挑一個形狀/);
});

await t('線上的標籤畫在所有線之上（交叉時才不會被壓掉）', () => {
  const b = boardOf(
    [{ id: 'a', x: 400, y: 40, w: 200, h: 60 }, { id: 'b', x: 400, y: 300, w: 200, h: 60 },
     { id: 'c', x: 40, y: 160, w: 200, h: 60 }, { id: 'd', x: 740, y: 160, w: 200, h: 60 }],
    [{ from: 'a', to: 'b', label: '否' }, { from: 'c', to: 'd' }]
  );
  const svg = B.renderBoard(b, {});
  const lastPath = svg.lastIndexOf('<path');
  const label = svg.indexOf('>否<');
  assert.ok(label > lastPath, '標籤畫在線之前，交叉的線會把它壓掉');
});

await t('renderBoard：每一種形狀畫出來的圖元不一樣', () => {
  const one = (kind) => B.renderBoard(boardOf([{ id: 'a', kind, text: '甲' }]), {});
  assert.ok(one('decision').includes('<polygon'), '判斷不是菱形');
  assert.ok(one('note').includes('stroke-dasharray'), '註記不是虛線框');
  assert.ok(!one('label').includes('<rect x='), '純文字不該有框');
  assert.ok(one('step').includes('<rect x='), '步驟沒有框');
});

await t('renderBoard：使用者打的字被跳脫，不會變成標籤', () => {
  const svg = B.renderBoard(boardOf([{ id: 'a', text: '<script>x</script>', sub: 'a & b' }]), {});
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;') && svg.includes('a &amp; b'));
});

await t('renderBoard：顏色用上游那四個色票，換配色才吃得到', () => {
  const svg = B.renderBoard(boardOf([
    { id: 'a', color: 'accent', text: '甲' }, { id: 'b', color: 'ink', text: '乙', y: 200 }
  ], [{ from: 'a', to: 'b' }]), {});
  assert.ok(svg.includes(DD.UPSTREAM_LIGHT.accent), '沒有用強調色');
  assert.ok(svg.includes(DD.UPSTREAM_LIGHT.ink), '沒有用文字色');
  assert.ok(svg.includes(DD.UPSTREAM_LIGHT.muted), '線沒有用次要色');
  assert.ok(svg.includes(DD.UPSTREAM_LIGHT.paper), '沒有用底色');
});

await t('renderBoard：格線只有在畫面上才畫，匯出的那份不畫', () => {
  const b = boardOf([{ id: 'a', text: '甲' }]);
  assert.ok(B.renderBoard(b, { grid: true }).includes('url(#ddb-grid)'), '畫面上沒有格線');
  assert.ok(!B.renderBoard(b, { grid: false }).includes('url(#ddb-grid)'), '匯出的那份不該有格線');
});

await t('renderBoard：零對外連線', () => {
  const svg = B.renderBoard(boardOf([{ id: 'a', text: '甲' }]), {});
  const links = svg.replace(/xmlns(:\w+)?="[^"]*"/g, '');
  assert.ok(!/@import|https?:\/\//.test(links), '產出的 SVG 有對外連線');
});

/* ── 命中測試與縮放：畫面層要用，但算的是幾何 ───────────────────────── */

await t('hitShape：點到才算，而且後畫的在上面', () => {
  const b = boardOf([
    { id: 'under', x: 100, y: 100, w: 200, h: 100 },
    { id: 'over', x: 150, y: 120, w: 200, h: 100 }
  ]);
  assert.equal(B.hitShape(b, 110, 110).id, 'under');
  assert.equal(B.hitShape(b, 200, 150).id, 'over', '疊在上面的沒有優先');
  assert.equal(B.hitShape(b, 900, 900), null);
});

await t('handlesOf：八個把手，位置在四角與四邊中點', () => {
  const a = shape({ x: 100, y: 100, w: 200, h: 100 });
  const h = B.handlesOf(a);
  assert.equal(h.length, 8);
  assert.deepEqual(h.map((x) => x.id).sort(), ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  const se = h.filter((x) => x.id === 'se')[0];
  assert.equal(se.x, a.x + a.w);
  assert.equal(se.y, a.y + a.h);
});

await t('resizeBy：拉右下變大、拉左上時左上角跟著移動', () => {
  const a = shape({ x: 200, y: 200, w: 200, h: 100 });
  const se = B.resizeBy(a, 'se', 60, 40);
  assert.ok(se.w > a.w && se.h > a.h);
  assert.equal(se.x, a.x, '拉右下不該動到左上角');
  const nw = B.resizeBy(a, 'nw', 40, 20);
  assert.ok(nw.x > a.x && nw.y > a.y, '拉左上時左上角要跟著移動');
  assert.ok(nw.w < a.w && nw.h < a.h);
});

await t('resizeBy：拉不成一條線（有最小尺寸），也拉不出畫布', () => {
  const a = shape({ x: 200, y: 200, w: 200, h: 100 });
  const tiny = B.resizeBy(a, 'se', -9999, -9999);
  assert.ok(tiny.w >= 60 && tiny.h >= 28, JSON.stringify(tiny));
  const huge = B.resizeBy(a, 'e', 9999, 0);
  assert.ok(huge.x + huge.w <= B.W, '拉出右邊界了：' + JSON.stringify(huge));
  const upLeft = B.resizeBy(a, 'nw', -9999, -9999);
  assert.ok(upLeft.x >= 0 && upLeft.y >= 0, JSON.stringify(upLeft));
});

/* ── 從填表那張圖搬進畫板 ─────────────────────────────────────────── */

/** 照 gen.js 的流程圖規則把列整成節點（forms.js 的 flowNodes 是同一套）。 */
function flowNodes(rows) {
  const nodes = [];
  let lastKind = null;
  rows.forEach((row) => {
    const main = String(row.main || '').trim();
    if (!main) return;
    let kind = row.kind || 'step';
    if (kind === 'branch' && lastKind !== 'decision' && lastKind !== 'branch') kind = 'step';
    const n = {
      kind, main, sub: String(row.sub || '').trim(),
      branch: kind === 'decision' ? { label: String(row.branchLabel || '否') } : null,
      loop: null, downLabel: String(row.downLabel || ''), branchEnds: !!row.branchEnds
    };
    if (kind === 'decision' && row.loopTo) {
      const i = nodes.findIndex((x) => x.main === row.loopTo);
      if (i >= 0) n.loop = { label: String(row.loopLabel || '是'), target: row.loopTo, index: i };
    }
    nodes.push(n);
    lastKind = kind;
  });
  return nodes;
}

await t('搬進畫板：每一格都在，文字也都在', () => {
  const gen = G.byId('flow');
  const b = B.boardFromFlow(flowNodes(gen.example));
  assert.equal(b.shapes.length, gen.example.length);
  const text = b.shapes.map((s) => s.text).join('|');
  gen.example.forEach((r) => assert.ok(text.includes(r.main), '搬過去之後少了「' + r.main + '」'));
});

await t('搬進畫板：形狀對得上（判斷是菱形、起訖是橢圓、分支是註記框）', () => {
  const b = B.boardFromFlow(flowNodes(G.byId('flow').example));
  const kindOf = (txt) => b.shapes.filter((s) => s.text === txt)[0].kind;
  assert.equal(kindOf('是否本科權責？'), 'decision');
  assert.equal(kindOf('收到來文'), 'start');
  assert.equal(kindOf('發文並歸檔'), 'start');
  assert.equal(kindOf('移文他科'), 'note');
  assert.equal(kindOf('登記收文'), 'step');
});

await t('搬進畫板：連線都在，退回線是虛線', () => {
  const b = B.boardFromFlow(flowNodes(G.byId('flow').example));
  assert.ok(b.links.length >= b.shapes.length - 2, '線太少：' + b.links.length);
  assert.ok(b.links.some((l) => l.dash), '退回線不是虛線');
  assert.ok(b.links.some((l) => l.label === '否'), '分支上的字不見了');
});

await t('搬進畫板：主線的中心對齊（不對格線，不然直線會變成小階梯）', () => {
  const b = B.boardFromFlow(flowNodes(G.byId('flow').example));
  const mains = b.shapes.filter((s) => s.x < 600).map((s) => s.x + s.w / 2);
  assert.equal(new Set(mains).size, 1, '主線的中心沒有對齊：' + [...new Set(mains)].join(','));
});

await t('搬進畫板：空的也不會爆', () => {
  const b = B.boardFromFlow([]);
  assert.deepEqual(b.shapes, []);
  assert.deepEqual(b.links, []);
});

/* ── 設定檔 ──────────────────────────────────────────────────────── */

await t('畫板設定檔：存出再讀回來，形狀與線都一模一樣', () => {
  const b = B.boardFromFlow(flowNodes(G.byId('flow').example));
  const json = B.buildBoardProject({ board: b, title: '公文流程', eyebrow: '流程圖' });
  const back = B.parseBoardProject(json);
  assert.equal(back.title, '公文流程');
  assert.equal(back.board.shapes.length, b.shapes.length);
  assert.equal(back.board.links.length, b.links.length);
  assert.deepEqual(back.board.shapes[0], b.shapes[0]);
});

await t('畫板設定檔：帶著來源標註（授權要求）', () => {
  const json = B.buildBoardProject({ board: boardOf([{ id: 'a', text: '甲' }]) });
  assert.match(JSON.parse(json).source, /cathrynlavery\/diagram-design/);
});

await t('畫板設定檔：壞掉的每一種都講人話', () => {
  const bad = [
    ['不是 JSON', '{{{'],
    ['不是本站的', '{"format":"別的"}'],
    ['是填表用的', '{"format":"gongwu-diagram","kind":"generator","version":1}'],
    ['版本太新', '{"format":"gongwu-diagram","kind":"board","version":99}'],
    ['一個形狀都沒有', '{"format":"gongwu-diagram","kind":"board","version":1,"shapes":[]}']
  ];
  bad.forEach(([why, text]) => {
    let msg = '';
    try { B.parseBoardProject(text); } catch (e) { msg = e.message; }
    assert.ok(msg, why + ' 應該要擋下來');
    assert.ok(!/JSON\.parse|undefined|Unexpected token/.test(msg), why + ' 的訊息不是人話：' + msg);
    assert.ok(/。$/.test(msg), why + ' 的訊息沒有講完：' + msg);
  });
});

await t('畫板設定檔：讀回來的內容真的畫得出圖', () => {
  const json = B.buildBoardProject({
    board: boardOf([{ id: 'a', text: '甲' }, { id: 'b', text: '乙', y: 300 }], [{ from: 'a', to: 'b' }])
  });
  const back = B.parseBoardProject(json);
  const svg = B.renderBoard(back.board, {});
  assert.ok(words(svg).includes('甲') && words(svg).includes('乙'));
});

s.finish();
