/*
 * editor.js — 改字畫面的流程層。這一層才碰 DOM、才碰下載。
 * 所有「字串進、字串出」的規則都在 core.js，這裡只負責把它接到畫面上。
 *
 * 渲染是「每次都從乾淨的原圖重跑一遍」：換配色 → 灌回使用者改的字 → 自動縮字。
 * 不做增量更新，因為換配色是整份 SVG 字串換色，DOM 上的改動一定會被沖掉；
 * 與其記住哪些沒被沖掉，不如每次都重來一次，狀態只有一份。
 *
 * 圖表範本來源：https://github.com/cathrynlavery/diagram-design （MIT，Cathryn Lavery）
 */
(function (window, document) {
  'use strict';

  var DD = window.DD;
  var NS = 'http://www.w3.org/2000/svg';

  var el = {};
  var state = null;

  function $(id) { return document.getElementById(id); }

  function cacheEls() {
    ['stage', 'edKind', 'edHeading', 'edUse', 'edEyebrow', 'edTitleIn', 'paletteSel', 'scaleSel',
      'fitChk', 'textList', 'textCount', 'dlPng', 'dlSvg', 'dlHtml', 'resetBtn',
      'edErr', 'edOk', 'dlErr', 'pngNote', 'swatches'].forEach(function (id) { el[id] = $(id); });
  }

  function show(node, msg) {
    if (!node) return;
    node.textContent = msg || '';
    node.classList.toggle('show', !!msg);
  }

  /* ── 版面：把一張圖的可編輯文字切成一格一格 ─────────────────────────
     切法是「有 tspan 就一個 tspan 一格，沒有就整個 <text> 一格」。
     這樣每一格都保留自己的 x／dy／class，改字不會把上游排好的兩行併成一行。
     整個 <text> 那種才允許按 Enter 換行（我們自己生 tspan），tspan 那種不允許——
     它本來就是別人排好的其中一行。 */
  function collectUnits(svg) {
    var units = [];
    var texts = Array.prototype.slice.call(svg.querySelectorAll('text'));
    texts.forEach(function (t) {
      if (t.closest('defs') || t.closest('marker') || t.closest('clipPath')) return;
      var tspans = Array.prototype.slice.call(t.querySelectorAll('tspan'))
        .filter(function (s) { return !s.querySelector('tspan'); });
      if (tspans.length) {
        tspans.forEach(function (s) { units.push({ node: s, multiline: false }); });
      } else {
        units.push({ node: t, multiline: true });
      }
    });
    return units;
  }

  /** 目前這張 SVG 在畫面上被縮放了多少倍。字級要換算回 SVG 自己的座標單位。 */
  function scaleFactor(svg, box) {
    var w = svg.getBoundingClientRect().width;
    return w && box && box.w ? w / box.w : 1;
  }

  function setUnitText(unit, value, lineHeight) {
    var node = unit.node;
    var lines = String(value).split('\n');
    if (!unit.multiline || lines.length === 1) {
      node.textContent = lines.join(' ');
      return;
    }
    var x = node.getAttribute('x');
    if (x == null) {
      var first = node.querySelector('tspan');
      x = first ? first.getAttribute('x') : '0';
    }
    while (node.firstChild) node.removeChild(node.firstChild);
    lines.forEach(function (line, i) {
      var ts = document.createElementNS(NS, 'tspan');
      if (x != null) ts.setAttribute('x', x);
      ts.setAttribute('dy', i ? lineHeight : 0);
      ts.textContent = line;
      node.appendChild(ts);
    });
  }

  /* ── 渲染 ────────────────────────────────────────────────────────── */

  function render() {
    if (!state) return;
    var d = state.d;
    var res = DD.resolveColors(state.paletteId, d.dark);
    var markup = res.to ? DD.applyPalette(d.svg, res.from, res.to) : d.svg;
    state.colors = res.colors;

    el.stage.innerHTML = markup;
    var svg = el.stage.querySelector('svg');
    if (!svg) { show(el.edErr, '這張範本的圖檔讀不出來，請回列表換一張。'); return; }
    svg.removeAttribute('width');
    svg.removeAttribute('height');

    var box = DD.parseViewBox(markup) || { w: d.w, h: d.h };
    var units = collectUnits(svg);
    state.units = units;

    /* 第一次開這張圖時，把原文與原本的寬度記下來——之後所有的「塞不塞得下」
       都是拿現在的寬度跟這個原始寬度比。範本的框就是照原文的寬度畫的。 */
    if (!state.orig) {
      state.orig = units.map(function (u) {
        return {
          text: u.node.textContent.replace(/\s+/g, ' ').trim(),
          width: safeLen(u.node)
        };
      });
    }

    var sf = scaleFactor(svg, box);
    units.forEach(function (u, i) {
      var edit = state.edits[i];
      if (edit == null) return;
      var base = state.orig[i] || { width: 0 };
      var fs = parseFloat(window.getComputedStyle(u.node).fontSize) / (sf || 1);
      setUnitText(u, edit, fs * 1.2);
      if (!state.fit) return;
      var now = safeLen(u.node);
      /* 中文比英文寬，同樣的意思常常寬一倍。留 12% 的餘裕再開始縮，
         不然只多一個字就整段變小，看起來像壞掉。 */
      var fitted = DD.shrinkToFit(fs, now, base.width * 1.12, Math.max(6, fs * 0.45));
      if (fitted !== fs) u.node.style.fontSize = fitted + 'px';
    });

    bindStageClicks(units);
    highlight(state.selected);
  }

  function safeLen(node) {
    try { return node.getComputedTextLength ? node.getComputedTextLength() : 0; }
    catch (e) { return 0; }
  }

  function bindStageClicks(units) {
    units.forEach(function (u, i) {
      u.node.addEventListener('click', function (ev) {
        ev.stopPropagation();
        selectUnit(i, true);
      });
    });
  }

  /** 選取框畫成同一個 parent 底下的兄弟元素，座標系跟被選的字一模一樣，不必換算矩陣。 */
  function highlight(idx) {
    var old = el.stage.querySelector('.dd-highlight');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (idx == null || !state || !state.units[idx]) return;
    var node = state.units[idx].node;
    var bb;
    try { bb = node.getBBox(); } catch (e) { return; }
    if (!bb || !bb.width) return;
    var r = document.createElementNS(NS, 'rect');
    r.setAttribute('class', 'dd-highlight');
    r.setAttribute('x', bb.x - 2);
    r.setAttribute('y', bb.y - 2);
    r.setAttribute('width', bb.width + 4);
    r.setAttribute('height', bb.height + 4);
    r.setAttribute('fill', 'none');
    r.setAttribute('stroke', '#9d2b25');
    r.setAttribute('stroke-width', '1.5');
    r.setAttribute('rx', '2');
    r.setAttribute('pointer-events', 'none');
    node.parentNode.insertBefore(r, node);
  }

  function selectUnit(idx, focusField) {
    state.selected = idx;
    Array.prototype.forEach.call(el.textList.children, function (row, i) {
      row.classList.toggle('on', i === idx);
    });
    highlight(idx);
    var field = el.textList.querySelector('#dd-t' + idx);
    if (field && focusField) {
      field.focus();
      field.scrollIntoView({ block: 'center' });
    }
  }

  /* ── 文字清單 ────────────────────────────────────────────────────── */

  function buildTextList() {
    el.textList.innerHTML = '';
    var frag = document.createDocumentFragment();
    state.orig.forEach(function (o, i) {
      var row = document.createElement('div');
      row.className = 'trow';

      var orig = document.createElement('div');
      orig.className = 'orig';
      orig.textContent = o.text || '（空白）';

      var wrap = document.createElement('div');
      var label = document.createElement('label');
      label.className = 'sr-only';
      label.htmlFor = 'dd-t' + i;
      label.textContent = '第 ' + (i + 1) + ' 段文字，原文：' + (o.text || '空白');

      var ta = document.createElement('textarea');
      ta.id = 'dd-t' + i;
      ta.rows = 1;
      ta.value = state.edits[i] != null ? state.edits[i] : o.text;
      ta.addEventListener('input', function () {
        state.edits[i] = ta.value;
        autoGrow(ta);
        render();
      });
      ta.addEventListener('focus', function () { selectUnit(i, false); });

      wrap.appendChild(label);
      wrap.appendChild(ta);
      row.appendChild(orig);
      row.appendChild(wrap);
      frag.appendChild(row);
    });
    el.textList.appendChild(frag);
    Array.prototype.forEach.call(el.textList.querySelectorAll('textarea'), autoGrow);

    var n = state.orig.length;
    el.textCount.textContent = '共 ' + n + ' 段。左邊灰字是範本原文，改右邊的框，上面的圖會即時更新。' +
      '單獨一段的文字可以按 Enter 換行；本來就分行排好的那種（例如兩行的方塊字）一行一格，不吃換行。';
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(42, ta.scrollHeight + 2) + 'px';
  }

  /* ── 匯出 ────────────────────────────────────────────────────────── */

  /** 把畫面上這張 SVG 拷一份出來，拿掉只有編輯時才需要的東西。 */
  function currentSvgMarkup() {
    var svg = el.stage.querySelector('svg');
    if (!svg) return '';
    var clone = svg.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('.dd-highlight'), function (n) {
      n.parentNode.removeChild(n);
    });
    clone.setAttribute('xmlns', NS);
    return new XMLSerializer().serializeToString(clone);
  }

  function composed() {
    return DD.composeExportSvg({
      svg: currentSvgMarkup(),
      eyebrow: el.edEyebrow.value,
      heading: el.edTitleIn.value,
      title: state.d.title,
      colors: state.colors
    });
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function baseName() {
    return el.edTitleIn.value.trim() || state.d.typeZh || '圖表';
  }

  function saveSvg() {
    show(el.dlErr, '');
    try {
      download(new Blob([DD.svgFile(composed())], { type: 'image/svg+xml;charset=utf-8' }),
        DD.safeFilename(baseName(), 'svg'));
      show(el.edOk, '已下載 SVG。');
    } catch (e) {
      show(el.dlErr, '產生 SVG 時出錯：' + e.message);
    }
  }

  function saveHtml() {
    show(el.dlErr, '');
    try {
      var html = DD.buildStandaloneHtml({
        svg: composed(), heading: el.edTitleIn.value, title: state.d.title, colors: state.colors
      });
      download(new Blob([html], { type: 'text/html;charset=utf-8' }),
        DD.safeFilename(baseName(), 'html'));
      show(el.edOk, '已下載 HTML。用瀏覽器開起來後可以直接列印成 PDF。');
    } catch (e) {
      show(el.dlErr, '產生 HTML 時出錯：' + e.message);
    }
  }

  /**
   * PNG 是把 SVG 丟進 <img> 再畫到 canvas 上。
   * <img> 裡的 SVG 不會去抓任何外部資源，所以這一步一樣是零對外連線；
   * 但也因此 <foreignObject> 不會被畫出來——那幾張圖的 PNG 按鈕會直接停用。
   */
  function savePng() {
    show(el.dlErr, '');
    show(el.edOk, '');
    var scale = parseFloat(el.scaleSel.value) || 2;
    var svgText = DD.svgFile(composed());
    var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      try {
        var w = Math.round((img.naturalWidth || 1000) * scale);
        var h = Math.round((img.naturalHeight || 600) * scale);
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = (state.colors && state.colors.paper) || '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function (out) {
          URL.revokeObjectURL(url);
          if (!out) { show(el.dlErr, '這張圖轉不成 PNG，請改用 SVG 或 HTML 下載。'); return; }
          download(out, DD.safeFilename(baseName(), 'png'));
          show(el.edOk, '已下載 PNG（' + w + '×' + h + '）。');
        }, 'image/png');
      } catch (e) {
        URL.revokeObjectURL(url);
        show(el.dlErr, '轉 PNG 時出錯：' + e.message + '。請改用 SVG 或 HTML 下載。');
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      show(el.dlErr, '這張圖轉不成 PNG，請改用 SVG 或 HTML 下載。');
    };
    img.src = url;
  }

  /* ── 對外介面 ────────────────────────────────────────────────────── */

  function fillPalettes() {
    if (el.paletteSel.options.length) return;
    DD.PALETTES.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      el.paletteSel.appendChild(o);
    });
  }

  function renderSwatches() {
    el.swatches.innerHTML = '';
    var c = state.colors || DD.UPSTREAM_LIGHT;
    [['底色', c.paper], ['文字', c.ink], ['次要', c.muted], ['強調', c.accent]].forEach(function (pair) {
      var s = document.createElement('span');
      s.className = 'swatch';
      var i = document.createElement('i');
      i.style.background = pair[1];
      s.appendChild(i);
      s.appendChild(document.createTextNode(pair[0] + ' ' + pair[1]));
      el.swatches.appendChild(s);
    });
  }

  function open(diagram) {
    cacheEls();
    fillPalettes();
    state = {
      d: diagram,
      edits: {},
      orig: null,
      units: [],
      selected: null,
      paletteId: el.paletteSel.value || 'source',
      fit: el.fitChk.checked,
      colors: diagram.dark ? DD.UPSTREAM_DARK : DD.UPSTREAM_LIGHT
    };

    el.edKind.textContent = diagram.typeZh + '　' + diagram.variantZh;
    el.edHeading.textContent = diagram.heading || diagram.title || diagram.typeZh;
    el.edUse.textContent = diagram.use || '';
    el.edEyebrow.value = diagram.typeZh;
    el.edTitleIn.value = '';
    show(el.edErr, '');
    show(el.edOk, '');
    show(el.dlErr, '');

    render();
    buildTextList();
    renderSwatches();

    el.dlPng.disabled = !diagram.png;
    el.pngNote.hidden = !!diagram.png;
    if (!diagram.png) {
      el.pngNote.textContent = '這張範本用到了 SVG 的 foreignObject，瀏覽器不會把它畫進 PNG 裡，' +
        '所以 PNG 這條路對它是壞的。請改用 SVG（Word 可以直接插入）或 HTML（用瀏覽器列印成 PDF）。';
    }
    document.title = (diagram.heading || diagram.typeZh) + ' — 公務用圖表範本庫';
  }

  function bind() {
    cacheEls();
    el.paletteSel.addEventListener('change', function () {
      if (!state) return;
      state.paletteId = el.paletteSel.value;
      render();
      renderSwatches();
    });
    el.fitChk.addEventListener('change', function () {
      if (!state) return;
      state.fit = el.fitChk.checked;
      render();
    });
    [el.edEyebrow, el.edTitleIn].forEach(function (input) {
      input.addEventListener('input', function () { show(el.edOk, ''); });
    });
    el.dlPng.addEventListener('click', savePng);
    el.dlSvg.addEventListener('click', saveSvg);
    el.dlHtml.addEventListener('click', saveHtml);
    el.resetBtn.addEventListener('click', function () {
      if (!state) return;
      state.edits = {};
      state.selected = null;
      el.edTitleIn.value = '';
      el.edEyebrow.value = state.d.typeZh;
      el.paletteSel.value = 'source';
      state.paletteId = 'source';
      render();
      buildTextList();
      renderSwatches();
      show(el.edOk, '已復原成範本原本的樣子。');
    });
  }

  window.DDEditor = { open: open, bind: bind, _state: function () { return state; } };
})(window, document);
