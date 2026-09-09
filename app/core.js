/*
 * core.js — 唯一的純函式層。不碰 DOM、不碰 fetch，Node 直接 require 得動。
 *
 * 這一層做的是「字串進、字串出」的事：從上游的範例 HTML 抽出 SVG、把字型換成本機字族、
 * 把顏色換掉、把標題與來源標註組成可下載的 SVG／HTML。凡是要摸 document 的都在
 * gallery.js 與 editor.js，混在一起就只能靠 e2e 測，測起來又慢又脆。
 *
 * 圖表範本來源：https://github.com/cathrynlavery/diagram-design （MIT，Cathryn Lavery）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── 來源標註：站上、下載檔、README 都用同一組字串，不要各寫各的 ───────── */
  var SOURCE = {
    repo: 'cathrynlavery/diagram-design',
    url: 'https://github.com/cathrynlavery/diagram-design',
    author: 'Cathryn Lavery',
    license: 'MIT',
    credit: '圖表範本來源：github.com/cathrynlavery/diagram-design（MIT License · Cathryn Lavery）'
  };

  /* ── 字型：只寫字族名，絕不載 webfont ─────────────────────────────────
     上游用的是 Geist／Instrument Serif，webfont 一載就破壞零對外連線的鐵律，
     而且那兩套字沒有中文字，換成中文一定要退回系統字族才看得到字。
     SVG 屬性值用雙引號包，所以字族名一律用單引號，不要寫成雙引號。 */
  var FONTS = {
    sans: "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,-apple-system,sans-serif",
    serif: "'Noto Serif TC','PingFang TC','Microsoft JhengHei',serif",
    mono: "ui-monospace,'SFMono-Regular',Menlo,Consolas,'Noto Sans TC',monospace"
  };

  /* ── 上游的四個色票。改色就是把這四個值換掉（含 rgb()／rgba() 的寫法）─── */
  var UPSTREAM_LIGHT = { paper: '#f5f5f5', ink: '#2d3142', muted: '#4f5d75', accent: '#eb6c36' };
  var UPSTREAM_DARK = { paper: '#2d3142', ink: '#f5f5f5', muted: '#bfc0c0', accent: '#f08a59' };

  /* 換色預設組。gongwu 這組跟公務用工具箱同一套（暖紙底、印章紅）。 */
  var PALETTES = [
    { id: 'source', name: '原版（維持範本原色）', light: null, dark: null },
    {
      id: 'gongwu', name: '工具箱配色（暖紙・印章紅）',
      light: { paper: '#f3f1e9', ink: '#1d2a30', muted: '#566870', accent: '#9d2b25' },
      dark: { paper: '#1d2a30', ink: '#f3f1e9', muted: '#9fb0b6', accent: '#d4655e' }
    },
    {
      id: 'ink', name: '公文黑白（列印用）',
      light: { paper: '#ffffff', ink: '#1a1a1a', muted: '#5a5a5a', accent: '#000000' },
      dark: { paper: '#1a1a1a', ink: '#ffffff', muted: '#b5b5b5', accent: '#ffffff' }
    },
    {
      id: 'blue', name: '公務藍',
      light: { paper: '#f4f6f9', ink: '#17293d', muted: '#4c6076', accent: '#1f5c99' },
      dark: { paper: '#17293d', ink: '#f4f6f9', muted: '#9fb2c6', accent: '#5aa2e0' }
    }
  ];

  /* ── 各種圖的中文名。上游用英文檔名分類，公務同仁看不懂 flowchart 以外的字 ── */
  var TYPE_META = {
    'architecture': { zh: '系統架構圖', use: '畫一套系統由哪些元件組成、彼此怎麼連' },
    'bar': { zh: '長條圖', use: '比較幾個項目的數量多寡' },
    'beeswarm': { zh: '蜂群圖', use: '看一整群資料點的分布，不互相遮住' },
    'bubble': { zh: '泡泡圖', use: '三個變數：橫軸、縱軸，加上圓圈大小' },
    'bump': { zh: '名次變化圖', use: '看幾個對象的排名逐年怎麼換位置' },
    'data-flow': { zh: '資料流向圖', use: '資料從哪裡來、經過誰、流到哪裡去' },
    'datalake': { zh: '資料湖架構圖', use: '資料倉儲／資料湖的分層與元件' },
    'db-schema': { zh: '資料庫結構圖', use: '資料表的欄位與關聯' },
    'dependency': { zh: '相依關係圖', use: '誰依賴誰、哪個環節動不得' },
    'deployment': { zh: '部署架構圖', use: '系統實際佈在哪些機器、機房或雲上' },
    'dp-integration': { zh: '平台整合圖', use: '多個系統之間的介接關係' },
    'dp-security-matrix': { zh: '權責矩陣圖', use: '哪個角色對哪個項目有什麼權限' },
    'er': { zh: '實體關聯圖', use: '業務上的實體與它們之間的關係' },
    'fishbone': { zh: '魚骨圖（要因分析）', use: '一個問題背後的各類原因' },
    'flowchart': { zh: '流程圖', use: '有判斷分支的作業流程，公務最常用的一種' },
    'gantt': { zh: '甘特圖', use: '各項工作的起迄時間與重疊情形' },
    'high-level-vertical': { zh: '總覽架構圖（直式）', use: '整體架構的直式版面，適合 A4 直印' },
    'high-level': { zh: '總覽架構圖（橫式）', use: '一頁講完整體架構，給長官看的那張' },
    'import-drawio': { zh: 'draw.io 重畫示範', use: '把既有 draw.io 圖重畫成同一套風格' },
    'import-mermaid': { zh: 'Mermaid 重畫示範', use: '把 Mermaid 語法圖重畫成同一套風格' },
    'it-state': { zh: '資訊系統現況圖', use: '盤點現有系統與介接現況' },
    'journey': { zh: '使用者旅程圖', use: '民眾或同仁走過一段流程的每一步與感受' },
    'kanban': { zh: '看板', use: '待辦、進行中、已完成的分欄狀態' },
    'layers': { zh: '分層堆疊圖', use: '由下而上的層級結構，例如法規或系統分層' },
    'line': { zh: '折線圖', use: '一段時間內的變化趨勢' },
    'loop': { zh: '循環圖／飛輪', use: '會自我強化的循環關係' },
    'medallion': { zh: '分層資料架構圖', use: '原始→整理→彙整的資料分層' },
    'nested': { zh: '巢狀結構圖', use: '一層包一層的從屬關係' },
    'org-chart': { zh: '組織圖', use: '機關、單位、職務的隸屬關係' },
    'paved-road': { zh: '標準路徑圖（動畫）', use: '標準做法與例外做法的對照' },
    'policy-trace': { zh: '政策軌跡圖（動畫）', use: '一項規則在系統中被套用的路徑' },
    'polar': { zh: '極座標圖', use: '環狀排列的多項比較' },
    'process': { zh: '流程階段圖', use: '沒有分支的線性階段，適合作業程序說明' },
    'pyramid': { zh: '金字塔／漏斗圖', use: '層層收斂的結構或轉換率' },
    'quadrant': { zh: '四象限圖', use: '兩個維度分四類，例如重要與緊急' },
    'queue': { zh: '佇列圖（動畫）', use: '排隊處理的機制' },
    'radar': { zh: '雷達圖', use: '同一對象在多個面向的表現' },
    'ridgeline': { zh: '山脊圖', use: '多組分布疊在一起比較' },
    'sankey': { zh: '桑基圖（流量分布）', use: '預算、人力、案件如何分流到各去向' },
    'scatter': { zh: '散布圖', use: '兩個變數之間有沒有關係' },
    'sequence-oauth': { zh: '時序圖（認證流程）', use: '登入授權這類來回多次的流程' },
    'sequence': { zh: '時序圖', use: '誰先跟誰要什麼、回什麼，依時間順序' },
    'slopegraph': { zh: '斜率圖', use: '前後兩個時點的變化，一眼看出誰升誰降' },
    'state': { zh: '狀態機圖', use: '一個案件會處在哪些狀態、怎麼流轉' },
    'story-map': { zh: '使用者故事地圖', use: '把需求依使用流程排開' },
    'swimlane': { zh: '泳道圖', use: '跨單位流程：哪一段是誰的責任' },
    'timeline': { zh: '時間軸', use: '沿革、大事紀、期程說明' },
    'treemap': { zh: '矩形樹狀圖', use: '用面積表示佔比的分類結構' },
    'tree': { zh: '樹狀圖', use: '由上往下展開的層級分類' },
    'uml-class': { zh: 'UML 類別圖', use: '物件導向的類別與關係' },
    'venn': { zh: '文氏圖', use: '幾個集合的交集與差異' },
    'wardley': { zh: 'Wardley 地圖', use: '把能力依價值鏈與成熟度定位' },
    'template': { zh: '空白起手式', use: '沒有內容的骨架，適合從零開始排' }
  };

  /* 首頁預設推的一批。
     判準不是「公務常見」而是「Excel 做不到、自己排會排到崩潰」——
     長條圖、折線圖、圓餅圖 Excel 兩下就有，不必來這裡；
     真正難的是流程圖、泳道圖、組織圖這種要對齊方塊與連線的。
     庫裡還是有長條圖與折線圖，只是不放在預設的視野裡。 */
  var COMMON_TYPES = ['flowchart', 'swimlane', 'process', 'org-chart', 'gantt', 'timeline',
    'state', 'tree', 'layers', 'quadrant', 'pyramid', 'venn', 'journey', 'kanban'];

  /* 首頁最上面那排大按鈕：最常被要求、又最難自己排的七張，全部已經是中文的。
     使用者第一眼要看到的是「我要畫的那張就在這」，不是 153 張的清單。 */
  var STARTERS = [
    { id: 'example-flowchart', label: '流程圖', note: '有判斷分支的作業流程' },
    { id: 'example-swimlane', label: '泳道圖', note: '跨層級：哪一段是誰的責任' },
    { id: 'example-process', label: '跨科室流轉', note: '案件從送件到結案走過哪些科' },
    { id: 'example-org-chart', label: '組織圖', note: '單位、職務與分工' },
    { id: 'example-gantt', label: '甘特圖', note: '各項工作的起迄與重疊' },
    { id: 'example-timeline', label: '時間軸', note: '沿革、大事紀、期程' },
    { id: 'example-state', label: '案件狀態流轉', note: '一件案子會處在哪些狀態' }
  ];

  var VARIANT_ZH = {
    '': '標準', 'dark': '深色', 'full': '完整版', 'terminal': '終端機風',
    'animated': '動畫', 'consultant': '顧問版', 'motion': '動畫'
  };

  /* ── 小工具 ──────────────────────────────────────────────────────── */

  function escapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function normalizeHex(hex) {
    var h = String(hex || '').trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    return /^#[0-9a-f]{6}$/.test(h) ? h : null;
  }

  function hexToRgb(hex) {
    var h = normalizeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16)
    };
  }

  /* ── 抽取：從上游那份自足 HTML 拿出我們要的東西 ────────────────────── */

  /**
   * 取出最外層的 <svg>…</svg>。
   * 裡面還會有巢狀的小 svg（圖示），所以是「第一個 <svg 到最後一個 </svg>」，
   * 不能用非貪婪比對——那會在第一個內層圖示就收尾，整張圖只剩前幾百個位元組。
   */
  function extractSvg(html) {
    var s = String(html);
    var start = s.search(/<svg[\s>]/);
    if (start < 0) return '';
    var end = s.lastIndexOf('</svg>');
    if (end < 0) return '';
    return s.slice(start, end + 6);
  }

  function firstMatch(html, re) {
    var m = String(html).match(re);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  }

  function stripTags(s) { return String(s).replace(/<[^>]*>/g, ''); }

  /**
   * 從上游範例 HTML 抽出一張圖的全部素材。
   * 回傳 {title, eyebrow, heading, desc, svg, css}
   */
  function extractDocument(html) {
    var svg = extractSvg(html);
    var css = '';
    String(html).replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, function (_, body) {
      css += body + '\n';
      return '';
    });
    return {
      title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      eyebrow: stripTags(firstMatch(html, /<p class="eyebrow"[^>]*>([\s\S]*?)<\/p>/i)),
      heading: stripTags(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)),
      desc: stripTags(firstMatch(svg, /<desc[^>]*>([\s\S]*?)<\/desc>/i)),
      svg: svg,
      css: css
    };
  }

  /* ── 圖上的文字：切成一段一段 ─────────────────────────────────────────
     切法必須跟 editor.js 的 collectUnits() 一模一樣，因為中文層是「依序號對應」的：
     這裡切成 30 段，中文就寫 30 筆，第 7 筆對第 7 段。切法一旦兩邊不一致，
     中文就會整批錯位，而畫面上只是「字怪怪的」，不會報錯。
     e2e 有一項逐張比對兩邊的段數，就是為了讓這種錯直接紅。 */

  /** 拿掉不會畫在畫面上的區塊（定義、箭頭端點、裁切路徑）。 */
  function stripNonVisual(svg) {
    return String(svg)
      .replace(/<defs\b[\s\S]*?<\/defs>/gi, '')
      .replace(/<marker\b[\s\S]*?<\/marker>/gi, '')
      .replace(/<clipPath\b[\s\S]*?<\/clipPath>/gi, '');
  }

  function normalizeSegment(s) {
    return String(s).replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim();
  }

  /**
   * 依「有 tspan 就一個 tspan 一段，沒有就整個 <text> 一段」切出可編輯的文字段。
   * 空白的段也要留著——序號要對得上，少一段後面全錯位。
   */
  function extractTextSegments(svg) {
    var s = stripNonVisual(svg);
    var out = [];
    var re = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
    var m;
    while ((m = re.exec(s))) {
      var inner = m[1];
      /* 只收最內層的 tspan：外層 tspan 的內容包含內層，收了會重複 */
      var leaves = [];
      var tre = /<tspan\b[^>]*>((?:(?!<tspan)[\s\S])*?)<\/tspan>/gi;
      var tm;
      while ((tm = tre.exec(inner))) leaves.push(tm[1]);
      if (leaves.length) {
        leaves.forEach(function (t) { out.push({ text: normalizeSegment(t), multiline: false }); });
      } else {
        out.push({ text: normalizeSegment(inner), multiline: true });
      }
    }
    return out;
  }

  /* ── 骨架字典：不管你要畫什麼都用得到的那些字 ───────────────────────
     只收「換掉內容之後還會留在圖上」的字：圖例、月份、季別、是否、狀態欄位名。
     內容字（Sprint velocity、Kubernetes、Athena 那些）不收——使用者本來就要整段換掉，
     翻成中文一樣沒用，只是多一層要維護的東西。
     比對時大小寫不計，但上游常用全大寫當標籤，所以中文也照樣簡短。 */
  var GLOSSARY = {
    /* 圖例與說明 */
    'legend': '圖例',
    'legend · shape carries type': '圖例 · 形狀代表類型',
    'legend · relationships': '圖例 · 關係',
    'type key': '類型對照',
    'headline': '標題',
    'trend': '趨勢',
    'default': '一般',
    'none': '無',
    /* 流程圖 */
    'yes': '是',
    'no': '否',
    'start / end (oval)': '起訖（橢圓）',
    'step (rectangle)': '步驟（矩形）',
    'decision (diamond)': '判斷（菱形）',
    'happy path': '主要路徑',
    'branch': '分支',
    'step': '步驟',
    'primary flow': '主要流向',
    'primary path': '主要路徑',
    'primary data path': '主要資料流向',
    'data flow': '資料流向',
    'sequential handoff': '依序交辦',
    'standard handoff': '一般交辦',
    'critical handoff': '關鍵交辦',
    'focal handoff': '重點交辦',
    'within-lane step': '同一泳道內的步驟',
    'revision loop': '退回修正',
    'focal outcome': '重點結果',
    'left in · right out': '左進右出',
    /* 甘特／期程 */
    'task': '工作項目',
    'phase': '階段',
    'gate': '查核點',
    'event': '事件',
    'major milestone': '重要里程碑',
    'milestone': '里程碑',
    'q1': '第一季', 'q2': '第二季', 'q3': '第三季', 'q4': '第四季',
    'january': '一月', 'february': '二月', 'march': '三月', 'april': '四月',
    'may': '五月', 'june': '六月', 'july': '七月', 'august': '八月',
    'september': '九月', 'october': '十月', 'november': '十一月', 'december': '十二月',
    'jan': '1月', 'feb': '2月', 'mar': '3月', 'apr': '4月', 'jun': '6月',
    'jul': '7月', 'aug': '8月', 'sep': '9月', 'oct': '10月', 'nov': '11月', 'dec': '12月',
    'w1': '第1週', 'w2': '第2週', 'w3': '第3週', 'w4': '第4週',
    'w5': '第5週', 'w6': '第6週', 'w7': '第7週', 'w8': '第8週',
    /* 四象限與優先順序 */
    'do first': '優先處理',
    'quick wins': '容易見效',
    'major projects': '重點專案',
    'avoid': '不必投入',
    '↑ high impact': '↑ 影響大',
    '↓ low impact': '↓ 影響小',
    '← low effort': '← 投入少',
    'high effort →': '投入多 →',
    'high': '高', 'low': '低', 'neutral': '普通',
    'candidate project': '候選項目',
    'start tomorrow': '明天就能開始',
    'highest risk': '風險最高',
    'risk': '風險',
    /* 看板與狀態 */
    'backlog': '待辦',
    'in progress': '進行中',
    'review': '審查中',
    'done': '已完成',
    'blocked': '卡住',
    'waiting / external': '等待外部',
    'over wip limit': '超過在製上限',
    'draft': '草稿',
    'unpublished': '未發布',
    'in review': '審查中',
    'awaiting approval': '待核定',
    'published': '已發布',
    'archived': '已封存',
    'create': '建立', 'submit': '提送', 'approve': '核定',
    'reject · revise': '退回修正', 'expire': '逾期', 'purge': '銷毀',
    /* 旅程圖 */
    'actions': '行動',
    'touchpoints': '接觸點',
    'stage 1': '階段一', 'stage 2': '階段二', 'stage 3': '階段三',
    'stage 4': '階段四', 'stage 5': '階段五',
    'sentiment curve': '感受曲線',
    'trough stage': '低谷階段',
    'pain marker': '痛點',
    'pain-point': '痛點',
    'bottleneck': '瓶頸',
    'outcome': '結果',
    'outcomes': '結果',
    /* 資料與流程階段 */
    'collection': '蒐集',
    'processing': '處理',
    'dissemination': '發布',
    'ingest': '匯入', 'transform': '轉換', 'analyze': '分析', 'publish': '發布',
    'raw': '原始', 'staging': '整理中', 'aggregated': '彙整', 'archive': '封存',
    'source / consumer': '來源／使用端',
    'external': '外部',
    'external / third-party': '外部／第三方',
    'internal package': '內部模組',
    'cycle': '循環',
    'lifecycle': '生命週期',
    /* 關聯圖與類別圖 */
    'entity': '實體',
    'aggregate root': '彙總根',
    'join table': '關聯表',
    'schema group': '結構分組',
    'primary key': '主鍵',
    'foreign key': '外來鍵',
    'cardinality': '對應關係',
    'inheritance': '繼承',
    'realization': '實作',
    'composition · owns': '組合 · 擁有',
    'aggregation · has': '聚合 · 包含',
    'association': '關聯',
    'dependency · uses': '相依 · 使用',
    'dependency': '相依',
    'component': '元件',
    'leaf (no outgoing)': '末端（無對外相依）',
    'cycle (back-edge)': '循環相依',
    /* 前後比較 */
    'before': '之前',
    'after': '之後',
    'passed': '通過', 'failed': '失敗', 'flaked': '不穩定',
    '✓ pass': '✓ 通過',
    'verify': '查驗',
    'budget': '預算'
  };

  /** 骨架字典查表；查不到回 null（代表這一段留原文）。 */
  function glossaryLookup(text, glossary) {
    var g = glossary || GLOSSARY;
    var k = String(text == null ? '' : text).trim().toLowerCase();
    if (!k) return null;
    return Object.prototype.hasOwnProperty.call(g, k) ? g[k] : null;
  }

  /**
   * 把一張圖的每一段文字對到中文。
   * sample（人工寫的公務情境內容）優先於 glossary（骨架字典）；兩邊都沒有就回 null，留原文。
   * 回傳的陣列長度一定跟 segments 一樣長，序號才對得上。
   */
  function translateSegments(segments, sample, glossary) {
    var sm = sample || [];
    return (segments || []).map(function (seg, i) {
      var text = seg && typeof seg === 'object' ? seg.text : seg;
      if (sm[i] != null && String(sm[i]).length) return String(sm[i]);
      return glossaryLookup(text, glossary);
    });
  }

  /** 這張圖有沒有中文可以套。 */
  function hasTranslation(zh) {
    return Array.isArray(zh) && zh.some(function (v) { return v != null && v !== ''; });
  }

  /* ── 字型置換 ────────────────────────────────────────────────────── */

  /** 判斷一段 font-family 值屬於哪一類，回傳本機字族堆疊。 */
  function mapFontValue(value) {
    var v = String(value);
    if (/mono/i.test(v)) return FONTS.mono;
    if (/serif/i.test(v.replace(/sans-serif/gi, ''))) return FONTS.serif;
    return FONTS.sans;
  }

  /**
   * 把 SVG／CSS 裡所有字型宣告換成本機字族。載 webfont 就違反零對外連線。
   * 上游把字族藏在三種地方：SVG 的 font-family 屬性、CSS 的 font-family 宣告，
   * 還有 --sans／--serif／--mono／--font-sans 這類自訂屬性——漏掉自訂屬性那一種，
   * 整張圖看起來沒事，實際上還在指名要 Geist。
   */
  function mapFonts(text) {
    return String(text)
      .replace(/font-family="([^"]*)"/g, function (_, v) {
        return 'font-family="' + mapFontValue(v) + '"';
      })
      .replace(/(--[\w-]*(?:sans|serif|mono)[\w-]*)\s*:\s*([^;}]+)/gi, function (_, k, v) {
        return k + ': ' + mapFontValue(v);
      })
      .replace(/font-family:\s*([^;}"]+)/g, function (_, v) {
        return 'font-family: ' + mapFontValue(v);
      });
  }

  /** 去掉 HTML／XML 註解。上游的註解是給讀原始碼的人看的，搬到站上只是白佔位元組。 */
  function stripComments(text) {
    return String(text).replace(/<!--[\s\S]*?-->/g, '');
  }

  /* ── 整張圖換字體 ─────────────────────────────────────────────────
     公文常用標楷體，簡報常用黑體。上游是「標題襯線、內文黑體、標籤等寬」的混搭，
     多數時候好看，但要交出去的公文圖常常被要求整張統一。
     一樣只寫字族名，絕不載 webfont——使用者機器上沒有標楷體時會退回系統襯線體。 */
  var FONT_CHOICES = [
    { id: 'source', name: '維持範本原本的搭配', stack: null },
    { id: 'kai', name: '標楷體（公文常用）', stack: "'DFKai-SB','BiauKai','Kaiti TC','標楷體','Noto Serif TC',serif" },
    { id: 'sans', name: '全部用黑體', stack: null },
    { id: 'serif', name: '全部用明體／宋體', stack: "'Noto Serif TC','PMingLiU','Songti TC','MingLiU',serif" }
  ];
  /* sans 這一組直接沿用站上的黑體堆疊，不要再抄一份 */
  FONT_CHOICES[2].stack = FONTS.sans;

  function fontChoiceById(id) {
    for (var i = 0; i < FONT_CHOICES.length; i++) if (FONT_CHOICES[i].id === id) return FONT_CHOICES[i];
    return FONT_CHOICES[0];
  }

  /** 把整張圖的字族統一換成同一套。stack 給 null 就原樣回傳（維持範本原本的搭配）。 */
  function forceFontFamily(text, stack) {
    if (!stack) return String(text);
    return String(text)
      .replace(/font-family="[^"]*"/g, 'font-family="' + stack + '"')
      .replace(/(--[\w-]*(?:sans|serif|mono)[\w-]*)\s*:\s*[^;}]+/gi, function (_, k) {
        return k + ': ' + stack;
      })
      .replace(/font-family:\s*[^;}"]+/g, 'font-family: ' + stack);
  }

  /* ── 從 Excel 貼一整欄 ───────────────────────────────────────────
     名單、科室、工作項目這些東西通常已經在 Excel 裡了，一格一格重打很花時間。
     一行對一段；一行裡有多欄（tab）時併成「甲 · 乙」，不要拆成兩段——
     拆了會讓後面每一段都錯位。 */
  function splitPastedColumn(text) {
    return String(text == null ? '' : text)
      .split(/\r\n|\r|\n/)
      .map(function (line) {
        return line.split('\t').map(function (c) { return c.trim(); })
          .filter(Boolean).join(' · ');
      })
      .filter(function (line) { return line.length > 0; });
  }

  /* ── 存檔／載入：把改到一半的東西留住 ─────────────────────────────
     一張圖常常要改好幾次、跨好幾天，或是要交給同事接手。
     存的是「使用者改了什麼」，不是整張 SVG——範本更新時舊設定照樣套得上去。 */
  var PROJECT_VERSION = 1;

  function buildProjectFile(o) {
    var s = o || {};
    return JSON.stringify({
      format: 'gongwu-diagram',
      version: PROJECT_VERSION,
      savedAt: s.savedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
      diagram: s.id,
      diagramName: s.name || '',
      palette: s.palette || 'source',
      font: s.font || 'source',
      fit: s.fit !== false,
      zhOn: !!s.zhOn,
      eyebrow: s.eyebrow || '',
      heading: s.heading || '',
      edits: s.edits || {},
      source: SOURCE.credit
    }, null, 2);
  }

  /**
   * 讀回設定檔。壞掉的檔案要講人話，不要讓使用者看到 JSON.parse 的英文錯誤。
   * 回傳整理過的物件；不合格就 throw，訊息直接拿去顯示。
   */
  function parseProjectFile(text) {
    var data;
    try {
      data = JSON.parse(String(text));
    } catch (e) {
      throw new Error('這不是本站存出來的設定檔（檔案內容不是合法的 JSON）。');
    }
    if (!data || data.format !== 'gongwu-diagram') {
      throw new Error('這不是本站存出來的設定檔，請選副檔名為 .json 的「圖表設定」檔。');
    }
    if (!(data.version <= PROJECT_VERSION)) {
      throw new Error('這份設定檔是較新版本的站台存出來的（version ' + data.version +
        '），本站看不懂。請更新頁面後再試一次。');
    }
    if (!data.diagram) throw new Error('設定檔裡沒有記錄是哪一張範本，無法套用。');
    var edits = {};
    Object.keys(data.edits || {}).forEach(function (k) {
      if (/^\d+$/.test(k) && data.edits[k] != null) edits[k] = String(data.edits[k]);
    });
    return {
      id: String(data.diagram),
      name: String(data.diagramName || ''),
      palette: String(data.palette || 'source'),
      font: String(data.font || 'source'),
      fit: data.fit !== false,
      zhOn: !!data.zhOn,
      eyebrow: String(data.eyebrow || ''),
      heading: String(data.heading || ''),
      edits: edits
    };
  }

  /* ── CSS 收攏：把頁面的 CSS 塞進 SVG 裡，讓 SVG 自己站得住 ──────────── */

  /* 這些選擇器是給 HTML 外殼用的，塞進 SVG 只會反過來汙染我們的頁面
     （尤其 body 與 :root——:root 會蓋掉整站的設計語彙變數）。 */
  var SHELL_SELECTOR = /^(\*|html|body|\.frame|\.eyebrow|h1|h2|p|a|svg)(?![-\w])/;

  /** 粗略切出 CSS 的頂層規則（含 @media／@keyframes 這種有巢狀大括號的）。 */
  function splitRules(css) {
    var out = [], depth = 0, buf = '';
    var s = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      buf += c;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { out.push(buf.trim()); buf = ''; }
      }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(Boolean);
  }

  /**
   * 把頁面 CSS 改造成可以放進 <svg> 裡的樣子：
   *  - :root 換成 SVG 自己的 class（不然在頁面上會蓋掉整站的設計語彙變數）
   *  - 其餘選擇器一律冠上那個 class。首頁一次排 150 張圖，每張都帶自己的 <style>，
   *    而 <style> 是整份文件共用的——不冠上去的話，A 圖的 `.node{fill:...}`
   *    會把 B 圖的 `.node` 一起改掉，而且只在「兩張圖同時出現在畫面上」時才看得出來。
   *  - 丟掉只跟 HTML 外殼有關的規則（body、.frame 那些）
   */
  function scopeCss(css, rootClass) {
    var sel = '.' + rootClass;
    var out = splitRules(css).map(function (rule) {
      var brace = rule.indexOf('{');
      if (brace < 0) return '';
      var head = rule.slice(0, brace).trim();
      if (!head) return '';
      if (/^@(media|supports)/.test(head)) {
        var inner = rule.slice(brace + 1, rule.lastIndexOf('}'));
        var scoped = scopeCss(inner, rootClass);
        return scoped ? head + '{' + scoped + '}' : '';
      }
      if (/^@keyframes/.test(head)) return rule;
      if (/^@/.test(head)) return '';
      var parts = head.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      var kept = [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (/^:root\b/.test(p)) { kept.push(p.replace(/^:root\b/, sel)); continue; }
        if (SHELL_SELECTOR.test(p)) continue;
        kept.push(sel + ' ' + p);
        /* 規則也可能是直接打在 <svg> 根元素上的（class 選擇器），
           那種只有「自己就是根」的寫法才選得到，所以兩種都發一份 */
        if (/^[.#[]/.test(p)) kept.push(sel + p);
      }
      if (!kept.length) return '';
      return kept.join(', ') + rule.slice(brace);
    }).filter(Boolean).join('\n');
    return prefixKeyframes(out, rootClass);
  }

  /**
   * 把 @keyframes 的名字冠上前綴。同一頁擺 150 張圖時，兩張圖各自定義一個叫 pulse
   * 的動畫，後定義的會蓋掉先定義的——動畫是整份文件共用的命名空間。
   * 只改 animation／animation-name 宣告裡的名字，不做全域字串置換（會誤傷同名的 class）。
   */
  function prefixKeyframes(css, prefix) {
    var names = [];
    String(css).replace(/@keyframes\s+([\w-]+)/g, function (_, n) { names.push(n); return ''; });
    if (!names.length) return String(css);
    var out = String(css);
    names.forEach(function (n) {
      var re = new RegExp('(@keyframes\\s+)' + n + '\\b', 'g');
      out = out.replace(re, '$1' + prefix + '-' + n);
    });
    return out.replace(/animation(-name)?\s*:\s*([^;}]+)/g, function (whole, sub, value) {
      var v = value;
      names.forEach(function (n) {
        v = v.replace(new RegExp('(^|[\\s,])' + n + '($|[\\s,])', 'g'), '$1' + prefix + '-' + n + '$2');
      });
      return 'animation' + (sub || '') + ': ' + v;
    });
  }

  /** 在 <svg> 開頭插入一段 <style>，並給根元素掛上 class，讓 :root 變數有地方落腳。 */
  function inlineCssIntoSvg(svg, css, rootClass) {
    var s = String(svg);
    var close = s.indexOf('>');
    if (close < 0) return s;
    var open = s.slice(0, close + 1);
    var rest = s.slice(close + 1);
    open = /\sclass="/.test(open)
      ? open.replace(/\sclass="([^"]*)"/, ' class="$1 ' + rootClass + '"')
      : open.replace(/>$/, ' class="' + rootClass + '">');
    var style = String(css).trim() ? '<style>' + String(css).trim() + '</style>' : '';
    return open + style + rest;
  }

  /* ── 換色 ────────────────────────────────────────────────────────── */

  /** 把字串裡某個顏色（#hex／rgb()／rgba()）全部換成另一個，rgba 的透明度保留。 */
  function recolor(text, fromHex, toHex) {
    var from = normalizeHex(fromHex), to = normalizeHex(toHex);
    if (!from || !to) return String(text);
    var rgb = hexToRgb(from), trgb = hexToRgb(to);
    var out = String(text).replace(new RegExp(from, 'gi'), to);
    if (from[1] === from[2] && from[3] === from[4] && from[5] === from[6]) {
      out = out.replace(new RegExp('#' + from[1] + from[3] + from[5] + '\\b', 'gi'), to);
    }
    var re = new RegExp('rgba?\\(\\s*' + rgb.r + '\\s*,\\s*' + rgb.g + '\\s*,\\s*' + rgb.b + '\\s*([,)])', 'g');
    return out.replace(re, function (_, tail) {
      return 'rgba(' + trgb.r + ',' + trgb.g + ',' + trgb.b + (tail === ',' ? ',' : ',1)');
    });
  }

  /**
   * 依色票對應表整批換色。from／to 都是 {paper,ink,muted,accent}。
   * 先換成一組不會撞到的暫時色再換成目標色——不然 ink→paper、paper→ink 這種對調會連環相撞，
   * 第二輪會把第一輪剛換好的顏色再換一次，整張圖只剩一個顏色。
   */
  function applyPalette(text, from, to) {
    if (!from || !to) return String(text);
    var keys = ['paper', 'ink', 'muted', 'accent'];
    var tmp = { paper: '#010203', ink: '#040506', muted: '#070809', accent: '#0a0b0c' };
    var out = String(text);
    keys.forEach(function (k) { if (from[k] && to[k]) out = recolor(out, from[k], tmp[k]); });
    keys.forEach(function (k) { if (from[k] && to[k]) out = recolor(out, tmp[k], to[k]); });
    return out;
  }

  /**
   * 上游有三張深色範例（長條圖、甘特圖、散布圖）把整張圖的底色寫死成淺色的 #f5f5f5，
   * 但同一張圖的網點、文字都是照深色算的——結果是白底配白點、幾乎看不見。
   * 這裡只把「鋪滿整張的那一塊底」換成深色的紙色，其餘的 #f5f5f5 是文字色，不能碰。
   */
  function fixDarkBackdrop(svg) {
    var re = /(<rect[^>]*width="100%"[^>]*height="100%"[^>]*fill=")#f5f5f5(")/i;
    return String(svg).replace(re, '$1' + UPSTREAM_DARK.paper + '$2');
  }

  function paletteById(id) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
    return PALETTES[0];
  }

  /** 一張圖現在該用哪組顏色：先看使用者選的色票，沒選就沿用上游原色。 */
  function resolveColors(paletteId, isDark) {
    var p = paletteById(paletteId);
    var base = isDark ? UPSTREAM_DARK : UPSTREAM_LIGHT;
    var target = isDark ? p.dark : p.light;
    return { from: base, to: target, colors: target || base };
  }

  /* ── 版面計算 ────────────────────────────────────────────────────── */

  function parseViewBox(svg) {
    var m = String(svg).match(/viewBox="\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)\s*"/);
    if (!m) return null;
    return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
  }

  /* 中日韓文字（含全形標點）算 1 單位，其餘算 0.55 單位 */
  var CJK = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠￠-￦]/;

  /** 估一段文字有多寬（單位＝一個中文字的寬度）。用估的就夠，不必真的量。 */
  function textUnits(text) {
    var n = 0, s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) n += CJK.test(s[i]) ? 1 : 0.55;
    return n;
  }

  /** 依估寬折行。中文沒有空白可斷，所以逐字塞；英文優先在空白處斷。 */
  function wrapLabel(text, maxUnits) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return [];
    if (!(maxUnits > 0)) return [s];
    var lines = [], cur = '', curW = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      var w = CJK.test(ch) ? 1 : 0.55;
      if (curW + w > maxUnits && cur.trim()) {
        var sp = cur.lastIndexOf(' ');
        if (sp > 0 && !CJK.test(ch) && !CJK.test(cur.charAt(cur.length - 1))) {
          lines.push(cur.slice(0, sp).trim());
          cur = cur.slice(sp + 1);
        } else {
          lines.push(cur.trim());
          cur = '';
        }
        curW = textUnits(cur);
      }
      /* 換行之後行首的空白要丟掉——留著會佔掉下一行的寬度，
         連鎖起來就是「每一行都少一個字」，最後一個字被擠成單獨一行 */
      if (ch === ' ' && !cur) continue;
      cur += ch;
      curW += w;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines.filter(function (l) { return l !== ''; });
  }

  /**
   * 中文塞進為英文算好的框裡會爆出來。這裡算出要縮到多小才塞得下，
   * 但不小於 minSize——縮到看不見比爆出去更糟，寧可提醒使用者自己改短。
   */
  function shrinkToFit(size, actualWidth, maxWidth, minSize) {
    var min = minSize == null ? 7 : minSize;
    if (!(size > 0)) return size;
    if (!(actualWidth > 0) || !(maxWidth > 0) || actualWidth <= maxWidth) return size;
    return Math.max(min, Math.round(size * (maxWidth / actualWidth) * 100) / 100);
  }

  /* ── 組出可下載的檔案 ────────────────────────────────────────────── */

  /** 在既有 <svg> 的開頭標籤上設定／覆寫屬性。 */
  function setSvgAttrs(svg, attrs) {
    var s = String(svg);
    var close = s.indexOf('>');
    if (close < 0) return s;
    var open = s.slice(0, close);
    Object.keys(attrs).forEach(function (k) {
      var re = new RegExp('\\s' + k + '="[^"]*"');
      var pair = ' ' + k + '="' + attrs[k] + '"';
      open = re.test(open) ? open.replace(re, pair) : open + pair;
    });
    return open + s.slice(close);
  }

  /**
   * 把「眉標＋標題＋圖＋來源標註」組成一張可以直接下載、直接貼進 Word 的 SVG。
   * 原圖整個當成巢狀 <svg> 放進去，不動它一個字，這樣改壞的風險最低。
   * 巢狀的 <svg> 一定要明寫 x／y／width／height：只給 viewBox 的話它會撐滿整個外框，
   * 直接蓋掉上面的標題。
   */
  function composeExportSvg(opts) {
    var o = opts || {};
    var inner = String(o.svg || '');
    var box = parseViewBox(inner) || { x: 0, y: 0, w: 1000, h: 600 };
    var colors = o.colors || UPSTREAM_LIGHT;
    var pad = Math.round(box.w * 0.04);
    var eyebrowSize = Math.max(9, Math.round(box.w * 0.011));
    var headingSize = Math.max(16, Math.round(box.w * 0.026));
    var lineH = Math.round(headingSize * 1.24);
    var creditSize = Math.max(8, Math.round(box.w * 0.0092));

    var eyebrow = String(o.eyebrow || '').trim();
    var heading = String(o.heading || '').trim();
    var headingLines = wrapLabel(heading, (box.w - pad * 2) / (headingSize * 0.92));
    var headerH = 0;
    if (eyebrow || headingLines.length) {
      headerH = pad + (eyebrow ? eyebrowSize + 12 : 0) +
        headingLines.length * lineH + Math.round(pad * 0.4);
    }
    var footerH = o.credit === false ? 0 : Math.round(creditSize * 2.9);
    var total = headerH + box.h + footerH;

    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'viewBox="0 0 ' + box.w + ' ' + total + '" width="' + box.w + '" height="' + total + '" ' +
      'role="img" aria-label="' + escapeXml(heading || o.title || '圖表') + '">');
    parts.push('<rect width="100%" height="100%" fill="' + escapeXml(colors.paper) + '"/>');

    var y = pad + eyebrowSize;
    if (eyebrow) {
      parts.push('<text x="' + pad + '" y="' + y + '" fill="' + escapeXml(colors.muted) +
        '" font-size="' + eyebrowSize + '" font-family="' + FONTS.mono +
        '" letter-spacing="0.16em">' + escapeXml(eyebrow) + '</text>');
      y += 12;
    }
    if (headingLines.length) {
      parts.push('<text x="' + pad + '" y="' + (y + headingSize) + '" fill="' + escapeXml(colors.ink) +
        '" font-size="' + headingSize + '" font-family="' + FONTS.serif + '" font-weight="700">' +
        headingLines.map(function (ln, i) {
          return '<tspan x="' + pad + '" dy="' + (i ? lineH : 0) + '">' + escapeXml(ln) + '</tspan>';
        }).join('') + '</text>');
    }

    parts.push(setSvgAttrs(inner, { x: 0, y: headerH, width: box.w, height: box.h }));

    if (footerH) {
      parts.push('<text x="' + pad + '" y="' + (total - Math.round(creditSize * 1.1)) +
        '" fill="' + escapeXml(colors.muted) + '" font-size="' + creditSize +
        '" font-family="' + FONTS.mono + '" opacity="0.85">' + escapeXml(SOURCE.credit) + '</text>');
    }
    parts.push('</svg>');
    return parts.join('\n');
  }

  /** 加上 XML 宣告，存成 .svg 檔用。 */
  function svgFile(svg) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + String(svg) + '\n';
  }

  /* ── .docx：Word 打得開，而且圖可以「轉換成圖形」變成能拖能改字的圖案 ──
   *
   * 做法是包一份 OOXML，圖片同時放 SVG 與 PNG 兩份：
   *   - Word 2016／Microsoft 365 看得懂 SVG（a:blip 底下的 asvg:svgBlip 擴充），
   *     使用者在 Word 裡對圖按右鍵 →「轉換成圖形」，整張圖就變成 Word 的圖案群組，
   *     可以拖、可以改字。這是這個功能存在的理由——貼一張 PNG 進去誰都會。
   *   - 舊版 Word 與 LibreOffice 看不懂 SVG，就顯示那份 PNG。所以兩份都要放，
   *     不能只放 SVG（那會變成一個空白框，而且畫面上完全看不出哪裡錯了）。
   *
   * ZIP 一律用 store（不壓縮）。docx 允許 store，而且省掉一整包 deflate——
   * 這個站的鐵律是零相依，為了少幾百 KB 去長一個壓縮器不划算。
   */

  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
    return CRC_TABLE;
  }

  function crc32(bytes) {
    var t = crcTable();
    var c = -1;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    /* Node 沒有 TextEncoder 的舊版本，測試環境也要跑得動 */
    var out = [], s = unescape(encodeURIComponent(String(str)));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF);
    return new Uint8Array(out);
  }

  /** 只做 store 的 ZIP。entries 是 [{name, bytes}]。回傳 Uint8Array。 */
  function zipStore(entries) {
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

    entries.forEach(function (e) {
      var nameBytes = utf8Bytes(e.name);
      var crc = crc32(e.bytes);
      var size = e.bytes.length;
      /* 時間固定成 1980-01-01：同樣的內容壓出同樣的位元組，測得起來 */
      var head = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(33),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0));
      chunks.push(new Uint8Array(head), nameBytes, e.bytes);
      central.push({ name: nameBytes, crc: crc, size: size, offset: offset });
      offset += head.length + nameBytes.length + size;
    });

    var dirStart = offset, dirLen = 0;
    central.forEach(function (c) {
      var head = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(33),
        u32(c.crc), u32(c.size), u32(c.size),
        u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset));
      chunks.push(new Uint8Array(head), c.name);
      dirLen += head.length + c.name.length;
    });
    chunks.push(new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(dirLen), u32(dirStart), u16(0))));

    var total = chunks.reduce(function (n, c) { return n + c.length; }, 0);
    var out = new Uint8Array(total), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  var EMU = 9525;   /* 1 px = 9525 EMU */

  /* ── 把自己畫的 SVG 換成 Word 原生圖案 ──────────────────────────────────
   *
   * Word 的「轉換成圖形」靠不住：實測 Word 2019 轉一張家系圖，68 個圖形進去、
   * 51 個 Word 圖案出來，**32 段文字一個都沒留**——姓名、年齡、婚姻狀態全不見，
   * 只剩一堆線條。所以下載的 .docx 不再指望那一步：這裡直接把每一條線、
   * 每一個框、每一行字都寫成 Word 自己的圖案（DrawingML 的 wpg 群組），
   * 檔案打開就能拖、就能改字，不必按右鍵轉換。
   *
   * 只認得我們自己畫圖用的那幾種標籤。範本庫那 153 張是別人寫的任意 SVG
   * （CSS class、漸層、巢狀 svg、foreignObject 都有），一律回 null 讓 buildDocx
   * 退回原本的圖片——猜著轉會產出一張缺東少西的圖，比一張不能編輯的圖更糟。
   */

  var WORD_TAGS = /<(rect|circle|line|polyline|polygon|path|text)\b[^>]*(?:\/>|>([\s\S]*?)<\/\1>)/g;

  /** 量寬度前要先把 &amp; 這種還原回來，不然一個 & 會被當成五個字。 */
  function unescapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function svgAttrs(str) {
    /* 屬性名字裡有數字（x1、y2…），字元類別漏了 0-9 的話整條線的座標都會變成 0 */
    var out = {}, re = /([a-zA-Z_:][\w.:-]*)\s*=\s*"([^"]*)"/g, m;
    while ((m = re.exec(str))) out[m[1]] = m[2];
    return out;
  }

  /** 數字屬性；`100%` 這種要拿整張圖的寬高去換算。 */
  function svgNum(v, alt, full) {
    if (v == null) return alt;
    var s = String(v).trim();
    if (/%$/.test(s)) return (parseFloat(s) / 100) * (full || 0);
    var n = parseFloat(s);
    return isFinite(n) ? n : alt;
  }

  /** 顏色 → {hex, alpha}。`none` 與 `url(#網點)` 回 null：Word 沒有對應的東西。 */
  function wordColor(v) {
    var s = v == null ? '' : String(v).trim();
    if (!s || s === 'none' || s.indexOf('url(') === 0) return null;
    var m = /^#([0-9a-fA-F]{3})$/.exec(s);
    if (m) {
      return { hex: m[1].replace(/./g, function (c) { return c + c; }).toUpperCase(), alpha: 1 };
    }
    m = /^#([0-9a-fA-F]{6})$/.exec(s);
    if (m) return { hex: m[1].toUpperCase(), alpha: 1 };
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
      var p = m[1].split(',').map(function (x) { return parseFloat(x); });
      if (p.length < 3 || !isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2])) return null;
      var hex = p.slice(0, 3).map(function (n) {
        var h = Math.max(0, Math.min(255, Math.round(n))).toString(16);
        return h.length < 2 ? '0' + h : h;
      }).join('').toUpperCase();
      return { hex: hex, alpha: p.length > 3 && isFinite(p[3]) ? Math.max(0, Math.min(1, p[3])) : 1 };
    }
    return null;
  }

  function wordFill(c, opacity) {
    if (!c) return '<a:noFill/>';
    var a = c.alpha * (opacity == null ? 1 : opacity);
    return '<a:solidFill><a:srgbClr val="' + c.hex + '">' +
      (a < 1 ? '<a:alpha val="' + Math.round(a * 100000) + '"/>' : '') +
      '</a:srgbClr></a:solidFill>';
  }

  function wordLine(a, k, opacity) {
    var c = wordColor(a.stroke);
    if (!c) return '<a:ln><a:noFill/></a:ln>';
    var w = Math.max(1, Math.round(svgNum(a['stroke-width'], 1, 0) * k));
    var dash = '';
    if (a['stroke-dasharray']) {
      var first = parseFloat(String(a['stroke-dasharray']).split(/[\s,]+/)[0]);
      dash = '<a:prstDash val="' + (first <= 2.5 ? 'sysDot' : 'dash') + '"/>';
    }
    return '<a:ln w="' + w + '" cap="rnd">' + wordFill(c, opacity) + dash + '<a:round/>' +
      (a['marker-end'] ? '<a:tailEnd type="triangle" w="med" len="med"/>' : '') + '</a:ln>';
  }

  /** d 屬性 → 幾條子路徑。只吃絕對座標的 M/L/H/V/C/Z——我們自己只畫這些。 */
  function parsePathD(d) {
    var toks = String(d == null ? '' : d).match(/[A-Za-z]|-?\d*\.?\d+/g);
    if (!toks) return null;
    var paths = [], cur = null, i = 0, cmd = '', px = 0, py = 0;
    function n() { return parseFloat(toks[i++]); }
    while (i < toks.length) {
      if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
      if (cmd === 'Z' || cmd === 'z') { if (cur) cur.close = true; cmd = ''; continue; }
      if (i >= toks.length) break;
      if ('MLHVC'.indexOf(cmd) < 0) return null;
      if (cmd === 'M') {
        px = n(); py = n();
        if (!isFinite(px) || !isFinite(py)) return null;
        cur = { ops: [{ t: 'm', pts: [[px, py]] }], close: false };
        paths.push(cur);
        cmd = 'L';                       /* M 後面再接一組座標就是隱含的 L */
        continue;
      }
      if (!cur) return null;
      if (cmd === 'H' || cmd === 'V') {
        var one = n();
        if (!isFinite(one)) return null;
        if (cmd === 'H') px = one; else py = one;
        cur.ops.push({ t: 'l', pts: [[px, py]] });
        continue;
      }
      if (cmd === 'L') {
        var lx = n(), ly = n();
        if (!isFinite(lx) || !isFinite(ly)) return null;
        cur.ops.push({ t: 'l', pts: [[lx, ly]] });
        px = lx; py = ly;
        continue;
      }
      var c1x = n(), c1y = n(), c2x = n(), c2y = n(), ex = n(), ey = n();
      if ([c1x, c1y, c2x, c2y, ex, ey].some(function (v) { return !isFinite(v); })) return null;
      cur.ops.push({ t: 'c', pts: [[c1x, c1y], [c2x, c2y], [ex, ey]] });
      px = ex; py = ey;
    }
    return paths.length ? paths : null;
  }

  function pointsList(str) {
    var nums = String(str == null ? '' : str).match(/-?\d*\.?\d+/g);
    if (!nums || nums.length < 4 || nums.length % 2) return null;
    var pts = [];
    for (var i = 0; i < nums.length; i += 2) pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
    return pts;
  }

  /** 中文字一個字寬約一個字高，英數字約 0.55——用來估文字方塊要多寬。 */
  function textEm(s) {
    var em = 0;
    String(s).split('').forEach(function (ch) {
      em += ch.charCodeAt(0) > 0x2e7f ? 1 : 0.55;
    });
    return em;
  }

  function xfrmXml(x, y, w, h, flipH, flipV) {
    return '<a:xfrm' + (flipH ? ' flipH="1"' : '') + (flipV ? ' flipV="1"' : '') + '>' +
      '<a:off x="' + Math.round(x) + '" y="' + Math.round(y) + '"/>' +
      '<a:ext cx="' + Math.max(0, Math.round(w)) + '" cy="' + Math.max(0, Math.round(h)) + '"/></a:xfrm>';
  }

  var WORD_BODY = '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" ' +
    'anchor="ctr" anchorCtr="0"><a:noAutofit/></wps:bodyPr>';

  function wordWsp(id, name, xfrm, geom, fill, ln, txbx, bodyPr) {
    return '<wps:wsp><wps:cNvPr id="' + id + '" name="' + escapeXml(name) + '"/>' +
      '<wps:cNvSpPr' + (txbx ? ' txBox="1"' : '') + '/><wps:spPr>' +
      xfrm + geom + fill + ln + '</wps:spPr>' + (txbx || '') + (bodyPr || WORD_BODY) + '</wps:wsp>';
  }

  /** 折線／多邊形／path 共用：一串點 → custGeom。座標是相對外框的。 */
  function custGeomXml(paths, minX, minY, k, cx, cy) {
    var pw = Math.max(1, Math.round(cx)), ph = Math.max(1, Math.round(cy));
    function pt(p) {
      return '<a:pt x="' + Math.round((p[0] - minX) * k) + '" y="' + Math.round((p[1] - minY) * k) + '"/>';
    }
    var body = paths.map(function (sub) {
      var ops = sub.ops.map(function (op) {
        if (op.t === 'm') return '<a:moveTo>' + pt(op.pts[0]) + '</a:moveTo>';
        if (op.t === 'l') return '<a:lnTo>' + pt(op.pts[0]) + '</a:lnTo>';
        return '<a:cubicBezTo>' + op.pts.map(pt).join('') + '</a:cubicBezTo>';
      }).join('');
      return '<a:path w="' + pw + '" h="' + ph + '">' + ops + (sub.close ? '<a:close/>' : '') + '</a:path>';
    }).join('');
    return '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>' +
      '<a:rect l="0" t="0" r="' + pw + '" b="' + ph + '"/><a:pathLst>' + body + '</a:pathLst></a:custGeom>';
  }

  /* Word 檔裡「最大的那一段字」要有這麼大。以前是把整張圖縮到 A4 直式的寬度，
     13px 的字只剩 6pt——印出來看不到，在 Word 裡調大又會被文字方塊裁掉。
     現在反過來：先決定字要多大，再讓頁面配合圖，而不是讓圖配合頁面。 */
  var MIN_PT = 14;
  /* 放大倍率的上限。三倍以上的圖沒有人放得進報告裡，那時候寧可字小一點。 */
  var WORD_MAX_SCALE = 3;
  /* 裁切後四周留一點白，不然形狀會貼著群組的邊 */
  var WORD_PAD = 10;

  /** 這張圖換不換得成 Word 圖案。畫面上要據此講不同的話，別讓使用者去猜。 */
  function wordShapesOk(svg) {
    return svgToWordGroup(svg, { scale: 1 }) !== null;
  }

  /** 巢狀 <svg>：切出「前面、這一塊、後面」。深度要數，不然遇到更裡面那層會切錯。 */
  function splitNestedSvg(body) {
    var i = body.indexOf('<svg');
    if (i < 0) return null;
    var re = /<svg\b|<\/svg>/g, depth = 0, m, end = -1;
    re.lastIndex = i;
    while ((m = re.exec(body))) {
      if (m[0] === '</svg>') { depth--; if (!depth) { end = m.index + 6; break; } }
      else depth++;
    }
    if (end < 0) return null;
    return { before: body.slice(0, i), inner: body.slice(i, end), after: body.slice(end) };
  }

  /**
   * 一層 SVG 的內容 → 一串 Word 圖案，推進 ctx.shapes。
   * dx／dy／s 是「這一層的座標怎麼換算成最外層的座標」（巢狀 svg 會疊上去）。
   * 認不得的東西回 false，整張圖就不轉了——少畫一塊比不能編輯更糟。
   */
  function walkSvgShapes(body, dx, dy, s, ctx) {
    var clean = body.replace(/<defs>[\s\S]*?<\/defs>/g, '');
    var nest = splitNestedSvg(clean);
    if (nest) {
      if (!walkSvgShapes(nest.before, dx, dy, s, ctx)) return false;
      var open = /<svg\b[^>]*>/.exec(nest.inner);
      var a0 = svgAttrs(open[0]);
      var vb0 = String(a0.viewBox || '').trim().split(/\s+/).map(Number);
      var iw = svgNum(a0.width, NaN, 0), ih = svgNum(a0.height, NaN, 0);
      if (vb0.length !== 4 || !(vb0[2] > 0) || !(vb0[3] > 0) || !(iw > 0) || !(ih > 0)) return false;
      var sx = iw / vb0[2], sy = ih / vb0[3];
      /* 非等比縮放的巢狀圖我們自己不會產，也不猜 */
      if (Math.abs(sx - sy) > 0.001) return false;
      var body0 = nest.inner.replace(/<svg\b[^>]*>/, '').replace(/<\/svg>$/, '');
      var ok = walkSvgShapes(body0,
        dx + (svgNum(a0.x, 0, 0) - vb0[0] * sx) * s,
        dy + (svgNum(a0.y, 0, 0) - vb0[1] * sy) * s, s * sx, ctx);
      if (!ok) return false;
      return walkSvgShapes(nest.after, dx, dy, s, ctx);
    }

    /* 認不得的標籤（範本庫的 g、style、image…）就整張放棄，不要猜 */
    WORD_TAGS.lastIndex = 0;
    if (/<[a-zA-Z]/.test(clean.replace(WORD_TAGS, ''))) return false;

    var k = ctx.k, m;
    /* ox／oy 是「裁掉四周留白」的位移：第一趟先量出圖真正佔到哪裡，第二趟整個往左上推。 */
    var X = function (v) { return (dx + v * s) * k - ctx.ox; };
    var Y = function (v) { return (dy + v * s) * k - ctx.oy; };
    var L = function (v) { return v * s * k; };
    /* 每一個形狀都順手記進外框，量完才知道要裁多少、能放多大 */
    var box = function (x, y, w, h, fh, fv) {
      if (x < ctx.minX) ctx.minX = x;
      if (y < ctx.minY) ctx.minY = y;
      if (x + w > ctx.maxX) ctx.maxX = x + w;
      if (y + h > ctx.maxY) ctx.maxY = y + h;
      return xfrmXml(x, y, w, h, fh, fv);
    };
    WORD_TAGS.lastIndex = 0;
    while ((m = WORD_TAGS.exec(clean))) {
      var tag = m[1], a = svgAttrs(m[0].slice(tag.length + 1).replace(/\/?>$/, ''));
      var op = a.opacity == null ? 1 : svgNum(a.opacity, 1, 0);
      var fill = wordColor(a.fill), stroke = wordColor(a.stroke);
      if (tag !== 'text' && !fill && !stroke) continue;   /* 網點底之類的，畫不出來就別畫 */
      var ln = wordLine(a, s * k, op);

      if (tag === 'rect') {
        var rw = svgNum(a.width, 0, ctx.W), rh = svgNum(a.height, 0, ctx.H);
        if (!(rw > 0 && rh > 0)) continue;
        /* 滿版的底色與網點在 Word 裡是多餘的：使用者要的是圖本身，
           一塊跟頁面一樣大的方塊只會擋住底下的東西，還得先刪掉才能編輯 */
        if (rw >= ctx.W * 0.99 && rh >= ctx.H * 0.99) continue;
        var round = svgNum(a.rx, 0, 0);
        var geom = round > 0
          ? '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ' +
            Math.max(0, Math.min(50000, Math.round(round / (Math.min(rw, rh) / 2) * 50000))) +
            '"/></a:avLst></a:prstGeom>'
          : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
        ctx.shapes.push(wordWsp(ctx.id++, '方塊 ' + ctx.id,
          box(X(svgNum(a.x, 0, ctx.W)), Y(svgNum(a.y, 0, ctx.H)), L(rw), L(rh)),
          geom, wordFill(fill, op), ln));
        continue;
      }
      if (tag === 'circle') {
        var r = svgNum(a.r, 0, 0);
        if (!(r > 0)) continue;
        ctx.shapes.push(wordWsp(ctx.id++, '圓 ' + ctx.id,
          box(X(svgNum(a.cx, 0, ctx.W) - r), Y(svgNum(a.cy, 0, ctx.H) - r), L(2 * r), L(2 * r)),
          '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>', wordFill(fill, op), ln));
        continue;
      }
      if (tag === 'line') {
        var x1 = svgNum(a.x1, 0, ctx.W), y1 = svgNum(a.y1, 0, ctx.H);
        var x2 = svgNum(a.x2, 0, ctx.W), y2 = svgNum(a.y2, 0, ctx.H);
        ctx.shapes.push(wordWsp(ctx.id++, '線 ' + ctx.id,
          box(X(Math.min(x1, x2)), Y(Math.min(y1, y2)),
            L(Math.abs(x2 - x1)), L(Math.abs(y2 - y1)), x2 < x1, y2 < y1),
          '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>', '<a:noFill/>', ln));
        continue;
      }
      if (tag === 'polyline' || tag === 'polygon' || tag === 'path') {
        var subs;
        if (tag === 'path') {
          subs = parsePathD(a.d);
        } else {
          var pts = pointsList(a.points);
          if (!pts) continue;
          subs = [{ ops: pts.map(function (p, n2) { return { t: n2 ? 'l' : 'm', pts: [p] }; }),
            close: tag === 'polygon' }];
        }
        if (!subs) return false;          /* 看不懂的路徑就整張放棄，不要少畫一段 */
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        subs.forEach(function (sub) {
          sub.ops.forEach(function (o2) {
            o2.pts.forEach(function (p) {
              if (p[0] < minX) minX = p[0];
              if (p[0] > maxX) maxX = p[0];
              if (p[1] < minY) minY = p[1];
              if (p[1] > maxY) maxY = p[1];
            });
          });
        });
        if (!isFinite(minX)) continue;
        var cw = L(maxX - minX), ch = L(maxY - minY);
        ctx.shapes.push(wordWsp(ctx.id++, '線條 ' + ctx.id, box(X(minX), Y(minY), cw, ch),
          custGeomXml(subs, minX, minY, s * k, cw, ch), wordFill(fill, op), ln));
        continue;
      }

      /* text：SVG 的 y 是基線，Word 的文字方塊是一個框，換算一次。
         多行的標題是用 <tspan dy> 疊出來的，一行做一個文字方塊。 */
      var raw = String(m[2] == null ? '' : m[2]);
      var fs = svgNum(a['font-size'], 12, 0);
      var lines = [];
      if (raw.indexOf('<tspan') >= 0) {
        var tre = /<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g, tm, ty = svgNum(a.y, 0, ctx.H);
        while ((tm = tre.exec(raw))) {
          var ta = svgAttrs(tm[1]);
          ty += svgNum(ta.dy, 0, 0);
          lines.push({ x: svgNum(ta.x, svgNum(a.x, 0, ctx.W), ctx.W), y: ty, s: tm[2] });
        }
      } else {
        lines.push({ x: svgNum(a.x, 0, ctx.W), y: svgNum(a.y, 0, ctx.H), s: raw });
      }
      if (fs * s > ctx.maxFs) ctx.maxFs = fs * s;
      lines.forEach(function (line) {
        var str = line.s.replace(/<[^>]*>/g, '');
        if (!str) return;
        var spacing = /em$/.test(String(a['letter-spacing'] || '')) ? parseFloat(a['letter-spacing']) : 0;
        var em = textEm(unescapeXml(str)) * (1 + (spacing || 0));
        var boxW = (em + 1.2) * fs;
        var anchor = a['text-anchor'] || 'start';
        var left = anchor === 'middle' ? line.x - boxW / 2
          : (anchor === 'end' ? line.x - boxW + fs * 0.6 : line.x - fs * 0.6);
        var jc = anchor === 'middle' ? 'center' : (anchor === 'end' ? 'right' : 'left');
        var fams = String(a['font-family'] || '').split(',').map(function (f) {
          return f.trim().replace(/^['"]|['"]$/g, '');
        }).filter(Boolean);
        var ascii = '', east = '';
        fams.forEach(function (f) {
          if (/^[\x20-\x7e]+$/.test(f)) { if (!ascii) ascii = f; } else if (!east) east = f;
        });
        if (!ascii) ascii = east || 'serif';
        if (!east) east = ascii;
        var col = wordColor(a.fill) || { hex: '000000', alpha: 1 };
        /* px → 半點（96dpi）。字級之間的大小關係要留著（主文大、圖例小），
           所以不逐段設下限，而是整張圖一起放大到「最大的那一段剛好 MIN_PT」。 */
        var sz = Math.max(2, Math.round(fs * s * ctx.scale * 1.5));
        var rpr = '<w:rPr><w:rFonts w:ascii="' + escapeXml(ascii) + '" w:hAnsi="' + escapeXml(ascii) +
          '" w:eastAsia="' + escapeXml(east) + '" w:cs="' + escapeXml(ascii) + '"/>' +
          (svgNum(a['font-weight'], 400, 0) >= 600 ? '<w:b/><w:bCs/>' : '') +
          '<w:color w:val="' + col.hex + '"/>' +
          (spacing ? '<w:spacing w:val="' + Math.round(spacing * fs * s * ctx.scale * 15) + '"/>' : '') +
          '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
        var para = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' +
          '<w:jc w:val="' + jc + '"/>' + rpr + '</w:pPr>' +
          '<w:r>' + rpr + '<w:t xml:space="preserve">' + str + '</w:t></w:r></w:p>';
        ctx.shapes.push(wordWsp(ctx.id++, '文字 ' + ctx.id,
          box(X(left), Y(line.y - fs * 1.15), L(boxW), L(fs * 1.6)),
          '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', '<a:noFill/>', '<a:ln><a:noFill/></a:ln>',
          '<wps:txbx><w:txbxContent>' + para + '</w:txbxContent></wps:txbx>',
          /* spAutoFit：使用者在 Word 裡把字放大時，方塊要跟著長大。
             noAutofit 的話字會被原本的框裁掉，看起來像字不見了。 */
          '<wps:bodyPr rot="0" vert="horz" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" ' +
          'anchor="ctr" anchorCtr="0"><a:spAutoFit/></wps:bodyPr>'));
      });
    }
    return true;
  }

  /**
   * SVG → Word 圖案群組（`<w:drawing>` 整段）。認不得就回 null。
   *   o.scale  SVG 單位 → 頁面 px 的縮放（跟圖片版用的是同一個）
   *   o.title  群組名稱，也是替代文字
   */
  function svgToWordGroup(svg, o) {
    var opt = o || {};
    var src = String(svg == null ? '' : svg);
    var open = /<svg\b[^>]*>/.exec(src);
    if (!open) return null;
    var vb = /viewBox="([-\d.\s]+)"/.exec(open[0]);
    if (!vb) return null;
    var box = vb[1].trim().split(/\s+/).map(Number);
    if (box.length !== 4 || box[0] !== 0 || box[1] !== 0 || !(box[2] > 0) || !(box[3] > 0)) return null;

    var body = src.slice(open.index + open[0].length).replace(/<\/svg>\s*$/, '');

    /* 兩趟：第一趟只為了量「圖真正佔到哪裡」，第二趟才照裁切後的大小重排。
       不裁的話一張只用到半個畫布的家系圖，會連著大片空白一起縮進頁面裡，字就更小了。 */
    function pass(scale, ox, oy) {
      var c = { shapes: [], id: 2, k: scale * EMU, scale: scale, W: box[2], H: box[3],
        ox: ox || 0, oy: oy || 0, maxFs: 0,
        minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      return walkSvgShapes(body, 0, 0, 1, c) && c.shapes.length ? c : null;
    }

    var probe = pass(1, 0, 0);
    if (!probe) return null;
    var wUnits = (probe.maxX - probe.minX) / EMU + WORD_PAD * 2;
    var hUnits = (probe.maxY - probe.minY) / EMU + WORD_PAD * 2;
    if (!(wUnits > 0 && hUnits > 0)) return null;

    /* 整張一起放大到「最大的那一段字剛好 MIN_PT」。字級之間的大小關係就留著了，
       而且形狀跟著等比長大——只把字放大的話，字會滿出自己的方塊。 */
    var natural = probe.maxFs * 0.75;   /* px@96dpi → pt */
    var scale = opt.scale ||
      Math.max(1, Math.min(WORD_MAX_SCALE, natural > 0 ? MIN_PT / natural : 1));
    var ctx = pass(scale, probe.minX * scale - WORD_PAD * scale * EMU,
      probe.minY * scale - WORD_PAD * scale * EMU);
    if (!ctx) return null;

    var cx = Math.round(wUnits * scale * EMU), cy = Math.round(hUnits * scale * EMU);
    var name = escapeXml(String(opt.title || '圖'));
    return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="1" name="' + name + '" descr="' + name + '"/>' +
      '<wp:cNvGraphicFramePr/>' +
      '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
      '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>' +
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '</wpg:grpSpPr>' + ctx.shapes.join('') + '</wpg:wgp>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }


  /**
   * 組一份 .docx。
   *   opts.svg    整份 SVG 字串（已經含標題與來源標註）
   *   opts.png    Uint8Array，給看不懂 SVG 的 Word 當後備
   *   opts.w／h   圖的原始寬高（px），用來換算 Word 裡的顯示尺寸
   *   opts.title  文件標題，也是圖片的替代文字
   *   opts.credit false＝這張圖不是從上游範本來的，不要掛那個來源標註
   * 回傳 Uint8Array。
   */
  function buildDocx(opts) {
    var o = opts || {};
    var title = String(o.title || '圖表');
    var w = Math.max(1, o.w || 1000), h = Math.max(1, o.h || 600);
    /* A4 直向、預設邊界之下可用寬度約 16.6 公分＝約 628 px */
    var pageW = 628;
    var scale = Math.min(1, pageW / w);
    var cx = Math.round(w * scale * EMU), cy = Math.round(h * scale * EMU);

    /* 先試著整張換成 Word 自己的圖案（打開就能改字）。
       範本庫那種任意 SVG 換不了，才退回「圖片＋SVG」那條老路。 */
    /* 不傳 scale：換成圖案時由 svgToWordGroup() 自己決定要放多大（字要看得見），
       頁面再配合它。scale 只有「換不成、退回圖片」那條路才用得到。 */
    var groupXml = svgToWordGroup(o.svg, { title: title });
    var groupExt = groupXml && /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(groupXml);
    var group = groupXml ? { xml: groupXml, w: +groupExt[1], h: +groupExt[2] } : null;
    var picture = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:docPr id="1" name="' + escapeXml(title) + '" descr="' + escapeXml(title) + '"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="' + escapeXml(title) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId1"><a:extLst>' +
      '<a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">' +
      '<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId2"/>' +
      '</a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';

    /* 一打開就講得出這張圖能怎麼動——不然沒人知道 */
    /* 換得成圖案時，檔案裡就只有那張圖：沒有標題、沒有說明、沒有底色。
       使用者要的是「一份可以直接編輯的圖」，多一行字就得先刪掉才能用。
       換不成的（範本庫那種）才留一句話，不然使用者不知道那張圖怎麼改。 */
    var note = group ? '' :
      '要修改圖上的方塊或文字：在圖片上按右鍵 →「轉換成圖形」（Word 2016 以上）。' +
      '註：Word 轉換時可能會把圖上的文字轉丟，那時候請改用 SVG 或 PNG。';

    /* 版面配合圖，不是圖配合版面：頁面就開成「圖的大小＋左右各 1 公分」。
       硬塞進 A4 的話，圖只能縮到字剩 6pt。 */
    var pgW = 11906, pgH = 16838, pgMar = 1134;
    if (group && group.w && group.h) {
      pgMar = 567;                                  /* 1 公分 */
      pgW = Math.round(group.w / EMU * 15) + pgMar * 2;   /* px → twip（1px = 15 twip） */
      pgH = Math.round(group.h / EMU * 15) + pgMar * 2;
    }

    var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
      'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ' +
      'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<w:body>' +
      ((group && group.xml) || picture) +
      (note ? '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr>' +
        '<w:rFonts w:ascii="DFKai-SB" w:eastAsia="標楷體" w:hAnsi="DFKai-SB"/>' +
        '<w:sz w:val="18"/><w:color w:val="7F7F7F"/></w:rPr>' +
        '<w:t xml:space="preserve">' + escapeXml(note) + '</w:t></w:r></w:p>' : '') +
      (o.credit === false ? '' :
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr>' +
        '<w:rFonts w:ascii="DFKai-SB" w:eastAsia="標楷體" w:hAnsi="DFKai-SB"/>' +
        '<w:sz w:val="16"/><w:color w:val="A6A6A6"/></w:rPr>' +
        '<w:t xml:space="preserve">' + escapeXml(SOURCE.credit) + '</w:t></w:r></w:p>') +
      '<w:sectPr><w:pgSz w:w="' + pgW + '" w:h="' + pgH + '"' +
      (pgW > pgH ? ' w:orient="landscape"' : '') + '/>' +
      '<w:pgMar w:top="' + pgMar + '" w:right="' + pgMar + '" w:bottom="' + pgMar +
      '" w:left="' + pgMar + '" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';

    /* 換成圖案時就沒有圖片了；關聯裡留著指不到的檔案，Word 會說檔案毀損 */
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      (group ? '' :
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.svg"/>') +
      '</Relationships>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="svg" ContentType="image/svg+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';

    var png = o.png && o.png.length ? o.png : new Uint8Array(0);
    var parts = [
      { name: '[Content_Types].xml', bytes: utf8Bytes(contentTypes) },
      { name: '_rels/.rels', bytes: utf8Bytes(rootRels) },
      { name: 'word/document.xml', bytes: utf8Bytes(docXml) },
      { name: 'word/_rels/document.xml.rels', bytes: utf8Bytes(rels) }
    ];
    if (!group) {
      parts.push({ name: 'word/media/image1.png', bytes: png });
      parts.push({ name: 'word/media/image1.svg', bytes: utf8Bytes(svgFile(String(o.svg || ''))) });
    }
    return zipStore(parts);
  }

  /** 組一份自足的 HTML：零外部請求，用瀏覽器列印就能出 PDF。 */
  function buildStandaloneHtml(opts) {
    var o = opts || {};
    var colors = o.colors || UPSTREAM_LIGHT;
    var name = escapeXml(o.heading || o.title || '圖表');
    return '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + name + '</title>\n' +
      (o.credit === false ? '<!-- 本檔零外部請求，可離線開啟。 -->\n'
        : '<!-- 圖表範本來源：' + SOURCE.url + '（' + SOURCE.license + ' License, ' + SOURCE.author + '）\n' +
          '     由「公務用圖表範本庫」改字產出。本檔零外部請求，可離線開啟。 -->\n') +
      '<style>\n' +
      '  html,body{margin:0;padding:0;background:' + colors.paper + ';color:' + colors.ink + ';}\n' +
      '  body{font-family:' + FONTS.sans.replace(/'/g, '"') + ';padding:24px;}\n' +
      '  .sheet{max-width:1200px;margin:0 auto;}\n' +
      '  .sheet > svg{width:100%;height:auto;display:block;}\n' +
      '  @media print{body{padding:0;}}\n' +
      '</style>\n</head>\n<body>\n<div class="sheet">\n' + String(o.svg || '') + '\n</div>\n</body>\n</html>\n';
  }

  /** 下載用的檔名：中文標題直接留著，只把檔案系統不收的字換掉。 */
  function safeFilename(name, ext) {
    var base = String(name == null ? '' : name).trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 60)
      .trim();
    return (base || '圖表') + '.' + ext;
  }


  /** 是↔否、Y↔N 這種成對的標籤，用來自動標往下走的那一條線。 */
  var FLOW_OPPOSITE = { '是': '否', '否': '是', 'Y': 'N', 'N': 'Y', '有': '無', '無': '有',
    '通過': '不通過', '不通過': '通過', '同意': '不同意', '不同意': '同意' };

  function flowOpposite(label) {
    return Object.prototype.hasOwnProperty.call(FLOW_OPPOSITE, label) ? FLOW_OPPOSITE[label] : '';
  }

  /** 把「主文 / 副標」切開。斜線、直線、全形的都收。 */
  function splitFlowText(text) {
    var m = String(text).split(/\s*[/／|｜]\s*/);
    return { main: (m[0] || '').trim(), sub: (m[1] || '').trim() };
  }

  var FLOW = {
    W: 1000, cx: 500, top: 44, gap: 44,
    boxW: 220, ovalW: 200, diaW: 210, diaH: 104,
    sideX: 700, sideW: 200, sideH: 52, sideGap: 30,
    loopX: 150,
    fs: 13, fsSub: 9.5, fsLabel: 9.5, lineH: 17
  };

  function flowNodeWidth(n) {
    if (n.kind === 'start' || n.kind === 'end') return FLOW.ovalW;
    if (n.kind === 'decision') return FLOW.diaW;
    if (n.kind === 'branch') return FLOW.sideW;
    return FLOW.boxW;
  }

  /** 依框寬把主文折行，回傳 {lines, w, h}。中文比英文寬，折行用估寬的那一套。 */
  function flowNodeBox(n) {
    var w = flowNodeWidth(n);
    var inner = n.kind === 'decision' ? w * 0.62 : w - 30;
    var lines = wrapLabel(n.main, inner / FLOW.fs);
    if (!lines.length) lines = [''];
    var h;
    if (n.kind === 'decision') {
      h = Math.max(FLOW.diaH, 58 + lines.length * FLOW.lineH);
    } else {
      h = Math.max(50, 26 + lines.length * FLOW.lineH + (n.sub ? 14 : 0));
    }
    return { w: w, h: h, lines: lines };
  }

  /**
   * 算出每個節點的位置與大小。分開算是為了測得到——版面錯了要看得出來是哪一格。
   *
   * 兩欄：主線在中間（col 'main'），判斷拉出去的分支步驟在右邊（col 'side'）。
   * 分支可以連走好幾步再匯回主線——真實的公文流程幾乎都是這樣，
   * 「分岔出去只有一格」是畫不出來的。
   *
   * 匯回點就是分支步驟之後的第一個主線節點；主線會讓到分支底下再放那一格，
   * 匯回線才有地方走。分支勾了「不回主線」就不畫匯回線，最後一格畫成圓角收尾。
   */
  function layoutFlow(nodes) {
    var mainY = FLOW.top;
    var sideY = null;          /* 目前這條分支下一格要放的 y；null＝現在沒有分支在跑 */
    var ownerIdx = null;       /* 這條分支屬於哪一個判斷 */
    var armedIdx = null;       /* 最近一個判斷，還沒長出分支 */
    var items = [];

    nodes.forEach(function (n) {
      var b = flowNodeBox(n);
      if (n.kind === 'branch' && (sideY != null || armedIdx != null)) {
        if (sideY == null) {
          /* 這條分支的第一格：跟判斷同高，橫線才拉得平 */
          ownerIdx = armedIdx;
          armedIdx = null;
          sideY = items[ownerIdx].cy - b.h / 2;
        }
        var side = {
          n: n, col: 'side', owner: ownerIdx, w: b.w, h: b.h, lines: b.lines,
          top: sideY, bottom: sideY + b.h, cy: sideY + b.h / 2, cx: FLOW.sideX + FLOW.sideW / 2
        };
        items.push(side);
        sideY = side.bottom + FLOW.sideGap;
        return;
      }

      /* 主線。分支還在跑的話，先讓到它底下——匯回線要有地方走 */
      if (sideY != null) {
        mainY = Math.max(mainY, sideY);
        sideY = null;
        ownerIdx = null;
      }
      var item = {
        n: n, col: 'main', owner: null, w: b.w, h: b.h, lines: b.lines,
        top: mainY, bottom: mainY + b.h, cy: mainY + b.h / 2, cx: FLOW.cx
      };
      items.push(item);
      mainY = item.bottom + FLOW.gap;
      if (n.kind === 'decision') armedIdx = items.length - 1;
      else armedIdx = null;
    });

    var bottom = FLOW.top;
    items.forEach(function (it) { if (it.bottom > bottom) bottom = it.bottom; });
    return { items: items, height: bottom + 96 };
  }

  /** 主線上的第 k 個節點是誰（索引）。分支步驟不算在主線上。 */
  function flowMainIndexes(items) {
    var out = [];
    items.forEach(function (it, i) { if (it.col === 'main') out.push(i); });
    return out;
  }

  function flowTextLines(lines, cx, cy, count, fs, fill, weight) {
    var startY = cy - (count - 1) * FLOW.lineH / 2 + fs * 0.35;
    return lines.map(function (ln, i) {
      return '<text x="' + cx + '" y="' + round1(startY + i * FLOW.lineH) + '" fill="' + fill +
        '" font-size="' + fs + '" font-family="' + FONTS.sans + '" font-weight="' + weight +
        '" text-anchor="middle">' + escapeXml(ln) + '</text>';
    }).join('');
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  /** 線上的小標籤：底下墊一塊紙色，不然會跟線疊在一起看不清楚。 */
  function flowLabel(x, y, text) {
    if (!text) return '';
    var w = Math.max(18, textUnits(text) * FLOW.fsLabel + 10);
    return '<rect x="' + round1(x - w / 2) + '" y="' + round1(y - 7) + '" width="' + round1(w) +
      '" height="12" rx="2" fill="' + UPSTREAM_LIGHT.paper + '"/>' +
      '<text x="' + x + '" y="' + round1(y + 2.5) + '" fill="' + UPSTREAM_LIGHT.muted +
      '" font-size="' + FLOW.fsLabel + '" font-family="' + FONTS.mono +
      '" text-anchor="middle" letter-spacing="0.1em">' + escapeXml(text) + '</text>';
  }

  function flowShape(item, accent, pill) {
    var n = item.n, cx = item.cx == null ? FLOW.cx : item.cx, cy = item.cy, w = item.w, h = item.h;
    var ink = UPSTREAM_LIGHT.ink, ac = UPSTREAM_LIGHT.accent;
    var stroke = accent ? ac : ink;
    var fill = accent ? 'rgba(235,108,54,0.08)' : '#ffffff';
    /* 分支步驟：淡一點的框，一眼看得出它不在主線上 */
    if (n.kind === 'branch') {
      return '<rect x="' + round1(cx - w / 2) + '" y="' + round1(item.top) + '" width="' + w +
        '" height="' + round1(h) + '" rx="' + (pill ? round1(h / 2) : 6) +
        '" fill="rgba(45,49,66,0.03)" stroke="rgba(45,49,66,0.30)" stroke-width="1"/>';
    }
    if (n.kind === 'start' || n.kind === 'end') {
      fill = accent ? 'rgba(235,108,54,0.08)' : 'rgba(45,49,66,0.03)';
      return '<rect x="' + round1(cx - w / 2) + '" y="' + round1(item.top) + '" width="' + w +
        '" height="' + round1(h) + '" rx="' + round1(h / 2) + '" fill="' + fill +
        '" stroke="' + (accent ? ac : 'rgba(45,49,66,0.30)') + '" stroke-width="1"/>';
    }
    if (n.kind === 'decision') {
      return '<polygon points="' + cx + ',' + round1(item.top) + ' ' + round1(cx + w / 2) + ',' + round1(cy) +
        ' ' + cx + ',' + round1(item.bottom) + ' ' + round1(cx - w / 2) + ',' + round1(cy) +
        '" fill="#ffffff" stroke="' + ink + '" stroke-width="1"/>';
    }
    return '<rect x="' + round1(cx - w / 2) + '" y="' + round1(item.top) + '" width="' + w +
      '" height="' + round1(h) + '" rx="6" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>';
  }

  /**
   * 把節點畫成一張自足的 SVG。
   * 顏色一律用上游那四個色票的字面值，換配色與換字體那兩條路才吃得到它。
   *
   * 畫的順序是「先線後框」——線才不會蓋在框上面。
   */
  function renderFlowSvg(parsed, opts) {
    var o = opts || {};
    var nodes = (parsed && parsed.nodes) || [];
    var lay = layoutFlow(nodes);
    var items = lay.items;
    var ink = UPSTREAM_LIGHT.ink, muted = UPSTREAM_LIGHT.muted, ac = UPSTREAM_LIGHT.accent;
    var H = lay.height;
    var parts = [];

    parts.push('<svg viewBox="0 0 ' + FLOW.W + ' ' + Math.round(H) + '" xmlns="http://www.w3.org/2000/svg" ' +
      'role="img" aria-label="' + escapeXml(o.title || '流程圖') + '">');
    parts.push('<defs>' +
      '<pattern id="ddflow-dots" width="22" height="22" patternUnits="userSpaceOnUse">' +
      '<circle cx="1" cy="1" r="0.9" fill="rgba(45,49,66,0.10)"/></pattern>' +
      '<marker id="ddflow-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">' +
      '<polygon points="0 0, 8 3, 0 6" fill="' + muted + '"/></marker>' +
      '<marker id="ddflow-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">' +
      '<polygon points="0 0, 8 3, 0 6" fill="' + ac + '"/></marker>' +
      '</defs>');
    parts.push('<rect width="100%" height="100%" fill="' + UPSTREAM_LIGHT.paper + '"/>');
    parts.push('<rect width="100%" height="100%" fill="url(#ddflow-dots)" opacity="0.55"/>');

    if (!items.length) {
      parts.push('<text x="' + FLOW.cx + '" y="' + Math.round(H / 2) + '" fill="' + muted +
        '" font-size="14" font-family="' + FONTS.sans + '" text-anchor="middle">' +
        '在左邊加幾個步驟，這裡就會出現流程圖</text></svg>');
      return parts.join('');
    }

    var mains = flowMainIndexes(items);
    var lastMain = mains.length ? mains[mains.length - 1] : -1;
    var hasSide = items.some(function (it) { return it.col === 'side'; });

    /* ── 線 ─────────────────────────────────────────────────────────
       主線一格接一格；分支從判斷拉出去、自己往下接，接完再匯回主線。 */
    mains.forEach(function (idx, k) {
      var item = items[idx];
      var nextIdx = mains[k + 1];
      if (nextIdx == null) return;
      var next = items[nextIdx];
      var last = k === mains.length - 2 && next.n.kind === 'end';
      parts.push('<line x1="' + FLOW.cx + '" y1="' + round1(item.bottom) + '" x2="' + FLOW.cx +
        '" y2="' + round1(next.top - 2) + '" stroke="' + (last ? ac : muted) +
        '" stroke-width="' + (last ? 1.4 : 1.2) + '" marker-end="url(#ddflow-arrow' +
        (last ? '-accent' : '') + ')"/>');
      /* 判斷往下走的那條線：使用者自己標，沒標就用往右那條的相反詞 */
      if (item.n.kind === 'decision') {
        var down = item.n.downLabel ||
          flowOpposite((item.n.branch && item.n.branch.label) || (item.n.loop && item.n.loop.label) || '');
        if (down) parts.push(flowLabel(FLOW.cx, (item.bottom + next.top) / 2, down));
      }
    });

    /* 分支：判斷 → 第一格，格與格之間，最後一格 → 匯回主線 */
    items.forEach(function (it, i) {
      if (it.col !== 'side') return;
      var owner = items[it.owner];
      var prev = items[i - 1];
      if (prev && prev.col === 'side' && prev.owner === it.owner) {
        parts.push('<line x1="' + it.cx + '" y1="' + round1(prev.bottom) + '" x2="' + it.cx +
          '" y2="' + round1(it.top - 2) + '" stroke="' + muted +
          '" stroke-width="1.2" marker-end="url(#ddflow-arrow)"/>');
      } else if (owner) {
        parts.push('<line x1="' + round1(FLOW.cx + owner.w / 2) + '" y1="' + round1(it.cy) +
          '" x2="' + (FLOW.sideX - 2) + '" y2="' + round1(it.cy) + '" stroke="' + muted +
          '" stroke-width="1.2" marker-end="url(#ddflow-arrow)"/>');
        parts.push(flowLabel((FLOW.cx + owner.w / 2 + FLOW.sideX) / 2, it.cy - 8,
          (owner.n.branch && owner.n.branch.label) || ''));
      }

      /* 這一格是不是這條分支的最後一格？是的話畫匯回線 */
      var next = items[i + 1];
      var isLast = !(next && next.col === 'side' && next.owner === it.owner);
      if (!isLast) return;
      if (owner && owner.n.branchEnds) return;
      /* 匯回點＝分支之後的第一個主線節點 */
      var target = null;
      for (var j = i + 1; j < items.length; j++) {
        if (items[j].col === 'main') { target = items[j]; break; }
      }
      if (!target) return;
      var jy = round1(target.top - 16);
      parts.push('<path d="M ' + it.cx + ' ' + round1(it.bottom) + ' V ' + jy +
        ' H ' + FLOW.cx + '" fill="none" stroke="' + muted + '" stroke-width="1.2"/>');
      parts.push('<circle cx="' + FLOW.cx + '" cy="' + jy + '" r="2.6" fill="' + muted + '"/>');
    });

    /* 退回線：從判斷的左邊繞出去，接回前面某一步 */
    items.forEach(function (item) {
      if (!item.n.loop || item.n.loop.index == null) return;
      var target = items[item.n.loop.index];
      if (!target) return;
      var x0 = round1(item.cx - item.w / 2);
      var x1 = FLOW.loopX;
      var ty = round1(target.cy);
      parts.push('<path d="M ' + x0 + ' ' + round1(item.cy) + ' H ' + x1 + ' V ' + ty +
        ' H ' + round1(target.cx - target.w / 2 - 2) + '" fill="none" stroke="' + muted +
        '" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#ddflow-arrow)"/>');
      parts.push(flowLabel(x1, (item.cy + ty) / 2, item.n.loop.label));
    });

    /* ── 方塊與文字 ─────────────────────────────────────────────────── */
    items.forEach(function (item, i) {
      var n = item.n;
      var accent = n.kind === 'end' && i === lastMain;
      /* 分支勾了「不回主線」時，最後一格畫成圓角收尾——不然看起來像沒畫完 */
      var pill = false;
      if (item.col === 'side') {
        var owner = items[item.owner];
        var next = items[i + 1];
        pill = !!(owner && owner.n.branchEnds) && !(next && next.col === 'side' && next.owner === item.owner);
      }
      parts.push(flowShape(item, accent, pill));
      var textCy = n.sub ? item.cy - 7 : item.cy;
      parts.push(flowTextLines(item.lines, item.cx, textCy, item.lines.length,
        n.kind === 'decision' ? 12 : FLOW.fs, ink, '600'));
      if (n.sub) {
        parts.push('<text x="' + item.cx + '" y="' +
          round1(item.cy + (item.lines.length - 1) * FLOW.lineH / 2 + 16) +
          '" fill="' + muted + '" font-size="' + FLOW.fsSub + '" font-family="' + FONTS.mono +
          '" text-anchor="middle">' + escapeXml(n.sub) + '</text>');
      }
    });

    /* 圖例：跟範本庫同一套，讓自己做的圖跟挑來的圖看起來是一家人 */
    var ly = H - 58;
    parts.push('<line x1="40" y1="' + round1(ly) + '" x2="960" y2="' + round1(ly) +
      '" stroke="rgba(45,49,66,0.10)" stroke-width="0.8"/>');
    parts.push('<text x="40" y="' + round1(ly + 16) + '" fill="' + muted + '" font-size="8" font-family="' +
      FONTS.mono + '" letter-spacing="0.18em">圖例 · 形狀代表類型</text>');
    var legend = [['起訖（橢圓）', 24], ['步驟（矩形）', 6], ['判斷（菱形）', -1]];
    if (hasSide) legend.push(['分支步驟', 6]);
    if (items.some(function (it) { return it.n.loop; })) legend.push(['退回', -2]);
    var lx = 40;
    legend.forEach(function (it) {
      var name = it[0], rx = it[1];
      if (rx === -1) {
        parts.push('<polygon points="' + (lx + 12) + ',' + round1(ly + 26) + ' ' + (lx + 24) + ',' +
          round1(ly + 32) + ' ' + (lx + 12) + ',' + round1(ly + 38) + ' ' + lx + ',' + round1(ly + 32) +
          '" fill="#ffffff" stroke="' + ink + '" stroke-width="1"/>');
      } else if (rx === -2) {
        parts.push('<line x1="' + lx + '" y1="' + round1(ly + 32) + '" x2="' + (lx + 24) + '" y2="' +
          round1(ly + 32) + '" stroke="' + muted + '" stroke-width="1.2" stroke-dasharray="4 3"/>');
      } else {
        parts.push('<rect x="' + lx + '" y="' + round1(ly + 26) + '" width="24" height="12" rx="' + rx +
          '" fill="rgba(45,49,66,0.03)" stroke="rgba(45,49,66,0.30)" stroke-width="1"/>');
      }
      parts.push('<text x="' + (lx + 32) + '" y="' + round1(ly + 36) + '" fill="' + muted +
        '" font-size="8.5" font-family="' + FONTS.sans + '">' + escapeXml(name) + '</text>');
      lx += 32 + textUnits(name) * 8.5 + 34;
    });

    parts.push('</svg>');
    return parts.join('');
  }


  /* ── 清單篩選 ────────────────────────────────────────────────────── */

  /**
   * 從上游檔名切出類型與變體：
   *   example-high-level-vertical-dark → high-level-vertical / dark
   * 比對時長的類型名要排在前面，不然 high-level 會先吃掉 high-level-vertical。
   */
  function parseAssetName(filename) {
    var base = String(filename).replace(/\.html$/i, '');
    if (/^template/.test(base)) {
      return { type: 'template', variant: base.replace(/^template-?/, '') };
    }
    var rest = base.replace(/^example-/, '');
    var known = Object.keys(TYPE_META).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < known.length; i++) {
      var t = known[i];
      if (rest === t) return { type: t, variant: '' };
      if (rest.indexOf(t + '-') === 0) return { type: t, variant: rest.slice(t.length + 1) };
    }
    return { type: rest, variant: '' };
  }

  function typeLabel(type) {
    var m = TYPE_META[type];
    return m ? m.zh : type;
  }

  function variantLabel(variant) {
    var v = variant || '';
    return VARIANT_ZH[v] != null ? VARIANT_ZH[v] : v;
  }

  /** 首頁的搜尋與篩選。q 同時比對中文名、英文類型、標題與用途說明。 */
  function filterDiagrams(list, query) {
    var q = query || {};
    var kw = String(q.q || '').trim().toLowerCase();
    return (list || []).filter(function (d) {
      if (q.type && d.type !== q.type) return false;
      if (q.theme === 'light' && d.dark) return false;
      if (q.theme === 'dark' && !d.dark) return false;
      if (q.common && COMMON_TYPES.indexOf(d.type) < 0) return false;
      if (q.zhOnly && d.zhKind !== 'sample') return false;
      if (!kw) return true;
      var hay = [d.type, d.typeZh, d.title, d.heading, d.eyebrow, d.use, d.variantZh]
        .join(' ').toLowerCase();
      return hay.indexOf(kw) >= 0;
    });
  }

  return {
    SOURCE: SOURCE, FONTS: FONTS, PALETTES: PALETTES, TYPE_META: TYPE_META,
    COMMON_TYPES: COMMON_TYPES, STARTERS: STARTERS, VARIANT_ZH: VARIANT_ZH,
    UPSTREAM_LIGHT: UPSTREAM_LIGHT, UPSTREAM_DARK: UPSTREAM_DARK,
    escapeXml: escapeXml, normalizeHex: normalizeHex, hexToRgb: hexToRgb,
    extractSvg: extractSvg, extractDocument: extractDocument,
    GLOSSARY: GLOSSARY,
    stripNonVisual: stripNonVisual, normalizeSegment: normalizeSegment,
    extractTextSegments: extractTextSegments, glossaryLookup: glossaryLookup,
    translateSegments: translateSegments, hasTranslation: hasTranslation,
    FONT_CHOICES: FONT_CHOICES, fontChoiceById: fontChoiceById, forceFontFamily: forceFontFamily,
    splitPastedColumn: splitPastedColumn,
    PROJECT_VERSION: PROJECT_VERSION, buildProjectFile: buildProjectFile, parseProjectFile: parseProjectFile,
    mapFontValue: mapFontValue, mapFonts: mapFonts, stripComments: stripComments,
    splitRules: splitRules, scopeCss: scopeCss, prefixKeyframes: prefixKeyframes,
    inlineCssIntoSvg: inlineCssIntoSvg,
    recolor: recolor, applyPalette: applyPalette, fixDarkBackdrop: fixDarkBackdrop,
    paletteById: paletteById, resolveColors: resolveColors,
    parseViewBox: parseViewBox, textUnits: textUnits, wrapLabel: wrapLabel, shrinkToFit: shrinkToFit,
    setSvgAttrs: setSvgAttrs, composeExportSvg: composeExportSvg, svgFile: svgFile,
    buildStandaloneHtml: buildStandaloneHtml, safeFilename: safeFilename,
    crc32: crc32, zipStore: zipStore, buildDocx: buildDocx, svgToWordGroup: svgToWordGroup, wordShapesOk: wordShapesOk,
    FLOW: FLOW,
    splitFlowText: splitFlowText, flowOpposite: flowOpposite,
    layoutFlow: layoutFlow, flowMainIndexes: flowMainIndexes, renderFlowSvg: renderFlowSvg,
    parseAssetName: parseAssetName, typeLabel: typeLabel, variantLabel: variantLabel,
    filterDiagrams: filterDiagrams
  };
});
