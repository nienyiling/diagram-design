/*
 * dump-segments.mjs — 印出一張圖的每一段文字與序號，給人工寫中文範例用。
 * 用法：node scripts/dump-segments.mjs example-flowchart
 * 產出的序號就是 content/zh-samples.json 裡 texts 陣列的序號。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DD = require(path.join(ROOT, 'app', 'core.js'));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'diagrams.json'), 'utf8'));

for (const id of process.argv.slice(2)) {
  const d = data.diagrams.find((x) => x.id === id);
  if (!d) { console.error('找不到', id); continue; }
  console.log(`\n=== ${id} · ${d.typeZh} · ${d.segs} 段 · 標題「${d.heading}」`);
  DD.extractTextSegments(d.svg).forEach((s, i) => {
    console.log(String(i).padStart(3) + (s.multiline ? ' M ' : ' · ') + (s.text || '（空白）'));
  });
}
