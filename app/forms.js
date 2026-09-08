/*
 * forms.js — 七種產生器的畫面層：填表 → 產生圖。
 *
 * 範本庫只能換掉別人排好的字；這一支讓使用者自己決定內容有幾列、每一列是什麼，
 * 版面（方塊多大、線怎麼連、長條畫多長）由 gen.js 算。
 *
 * 表單本身是「照 gen.js 的 fields／meta 規格長出來的」，不是七份手寫的 HTML。
 * 新增一種圖只要在 gen.js 加一個 descriptor，這裡不必動。
 *
 * 兩種重畫要分開：
 *   - 打字（改欄位內容）→ 只重畫預覽，不要動表單的 DOM，不然游標會跳走。
 *   - 結構改變（新增／刪除／上移下移／改型別）→ 整個表單重建。
 *
 * 三件防止「白做工」的事：
 *   - 每一次結構改變都推一份快照進復原堆疊，刪錯一列按「復原」就回來。
 *   - 填的內容寫進 localStorage，關掉分頁再開還在（純本機，不上傳）。
 *   - 存出／載入設定檔，下個月改一下日期再送一次。
 */
(function (window, document) {
  'use strict';

  var DD = window.DD;
  var GEN = window.DDGen;

  var STORE_KEY = 'gongwu-diagram-forms-v1';
  var UNDO_MAX = 30;

  var el = {};
  var cur = null;       /* 目前這一種圖的 descriptor */
  var store = {};       /* 每一種圖各自記自己的列與設定，切過去切回來不會白費工 */
  var undo = {};        /* 每一種圖各自的復原堆疊 */
  var timer = null;
  var saveTimer = null;

  function $(id) { return document.getElementById(id); }

  function show(node, msg) {
    if (!node) return;
    node.textContent = msg || '';
    node.classList.toggle('show', !!msg);
  }

  /** 這一種圖的「主要文字」欄位——上級／退回目標的下拉選單抓的就是它。 */
  function mainKey(gen) {
    for (var i = 0; i < gen.fields.length; i++) {
      if (gen.fields[i].type === 'text') return gen.fields[i].key;
    }
    return gen.fields[0].key;
  }

  function blankRow(gen, kind) {
    var row = {};
    gen.fields.forEach(function (f) {
      row[f.key] = f.type === 'check' ? false : (f.type === 'select' ? f.options[0].value : '');
    });
    if (kind) row.kind = kind;
    return row;
  }

  /* ── 區塊：一張表分成「成員」「關係」兩段 ───────────────────────────
     一列可以是好幾種東西時（家系圖的成員／伴侶／情感關係），全部混在一張長表裡
     很難懂：使用者看到的是「一列一列長得都不一樣」。descriptor 給 groups 就分段畫，
     每一段自己一顆「＋」，而且可以要求「前一段先填夠幾列才准填這一段」。 */

  function groupsOf(gen) {
    return (gen && gen.groups && gen.groups.length) ? gen.groups : null;
  }

  function groupIndex(gen, row) {
    var gs = groupsOf(gen);
    if (!gs) return 0;
    for (var i = 0; i < gs.length; i++) {
      if (gs[i].kinds.indexOf(row.kind || gs[0].kinds[0]) >= 0) return i;
    }
    return 0;
  }

  /** 同一區塊的列要連在一起：下拉選單只列得到「前面幾列」，成員排在關係後面就選不到了。 */
  function sortByGroup(gen, rows) {
    if (!groupsOf(gen)) return rows;
    return rows.map(function (r, i) { return { r: r, i: i, g: groupIndex(gen, r) }; })
      .sort(function (a, b) { return a.g - b.g || a.i - b.i; })
      .map(function (x) { return x.r; });
  }

  /** 這一區塊已經填了幾列（有主要文字的才算）——「還能不能往下填」看的是這個。 */
  function filledIn(gen, rows, kinds) {
    var mk = mainKey(gen);
    return rows.filter(function (r) {
      return kinds.indexOf(r.kind) >= 0 && String(r[mk] || '').trim();
    }).length;
  }

  /** 這一區塊有幾列真的填了東西——關係那種列沒有主要文字，要看它自己的欄位。 */
  function countIn(gen, rows, kinds) {
    return rows.filter(function (r) {
      if (kinds.indexOf(r.kind) < 0) return false;
      return gen.fields.some(function (f) {
        if (f.type === 'check' || f.key === 'kind') return false;
        if (f.only && f.only !== r.kind) return false;
        return String(r[f.key] || '').trim();
      });
    }).length;
  }

  function defaultState(gen) {
    return {
      rows: JSON.parse(JSON.stringify(gen.example)),
      meta: (gen.meta || []).reduce(function (m, f) { m[f.key] = f.placeholder || ''; return m; }, {})
    };
  }

  function stateFor(gen) {
    if (!store[gen.id]) store[gen.id] = defaultState(gen);
    var st = store[gen.id];
    /* 分區塊的圖：同區塊的列一定要連在一起。載回設定檔、貼上、還原都可能打亂順序，
       在這裡收斂一次，其它地方就不必各自記得。 */
    if (groupsOf(gen)) st.rows = sortByGroup(gen, st.rows);
    return st;
  }

  /* ── 留住使用者填的東西 ──────────────────────────────────────────── */

  /**
   * 寫進 localStorage。純本機、不上傳——這個站的鐵律是資料不離開這台裝置，
   * 但「關掉分頁就全沒了」也是一種資料遺失，兩件事不衝突。
   * 存不進去（無痕模式、關掉了 storage）就安靜算了，不要拿這個去煩使用者。
   */
  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch (e) { /* 無痕模式或空間滿了：不影響現在這一趟操作 */ }
    }, 400);
  }

  function restore() {
    var raw;
    try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || typeof data !== 'object') return;
    /* 存下來的東西是上一版的站台寫的也說不定，每一格都要照現在的規格驗過 */
    GEN.TYPES.forEach(function (gen) {
      var got = data[gen.id];
      if (!got || !Array.isArray(got.rows) || !got.rows.length) return;
      var st = { rows: [], meta: {} };
      got.rows.forEach(function (r) {
        var row = {};
        gen.fields.forEach(function (f) {
          var v = r && r[f.key];
          if (f.type === 'check') row[f.key] = !!v;
          else row[f.key] = v == null ? '' : String(v);
        });
        st.rows.push(row);
      });
      (gen.meta || []).forEach(function (f) {
        var v = got.meta && got.meta[f.key];
        st.meta[f.key] = v == null ? '' : String(v);
      });
      store[gen.id] = st;
    });
  }

  /** 動結構之前先拍一張，刪錯一列按「復原」就回來。 */
  function snapshot() {
    if (!cur) return;
    var st = stateFor(cur);
    if (!undo[cur.id]) undo[cur.id] = [];
    undo[cur.id].push(JSON.stringify({ rows: st.rows, meta: st.meta }));
    if (undo[cur.id].length > UNDO_MAX) undo[cur.id].shift();
  }

  function popUndo() {
    var stack = undo[cur.id] || [];
    if (!stack.length) return false;
    var prev = JSON.parse(stack.pop());
    store[cur.id] = { rows: prev.rows, meta: prev.meta };
    return true;
  }

  function refreshUndoBtn() {
    var n = (undo[cur && cur.id] || []).length;
    el.makeUndoBtn.disabled = !n;
    el.makeUndoBtn.textContent = n ? '↶ 復原（' + n + '）' : '↶ 復原';
  }

  /* ── 表單 ────────────────────────────────────────────────────────── */

  function fieldNode(gen, f, row, i, st, group) {
    var wrap = document.createElement('div');
    wrap.className = 'fcell';
    /* 有指定寬度的是窄欄位（日期、分數、勾選）；沒有的是主要文字，窄螢幕要獨佔一行 */
    if (f.width) wrap.style.setProperty('--fw', f.width);
    else wrap.classList.add('wide');

    var id = 'f_' + gen.id + '_' + i + '_' + f.key;
    var lab = document.createElement('label');
    lab.className = 'fl';
    lab.setAttribute('for', id);
    lab.textContent = f.label;
    wrap.appendChild(lab);

    var input;
    if (f.type === 'select') {
      input = document.createElement('select');
      /* 型別欄在區塊裡只列這個區塊有的那幾種：關係區塊不該還能選回「成員」 */
      var opts = (group && f.key === 'kind')
        ? f.options.filter(function (o) { return group.kinds.indexOf(o.value) >= 0; })
        : f.options;
      opts.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        input.appendChild(op);
      });
      input.value = row[f.key] == null ? opts[0].value : String(row[f.key]);
    } else if (f.type === 'rowref') {
      input = document.createElement('select');
      var none = document.createElement('option');
      none.value = '';
      none.textContent = '（不指定）';
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
      /* 目標被改掉或刪掉時下拉裡就沒有這個選項了——補一個「找不到」的項目，
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
    /* 勾了會怎樣要講出來，不要讓使用者勾了才去圖上找 */
    if (f.hint) {
      input.setAttribute('title', f.hint);
      input.setAttribute('aria-describedby', id + '_h');
      var h = document.createElement('span');
      h.className = 'fhint';
      h.id = id + '_h';
      h.textContent = f.hint;
      wrap.appendChild(input);
      wrap.appendChild(h);
    } else {
      wrap.appendChild(input);
    }

    var structural = f.type === 'select' || f.type === 'rowref';
    input.addEventListener(f.type === 'check' || structural ? 'change' : 'input', function () {
      if (structural) snapshot();
      row[f.key] = f.type === 'check' ? input.checked : input.value;
      persist();
      /* 型別換了、上級換了，同一列該出現哪些欄位會跟著變，只好整個重建 */
      if (structural) buildForm();
      else schedulePreview();
    });
    return wrap;
  }

  /** 畫面上的編號從「自己這一區塊」數起：關係區塊的第一列就該寫 1，不是 8。 */
  function ordinalIn(gen, rows, i) {
    if (!groupsOf(gen)) return i + 1;
    var g = groupIndex(gen, rows[i]), n = 0;
    for (var j = 0; j <= i; j++) if (groupIndex(gen, rows[j]) === g) n++;
    return n;
  }

  function rowNode(gen, row, i, st) {
    var box = document.createElement('div');
    box.className = 'frow';

    var no = document.createElement('div');
    no.className = 'fno';
    no.textContent = ordinalIn(gen, st.rows, i);
    box.appendChild(no);

    var gs = groupsOf(gen);
    var g = gs ? gs[groupIndex(gen, row)] : null;
    var sameGroup = function (j) {
      return st.rows[j] && (!gs || groupIndex(gen, st.rows[j]) === groupIndex(gen, row));
    };
    var mine = gs ? st.rows.filter(function (r) { return groupIndex(gen, r) === groupIndex(gen, row); }).length : st.rows.length;
    var rowName = (g && g.rowName) || gen.rowName;

    var fields = document.createElement('div');
    fields.className = 'ffields';
    gen.fields.forEach(function (f) {
      if (f.only && row.kind !== f.only) return;
      /* 區塊只有一種列時，型別欄就沒有意義了——留著只是多一個看不懂的下拉 */
      if (g && f.key === 'kind' && g.kinds.length < 2) return;
      fields.appendChild(fieldNode(gen, f, row, i, st, g));
    });
    box.appendChild(fields);

    var btns = document.createElement('div');
    btns.className = 'fbtns';
    [['↑', '上移', function () { swap(i, i - 1); }, !sameGroup(i - 1)],
     ['↓', '下移', function () { swap(i, i + 1); }, !sameGroup(i + 1)],
     ['✕', '刪除這一列', function () {
       snapshot();
       st.rows.splice(i, 1);
       persist();
       buildForm();
       showTip('刪掉一' + rowName + '了。按「復原」可以救回來。');
     }, gs ? (groupIndex(gen, row) === 0 && mine <= 1) : st.rows.length <= 1]]
      .forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ficon';
        btn.textContent = b[0];
        btn.title = b[1] + '（第 ' + ordinalIn(gen, st.rows, i) + ' ' + rowName + '）';
        btn.setAttribute('aria-label', b[1] + '：第 ' + ordinalIn(gen, st.rows, i) + ' ' + rowName);
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
    snapshot();
    var t = st.rows[a];
    st.rows[a] = st.rows[b];
    st.rows[b] = t;
    persist();
    buildForm();
  }

  function showTip(msg) {
    show(el.makeTip, msg || '');
  }

  /** 一個區塊：標題、屬於它的那幾列、自己的「＋」。前一段沒填夠就把「＋」關起來。 */
  function groupNode(gen, g, gi, st) {
    var box = document.createElement('section');
    box.className = 'fgroup';

    var h = document.createElement('h3');
    h.textContent = g.title;
    box.appendChild(h);

    /* 這一段先建起來，鎖不鎖等 refreshLocks() 決定——打字時只重畫預覽、不重建表單
       （重建會讓游標跳走），所以鎖的狀態要能單獨更新。 */
    var note = document.createElement('p');
    note.className = 'hint flock';
    note.setAttribute('data-lock', g.id);
    note.textContent = (g.needs && g.needs.msg) || '';
    box.appendChild(note);

    var rows = document.createElement('div');
    st.rows.forEach(function (row, i) {
      if (groupIndex(gen, row) !== gi) return;
      rows.appendChild(rowNode(gen, row, i, st));
    });
    box.appendChild(rows);

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'primary fadd';
    add.textContent = g.add;
    add.setAttribute('data-add', g.id);
    add.addEventListener('click', function () {
      snapshot();
      var at = st.rows.length;
      for (var j = st.rows.length - 1; j >= 0; j--) {
        if (groupIndex(gen, st.rows[j]) <= gi) { at = j + 1; break; }
        if (j === 0) at = 0;
      }
      st.rows.splice(at, 0, blankRow(gen, g.kinds[0]));
      persist();
      buildForm();
      focusRow(at);
    });
    box.appendChild(add);
    return box;
  }

  /** 前一段填夠了沒——只切按鈕與那句說明，不動表單其它地方，游標才不會跳走。 */
  function refreshLocks() {
    var gen = cur;
    var gs = groupsOf(gen);
    if (!gs) return;
    var st = stateFor(gen);
    gs.forEach(function (g) {
      var add = el.makeRows.querySelector('[data-add="' + g.id + '"]');
      var note = el.makeRows.querySelector('[data-lock="' + g.id + '"]');
      if (!add) return;
      var locked = !!(g.needs && filledIn(gen, st.rows, g.needs.kinds) < g.needs.min);
      add.disabled = locked;
      if (locked) add.title = g.needs.msg; else add.removeAttribute('title');
      if (note) note.hidden = !locked;
    });
  }

  /** 新加的那一列要看得見、游標要在裡面——不然使用者以為按了沒反應。 */
  function focusRow(at) {
    var all = el.makeRows.querySelectorAll('.frow');
    var node = all[Math.min(at, all.length - 1)];
    if (!node) return;
    if (node.scrollIntoView) node.scrollIntoView({ block: 'center' });
    var input = node.querySelector('input[type=text], select');
    if (input) input.focus();
  }

  function buildForm() {
    var gen = cur;
    var st = stateFor(gen);
    var gs0 = groupsOf(gen);
    /* 第一個區塊至少要有一列，不然畫面上只剩兩個標題，看起來像壞了 */
    if (!st.rows.length) st.rows.push(blankRow(gen, gs0 ? gs0[0].kinds[0] : ''));
    else if (gs0 && groupIndex(gen, st.rows[0]) !== 0) st.rows.unshift(blankRow(gen, gs0[0].kinds[0]));

    el.makeTitle.textContent = '填' + gen.name + '的內容';
    el.makeRowsLabel.textContent = groupsOf(gen) ? ''
      : '每一列是一個「' + gen.rowName + '」，由上往下就是圖上的順序。';
    el.makeRowsLabel.hidden = !el.makeRowsLabel.textContent;

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
      wrap.className = 'fcell wide';
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
        persist();
        schedulePreview();
      });
      wrap.appendChild(lab);
      wrap.appendChild(input);
      el.makeMeta.appendChild(wrap);
    });

    el.makeRows.innerHTML = '';
    var frag = document.createDocumentFragment();
    var gs = groupsOf(gen);
    if (gs) {
      gs.forEach(function (g, gi) {
        frag.appendChild(groupNode(gen, g, gi, st));
      });
    } else {
      st.rows.forEach(function (row, i) { frag.appendChild(rowNode(gen, row, i, st)); });
    }
    el.makeRows.appendChild(frag);
    refreshLocks();

    /* 分區塊時每一區塊自己有一顆「＋」，共用的那一顆就沒有意義了 */
    el.makeAddBtn.hidden = !!gs;
    el.makeAddBtn.textContent = '＋ 加一' + (gen.rowName.length > 1 ? '個' : '') + gen.rowName;
    el.makePasteHint.textContent = '欄位順序是：' +
      GEN.pasteKeys(gen).map(function (k) {
        for (var i = 0; i < gen.fields.length; i++) if (gen.fields[i].key === k) return gen.fields[i].label;
        return k;
      }).join('、') + '。一行一' + gen.rowName + '，一個 Tab 一欄。';
    refreshUndoBtn();
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
    /* 剛打完第二個成員的名字，「新增關係」就該亮起來——不必先按別的地方 */
    refreshLocks();
    /* 分區塊時分開數：「目前 11 個列」看不出是六個方塊五條線 */
    var gsC = groupsOf(gen);
    var tally = gsC
      ? gsC.map(function (g) {
        return countIn(gen, st.rows, g.kinds) + ' ' + (g.unit || '個') + (g.rowName || gen.rowName);
      })
        .filter(function (x) { return x.indexOf('0 ') !== 0; }).join('、')
      : (out.count ? out.count + ' 個' + gen.rowName : '');
    el.makeCount.textContent = tally
      ? '目前 ' + tally + '。改上面的欄位，右邊的圖就跟著變。'
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
      /* 上游那 153 張裡有對應範本的才掛來源；家系圖、關係圖是自己畫的，掛了等於亂引用 */
      credit: !!gen.sample,
      genHeading: gen.name,
      genUse: gen.use + '　版面由程式排，你只要把內容填對。'
    });
  }

  /* ── 從 Excel 貼一整塊 ─────────────────────────────────────────────── */

  function applyPaste(replace) {
    show(el.makePasteErr, '');
    var res = GEN.parsePasteRows(cur, el.makePasteBox.value);
    if (!res.rows.length) {
      show(el.makePasteErr, res.warnings.join('\n') || '貼上的內容是空的。');
      return;
    }
    snapshot();
    var st = stateFor(cur);
    /* 只有一列而且整列空白時，「附加」等於「取代」——不要留一列空的在最上面 */
    var onlyBlank = st.rows.length === 1 &&
      Object.keys(st.rows[0]).every(function (k) { return !String(st.rows[0][k] || '').trim(); });
    st.rows = (replace || onlyBlank) ? res.rows : st.rows.concat(res.rows);
    persist();
    el.makePasteBox.value = '';
    buildForm();
    showTip('填入了 ' + res.rows.length + ' ' + cur.rowName +
      (res.warnings.length ? '。' + res.warnings.join('') : '。按「復原」可以還原。'));
  }

  /* ── 設定檔 ──────────────────────────────────────────────────────── */

  function saveProject() {
    show(el.makeErr, '');
    var st = stateFor(cur);
    try {
      var text = GEN.buildGenProject({
        type: cur.id, typeName: cur.name,
        title: el.edTitleIn.value, eyebrow: el.edEyebrow.value,
        palette: el.paletteSel.value, font: el.fontSel.value,
        rows: st.rows, meta: st.meta
      });
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = DD.safeFilename((el.edTitleIn.value.trim() || cur.name) + '-設定', 'json');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      showTip('已存出設定檔。下次載入它就接著改，也可以傳給同事接手。');
    } catch (e) {
      show(el.makeErr, '存出設定檔時出錯：' + e.message);
    }
  }

  function loadProject(file) {
    show(el.makeErr, '');
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = GEN.parseGenProject(reader.result);
      } catch (e) {
        show(el.makeErr, e.message);
        return;
      }
      snapshot();
      store[data.type] = { rows: data.rows, meta: data.meta };
      persist();
      if (data.type !== cur.id) { location.hash = '#/make/' + data.type; return; }
      if (data.title) el.edTitleIn.value = data.title;
      if (data.eyebrow) el.edEyebrow.value = data.eyebrow;
      buildForm();
      showTip('已載入設定檔（' + data.rows.length + ' ' + cur.rowName + '）。');
    };
    reader.onerror = function () { show(el.makeErr, '這個檔案讀不進來，請確認它沒有被其他程式開著。'); };
    reader.readAsText(file);
  }

  /* ── 對外 ────────────────────────────────────────────────────────── */

  function init() {
    ['makeCard', 'makeTitle', 'makeHelp', 'makeMeta', 'makeMetaWrap', 'makeRows', 'makeRowsLabel',
      'makeAddBtn', 'makeExampleBtn', 'makeClearBtn', 'makeUndoBtn', 'makeCount', 'makeErr',
      'makeTip', 'makeSample', 'makeSampleWrap', 'makePasteBox', 'makePasteBtn', 'makePasteAddBtn', 'makePasteErr',
      'makePasteHint', 'makeSaveBtn', 'makeLoadInput',
      'edTitleIn', 'edEyebrow', 'paletteSel', 'fontSel',
      'toBoardWrap', 'toBoardBtn', 'blankBoardBtn']
      .forEach(function (id) { el[id] = $(id); });

    restore();

    el.makeAddBtn.addEventListener('click', function () {
      snapshot();
      var st = stateFor(cur);
      st.rows.push(blankRow(cur));
      persist();
      buildForm();
      /* 新的一列在最下面：游標放進去，而且捲到看得見——不然使用者以為沒反應 */
      var last = el.makeRows.lastChild;
      var input = last && last.querySelector('input[type=text], select');
      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'center' });
      if (input) input.focus();
    });
    el.makeExampleBtn.addEventListener('click', function () {
      snapshot();
      store[cur.id] = defaultState(cur);
      persist();
      buildForm();
      showTip('已放回範例。按「復原」可以回到剛才填的內容。');
    });
    el.makeClearBtn.addEventListener('click', function () {
      snapshot();
      var gs = groupsOf(cur);
      stateFor(cur).rows = [blankRow(cur, gs ? gs[0].kinds[0] : '')];
      persist();
      buildForm();
      showTip('已全部清空。按「復原」可以救回剛才填的內容。');
    });
    el.makeUndoBtn.addEventListener('click', function () {
      if (!popUndo()) return;
      persist();
      buildForm();
      showTip('已復原。');
    });
    /* 搬到畫板是**單向門**：表單描述的是「一串有順序的列」，畫板是「一堆有座標的框」，
       回不去。所以要先問一聲，不能按了就走。 */
    el.toBoardBtn.addEventListener('click', function () {
      var st = stateFor(cur);
      var out = cur.build(st.rows, st.meta, {});
      if (!out.count) { showTip('現在還沒有畫得出來的內容，先填幾列再搬。'); return; }
      var ok = window.confirm('要把這張圖搬到畫板嗎？\n\n' +
        '搬過去之後每一格都拖得動、可以改形狀和顏色，\n' +
        '但**不能再搬回填表畫面**（畫板記的是座標，表單記的是順序）。\n\n' +
        '填表這邊的內容會留著，隨時可以回來重新產生一次。');
      if (!ok) return;
      window.DDCanvas.seed(flowNodes(st.rows));
      location.hash = '#/board';
    });
    el.blankBoardBtn.addEventListener('click', function () { location.hash = '#/board'; });
    el.makePasteBtn.addEventListener('click', function () { applyPaste(true); });
    el.makePasteAddBtn.addEventListener('click', function () { applyPaste(false); });
    el.makeSaveBtn.addEventListener('click', saveProject);
    el.makeLoadInput.addEventListener('change', function () {
      var f = el.makeLoadInput.files && el.makeLoadInput.files[0];
      if (f) loadProject(f);
      el.makeLoadInput.value = '';
    });
  }

  /**
   * 把流程圖的列轉成 board.js 要的節點。跟 gen.js 的 build() 是同一套規則——
   * 那邊算的是版面，這邊要的是節點本身，所以借 gen.js 算好的版面反推太繞，
   * 直接照同一份規則整一次。改了 gen.js 的流程圖欄位，這裡要跟著改。
   */
  function flowNodes(rows) {
    var nodes = [];
    var lastKind = null;
    (rows || []).forEach(function (row) {
      var main = String(row.main || '').trim();
      if (!main) return;
      var kind = row.kind || 'step';
      if (kind === 'branch' && lastKind !== 'decision' && lastKind !== 'branch') kind = 'step';
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
    nodes.forEach(function (n, idx) {
      if (!n.loop) return;
      var found = -1;
      for (var j = 0; j < idx; j++) if (nodes[j].main === n.loop.target) { found = j; break; }
      if (found < 0) n.loop = null;
      else n.loop.index = found;
    });
    return nodes;
  }

  function open(typeId) {
    var gen = GEN.byId(typeId);
    if (!gen) return false;
    cur = gen;
    el.makeCard.hidden = false;
    /* 畫板現在只吃流程圖的形狀，其他幾種搬過去沒有意義 */
    el.toBoardWrap.hidden = gen.id !== 'flow';
    /* 有些種類（例如家系圖）在上游那 153 張範本裡沒有對應的，就不要留一個死連結 */
    el.makeSampleWrap.hidden = !gen.sample;
    if (gen.sample) {
      el.makeSample.href = '#/' + gen.sample;
      el.makeSample.textContent = '看一張排好的' + gen.name + '範本';
    }
    show(el.makeTip, '');
    show(el.makePasteErr, '');
    el.makePasteBox.value = '';
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
    _preview: preview, _state: function () { return cur ? stateFor(cur) : null; },
    _undoDepth: function () { return (undo[cur && cur.id] || []).length; }
  };
})(window, document);
