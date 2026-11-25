// Dashling demo: the real web app with invented data, no computer or Docker needed.
//   npm run demo        then open http://localhost:8799 and enter the pairing code 123456
// Listens on 127.0.0.1 only unless you set DEMO_HOST. Everything it shows is fictional (see data.mjs). Also used to take the README screenshots.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LAYOUT, cleanLayout } from '../../web/widgets.js';
import * as D from './data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../web');
const PORT = Number(process.env.DEMO_PORT || 8799);
const HOST = process.env.DEMO_HOST || '127.0.0.1';      // localhost only; set DEMO_HOST=0.0.0.0 to try it from a phone on your Wi-Fi
const CODE = '123456';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// A demo-friendly order. Pages that need hardware we don't fake (printer, shortcuts) are left out.
const ORDER = ['home', 'system', 'mac', 'time', 'personal', 'news', 'code', 'ai', 'stocks', 'media'];
const byId = new Map(DEFAULT_LAYOUT.pages.map((p) => [p.id, p]));
const LAYOUT = cleanLayout({ pages: ORDER.map((id) => ({ ...byId.get(id), title: id === 'mac' ? 'Computer' : byId.get(id).title })) });
// The photo frame first, so the Personal page opens on something pretty.
LAYOUT.pages.find((p) => p.id === 'personal').widgets = ['photos', 'checklist', 'counter', 'quote'].map((id) => ({ id }));
const STORE = D.store();

const json = (res, obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = async (req) => { let b = ''; for await (const c of req) b += c; try { return JSON.parse(b || '{}'); } catch { return {}; } };

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/health') return json(res, { ok: true, build: 'demo' });
  if (p === '/api/pair/start') return json(res, { ok: true });
  if (p === '/api/pair') return (await body(req)).code === CODE ? json(res, { token: 'demo-token' }) : json(res, { error: 'wrong code' }, 401);
  if (!req.headers.authorization) return json(res, { error: 'unauthorized' }, 401);
  const now = Date.now();
  switch (p) {
    case '/api/layout': return json(res, { layout: LAYOUT, rev: 'demo', custom: false });
    case '/api/stats': return json(res, D.stats(now));
    case '/api/fans': return json(res, D.fans(now));
    case '/api/temps': return json(res, D.temps(now));
    case '/api/power': return json(res, D.power(now));
    case '/api/display': return json(res, D.display());
    case '/api/docker': return json(res, D.docker());
    case '/api/calendar': return json(res, D.calendar(now));
    case '/api/obs': return json(res, m === 'POST' ? { ok: true } : D.obs());
    case '/api/nowplaying': return json(res, D.nowplaying(now));
    case '/api/artwork': res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(D.artworkSvg());
    case '/api/feed': return json(res, D.feed());
    case '/api/weather': return json(res, D.weather());
    case '/api/air': return json(res, D.air());
    case '/api/hn': return json(res, D.hn());
    case '/api/feeds': return json(res, D.feeds());
    case '/api/rates': return json(res, D.rates());
    case '/api/stocks': return json(res, D.stocks(url.searchParams.get('range') || '1d'));
    case '/api/code': return json(res, D.code());
    case '/api/ai': return json(res, D.ai());
    case '/api/photos': return json(res, { photos: D.PHOTOS });
    case '/api/photo': res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(D.photoSvg(url.searchParams.get('name') || ''));
    case '/api/apps': return json(res, { apps: ['Safari', 'Music', 'Notes', 'Calendar'] });
    case '/api/notes': return json(res, { text: m === 'PUT' ? '' : 'Ideas for the weekend:\n- tidy the cable drawer\n- try the new coffee beans' });
    case '/api/weather/search': return json(res, { results: [{ name: 'Lisbon, Lisboa, PT', lat: 38.72, lon: -9.14 }, { name: 'Lisbon, Maine, US', lat: 44.03, lon: -70.1 }] });
  }
  if (p.startsWith('/api/store/')) {
    const key = p.slice(11);
    if (m === 'PUT') { STORE[key] = (await body(req)).value ?? null; return json(res, { ok: true }); }
    return json(res, { value: STORE[key] ?? null });
  }
  return json(res, m === 'GET' ? {} : { ok: true });     // anything else (volume, actions, controls...) just succeeds
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
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
