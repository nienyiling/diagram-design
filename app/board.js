/*
 * board.js — 自由畫板的純函式層：形狀清單 → 一整份 SVG。不碰 DOM。
 *
 * 為什麼要有畫板：填表產生的圖版面是程式排的，排得整齊但形狀固定。
 * 真實的公文流程偶爾就是有一格要擺在別的地方、或要多一個註記框。
 * 所以畫板的定位是「**程式先排好，你再微調**」——可以從空白開始，
 * 但主要用法是把填表產生的那張圖整個搬進來繼續改。
 *
 * 這一層唯一難的東西是**連線要黏在形狀上**：箱子拖走時線要跟著跑。
 * 所以連線記的是「哪兩個形狀」（id），不是座標；座標每次重畫時現算。
 * 記座標的話，使用者一拖動就會出現一堆飄在半空的箭頭。
 *
 * 顏色一律用 core.js 那四個色票的字面值，換配色與換字體那兩條路才吃得到。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.DDBoard = factory(root.DD);
})(typeof self !== 'undefined' ? self : this, function (DD) {
  'use strict';

  var C = DD.UPSTREAM_LIGHT;
  var F = DD.FONTS;
  var W = 1000;
  var GRID = 10;
  var MIN_H = 560;
  /* 兩個方塊的中心只差這麼一點時，直角路由會轉出一個很小的階梯，
     看起來像畫錯而不像刻意。這種距離直接走一條幾乎看不出來的斜線就好。
     常見成因：使用者把其中一個方塊拉寬了，中心跟著移了十幾個像素。 */
  var JOG = 30;

  function esc(s) { return DD.escapeXml(s); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function num(v, dflt) { var n = Number(v); return isFinite(n) ? n : dflt; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ── 形狀與顏色的規格。畫面上的工具列是照這個長出來的，不是另外手寫一份。 ── */

  var KINDS = [
    { id: 'step', name: '步驟', w: 180, h: 64, hint: '一般的作業步驟' },
    { id: 'start', name: '起訖', w: 160, h: 56, hint: '開始與結束，畫成橢圓' },
    { id: 'decision', name: '判斷', w: 190, h: 96, hint: '要分岔的地方，畫成菱形' },
    { id: 'note', name: '註記', w: 180, h: 60, hint: '虛線框，放說明或依據' },
    { id: 'label', name: '純文字', w: 160, h: 34, hint: '沒有框線，只有字' }
  ];

  var COLORS = [
    { id: 'plain', name: '白底', fill: '#ffffff', stroke: C.ink, text: C.ink },
    { id: 'soft', name: '灰底', fill: 'rgba(45,49,66,0.05)', stroke: 'rgba(45,49,66,0.35)', text: C.ink },
    { id: 'accent', name: '強調', fill: 'rgba(235,108,54,0.10)', stroke: C.accent, text: C.ink },
    { id: 'ink', name: '深色', fill: C.ink, stroke: C.ink, text: C.paper }
  ];

  function kindById(id) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].id === id) return KINDS[i];
    return KINDS[0];
  }
  function colorById(id) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i];
    return COLORS[0];
  }

  function snap(v) { return Math.round(v / GRID) * GRID; }

  /* ── 形狀 ────────────────────────────────────────────────────────── */

  /**
   * 把任何來源的形狀（使用者拖出來的、設定檔讀回來的、從填表那張圖搬過來的）
   * 都整成同一個乾淨的樣子。這是信任邊界：設定檔是使用者給的輸入。
   */
  /**
   * 整形：**只驗證與夾範圍，不對格線**。
   * 對格線是「使用者拖曳」那一刻的事（canvas.js 做），不是每次讀資料都做——
   * 每次都對的話，從填表搬過來、或載回設定檔時，本來對齊的座標會被推歪幾個像素，
   * 直線就變成一節一節的小階梯，而且完全不會報錯。
   */
  function normShape(raw, i) {
    var s = raw || {};
    var k = kindById(s.kind);
    var fit = Math.round;
    var w = clamp(fit(num(s.w, k.w)), 60, W - 40);
    var h = clamp(fit(num(s.h, k.h)), 28, 400);
    return {
      id: String(s.id || ('s' + i + '-' + Math.random().toString(36).slice(2, 7))),
      kind: k.id,
      x: clamp(fit(num(s.x, 40)), 0, W - w),
      y: Math.max(0, fit(num(s.y, 40))),
      w: w, h: h,
      text: s.text == null ? '' : String(s.text),
      sub: s.sub == null ? '' : String(s.sub),
      color: colorById(s.color).id,
      size: clamp(num(s.size, 13), 9, 28)
    };
  }

  /* 箭頭：單向、雙向、不加。舊的設定檔沒有這一欄，一律當成單向——
     那是這塊畫板一路以來的行為，改成「不加」會讓舊圖打開全部變成沒箭頭的線。 */
  var ARROWS = [
    { id: 'one', name: '單向 →' },
    { id: 'both', name: '雙向 ↔' },
    { id: 'none', name: '不加箭頭' }
  ];

  function arrowId(v) {
    for (var i = 0; i < ARROWS.length; i++) if (ARROWS[i].id === v) return v;
    return 'one';
  }

  function normLink(raw, i, ids) {
    var l = raw || {};
    var from = String(l.from || ''), to = String(l.to || '');
    if (!ids[from] || !ids[to] || from === to) return null;
    return {
      id: String(l.id || ('l' + i)),
      from: from, to: to,
      label: l.label == null ? '' : String(l.label),
      dash: !!l.dash,
      arrow: arrowId(l.arrow)
    };
  }

  /** 整份畫板。壞掉的形狀丟掉、指不到形狀的連線丟掉，不要讓一格壞資料炸掉整張圖。 */
  function normBoard(raw) {
    var b = raw || {};
    var shapes = (Array.isArray(b.shapes) ? b.shapes : []).map(normShape);
    var ids = {};
    shapes.forEach(function (s) { ids[s.id] = true; });
    var links = [];
    (Array.isArray(b.links) ? b.links : []).forEach(function (l, i) {
      var n = normLink(l, i, ids);
      if (n) links.push(n);
    });
    return { shapes: shapes, links: links };
  }

  function boardHeight(board) {
    var bottom = 0;
    board.shapes.forEach(function (s) { if (s.y + s.h > bottom) bottom = s.y + s.h; });
    return Math.max(MIN_H, snap(bottom + 60));
  }

  /* ── 連線：黏在形狀上 ─────────────────────────────────────────────
     記的是 from／to 的 id，座標每次重畫現算。使用者拖動箱子時線才會跟著跑。 */

  function centerOf(s) { return { x: s.x + s.w / 2, y: s.y + s.h / 2 }; }

  /**
   * 從形狀中心往某個方向走，碰到邊界的那一點。
   * 菱形要另外算——用矩形邊界的話線會停在菱形外面一段距離，看起來像沒接上。
   */
  function anchor(s, tx, ty) {
    var c = centerOf(s);
    var dx = tx - c.x, dy = ty - c.y;
    if (!dx && !dy) return c;
    var hw = s.w / 2, hh = s.h / 2;
    var t;
    if (s.kind === 'decision') {
      /* 菱形：|x|/hw + |y|/hh = 1 */
      t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    } else {
      var tx1 = dx ? hw / Math.abs(dx) : Infinity;
      var ty1 = dy ? hh / Math.abs(dy) : Infinity;
      t = Math.min(tx1, ty1);
    }
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  /**
   * 直角連線（走「出去、轉、進來」三段）。流程圖用直角比斜線好讀得多。
   * 上下關係就先垂直、左右關係就先水平——這是最不容易穿過別的框的走法。
   *
   * 「往回接」（目標在上面、又跟來源同一欄）要繞邊走，不能直直往上穿回去：
   * 那條線會從中間穿過夾在兩者之間的每一個方塊。退回線幾乎都是這一種。
   */
  function routeLink(a, b, all) {
    var ca = centerOf(a), cb = centerOf(b);
    var dx = cb.x - ca.x, dy = cb.y - ca.y;
    var backward = cb.y < ca.y && Math.abs(dx) < (a.w + b.w) / 2;
    if (backward) return routeAround(a, b, all);
    var vertical = Math.abs(dy) >= Math.abs(dx);
    var p0, p1, pts;
    if (vertical) {
      p0 = anchor(a, ca.x, cb.y > ca.y ? ca.y + 1e4 : ca.y - 1e4);
      p1 = anchor(b, cb.x, cb.y > ca.y ? cb.y - 1e4 : cb.y + 1e4);
      var my = (p0.y + p1.y) / 2;
      pts = (Math.abs(p0.x - p1.x) <= JOG)
        ? [p0, p1]
        : [p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1];
    } else {
      p0 = anchor(a, cb.x > ca.x ? ca.x + 1e4 : ca.x - 1e4, ca.y);
      p1 = anchor(b, cb.x > ca.x ? cb.x - 1e4 : cb.x + 1e4, cb.y);
      var mx = (p0.x + p1.x) / 2;
      pts = (Math.abs(p0.y - p1.y) <= JOG)
        ? [p0, p1]
        : [p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1];
    }
    return pts;
  }

  /**
   * 繞邊：從來源的側邊出去、走一條直的「巷道」到目標上面、再從側邊接回去。
   * 巷道挑左右兩邊比較空的那一側——右邊有分支欄的時候要走左邊，反之亦然。
   */
  function routeAround(a, b, all) {
    var shapes = all || [a, b];
    var left = Infinity, right = -Infinity;
    var top = Math.min(a.y, b.y), bottom = Math.max(a.y + a.h, b.y + b.h);
    shapes.forEach(function (s) {
      /* 只看跟這兩格垂直範圍有重疊的，其他的擋不到路 */
      if (s.y + s.h < top || s.y > bottom) return;
      if (s.x < left) left = s.x;
      if (s.x + s.w > right) right = s.x + s.w;
    });
    if (!isFinite(left)) { left = Math.min(a.x, b.x); right = Math.max(a.x + a.w, b.x + b.w); }
    var goLeft = left - 20 >= 24 || (W - right) < 24;
    var lane = goLeft ? Math.max(14, left - 34) : Math.min(W - 14, right + 34);
    var ay = a.y + a.h / 2, by = b.y + b.h / 2;
    var ax = goLeft ? a.x : a.x + a.w;
    var bx = goLeft ? b.x : b.x + b.w;
    return [{ x: ax, y: ay }, { x: lane, y: ay }, { x: lane, y: by }, { x: bx, y: by }];
  }

  /** 連線中點，標籤放這裡。 */
  function linkMid(pts) {
    if (pts.length === 2) return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    var a = pts[1], b = pts[2];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /* ── 畫 ──────────────────────────────────────────────────────────── */

  function shapePath(s) {
    var col = colorById(s.color);
    var x = r1(s.x), y = r1(s.y), w = r1(s.w), h = r1(s.h);
    if (s.kind === 'label') return '';
    if (s.kind === 'start') {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
        '" rx="' + r1(Math.min(h / 2, w / 2)) + '" fill="' + col.fill +
        '" stroke="' + col.stroke + '" stroke-width="1.2"/>';
    }
    if (s.kind === 'decision') {
      var cx = r1(s.x + s.w / 2), cy = r1(s.y + s.h / 2);
      return '<polygon points="' + cx + ',' + y + ' ' + r1(s.x + s.w) + ',' + cy + ' ' +
        cx + ',' + r1(s.y + s.h) + ' ' + x + ',' + cy + '" fill="' + col.fill +
        '" stroke="' + col.stroke + '" stroke-width="1.2"/>';
    }
    if (s.kind === 'note') {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
        '" rx="4" fill="' + col.fill + '" stroke="' + col.stroke +
        '" stroke-width="1.2" stroke-dasharray="5 4"/>';
    }
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
      '" rx="6" fill="' + col.fill + '" stroke="' + col.stroke + '" stroke-width="1.2"/>';
  }

  /** 框裡的字。菱形能放字的寬度只有一半左右，不然字會壓在斜邊上。 */
  function shapeText(s) {
    var col = colorById(s.color);
    var inner = s.kind === 'decision' ? s.w * 0.6 : s.w - 20;
    var lines = DD.wrapLabel(s.text, Math.max(2, inner / s.size));
    if (!lines.length) lines = [''];
    var lineH = s.size * 1.35;
    var cx = s.x + s.w / 2;
    var cy = s.y + s.h / 2 + (s.sub ? -s.size * 0.45 : 0);
    var top = cy - (lines.length - 1) * lineH / 2 + s.size * 0.35;
    var out = lines.map(function (ln, i) {
      return '<text x="' + r1(cx) + '" y="' + r1(top + i * lineH) + '" fill="' + col.text +
        '" font-size="' + s.size + '" font-family="' + F.sans +
        '" font-weight="600" text-anchor="middle">' + esc(ln) + '</text>';
    }).join('');
    if (s.sub) {
      out += '<text x="' + r1(cx) + '" y="' + r1(top + (lines.length - 1) * lineH + s.size * 1.25) +
        '" fill="' + (s.color === 'ink' ? C.paper : C.muted) + '" font-size="' + r1(s.size * 0.72) +
        '" font-family="' + F.mono + '" text-anchor="middle">' + esc(s.sub) + '</text>';
    }
    return out;
  }

  function linkPath(pts, l) {
    var d = 'M ' + pts.map(function (p) { return r1(p.x) + ' ' + r1(p.y); }).join(' L ');
    var a = arrowId(l.arrow);
    return '<path d="' + d + '" fill="none" stroke="' + C.muted + '" stroke-width="1.3"' +
      (l.dash ? ' stroke-dasharray="5 4"' : '') +
      (a === 'none' ? '' : ' marker-end="url(#ddb-arrow)"') +
      (a === 'both' ? ' marker-start="url(#ddb-arrow-back)"' : '') + '/>';
  }

  function linkLabel(pt, textStr) {
    if (!textStr) return '';
    var w = Math.max(18, DD.textUnits(textStr) * 10 + 10);
    return '<rect x="' + r1(pt.x - w / 2) + '" y="' + r1(pt.y - 7.5) + '" width="' + r1(w) +
      '" height="15" rx="2" fill="' + C.paper + '"/>' +
      '<text x="' + r1(pt.x) + '" y="' + r1(pt.y + 3.5) + '" fill="' + C.muted +
      '" font-size="10" font-family="' + F.mono + '" text-anchor="middle">' + esc(textStr) + '</text>';
  }

  /**
   * 把整塊畫板畫成一份自足的 SVG。
   * opts.grid 為真時畫格線（畫面上要，匯出時不要——格線印出來很醜）。
   */
  function renderBoard(boardIn, opts) {
    var o = opts || {};
    var board = normBoard(boardIn);
    var H = boardHeight(board);
    var byId = {};
    board.shapes.forEach(function (s) { byId[s.id] = s; });

    var parts = ['<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" ' +
      'role="img" aria-label="' + esc(o.title || '自己畫的圖') + '">'];
    parts.push('<defs>' +
      '<pattern id="ddb-dots" width="22" height="22" patternUnits="userSpaceOnUse">' +
      '<circle cx="1" cy="1" r="0.9" fill="rgba(45,49,66,0.10)"/></pattern>' +
      '<pattern id="ddb-grid" width="' + GRID + '" height="' + GRID + '" patternUnits="userSpaceOnUse">' +
      '<path d="M ' + GRID + ' 0 L 0 0 0 ' + GRID + '" fill="none" ' +
      'stroke="rgba(45,49,66,0.10)" stroke-width="0.5"/></pattern>' +
      '<marker id="ddb-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">' +
      '<polygon points="0 0, 8 3, 0 6" fill="' + C.muted + '"/></marker>' +
      /* 雙向的另一頭：refX 要放在 0 那一端，不然箭頭會凸出線的起點外面 */
      '<marker id="ddb-arrow-back" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto">' +
      '<polygon points="8 0, 0 3, 8 6" fill="' + C.muted + '"/></marker>' +
      '</defs>');
    parts.push('<rect width="100%" height="100%" fill="' + C.paper + '"/>');
    parts.push('<rect width="100%" height="100%" fill="url(#ddb-' + (o.grid ? 'grid' : 'dots') +
      ')" opacity="' + (o.grid ? '1' : '0.55') + '"/>');

    if (!board.shapes.length) {
      parts.push('<text x="' + (W / 2) + '" y="' + Math.round(H / 2) + '" fill="' + C.muted +
        '" font-size="14" font-family="' + F.sans + '" text-anchor="middle">' +
        '從左邊挑一個形狀加進來，就可以開始畫</text></svg>');
      return parts.join('');
    }

    /* 先所有的線，再所有的標籤，最後才是框。
       線與標籤分兩輪畫是因為線會交叉——同一輪畫的話，後畫的那條線會直接
       壓過前一條線的標籤，「否」就變成看不懂的一團。 */
    var labels = [];
    board.links.forEach(function (l) {
      var pts = routeLink(byId[l.from], byId[l.to], board.shapes);
      parts.push(linkPath(pts, l));
      if (l.label) labels.push(linkLabel(linkMid(pts), l.label));
    });
    parts = parts.concat(labels);
    board.shapes.forEach(function (s) {
      parts.push(shapePath(s));
      parts.push(shapeText(s));
    });

    parts.push('</svg>');
    return parts.join('');
  }

  /* ── 從填表產生的那張圖搬進畫板 ───────────────────────────────────
     這才是畫板的主要用法：程式先排好，使用者再微調。
     從空白開始畫流程圖，跟在 Word 裡拉方塊一樣痛苦。 */

  var FLOW_KIND_TO_SHAPE = { start: 'start', end: 'start', decision: 'decision', branch: 'note', step: 'step' };

  /**
   * 拿流程圖產生器算好的版面（DD.layoutFlow 的結果）鋪成畫板。
   * 位置直接沿用算好的座標，所以一切過去就是「一模一樣的那張圖」，
   * 只是每一格現在都拖得動了。
   */
  function boardFromFlow(nodes) {
    var lay = DD.layoutFlow(nodes || []);
    var shapes = [], links = [];
    var ids = lay.items.map(function (_, i) { return 'n' + i; });

    lay.items.forEach(function (it, i) {
      shapes.push(normShape({
        id: ids[i],
        kind: FLOW_KIND_TO_SHAPE[it.n.kind] || 'step',
        x: it.cx - it.w / 2, y: it.top, w: it.w, h: it.h,
        text: it.n.main, sub: it.n.sub,
        color: (it.n.kind === 'end' && i === lay.items.length - 1) ? 'accent'
          : (it.col === 'side' ? 'soft' : 'plain'),
        size: it.n.kind === 'decision' ? 12 : 13
      }, i));
    });

    /* 主線一格接一格 */
    var mains = DD.flowMainIndexes(lay.items);
    mains.forEach(function (idx, k) {
      var next = mains[k + 1];
      if (next == null) return;
      var down = lay.items[idx].n.kind === 'decision'
        ? (lay.items[idx].n.downLabel ||
           DD.flowOpposite((lay.items[idx].n.branch && lay.items[idx].n.branch.label) || ''))
        : '';
      links.push({ id: 'm' + k, from: ids[idx], to: ids[next], label: down });
    });

    /* 判斷 → 分支第一格；分支自己一格接一格；最後一格匯回主線 */
    lay.items.forEach(function (it, i) {
      if (it.col !== 'side') return;
      var prev = lay.items[i - 1];
      if (prev && prev.col === 'side' && prev.owner === it.owner) {
        links.push({ id: 'b' + i, from: ids[i - 1], to: ids[i], label: '' });
      } else {
        var owner = lay.items[it.owner];
        links.push({
          id: 'b' + i, from: ids[it.owner], to: ids[i],
          label: (owner && owner.n.branch && owner.n.branch.label) || ''
        });
      }
      var next = lay.items[i + 1];
      var isLast = !(next && next.col === 'side' && next.owner === it.owner);
      if (!isLast) return;
      var ownerNode = lay.items[it.owner];
      if (ownerNode && ownerNode.n.branchEnds) return;
      for (var j = i + 1; j < lay.items.length; j++) {
        if (lay.items[j].col === 'main') { links.push({ id: 'j' + i, from: ids[i], to: ids[j], label: '' }); break; }
      }
    });

    /* 退回線：虛線 */
    lay.items.forEach(function (it, i) {
      if (!it.n.loop || it.n.loop.index == null) return;
      links.push({ id: 'r' + i, from: ids[i], to: ids[it.n.loop.index], label: it.n.loop.label, dash: true });
    });

    return normBoard({ shapes: shapes, links: links });
  }

  /* ── 命中測試與搬動：畫面層要用，但算的是幾何，所以放在這裡測得到 ── */

  /** 哪一個形狀被點到了。由上往下找（後畫的在上面）。 */
  function hitShape(board, x, y) {
    for (var i = board.shapes.length - 1; i >= 0; i--) {
      var s = board.shapes[i];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s;
    }
    return null;
  }

  /** 選取後的八個縮放把手；回傳 [{id,x,y}]，id 是 nw／n／ne／e／se／s／sw／w。 */
  function handlesOf(s) {
    var xs = [s.x, s.x + s.w / 2, s.x + s.w];
    var ys = [s.y, s.y + s.h / 2, s.y + s.h];
    return [
      { id: 'nw', x: xs[0], y: ys[0] }, { id: 'n', x: xs[1], y: ys[0] }, { id: 'ne', x: xs[2], y: ys[0] },
      { id: 'e', x: xs[2], y: ys[1] }, { id: 'se', x: xs[2], y: ys[2] }, { id: 's', x: xs[1], y: ys[2] },
      { id: 'sw', x: xs[0], y: ys[2] }, { id: 'w', x: xs[0], y: ys[1] }
    ];
  }

  /** 拉某一個把手之後的新方框。最小尺寸擋在這裡，不然會被拉成一條線。 */
  function resizeBy(s, handle, dx, dy) {
    var x = s.x, y = s.y, w = s.w, h = s.h;
    if (handle.indexOf('w') >= 0) { x = s.x + dx; w = s.w - dx; }
    if (handle.indexOf('e') >= 0) { w = s.w + dx; }
    if (handle.indexOf('n') >= 0) { y = s.y + dy; h = s.h - dy; }
    if (handle.indexOf('s') >= 0) { h = s.h + dy; }
    w = snap(w); h = snap(h);
    if (w < 60) { if (handle.indexOf('w') >= 0) x = s.x + s.w - 60; w = 60; }
    if (h < 28) { if (handle.indexOf('n') >= 0) y = s.y + s.h - 28; h = 28; }
    x = clamp(snap(x), 0, W - w);
    y = Math.max(0, snap(y));
    return { x: x, y: y, w: w, h: h };
  }

  /* ── 設定檔 ──────────────────────────────────────────────────────── */

  var BOARD_VERSION = 1;

  function buildBoardProject(o) {
    var s = o || {};
    var board = normBoard(s.board);
    return JSON.stringify({
      format: 'gongwu-diagram',
      kind: 'board',
      version: BOARD_VERSION,
      savedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      title: s.title || '',
      eyebrow: s.eyebrow || '',
      palette: s.palette || 'source',
      font: s.font || 'kai',
      shapes: board.shapes,
      links: board.links,
      source: DD.SOURCE.credit
    }, null, 2);
  }

  function parseBoardProject(text) {
    var data;
    try {
      data = JSON.parse(String(text));
    } catch (e) {
      throw new Error('這不是本站存出來的設定檔（檔案內容不是合法的 JSON）。');
    }
    if (!data || data.format !== 'gongwu-diagram') {
      throw new Error('這不是本站存出來的設定檔，請選副檔名為 .json 的「圖表設定」檔。');
    }
    if (data.kind !== 'board') {
      throw new Error('這是填表產生用的設定檔，不是畫板的。請到填表那一頁載入它。');
    }
    if (!(data.version <= BOARD_VERSION)) {
      throw new Error('這份設定檔是較新版本的站台存出來的（version ' + data.version +
        '），本站看不懂。請重新整理頁面後再試一次。');
    }
    var board = normBoard({ shapes: data.shapes, links: data.links });
    if (!board.shapes.length) throw new Error('設定檔裡一個形狀都沒有，載入了也是空白的。');
    return {
      board: board,
      title: String(data.title || ''), eyebrow: String(data.eyebrow || ''),
      palette: String(data.palette || 'source'), font: String(data.font || 'kai')
    };
  }

  return {
    W: W, GRID: GRID, JOG: JOG, KINDS: KINDS, COLORS: COLORS, ARROWS: ARROWS,
    kindById: kindById, colorById: colorById, snap: snap,
    normShape: normShape, normBoard: normBoard, boardHeight: boardHeight,
    anchor: anchor, routeLink: routeLink, linkMid: linkMid,
    renderBoard: renderBoard, boardFromFlow: boardFromFlow,
    hitShape: hitShape, handlesOf: handlesOf, resizeBy: resizeBy,
    BOARD_VERSION: BOARD_VERSION,
    buildBoardProject: buildBoardProject, parseBoardProject: parseBoardProject
  };
});
