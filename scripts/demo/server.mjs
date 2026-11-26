// Dashling demo: the real web app with invented data, no computer or Docker needed.
//   npm run demo        then open http://localhost:8799 and enter the pairing code 123456
// Listens on 127.0.0.1 only unless you set DEMO_HOST. Everything it shows is fictional (see data.mjs). Also used to take the README screenshots.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, CODE } from './router.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../web');
const PORT = Number(process.env.DEMO_PORT || 8799);
const HOST = process.env.DEMO_HOST || '127.0.0.1';      // localhost only; set DEMO_HOST=0.0.0.0 to try it from a phone on your Wi-Fi
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

async function readBody(req) { let b = ''; for await (const c of req) b += c; try { return JSON.parse(b || '{}'); } catch { return {}; } }

let testLayout = null;                   // set by the theme test screen (/_themetest) so the panel shows every widget; never used on the website
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/_themetest/layout' && req.method === 'POST') { testLayout = await readBody(req); res.writeHead(204); return res.end(); }
    if (url.pathname === '/api/layout' && testLayout && req.headers.authorization) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ layout: testLayout, rev: 'test-' + Date.now(), custom: false }));
    }
    if (url.pathname.startsWith('/api/')) {
      const r = route({ method: req.method, pathname: url.pathname, searchParams: url.searchParams, authorized: Boolean(req.headers.authorization), body: await readBody(req) });
      res.writeHead(r.status, { 'Content-Type': r.type, 'Cache-Control': 'no-store' });
      return res.end(r.body);
    }
    const PAGES = { '/_stage': 'stage.html', '/_social': 'social.html', '/_themetest': 'themetest.html' };          // screenshot helpers that live next to this file
    const helper = PAGES[url.pathname], rel = helper ? null : url.pathname === '/' ? '/index.html' : url.pathname;
    const file = helper ? path.join(here, helper) : path.resolve(WEB, '.' + rel);
    if (rel !== null && !file.startsWith(WEB + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, HOST, () => {
  console.log(`\nDashling demo (fictional data) on http://localhost:${PORT}${HOST === '127.0.0.1' ? ' (this computer only)' : ' and on your network'}\nPairing code: ${CODE}\n`);
});
