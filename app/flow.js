/*
 * flow.js — 流程圖產生器的畫面層。
 *
 * 範本庫只能換掉別人排好的字；這一支讓使用者自己決定有幾個步驟、幾個判斷、往哪裡分岔。
 * 使用者打大綱，core.js 的 parseFlow／renderFlowSvg 算出整張 SVG，
 * 再交給 editor.js 當成一張「臨時的範本」開起來——預覽、換配色、換字體、
 * 下載與複製到剪貼簿就整套沿用，不必再寫一遍。
 *
 * 這裡刻意不提供「逐段改字」：大綱是唯一的真相。
 * 兩個地方都能改字的話，使用者改完大綱會發現剛才在下面改的字被蓋掉，那更難用。
 */
(function (window, document) {
  'use strict';

  var DD = window.DD;
  var el = {};
  var timer = null;

  function $(id) { return document.getElementById(id); }

  function show(node, msg) {
    if (!node) return;
    node.textContent = msg || '';
    node.classList.toggle('show', !!msg);
  }

  function render() {
    var text = el.flowText.value;
    var parsed = DD.parseFlow(text);
    var svg = DD.renderFlowSvg(parsed, { title: el.edTitleIn.value || '流程圖' });

    show(el.flowErr, parsed.warnings.join('\n'));
    el.flowCount.textContent = parsed.nodes.length
      ? '目前 ' + parsed.nodes.length + ' 個節點。改上面的大綱，下面的圖就跟著變。'
      : '大綱是空的。照著上面的例子打，或按「放回範例」。';

    window.DDEditor.open({
      id: 'flow',
      type: 'flowchart',
      typeZh: '流程圖',
      variantZh: '自己排的',
      use: '有判斷分支的作業流程',
      variant: '',
      dark: false,
      title: '流程圖',
      eyebrow: '流程圖',
      heading: '',
      desc: '',
      w: DD.FLOW.W,
      h: 600,
      png: true,
      segs: 0,
      zhKind: '',
      zhCount: 0,
      zhHeading: '',
      zhEyebrow: '流程圖',
      zh: null,
      svg: svg
    }, { flow: true, keepTitle: true });
  }

  /** 打字時不要每一鍵都重畫整張圖，等手停下來再畫。 */
  function scheduleRender() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(render, 220);
  }

  function init() {
    ['flowCard', 'flowText', 'flowErr', 'flowCount', 'flowResetBtn', 'edTitleIn']
      .forEach(function (id) { el[id] = $(id); });
    if (!el.flowText.value) el.flowText.value = DD.FLOW_EXAMPLE;
    el.flowText.addEventListener('input', scheduleRender);
    el.flowResetBtn.addEventListener('click', function () {
      el.flowText.value = DD.FLOW_EXAMPLE;
      render();
    });
  }

  function open() {
    el.flowCard.hidden = false;
    if (!el.edTitleIn.value) el.edTitleIn.value = '公文簽辦流程';
    render();
  }

  function close() {
    if (el.flowCard) el.flowCard.hidden = true;
  }

  window.DDFlow = { init: init, open: open, close: close, _render: render };
})(window, document);
