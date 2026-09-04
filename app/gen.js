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
      '型別選「判斷」才會出現分岔的三個欄位；其餘一律是矩形步驟，開始與結束是橢圓。',
      '「分支結果」是往右接一個結果（例如「移文他科」），只有那一格，不再往下走。',
      '「退回到」是把線拉回前面某一步（例如退回承辦人重擬），只能選前面已經有的步驟。',
      '「分支標籤」是那條線上的字（是／否）。同一個判斷兩條都有時，往下走的那條會自動標相反的。'
    ],
    rowName: '步驟',
    fields: [
      { key: 'kind', label: '型別', type: 'select', options: FLOW_KIND_OPTIONS, width: '90px' },
      { key: 'main', label: '文字', type: 'text', placeholder: '登記收文' },
      { key: 'sub', label: '小字副標（可留空）', type: 'text', placeholder: '收發室' },
      { key: 'branchLabel', label: '分支標籤', type: 'text', placeholder: '否', width: '76px', only: 'decision' },
      { key: 'branchText', label: '分支結果（往右）', type: 'text', placeholder: '移文他科', only: 'decision' },
      { key: 'loopTo', label: '退回到', type: 'rowref', width: '140px', only: 'decision' }
    ],
    example: [
      { kind: 'start', main: '收到來文' },
      { kind: 'step', main: '登記收文', sub: '收發室' },
      { kind: 'decision', main: '是否本科權責？', branchLabel: '否', branchText: '移文他科' },
      { kind: 'step', main: '承辦人擬稿', sub: '附法令依據' },
      { kind: 'step', main: '科長審核' },
      { kind: 'decision', main: '內容是否需要修正？', branchLabel: '是', loopTo: '承辦人擬稿' },
      { kind: 'step', main: '主管決行' },
      { kind: 'end', main: '發文並歸檔' }
    ],
    build: function (rows, meta, opts) {
      var warnings = [];
      var nodes = [];
      (rows || []).forEach(function (row, i) {
        var main = String(row.main || '').trim();
        if (!main) { if (hasAny(row)) warnings.push('第 ' + (i + 1) + ' 列沒有填文字，跳過了。'); return; }
        var kind = row.kind || 'step';
        var n = { kind: kind, main: main, sub: String(row.sub || '').trim(), branch: null, loop: null };
        if (kind === 'decision') {
          var bt = String(row.branchText || '').trim();
          if (bt) n.branch = { label: String(row.branchLabel || '否').trim() || '否', text: DD.splitFlowText(bt) };
          var lt = String(row.loopTo || '').trim();
          if (lt) n.loop = { label: String(row.branchLabel || '是').trim() || '是', target: lt };
          if (n.branch && n.loop) n.loop.label = DD.flowOpposite(n.branch.label) || '是';
        }
        nodes.push(n);
      });

      nodes.forEach(function (n, idx) {
        if (!n.loop) return;
        var found = -1;
        for (var j = 0; j < idx; j++) if (nodes[j].main === n.loop.target) { found = j; break; }
        if (found < 0) {
          warnings.push('「' + n.main + '」的退回目標「' + n.loop.target + '」不在它前面，這條退回線畫不出來。');
          n.loop = null;
        } else n.loop.index = found;
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
      { key: 'milestone', label: '查核點', type: 'check', width: '64px' }
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
      { key: 'major', label: '重要', type: 'check', width: '64px' }
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
      { key: 'focal', label: '重點層', type: 'check', width: '72px' }
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
      { key: 'focal', label: '重點', type: 'check', width: '64px' }
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

  /* ── 對外 ───────────────────────────────────────────────────────── */

  var TYPES = [flowGen, ganttGen, timelineGen, layersGen, quadrantGen];

  function byId(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return null;
  }

  return {
    TYPES: TYPES, byId: byId,
    parseTwDate: parseTwDate, twLabel: twLabel, dayNum: dayNum,
    emptyCanvas: emptyCanvas
  };
});
