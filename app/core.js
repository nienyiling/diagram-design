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

  /* 公務最常用的一批，首頁預設先給這些 */
  var COMMON_TYPES = ['flowchart', 'org-chart', 'gantt', 'timeline', 'swimlane', 'process',
    'state', 'layers', 'tree', 'quadrant', 'pyramid', 'venn', 'bar', 'line', 'journey', 'kanban'];

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

  /** 組一份自足的 HTML：零外部請求，用瀏覽器列印就能出 PDF。 */
  function buildStandaloneHtml(opts) {
    var o = opts || {};
    var colors = o.colors || UPSTREAM_LIGHT;
    var name = escapeXml(o.heading || o.title || '圖表');
    return '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + name + '</title>\n' +
      '<!-- 圖表範本來源：' + SOURCE.url + '（' + SOURCE.license + ' License, ' + SOURCE.author + '）\n' +
      '     由「公務用圖表範本庫」改字產出。本檔零外部請求，可離線開啟。 -->\n' +
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
    COMMON_TYPES: COMMON_TYPES, VARIANT_ZH: VARIANT_ZH,
    UPSTREAM_LIGHT: UPSTREAM_LIGHT, UPSTREAM_DARK: UPSTREAM_DARK,
    escapeXml: escapeXml, normalizeHex: normalizeHex, hexToRgb: hexToRgb,
    extractSvg: extractSvg, extractDocument: extractDocument,
    GLOSSARY: GLOSSARY,
    stripNonVisual: stripNonVisual, normalizeSegment: normalizeSegment,
    extractTextSegments: extractTextSegments, glossaryLookup: glossaryLookup,
    translateSegments: translateSegments, hasTranslation: hasTranslation,
    mapFontValue: mapFontValue, mapFonts: mapFonts, stripComments: stripComments,
    splitRules: splitRules, scopeCss: scopeCss, prefixKeyframes: prefixKeyframes,
    inlineCssIntoSvg: inlineCssIntoSvg,
    recolor: recolor, applyPalette: applyPalette, fixDarkBackdrop: fixDarkBackdrop,
    paletteById: paletteById, resolveColors: resolveColors,
    parseViewBox: parseViewBox, textUnits: textUnits, wrapLabel: wrapLabel, shrinkToFit: shrinkToFit,
    setSvgAttrs: setSvgAttrs, composeExportSvg: composeExportSvg, svgFile: svgFile,
    buildStandaloneHtml: buildStandaloneHtml, safeFilename: safeFilename,
    parseAssetName: parseAssetName, typeLabel: typeLabel, variantLabel: variantLabel,
    filterDiagrams: filterDiagrams
  };
});
