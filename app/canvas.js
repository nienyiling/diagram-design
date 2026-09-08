/*
 * canvas.js — 自由畫板的畫面層：拖、拉、連、改字改色。這一支才碰 DOM。
 *
 * 幾何全部在 board.js（純函式，測得到）；這裡只負責把手指／滑鼠的動作
 * 換算成「形狀的座標變成多少」，再交回去重畫。
 *
 * 三個刻意的取捨：
 *
 * 1. **加形狀用「點一下」，不是從工具列拖進來。** HTML5 的 drag-and-drop
 *    在觸控裝置上根本不會動，而使用者有一半是拿平板或手機開的。
 *    點一下就放到畫面中央，再拖到想要的位置——步驟一樣少，而且到處都能用。
 *
 * 2. **指標事件（pointer events）一套走天下**，不寫 mouse／touch 兩份。
 *    `setPointerCapture` 讓手指滑出方塊外也還抓得住，不會拖到一半斷掉。
 *
 * 3. **連線點兩下：先點起點、再點終點。** 從邊緣的小圓點拉出來那種做法，
 *    在手機上小到按不到。這裡改成一個明確的「連線」模式，畫面上有狀態提示。
 *
 * 畫板是**單向門**：填表產生的圖可以搬進畫板，但改完不能搬回表單——
 * 表單描述的是「一串有順序的列」，畫板是「一堆有座標的框」，回不去。
 * 所以搬進來之前要問一聲。
 */
(function (window, document) {
  'use strict';

  var DD = window.DD;
  var B = window.DDBoard;

  var STORE_KEY = 'gongwu-diagram-board-v1';
  var UNDO_MAX = 40;

  var el = {};
  var board = { shapes: [], links: [] };
  var undo = [];
  var sel = null;          /* 選取中的形狀 id */
  var linkFrom = null;     /* 連線模式：起點的形狀 id；null＝不在連線模式 */
  var linking = false;
  var drag = null;         /* {mode:'move'|'resize', id, handle, ox, oy, start} */
  var saveTimer = null;

  function $(id) { return document.getElementById(id); }

  function show(node, msg) {
    if (!node) return;
    node.textContent = msg || '';
    node.classList.toggle('show', !!msg);
  }

  function byId(id) {
    for (var i = 0; i < board.shapes.length; i++) if (board.shapes[i].id === id) return board.shapes[i];
    return null;
  }

  function newId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ── 留住使用者畫的東西 ─────────────────────────────────────────── */

  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(board));
      } catch (e) { /* 無痕模式或空間滿了：不影響現在這一趟操作 */ }
    }, 400);
  }

  function restore() {
    var raw;
    try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var got = B.normBoard(JSON.parse(raw));
      if (got.shapes.length) board = got;
    } catch (e) { /* 上一版寫的、或壞掉了：當作沒有 */ }
  }

  function snapshot() {
    undo.push(JSON.stringify(board));
    if (undo.length > UNDO_MAX) undo.shift();
    refreshUndo();
  }

  function refreshUndo() {
    if (!el.bdUndoBtn) return;
    el.bdUndoBtn.disabled = !undo.length;
    el.bdUndoBtn.textContent = undo.length ? '↶ 復原（' + undo.length + '）' : '↶ 復原';
  }

  /* ── 畫 ──────────────────────────────────────────────────────────── */

  /** 畫板本身（含格線與選取框）畫在 #bdStage；匯出用的那份不含這些。 */
  function paint() {
    el.bdStage.innerHTML = B.renderBoard(board, { grid: true, title: el.edTitleIn.value || '自己畫的圖' });
    var svg = el.bdStage.querySelector('svg');
    if (!svg) return;
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.touchAction = 'none';   /* 不讓瀏覽器把拖曳吃掉去捲頁面 */

    if (sel && byId(sel)) drawSelection(svg, byId(sel));
    if (linking && linkFrom && byId(linkFrom)) drawPending(svg, byId(linkFrom));

    /* 事件掛在外面那個容器上，不是掛在 svg 上。
       paint() 每次都把 svg 整個換掉，掛在 svg 上的話 setPointerCapture
       會跟著被消滅——拖曳一動就斷，而且完全看不出哪裡壞了。 */

    el.bdCount.textContent = board.shapes.length
      ? board.shapes.length + ' 個形狀、' + board.links.length + ' 條線。' +
        '拖方塊可以移動，拖角落的小方塊可以改大小。'
      : '畫板是空的。從上面挑一個形狀加進來。';
    syncPanel();
    updateExport();
  }

  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function drawSelection(svg, s) {
    var g = svgEl('g', { 'data-ui': 'sel', 'pointer-events': 'none' });
    g.appendChild(svgEl('rect', {
      x: s.x - 3, y: s.y - 3, width: s.w + 6, height: s.h + 6, rx: 8,
      fill: 'none', stroke: DD.UPSTREAM_LIGHT.accent, 'stroke-width': 1.4, 'stroke-dasharray': '4 3'
    }));
    B.handlesOf(s).forEach(function (h) {
      var r = svgEl('rect', {
        x: h.x - 6, y: h.y - 6, width: 12, height: 12, rx: 2,
        fill: '#ffffff', stroke: DD.UPSTREAM_LIGHT.accent, 'stroke-width': 1.4,
        'data-handle': h.id, 'pointer-events': 'all'
      });
      r.style.cursor = /^(n|s)$/.test(h.id) ? 'ns-resize'
        : (/^(e|w)$/.test(h.id) ? 'ew-resize'
          : (h.id === 'nw' || h.id === 'se' ? 'nwse-resize' : 'nesw-resize'));
      g.appendChild(r);
    });
    g.setAttribute('pointer-events', 'all');
    svg.appendChild(g);
  }

  function drawPending(svg, s) {
    svg.appendChild(svgEl('rect', {
      x: s.x - 4, y: s.y - 4, width: s.w + 8, height: s.h + 8, rx: 9,
      fill: 'none', stroke: DD.UPSTREAM_LIGHT.accent, 'stroke-width': 2,
      'pointer-events': 'none'
    }));
  }

  /** 畫面座標 → SVG 座標。SVG 被縮放過，不換算的話拖曳會越拖越偏。 */
  function toSvg(ev) {
    var svg = el.bdStage.querySelector('svg');
    if (!svg) return { x: 0, y: 0 };
    var r = svg.getBoundingClientRect();
    var scale = r.width ? B.W / r.width : 1;
    return { x: (ev.clientX - r.left) * scale, y: (ev.clientY - r.top) * scale };
  }

  /* ── 拖、拉、連 ──────────────────────────────────────────────────── */

  function onDown(ev) {
    if (el.bdCard.hidden) return;
    if (!el.bdStage.querySelector('svg')) return;
    /* 不擋的話瀏覽器會把「按住拖」當成選取文字，整頁反白，而且拖不動方塊 */
    ev.preventDefault();
    var p = toSvg(ev);
    var handle = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-handle');
    var hit = B.hitShape(board, p.x, p.y);

    if (linking) {
      if (!hit) { setLinking(false); return; }
      if (!linkFrom) { linkFrom = hit.id; paint(); showTip('再點一次「要連到哪一個形狀」。'); return; }
      if (hit.id === linkFrom) { showTip('起點和終點不能是同一個形狀。'); return; }
      snapshot();
      board.links.push({ id: 'l' + Date.now().toString(36), from: linkFrom, to: hit.id, label: '', dash: false });
      persist();
      linkFrom = null;
      setLinking(false);
      showTip('連好了。線會黏在形狀上，拖動方塊時線會跟著跑。');
      return;
    }

    if (handle && sel) {
      var s0 = byId(sel);
      drag = { mode: 'resize', id: sel, handle: handle, ox: p.x, oy: p.y, start: JSON.parse(JSON.stringify(s0)) };
      snapshot();
      capture(ev);
      return;
    }

    if (!hit) { sel = null; paint(); return; }
    sel = hit.id;
    drag = { mode: 'move', id: hit.id, ox: p.x, oy: p.y, start: JSON.parse(JSON.stringify(hit)) };
    snapshot();
    capture(ev);
    paint();
  }

  function onMove(ev) {
    if (!drag) return;
    ev.preventDefault();
    var p = toSvg(ev);
    var s = byId(drag.id);
    if (!s) return;
    var dx = p.x - drag.ox, dy = p.y - drag.oy;
    if (drag.mode === 'move') {
      s.x = Math.min(Math.max(B.snap(drag.start.x + dx), 0), B.W - s.w);
      s.y = Math.max(0, B.snap(drag.start.y + dy));
    } else {
      var box = B.resizeBy(drag.start, drag.handle, dx, dy);
      s.x = box.x; s.y = box.y; s.w = box.w; s.h = box.h;
    }
    paint();
  }

  function onUp(ev) {
    if (!drag) return;
    try { el.bdStage.releasePointerCapture(ev.pointerId); } catch (e) { /* 已經放掉了 */ }
    /* 只是點一下、沒有真的移動：那一步不值得留在復原堆疊裡 */
    var s = byId(drag.id);
    if (s && s.x === drag.start.x && s.y === drag.start.y &&
        s.w === drag.start.w && s.h === drag.start.h) {
      undo.pop();
      refreshUndo();
    } else {
      persist();
    }
    drag = null;
  }

  /** 抓住這根手指。抓在容器上，重畫不會把它弄掉。 */
  function capture(ev) {
    try { el.bdStage.setPointerCapture(ev.pointerId); } catch (e) { /* 舊瀏覽器：照樣能拖，只是滑出去會斷 */ }
  }

  function setLinking(on) {
    linking = !!on;
    if (!linking) linkFrom = null;
    el.bdLinkBtn.classList.toggle('on', linking);
    el.bdLinkBtn.setAttribute('aria-pressed', linking ? 'true' : 'false');
    if (linking) showTip('點一下「線要從哪一個形狀出發」。');
    else if (!linkFrom) showTip('');
    paint();
  }

  function showTip(msg) { show(el.bdTip, msg); }

  /* ── 右邊那一排：改字、改色、改形狀 ─────────────────────────────── */

  function syncPanel() {
    var s = sel && byId(sel);
    el.bdPanel.hidden = !s;
    el.bdNoSel.hidden = !!s;
    if (!s) return;
    el.bdText.value = s.text;
    el.bdSub.value = s.sub;
    el.bdKind.value = s.kind;
    el.bdColor.value = s.color;
    el.bdSize.value = String(s.size);
    el.bdSizeOut.textContent = s.size + ' px';

    /* 這個形狀身上的線，可以在這裡改標籤或刪掉 */
    el.bdLinks.innerHTML = '';
    var mine = board.links.filter(function (l) { return l.from === s.id || l.to === s.id; });
    el.bdLinksWrap.hidden = !mine.length;
    mine.forEach(function (l) {
      var other = byId(l.from === s.id ? l.to : l.from);
      var row = document.createElement('div');
      row.className = 'bdlink';
      var lab = document.createElement('span');
      lab.className = 'bdlink-name';
      lab.textContent = (l.from === s.id ? '→ ' : '← ') + ((other && other.text) || '（沒有文字）');
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.value = l.label;
      inp.placeholder = '線上的字';
      inp.setAttribute('aria-label', '這條線上的字');
      inp.addEventListener('input', function () { l.label = inp.value; persist(); paint(); });
      var dash = document.createElement('button');
      dash.type = 'button';
      dash.className = 'ficon';
      dash.textContent = l.dash ? '⋯' : '—';
      dash.title = l.dash ? '改成實線' : '改成虛線（退回、參照用）';
      dash.setAttribute('aria-label', dash.title);
      dash.addEventListener('click', function () { snapshot(); l.dash = !l.dash; persist(); paint(); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ficon';
      del.textContent = '✕';
      del.title = '刪掉這條線';
      del.setAttribute('aria-label', '刪掉這條線');
      del.addEventListener('click', function () {
        snapshot();
        board.links = board.links.filter(function (x) { return x !== l; });
        persist();
        paint();
        showTip('刪掉一條線了。按「復原」可以救回來。');
      });
      row.appendChild(lab);
      row.appendChild(inp);
      row.appendChild(dash);
      row.appendChild(del);
      el.bdLinks.appendChild(row);
    });
  }

  function editSel(fn) {
    var s = sel && byId(sel);
    if (!s) return;
    fn(s);
    persist();
    paint();
  }

  function addShape(kindId) {
    var k = B.kindById(kindId);
    snapshot();
    /* 接在最下面那一個底下，不要疊在一起——疊著的話使用者一拖就抓到別的形狀，
       而且畫面上完全看不出來剛才加的是哪一個。連按四次「步驟」就是一直排下去，
       接著連線就好。 */
    var col = B.W / 2 - k.w / 2;
    var y = 60;
    board.shapes.forEach(function (o) {
      /* 只看跟新形狀同一欄的，右邊那些分支不該把新的一格推下去 */
      if (o.x + o.w < col || o.x > col + k.w) return;
      if (o.y + o.h + 40 > y) y = o.y + o.h + 40;
    });
    var s = B.normShape({
      id: newId(), kind: k.id, x: col, y: y,
      w: k.w, h: k.h, text: '', color: 'plain'
    }, board.shapes.length);
    board.shapes.push(s);
    sel = s.id;
    persist();
    paint();
    el.bdText.focus();
    showTip('加了一個「' + k.name + '」。在右邊打字，或直接拖它到想要的位置。');
  }

  function delSel() {
    var s = sel && byId(sel);
    if (!s) return;
    snapshot();
    board.shapes = board.shapes.filter(function (x) { return x.id !== s.id; });
    /* 連到它的線一起走，不然會留下指不到形狀的線 */
    board.links = board.links.filter(function (l) { return l.from !== s.id && l.to !== s.id; });
    sel = null;
    persist();
    paint();
    showTip('刪掉一個形狀（連著的線也一起）。按「復原」可以救回來。');
  }

  /* ── 匯出：交給 editor.js，下載那一整套沿用 ──────────────────────── */

  function updateExport() {
    /* 匯出的那份不畫格線也不畫選取框——格線印出來很醜 */
    var svg = B.renderBoard(board, { grid: false, title: el.edTitleIn.value || '自己畫的圖' });
    var box = DD.parseViewBox(svg) || { w: B.W, h: 600 };
    window.DDEditor.open({
      id: 'board', type: 'board', typeZh: '自己畫的圖', variantZh: '畫板',
      use: '自己拖形狀、自己連線', variant: '', dark: false,
      title: '自己畫的圖', eyebrow: '流程圖', heading: '', desc: '',
      w: box.w, h: box.h, png: true, segs: 0,
      zhKind: '', zhCount: 0, zhHeading: '', zhEyebrow: '流程圖', zh: null,
      svg: svg
    }, {
      flow: true, keepTitle: true,
      genHeading: '自己畫一張圖',
      genUse: '拖形狀、連線、改字改色。線黏在形狀上，拖動方塊時線會跟著跑。'
    });
  }

  /* ── 設定檔 ──────────────────────────────────────────────────────── */

  function saveProject() {
    show(el.bdErr, '');
    try {
      var text = B.buildBoardProject({
        board: board, title: el.edTitleIn.value, eyebrow: el.edEyebrow.value,
        palette: el.paletteSel.value, font: el.fontSel.value
      });
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = DD.safeFilename((el.edTitleIn.value.trim() || '自己畫的圖') + '-畫板', 'json');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      showTip('已存出畫板設定檔。下次載入它就接著畫。');
    } catch (e) {
      show(el.bdErr, '存出設定檔時出錯：' + e.message);
    }
  }

  function loadProject(file) {
    show(el.bdErr, '');
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = B.parseBoardProject(reader.result);
      } catch (e) {
        show(el.bdErr, e.message);
        return;
      }
      snapshot();
      board = data.board;
      sel = null;
      if (data.title) el.edTitleIn.value = data.title;
      if (data.eyebrow) el.edEyebrow.value = data.eyebrow;
      persist();
      paint();
      showTip('已載入畫板（' + board.shapes.length + ' 個形狀）。');
    };
    reader.onerror = function () { show(el.bdErr, '這個檔案讀不進來，請確認它沒有被其他程式開著。'); };
    reader.readAsText(file);
  }

  /* ── 對外 ────────────────────────────────────────────────────────── */

  function init() {
    ['bdCard', 'bdStage', 'bdTools', 'bdCount', 'bdTip', 'bdErr', 'bdPanel', 'bdNoSel',
      'bdText', 'bdSub', 'bdKind', 'bdColor', 'bdSize', 'bdSizeOut', 'bdDelBtn',
      'bdLinkBtn', 'bdLinks', 'bdLinksWrap', 'bdUndoBtn', 'bdClearBtn',
      'bdSaveBtn', 'bdLoadInput', 'edTitleIn', 'edEyebrow', 'paletteSel', 'fontSel']
      .forEach(function (id) { el[id] = $(id); });

    restore();

    el.bdStage.addEventListener('pointerdown', onDown);
    el.bdStage.addEventListener('pointermove', onMove);
    el.bdStage.addEventListener('pointerup', onUp);
    el.bdStage.addEventListener('pointercancel', onUp);

    /* 工具列與下拉是照 board.js 的規格長出來的，不是另外手寫一份 */
    B.KINDS.forEach(function (k) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bdtool';
      btn.title = k.hint;
      btn.innerHTML = '<span class="bdtool-i" aria-hidden="true"></span>';
      btn.querySelector('.bdtool-i').className = 'bdtool-i k-' + k.id;
      btn.appendChild(document.createTextNode(k.name));
      btn.addEventListener('click', function () { addShape(k.id); });
      el.bdTools.appendChild(btn);
      var o = document.createElement('option');
      o.value = k.id;
      o.textContent = k.name;
      el.bdKind.appendChild(o);
    });
    B.COLORS.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      el.bdColor.appendChild(o);
    });

    el.bdText.addEventListener('input', function () { editSel(function (s) { s.text = el.bdText.value; }); });
    el.bdSub.addEventListener('input', function () { editSel(function (s) { s.sub = el.bdSub.value; }); });
    el.bdKind.addEventListener('change', function () {
      snapshot();
      editSel(function (s) { s.kind = el.bdKind.value; });
    });
    el.bdColor.addEventListener('change', function () {
      snapshot();
      editSel(function (s) { s.color = el.bdColor.value; });
    });
    el.bdSize.addEventListener('input', function () {
      editSel(function (s) { s.size = Number(el.bdSize.value); });
    });
    el.bdDelBtn.addEventListener('click', delSel);
    el.bdLinkBtn.addEventListener('click', function () { setLinking(!linking); });
    el.bdUndoBtn.addEventListener('click', function () {
      if (!undo.length) return;
      board = B.normBoard(JSON.parse(undo.pop()));
      sel = null;
      refreshUndo();
      persist();
      paint();
      showTip('已復原。');
    });
    el.bdClearBtn.addEventListener('click', function () {
      if (!board.shapes.length) return;
      snapshot();
      board = { shapes: [], links: [] };
      sel = null;
      persist();
      paint();
      showTip('已全部清空。按「復原」可以救回來。');
    });
    el.bdSaveBtn.addEventListener('click', saveProject);
    el.bdLoadInput.addEventListener('change', function () {
      var f = el.bdLoadInput.files && el.bdLoadInput.files[0];
      if (f) loadProject(f);
      el.bdLoadInput.value = '';
    });

    /* 鍵盤：Delete 刪掉、方向鍵推一格。滑鼠拖不準的時候要有辦法對齊。 */
    document.addEventListener('keydown', function (ev) {
      if (el.bdCard.hidden || !sel) return;
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var step = ev.shiftKey ? B.GRID * 5 : B.GRID;
      var moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[ev.key]) {
        ev.preventDefault();
        snapshot();
        editSel(function (s) {
          s.x = Math.min(Math.max(s.x + moves[ev.key][0], 0), B.W - s.w);
          s.y = Math.max(0, s.y + moves[ev.key][1]);
        });
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        delSel();
      } else if (ev.key === 'Escape') {
        if (linking) setLinking(false);
        else { sel = null; paint(); }
      }
    });
  }

  /** 從填表產生的那張圖搬進畫板。單向門，所以呼叫端要先問過使用者。 */
  function seed(nodes) {
    snapshot();
    board = B.boardFromFlow(nodes);
    sel = null;
    persist();
    paint();
    showTip('已把剛才那張圖搬進畫板（' + board.shapes.length + ' 個形狀）。' +
      '每一格都拖得動了。改完不能再回到填表畫面。');
  }

  function open() {
    el.bdCard.hidden = false;
    if (!el.edTitleIn.value || el.edTitleIn.dataset.gen !== 'board') {
      el.edTitleIn.value = '自己畫的圖';
      el.edEyebrow.value = '流程圖';
      el.edTitleIn.dataset.gen = 'board';
    }
    refreshUndo();
    paint();
    return true;
  }

  function close() { if (el.bdCard) el.bdCard.hidden = true; }

  window.DDCanvas = {
    init: init, open: open, close: close, seed: seed,
    _board: function () { return board; },
    _select: function (id) { sel = id; paint(); },
    _paint: paint
  };
})(window, document);
