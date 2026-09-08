/*
 * gen.js — 圖表產生引擎。純函式層，不碰 DOM，Node 直接 require 得動。
 *
 * 這一層是整個站台的核心：使用者在表單裡填「結構」（哪些步驟、哪些工作項目、
 * 起迄日期），這裡把它算成一張排好版的 SVG。全部是幾何與算術，沒有 AI、沒有後端。
 *
 * 為什麼不需要 AI：AI 是用來「從自由文字猜出結構」的。使用者填表單時，
 * 結構已經是給定的，剩下的只是算座標。甘特圖的長條位置就是
 *   x = 圖左 + (起日 - 專案起日) / 總天數 × 圖寬
 * 這種東西。
 *
 * 每一種圖都長一樣的介面，畫面層才能用同一套表單引擎跑五種圖：
 *   { id, name, use, sample, fields, meta, example, build(rows, meta, opts) }
 * build() 回傳 { svg, warnings, count }，warnings 是要顯示給使用者看的人話。
 *
 * 顏色一律用 core.js 的 UPSTREAM_LIGHT 四個色票的字面值，
 * 換配色與換字體那兩條路才吃得到（那兩支是做字串置換的）。
 *
 * 視覺沿用 github.com/cathrynlavery/diagram-design 的設計語彙（MIT，Cathryn Lavery）：
 * 暖紙底、網點、細線、單一強調色、形狀代表類型。範本庫是那套語彙的參考實作。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.DDGen = factory(root.DD);
})(typeof self !== 'undefined' ? self : this, function (DD) {
  'use strict';

  var C = DD.UPSTREAM_LIGHT;
  var F = DD.FONTS;
  var W = 1000;

  function esc(s) { return DD.escapeXml(s); }
  function r1(v) { return Math.round(v * 10) / 10; }

  /* ── 共用的畫布外框：暖紙底＋網點，跟範本庫是同一家人 ─────────────── */

  function canvasOpen(height, label) {
    return '<svg viewBox="0 0 ' + W + ' ' + Math.round(height) + '" xmlns="http://www.w3.org/2000/svg" ' +
      'role="img" aria-label="' + esc(label || '圖') + '">' +
      '<defs><pattern id="ddg-dots" width="22" height="22" patternUnits="userSpaceOnUse">' +
      '<circle cx="1" cy="1" r="0.9" fill="rgba(45,49,66,0.10)"/></pattern>' +
      '<marker id="ddg-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">' +
      '<polygon points="0 0, 8 3, 0 6" fill="' + C.muted + '"/></marker>' +
      '<marker id="ddg-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">' +
      '<polygon points="0 0, 8 3, 0 6" fill="' + C.accent + '"/></marker>' +
      /* 雙向箭頭的那一頭：refX 要放在 0 那一端，不然箭頭會凸出線的起點外面 */
      '<marker id="ddg-arrow-back" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto">' +
      '<polygon points="8 0, 0 3, 8 6" fill="' + C.muted + '"/></marker></defs>' +
      '<rect width="100%" height="100%" fill="' + C.paper + '"/>' +
      '<rect width="100%" height="100%" fill="url(#ddg-dots)" opacity="0.55"/>';
  }

  function text(x, y, s, o) {
    var op = o || {};
    return '<text x="' + r1(x) + '" y="' + r1(y) + '" fill="' + (op.fill || C.ink) +
      '" font-size="' + (op.size || 12) + '" font-family="' + (op.font || F.sans) + '"' +
      (op.weight ? ' font-weight="' + op.weight + '"' : '') +
      (op.anchor ? ' text-anchor="' + op.anchor + '"' : '') +
      (op.spacing ? ' letter-spacing="' + op.spacing + '"' : '') +
      (op.opacity ? ' opacity="' + op.opacity + '"' : '') +
      '>' + esc(s) + '</text>';
  }

  /** 圖例：每一種圖都有，形狀在左、名稱在右，橫著排。 */
  function legend(y, items) {
    var out = ['<line x1="40" y1="' + r1(y) + '" x2="960" y2="' + r1(y) +
      '" stroke="rgba(45,49,66,0.10)" stroke-width="0.8"/>',
      text(40, y + 16, '圖例', { fill: C.muted, size: 8, font: F.mono, spacing: '0.18em' })];
    var x = 40;
    items.forEach(function (it) {
      out.push(it.mark(x, y + 32));
      out.push(text(x + 32, y + 36, it.name, { fill: C.muted, size: 8.5 }));
      x += 32 + DD.textUnits(it.name) * 8.5 + 30;
    });
    return out.join('');
  }

  function swatchRect(fill, stroke, rx) {
    return function (x, y) {
      return '<rect x="' + x + '" y="' + r1(y - 6) + '" width="24" height="12" rx="' + (rx || 2) +
        '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>';
    };
  }
  function swatchLine(stroke, dash) {
    return function (x, y) {
      return '<line x1="' + x + '" y1="' + r1(y) + '" x2="' + (x + 24) + '" y2="' + r1(y) +
        '" stroke="' + stroke + '" stroke-width="1.4"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
    };
  }
  function swatchDiamond(fill, stroke) {
    return function (x, y) {
      return '<polygon points="' + (x + 12) + ',' + r1(y - 6) + ' ' + (x + 24) + ',' + r1(y) + ' ' +
        (x + 12) + ',' + r1(y + 6) + ' ' + x + ',' + r1(y) + '" fill="' + fill +
        '" stroke="' + stroke + '" stroke-width="1"/>';
    };
  }

  function emptyCanvas(msg) {
    return canvasOpen(300, '尚未填寫') +
      text(W / 2, 150, msg, { fill: C.muted, size: 14, anchor: 'middle' }) + '</svg>';
  }

  /* ── 日期：公務一定要吃得下民國年 ─────────────────────────────────
     114/3/5、114.3.5、1140305、114年3月5日、2025-03-05、20250305 都要收。
     年份 ≤ 200 當民國、7 碼當民國、8 碼當西元——這是工具箱一路以來的慣例。 */

  function parseTwDate(input) {
    var s = String(input == null ? '' : input).trim()
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); })
      .replace(/^民國/, '').replace(/\s/g, '');
    if (!s) return null;
    var y, m, d, mm;
    if ((mm = s.match(/^(\d{1,4})[年./-](\d{1,2})[月./-](\d{1,2})日?$/))) {
      y = +mm[1]; m = +mm[2]; d = +mm[3];
    } else if ((mm = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
      y = +mm[1]; m = +mm[2]; d = +mm[3];
    } else if ((mm = s.match(/^(\d{3})(\d{2})(\d{2})$/))) {
      y = +mm[1] + 1911; m = +mm[2]; d = +mm[3];
    } else if ((mm = s.match(/^(\d{1,4})[年./-](\d{1,2})月?$/))) {
      y = +mm[1]; m = +mm[2]; d = 1;
    } else {
      return null;
    }
    if (y <= 200) y += 1911;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }

  function dayNum(dt) { return Math.floor(dt.getTime() / 86400000); }

  /** 民國年顯示：115年3月。公文裡幾乎都是這樣寫的。 */
  function twLabel(dt, withDay) {
    var y = dt.getUTCFullYear() - 1911;
    var s = y + '年' + (dt.getUTCMonth() + 1) + '月';
    return withDay ? s + dt.getUTCDate() + '日' : s;
  }

  /* ══ 一、流程圖 ═══════════════════════════════════════════════════ */

  var FLOW_KIND_OPTIONS = [
    { value: 'step', label: '步驟' },
    { value: 'decision', label: '判斷' },
    { value: 'branch', label: '分支步驟' },
    { value: 'start', label: '開始' },
    { value: 'end', label: '結束' }
  ];

  var flowGen = {
    id: 'flow',
    name: '流程圖',
    use: '有判斷分支的作業流程。步驟幾個、哪裡分岔、哪裡退回，都由你決定。',
    sample: 'example-flowchart',
    sampleTitle: '公文簽辦流程',
    help: [
      '型別選「判斷」才會出現分岔的欄位；其餘一律是矩形步驟，開始與結束是橢圓。',
      '判斷底下接幾列「分支步驟」，就是往右岔出去的那一路——可以連走好幾步，走完自動匯回主線。',
      '分支不想回主線（例如「移文他科」就結案了），把判斷那列的「分支不回主線」勾起來。',
      '「退回到」是把線拉回前面某一步（例如退回承辦人重擬），只能選前面已經有的步驟。',
      '三條線的字（往右、往下、退回）各自有欄位，留空的話往下那條會自動標成往右那條的相反詞。'
    ],
    rowName: '步驟',
    fields: [
      { key: 'kind', label: '型別', type: 'select', options: FLOW_KIND_OPTIONS, width: '104px' },
      { key: 'main', label: '文字', type: 'text', placeholder: '登記收文' },
      { key: 'sub', label: '小字副標（可留空）', type: 'text', placeholder: '收發室' },
      { key: 'branchLabel', label: '往右分支標的字', type: 'text', placeholder: '否', width: '112px', only: 'decision' },
      { key: 'downLabel', label: '往下走標的字', type: 'text', placeholder: '是', width: '112px', only: 'decision' },
      { key: 'loopTo', label: '退回到', type: 'rowref', width: '150px', only: 'decision' },
      { key: 'loopLabel', label: '退回線標的字', type: 'text', placeholder: '是', width: '112px', only: 'decision' },
      { key: 'branchEnds', label: '分支不回主線', type: 'check', width: '92px', only: 'decision',
        hint: '勾了分支就自成一路收尾，不畫匯回主線的線' }
    ],
    example: [
      { kind: 'start', main: '收到來文' },
      { kind: 'step', main: '登記收文', sub: '收發室' },
      { kind: 'decision', main: '是否本科權責？', branchLabel: '否', downLabel: '是', branchEnds: true },
      { kind: 'branch', main: '移文他科', sub: '並副知來文機關' },
      { kind: 'branch', main: '結案登記' },
      { kind: 'step', main: '承辦人擬稿', sub: '附法令依據' },
      { kind: 'step', main: '科長審核' },
      { kind: 'decision', main: '內容是否需要修正？', downLabel: '否', loopTo: '承辦人擬稿', loopLabel: '是' },
      { kind: 'step', main: '主管決行' },
      { kind: 'end', main: '發文並歸檔' }
    ],
    build: function (rows, meta, opts) {
      var warnings = [];
      var nodes = [];
      var lastKind = null;
      (rows || []).forEach(function (row, i) {
        var main = String(row.main || '').trim();
        if (!main) { if (hasAny(row)) warnings.push('第 ' + (i + 1) + ' 列沒有填文字，跳過了。'); return; }
        var kind = row.kind || 'step';
        /* 分支步驟一定要接在判斷（或另一個分支步驟）底下，不然掛不上去 */
        if (kind === 'branch' && lastKind !== 'decision' && lastKind !== 'branch') {
          warnings.push('第 ' + (i + 1) + ' 列「' + main +
            '」是分支步驟，但它上面不是判斷，也不是另一個分支步驟，先當成一般步驟畫。');
          kind = 'step';
        }
        var n = {
          kind: kind, main: main, sub: String(row.sub || '').trim(),
          branch: null, loop: null, downLabel: '', branchEnds: false
        };
        if (kind === 'decision') {
          n.branch = { label: String(row.branchLabel || '').trim() || '否' };
          n.downLabel = String(row.downLabel || '').trim();
          n.branchEnds = !!row.branchEnds;
          var lt = String(row.loopTo || '').trim();
          if (lt) n.loop = { label: String(row.loopLabel || '').trim() || '是', target: lt };
        }
        nodes.push(n);
        lastKind = kind;
      });

      /* 退回目標指不到前面的節點時，講得出是哪一個判斷、指了什麼 */
      nodes.forEach(function (n, idx) {
        if (!n.loop) return;
        var found = -1;
        for (var j = 0; j < idx; j++) if (nodes[j].main === n.loop.target) { found = j; break; }
        if (found < 0) {
          warnings.push('「' + n.main + '」的退回目標「' + n.loop.target + '」不在它前面，這條退回線畫不出來。');
          n.loop = null;
        } else n.loop.index = found;
      });

      /* 分支走完卻沒有主線可以匯回，就等於自成一路——講一聲，不要靜靜少畫一條線 */
      nodes.forEach(function (n, idx) {
        if (n.kind !== 'branch' || n.branchEnds) return;
        var owner = null, k;
        for (k = idx; k >= 0; k--) if (nodes[k].kind === 'decision') { owner = nodes[k]; break; }
        var isLast = !(nodes[idx + 1] && nodes[idx + 1].kind === 'branch');
        if (!isLast || !owner || owner.branchEnds) return;
        var hasAfter = false;
        for (k = idx + 1; k < nodes.length; k++) if (nodes[k].kind !== 'branch') { hasAfter = true; break; }
        if (!hasAfter) {
          warnings.push('「' + n.main + '」後面沒有主線步驟可以匯回。' +
            '在它下面加一個步驟，或把上面那個判斷勾成「分支不回主線」。');
        }
      });

      if (!nodes.length) return { svg: emptyCanvas('在左邊加幾個步驟，這裡就會出現流程圖'), warnings: warnings, count: 0 };
      return { svg: DD.renderFlowSvg({ nodes: nodes }, opts), warnings: warnings, count: nodes.length };
    }
  };

  function hasAny(row) {
    return Object.keys(row || {}).some(function (k) {
      return k !== 'kind' && String(row[k] || '').trim();
    });
  }

  /* ══ 二、甘特圖 ═══════════════════════════════════════════════════
     長條的位置就是一行公式：x = 圖左 + (起日 - 專案起日) / 總天數 × 圖寬。 */

  var GANTT = { nameW: 250, chartX: 276, chartR: 962, top: 74, rowH: 34, barH: 20 };

  var ganttGen = {
    id: 'gantt',
    name: '甘特圖',
    use: '各項工作的起迄時間與重疊情形。日期可以直接打民國年（114/3/5）。',
    sample: 'example-gantt',
    sampleTitle: '系統建置期程',
    help: [
      '日期打民國年就好：114/3/5、114.3.5、114年3月5日、1140305 都認得，西元 2025-03-05 也可以。',
      '「階段」相同且連續的幾列會共用一個階段標示，留空就不標。',
      '勾「查核點」的那一列畫成菱形（起迄同一天的里程碑），不畫長條。'
    ],
    rowName: '工作項目',
    fields: [
      { key: 'name', label: '工作項目', type: 'text', placeholder: '各科室需求訪談' },
      { key: 'start', label: '起日', type: 'text', placeholder: '114/3/1', width: '110px' },
      { key: 'end', label: '迄日', type: 'text', placeholder: '114/3/20', width: '110px' },
      { key: 'phase', label: '階段（可留空）', type: 'text', placeholder: '需求盤點', width: '130px' },
      { key: 'milestone', label: '查核點', type: 'check', width: '76px',
        hint: '勾了畫成菱形的里程碑，不畫長條' }
    ],
    example: [
      { name: '各科室需求訪談', start: '114/3/3', end: '114/3/21', phase: '需求盤點' },
      { name: '現行作業盤點', start: '114/3/10', end: '114/4/4', phase: '需求盤點' },
      { name: '畫面架構草案', start: '114/4/7', end: '114/4/25', phase: '系統設計' },
      { name: '陳核', start: '114/4/28', end: '114/4/30', phase: '系統設計', milestone: true },
      { name: '系統開發', start: '114/5/1', end: '114/6/13', phase: '建置' },
      { name: '試辦測試', start: '114/6/2', end: '114/6/27', phase: '建置' },
      { name: '上線', start: '114/6/30', end: '114/6/30', phase: '建置', milestone: true }
    ],
    build: function (rows, meta, opts) {
      var warnings = [];
      var tasks = [];
      (rows || []).forEach(function (row, i) {
        var name = String(row.name || '').trim();
        if (!name && !String(row.start || '').trim()) return;
        if (!name) { warnings.push('第 ' + (i + 1) + ' 列沒有填工作項目，跳過了。'); return; }
        var s = parseTwDate(row.start);
        var e = parseTwDate(row.end) || s;
        if (!s) {
          warnings.push('「' + name + '」的起日「' + (row.start || '空白') +
            '」看不懂。可以打 114/3/5、114年3月5日 或 2025-03-05。');
          return;
        }
        if (e < s) {
          warnings.push('「' + name + '」的迄日早於起日，已當成同一天處理。');
          e = s;
        }
        tasks.push({
          name: name, s: s, e: e, phase: String(row.phase || '').trim(),
          milestone: !!row.milestone
        });
      });

      if (!tasks.length) {
        return { svg: emptyCanvas('在左邊填工作項目與起迄日，這裡就會出現甘特圖'), warnings: warnings, count: 0 };
      }

      var min = tasks[0].s, max = tasks[0].e;
      tasks.forEach(function (t) { if (t.s < min) min = t.s; if (t.e > max) max = t.e; });
      var d0 = dayNum(min), d1 = dayNum(max) + 1;
      var span = Math.max(1, d1 - d0);
      var cw = GANTT.chartR - GANTT.chartX;
      var x = function (dn) { return GANTT.chartX + (dn - d0) / span * cw; };

      var H = GANTT.top + tasks.length * GANTT.rowH + 96;
      var out = [canvasOpen(H, '甘特圖')];

      /* 時間刻度：跨度短就標週、長就標月 */
      var ticks = [];
      if (span <= 70) {
        var cur = new Date(min.getTime());
        cur.setUTCDate(cur.getUTCDate() - ((cur.getUTCDay() + 6) % 7));
        while (dayNum(cur) <= d1) {
          if (dayNum(cur) >= d0) ticks.push({ dn: dayNum(cur), label: (cur.getUTCMonth() + 1) + '/' + cur.getUTCDate() });
          cur.setUTCDate(cur.getUTCDate() + 7);
        }
      } else {
        var c2 = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));
        while (dayNum(c2) <= d1) {
          if (dayNum(c2) >= d0) {
            ticks.push({
              dn: dayNum(c2),
              label: (c2.getUTCMonth() === 0 ? (c2.getUTCFullYear() - 1911) + '年' : '') + (c2.getUTCMonth() + 1) + '月'
            });
          }
          c2.setUTCMonth(c2.getUTCMonth() + 1);
        }
      }
      var bottom = GANTT.top + tasks.length * GANTT.rowH;
      ticks.forEach(function (tk) {
        out.push('<line x1="' + r1(x(tk.dn)) + '" y1="' + (GANTT.top - 18) + '" x2="' + r1(x(tk.dn)) +
          '" y2="' + r1(bottom) + '" stroke="rgba(45,49,66,0.10)" stroke-width="0.8"/>');
        out.push(text(x(tk.dn), GANTT.top - 26, tk.label,
          { fill: C.muted, size: 9, font: F.mono, anchor: 'middle' }));
      });
      out.push(text(40, GANTT.top - 44, twLabel(min) + ' — ' + twLabel(max) + '　共 ' + span + ' 天',
        { fill: C.muted, size: 9, font: F.mono, spacing: '0.14em' }));

      var lastPhase = null;
      tasks.forEach(function (t, i) {
        var cy = GANTT.top + i * GANTT.rowH + GANTT.rowH / 2;
        if (t.phase && t.phase !== lastPhase) {
          out.push(text(40, cy - 11, t.phase, { fill: C.muted, size: 8.5, font: F.mono, spacing: '0.16em' }));
          lastPhase = t.phase;
        }
        var nm = DD.wrapLabel(t.name, (GANTT.nameW - 60) / 12);
        out.push(text(GANTT.nameW, cy + 4, nm[0] + (nm.length > 1 ? '…' : ''),
          { fill: C.ink, size: 12, weight: '600', anchor: 'end' }));

        var bx = x(dayNum(t.s));
        var bw = Math.max(4, x(dayNum(t.e) + 1) - bx);
        if (t.milestone) {
          var mx = bx + bw / 2, my = cy;
          out.push('<polygon points="' + r1(mx) + ',' + r1(my - 9) + ' ' + r1(mx + 9) + ',' + r1(my) +
            ' ' + r1(mx) + ',' + r1(my + 9) + ' ' + r1(mx - 9) + ',' + r1(my) +
            '" fill="rgba(235,108,54,0.10)" stroke="' + C.accent + '" stroke-width="1.2"/>');
        } else {
          out.push('<rect x="' + r1(bx) + '" y="' + r1(cy - GANTT.barH / 2) + '" width="' + r1(bw) +
            '" height="' + GANTT.barH + '" rx="3" fill="rgba(45,49,66,0.06)" stroke="' + C.ink +
            '" stroke-width="1"/>');
        }
        /* 日期標在長條右邊；貼近右界就翻到左邊去，寧可換邊也不要被裁掉 */
        var lab = twLabel(t.s, true).replace(/^\d+年/, '') +
          (dayNum(t.e) === dayNum(t.s) ? '' : '–' + twLabel(t.e, true).replace(/^\d+年/, ''));
        var labW = DD.textUnits(lab) * 8;
        var labX = x(dayNum(t.e) + 1) + 8;
        if (labX + labW > 986) {
          out.push(text(bx - 8, cy + 3.5, lab, { fill: C.muted, size: 8, font: F.mono, anchor: 'end' }));
        } else {
          out.push(text(labX, cy + 3.5, lab, { fill: C.muted, size: 8, font: F.mono }));
        }
      });

      out.push('<line x1="' + GANTT.chartX + '" y1="' + r1(bottom) + '" x2="' + GANTT.chartR +
        '" y2="' + r1(bottom) + '" stroke="rgba(45,49,66,0.18)" stroke-width="1"/>');
      out.push(legend(H - 58, [
        { name: '工作項目', mark: swatchRect('rgba(45,49,66,0.06)', C.ink, 3) },
        { name: '查核點', mark: swatchDiamond('rgba(235,108,54,0.10)', C.accent) }
      ]));
      out.push('</svg>');
      return { svg: out.join(''), warnings: warnings, count: tasks.length };
    }
  };

  /* ══ 三、時間軸 ═══════════════════════════════════════════════════
     直式：日期在左、事件在右、中間一條脊線。中文標籤橫著排會擠成一團，
     直式才印得下 A4，而且沿革通常就是一條一條往下讀。 */

  var TL = { spineX: 250, top: 60, rowH: 74 };

  var timelineGen = {
    id: 'timeline',
    name: '時間軸',
    use: '沿革、大事紀、期程說明。日期可以直接打民國年。',
    sample: 'example-timeline',
    sampleTitle: '法規修正沿革',
    help: [
      '日期看得懂就照民國年排版，看不懂就原樣顯示（可以打「114 年上半年」這種）。',
      '由上而下等距排列，不照日期間隔拉開——沿革要好讀，不是要按比例。'
    ],
    rowName: '事件',
    fields: [
      { key: 'date', label: '日期', type: 'text', placeholder: '114/2', width: '120px' },
      { key: 'title', label: '事件', type: 'text', placeholder: '修正草案預告' },
      { key: 'note', label: '說明（可留空）', type: 'text', placeholder: '預告期 60 日' },
      { key: 'major', label: '重要', type: 'check', width: '76px',
        hint: '勾了圓點放大、用強調色標出來' }
    ],
    example: [
      { date: '114/2', title: '修正草案預告', note: '預告期 60 日' },
      { date: '114/4', title: '第一次研商會議', note: '邀集各機關' },
      { date: '114/9', title: '第二次研商會議', note: '增列適用對象' },
      { date: '115/1', title: '函送立法院', note: '併案審查' },
      { date: '115/4', title: '三讀通過', note: '自公布日施行', major: true }
    ],
    build: function (rows, meta, opts) {
      var warnings = [];
      var evts = [];
      (rows || []).forEach(function (row, i) {
        var title = String(row.title || '').trim();
        var raw = String(row.date || '').trim();
        if (!title && !raw) return;
        if (!title) { warnings.push('第 ' + (i + 1) + ' 列沒有填事件，跳過了。'); return; }
        var dt = raw ? parseTwDate(raw) : null;
        if (raw && !dt) warnings.push('「' + title + '」的日期「' + raw + '」看不懂，先用原文顯示。');
        evts.push({
          label: dt ? twLabel(dt) : raw, title: title,
          note: String(row.note || '').trim(), major: !!row.major
        });
      });

      if (!evts.length) {
        return { svg: emptyCanvas('在左邊填日期與事件，這裡就會出現時間軸'), warnings: warnings, count: 0 };
      }

      var H = TL.top + evts.length * TL.rowH + 90;
      var out = [canvasOpen(H, '時間軸')];
      var y0 = TL.top + 12, y1 = TL.top + (evts.length - 1) * TL.rowH + 12;
      out.push('<line x1="' + TL.spineX + '" y1="' + r1(y0) + '" x2="' + TL.spineX + '" y2="' + r1(y1) +
        '" stroke="rgba(45,49,66,0.18)" stroke-width="1.4"/>');

      evts.forEach(function (e, i) {
        var cy = TL.top + i * TL.rowH + 12;
        var col = e.major ? C.accent : C.muted;
        out.push('<circle cx="' + TL.spineX + '" cy="' + r1(cy) + '" r="' + (e.major ? 7 : 4.5) +
          '" fill="' + (e.major ? 'rgba(235,108,54,0.12)' : C.paper) + '" stroke="' + col + '" stroke-width="1.6"/>');
        out.push(text(TL.spineX - 22, cy + 4, e.label,
          { fill: e.major ? C.accent : C.muted, size: 11, font: F.mono, anchor: 'end', spacing: '0.06em' }));
        var lines = DD.wrapLabel(e.title, (700 - 40) / 14);
        lines.slice(0, 2).forEach(function (ln, k) {
          out.push(text(TL.spineX + 22, cy + 5 + k * 19, ln, { fill: C.ink, size: 14, weight: '600' }));
        });
        if (e.note) {
          out.push(text(TL.spineX + 22, cy + 5 + Math.min(lines.length, 2) * 19 + 2, e.note,
            { fill: C.muted, size: 10, font: F.mono }));
        }
      });

      out.push(legend(H - 58, [
        { name: '事件', mark: function (x, y) {
          return '<circle cx="' + (x + 12) + '" cy="' + r1(y) + '" r="4.5" fill="' + C.paper +
            '" stroke="' + C.muted + '" stroke-width="1.6"/>';
        } },
        { name: '重要里程碑', mark: function (x, y) {
          return '<circle cx="' + (x + 12) + '" cy="' + r1(y) + '" r="7" fill="rgba(235,108,54,0.12)" stroke="' +
            C.accent + '" stroke-width="1.6"/>';
        } },
        { name: '由上而下依時間排列，間距等距', mark: function () { return ''; } }
      ]));
      out.push('</svg>');
      return { svg: out.join(''), warnings: warnings, count: evts.length };
    }
  };

  /* ══ 四、分層堆疊圖 ═══════════════════════════════════════════════ */

  var LAY = { x: 150, w: 700, top: 70, rowH: 66, gap: 8 };

  var layersGen = {
    id: 'layers',
    name: '分層堆疊圖',
    use: '由上而下的層級結構：法規分層、系統分層、業務分層都適用。',
    sample: 'example-layers',
    sampleTitle: '業務分層架構',
    help: [
      '第一列畫在最上面。上下的標示（例如「上層／底層」「前台／後台」）在最上面那格改。',
      '勾「重點層」的那一層會用強調色框起來。'
    ],
    rowName: '層',
    fields: [
      { key: 'name', label: '層名', type: 'text', placeholder: '受理與分辦' },
      { key: 'note', label: '內容（可留空）', type: 'text', placeholder: '收文 · 分文 · 派案' },
      { key: 'focal', label: '重點層', type: 'check', width: '84px',
        hint: '勾了會用強調色框起來' }
    ],
    meta: [
      { key: 'topLabel', label: '最上層標示', type: 'text', placeholder: '上層', width: '140px' },
      { key: 'bottomLabel', label: '最下層標示', type: 'text', placeholder: '底層', width: '140px' }
    ],
    example: [
      { name: '民眾介面', note: '臨櫃 · 網路 · 電話' },
      { name: '受理與分辦', note: '收文 · 分文 · 派案', focal: true },
      { name: '審查作業', note: '書面審查 · 實地查核' },
      { name: '法規依據', note: '母法 · 施行細則 · 函釋' },
      { name: '資料庫', note: '人事 · 財產 · 預算' }
    ],
    build: function (rows, meta, opts) {
      var warnings = [];
      var m = meta || {};
      var layers = [];
      (rows || []).forEach(function (row, i) {
        var name = String(row.name || '').trim();
        if (!name) { if (String(row.note || '').trim()) warnings.push('第 ' + (i + 1) + ' 列沒有填層名，跳過了。'); return; }
        layers.push({ name: name, note: String(row.note || '').trim(), focal: !!row.focal });
      });
      if (!layers.length) {
        return { svg: emptyCanvas('在左邊填每一層的名稱，這裡就會出現分層圖'), warnings: warnings, count: 0 };
      }

      var H = LAY.top + layers.length * (LAY.rowH + LAY.gap) + 84;
      var out = [canvasOpen(H, '分層堆疊圖')];
      var topL = String(m.topLabel || '上層').trim() || '上層';
      var botL = String(m.bottomLabel || '底層').trim() || '底層';
      var lastY = LAY.top + (layers.length - 1) * (LAY.rowH + LAY.gap) + LAY.rowH;
      out.push(text(LAY.x - 22, LAY.top + 12, topL,
        { fill: C.muted, size: 8.5, font: F.mono, anchor: 'end', spacing: '0.16em' }));
      out.push(text(LAY.x - 22, lastY - 4, botL,
        { fill: C.muted, size: 8.5, font: F.mono, anchor: 'end', spacing: '0.16em' }));
      out.push('<line x1="' + (LAY.x - 14) + '" y1="' + (LAY.top + 20) + '" x2="' + (LAY.x - 14) +
        '" y2="' + r1(lastY - 14) + '" stroke="rgba(45,49,66,0.18)" stroke-width="1"/>');

      layers.forEach(function (l, i) {
        var y = LAY.top + i * (LAY.rowH + LAY.gap);
        out.push('<rect x="' + LAY.x + '" y="' + r1(y) + '" width="' + LAY.w + '" height="' + LAY.rowH +
          '" rx="6" fill="' + (l.focal ? 'rgba(235,108,54,0.08)' : '#ffffff') + '" stroke="' +
          (l.focal ? C.accent : C.ink) + '" stroke-width="1"/>');
        out.push(text(LAY.x + 22, y + (l.note ? 28 : 38), l.name, { fill: C.ink, size: 15, weight: '600' }));
        if (l.note) out.push(text(LAY.x + 22, y + 47, l.note, { fill: C.muted, size: 10, font: F.mono }));
        out.push(text(LAY.x + LAY.w - 18, y + (l.note ? 28 : 38), 'L' + (layers.length - i),
          { fill: C.muted, size: 9, font: F.mono, anchor: 'end', spacing: '0.1em' }));
      });

      out.push(legend(H - 58, [
        { name: '一般層', mark: swatchRect('#ffffff', C.ink, 3) },
        { name: '重點層', mark: swatchRect('rgba(235,108,54,0.08)', C.accent, 3) }
      ]));
      out.push('</svg>');
      return { svg: out.join(''), warnings: warnings, count: layers.length };
    }
  };

  /* ══ 五、四象限圖 ═══════════════════════════════════════════════════
     位置就是訊息：兩個 1–5 的評分換算成座標。同一格有多個項目時往下疊，
     不要重疊在一起——重疊會讓整張圖不能看。 */

  var Q = { x: 150, y: 78, w: 700, h: 480 };
  var SCORE_OPTIONS = [
    { value: '1', label: '1 低' }, { value: '2', label: '2' }, { value: '3', label: '3 中' },
    { value: '4', label: '4' }, { value: '5', label: '5 高' }
  ];

  var quadrantGen = {
    id: 'quadrant',
    name: '四象限圖',
    use: '兩個維度分四類：重要／緊急、影響／投入、風險／效益都適用。',
    sample: 'example-quadrant',
    sampleTitle: '業務優先順序',
    help: [
      '兩個軸各給 1 到 5 分，落點就是分數算出來的，不必自己拖。',
      '軸的名稱自己取（投入／影響、急迫／重要、風險／效益都可以）。',
      '同一格有好幾個項目時會自動往下疊開，不會壓在一起。'
    ],
    rowName: '項目',
    fields: [
      { key: 'name', label: '項目', type: 'text', placeholder: '線上申辦改版' },
      { key: 'x', label: '橫軸', type: 'select', options: SCORE_OPTIONS, width: '92px' },
      { key: 'y', label: '縱軸', type: 'select', options: SCORE_OPTIONS, width: '92px' },
      { key: 'focal', label: '重點', type: 'check', width: '76px',
        hint: '勾了會用強調色標出來' }
    ],
    meta: [
      { key: 'xLabel', label: '橫軸名稱', type: 'text', placeholder: '投入', width: '150px' },
      { key: 'yLabel', label: '縱軸名稱', type: 'text', placeholder: '影響', width: '150px' }
    ],
    example: [
      { name: '線上申辦改版', x: '4', y: '5', focal: true },
      { name: '更新表單範例', x: '2', y: '4' },
      { name: '修正公告錯字', x: '1', y: '2' },
      { name: '更新聯絡資訊', x: '1', y: '1' },
      { name: '全面無紙化', x: '5', y: '5' },
      { name: '整批換資料庫', x: '5', y: '2' }
    ],
    build: function (rows, meta, opts) {
      var warnings = [];
      var m = meta || {};
      var items = [];
      (rows || []).forEach(function (row, i) {
        var name = String(row.name || '').trim();
        if (!name) return;
        var xv = parseInt(row.x, 10), yv = parseInt(row.y, 10);
        if (!(xv >= 1 && xv <= 5)) { xv = 3; warnings.push('「' + name + '」沒有選橫軸分數，先當成 3。'); }
        if (!(yv >= 1 && yv <= 5)) { yv = 3; warnings.push('「' + name + '」沒有選縱軸分數，先當成 3。'); }
        items.push({ name: name, x: xv, y: yv, focal: !!row.focal });
      });
      if (!items.length) {
        return { svg: emptyCanvas('在左邊填項目並給兩個分數，這裡就會出現四象限圖'), warnings: warnings, count: 0 };
      }

      var xLabel = String(m.xLabel || '投入').trim() || '投入';
      var yLabel = String(m.yLabel || '影響').trim() || '影響';
      var H = Q.y + Q.h + 100;
      var out = [canvasOpen(H, '四象限圖')];

      out.push('<rect x="' + Q.x + '" y="' + Q.y + '" width="' + Q.w + '" height="' + Q.h +
        '" fill="#ffffff" stroke="rgba(45,49,66,0.14)" stroke-width="1"/>');
      var mx = Q.x + Q.w / 2, my = Q.y + Q.h / 2;
      out.push('<line x1="' + mx + '" y1="' + Q.y + '" x2="' + mx + '" y2="' + (Q.y + Q.h) +
        '" stroke="rgba(45,49,66,0.22)" stroke-width="1"/>');
      out.push('<line x1="' + Q.x + '" y1="' + my + '" x2="' + (Q.x + Q.w) + '" y2="' + my +
        '" stroke="rgba(45,49,66,0.22)" stroke-width="1"/>');

      [['優先處理', Q.x + 16, Q.y + 24, 'start'], ['重點專案', Q.x + Q.w - 16, Q.y + 24, 'end'],
       ['容易見效', Q.x + 16, Q.y + Q.h - 14, 'start'], ['不必投入', Q.x + Q.w - 16, Q.y + Q.h - 14, 'end']]
        .forEach(function (q) {
          out.push(text(q[1], q[2], q[0], { fill: C.muted, size: 9, font: F.mono, anchor: q[3], spacing: '0.16em' }));
        });

      out.push(text(mx, Q.y + Q.h + 32, xLabel + ' →', { fill: C.ink, size: 11, font: F.mono, anchor: 'middle', spacing: '0.14em' }));
      out.push('<text x="' + (Q.x - 26) + '" y="' + my + '" fill="' + C.ink + '" font-size="11" font-family="' +
        F.mono + '" text-anchor="middle" letter-spacing="0.14em" transform="rotate(-90 ' + (Q.x - 26) + ' ' + my +
        ')">' + esc(yLabel + ' →') + '</text>');

      /* 同一格多個項目時往下疊開，不要畫在同一點上 */
      var cell = {};
      items.forEach(function (it) {
        var key = it.x + ',' + it.y;
        cell[key] = (cell[key] || 0) + 1;
        it.slot = cell[key] - 1;
      });
      items.forEach(function (it) {
        var px = Q.x + (it.x - 0.5) / 5 * Q.w;
        var py = Q.y + Q.h - (it.y - 0.5) / 5 * Q.h + it.slot * 26;
        var col = it.focal ? C.accent : C.ink;
        out.push('<circle cx="' + r1(px) + '" cy="' + r1(py) + '" r="' + (it.focal ? 7 : 5) +
          '" fill="' + (it.focal ? 'rgba(235,108,54,0.14)' : 'rgba(45,49,66,0.06)') +
          '" stroke="' + col + '" stroke-width="1.4"/>');
        var right = px < Q.x + Q.w * 0.7;
        out.push(text(px + (right ? 13 : -13), py + 4, it.name,
          { fill: C.ink, size: 12, weight: it.focal ? '600' : '400', anchor: right ? 'start' : 'end' }));
      });

      out.push(legend(H - 58, [
        { name: '項目', mark: function (x, y) {
          return '<circle cx="' + (x + 12) + '" cy="' + r1(y) + '" r="5" fill="rgba(45,49,66,0.06)" stroke="' +
            C.ink + '" stroke-width="1.4"/>';
        } },
        { name: '重點項目', mark: function (x, y) {
          return '<circle cx="' + (x + 12) + '" cy="' + r1(y) + '" r="7" fill="rgba(235,108,54,0.14)" stroke="' +
            C.accent + '" stroke-width="1.4"/>';
        } },
        { name: '位置就是訊息：分數決定落點', mark: function () { return ''; } }
      ]));
      out.push('</svg>');
      return { svg: out.join(''), warnings: warnings, count: items.length };
    }
  };

  /* ══ 六、組織圖 ═══════════════════════════════════════════════════
     樹狀排版：葉子由左而右一個接一個放，父節點置中在自己的子節點上方。
     這是 tidy tree 的第一課，對編制表這種寬而淺的樹夠用，而且算得出來、測得到。
     真正的 Reingold–Tilford 還要處理「兄弟子樹互相推擠」，編制表用不到那個。 */

  var ORG = { boxW: 150, boxH: 52, gapX: 18, gapY: 46, top: 76 };

  var orgGen = {
    id: 'org',
    name: '組織圖',
    use: '編制與分工：誰下面有誰。填「上級是誰」就好，位置由程式排。',
    sample: 'example-org-chart',
    sampleTitle: '本處組織與分工',
    help: [
      '第一列不用選上級，它就是最上面那一個（機關首長或單位名稱）。',
      '「上級」只能選前面已經出現過的單位，所以由上而下、一層一層填最順。',
      '同一個上級底下的單位會由左而右並排，寬度由程式算，不必自己對齊。',
      '層數太多會越畫越窄；超過四層建議拆成兩張圖。'
    ],
    rowName: '單位',
    fields: [
      { key: 'name', label: '單位／職稱', type: 'text', placeholder: '人事處' },
      { key: 'note', label: '小字（人數、負責人，可留空）', type: 'text', placeholder: '編制 12 人' },
      { key: 'parent', label: '上級', type: 'rowref', width: '170px' },
      { key: 'focal', label: '重點', type: 'check', width: '64px',
        hint: '勾了會用強調色框起來' }
    ],
    example: [
      { name: '人事處', note: '處長 1 人' },
      { name: '綜合規劃科', note: '編制 8 人', parent: '人事處' },
      { name: '任免遷調科', note: '編制 10 人', parent: '人事處', focal: true },
      { name: '考訓福利科', note: '編制 9 人', parent: '人事處' },
      { name: '法制小組', parent: '綜合規劃科' },
      { name: '研考小組', parent: '綜合規劃科' },
      { name: '陞遷小組', parent: '任免遷調科' }
    ],
    build: function (rows, meta, opts) {
      var warnings = [];
      var nodes = [];
      var byName = {};
      (rows || []).forEach(function (row, i) {
        var name = String(row.name || '').trim();
        if (!name) { if (String(row.note || '').trim()) warnings.push('第 ' + (i + 1) + ' 列沒有填單位名稱，跳過了。'); return; }
        if (byName[name] != null) {
          warnings.push('「' + name + '」出現了兩次。單位名稱要不一樣，不然「上級」分不出你指的是哪一個。');
          return;
        }
        var n = { name: name, note: String(row.note || '').trim(), focal: !!row.focal,
          parentName: String(row.parent || '').trim(), parent: -1, kids: [] };
        byName[name] = nodes.length;
        nodes.push(n);
      });

      var roots = [];
      nodes.forEach(function (n, i) {
        if (!n.parentName) { roots.push(i); return; }
        var p = byName[n.parentName];
        /* 上級要在自己前面：指到後面（或指到自己）會繞成一個圈，畫不出來 */
        if (p == null || p >= i) {
          warnings.push('「' + n.name + '」的上級「' + n.parentName +
            '」不在它前面，先當成最上層畫。上級要選前面已經填過的單位。');
          roots.push(i);
          return;
        }
        n.parent = p;
        nodes[p].kids.push(i);
      });

      if (!nodes.length) {
        return { svg: emptyCanvas('在左邊填單位名稱與上級，這裡就會出現組織圖'), warnings: warnings, count: 0 };
      }
      if (roots.length > 1) {
        warnings.push('有 ' + roots.length + ' 個單位沒有上級，會並排在最上面一層。' +
          '如果不是故意的，把它們的「上級」補上。');
      }

      /* 一、算每個節點的深度 */
      var depth = nodes.map(function () { return 0; });
      nodes.forEach(function (n, i) { if (n.parent >= 0) depth[i] = depth[n.parent] + 1; });
      var maxDepth = depth.reduce(function (a, b) { return Math.max(a, b); }, 0);

      /* 二、葉子由左而右排，父節點置中在子節點上方（後序走訪） */
      var cursor = 0;
      var cx = nodes.map(function () { return 0; });
      var slot = ORG.boxW + ORG.gapX;
      function place(i) {
        var kids = nodes[i].kids;
        if (!kids.length) { cx[i] = cursor * slot; cursor++; return; }
        kids.forEach(place);
        cx[i] = (cx[kids[0]] + cx[kids[kids.length - 1]]) / 2;
      }
      roots.forEach(place);

      /* 三、整棵樹置中，太寬就整體縮小——寧可小一點也不要畫到框外 */
      var minX = Infinity, maxX = -Infinity;
      cx.forEach(function (v) { if (v < minX) minX = v; if (v > maxX) maxX = v; });
      var treeW = maxX - minX + ORG.boxW;
      var scale = Math.min(1, (W - 80) / treeW);
      if (scale < 1) {
        warnings.push('單位有點多，整張圖縮小到 ' + Math.round(scale * 100) +
          '% 才放得下。字會變小，必要時拆成兩張圖。');
      }
      var offset = (W - treeW * scale) / 2 - minX * scale;
      var px = cx.map(function (v) { return v * scale + offset + ORG.boxW * scale / 2; });

      var bw = ORG.boxW * scale, bh = ORG.boxH;
      var py = depth.map(function (d) { return ORG.top + d * (bh + ORG.gapY); });
      var H = ORG.top + (maxDepth + 1) * (bh + ORG.gapY) + 60;
      var out = [canvasOpen(H, '組織圖')];

      /* 連線：父到子走「下、橫、下」的直角線，斜線在組織圖裡看起來很亂 */
      nodes.forEach(function (n, i) {
        if (!n.kids.length) return;
        var midY = py[i] + bh + ORG.gapY / 2;
        out.push('<line x1="' + r1(px[i]) + '" y1="' + r1(py[i] + bh) + '" x2="' + r1(px[i]) +
          '" y2="' + r1(midY) + '" stroke="' + C.muted + '" stroke-width="1.1"/>');
        var xs = n.kids.map(function (k) { return px[k]; });
        out.push('<line x1="' + r1(Math.min.apply(null, xs)) + '" y1="' + r1(midY) + '" x2="' +
          r1(Math.max.apply(null, xs)) + '" y2="' + r1(midY) + '" stroke="' + C.muted + '" stroke-width="1.1"/>');
        n.kids.forEach(function (k) {
          out.push('<line x1="' + r1(px[k]) + '" y1="' + r1(midY) + '" x2="' + r1(px[k]) +
            '" y2="' + r1(py[k] - 2) + '" stroke="' + C.muted +
            '" stroke-width="1.1" marker-end="url(#ddg-arrow)"/>');
        });
      });

      nodes.forEach(function (n, i) {
        var fs = Math.max(9, 12.5 * Math.min(1, scale + 0.2));
        var lines = DD.wrapLabel(n.name, (bw - 16) / fs).slice(0, 2);
        out.push('<rect x="' + r1(px[i] - bw / 2) + '" y="' + r1(py[i]) + '" width="' + r1(bw) +
          '" height="' + bh + '" rx="6" fill="' + (n.focal ? 'rgba(235,108,54,0.08)' : '#ffffff') +
          '" stroke="' + (n.focal ? C.accent : C.ink) + '" stroke-width="1"/>');
        var ty = py[i] + bh / 2 + (n.note ? -3 : 4) - (lines.length - 1) * 7;
        lines.forEach(function (ln, k) {
          out.push(text(px[i], ty + k * 15, ln,
            { fill: C.ink, size: fs, weight: '600', anchor: 'middle' }));
        });
        if (n.note) {
          out.push(text(px[i], py[i] + bh / 2 + (lines.length - 1) * 7 + 14, n.note,
            { fill: C.muted, size: 8.5, font: F.mono, anchor: 'middle' }));
        }
      });

      out.push(legend(H - 44, [
        { name: '單位', mark: swatchRect('#ffffff', C.ink, 3) },
        { name: '重點單位', mark: swatchRect('rgba(235,108,54,0.08)', C.accent, 3) },
        { name: '上下層級', mark: swatchLine(C.muted) }
      ]));
      out.push('</svg>');
      return { svg: out.join(''), warnings: warnings, count: nodes.length };
    }
  };

  /* ══ 七、泳道圖 ═══════════════════════════════════════════════════
     一條泳道一個單位，步驟由左而右照填的順序走。換泳道時線會斜著跨過去，
     那條斜線就是「案子從這一科交到那一科」——泳道圖的重點就是這個。 */

  var LANE = { x: 150, top: 66, laneH: 92, boxW: 112, boxH: 46, gapX: 24 };

  var swimlaneGen = {
    id: 'swimlane',
    name: '泳道圖',
    use: '跨科室的案件流轉：哪一段是誰做的、案子在哪裡交接。',
    sample: 'example-swimlane',
    sampleTitle: '跨科室案件流轉',
    help: [
      '一條泳道一個單位。泳道的順序＝各單位第一次出現的順序。',
      '步驟由左而右照你填的順序走，不必自己對齊。',
      '同一個單位連續做好幾步就填好幾列，換人做就換「負責單位」。',
      '單位不要超過五個、步驟不要超過八個，不然會擠到看不清楚。'
    ],
    rowName: '步驟',
    fields: [
      { key: 'lane', label: '負責單位', type: 'text', placeholder: '收發室', width: '170px' },
      { key: 'main', label: '步驟', type: 'text', placeholder: '收文登記' },
      { key: 'sub', label: '小字（可留空）', type: 'text', placeholder: '當日' },
      { key: 'focal', label: '重點', type: 'check', width: '64px',
        hint: '勾了會用強調色框起來' }
    ],
    example: [
      { lane: '收發室', main: '收文登記', sub: '當日' },
      { lane: '承辦科', main: '簽辦擬稿', sub: '3 日內' },
      { lane: '法制科', main: '法規審查', focal: true },
      { lane: '承辦科', main: '修正後陳核' },
      { lane: '主任秘書', main: '核判' },
      { lane: '收發室', main: '發文歸檔' }
    ],
    build: function (rows, meta, opts) {
      var warnings = [];
      var steps = [];
      var lanes = [];
      (rows || []).forEach(function (row, i) {
        var main = String(row.main || '').trim();
        var lane = String(row.lane || '').trim();
        if (!main && !lane) return;
        if (!main) { warnings.push('第 ' + (i + 1) + ' 列沒有填步驟，跳過了。'); return; }
        if (!lane) { warnings.push('「' + main + '」沒有填負責單位，先放在第一條泳道。'); lane = lanes[0] || '未指定'; }
        if (lanes.indexOf(lane) < 0) lanes.push(lane);
        steps.push({ lane: lane, main: main, sub: String(row.sub || '').trim(), focal: !!row.focal });
      });

      if (!steps.length) {
        return { svg: emptyCanvas('在左邊填負責單位與步驟，這裡就會出現泳道圖'), warnings: warnings, count: 0 };
      }
      if (lanes.length > 6) {
        warnings.push('有 ' + lanes.length + ' 個單位，泳道會很擠。建議併一併或拆成兩張圖。');
      }

      /* 步驟太多就縮小格子，寧可小一點也不要畫到框外 */
      var avail = W - LANE.x - 40;
      var bw = LANE.boxW, gap = LANE.gapX;
      var need = steps.length * bw + (steps.length - 1) * gap;
      if (need > avail) {
        var k = avail / need;
        bw = Math.max(64, bw * k);
        gap = Math.max(16, gap * k);
        warnings.push('步驟有點多，格子縮小了才放得下。超過八個步驟建議拆成兩張圖。');
      }

      var laneH = LANE.laneH;
      var H = LANE.top + lanes.length * laneH + 76;
      var out = [canvasOpen(H, '泳道圖')];
      var laneY = function (name) { return LANE.top + lanes.indexOf(name) * laneH; };

      lanes.forEach(function (name, i) {
        var y = LANE.top + i * laneH;
        out.push('<rect x="40" y="' + r1(y) + '" width="' + (W - 80) + '" height="' + laneH +
          '" fill="' + (i % 2 ? 'rgba(45,49,66,0.025)' : 'transparent') +
          '" stroke="rgba(45,49,66,0.12)" stroke-width="0.8"/>');
        out.push('<line x1="' + LANE.x + '" y1="' + r1(y) + '" x2="' + LANE.x + '" y2="' + r1(y + laneH) +
          '" stroke="rgba(45,49,66,0.12)" stroke-width="0.8"/>');
        var nm = DD.wrapLabel(name, 88 / 12).slice(0, 3);
        nm.forEach(function (ln, k) {
          out.push(text(95, y + laneH / 2 + 4 + (k - (nm.length - 1) / 2) * 15, ln,
            { fill: C.ink, size: 11.5, weight: '600', anchor: 'middle' }));
        });
      });

      var sx = steps.map(function (s, i) { return LANE.x + 26 + i * (bw + gap); });
      var sy = steps.map(function (s) { return laneY(s.lane) + laneH / 2 - LANE.boxH / 2; });

      /* 先畫線：同一條泳道就走直的，換泳道就斜著跨過去——那條斜線就是交接 */
      steps.forEach(function (s, i) {
        var next = steps[i + 1];
        if (!next) return;
        var x0 = sx[i] + bw, x1 = sx[i + 1];
        var y0 = sy[i] + LANE.boxH / 2, y1 = sy[i + 1] + LANE.boxH / 2;
        var cross = s.lane !== next.lane;
        out.push('<path d="M ' + r1(x0) + ' ' + r1(y0) + ' C ' + r1(x0 + (x1 - x0) * 0.5) + ' ' + r1(y0) +
          ', ' + r1(x0 + (x1 - x0) * 0.5) + ' ' + r1(y1) + ', ' + r1(x1 - 3) + ' ' + r1(y1) +
          '" fill="none" stroke="' + (cross ? C.accent : C.muted) + '" stroke-width="' + (cross ? 1.4 : 1.2) +
          '" marker-end="url(#ddg-arrow' + (cross ? '-accent' : '') + ')"/>');
      });

      steps.forEach(function (s, i) {
        var fs = Math.max(9, Math.min(12, bw / 11));
        var lines = DD.wrapLabel(s.main, (bw - 14) / fs).slice(0, 2);
        out.push('<rect x="' + r1(sx[i]) + '" y="' + r1(sy[i]) + '" width="' + r1(bw) +
          '" height="' + LANE.boxH + '" rx="6" fill="' + (s.focal ? 'rgba(235,108,54,0.08)' : '#ffffff') +
          '" stroke="' + (s.focal ? C.accent : C.ink) + '" stroke-width="1"/>');
        var cxx = sx[i] + bw / 2;
        var ty = sy[i] + LANE.boxH / 2 + (s.sub ? -3 : 4) - (lines.length - 1) * 6.5;
        lines.forEach(function (ln, k) {
          out.push(text(cxx, ty + k * 14, ln, { fill: C.ink, size: fs, weight: '600', anchor: 'middle' }));
        });
        if (s.sub) {
          out.push(text(cxx, sy[i] + LANE.boxH / 2 + (lines.length - 1) * 6.5 + 13, s.sub,
            { fill: C.muted, size: 8, font: F.mono, anchor: 'middle' }));
        }
        out.push(text(sx[i] + bw / 2, sy[i] - 8, String(i + 1),
          { fill: C.muted, size: 8, font: F.mono, anchor: 'middle' }));
      });

      out.push(legend(H - 44, [
        { name: '步驟', mark: swatchRect('#ffffff', C.ink, 3) },
        { name: '重點步驟', mark: swatchRect('rgba(235,108,54,0.08)', C.accent, 3) },
        { name: '換單位（交接）', mark: swatchLine(C.accent) },
        { name: '同單位接著做', mark: swatchLine(C.muted) }
      ]));
      out.push('</svg>');
      return { svg: out.join(''), warnings: warnings, count: steps.length };
    }
  };

  /* ══ 八、家系圖 ═══════════════════════════════════════════════════
     社工用的 genogram。符號照 McGoldrick 那一套通用慣例畫：

       男□　女○　性別不明◇　案主雙框　已歿打叉
       伴侶線橫的接兩個人，男左女右；婚姻狀態畫在線上（分居一撇、離婚兩撇）
       子女從伴侶線中點垂下，長子在左；收養虛線、寄養點線
       情感關係是「第二層」，另外用強調色畫（親近雙線、衝突鋸齒、斷絕兩撇…）

     為什麼一張表就填得完：一列可以是「成員」「伴侶關係」或「情感關係」，
     用型別欄分。成員那一列填「父親是誰、母親是誰」，手足與世代由程式算——
     社工填的時候只要一個一個人往下加，不必自己想版面。 */

  var GENO = {
    size: 46, gapX: 46, coupleGap: 96, genH: 150, top: 74, left: 46, right: 954
  };

  var SEX_OPTIONS = [
    { value: 'm', label: '男' },
    { value: 'f', label: '女' },
    { value: 'u', label: '不明' }
  ];
  var CHILD_OPTIONS = [
    { value: 'bio', label: '親生' },
    { value: 'adopt', label: '收養' },
    { value: 'foster', label: '寄養' }
  ];
  var UNION_OPTIONS = [
    { value: 'married', label: '結婚' },
    { value: 'cohabit', label: '同居' },
    { value: 'separated', label: '分居' },
    { value: 'divorced', label: '離婚' },
    { value: 'ended', label: '關係結束' }
  ];
  var BOND_OPTIONS = [
    { value: 'close', label: '親近' },
    { value: 'fused', label: '非常親近' },
    { value: 'distant', label: '疏遠' },
    { value: 'conflict', label: '衝突' },
    { value: 'cutoff', label: '斷絕往來' },
    { value: 'abuse', label: '暴力／虐待' }
  ];
  var GENO_KIND_OPTIONS = [
    { value: 'person', label: '成員' },
    { value: 'union', label: '伴侶關係' },
    { value: 'bond', label: '情感關係' }
  ];

  function optLabel(opts, v) {
    for (var i = 0; i < opts.length; i++) if (opts[i].value === v) return opts[i].label;
    return opts[0].label;
  }

  var genogramGen = {
    id: 'genogram',
    name: '家系圖',
    use: '社工用的家系圖（genogram）：三代成員、婚姻狀態、情感關係，符號照通用慣例。',
    sampleTitle: '個案家庭關係圖',
    rowName: '列',
    help: [
      '先填寫成員，填寫完畢後再選擇關係。',
      '父母只能選前面已經填過的成員，所以由上而下（祖父母 → 父母 → 子女）填最順。',
      '符號：男□、女○、性別不明◇、案主雙框、已歿打叉；一男一女的伴侶男左女右。'
    ],
    /* 一張表分兩段：成員填完才輪到關係。三種列全混在一條長表裡時，
       使用者看到的是「一列一列長得都不一樣」，第一個問的就是「這是什麼意思」。 */
    groups: [
      { id: 'member', title: '成員', rowName: '成員', kinds: ['person'], add: '＋ 新增成員' },
      { id: 'link', title: '關係', rowName: '關係', kinds: ['union', 'bond'], add: '＋ 新增關係',
        needs: { kinds: ['person'], min: 2, msg: '先填兩位以上的成員，才能建立關係。' } }
    ],
    fields: [
      /* 124px：104 的話「伴侶關係」四個字會被下拉箭頭壓到 */
      { key: 'kind', label: '型別', type: 'select', options: GENO_KIND_OPTIONS, width: '124px' },

      /* 姓名只有「成員」那種列才有意義。不加 only 的話，伴侶關係那一列上面會杵著一個
         填了也不會怎樣的姓名欄，整列看起來就像「一個沒有年齡的人」——使用者第一個問的就是這個。
         （而且填進去的字會跑進後面幾列的下拉選單裡，變成一個根本不存在的成員。） */
      { key: 'name', label: '姓名／稱謂', type: 'text', only: 'person' },
      { key: 'sex', label: '性別', type: 'select', options: SEX_OPTIONS, width: '88px', only: 'person' },
      { key: 'age', label: '年齡', type: 'text', width: '84px', only: 'person' },
      { key: 'father', label: '父親', type: 'rowref', width: '150px', only: 'person' },
      { key: 'mother', label: '母親', type: 'rowref', width: '150px', only: 'person' },
      { key: 'childType', label: '與父母', type: 'select', options: CHILD_OPTIONS, width: '104px', only: 'person' },
      { key: 'note', label: '註記（可留空）', type: 'text', only: 'person' },
      { key: 'index', label: '案主', type: 'check', width: '72px', only: 'person',
        hint: '案主畫成雙框，一張圖標一個' },
      { key: 'dead', label: '已歿', type: 'check', width: '72px', only: 'person',
        hint: '已歿的成員符號上會打一個叉' },

      /* 標題要看得出「這一列是把兩個已經填過的人連起來」，不是在新增一個人 */
      { key: 'a', label: '伴侶', type: 'rowref', width: '160px', only: 'union' },
      { key: 'b', label: '和哪一位', type: 'rowref', width: '160px', only: 'union' },
      { key: 'union', label: '狀態', type: 'select', options: UNION_OPTIONS, width: '116px', only: 'union' },
      { key: 'year', label: '年份（可留空）', type: 'text', width: '128px', only: 'union' },

      { key: 'ba', label: '成員', type: 'rowref', width: '160px', only: 'bond' },
      { key: 'bb', label: '和哪一位', type: 'rowref', width: '160px', only: 'bond' },
      { key: 'bond', label: '情感關係', type: 'select', options: BOND_OPTIONS, width: '134px', only: 'bond' }
    ],
    /* 範例用稱謂不用姓名：家系圖看的是關係，寫「父」「案主」一眼就懂是誰對誰，
       寫「陳志明」還要先回頭對一次那是誰。真的要寫姓名也填得下去。 */
    example: [
      { kind: 'person', name: '祖父', sex: 'm', age: '78', dead: true, note: '肝癌過世' },
      { kind: 'person', name: '祖母', sex: 'f', age: '75', note: '獨居' },
      { kind: 'person', name: '父', sex: 'm', age: '52', father: '祖父', mother: '祖母', note: '長期失業' },
      { kind: 'person', name: '姑姑', sex: 'f', age: '49', father: '祖父', mother: '祖母', note: '定居國外' },
      { kind: 'person', name: '母', sex: 'f', age: '48', note: '早餐店打工' },
      { kind: 'person', name: '案主', sex: 'f', age: '16', father: '父', mother: '母', index: true, note: '國中三年級' },
      { kind: 'person', name: '弟', sex: 'm', age: '12', father: '父', mother: '母', note: '國小六年級' },
      { kind: 'union', name: '', a: '祖父', b: '祖母', union: 'married', year: '55' },
      { kind: 'union', name: '', a: '父', b: '母', union: 'separated', year: '85' },
      { kind: 'bond', name: '', ba: '父', bb: '案主', bond: 'conflict' },
      { kind: 'bond', name: '', ba: '母', bb: '案主', bond: 'close' },
      { kind: 'bond', name: '', ba: '祖母', bb: '案主', bond: 'fused' },
      { kind: 'bond', name: '', ba: '祖父', bb: '姑姑', bond: 'cutoff' }
    ],
    build: function (rows, meta, opts) {
      var warnings = [];
      var people = [];
      var byName = {};
      var unions = [];
      var bonds = [];
      /* count 的語意是「有用到的列數」，一列可以是成員、伴侶關係或情感關係。
         回人數的話，畫面上會說「目前 7 個列」但表單裡明明有 13 列。 */
      var used = 0;

      /* ── 一、讀進來 ───────────────────────────────────────────── */
      (rows || []).forEach(function (row, i) {
        var kind = row.kind || 'person';
        var name = String(row.name || '').trim();

        if (kind === 'person') {
          if (!name) {
            if (String(row.age || '').trim() || String(row.note || '').trim()) {
              warnings.push('第 ' + (i + 1) + ' 列沒有填姓名，跳過了。');
            }
            return;
          }
          if (byName[name] != null) {
            warnings.push('「' + name + '」出現了兩次。姓名要不一樣，' +
              '不然「父親」「母親」分不出你指的是哪一個（同名可以寫成「陳志明（父）」）。');
            return;
          }
          byName[name] = people.length;
          used++;
          people.push({
            name: name, sex: (row.sex === 'f' || row.sex === 'u') ? row.sex : 'm',
            age: String(row.age || '').trim(), note: String(row.note || '').trim(),
            index: !!row.index, dead: !!row.dead,
            childType: optValue(CHILD_OPTIONS, row.childType),
            fatherName: String(row.father || '').trim(),
            motherName: String(row.mother || '').trim(),
            father: -1, mother: -1, gen: 0, x: 0, spouses: []
          });
          return;
        }

        if (kind === 'union') {
          var ua = String(row.a || '').trim(), ub = String(row.b || '').trim();
          if (!ua && !ub) return;
          used++;
          unions.push({ line: i + 1, aName: ua, bName: ub,
            status: optValue(UNION_OPTIONS, row.union), year: String(row.year || '').trim() });
          return;
        }

        var xa = String(row.ba || '').trim(), xb = String(row.bb || '').trim();
        if (!xa && !xb) return;
        used++;
        bonds.push({ line: i + 1, aName: xa, bName: xb, type: optValue(BOND_OPTIONS, row.bond) });
      });

      if (!people.length) {
        return { svg: emptyCanvas('在左邊填家庭成員（姓名、性別、父母是誰），這裡就會出現家系圖'),
          warnings: warnings, count: 0 };
      }

      /* ── 二、把「誰的父母」接起來。父母一定要在自己前面，不然會繞成圈 ── */
      people.forEach(function (p, i) {
        ['father', 'mother'].forEach(function (key) {
          var want = p[key + 'Name'];
          if (!want) return;
          var j = byName[want];
          if (j == null || j >= i) {
            warnings.push('「' + p.name + '」的' + (key === 'father' ? '父親' : '母親') +
              '「' + want + '」不在它前面，先當成沒有填。由上而下（祖父母 → 父母 → 子女）填最順。');
            return;
          }
          p[key] = j;
        });
        if (p.father >= 0 && p.father === p.mother) {
          warnings.push('「' + p.name + '」的父親與母親填成同一個人，已忽略母親那一欄。');
          p.mother = -1;
        }
      });

      var indexN = people.filter(function (p) { return p.index; }).length;
      if (indexN > 1) {
        warnings.push('有 ' + indexN + ' 個人勾了「案主」。家系圖慣例是一張圖標一個案主。');
      }

      /* ── 三、伴侶關係 ─────────────────────────────────────────── */
      unions.forEach(function (u) {
        var ia = byName[u.aName], ib = byName[u.bName];
        if (ia == null || ib == null || ia === ib) {
          warnings.push('第 ' + u.line + ' 列的伴侶關係「' + (u.aName || '（空白）') + '」與「' +
            (u.bName || '（空白）') + '」有一邊不是已填過的成員，這條線畫不出來。');
          u.skip = true;
          return;
        }
        u.a = ia; u.b = ib;
        if (people[ia].spouses.indexOf(ib) < 0) people[ia].spouses.push(ib);
        if (people[ib].spouses.indexOf(ia) < 0) people[ib].spouses.push(ia);
      });

      /* 有共同子女卻沒填伴侶關係：照樣要有一條線，不然子女會憑空垂下來 */
      var pairSeen = {};
      unions.forEach(function (u) { if (!u.skip) pairSeen[pairKey(u.a, u.b)] = true; });
      people.forEach(function (p) {
        if (p.father < 0 || p.mother < 0) return;
        var k = pairKey(p.father, p.mother);
        if (pairSeen[k]) return;
        pairSeen[k] = true;
        unions.push({ a: p.father, b: p.mother, status: 'implied', year: '' });
        if (people[p.father].spouses.indexOf(p.mother) < 0) people[p.father].spouses.push(p.mother);
        if (people[p.mother].spouses.indexOf(p.father) < 0) people[p.mother].spouses.push(p.father);
      });

      /* ── 四、世代 ─────────────────────────────────────────────
         有父母的就是父母那一代 + 1；沒父母但有配偶的，跟著配偶走
         （嫁進來、娶進來的那一位，家系圖上要跟配偶同一排）。 */
      people.forEach(function (p) {
        var g = 0;
        if (p.father >= 0) g = Math.max(g, people[p.father].gen + 1);
        if (p.mother >= 0) g = Math.max(g, people[p.mother].gen + 1);
        p.gen = g;
        p.rooted = p.father >= 0 || p.mother >= 0;
      });
      for (var pass = 0; pass < 4; pass++) {
        people.forEach(function (p) {
          if (p.rooted) return;
          p.spouses.forEach(function (s) {
            if (people[s].gen > p.gen) p.gen = people[s].gen;
          });
        });
      }
      var maxGen = people.reduce(function (m, p) { return Math.max(m, p.gen); }, 0);

      /* ── 五、排位置 ───────────────────────────────────────────
         一代一排。同一代裡照「父母排在哪裡」由左而右，配偶緊貼著放。
         子女整組置中在父母中點下方，位置不夠就往右挪（不重疊優先）。 */
      var placed = {};
      var slot = GENO.size + GENO.gapX;
      for (var g = 0; g <= maxGen; g++) {
        var order = [];
        people.forEach(function (p, i) { if (p.gen === g) order.push(i); });
        if (g > 0) {
          order.sort(function (i, j) {
            var a = parentMid(people, i), b = parentMid(people, j);
            if (a == null && b == null) return i - j;
            if (a == null) return 1;
            if (b == null) return -1;
            return a - b || i - j;
          });
        }
        var cursor = GENO.left;
        order.forEach(function (i) {
          if (placed[i]) return;
          var unit = [i];
          people[i].spouses.forEach(function (s) {
            if (people[s].gen === g && !placed[s] && unit.indexOf(s) < 0) unit.push(s);
          });
          /* 慣例：男左女右。兩個人的時候才調 */
          if (unit.length === 2 && people[unit[0]].sex === 'f' && people[unit[1]].sex === 'm') {
            unit = [unit[1], unit[0]];
          }
          /* 再婚：結過兩次以上的那一位排中間，前一段在左、後面的往右接。
             照填的順序一路往右排的話，「他跟第二任」那條線會從「第一任」頭上跨過去。 */
          if (unit.length > 2) {
            var others = unit.slice(1);
            unit = [others[0], i].concat(others.slice(1));
          }
          var width = unit.length * GENO.size + (unit.length - 1) * GENO.coupleGap;
          var mid = null;
          unit.forEach(function (k) { if (mid == null) mid = parentMid(people, k); });
          var x0 = mid == null ? cursor : Math.max(cursor, mid - width / 2);
          unit.forEach(function (k, n) {
            people[k].x = x0 + n * (GENO.size + GENO.coupleGap);
            placed[k] = true;
          });
          cursor = x0 + width + GENO.gapX;
        });
      }

      /* 太寬就整張縮小，寧可小一點也不要畫到框外 */
      var minX = Infinity, maxX = -Infinity;
      people.forEach(function (p) {
        if (p.x < minX) minX = p.x;
        if (p.x + GENO.size > maxX) maxX = p.x + GENO.size;
      });
      var span = maxX - minX;
      var avail = GENO.right - GENO.left;
      var scale = Math.min(1, avail / Math.max(1, span));
      if (scale < 0.999) {
        warnings.push('成員有點多，整張圖縮小到 ' + Math.round(scale * 100) +
          '% 才放得下。字會變小，必要時拆成兩張（例如父系一張、母系一張）。');
      }
      var offset = GENO.left + (avail - span * scale) / 2 - minX * scale;
      var sz = GENO.size * scale;
      people.forEach(function (p) {
        p.px = p.x * scale + offset;
        p.py = GENO.top + p.gen * GENO.genH;
        p.cx = p.px + sz / 2;
        p.cy = p.py + sz / 2;
      });

      /* ── 六、畫 ───────────────────────────────────────────────── */
      var H = GENO.top + (maxGen + 1) * GENO.genH + 30;
      var out = [canvasOpen(H, '家系圖')];

      /* 伴侶線與子女線 */
      var kids = {};
      var unionTags = [];
      people.forEach(function (p, i) {
        if (p.father < 0 && p.mother < 0) return;
        var k = pairKey(p.father, p.mother);
        (kids[k] = kids[k] || []).push(i);
      });

      unions.forEach(function (u) {
        if (u.skip) return;
        var a = people[u.a], b = people[u.b];
        var left = a.cx < b.cx ? a : b, right = a.cx < b.cx ? b : a;
        var y = left.cy;
        var x1 = left.px + sz, x2 = right.px;
        if (x2 < x1) { x1 = right.px + sz; x2 = left.px; y = right.cy; }
        var dash = (u.status === 'cohabit' || u.status === 'ended') ? ' stroke-dasharray="6 4"' : '';

        /* 兩人中間卡著別人時（再婚三段以上，或配偶早就被排到別處），伴侶線要繞到上面走。
           直接連過去的話，線會從中間那個人的符號正中央穿過，看起來像他也在這段婚姻裡。 */
        var block = unionBlockers(people, u, x1, x2, sz);
        var linkY = y, mx = (x1 + x2) / 2;
        if (block.length) {
          linkY = Math.min(left.py, right.py) - 18;
          out.push('<polyline points="' + r1(x1) + ',' + r1(y) + ' ' + r1(x1) + ',' + r1(linkY) +
            ' ' + r1(x2) + ',' + r1(linkY) + ' ' + r1(x2) + ',' + r1(y) +
            '" fill="none" stroke="' + C.ink + '" stroke-width="1.3"' + dash + '/>');
          /* 標記與子女線改走空隙，不然會蓋在中間那個人的頭上 */
          mx = clearDropX(block, x1, x2, sz);
        } else {
          out.push('<line x1="' + r1(x1) + '" y1="' + r1(y) + '" x2="' + r1(x2) + '" y2="' + r1(y) +
            '" stroke="' + C.ink + '" stroke-width="1.3"' + dash + '/>');
        }

        /* 分居一撇、離婚兩撇——這是家系圖上最要緊的一個資訊 */
        var slashes = u.status === 'separated' ? 1 : (u.status === 'divorced' ? 2 : 0);
        for (var n = 0; n < slashes; n++) {
          var sx = mx + (n - (slashes - 1) / 2) * 9;
          out.push('<line x1="' + r1(sx - 5) + '" y1="' + r1(linkY + 8) + '" x2="' + r1(sx + 5) +
            '" y2="' + r1(linkY - 8) + '" stroke="' + C.ink + '" stroke-width="1.3"/>');
        }
        if (u.status !== 'implied') {
          /* 標籤留到最後才畫：情感關係的弧線常常從這裡擦過去，先畫會被蓋掉 */
          var tag = optLabel(UNION_OPTIONS, u.status) + (u.year ? ' ' + u.year : '');
          unionTags.push(paperBox(mx, linkY - 12, tag, 8.5) +
            text(mx, linkY - 12, tag, { fill: C.muted, size: 8.5, font: F.mono, anchor: 'middle' }));
        }

        /* 這一對的子女：從伴侶線中點垂下，再一條手足橫線 */
        var mine = kids[pairKey(u.a, u.b)];
        if (!mine || !mine.length) return;
        drawChildren(out, people, mine, mx, linkY, sz);
        delete kids[pairKey(u.a, u.b)];
      });

      /* 只有單親的子女：從那一個人底下垂下來 */
      Object.keys(kids).forEach(function (k) {
        var mine = kids[k];
        var one = people[mine[0]].father >= 0 ? people[mine[0]].father : people[mine[0]].mother;
        if (one < 0) return;
        drawChildren(out, people, mine, people[one].cx, people[one].py + sz, sz);
      });

      /* 情感關係：第二層，用強調色，畫在成員之間 */
      bonds.forEach(function (bd) {
        var ia = byName[bd.aName], ib = byName[bd.bName];
        if (ia == null || ib == null || ia === ib) {
          warnings.push('第 ' + bd.line + ' 列的情感關係「' + (bd.aName || '（空白）') + '」與「' +
            (bd.bName || '（空白）') + '」有一邊不是已填過的成員，這條線畫不出來。');
          return;
        }
        out.push(bondPath(people[ia], people[ib], bd.type, sz));
      });

      /* 成員符號與伴侶標籤最後畫：它們都墊了紙色底，蓋在線上面才看得清楚 */
      people.forEach(function (p) { out.push(personGlyph(p, sz, scale)); });
      out = out.concat(unionTags);

      out.push(genoLegend(H - 44, people, bonds));
      out.push('</svg>');
      return { svg: out.join(''), warnings: warnings, count: used };
    }
  };

  /** 文字底下墊一塊紙色：線從旁邊經過時才不會把字劃掉。 */
  function paperBox(cx, baseline, str, fs) {
    var w = DD.textUnits(str) * fs + 7;
    return '<rect x="' + r1(cx - w / 2) + '" y="' + r1(baseline - fs * 0.86) + '" width="' + r1(w) +
      '" height="' + r1(fs * 1.24) + '" fill="' + C.paper + '"/>';
  }

  function optValue(opts, v) {
    for (var i = 0; i < opts.length; i++) if (opts[i].value === v) return v;
    return opts[0].value;
  }

  function pairKey(a, b) { return Math.min(a, b) + '|' + Math.max(a, b); }

  function parentMid(people, i) {
    var p = people[i];
    var xs = [];
    if (p.father >= 0) xs.push(people[p.father].x + GENO.size / 2);
    if (p.mother >= 0) xs.push(people[p.mother].x + GENO.size / 2);
    if (!xs.length) return null;
    return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
  }

  /** 這一對之間卡著哪些人：同一代、又橫在兩個符號中間的。 */
  function unionBlockers(people, u, x1, x2, sz) {
    var ga = people[u.a].gen, gb = people[u.b].gen, out = [];
    people.forEach(function (p, i) {
      if (i === u.a || i === u.b) return;
      if (p.gen !== ga && p.gen !== gb) return;
      if (p.px + sz > x1 + 1 && p.px < x2 - 1) out.push(p);
    });
    return out;
  }

  /** 繞上去之後，子女線從哪裡垂下來：挑靠近另一半那一側的空隙。
      挑中間的空隙會直接穿過中間那個人自己的婚姻線，兩條結構線交叉在一起就看不出誰是誰的。
      那一段太窄時才退回「最寬的一段」。 */
  function clearDropX(block, x1, x2, sz) {
    var gaps = [], cursor = x1;
    block.slice().sort(function (p, q) { return p.px - q.px; }).forEach(function (p) {
      if (p.px - 8 > cursor) gaps.push([cursor, p.px - 8]);
      cursor = Math.max(cursor, p.px + sz + 8);
    });
    if (x2 > cursor) gaps.push([cursor, x2]);
    if (!gaps.length) return (x1 + x2) / 2;
    var pick = gaps[gaps.length - 1];
    if (pick[1] - pick[0] < 24) {
      gaps.forEach(function (g) { if (g[1] - g[0] > pick[1] - pick[0]) pick = g; });
    }
    return (pick[0] + pick[1]) / 2;
  }

  /** 子女：伴侶線中點垂下 → 手足橫線 → 各自垂下。長子在左（照填的順序）。 */
  function drawChildren(out, people, idx, mx, my, sz) {
    var sorted = idx.slice().sort(function (a, b) { return people[a].cx - people[b].cx; });
    var barY = people[sorted[0]].py - 26;
    out.push('<line x1="' + r1(mx) + '" y1="' + r1(my) + '" x2="' + r1(mx) + '" y2="' + r1(barY) +
      '" stroke="' + C.ink + '" stroke-width="1.3"/>');
    var x1 = people[sorted[0]].cx, x2 = people[sorted[sorted.length - 1]].cx;
    if (sorted.length > 1) {
      out.push('<line x1="' + r1(Math.min(x1, mx)) + '" y1="' + r1(barY) + '" x2="' + r1(Math.max(x2, mx)) +
        '" y2="' + r1(barY) + '" stroke="' + C.ink + '" stroke-width="1.3"/>');
    } else if (Math.abs(x1 - mx) > 1) {
      out.push('<line x1="' + r1(mx) + '" y1="' + r1(barY) + '" x2="' + r1(x1) + '" y2="' + r1(barY) +
        '" stroke="' + C.ink + '" stroke-width="1.3"/>');
    }
    sorted.forEach(function (i) {
      var p = people[i];
      var dash = p.childType === 'adopt' ? ' stroke-dasharray="6 4"'
        : (p.childType === 'foster' ? ' stroke-dasharray="2 3"' : '');
      out.push('<line x1="' + r1(p.cx) + '" y1="' + r1(barY) + '" x2="' + r1(p.cx) + '" y2="' + r1(p.py) +
        '" stroke="' + C.ink + '" stroke-width="1.3"' + dash + '/>');
    });
  }

  /** 一個成員：男□女○不明◇，案主雙框，已歿打叉，年齡在裡面、姓名在下面。 */
  function personGlyph(p, sz, scale) {
    var out = [];
    var stroke = p.index ? C.accent : C.ink;
    out.push(sexShape(p, p.px, p.py, sz, stroke, 1.4));
    if (p.index) out.push(sexShape(p, p.px + 4, p.py + 4, sz - 8, stroke, 1.1));
    if (p.dead) {
      out.push('<line x1="' + r1(p.px + 3) + '" y1="' + r1(p.py + 3) + '" x2="' + r1(p.px + sz - 3) +
        '" y2="' + r1(p.py + sz - 3) + '" stroke="' + C.ink + '" stroke-width="1.4"/>');
      out.push('<line x1="' + r1(p.px + sz - 3) + '" y1="' + r1(p.py + 3) + '" x2="' + r1(p.px + 3) +
        '" y2="' + r1(p.py + sz - 3) + '" stroke="' + C.ink + '" stroke-width="1.4"/>');
    }
    var fs = Math.max(8, 12 * scale);
    if (p.age) {
      out.push(text(p.cx, p.cy + fs * 0.36, p.age,
        { fill: C.ink, size: fs, weight: '600', anchor: 'middle', font: F.mono }));
    }
    /* 姓名底下墊一塊紙色：情感關係線從旁邊經過時，才不會把名字劃掉 */
    var nameFs = Math.max(9, 12.5 * scale);
    out.push(paperBox(p.cx, p.py + sz + 15, p.name, nameFs));
    out.push(text(p.cx, p.py + sz + 15, p.name,
      { fill: C.ink, size: nameFs, weight: '600', anchor: 'middle' }));
    if (p.note) {
      var nfs = Math.max(7.5, 8.5 * scale);
      DD.wrapLabel(p.note, 12).slice(0, 2).forEach(function (ln, i) {
        out.push(paperBox(p.cx, p.py + sz + 29 + i * 11, ln, nfs));
        out.push(text(p.cx, p.py + sz + 29 + i * 11, ln,
          { fill: C.muted, size: nfs, anchor: 'middle', font: F.mono }));
      });
    }
    return out.join('');
  }

  function sexShape(p, x, y, sz, stroke, w) {
    if (p.sex === 'f') {
      return '<circle cx="' + r1(x + sz / 2) + '" cy="' + r1(y + sz / 2) + '" r="' + r1(sz / 2) +
        '" fill="#ffffff" stroke="' + stroke + '" stroke-width="' + w + '"/>';
    }
    if (p.sex === 'u') {
      return '<polygon points="' + r1(x + sz / 2) + ',' + r1(y) + ' ' + r1(x + sz) + ',' + r1(y + sz / 2) +
        ' ' + r1(x + sz / 2) + ',' + r1(y + sz) + ' ' + r1(x) + ',' + r1(y + sz / 2) +
        '" fill="#ffffff" stroke="' + stroke + '" stroke-width="' + w + '"/>';
    }
    return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(sz) + '" height="' + r1(sz) +
      '" fill="#ffffff" stroke="' + stroke + '" stroke-width="' + w + '"/>';
  }

  /**
   * 情感關係線。三件事：
   *   1. 端點停在符號邊界外一點，不要壓在框上。
   *   2. **走弧線不走直線**。直線會從別人的符號正中間穿過去，而且跟結構線
   *      （伴侶線、子女線）長得太像；弧線一眼就看得出是「另一層」。
   *   3. 親近／非常親近是沿著同一條弧的平行線，衝突是沿著弧的鋸齒——
   *      所以統一先把弧取樣成一串點，再照型別加偏移。
   */
  function bondPath(a, b, type, sz) {
    var dx = b.cx - a.cx, dy = b.cy - a.cy;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    var pad = sz / 2 + 5;
    var x1 = a.cx + ux * pad, y1 = a.cy + uy * pad;
    var x2 = b.cx - ux * pad, y2 = b.cy - uy * pad;
    /* 弧的鼓起量：跟長度成比例但有上限。太大會繞到天邊去，
       圖例那種短線也會糊成一團 */
    var bow = Math.min(30, len * 0.13);
    var nx = -uy, ny = ux;
    var cx = (x1 + x2) / 2 + nx * bow * 2, cy = (y1 + y2) / 2 + ny * bow * 2;
    var col = C.accent;

    /* 沿弧取樣，順便算出每一點的法線，平行線與鋸齒都靠它 */
    function sample(n) {
      var pts = [];
      for (var i = 0; i <= n; i++) {
        var t = i / n, m = 1 - t;
        var px = m * m * x1 + 2 * m * t * cx + t * t * x2;
        var py = m * m * y1 + 2 * m * t * cy + t * t * y2;
        var tx = 2 * m * (cx - x1) + 2 * t * (x2 - cx);
        var ty = 2 * m * (cy - y1) + 2 * t * (y2 - cy);
        var tl = Math.sqrt(tx * tx + ty * ty) || 1;
        pts.push({ x: px, y: py, nx: -ty / tl, ny: tx / tl });
      }
      return pts;
    }

    function poly(pts, offFn, dash, marker) {
      var d = pts.map(function (p, i) {
        var o = offFn ? offFn(i, pts.length) : 0;
        return r1(p.x + p.nx * o) + ' ' + r1(p.y + p.ny * o);
      }).join(' ');
      return '<polyline points="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.3"' +
        (dash ? ' stroke-dasharray="' + dash + '"' : '') +
        (marker ? ' marker-end="url(#ddg-arrow-accent)"' : '') + '/>';
    }

    /* 取樣點數也跟長度走：固定點數的話，短線的鋸齒會密到看不出是鋸齒。
       取偶數，鋸齒的兩端才落在弧上（偏移 0） */
    var steps = Math.max(6, Math.min(24, Math.round(len / 16)));
    if (steps % 2) steps++;
    var arc = sample(steps);
    var out = [];
    if (type === 'close') {
      out.push(poly(arc, function () { return -2.4; }), poly(arc, function () { return 2.4; }));
    } else if (type === 'fused') {
      [-4, 0, 4].forEach(function (o) { out.push(poly(arc, function () { return o; })); });
    } else if (type === 'distant') {
      out.push(poly(arc, null, '6 5'));
    } else if (type === 'cutoff') {
      /* 斷絕：線中間兩道橫槓，像被剪斷 */
      out.push(poly(arc));
      var mid = Math.round(arc.length / 2);
      [-1, 1].forEach(function (k) {
        var q = arc[Math.max(0, Math.min(arc.length - 1, mid + k))];
        out.push('<line x1="' + r1(q.x + q.nx * 6) + '" y1="' + r1(q.y + q.ny * 6) + '" x2="' +
          r1(q.x - q.nx * 6) + '" y2="' + r1(q.y - q.ny * 6) + '" stroke="' + col + '" stroke-width="1.3"/>');
      });
    } else {
      /* 衝突與暴力：沿著弧走鋸齒。暴力再加一個箭頭指向被施暴的一方 */
      out.push(poly(arc, function (i, n) {
        return (i === 0 || i === n - 1) ? 0 : ((i % 2) ? 5 : -5);
      }, '', type === 'abuse'));
    }
    return out.join('');
  }

  function genoLegend(y, people, bonds) {
    var items = [
      { name: '男', mark: function (x, yy) {
        return '<rect x="' + x + '" y="' + r1(yy - 6) + '" width="12" height="12" fill="#ffffff" stroke="' +
          C.ink + '" stroke-width="1.2"/>'; } },
      { name: '女', mark: function (x, yy) {
        return '<circle cx="' + (x + 6) + '" cy="' + r1(yy) + '" r="6" fill="#ffffff" stroke="' +
          C.ink + '" stroke-width="1.2"/>'; } }
    ];
    if (people.some(function (p) { return p.sex === 'u'; })) {
      items.push({ name: '性別不明', mark: function (x, yy) {
        return '<polygon points="' + (x + 6) + ',' + r1(yy - 6) + ' ' + (x + 12) + ',' + r1(yy) + ' ' +
          (x + 6) + ',' + r1(yy + 6) + ' ' + x + ',' + r1(yy) + '" fill="#ffffff" stroke="' +
          C.ink + '" stroke-width="1.2"/>'; } });
    }
    if (people.some(function (p) { return p.index; })) {
      items.push({ name: '案主', mark: function (x, yy) {
        return '<rect x="' + x + '" y="' + r1(yy - 6) + '" width="12" height="12" fill="#ffffff" stroke="' +
          C.accent + '" stroke-width="1.2"/><rect x="' + (x + 2.5) + '" y="' + r1(yy - 3.5) +
          '" width="7" height="7" fill="none" stroke="' + C.accent + '" stroke-width="1"/>'; } });
    }
    if (people.some(function (p) { return p.dead; })) {
      items.push({ name: '已歿', mark: function (x, yy) {
        return '<rect x="' + x + '" y="' + r1(yy - 6) + '" width="12" height="12" fill="#ffffff" stroke="' +
          C.ink + '" stroke-width="1.2"/><line x1="' + x + '" y1="' + r1(yy - 6) + '" x2="' + (x + 12) +
          '" y2="' + r1(yy + 6) + '" stroke="' + C.ink + '" stroke-width="1.2"/><line x1="' + (x + 12) +
          '" y1="' + r1(yy - 6) + '" x2="' + x + '" y2="' + r1(yy + 6) + '" stroke="' + C.ink +
          '" stroke-width="1.2"/>'; } });
    }
    var seen = {};
    bonds.forEach(function (bd) {
      if (seen[bd.type]) return;
      seen[bd.type] = true;
      items.push({ name: optLabel(BOND_OPTIONS, bd.type), mark: bondSwatch(bd.type) });
    });
    return legend(y, items);
  }

  function bondSwatch(type) {
    return function (x, y) {
      var a = { cx: x - 17, cy: y, px: x - 23, py: y - 6 };
      var b = { cx: x + 41, cy: y, px: x + 35, py: y - 6 };
      return bondPath(a, b, type, 12);
    };
  }

  /* ── 從 Excel 貼一整塊 ─────────────────────────────────────────────
     工作項目、起迄日、名單，本來就都躺在 Excel 裡。一行一列、一個 tab 一欄，
     照這一種圖的欄位順序對過去，比一格一格打快十倍。
     勾選欄吃「是／Y/1/V/✓」這幾種寫法——公務同仁的表格裡這幾種都有。 */

  var YES = /^(是|有|v|y|yes|true|1|✓|ｖ|Ｖ|Ｙ)$/i;

  /** 這一種圖從 Excel 貼進來時，欄位由左而右對應到哪幾個 key。 */
  function pasteKeys(gen) {
    return gen.fields.filter(function (f) { return f.type !== 'rowref'; })
      .map(function (f) { return f.key; });
  }

  /**
   * 把貼上的一塊文字切成列。回傳 { rows, warnings }。
   * 只切格子、不做任何猜測——猜錯比沒有更難查。
   */
  function parsePasteRows(gen, textIn) {
    var warnings = [];
    var rows = [];
    if (!gen) return { rows: rows, warnings: warnings };
    var keys = pasteKeys(gen);
    var lines = String(textIn == null ? '' : textIn).split(/\r\n|\r|\n/);
    var over = 0;
    lines.forEach(function (raw) {
      if (!raw.trim()) return;
      var cells = raw.split('\t').map(function (c) { return c.trim(); });
      /* 沒有 tab 的話多半是只貼了一欄，就當成第一個欄位 */
      var row = {};
      keys.forEach(function (k, i) {
        var f = fieldByKey(gen, k);
        var v = cells[i] == null ? '' : cells[i];
        if (f.type === 'check') row[k] = YES.test(v);
        else if (f.type === 'select') row[k] = matchOption(f, v);
        else row[k] = v;
      });
      if (cells.length > keys.length) over++;
      rows.push(row);
    });
    if (over) {
      warnings.push('有 ' + over + ' 行的欄位比這種圖需要的多，多出來的欄被忽略了。' +
        '欄位順序是：' + keys.map(function (k) { return fieldByKey(gen, k).label; }).join('、') + '。');
    }
    if (!rows.length) warnings.push('貼上的內容是空的。在 Excel 選一塊（含多欄）複製，再貼進來。');
    return { rows: rows, warnings: warnings };
  }

  function fieldByKey(gen, key) {
    for (var i = 0; i < gen.fields.length; i++) if (gen.fields[i].key === key) return gen.fields[i];
    return { key: key, type: 'text', label: key };
  }

  /** 下拉欄位：使用者貼進來的是中文標籤（「判斷」），不是內部值（'decision'）。 */
  function matchOption(f, v) {
    var s = String(v || '').trim();
    for (var i = 0; i < f.options.length; i++) {
      if (f.options[i].label === s || f.options[i].value === s) return f.options[i].value;
    }
    return f.options[0].value;
  }

  /* ── 設定檔：把「填了什麼」存下來，下個月改一下日期再送一次 ──────────
     跟範本庫的設定檔是不同格式（那邊記「第幾段改成什麼」），但同一個按鈕。
     載入時看 kind 決定走哪一條路。 */

  var GEN_PROJECT_VERSION = 1;

  function buildGenProject(o) {
    var s = o || {};
    return JSON.stringify({
      format: 'gongwu-diagram',
      kind: 'generator',
      version: GEN_PROJECT_VERSION,
      savedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      type: s.type,
      typeName: s.typeName || '',
      title: s.title || '',
      eyebrow: s.eyebrow || '',
      palette: s.palette || 'source',
      font: s.font || 'kai',
      meta: s.meta || {},
      rows: s.rows || [],
      source: DD.SOURCE.credit
    }, null, 2);
  }

  /**
   * 讀回產生器的設定檔。壞掉要講人話，而且要講得出下一步該做什麼。
   * 這是使用者給的輸入，每一格都要驗過才敢用。
   */
  function parseGenProject(text) {
    var data;
    try {
      data = JSON.parse(String(text));
    } catch (e) {
      throw new Error('這不是本站存出來的設定檔（檔案內容不是合法的 JSON）。');
    }
    if (!data || data.format !== 'gongwu-diagram') {
      throw new Error('這不是本站存出來的設定檔，請選副檔名為 .json 的「圖表設定」檔。');
    }
    if (data.kind !== 'generator') {
      throw new Error('這是範本改字用的設定檔，不是做圖用的。請到範本那一頁載入它。');
    }
    if (!(data.version <= GEN_PROJECT_VERSION)) {
      throw new Error('這份設定檔是較新版本的站台存出來的（version ' + data.version +
        '），本站看不懂。請重新整理頁面後再試一次。');
    }
    var gen = byId(String(data.type || ''));
    if (!gen) {
      throw new Error('設定檔記的圖表種類「' + (data.type || '（空白）') + '」本站沒有，無法套用。');
    }
    var keys = {};
    gen.fields.forEach(function (f) { keys[f.key] = f; });
    var rows = (Array.isArray(data.rows) ? data.rows : []).map(function (r) {
      var row = {};
      gen.fields.forEach(function (f) {
        var v = r && r[f.key];
        if (f.type === 'check') row[f.key] = !!v;
        else if (f.type === 'select') row[f.key] = matchOption(f, v);
        else row[f.key] = v == null ? '' : String(v);
      });
      return row;
    });
    if (!rows.length) throw new Error('設定檔裡一列內容都沒有，載入了也是空白的。');
    var meta = {};
    (gen.meta || []).forEach(function (f) {
      var v = data.meta && data.meta[f.key];
      meta[f.key] = v == null ? '' : String(v);
    });
    return {
      type: gen.id, gen: gen, rows: rows, meta: meta,
      title: String(data.title || ''), eyebrow: String(data.eyebrow || ''),
      palette: String(data.palette || 'source'), font: String(data.font || 'kai')
    };
  }

  /* ── 對外 ───────────────────────────────────────────────────────── */

  /* ══ 關係圖 ═══════════════════════════════════════════════════════════
     公文與簡報裡最常出現的那種「示意圖」：幾個方塊，中間拉幾條線，
     線上寫一句話。方塊可實線可虛線，線可實可虛、可加箭頭。

     刻意不做成「相互關係圖非得排成環狀」：真實的公務示意圖幾乎都是格狀
     （四個職域一排、上下兩層），環狀只有在「每個都跟每個有關」時才好看。
     排法由「每列幾個」與各方塊的「另起一列」決定，程式不猜。 */

  var BOX_LINE_OPTIONS = [
    { value: 'solid', label: '實線' },
    { value: 'dashed', label: '虛線' },
    { value: 'none', label: '無框' }
  ];
  var BOX_FILL_OPTIONS = [
    { value: 'paper', label: '白底' },
    { value: 'soft', label: '淺灰' },
    { value: 'accent', label: '強調' }
  ];
  var LINK_LINE_OPTIONS = [
    { value: 'solid', label: '實線' },
    { value: 'dashed', label: '虛線' }
  ];
  var LINK_ARROW_OPTIONS = [
    { value: 'one', label: '單向 →' },
    { value: 'both', label: '雙向 ↔' },
    { value: 'none', label: '不加箭頭' }
  ];
  var REL_DIR_OPTIONS = [
    { value: 'down', label: '直式（由上而下）' },
    { value: 'right', label: '橫式（由左而右）' }
  ];
  var REL_KIND_OPTIONS = [
    { value: 'box', label: '方塊' },
    { value: 'link', label: '連線' }
  ];

  var REL = { W: 1000, left: 40, top: 70, gapX: 26, gapY: 58, minH: 54, fs: 13, pad: 14 };

  /** 方塊的底與框：三種框線 × 三種底色，其它產生器換配色時也吃得到這四個色票。 */
  function relBoxStyle(row) {
    var line = optValue(BOX_LINE_OPTIONS, row.line);
    var fill = optValue(BOX_FILL_OPTIONS, row.fill);
    return {
      stroke: line === 'none' ? 'none' : (fill === 'accent' ? C.accent : C.ink),
      dash: line === 'dashed' ? ' stroke-dasharray="6 4"' : '',
      bg: fill === 'accent' ? 'rgba(235,108,54,0.12)' : (fill === 'soft' ? 'rgba(79,93,117,0.10)' : C.paper),
      text: C.ink
    };
  }

  /**
   * 關係圖的版面：讀進來、分列（欄）、算每個方塊的座標。
   * 畫圖與「搬到畫板」共用同一份——兩邊各算一次的話，畫板上的位置會跟預覽差幾個像素，
   * 而且改了排法只有一邊會動。
   */
  function relLayout(rows, meta) {
    var warnings = [];
    var boxes = [];
    var links = [];
    var byText = {};
    var used = 0;

    (rows || []).forEach(function (row, i) {
      var kind = row.kind === 'link' ? 'link' : 'box';
      if (kind === 'box') {
        var t = String(row.text || '').trim();
        if (!t) return;
        if (byText[t] != null) {
          warnings.push('「' + t + '」出現了兩次。方塊的文字要不一樣，' +
            '不然連線的「從」「到」分不出你指的是哪一個。');
          return;
        }
        byText[t] = boxes.length;
        used++;
        boxes.push({ text: t, br: !!row.br, style: relBoxStyle(row),
          line: optValue(BOX_LINE_OPTIONS, row.line), fill: optValue(BOX_FILL_OPTIONS, row.fill) });
        return;
      }
      var a = String(row.from || '').trim(), b = String(row.to || '').trim();
      if (!a && !b && !String(row.label || '').trim()) return;
      used++;
      links.push({ line: i + 1, aName: a, bName: b,
        style: optValue(LINK_LINE_OPTIONS, row.style),
        arrow: optValue(LINK_ARROW_OPTIONS, row.arrow),
        label: String(row.label || '').trim() });
    });

    if (!boxes.length) return { empty: true, warnings: warnings, used: 0 };

    /* ── 排列 ─────────────────────────────────────────────────────
       直式：一條「線」是一列，方塊由左而右；橫式：一條「線」是一欄，由上而下。
       兩種只差在把 x／y 對調，所以先分組、再依方向擺，不要寫成兩份版面程式。 */
    var horiz = optValue(REL_DIR_OPTIONS, meta && meta.dir) === 'right';
    var want = parseInt(String((meta && meta.cols) || '').replace(/[^\d]/g, ''), 10);
    if (String((meta && meta.cols) || '').trim() && !(want >= 1)) {
      warnings.push('「每列（欄）幾個方塊」要填一個 1 以上的數字，' +
        '填的是「' + meta.cols + '」，先當成自動排。');
    }
    var per = want >= 1 ? Math.min(want, 6)
      : (boxes.length <= 3 ? boxes.length : (boxes.length <= 6 ? 3 : 4));

    var lines = [], cur = [];
    boxes.forEach(function (b, i) {
      if (i && (b.br || cur.length >= per)) { lines.push(cur); cur = []; }
      cur.push(b);
    });
    if (cur.length) lines.push(cur);

    var avail = REL.W - REL.left * 2;
    /* 直式：一列最多幾個決定欄寬；橫式：有幾欄決定欄寬 */
    var across = horiz ? lines.length : lines.reduce(function (m, r) {
      return Math.max(m, r.length);
    }, 1);

    /* 左右相鄰的兩個方塊之間有字時，欄距要讓得下那句話——不然「體制內不衡平」
       會擠在 26px 的縫裡，兩邊都壓到方塊上。 */
    var lineOf = {};
    lines.forEach(function (r, n) { r.forEach(function (b) { lineOf[b.text] = n; }); });
    var needGap = REL.gapX;
    links.forEach(function (l) {
      if (!l.label) return;
      var la = lineOf[l.aName], lb = lineOf[l.bName];
      if (la == null || lb == null) return;
      /* 直式的左右鄰居是「同一列」，橫式的左右鄰居是「不同欄」 */
      if (horiz ? la === lb : la !== lb) return;
      needGap = Math.max(needGap, Math.round(DD.textUnits(l.label) * 10) + 20);
    });
    var gapX = Math.min(needGap, Math.floor(avail / (across + 1)));

    var bw = Math.floor((avail - (across - 1) * gapX) / across);
    var maxChars = Math.max(4, (bw - REL.pad * 2) / REL.fs);

    /* 折行：使用者打的「/」是自己決定的斷點，其餘照寬度折 */
    boxes.forEach(function (b) {
      b.lines = [];
      String(b.text).split(/\s*\/\s*/).forEach(function (part) {
        var got = DD.wrapLabel(part, maxChars);
        b.lines = b.lines.concat(got.length ? got : ['']);
      });
      b.need = Math.round(Math.max(REL.minH, b.lines.length * (REL.fs * 1.45) + REL.pad * 2));
    });

    var H;
    if (!horiz) {
      var y = REL.top;
      lines.forEach(function (rowBoxes) {
        var h = rowBoxes.reduce(function (m, b) { return Math.max(m, b.need); }, REL.minH);
        var rowW = rowBoxes.length * bw + (rowBoxes.length - 1) * gapX;
        var x = Math.round((REL.W - rowW) / 2);
        rowBoxes.forEach(function (b) {
          b.x = x; b.y = y; b.w = bw; b.h = h;
          b.cx = x + bw / 2; b.cy = y + h / 2;
          x += bw + gapX;
        });
        y += h + REL.gapY;
      });
      H = y - REL.gapY + 34;
    } else {
      /* 橫式：每一欄自己往下疊，欄與欄之間垂直置中對齊，短的那一欄才不會吊在上面 */
      var tall = lines.reduce(function (m, col) {
        return Math.max(m, col.reduce(function (n, b) { return n + b.need; }, 0) +
          (col.length - 1) * REL.gapY);
      }, REL.minH);
      var colW = lines.length * bw + (lines.length - 1) * gapX;
      var cx0 = Math.round((REL.W - colW) / 2);
      lines.forEach(function (col, n) {
        var colH = col.reduce(function (m, b) { return m + b.need; }, 0) +
          (col.length - 1) * REL.gapY;
        var cy0 = REL.top + Math.round((tall - colH) / 2);
        var x = cx0 + n * (bw + gapX);
        col.forEach(function (b) {
          b.x = x; b.y = cy0; b.w = bw; b.h = b.need;
          b.cx = x + bw / 2; b.cy = cy0 + b.need / 2;
          cy0 += b.need + REL.gapY;
        });
      });
      H = REL.top + tall + 34;
    }

    return { boxes: boxes, links: links, byText: byText, warnings: warnings,
      used: used, H: H, horiz: horiz };
  }

  var relationGen = {
    id: 'relation',
    name: '關係圖',
    use: '幾個方塊、幾條線：誰跟誰有關係、是什麼關係。線可實可虛、可加箭頭、線上可以寫字。',
    sampleTitle: '各職域人員比較示意圖',
    rowName: '列',
    help: [
      '先填方塊，填寫完畢後再拉連線。',
      '直式是由左而右排、排滿一列換下一列；橫式是由上而下排、排滿一欄換下一欄。',
      '要提早換到下一列（欄）就勾「另起一列」。',
      '文字太長會自動折行，想自己決定在哪裡斷，就在要斷的地方打一個「/」。'
    ],
    groups: [
      { id: 'box', title: '方塊', rowName: '方塊', kinds: ['box'], add: '＋ 新增方塊' },
      { id: 'link', title: '連線', rowName: '連線', unit: '條', kinds: ['link'], add: '＋ 新增連線',
        needs: { kinds: ['box'], min: 2, msg: '先填兩個以上的方塊，才能拉連線。' } }
    ],
    fields: [
      { key: 'kind', label: '型別', type: 'select', options: REL_KIND_OPTIONS, width: '104px' },

      { key: 'text', label: '方塊裡的文字', type: 'text', only: 'box' },
      { key: 'line', label: '框線', type: 'select', options: BOX_LINE_OPTIONS, width: '104px', only: 'box' },
      { key: 'fill', label: '底色', type: 'select', options: BOX_FILL_OPTIONS, width: '104px', only: 'box' },
      { key: 'br', label: '另起一列', type: 'check', width: '92px', only: 'box',
        hint: '直式：從下一列的最左邊開始；橫式：從下一欄的最上面開始' },

      { key: 'from', label: '從', type: 'rowref', width: '170px', only: 'link' },
      { key: 'to', label: '到', type: 'rowref', width: '170px', only: 'link' },
      { key: 'style', label: '線型', type: 'select', options: LINK_LINE_OPTIONS, width: '104px', only: 'link' },
      { key: 'arrow', label: '箭頭', type: 'select', options: LINK_ARROW_OPTIONS, width: '118px', only: 'link' },
      { key: 'label', label: '線上的字（可留空）', type: 'text', only: 'link' }
    ],
    meta: [
      { key: 'dir', label: '排列方向', type: 'select', options: REL_DIR_OPTIONS, width: '190px' },
      { key: 'cols', label: '每列（欄）幾個方塊，留空＝自動', type: 'text', width: '220px' }
    ],
    example: [
      { kind: 'box', text: '國營事業', line: 'solid', fill: 'soft' },
      { kind: 'box', text: '民間公司', line: 'solid', fill: 'soft' },
      { kind: 'box', text: '純勞工/（適用勞基法）', line: 'solid', fill: 'paper', br: true },
      { kind: 'box', text: '公兼勞/（適用公務人員規定）', line: 'solid', fill: 'paper' },
      { kind: 'box', text: '同時支領退休金及撫卹金', line: 'solid', fill: 'accent', br: true },
      { kind: 'box', text: '僅支領撫卹金', line: 'dashed', fill: 'paper' },
      { kind: 'link', from: '國營事業', to: '純勞工/（適用勞基法）', style: 'solid', arrow: 'one', label: '' },
      { kind: 'link', from: '民間公司', to: '公兼勞/（適用公務人員規定）', style: 'solid', arrow: 'one', label: '' },
      { kind: 'link', from: '純勞工/（適用勞基法）', to: '同時支領退休金及撫卹金', style: 'solid', arrow: 'one', label: '' },
      { kind: 'link', from: '公兼勞/（適用公務人員規定）', to: '僅支領撫卹金', style: 'dashed', arrow: 'one', label: '' },
      { kind: 'link', from: '同時支領退休金及撫卹金', to: '僅支領撫卹金', style: 'dashed', arrow: 'both', label: '體制內不衡平' }
    ],
    build: function (rows, meta, opts) {
      var lay = relLayout(rows, meta);
      var warnings = lay.warnings;
      if (lay.empty) {
        return { svg: emptyCanvas('在左邊的「方塊」區塊填幾個方塊，再到「連線」拉線。'),
          warnings: warnings, count: 0 };
      }
      var boxes = lay.boxes, links = lay.links, byText = lay.byText, H = lay.H, used = lay.used;

      /* ── 畫 ──────────────────────────────────────────────────────── */
      var out = [canvasOpen(H, '關係圖')];
      var labels = [];

      links.forEach(function (l) {
        var ia = byText[l.aName], ib = byText[l.bName];
        if (ia == null || ib == null || ia === ib) {
          warnings.push('第 ' + l.line + ' 條連線的「' + (l.aName || '（空白）') + '」與「' +
            (l.bName || '（空白）') + '」有一邊不是已經填過的方塊，這條線畫不出來。');
          return;
        }
        var a = boxes[ia], b = boxes[ib];
        var dash = l.style === 'dashed' ? ' stroke-dasharray="6 4"' : '';
        var head = (l.arrow === 'one' || l.arrow === 'both') ? ' marker-end="url(#ddg-arrow)"' : '';
        var tail = l.arrow === 'both' ? ' marker-start="url(#ddg-arrow-back)"' : '';
        var pts = relRoute(a, b);
        out.push('<polyline points="' + pts.map(function (p) {
          return r1(p[0]) + ',' + r1(p[1]);
        }).join(' ') + '" fill="none" stroke="' + C.muted + '" stroke-width="1.4"' +
          dash + head + tail + '/>');
        if (l.label) {
          var mid = relMid(pts);
          labels.push(paperBox(mid[0], mid[1], l.label, 10) +
            text(mid[0], mid[1], l.label, { fill: C.muted, size: 10, anchor: 'middle' }));
        }
      });

      /* 方塊最後畫：線可能從旁邊擦過去，先畫就會被壓在下面 */
      boxes.forEach(function (b) {
        var st = b.style;
        out.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
          '" rx="6" fill="' + st.bg + '" stroke="' + st.stroke + '" stroke-width="1.4"' + st.dash + '/>');
        var top = b.cy - (b.lines.length - 1) * (REL.fs * 1.45) / 2 + REL.fs * 0.36;
        b.lines.forEach(function (ln, i) {
          out.push(text(b.cx, top + i * (REL.fs * 1.45), ln,
            { fill: st.text, size: REL.fs, weight: '600', anchor: 'middle' }));
        });
      });
      /* 線上的字要壓在所有線之上，不然被後畫的線劃掉就看不懂了 */
      out.push(labels.join(''));
      out.push('</svg>');

      return { svg: out.join(''), warnings: warnings, count: used };
    }
  };

  /**
   * 關係圖 → 畫板：一個方塊一個形狀、一條連線一條線，座標沿用預覽算好的那一份。
   * 搬過去就是「一模一樣的那張圖，只是每一格都拖得動了」——重算一次會差幾個像素，
   * 使用者會覺得「搬過去圖就跑掉了」。
   *
   * 回的是純資料（形狀與連線的清單），board.js 的 normBoard() 再驗一次。
   * gen.js 不相依 board.js，board.js 也不相依 gen.js，兩邊只共用這份欄位約定。
   *
   * 畫板沒有的東西會掉：雙向箭頭只剩單向、「不加箭頭」也會長出箭頭。
   * 呼叫端要跟使用者講清楚，不要讓人以為是壞掉。
   */
  function relationBoard(rows, meta) {
    var lay = relLayout(rows, meta);
    if (lay.empty) return { shapes: [], links: [] };
    var ids = lay.boxes.map(function (_, i) { return 'r' + i; });
    var shapes = lay.boxes.map(function (b, i) {
      return {
        id: ids[i],
        /* 虛線框在畫板裡就是「註記」，無框就是「純文字」——形狀清單只有這幾種 */
        kind: b.line === 'dashed' ? 'note' : (b.line === 'none' ? 'label' : 'step'),
        x: b.x, y: b.y, w: b.w, h: b.h,
        text: b.lines.join(' '), sub: '',
        color: b.fill === 'accent' ? 'accent' : (b.fill === 'soft' ? 'soft' : 'plain'),
        size: REL.fs
      };
    });
    var links = [];
    lay.links.forEach(function (l, i) {
      var ia = lay.byText[l.aName], ib = lay.byText[l.bName];
      if (ia == null || ib == null || ia === ib) return;
      links.push({ id: 'rl' + i, from: ids[ia], to: ids[ib], label: l.label,
        dash: l.style === 'dashed' });
    });
    return { shapes: shapes, links: links };
  }

  /** 兩個方塊之間怎麼走：同一列走直線，不同列先垂直再水平再垂直。 */
  function relRoute(a, b) {
    var sameRow = Math.abs(a.cy - b.cy) < 4;
    if (sameRow) {
      var l = a.cx < b.cx ? a : b, r = a.cx < b.cx ? b : a;
      var from = a.cx < b.cx ? [l.x + l.w, l.cy] : [r.x, r.cy];
      var to = a.cx < b.cx ? [r.x, r.cy] : [l.x + l.w, l.cy];
      return [from, to];
    }
    var up = b.cy < a.cy;
    var y1 = up ? a.y : a.y + a.h;
    var y2 = up ? b.y + b.h : b.y;
    if (Math.abs(a.cx - b.cx) < 4) return [[a.cx, y1], [b.cx, y2]];
    var mid = (y1 + y2) / 2;
    return [[a.cx, y1], [a.cx, mid], [b.cx, mid], [b.cx, y2]];
  }

  /** 線上的字放在最長那一段的中點——放在轉角會壓到轉折看不清楚。 */
  function relMid(pts) {
    var best = 0, bestLen = -1;
    for (var i = 0; i < pts.length - 1; i++) {
      var dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
      var len = Math.abs(dx) + Math.abs(dy);
      if (len > bestLen) { bestLen = len; best = i; }
    }
    return [(pts[best][0] + pts[best + 1][0]) / 2, (pts[best][1] + pts[best + 1][1]) / 2 - 5];
  }

  var TYPES = [flowGen, swimlaneGen, orgGen, relationGen, genogramGen, ganttGen, timelineGen, layersGen, quadrantGen];

  function byId(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return null;
  }

  return {
    TYPES: TYPES, byId: byId, relationBoard: relationBoard,
    parseTwDate: parseTwDate, twLabel: twLabel, dayNum: dayNum,
    emptyCanvas: emptyCanvas,
    pasteKeys: pasteKeys, parsePasteRows: parsePasteRows,
    GEN_PROJECT_VERSION: GEN_PROJECT_VERSION,
    buildGenProject: buildGenProject, parseGenProject: parseGenProject
  };
});
