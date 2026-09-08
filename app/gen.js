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
      '<polygon points="0 0, 8 3, 0 6" fill="' + C.accent + '"/></marker></defs>' +
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

  var TYPES = [flowGen, swimlaneGen, orgGen, ganttGen, timelineGen, layersGen, quadrantGen];

  function byId(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return null;
  }

  return {
    TYPES: TYPES, byId: byId,
    parseTwDate: parseTwDate, twLabel: twLabel, dayNum: dayNum,
    emptyCanvas: emptyCanvas,
    pasteKeys: pasteKeys, parsePasteRows: parsePasteRows,
    GEN_PROJECT_VERSION: GEN_PROJECT_VERSION,
    buildGenProject: buildGenProject, parseGenProject: parseGenProject
  };
});
