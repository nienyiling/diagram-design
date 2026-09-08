/*
 * dist.mjs — 組出部署目錄。
 *
 * 給兩條路共用：GitHub Actions（.github/workflows/deploy.yml）與
 * Cloudflare Pages 後台的 Git 整合（建置指令填 `npm run dist`、輸出目錄填 `dist`）。
 * 兩邊共用同一份清單，才不會一邊上線、另一邊少檔案。
 *
 * vendor/upstream 是建置來源（2.3 MB 的上游 HTML），站上跑的時候用不到，不推上 CDN。
 * tests/、scripts/、content/ 同理。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'dist');

/* 少一個就是壞的，而且只在使用者真的點下去時才發現——所以缺檔直接讓建置失敗 */
const FILES = ['index.html', '_headers'];
const DIRS = ['app', 'data'];
const REQUIRED = [
  'index.html', '_headers',
  'app/core.js', 'app/gen.js', 'app/board.js',
  'app/app.js', 'app/editor.js', 'app/forms.js', 'app/canvas.js',
  'data/diagrams.json'
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
FILES.forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f)));
DIRS.forEach((d) => fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true }));

const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(OUT, f)));
if (missing.length) {
  console.error('部署包缺少檔案：' + missing.join('、'));
  process.exit(1);
}

const count = JSON.parse(fs.readFileSync(path.join(OUT, 'data', 'diagrams.json'), 'utf8')).count;
if (!(count >= 100)) {
  console.error('範本只剩 ' + count + ' 張，資料檔應該是壞的');
  process.exit(1);
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const all = walk(OUT);
const bytes = all.reduce((n, f) => n + fs.statSync(f).size, 0);
all.map((f) => path.relative(ROOT, f)).sort().forEach((f) => console.log('  ' + f));
console.log('部署包齊備：' + all.length + ' 個檔案、' +
  (bytes / 1048576).toFixed(1) + ' MB、範本 ' + count + ' 張。');
