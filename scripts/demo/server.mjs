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

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const r = route({ method: req.method, pathname: url.pathname, searchParams: url.searchParams, authorized: Boolean(req.headers.authorization), body: await readBody(req) });
      res.writeHead(r.status, { 'Content-Type': r.type, 'Cache-Control': 'no-store' });
      return res.end(r.body);
    }
    const rel = url.pathname === '/' ? '/index.html' : url.pathname === '/_stage' ? null : url.pathname;
    const file = rel === null ? path.join(here, 'stage.html') : path.resolve(WEB, '.' + rel);
    if (rel !== null && !file.startsWith(WEB + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, HOST, () => {
  console.log(`\nDashling demo (fictional data) on http://localhost:${PORT}${HOST === '127.0.0.1' ? ' (this computer only)' : ' and on your network'}\nPairing code: ${CODE}\n`);
});
