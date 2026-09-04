/*
 * build-data.mjs — 把 vendor/upstream/ 的上游範例 HTML 轉成站上要吃的 data/diagrams.json。
 *
 * 上游那 154 份 HTML 各自是一份自足網頁：外連 Google Fonts、CSS 在 <head>、圖在 <body>。
 * 站上要的是「一張自己站得住的 SVG」——CSS 收進 svg 裡、字型換成本機字族、
 * 沒有任何對外請求。轉換規則全部寫在 app/core.js（純函式），這支只是搬檔案。
 *
 * 產出的 data/diagrams.json 會 commit 進 repo，部署時直接送上去，不在 CDN 上跑建置。
 * 但 commit 進去的東西會走鐘，所以 tests/data.mjs 會重跑一次這支並比對——
 * 對不起來就紅，逼人重跑 `npm run build`。
 *
 * 上游來源：https://github.com/cathrynlavery/diagram-design （MIT，Cathryn Lavery）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DD = require(path.join(ROOT, 'app', 'core.js'));

const UPSTREAM_DIR = path.join(ROOT, 'vendor', 'upstream');
const OUT = path.join(ROOT, 'data', 'diagrams.json');

/* 這幾份不是「一張圖」：icons 是圖示目錄、index 是上游自己的索引頁 */
const SKIP = new Set(['icons.html', 'index.html']);

/** 上游的 eyebrow 都是 "Flowchart · Diagram Design"，後半段對公務同仁沒有意義 */
function cleanEyebrow(s) {
  return String(s || '').replace(/\s*[·|]\s*Diagram Design\s*$/i, '').trim();
}

/* 公務情境的中文範例：人工寫的，一張圖一筆，內容依序號對應圖上的每一段文字。
   檔案不存在時整個站台照樣運作，只是少了「中文範例」那一層。 */
function readSamples() {
  const f = path.join(ROOT, 'content', 'zh-samples.json');
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
const samples = readSamples();

/** 深色版與完整版沿用標準版寫好的中文（版面一樣，文字也一樣）。 */
function stripVariant(id) {
  return String(id).replace(/-(dark|full)$/, '');
}

export function buildAll(dir = UPSTREAM_DIR) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.html') && !SKIP.has(f))
    .sort();

  const items = [];
  const problems = [];

  for (const file of files) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    const doc = DD.extractDocument(html);
    if (!doc.svg) { problems.push(`${file}：抽不到 <svg>`); continue; }

    const { type, variant } = DD.parseAssetName(file);
    const meta = DD.TYPE_META[type];
    if (!meta) problems.push(`${file}：類型 ${type} 在 core.js 的 TYPE_META 裡沒有中文名`);

    const id = file.replace(/\.html$/i, '');
    const rootClass = 'dd-' + id.replace(/[^a-z0-9-]/gi, '');

    /* CSS 收進 svg → 換字型 → 這張圖就自己站得住了 */
    let svg = DD.inlineCssIntoSvg(DD.stripComments(doc.svg), DD.scopeCss(doc.css, rootClass), rootClass);
    svg = DD.mapFonts(svg);

    if (/(?:Geist|Instrument Serif|Noto Sans KR|Noto Serif KR)/.test(svg)) {
      problems.push(`${file}：還留著上游的 webfont 字族名，換成中文會看不到字`);
    }

    if (/https?:\/\//.test(svg.replace(/xmlns[:a-z]*="[^"]*"/g, ''))) {
      problems.push(`${file}：SVG 裡還留著對外網址，零對外連線會破功`);
    }

    const box = DD.parseViewBox(svg);
    if (!box) problems.push(`${file}：SVG 沒有 viewBox，算不出版面`);

    const dark = /(^|-)dark$/.test(variant);
    if (dark) svg = DD.fixDarkBackdrop(svg);

    /* 中文層：骨架字典（全部 153 張都吃得到）＋ 人工寫的公務情境範例（少數幾張）。
       兩者都是「依序號對應」，所以長度一定要跟 segments 一樣，序號才不會錯位。 */
    const segments = DD.extractTextSegments(svg);
    let sample = samples[id] || null;
    if (sample && sample.texts.length !== segments.length) {
      /* 直接指名這張圖卻寫錯段數，是筆誤，要讓建置紅掉 */
      problems.push(`${file}：公務範例寫了 ${sample.texts.length} 段，圖上其實有 ${segments.length} 段，序號會錯位`);
    }
    if (!sample) {
      /* 深色版與完整版沿用標準版的中文，但完整版常常多畫幾個方塊，
         段數對不上就不套——寧可留原文，也不要整批錯位 */
      const base = samples[stripVariant(id)];
      if (base && base.texts.length === segments.length) sample = base;
    }
    const zh = DD.translateSegments(segments, sample && sample.texts);
    const hasZh = DD.hasTranslation(zh);

    items.push({
      id,
      type,
      typeZh: DD.typeLabel(type),
      use: meta ? meta.use : '',
      variant,
      variantZh: DD.variantLabel(variant),
      dark,
      title: doc.title,
      eyebrow: cleanEyebrow(doc.eyebrow),
      heading: doc.heading,
      desc: doc.desc,
      w: box ? box.w : 1000,
      h: box ? box.h : 600,
      /* <foreignObject> 在 <img> 裡不會畫出來，所以這幾張不能轉 PNG，畫面上要說清楚 */
      png: !/<foreignObject/i.test(svg),
      segs: segments.length,
      /* zhKind：sample＝整張都是公務情境的中文；gloss＝只換掉圖例那類骨架字 */
      zhKind: sample ? 'sample' : (hasZh ? 'gloss' : ''),
      zhCount: zh.filter((v) => v != null && v !== '').length,
      zhHeading: (sample && sample.heading) || '',
      zhEyebrow: (sample && sample.eyebrow) || DD.typeLabel(type),
      zh: hasZh ? zh : null,
      svg
    });
  }

  /* 排序照「使用者怎麼找」而不是照檔名：同一種圖擺在一起，
     標準版在最前面（大多數人要的是那個），深色版在最後。
     照檔名排的話 example-bar-dark 會排在 example-bar 前面（'-' 比 '.' 小），
     使用者第一眼看到的是深色版，很怪。 */
  const VARIANT_RANK = { '': 0, full: 1, dark: 2 };
  items.sort((a, b) =>
    a.typeZh.localeCompare(b.typeZh, 'zh-Hant')
    || (VARIANT_RANK[a.variant] ?? 3) - (VARIANT_RANK[b.variant] ?? 3)
    || a.id.localeCompare(b.id));

  return { items, problems, files };
}

export function serialize(built) {
  const types = {};
  for (const it of built.items) {
    if (!types[it.type]) types[it.type] = { type: it.type, zh: it.typeZh, use: it.use, count: 0 };
    types[it.type].count++;
  }
  return JSON.stringify({
    source: DD.SOURCE,
    upstream: readUpstreamMeta(),
    count: built.items.length,
    types: Object.values(types).sort((a, b) => a.zh.localeCompare(b.zh, 'zh-Hant')),
    diagrams: built.items
  });
}

function readUpstreamMeta() {
  const f = path.join(ROOT, 'vendor', 'upstream', 'SOURCE.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const built = buildAll();
  if (built.problems.length) {
    console.error('建置時發現問題：');
    built.problems.forEach((p) => console.error('  ✗ ' + p));
    process.exit(1);
  }
  const json = serialize(built);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);
  const types = new Set(built.items.map((i) => i.type));
  console.log(`寫出 ${path.relative(ROOT, OUT)}：${built.items.length} 張圖、${types.size} 種類型、` +
    `${(json.length / 1024 / 1024).toFixed(2)} MB`);
}
