/*
 * app.js — 載入資料、畫範本列表、切換兩個畫面。
 *
 * 路由用 hash：`#/` 是列表，`#/範本id` 是改字畫面。這樣使用者可以把某一張範本
 * 的網址存起來或傳給同事，重新整理也還在同一張。
 *
 * 縮圖用 IntersectionObserver 延後塞——153 張圖一次全部塞進 DOM，
 * 每張都帶自己的 <style>，第一次開會卡住好幾秒。
 *
 * 圖表範本來源：https://github.com/cathrynlavery/diagram-design （MIT，Cathryn Lavery）
 */
(function (window, document) {
  'use strict';

  var DD = window.DD;
  var data = null;
  var byId = {};
  var observer = null;
  var lastScroll = 0;

  function $(id) { return document.getElementById(id); }

  function show(node, msg) {
    if (!node) return;
    node.textContent = msg || '';
    node.classList.toggle('show', !!msg);
  }

  /* ── 載入 ────────────────────────────────────────────────────────── */

  function load() {
    return fetch('data/diagrams.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        data = json;
        json.diagrams.forEach(function (d) { byId[d.id] = d; });
        fillTypes();
        bind();
        route();
      })
      .catch(function (e) {
        show($('galleryErr'), '範本資料載不進來（' + e.message + '）。\n' +
          '這個站要透過網址開啟才會動；如果是把檔案下載下來直接點開（file://），' +
          '瀏覽器會擋住讀取本機檔案，請改用線上網址。');
      });
  }

  function fillTypes() {
    var sel = $('typeSel');
    data.types.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.type;
      o.textContent = t.zh + '（' + t.count + '）';
      sel.appendChild(o);
    });
  }

  /* ── 列表 ────────────────────────────────────────────────────────── */

  function currentQuery() {
    return {
      q: $('q').value,
      type: $('typeSel').value,
      theme: $('themeSel').value,
      common: $('commonChk').checked
    };
  }

  function renderTiles() {
    var list = DD.filterDiagrams(data.diagrams, currentQuery());
    var tiles = $('tiles');
    if (observer) observer.disconnect();
    tiles.innerHTML = '';

    $('countLine').textContent = list.length
      ? '找到 ' + list.length + ' 張範本（全庫共 ' + data.count + ' 張）'
      : '找不到符合的範本。';
    show($('galleryErr'), list.length ? '' : '換個關鍵字，或把「只看公務常用的類型」取消勾選再試一次。');

    var frag = document.createDocumentFragment();
    list.forEach(function (d) {
      var a = document.createElement('a');
      a.className = 'tile';
      a.href = '#/' + d.id;
      a.setAttribute('aria-label', d.typeZh + '：' + (d.heading || d.title));

      var thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.dataset.id = d.id;
      var ph = document.createElement('span');
      ph.className = 'ph';
      ph.textContent = '載入中…';
      thumb.appendChild(ph);

      var meta = document.createElement('div');
      meta.className = 'meta';
      var t1 = document.createElement('div');
      t1.className = 't1';
      t1.textContent = d.typeZh;
      var t2 = document.createElement('div');
      t2.className = 't2';
      var b1 = document.createElement('span');
      b1.className = 'badge' + (d.dark ? ' dark' : '');
      b1.textContent = d.variantZh || '標準';
      t2.appendChild(b1);
      t2.appendChild(document.createTextNode(d.heading || d.title || ''));
      var t3 = document.createElement('div');
      t3.className = 't3';
      t3.textContent = d.use || '';

      meta.appendChild(t1);
      meta.appendChild(t2);
      meta.appendChild(t3);
      a.appendChild(thumb);
      a.appendChild(meta);
      frag.appendChild(a);
    });
    tiles.appendChild(frag);
    observeThumbs();
  }

  function fillThumb(node) {
    var d = byId[node.dataset.id];
    if (!d || node.dataset.filled) return;
    node.dataset.filled = '1';
    node.innerHTML = d.svg;
    var svg = node.querySelector('svg');
    if (svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.pointerEvents = 'none';
    }
  }

  function observeThumbs() {
    var nodes = document.querySelectorAll('.thumb');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(nodes, fillThumb);
      return;
    }
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        fillThumb(en.target);
        observer.unobserve(en.target);
      });
    }, { rootMargin: '300px' });
    Array.prototype.forEach.call(nodes, function (n) { observer.observe(n); });
  }

  /* ── 路由 ────────────────────────────────────────────────────────── */

  function route() {
    var id = (location.hash || '').replace(/^#\/?/, '');
    var gallery = $('galleryView');
    var editor = $('editorView');

    if (id && byId[id]) {
      if (!gallery.hidden) lastScroll = window.scrollY;
      gallery.hidden = true;
      editor.hidden = false;
      window.scrollTo(0, 0);
      /* 一定要先把畫面顯示出來再開編輯器：量文字寬度要靠 getComputedTextLength，
         元素在 display:none 底下量出來一律是 0，自動縮字就整個失效。 */
      window.DDEditor.open(byId[id]);
      return;
    }

    editor.hidden = true;
    gallery.hidden = false;
    document.title = '公務用圖表範本庫';
    if (!data) return;
    if (!$('tiles').children.length) renderTiles();
    window.scrollTo(0, lastScroll);
  }

  function bind() {
    ['q', 'typeSel', 'themeSel', 'commonChk'].forEach(function (id) {
      var node = $(id);
      node.addEventListener('input', renderTiles);
      node.addEventListener('change', renderTiles);
    });
    window.DDEditor.bind();
    window.addEventListener('hashchange', route);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }

  window.DDApp = {
    ready: load,
    _data: function () { return data; },
    _renderTiles: renderTiles
  };
})(window, document);
