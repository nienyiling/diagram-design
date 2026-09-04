/*
 * data.mjs — 檢查 data/diagrams.json 這份「建置產物」還跟 vendor/upstream/ 對得起來。
 *
 * 產物是 commit 進 repo 的（部署時直接送上 CDN，不在 CDN 上跑建置），
 * 所以它會走鐘：有人改了 core.js 的轉換規則卻忘了 `npm run build`，
 * 站上就會繼續用舊的 JSON，而所有純函式測試都是綠的。這支就是擋這件事。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { scoreboard } from './helpers.mjs';
import { buildAll, serialize } from '../scripts/build-data.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DD = require(path.join(ROOT, 'app', 'core.js'));

const s = scoreboard('data');
const t = (name, fn) => s.t(name, fn);

const jsonPath = path.join(ROOT, 'data', 'diagrams.json');
const committed = fs.readFileSync(jsonPath, 'utf8');
const data = JSON.parse(committed);

await t('data/diagrams.json 跟現在的 vendor/upstream 重跑出來的一致（不一致就跑 npm run build）', () => {
  const built = buildAll();
  assert.deepEqual(built.problems, []);
  assert.equal(serialize(built), committed);
});

await t('圖的張數跟 vendor/upstream 的檔案數對得起來', () => {
  const files = fs.readdirSync(path.join(ROOT, 'vendor', 'upstream'))
    .filter((f) => f.endsWith('.html') && f !== 'icons.html' && f !== 'index.html');
  assert.equal(data.count, files.length);
  assert.equal(data.diagrams.length, files.length);
});

await t('每一張圖的必要欄位都在', () => {
  data.diagrams.forEach((d) => {
    ['id', 'type', 'typeZh', 'variantZh', 'title', 'svg'].forEach((k) => {
      assert.ok(d[k] != null && d[k] !== '', `${d.id} 缺 ${k}`);
    });
    assert.equal(typeof d.dark, 'boolean', d.id);
    assert.equal(typeof d.png, 'boolean', d.id);
    assert.ok(d.w > 0 && d.h > 0, d.id);
  });
});

await t('id 沒有重複', () => {
  const ids = new Set(data.diagrams.map((d) => d.id));
  assert.equal(ids.size, data.diagrams.length);
});

await t('每一種類型都有中文名與用途說明', () => {
  data.types.forEach((ty) => {
    assert.ok(ty.zh && ty.zh !== ty.type, `${ty.type} 沒有中文名`);
    assert.ok(ty.use && ty.use.length > 0, `${ty.type} 沒有用途說明`);
  });
});

await t('每一張 SVG 都有 viewBox（算不出版面就沒法組匯出檔）', () => {
  data.diagrams.forEach((d) => {
    assert.ok(DD.parseViewBox(d.svg), d.id);
  });
});

await t('零對外連線：整份資料裡除了 XML 命名空間與來源標註，沒有別的網址', () => {
  const urls = new Set(committed.match(/https?:\\?\/\\?\/[^"'\\ )]+/g) || []);
  const bad = [...urls].filter((u) => !/^https?:\/\/(www\.)?w3\.org\//.test(u.replace('http://www.', 'http://'))
    && !u.startsWith(DD.SOURCE.url));
  assert.deepEqual(bad, []);
});

await t('沒有任何 <image>、<use xlink:href> 指到外部檔案', () => {
  data.diagrams.forEach((d) => {
    const refs = d.svg.match(/(?:href|src)="([^"]*)"/g) || [];
    refs.forEach((r) => {
      assert.ok(!/["=](https?:)?\/\//.test(r) || /w3\.org/.test(r), `${d.id}：${r}`);
    });
  });
});

await t('沒有留下上游的 webfont 字族名（換成中文會看不到字）', () => {
  data.diagrams.forEach((d) => {
    assert.ok(!/Geist|Instrument Serif/.test(d.svg), d.id);
  });
});

await t('沒有 @font-face（載字型檔就破壞零對外連線）', () => {
  assert.ok(!/@font-face/.test(committed));
});

await t('沒有 <script>（範本裡不該有可執行的東西）', () => {
  data.diagrams.forEach((d) => {
    assert.ok(!/<script/i.test(d.svg), d.id);
  });
});

await t('每一張圖都掛了自己的 scope class，CSS 不會互相汙染', () => {
  data.diagrams.forEach((d) => {
    if (!d.svg.includes('<style>')) return;
    const cls = 'dd-' + d.id;
    assert.ok(d.svg.includes('class="' + cls + '"') || d.svg.includes(' ' + cls + '"'), d.id);
    /* style 裡出現的每一條規則都要以自己的 class 或 @ 規則開頭 */
    const style = d.svg.slice(d.svg.indexOf('<style>') + 7, d.svg.indexOf('</style>'));
    DD.splitRules(style).forEach((rule) => {
      const head = rule.slice(0, rule.indexOf('{')).trim();
      assert.ok(head.startsWith('@') || head.startsWith('.' + cls),
        `${d.id} 的規則沒有冠上 class：${head.slice(0, 60)}`);
    });
  });
});

await t('深色範本沒有一張還留著淺色的滿版底（上游有三張是這樣，白底配白網點看不見）', () => {
  data.diagrams.filter((d) => d.dark).forEach((d) => {
    assert.ok(!/<rect[^>]*width="100%"[^>]*height="100%"[^>]*fill="#f5f5f5"/i.test(d.svg), d.id);
  });
});

await t('清單順序：同一種圖排在一起，標準版排在深色版前面', () => {
  const bar = data.diagrams.filter((d) => d.type === 'bar').map((d) => d.variant);
  assert.deepEqual(bar, ['', 'full', 'dark']);
  const zh = data.diagrams.map((d) => d.typeZh);
  assert.equal(new Set(zh).size, [...new Set(zh)].length);
  let seen = new Set(), last = null;
  zh.forEach((v) => {
    if (v !== last) { assert.ok(!seen.has(v), v + ' 被拆散在兩處'); seen.add(v); last = v; }
  });
});

await t('中文層的長度跟圖上的段數一樣（錯一格後面全錯位）', () => {
  data.diagrams.forEach((d) => {
    assert.equal(d.segs, DD.extractTextSegments(d.svg).length, d.id);
    if (d.zh) assert.equal(d.zh.length, d.segs, d.id);
  });
});

await t('中文範本：標題與大部分內容都寫好了', () => {
  const samples = data.diagrams.filter((d) => d.zhKind === 'sample');
  assert.ok(samples.length >= 30, '只有 ' + samples.length + ' 張');
  samples.forEach((d) => {
    assert.ok(d.zhHeading && d.zhHeading.length > 0, d.id + ' 沒有中文標題');
    /* 分母只算「真的有字要翻」的段：座標軸上的數字、件數這種本來就不必翻，
       拿總段數當分母的話，長條圖與折線圖會永遠不及格。
       也不強求 100%：UML、Sankey、Wardley、draw.io 這類沒有通用中文譯名的專有名詞，
       留原文比硬翻好，所以門檻抓九成。 */
    const segs = DD.extractTextSegments(d.svg);
    const wordy = segs.map((x, i) => [x.text, i]).filter(([txt]) => /[A-Za-z]{2,}/.test(txt));
    const left = wordy.filter(([, i]) => !d.zh[i]);
    const done = wordy.length - left.length;
    assert.ok(wordy.length === 0 || done / wordy.length >= 0.9,
      `${d.id} 只中文化了 ${done}/${wordy.length} 段：` + left.slice(0, 4).map(([t]) => t).join(' / '));
  });
});

await t('zhKind 只有三種值，而且跟 zh 對得起來', () => {
  data.diagrams.forEach((d) => {
    assert.ok(['', 'gloss', 'sample'].includes(d.zhKind), d.id + '：' + d.zhKind);
    assert.equal(!!d.zh, d.zhKind !== '', d.id);
  });
});

await t('公務常用的每一種類型，標準版都有整份中文', () => {
  const missing = DD.COMMON_TYPES.filter((ty) => {
    const base = data.diagrams.find((d) => d.type === ty && d.variant === '');
    return !base || base.zhKind !== 'sample';
  });
  assert.deepEqual(missing, []);
});

await t('zh-samples.json 裡的每一筆都對得到真的範本', () => {
  const f = path.join(ROOT, 'content', 'zh-samples.json');
  const samples = JSON.parse(fs.readFileSync(f, 'utf8'));
  Object.keys(samples).filter((k) => !k.startsWith('_')).forEach((id) => {
    const d = data.diagrams.find((x) => x.id === id);
    assert.ok(d, '範本 ' + id + ' 不存在');
    assert.equal(samples[id].texts.length, d.segs, id);
  });
});

await t('中文內容裡沒有殘留的半形括號亂碼或未填的佔位', () => {
  data.diagrams.filter((d) => d.zh).forEach((d) => {
    d.zh.forEach((v, i) => {
      if (v == null) return;
      assert.ok(!/^(TODO|待填|xxx)$/i.test(v.trim()), `${d.id}[${i}]：${v}`);
    });
  });
});

await t('資料裡帶著上游來源與授權', () => {
  assert.equal(data.source.repo, 'cathrynlavery/diagram-design');
  assert.equal(data.source.license, 'MIT');
  assert.ok(data.upstream, 'vendor/upstream/SOURCE.json 應該被讀進來');
  assert.match(data.upstream.commit, /^[0-9a-f]{40}$/);
});

await t('vendor/upstream 有上游的 LICENSE 全文', () => {
  const lic = fs.readFileSync(path.join(ROOT, 'vendor', 'upstream', 'LICENSE'), 'utf8');
  assert.match(lic, /MIT License/);
  assert.match(lic, /Cathryn Lavery/);
});

await t('公務常用的類型在庫裡真的找得到', () => {
  const have = new Set(data.diagrams.map((d) => d.type));
  DD.COMMON_TYPES.forEach((ty) => assert.ok(have.has(ty), `庫裡沒有 ${ty}`));
});

await t('資料大小沒有失控（超過 4 MB 就該考慮拆檔了）', () => {
  assert.ok(committed.length < 4 * 1024 * 1024, (committed.length / 1048576).toFixed(2) + ' MB');
});

s.finish();
