/*
 * helpers.mjs — e2e 用的小工具：靜態伺服器、找 playwright、計分板。
 *
 * 為什麼要起伺服器？站上的資料是 fetch('data/diagrams.json') 拿的，
 * file:// 底下 fetch 會被瀏覽器擋掉，測試不能直接開檔案。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png'
};

/** 起一個只讀 repo 目錄的靜態伺服器，回傳 {url, close}。埠號交給系統挑。 */
export function serve(dir = ROOT) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir)) { res.writeHead(403).end('forbidden'); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': buf.length
      });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

/**
 * playwright 可能只裝在全域，這裡自己找出來。
 * 它是 CJS，從全域路徑 import 進來時 chromium 會躲在 default 裡，一併攤平。
 */
export async function loadPlaywright() {
  let mod;
  try {
    mod = await import('playwright');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    mod = await import(pathToFileURL(path.join(root, 'playwright', 'index.js')).href);
  }
  const pw = mod.chromium ? mod : mod.default;
  if (!pw || !pw.chromium) throw new Error('找不到 playwright，請先 npm i -g playwright');
  return pw;
}

/** 小小的測試計分板，跟 core.unit 同一套輸出格式。 */
export function scoreboard(label) {
  let pass = 0;
  const fails = [];
  return {
    async t(name, fn) {
      try { await fn(); pass++; } catch (e) { fails.push(`${name}\n    ${String(e.message).split('\n')[0]}`); }
    },
    ok(name, cond, detail = '') {
      if (cond) pass++; else fails.push(`${name}${detail ? '\n    ' + detail : ''}`);
    },
    get passed() { return pass; },
    finish() {
      console.log(`${label}：${pass} 過 / ${fails.length} 失敗`);
      if (fails.length) {
        fails.forEach((f) => console.error('  ✗ ' + f));
        process.exitCode = 1;
      }
      return fails.length === 0;
    }
  };
}
