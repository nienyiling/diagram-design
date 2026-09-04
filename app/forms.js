/*
 * forms.js — 五種產生器的畫面層：填表 → 產生圖。
 *
 * 範本庫只能換掉別人排好的字；這一支讓使用者自己決定內容有幾列、每一列是什麼，
 * 版面（方塊多大、線怎麼連、長條畫多長）由 gen.js 算。
 *
 * 表單本身是「照 gen.js 的 fields／meta 規格長出來的」，不是五份手寫的 HTML。
 * 新增一種圖只要在 gen.js 加一個 descriptor，這裡不必動。
 *
 * 兩種重畫要分開：
 *   - 打字（改欄位內容）→ 只重畫預覽，不要動表單的 DOM，不然游標會跳走。
 *   - 結構改變（新增／刪除／上移下移／改型別）→ 整個表單重建。
 */
(function (window, document) {
  'use strict';

  var DD = window.DD;
  var GEN = window.DDGen;

  var el = {};
  var cur = null;       /* 目前這一種圖的 descriptor */
  var store = {};       /* 每一種圖各自記自己的列與設定，切過去切回來不會白費工 */
  var timer = null;

  function $(id) { return document.getElementById(id); }

  function show(node, msg) {
    if (!node) return;
    node.textContent = msg || '';
    node.classList.toggle('show', !!msg);
  }

  /** 這一種圖的「主要文字」欄位——退回目標的下拉選單抓的就是它。 */
  function mainKey(gen) {
    for (var i = 0; i < gen.fields.length; i++) {
      if (gen.fields[i].type === 'text') return gen.fields[i].key;
    }
    return gen.fields[0].key;
  }

  function blankRow(gen) {
    var row = {};
    gen.fields.forEach(function (f) {
      row[f.key] = f.type === 'check' ? false : (f.type === 'select' ? f.options[0].value : '');
    });
    return row;
  }

  function stateFor(gen) {
    if (!store[gen.id]) {
      store[gen.id] = {
        rows: JSON.parse(JSON.stringify(gen.example)),
        meta: (gen.meta || []).reduce(function (m, f) { m[f.key] = f.placeholder || ''; return m; }, {})
      };
    }
    return store[gen.id];
  }

  /* ── 表單 ────────────────────────────────────────────────────────── */

  function fieldNode(gen, f, row, i, st) {
    var wrap = document.createElement('div');
    wrap.className = 'fcell';
    if (f.width) wrap.style.flex = '0 0 ' + f.width;

    var id = 'f_' + gen.id + '_' + i + '_' + f.key;
    var lab = document.createElement('label');
    lab.className = 'fl';
    lab.setAttribute('for', id);
    lab.textContent = f.label;
    wrap.appendChild(lab);

    var input;
    if (f.type === 'select') {
      input = document.createElement('select');
      f.options.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        input.appendChild(op);
      });
      input.value = row[f.key] == null ? f.options[0].value : String(row[f.key]);
    } else if (f.type === 'rowref') {
      input = document.createElement('select');
      var none = document.createElement('option');
      none.value = '';
      none.textContent = '（不退回）';
      input.appendChild(none);
      var mk = mainKey(gen);
      st.rows.slice(0, i).forEach(function (r) {
        var v = String(r[mk] || '').trim();
        if (!v) return;
        var op = document.createElement('option');
        op.value = v;
        op.textContent = v;
        input.appendChild(op);
      });
      input.value = row[f.key] || '';
      /* 目標被改掉或刪掉時，下拉裡就沒有這個選項了——補一個「找不到」的項目，
         不要靜靜地把使用者填的東西變成空白 */
      if (row[f.key] && input.value !== row[f.key]) {
        var miss = document.createElement('option');
        miss.value = row[f.key];
        miss.textContent = row[f.key] + '（找不到）';
        input.appendChild(miss);
        input.value = row[f.key];
      }
    } else if (f.type === 'check') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!row[f.key];
      wrap.classList.add('fcheck');
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = row[f.key] == null ? '' : String(row[f.key]);
      if (f.placeholder) input.placeholder = f.placeholder;
    }
    input.id = id;
    wrap.appendChild(input);

    var structural = f.type === 'select' || f.type === 'rowref';
    input.addEventListener(f.type === 'check' || structural ? 'change' : 'input', function () {
      row[f.key] = f.type === 'check' ? input.checked : input.value;
      /* 型別換了、退回目標換了，同一列該出現哪些欄位會跟著變，只好整個重建 */
      if (structural) buildForm();
      else schedulePreview();
    });
    return wrap;
  }

  function rowNode(gen, row, i, st) {
    var box = document.createElement('div');
    box.className = 'frow';

    var no = document.createElement('div');
    no.className = 'fno';
    no.textContent = i + 1;
    box.appendChild(no);

    var fields = document.createElement('div');
    fields.className = 'ffields';
    gen.fields.forEach(function (f) {
      if (f.only && row.kind !== f.only) return;
      fields.appendChild(fieldNode(gen, f, row, i, st));
    });
    box.appendChild(fields);

    var btns = document.createElement('div');
    btns.className = 'fbtns';
    [['↑', '上移', function () { swap(i, i - 1); }, i === 0],
     ['↓', '下移', function () { swap(i, i + 1); }, i === st.rows.length - 1],
     ['✕', '刪除這一列', function () { st.rows.splice(i, 1); buildForm(); }, st.rows.length <= 1]]
      .forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ficon';
        btn.textContent = b[0];
        btn.title = b[1] + '（第 ' + (i + 1) + ' ' + gen.rowName + '）';
        btn.setAttribute('aria-label', b[1] + '：第 ' + (i + 1) + ' ' + gen.rowName);
        btn.disabled = b[3];
        btn.addEventListener('click', b[2]);
        btns.appendChild(btn);
      });
    box.appendChild(btns);
    return box;
  }

  function swap(a, b) {
    var st = stateFor(cur);
    if (b < 0 || b >= st.rows.length) return;
    var t = st.rows[a];
    st.rows[a] = st.rows[b];
    st.rows[b] = t;
    buildForm();
  }

  function buildForm() {
    var gen = cur;
    var st = stateFor(gen);
    if (!st.rows.length) st.rows.push(blankRow(gen));

    el.makeTitle.textContent = '填' + gen.name + '的內容';
    el.makeRowsLabel.textContent = '每一列是一個「' + gen.rowName + '」，由上往下就是圖上的順序。';

    el.makeHelp.innerHTML = '';
    (gen.help || []).forEach(function (line) {
      var li = document.createElement('li');
      li.textContent = line;
      el.makeHelp.appendChild(li);
    });

    /* 整張圖共用的設定（軸名、上下層標示…），沒有就整塊藏起來 */
    el.makeMeta.innerHTML = '';
    el.makeMetaWrap.hidden = !(gen.meta && gen.meta.length);
    (gen.meta || []).forEach(function (f) {
      var wrap = document.createElement('div');
      wrap.className = 'fcell';
      var id = 'm_' + gen.id + '_' + f.key;
      var lab = document.createElement('label');
      lab.className = 'fl';
      lab.setAttribute('for', id);
      lab.textContent = f.label;
      var input = document.createElement('input');
      input.type = 'text';
      input.id = id;
      input.value = st.meta[f.key] == null ? '' : st.meta[f.key];
      if (f.placeholder) input.placeholder = f.placeholder;
      input.addEventListener('input', function () {
        st.meta[f.key] = input.value;
        schedulePreview();
      });
      wrap.appendChild(lab);
      wrap.appendChild(input);
      el.makeMeta.appendChild(wrap);
    });

    el.makeRows.innerHTML = '';
    var frag = document.createDocumentFragment();
    st.rows.forEach(function (row, i) { frag.appendChild(rowNode(gen, row, i, st)); });
    el.makeRows.appendChild(frag);

    el.makeAddBtn.textContent = '＋ 加一' + (gen.rowName.length > 1 ? '個' : '') + gen.rowName;
    preview();
  }

  /* ── 預覽 ────────────────────────────────────────────────────────── */

  function schedulePreview() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(preview, 220);
  }

  function preview() {
    var gen = cur;
    if (!gen) return;
    var st = stateFor(gen);
    var out;
    try {
      out = gen.build(st.rows, st.meta, { title: el.edTitleIn.value || gen.name });
    } catch (e) {
      show(el.makeErr, '這組內容畫不出來（' + e.message + '）。請把剛才改的那一列改回去，或按「填入範例」重來。');
      return;
    }
    show(el.makeErr, out.warnings.join('\n'));
    el.makeCount.textContent = out.count
      ? '目前 ' + out.count + ' 個' + gen.rowName + '。改上面的欄位，下面的圖就跟著變。'
      : '還沒有畫得出來的內容。照著範例填，或按「填入範例」。';

    var box = DD.parseViewBox(out.svg) || { w: 1000, h: 600 };
    window.DDEditor.open({
      id: 'make-' + gen.id,
      type: gen.id,
      typeZh: gen.name,
      variantZh: '自己填的',
      use: gen.use,
      variant: '',
      dark: false,
      title: gen.name,
      eyebrow: gen.name,
      heading: '',
      desc: '',
      w: box.w,
      h: box.h,
      png: true,
      segs: 0,
      zhKind: '',
      zhCount: 0,
      zhHeading: '',
      zhEyebrow: gen.name,
      zh: null,
      svg: out.svg
    }, {
      flow: true,
      keepTitle: true,
      genHeading: '自己做一張' + gen.name,
      genUse: gen.use + '　版面由程式排，你只要把內容填對。'
    });
  }

  /* ── 對外 ────────────────────────────────────────────────────────── */

  function init() {
    ['makeCard', 'makeTitle', 'makeHelp', 'makeMeta', 'makeMetaWrap', 'makeRows', 'makeRowsLabel',
      'makeAddBtn', 'makeExampleBtn', 'makeClearBtn', 'makeCount', 'makeErr', 'makeSample', 'edTitleIn', 'edEyebrow']
      .forEach(function (id) { el[id] = $(id); });

    el.makeAddBtn.addEventListener('click', function () {
      var st = stateFor(cur);
      st.rows.push(blankRow(cur));
      buildForm();
      /* 新的一列在最下面，把游標放進去，使用者不必自己找 */
      var last = el.makeRows.lastChild;
      var input = last && last.querySelector('input[type=text], select');
      if (input) input.focus();
    });
    el.makeExampleBtn.addEventListener('click', function () {
      store[cur.id] = null;
      buildForm();
    });
    el.makeClearBtn.addEventListener('click', function () {
      var st = stateFor(cur);
      st.rows = [blankRow(cur)];
      buildForm();
    });
  }

  function open(typeId) {
    var gen = GEN.byId(typeId);
    if (!gen) return false;
    cur = gen;
    el.makeCard.hidden = false;
    el.makeSample.href = '#/' + gen.sample;
    el.makeSample.textContent = '看一張排好的' + gen.name + '範本';
    if (!el.edTitleIn.value || el.edTitleIn.dataset.gen !== gen.id) {
      el.edTitleIn.value = gen.sampleTitle || gen.name;
      el.edEyebrow.value = gen.name;
      el.edTitleIn.dataset.gen = gen.id;
    }
    buildForm();
    return true;
  }

  function close() {
    if (el.makeCard) el.makeCard.hidden = true;
    cur = null;
  }

  window.DDForms = {
    init: init, open: open, close: close,
    _preview: preview, _state: function () { return cur ? stateFor(cur) : null; }
  };
})(window, document);
