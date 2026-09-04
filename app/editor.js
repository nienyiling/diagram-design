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
      'fontSel', 'fitChk', 'zhChk', 'zhRow', 'zhNote', 'textList', 'textCount',
      'pasteBox', 'pasteBtn', 'pasteErr', 'copyPngBtn', 'saveProjBtn', 'loadProjInput', 'textCard',
      'dlPng', 'dlSvg', 'dlHtml', 'resetBtn', 'projBox', 'edErr', 'edOk', 'dlErr', 'pngNote', 'swatches']
      .forEach(function (id) { el[id] = $(id); });
  }

  /**
   * 第 i 段現在該顯示什麼字，優先序：
   *   使用者自己改的 → 中文層（有開的話）→ 範本原文
   * 三層都走同一個函式，畫面、文字清單、下載才不會各說各話。
   */
  function effectiveText(i) {
    if (state.edits[i] != null) return state.edits[i];
    if (state.zhOn && state.d.zh && state.d.zh[i]) return state.d.zh[i];
    return state.orig ? state.orig[i].text : '';
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
    markup = DD.forceFontFamily(markup, DD.fontChoiceById(state.font).stack);
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
      var base = state.orig[i] || { width: 0, text: '' };
      var want = effectiveText(i);
      if (want === base.text) return;
      var fs = parseFloat(window.getComputedStyle(u.node).fontSize) / (sf || 1);
      setUnitText(u, want, fs * 1.2);
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
    if (state.flow) return;
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
    if (state.flow) return;
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
      ta.value = effectiveText(i);
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
  function makePng() {
    return new Promise(function (resolve, reject) {
      var scale = parseFloat(el.scaleSel.value) || 2;
      var blob = new Blob([DD.svgFile(composed())], { type: 'image/svg+xml;charset=utf-8' });
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
            if (!out) reject(new Error('畫不出圖片'));
            else resolve({ blob: out, w: w, h: h });
          }, 'image/png');
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('圖片載不進來'));
      };
      img.src = url;
    });
  }

  function savePng() {
    show(el.dlErr, '');
    show(el.edOk, '');
    makePng().then(function (r) {
      download(r.blob, DD.safeFilename(baseName(), 'png'));
      show(el.edOk, '已下載 PNG（' + r.w + '×' + r.h + '）。');
    }).catch(function (e) {
      show(el.dlErr, '這張圖轉不成 PNG（' + e.message + '），請改用 SVG 或 HTML 下載。');
    });
  }

  /**
   * 直接複製到剪貼簿，省下「先存檔、再插入圖片」那兩步——
   * 對「改一張圖貼進簽稿」這種一次性的事，這才是最短路徑。
   * 需要瀏覽器支援 ClipboardItem，而且要在 https 底下；不支援時要講清楚替代做法。
   */
  function copyPng() {
    show(el.dlErr, '');
    show(el.edOk, '');
    if (!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)) {
      show(el.dlErr, '這個瀏覽器不支援直接複製圖片到剪貼簿，請改按「下載 PNG」，再從 Word 插入圖片。');
      return;
    }
    makePng().then(function (r) {
      return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': r.blob })])
        .then(function () {
          show(el.edOk, '已複製到剪貼簿（' + r.w + '×' + r.h + '），到 Word 或簡報按 Ctrl+V 貼上。');
        });
    }).catch(function (e) {
      show(el.dlErr, '複製到剪貼簿失敗（' + e.message + '）。請改按「下載 PNG」，再從 Word 插入圖片。');
    });
  }

  /* ── 存檔與載入：改到一半可以留住，也能交給同事接手 ─────────────────── */

  function saveProject() {
    show(el.dlErr, '');
    try {
      var text = DD.buildProjectFile({
        id: state.d.id,
        name: state.d.typeZh + '：' + (el.edTitleIn.value || state.d.heading || ''),
        palette: state.paletteId,
        font: state.font,
        fit: state.fit,
        zhOn: state.zhOn,
        eyebrow: el.edEyebrow.value,
        heading: el.edTitleIn.value,
        edits: state.edits
      });
      download(new Blob([text], { type: 'application/json;charset=utf-8' }),
        DD.safeFilename(baseName() + '（圖表設定）', 'json'));
      show(el.edOk, '已存出設定檔。下次在同一張範本按「載入設定」就能接著改，也可以傳給同事。');
    } catch (e) {
      show(el.dlErr, '存設定檔時出錯：' + e.message);
    }
  }

  function loadProject(file) {
    show(el.dlErr, '');
    show(el.edOk, '');
    var reader = new FileReader();
    reader.onerror = function () { show(el.dlErr, '這個檔案讀不進來，請確認檔案沒有損壞。'); };
    reader.onload = function () {
      var p;
      try {
        p = DD.parseProjectFile(reader.result);
      } catch (e) {
        show(el.dlErr, e.message);
        return;
      }
      if (p.id !== state.d.id) {
        /* 不偷偷跳頁：給一條看得見的連結，使用者自己決定要不要換過去 */
        show(el.dlErr, '這份設定是給另一張範本用的（' + (p.name || p.id) + '）。\n' +
          '請先打開那一張，再載入這份設定：' + location.origin + location.pathname + '#/' + p.id);
        return;
      }
      state.edits = p.edits;
      state.paletteId = p.palette;
      state.font = p.font;
      state.fit = p.fit;
      state.zhOn = p.zhOn && DD.hasTranslation(state.d.zh);
      el.paletteSel.value = state.paletteId;
      el.fontSel.value = state.font;
      el.fitChk.checked = state.fit;
      el.zhChk.checked = state.zhOn;
      el.edEyebrow.value = p.eyebrow;
      el.edTitleIn.value = p.heading;
      render();
      buildTextList();
      renderSwatches();
      show(el.edOk, '已載入設定，' + Object.keys(p.edits).length + ' 段文字回到你上次改的樣子。');
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ── 從 Excel 貼一整欄 ───────────────────────────────────────────── */

  function applyPaste() {
    show(el.dlErr, '');
    show(el.pasteErr, '');
    var lines = DD.splitPastedColumn(el.pasteBox.value);
    if (!lines.length) {
      show(el.pasteErr, '貼上的內容是空的。請從 Excel 選一整欄複製，再貼進這個框。');
      return;
    }
    var start = state.selected == null ? 0 : state.selected;
    var room = state.orig.length - start;
    for (var i = 0; i < lines.length && i < room; i++) state.edits[start + i] = lines[i];
    render();
    buildTextList();
    selectUnit(start, false);
    var used = Math.min(lines.length, room);
    show(el.edOk, '從第 ' + (start + 1) + ' 段起填入了 ' + used + ' 段' +
      (lines.length > room ? '；剩下的 ' + (lines.length - room) + ' 行沒有位置放，被略過了。' : '。'));
    el.pasteBox.value = '';
  }

  /* ── 對外介面 ────────────────────────────────────────────────────── */

  function fillSelect(node, items) {
    if (node.options.length) return;
    items.forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.id;
      o.textContent = it.name;
      node.appendChild(o);
    });
  }

  function fillPalettes() {
    fillSelect(el.paletteSel, DD.PALETTES);
    fillSelect(el.fontSel, DD.FONT_CHOICES);
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

  /**
   * opts.flow       產生器模式：表單是唯一真相，所以把逐段改字的清單藏起來
   * opts.keepTitle  不要覆蓋使用者已經打好的標題（產生器每打一個字就重開一次）
   * opts.genHeading／opts.genUse  產生器模式的標題與說明，由產生器自己給
   */
  function open(diagram, opts) {
    var o = opts || {};
    cacheEls();
    fillPalettes();
    var hasZh = DD.hasTranslation(diagram.zh);
    state = {
      d: diagram,
      edits: {},
      orig: null,
      units: [],
      selected: null,
      paletteId: el.paletteSel.value || 'source',
      font: el.fontSel.value || 'source',
      fit: el.fitChk.checked,
      /* 有中文就預設先套上——使用者要的是中文的圖，原文只是備而不用 */
      zhOn: hasZh,
      colors: diagram.dark ? DD.UPSTREAM_DARK : DD.UPSTREAM_LIGHT
    };

    el.pasteBox.value = '';
    show(el.pasteErr, '');
    el.zhRow.hidden = !hasZh;
    el.zhChk.checked = hasZh;
    el.zhNote.textContent = diagram.zhKind === 'sample'
      ? '這張已經有一整份公務情境的中文內容（' + diagram.zhCount + '／' + diagram.segs + ' 段），直接改成你自己的案子就好。'
      : '這張只換得掉圖例、月份、是／否這類固定用字（' + diagram.zhCount + '／' + diagram.segs +
        ' 段）；方塊裡的內容是範本自帶的示範資料，本來就要整段換掉。';

    state.flow = !!o.flow;
    el.textCard.hidden = state.flow;
    /* 產生器畫出來的圖本來就是中文，沒有「中文層」可言——那段說明留著只會讓人以為壞了 */
    if (state.flow) { el.zhRow.hidden = true; el.zhNote.textContent = ''; }

    el.edKind.textContent = diagram.typeZh + '　' + diagram.variantZh;
    el.edHeading.textContent = state.flow
      ? (o.genHeading || '自己做一張圖')
      : (diagram.heading || diagram.title || diagram.typeZh);
    el.edUse.textContent = state.flow
      ? (o.genUse || '版面由程式排，你只要把內容填對。')
      : (diagram.use || '');
    if (!o.keepTitle) {
      el.edEyebrow.value = (state.zhOn && diagram.zhEyebrow) || diagram.typeZh;
      el.edTitleIn.value = state.zhOn ? (diagram.zhHeading || '') : '';
    }
    show(el.edErr, '');
    show(el.edOk, '');
    show(el.dlErr, '');

    render();
    if (!state.flow) buildTextList();
    renderSwatches();

    el.dlPng.disabled = !diagram.png;
    el.copyPngBtn.disabled = !diagram.png;
    /* 設定檔記的是「第幾段改成什麼」，產生器的真相是表單，兩者對不起來。
       停用還不夠——長得像可以按的按鈕按下去沒反應更氣人，整塊藏掉。 */
    el.saveProjBtn.disabled = state.flow;
    el.loadProjInput.disabled = state.flow;
    el.projBox.hidden = state.flow;
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
    el.fontSel.addEventListener('change', function () {
      if (!state) return;
      state.font = el.fontSel.value;
      render();
    });
    el.pasteBtn.addEventListener('click', applyPaste);
    el.copyPngBtn.addEventListener('click', copyPng);
    el.saveProjBtn.addEventListener('click', saveProject);
    el.loadProjInput.addEventListener('change', function () {
      var f = el.loadProjInput.files && el.loadProjInput.files[0];
      if (f) loadProject(f);
      el.loadProjInput.value = '';
    });
    el.fitChk.addEventListener('change', function () {
      if (!state) return;
      state.fit = el.fitChk.checked;
      render();
    });
    el.zhChk.addEventListener('change', function () {
      if (!state) return;
      state.zhOn = el.zhChk.checked;
      /* 只有「還沒被使用者動過」的標題才跟著切換，不然會把人家打好的字洗掉 */
      var d = state.d;
      if (el.edTitleIn.value === '' || el.edTitleIn.value === (d.zhHeading || '')) {
        el.edTitleIn.value = state.zhOn ? (d.zhHeading || '') : '';
      }
      if (el.edEyebrow.value === d.typeZh || el.edEyebrow.value === (d.zhEyebrow || '')) {
        el.edEyebrow.value = (state.zhOn && d.zhEyebrow) || d.typeZh;
      }
      render();
      buildTextList();
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
      state.zhOn = DD.hasTranslation(state.d.zh);
      el.zhChk.checked = state.zhOn;
      el.edTitleIn.value = state.zhOn ? (state.d.zhHeading || '') : '';
      el.edEyebrow.value = (state.zhOn && state.d.zhEyebrow) || state.d.typeZh;
      el.paletteSel.value = 'source';
      state.paletteId = 'source';
      el.fontSel.value = 'source';
      state.font = 'source';
      el.pasteBox.value = '';
      show(el.pasteErr, '');
      render();
      buildTextList();
      renderSwatches();
      show(el.edOk, '已復原成範本原本的樣子。');
    });
  }

  window.DDEditor = { open: open, bind: bind, _state: function () { return state; } };
})(window, document);
