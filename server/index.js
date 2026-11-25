// Dashling: zero-dependency server (Node built-ins only). Serves the panel to phones, tablets and browsers.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HostConnector } from './host.js';
import { ObsClient } from './obs.js';
import { safeFetchText, parseFeed, hackerNews, exchangeRates, airQuality } from './extras.js';
import { cleanLayout, DEFAULT_LAYOUT } from '../web/widgets.js';

// last 300 log lines, shown on the admin page
const LOGS = [];
for (const k of ['log', 'warn', 'error']) { const o = console[k].bind(console); console[k] = (...a) => { LOGS.push({ t: Date.now(), k, m: a.map(String).join(' ').trim() }); if (LOGS.length > 300) LOGS.shift(); o(...a); }; }
const STARTED = Date.now();

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../web');
// Fingerprint of the shipped front-end files; the app compares it to reload itself after an update.
const BUILD = await (async () => {
  const h = crypto.createHash('sha1');
  for (const f of (await fs.readdir(WEB)).sort()) { try { h.update(f); h.update(await fs.readFile(path.join(WEB, f))); } catch {} }
  return h.digest('hex').slice(0, 12);
})();
const DATA = process.env.DATA_DIR || '/data';
const PORT = Number(process.env.PORT || 8080);

await fs.mkdir(DATA, { recursive: true });

// --- auth token: from env, else generated once and kept in the data volume
async function loadToken() {
  if (process.env.DASHLING_TOKEN || process.env.PHONEBOX_TOKEN) return process.env.DASHLING_TOKEN || process.env.PHONEBOX_TOKEN;   // PHONEBOX_TOKEN: old name
  const f = path.join(DATA, 'token');
  try { return (await fs.readFile(f, 'utf8')).trim(); } catch {}
  const t = crypto.randomBytes(18).toString('base64url');
  await fs.writeFile(f, t, { mode: 0o600 });
  console.log(`\n  First run. Your access token (enter it once on each device):\n\n    ${t}\n`);
  return t;
}
const TOKEN = await loadToken();

// Separate key for automations (curl, Home Assistant, scripts). It can only post notifications and values,
// never read stats or control the Mac, so leaking it is low-impact.
async function loadWebhookToken() {
  if (process.env.WEBHOOK_TOKEN) return process.env.WEBHOOK_TOKEN;
  const f = path.join(DATA, 'webhook_token');
  try { return (await fs.readFile(f, 'utf8')).trim(); } catch {}
  const t = crypto.randomBytes(18).toString('base64url');
  await fs.writeFile(f, t, { mode: 0o600 });
  return t;
}
const WEBHOOK = Buffer.from(await loadWebhookToken());
function webhookAuthed(req) {
  const h = req.headers.authorization || '';
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  return given.length === WEBHOOK.length && crypto.timingSafeEqual(given, WEBHOOK);
}
const inbox = []; let inboxId = 0;           // last 20 notifications, memory only
const values = new Map();                     // up to 20 named values pushed by automations
const clip = (v, n) => String(v ?? '').slice(0, n);

// Home Assistant (optional): token stays on the server; only listed entities can be read or toggled.
// Connections: environment variables give the defaults; whatever is saved from the admin page (in the data volume) wins.
const CONN_FILE = path.join(DATA, 'connections.json');
const urlOf = v => String(v || '').trim().replace(/\/$/, '');
const entList = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(x => /^[a-z_]+\.[a-z0-9_]+$/.test(x));
let saved = {}; try { saved = JSON.parse(await fs.readFile(CONN_FILE, 'utf8')); } catch {}
const envConn = () => ({
  host: { target: process.env.HOST_SSH || '' },
  ha: { url: urlOf(process.env.HA_URL), token: process.env.HA_TOKEN || '', entities: entList(process.env.HA_ENTITIES) },
  printer: { url: urlOf(process.env.PRINTER_URL), type: process.env.PRINTER_TYPE === 'octoprint' ? 'octoprint' : 'moonraker', key: process.env.PRINTER_API_KEY || '' },
  github: { user: (process.env.GITHUB_USER || '').trim(), token: process.env.GITHUB_TOKEN || '' },
});
let HA_URL, HA_TOKEN, HA_ENTITIES, haOn, PRINTER_URL, PRINTER_TYPE, PRINTER_KEY, printerOn, GH_USER, GH_TOKEN, ghOn, conn;
function applyConn() {
  const e = envConn(); conn = {};
  for (const k of Object.keys(e)) conn[k] = { ...e[k], ...(saved[k] || {}) };
  HA_URL = urlOf(conn.ha.url); HA_TOKEN = conn.ha.token; HA_ENTITIES = entList(conn.ha.entities); haOn = Boolean(HA_URL && HA_TOKEN && HA_ENTITIES.length);
  PRINTER_URL = urlOf(conn.printer.url); PRINTER_TYPE = conn.printer.type === 'octoprint' ? 'octoprint' : 'moonraker'; PRINTER_KEY = conn.printer.key; printerOn = /^https?:\/\//.test(PRINTER_URL);
  GH_USER = String(conn.github.user || '').trim(); GH_TOKEN = conn.github.token; ghOn = /^[A-Za-z0-9-]{1,39}$/.test(GH_USER) && Boolean(GH_TOKEN);
  if (typeof host !== 'undefined') { host.target = conn.host.target || ''; host.enabled = Boolean(host.target); host.cache = null; }
}
async function ha(pathname, body) {
  const r = await fetch(HA_URL + pathname, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(6000),
    headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Home Assistant ${r.status}`);
  return r.json();
}
const tokenBuf = Buffer.from(TOKEN);

const sha = v => crypto.createHash('sha256').update(v).digest();

// --- device pairing: a 6-digit code printed in the server log pairs a device once; it then holds its own
// long random key (only the hash is stored here), so it never asks again. Revoke by deleting devices.json.
const DEV_FILE = path.join(DATA, 'devices.json');
let devices = [];                                   // [{ id, hash (hex), label, created }]
try { devices = JSON.parse(await fs.readFile(DEV_FILE, 'utf8')); } catch {}
const saveDevices = () => fs.writeFile(DEV_FILE, JSON.stringify(devices), { mode: 0o600 }).catch(() => {});
let pairing = null;                                 // { code, exp, tries }
const pairStarts = [];
function startPairing() {
  const now = Date.now();
  if (!pairing || pairing.exp < now) pairing = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'), exp: now + 5 * 60_000, tries: 0 };
  console.log(`\n  Pairing code: ${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}   (valid 5 minutes)\n`);
}
function deviceLabel(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}
function authed(req) {
  const h = req.headers.authorization || '';
  const raw = h.startsWith('Bearer ') ? h.slice(7) : '';
  const given = Buffer.from(raw);
  if (given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf)) return true;
  if (!raw) return false;
  const d = sha(raw);
  let ok = false;
  for (const x of devices) if (crypto.timingSafeEqual(d, Buffer.from(x.hash, 'hex'))) ok = true;
  return ok;
}

// --- brute-force limiter: 10 bad attempts per IP per minute
const fails = new Map();
function limited(ip) {
  const now = Date.now();
  const rec = (fails.get(ip) || []).filter(t => now - t < 60_000);
  fails.set(ip, rec);
  return rec.length >= 10;
}
setInterval(() => { for (const [k, v] of fails) if (!v.some(t => Date.now() - t < 60_000)) fails.delete(k); }, 60_000).unref();

const host = new HostConnector({
  target: '',                                      // set from connections (HOST_SSH or the admin page), e.g. you@host.docker.internal
  key: process.env.HOST_SSH_KEY || path.join(DATA, 'ssh/id_ed25519'),
  knownHosts: path.join(DATA, 'ssh/known_hosts'),
});

applyConn();

// OBS Studio on the same Mac (Tools > WebSocket Server Settings). Set OBS_PASSWORD if you enabled authentication there.
const obs = new ObsClient({ url: process.env.OBS_URL ?? 'ws://host.docker.internal:4455', password: process.env.OBS_PASSWORD });

const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { ...HEADERS, 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function readJson(req, max = 64 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new Error('too large'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

const NOTES = path.join(DATA, 'notes.json');
const SETTINGS = path.join(DATA, 'settings.json');

// --- layout: pages, widget order and sizes. Stored in the data volume so it survives restarts.
const LAYOUT_FILE = path.join(DATA, 'layout.json');
let layout = null;
try { layout = cleanLayout(JSON.parse(await fs.readFile(LAYOUT_FILE, 'utf8'))); } catch {}
const layoutOut = () => { const l = layout || cleanLayout(DEFAULT_LAYOUT); return { layout: l, rev: crypto.createHash('sha1').update(JSON.stringify(l)).digest('hex').slice(0, 8), custom: Boolean(layout) }; };
async function atomicWrite(file, text, mode = 0o600) { const t = file + '.tmp'; await fs.writeFile(t, text, { mode }); await fs.rename(t, file); }
async function saveLayout(l) { layout = l; if (l) await atomicWrite(LAYOUT_FILE, JSON.stringify(l), 0o644); else await fs.rm(LAYOUT_FILE, { force: true }); }

const STORE_KEYS = new Set(['clocks', 'checklist', 'counters', 'countdown', 'feeds', 'rates', 'photoframe']);
const memo = new Map();
async function cachedFetch(key, ttl, fn) {
  const e = memo.get(key); if (e && Date.now() - e.at < ttl) return e.v;
  const v = await fn(); memo.set(key, { v, at: Date.now() }); if (memo.size > 100) memo.delete(memo.keys().next().value); return v;
}
async function getSettings() { try { return JSON.parse(await fs.readFile(SETTINGS, 'utf8')); } catch { return {}; } }
async function saveSettings(s) { await fs.writeFile(SETTINGS, JSON.stringify(s)); }

// Weather via Open-Meteo (no API key). Only the saved city's coordinates leave this server.
let wxCache = null;
async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`weather service ${r.status}`);
  return r.json();
}
async function weather() {
  const { location, units = 'c' } = await getSettings();
  if (!location) return { location: null, units };
  const key = `${location.lat},${location.lon},${units}`;
  if (wxCache?.key === key && Date.now() - wxCache.at < 600_000) return wxCache.data;
  const q = new URLSearchParams({
    latitude: location.lat, longitude: location.lon, timezone: 'auto', forecast_days: 7, forecast_hours: 24,
    temperature_unit: units === 'f' ? 'fahrenheit' : 'celsius', wind_speed_unit: units === 'f' ? 'mph' : 'kmh',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,uv_index_max,precipitation_probability_max',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
  });
  const w = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`);
  const places = (await getSettings()).places || [];
  const data = { location, units, current: w.current, daily: w.daily, hourly: w.hourly, places };
  wxCache = { key, at: Date.now(), data };
  return data;
}


// ---------- GitHub contributions + streaks (optional). Token stays on the server.
const ghEnabled = () => host.enabled || ghOn;
const glEnabled = () => host.enabled;
// legacy path (no Mac connected): GitHub GraphQL with a token
async function ghFromToken() {
  const to = new Date(), from = new Date(to.getTime() - 364 * 86400_000);
  const query = `query($u:String!,$f:DateTime!,$t:DateTime!){user(login:$u){contributionsCollection(from:$f,to:$t){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;
  const r = await fetch(process.env.GITHUB_GRAPHQL_URL || 'https://api.github.com/graphql', { method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${GH_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'dashling' },
    body: JSON.stringify({ query, variables: { u: GH_USER, f: from.toISOString(), t: to.toISOString() } }) });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  const cal = j.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) throw new Error(j.errors?.[0]?.message || 'GitHub user not found');
  const days = {};
  for (const w of cal.weeks) for (const d of w.contributionDays) days[d.date] = d.contributionCount;
  return { user: GH_USER, days };
}
// Merge any number of sources into one calendar (Sunday-aligned weeks), levels by quartile, combined streaks.
function mergeContrib(sources) {
  const iso = t => new Date(t).toISOString().slice(0, 10), DAY = 86400_000;
  const n = new Date(), end = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const yearStart = end - 364 * DAY, first = new Date(yearStart); first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const weeks = []; let cur = [];
  for (let t = first.getTime(); t <= end; t += DAY) {
    const d = iso(t), s = sources.map(x => x.days[d] || 0);
    cur.push({ d, c: s.reduce((a, b) => a + b, 0), s, l: 0 });
    if (cur.length === 7) { weeks.push(cur); cur = []; }
  }
  if (cur.length) weeks.push(cur);
  const all = weeks.flat(), days = all.filter(x => x.d >= iso(yearStart));
  const nz = days.map(x => x.c).filter(c => c > 0).sort((a, b) => a - b);
  const q = p => nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 1, [q1, q2, q3] = [q(.25), q(.5), q(.75)];
  for (const x of all) x.l = x.c === 0 ? 0 : x.c <= q1 ? 1 : x.c <= q2 ? 2 : x.c <= q3 ? 3 : 4;
  let longest = 0, run = 0;
  for (const d of days) { run = d.c > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let i = days.length - 1; const today = days[i]?.c ?? 0;
  if (today === 0) i--;                              // today isn't over yet, so it doesn't break the streak
  let current = 0; while (i >= 0 && days[i].c > 0) { current++; i--; }
  const best = days.reduce((m, d) => d.c > m.c ? d : m, { c: 0, d: '' });
  return { total: days.reduce((a, d) => a + d.c, 0), current, longest, today, best, weeks,
    totals: sources.map(src => days.reduce((a, d) => a + (src.days[d.d] || 0), 0)) };
}
const cleanReviews = (list, source) => (Array.isArray(list) ? list : []).slice(0, 50).map(x => {
  const repo = typeof x.repository === 'object' ? (x.repository?.nameWithOwner || x.repository?.name) : (x.repo || x.repository);
  const author = typeof x.author === 'object' ? (x.author?.login || x.author?.username) : x.author;
  return { source, title: clip(x.title, 160), url: /^https?:\/\//i.test(x.url || '') ? x.url : '', repo: clip(repo, 80), number: Number.isInteger(x.number) ? x.number : null,
    author: clip(author, 40), updated: Date.parse(x.updatedAt) || 0, draft: Boolean(x.isDraft) };
}).filter(x => x.title && x.url).sort((a, b) => b.updated - a.updated);
async function ghReviewsFromToken() {            // no Mac connected: GitHub search with the token
  const q = encodeURIComponent(`is:pr is:open review-requested:${GH_USER}`);
  const r = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=30`, { signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${GH_TOKEN}`, 'User-Agent': 'dashling' } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return (await r.json()).items.map(i => ({ number: i.number, title: i.title, url: i.html_url, repository: { nameWithOwner: i.repository_url.split('/repos/')[1] }, author: { login: i.user?.login }, updatedAt: i.updated_at, isDraft: i.draft }));
}
// One source = a calendar (+ streaks) and a review queue. They fail independently, so a down GitLab never hides GitHub.
const codeCache = {};
let aiCache = null;
async function codeSource(key) {
  const c = codeCache[key]; if (c && Date.now() < c.until) return c.data;
  const gh = key === 'github';
  const cal = gh ? (host.enabled ? () => host.ghContrib() : ghFromToken) : () => host.glContrib();
  const rev = gh ? (host.enabled ? () => host.reviews('gh') : ghReviewsFromToken) : () => host.reviews('gl');
  const [a, b] = await Promise.allSettled([cal(), rev()]);
  // error text can contain private hostnames/URLs (e.g. a self-hosted GitLab): scrub them before they reach the page
  const msg = r => String(r.reason?.message || r.reason).replace(/https?:\/\/\S+/gi, '[url]').replace(/(lookup|dial tcp|Get|Post)\s+\S+/gi, '$1 [host]').replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/gi, '[host]').replace(/\s+/g, ' ').trim().slice(0, 160);
  const data = { enabled: true, name: gh ? 'GitHub' : 'GitLab' };
  if (a.status === 'fulfilled') { data.user = a.value.user; Object.assign(data, mergeContrib([{ name: data.name, ...a.value }])); delete data.totals; } else data.error = msg(a);
  if (b.status === 'fulfilled') data.reviews = cleanReviews(b.value, key); else { data.reviews = []; data.reviewsError = msg(b); }
  codeCache[key] = { until: Date.now() + (data.error || data.reviewsError ? 60_000 : 300_000), data };
  return data;
}

// ---------- stocks via Yahoo Finance (unofficial, keyless, global). Only ticker symbols leave this server.
const YH_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; dashboard)', Accept: 'application/json' };
const RANGES = { '1d': '5m', '5d': '30m', '1mo': '1d', '1y': '1d' };
const SYMBOL = /^[A-Za-z0-9.^=\-]{1,20}$/;
const SUBUNIT = { GBp: ['GBP', 100], ZAc: ['ZAR', 100], ILA: ['ILS', 100] };       // pence/cents quotes -> whole currency
const stockCache = new Map();
async function quote(symbol, range) {
  const key = `${symbol}|${range}`, c = stockCache.get(key);
  if (c && Date.now() - c.at < 60_000) return c.data;
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${RANGES[range]}`, { headers: YH_HEADERS, signal: AbortSignal.timeout(8000) });
    if (r.status === 404) throw new Error('unknown symbol');
    if (!r.ok) throw new Error(`Yahoo ${r.status}`);
    const j = await r.json(), res = j.chart?.result?.[0];
    if (!res) throw new Error(j.chart?.error?.description || 'no data');
    const m = res.meta, [cur, div] = SUBUNIT[m.currency] || [m.currency, 1];
    let closes = (res.indicators?.quote?.[0]?.close || []).filter(v => v != null).map(v => v / div);
    const price = m.regularMarketPrice / div;
    const base = range === '1d' ? (m.chartPreviousClose ?? m.previousClose) / div : closes[0];
    if (closes.length > 90) { const step = closes.length / 90; closes = Array.from({ length: 90 }, (_, i) => closes[Math.floor(i * step)]); }
    const reg = m.currentTradingPeriod?.regular, now = Date.now() / 1000;
    const data = { symbol, name: clip(m.longName || m.shortName || symbol, 60), exchange: clip(m.fullExchangeName || m.exchangeName, 30), type: clip(m.instrumentType, 20), currency: cur,
      price, prev: Number.isFinite(base) ? base : null, change: Number.isFinite(base) ? price - base : null, pct: base ? (price - base) / base * 100 : null,
      spark: closes, open: Boolean(reg && now >= reg.start && now <= reg.end), time: (m.regularMarketTime || 0) * 1000 };
    stockCache.set(key, { at: Date.now(), data }); return data;
  } catch (e) { if (c) return { ...c.data, stale: true }; throw e; }       // keep showing the last good price if Yahoo hiccups
}
async function searchSymbols(q) {
  const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`, { headers: YH_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  return ((await r.json()).quotes || []).filter(x => SYMBOL.test(x.symbol || '')).map(x => ({ symbol: x.symbol, name: clip(x.longname || x.shortname || x.symbol, 60), exchange: clip(x.exchDisp, 30), type: clip(x.typeDisp, 20) }));
}

// ---------- 3D printer (optional): Moonraker (Klipper) or OctoPrint over your LAN
let prCache = null;
async function pr(pathname, method = 'GET', body) {
  const h = { 'Content-Type': 'application/json' };
  if (PRINTER_KEY) h['X-Api-Key'] = PRINTER_KEY;      // OctoPrint API key; Moonraker accepts the same header
  const r = await fetch(PRINTER_URL + pathname, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`printer ${r.status}`);
  return r.status === 204 ? {} : r.json().catch(() => ({}));
}
const t1 = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
async function printer() {
  if (prCache && Date.now() - prCache.at < 2500) return prCache.data;
  let data;
  if (PRINTER_TYPE === 'octoprint') {
    const [p, j] = await Promise.all([pr('/api/printer').catch(() => null), pr('/api/job').catch(() => ({}))]);
    if (!p && !j?.state) throw new Error('printer unreachable');
    const f = p?.state?.flags || {};
    const state = f.error ? 'error' : f.paused || f.pausing ? 'paused' : f.printing ? 'printing' : f.ready || f.operational ? 'idle' : 'offline';
    data = { type: 'OctoPrint', state, label: p?.state?.text || j?.state || state, file: j?.job?.file?.name || '',
      progress: t1(j?.progress?.completion), elapsed: j?.progress?.printTime ?? null, remaining: j?.progress?.printTimeLeft ?? null,
      nozzle: { cur: t1(p?.temperature?.tool0?.actual), target: t1(p?.temperature?.tool0?.target) },
      bed: { cur: t1(p?.temperature?.bed?.actual), target: t1(p?.temperature?.bed?.target) } };
  } else {
    const q = await pr('/printer/objects/query?print_stats&display_status&extruder&heater_bed&virtual_sdcard');
    const st = q.result?.status || {};
    const ps = st.print_stats || {}, prog = st.virtual_sdcard?.progress ?? st.display_status?.progress ?? 0;
    const state = { printing: 'printing', paused: 'paused', error: 'error', complete: 'done', cancelled: 'idle', standby: 'idle' }[ps.state] || 'idle';
    const el = ps.print_duration ?? null;
    data = { type: 'Moonraker', state, label: ps.state || 'standby', file: ps.filename || '',
      progress: t1(prog * 100), elapsed: el, remaining: el != null && prog > 0.01 && state === 'printing' ? Math.round(el / prog - el) : null,
      nozzle: { cur: t1(st.extruder?.temperature), target: t1(st.extruder?.target) },
      bed: { cur: t1(st.heater_bed?.temperature), target: t1(st.heater_bed?.target) } };
  }
  prCache = { at: Date.now(), data }; return data;
}
async function printerAction(name) {
  if (PRINTER_TYPE === 'octoprint') {
    if (name === 'cancel') return pr('/api/job', 'POST', { command: 'cancel' });
    return pr('/api/job', 'POST', { command: 'pause', action: name === 'pause' ? 'pause' : 'resume' });
  }
  return pr(`/printer/print/${name}`, 'POST');
}

// ---------- shortcuts: user-defined tiles, stored in settings.json
const SC_ICONS = ['link', 'terminal', 'bulb', 'window', 'globe', 'bolt', 'play', 'music', 'github', 'printer', 'moon', 'home'];
const SC_ACTIONS = ['playpause', 'next', 'prev', 'mute', 'sleep'];
function cleanShortcuts(list) {
  if (!Array.isArray(list) || list.length > 24) throw new Error('up to 24 shortcuts');
  return list.map(x => {
    const label = clip(x?.label, 24).trim(), target = clip(x?.target, 300).trim(), type = x?.type;
    if (!label) throw new Error('every shortcut needs a name');
    if (type === 'url') { if (!/^[a-z][a-z0-9+.-]*:/i.test(target) || /^(javascript|data|file|blob):/i.test(target)) throw new Error(`"${label}": enter a full link such as https://… or shortcuts://…`); }
    else if (type === 'app') { if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}$/.test(target)) throw new Error(`"${label}": bad app name`); }
    else if (type === 'ha') { if (!HA_ENTITIES.includes(target)) throw new Error(`"${label}": entity is not in HA_ENTITIES`); }
    else if (type === 'action') { if (!SC_ACTIONS.includes(target)) throw new Error(`"${label}": unknown action`); }
    else throw new Error(`"${label}": unknown type`);
    return { id: clip(x.id, 24) || crypto.randomBytes(5).toString('hex'), label, type, target,
      icon: SC_ICONS.includes(x.icon) ? x.icon : 'link', color: /^#[0-9a-f]{6}$/i.test(x.color || '') ? x.color : '' };
  });
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, build: BUILD });

  const ip = req.socket.remoteAddress || '?';
  if (req.method === 'POST' && url.pathname === '/api/pair/start') {
    const now = Date.now();
    while (pairStarts.length && now - pairStarts[0] > 60_000) pairStarts.shift();
    if (pairStarts.length >= 6) return send(res, 429, { error: 'wait a moment' });
    pairStarts.push(now); startPairing();
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/pair') {
    if (limited(ip)) return send(res, 429, { error: 'too many attempts' });
    const b = await readJson(req, 512);
    const given = String(b.code || '').replace(/\s/g, '');
    if (!pairing || pairing.exp < Date.now() || !/^\d{6}$/.test(given)) { fails.get(ip)?.push(Date.now()) ?? fails.set(ip, [Date.now()]); return send(res, 401, { error: 'no active code' }); }
    if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pairing.code))) {
      fails.get(ip)?.push(Date.now()) ?? fails.set(ip, [Date.now()]);
      if (++pairing.tries >= 5) pairing = null;       // five wrong guesses burn the code
      return send(res, 401, { error: 'wrong code' });
    }
    pairing = null;
    const key = crypto.randomBytes(24).toString('base64url');
    devices.push({ id: crypto.randomBytes(4).toString('hex'), hash: sha(key).toString('hex'), label: deviceLabel(req.headers['user-agent']), created: Date.now() });
    devices = devices.slice(-20); await saveDevices();
    console.log(`\n  Paired a new device (${devices.at(-1).label}).\n`);
    return send(res, 200, { token: key });
  }
  if (req.method === 'POST' && (url.pathname === '/api/push' || url.pathname === '/api/value')) {
    if (limited(ip)) return send(res, 429, { error: 'too many attempts' });
    if (!webhookAuthed(req)) { fails.get(ip)?.push(Date.now()) ?? fails.set(ip, [Date.now()]); return send(res, 401, { error: 'unauthorized' }); }
    const b = await readJson(req, 4096);
    if (url.pathname === '/api/push') {
      const level = ['info', 'warn', 'error'].includes(b.level) ? b.level : 'info';
      if (!b.message && !b.title) return send(res, 400, { error: 'message or title required' });
      inbox.unshift({ id: ++inboxId, ts: Date.now(), title: clip(b.title, 80), message: clip(b.message, 300), level });
      inbox.length = Math.min(inbox.length, 20);
    } else {
      const key = clip(b.key, 40);
      if (!/^[a-z0-9_-]+$/i.test(key)) return send(res, 400, { error: 'key must be letters, digits, - or _' });
      if (!values.has(key) && values.size >= 20) return send(res, 400, { error: 'too many values' });
      values.set(key, { label: clip(b.label || key, 40), value: clip(b.value, 40), unit: clip(b.unit, 10), ts: Date.now() });
    }
    return send(res, 200, { ok: true });
  }
  if (limited(ip)) return send(res, 429, { error: 'too many attempts' });
  if (!authed(req)) { fails.get(ip)?.push(Date.now()) ?? fails.set(ip, [Date.now()]); return send(res, 401, { error: 'unauthorized' }); }

  if (req.method === 'GET' && url.pathname === '/api/layout') return send(res, 200, layoutOut());
  if (req.method === 'GET' && url.pathname === '/api/stats') {
    if (!host.enabled) return send(res, 200, { host: null });
    try { const h = await host.stats(); return send(res, 200, { host: h, history: host.history }); }
    catch (e) { return send(res, 200, { host: null, error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/fans') {
    if (!host.enabled) return send(res, 200, { fans: null });
    try { return send(res, 200, { fans: await host.fans() }); } catch (e) { return send(res, 200, { fans: null, error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/temps') {
    if (!host.enabled) return send(res, 200, { temps: null });
    try { return send(res, 200, { temps: await host.temps() }); } catch (e) { return send(res, 200, { temps: null, error: e.message }); }
  }
  if (req.method === 'GET' && ['/api/power', '/api/display', '/api/calendar', '/api/docker', '/api/shortcuts'].includes(url.pathname)) {
    const k = url.pathname.slice(5);
    if (!host.enabled) return send(res, 200, { [k]: null });
    try { return send(res, 200, { [k]: await host[k === 'shortcuts' ? 'shortcutList' : k]() }); } catch (e) { return send(res, 200, { [k]: null, error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/ctl') {
    const { action, value } = await readJson(req);
    if (!host.enabled) return send(res, 400, { error: 'no host connected' });
    try { await host.control(action, value); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/obs') return send(res, 200, { obs: await obs.status() });
  if (req.method === 'POST' && url.pathname === '/api/obs') {
    const { action, value } = await readJson(req);
    try { await obs.control(action, value); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message === 'down' ? 'OBS is not running (or its WebSocket server is off)' : e.message === 'auth' ? 'OBS password is wrong or missing' : e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/proc/kill') {
    const { pid, force } = await readJson(req);
    if (!host.enabled) return send(res, 400, { error: 'no host connected' });
    try { await host.killProc(pid, force === true); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/volume') {
    const { level } = await readJson(req);
    if (!Number.isInteger(level) || level < 0 || level > 100) return send(res, 400, { error: 'level must be 0-100' });
    await host.setVolume(level);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/notes') {
    if (req.method === 'GET') {
      try { return send(res, 200, await fs.readFile(NOTES, 'utf8')); } catch { return send(res, 200, { text: '' }); }
    }
    if (req.method === 'PUT') {
      const { text } = await readJson(req);
      if (typeof text !== 'string' || text.length > 20000) return send(res, 400, { error: 'bad text' });
      await fs.writeFile(NOTES, JSON.stringify({ text }));
      return send(res, 200, { ok: true });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/feed') {
    return send(res, 200, { notifications: inbox, values: Object.fromEntries(values), ha: haOn });
  }
  if (req.method === 'GET' && url.pathname === '/api/nowplaying') {
    if (!host.enabled) return send(res, 200, { np: null });
    try { return send(res, 200, { np: await host.nowPlaying() }); } catch (e) { return send(res, 200, { np: null, error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/artwork') {
    const art = host.enabled ? await host.artwork().catch(() => null) : null;
    return art ? send(res, 200, art.data, art.type) : send(res, 404, { error: 'no artwork' });
  }
  if (req.method === 'GET' && url.pathname === '/api/apps') {
    try { return send(res, 200, { apps: host.enabled ? await host.apps() : [] }); } catch (e) { return send(res, 200, { apps: [], error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/action') {
    const { action, name, value } = await readJson(req);
    if (!host.enabled) return send(res, 400, { error: 'no host connected' });
    try { await host.action(action, action === 'seek' ? value : name); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/ha') {
    if (!haOn) return send(res, 200, { entities: [] });
    try {
      const st = await Promise.all(HA_ENTITIES.map(id => ha(`/api/states/${id}`).catch(() => null)));
      return send(res, 200, { entities: st.filter(Boolean).map(x => ({ id: x.entity_id, name: x.attributes?.friendly_name || x.entity_id, state: x.state })) });
    } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/ha/toggle') {
    const { entity } = await readJson(req);
    if (!haOn || !HA_ENTITIES.includes(entity)) return send(res, 400, { error: 'entity not allowed' });
    try { await ha('/api/services/homeassistant/toggle', { entity_id: entity }); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/code') {
    const [github, gitlab] = await Promise.all([ghEnabled() ? codeSource('github') : { enabled: false }, glEnabled() ? codeSource('gitlab') : { enabled: false }]);
    return send(res, 200, { github, gitlab });
  }
  if (req.method === 'GET' && url.pathname === '/api/ai') {
    if (!host.enabled) return send(res, 200, { enabled: false });
    try {
      if (!aiCache || Date.now() - aiCache.at > 20_000) aiCache = { at: Date.now(), data: await host.aiUsage() };
      return send(res, 200, { enabled: true, ...aiCache.data });
    } catch (e) { return send(res, 200, { enabled: true, error: String(e.message).replace(/\s+/g, ' ').trim().slice(0, 160) }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/stocks') {
    const range = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : '1d';
    const symbols = (await getSettings()).stocks || [];
    const out = await Promise.allSettled(symbols.map(sym => quote(sym, range)));
    return send(res, 200, { range, symbols, quotes: out.map((r, i) => r.status === 'fulfilled' ? r.value : { symbol: symbols[i], error: String(r.reason?.message || r.reason).slice(0, 80) }) });
  }
  if (req.method === 'GET' && url.pathname === '/api/stocks/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || q.length > 40) return send(res, 200, { results: [] });
    try { return send(res, 200, { results: await searchSymbols(q) }); } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (req.method === 'PUT' && url.pathname === '/api/stocks/watchlist') {
    const { symbols } = await readJson(req);
    if (!Array.isArray(symbols) || symbols.length > 20 || !symbols.every(x => typeof x === 'string' && SYMBOL.test(x))) return send(res, 400, { error: 'up to 20 valid ticker symbols' });
    const cur = await getSettings(); cur.stocks = [...new Set(symbols.map(x => x.toUpperCase()))]; await saveSettings(cur);
    return send(res, 200, { symbols: cur.stocks });
  }
  if (req.method === 'GET' && url.pathname === '/api/printer') {
    if (!printerOn) return send(res, 200, { enabled: false });
    try { return send(res, 200, { enabled: true, ...(await printer()) }); } catch (e) { return send(res, 200, { enabled: true, state: 'offline', label: 'offline', error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/printer/action') {
    const { action } = await readJson(req);
    if (!printerOn) return send(res, 400, { error: 'no printer configured' });
    if (!['pause', 'resume', 'cancel'].includes(action)) return send(res, 400, { error: 'unknown action' });
    try { await printerAction(action); prCache = null; return send(res, 200, { ok: true }); } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (url.pathname === '/api/shortcuts') {
    if (req.method === 'GET') return send(res, 200, { shortcuts: (await getSettings()).shortcuts || [], icons: SC_ICONS, actions: SC_ACTIONS, ha: HA_ENTITIES });
    if (req.method === 'PUT') {
      const b = await readJson(req);
      try { const cur = await getSettings(); cur.shortcuts = cleanShortcuts(b.shortcuts); await saveSettings(cur); return send(res, 200, { shortcuts: cur.shortcuts }); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
  }
  // ---- generic small per-widget storage (checklist, counters, feeds ...). Whitelisted keys, size-capped, shared by every device.
  if (url.pathname.startsWith('/api/store/')) {
    const key = url.pathname.slice(11);
    if (!STORE_KEYS.has(key)) return send(res, 404, { error: 'unknown store key' });
    if (req.method === 'GET') return send(res, 200, { value: ((await getSettings()).store || {})[key] ?? null });
    if (req.method === 'PUT') {
      const { value } = await readJson(req);
      const text = JSON.stringify(value ?? null);
      if (text.length > 20_000) return send(res, 400, { error: 'too much data' });
      const cur = await getSettings(); cur.store = { ...(cur.store || {}), [key]: value ?? null }; await saveSettings(cur);
      return send(res, 200, { ok: true });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/hn') {
    try { return send(res, 200, { items: await cachedFetch('hn', 300_000, () => hackerNews(12)) }); } catch (e) { return send(res, 502, { error: 'Hacker News is unreachable' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/feeds') {
    const list = (((await getSettings()).store || {}).feeds || []).filter(u => typeof u === 'string').slice(0, 8);
    const all = await Promise.all(list.map(async u => { try { return { url: u, items: await cachedFetch('feed:' + u, 600_000, async () => parseFeed(await safeFetchText(u), new URL(u).hostname)) }; } catch (e) { return { url: u, error: e.message, items: [] }; } }));
    const items = all.flatMap(f => f.items).sort((a, b) => b.at - a.at).slice(0, 25);
    return send(res, 200, { items, errors: all.filter(f => f.error).map(f => ({ url: f.url, error: f.error })), configured: list.length });
  }
  if (req.method === 'GET' && url.pathname === '/api/rates') {
    const cfg = ((await getSettings()).store || {}).rates || { base: 'USD', symbols: ['EUR', 'GBP', 'INR', 'JPY'] };
    try { return send(res, 200, { rates: await cachedFetch('fx:' + JSON.stringify(cfg), 1_800_000, () => exchangeRates(String(cfg.base).toUpperCase(), (cfg.symbols || []).slice(0, 8).map(s => String(s).toUpperCase()))) }); } catch (e) { return send(res, 502, { error: 'Exchange rates unavailable (check the currency codes)' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/air') {
    const loc = (await getSettings()).location; if (!loc) return send(res, 200, { air: null });
    try { return send(res, 200, { air: await cachedFetch(`air:${loc.lat},${loc.lon}`, 900_000, () => airQuality(loc.lat, loc.lon)), place: loc.name }); } catch { return send(res, 502, { error: 'Air quality unavailable' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/photos') {
    if (!host.enabled) return send(res, 200, { photos: [] });
    try { return send(res, 200, { photos: await host.photos() }); } catch (e) { return send(res, 200, { photos: [], error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/photo') {
    try { return send(res, 200, await host.photo(url.searchParams.get('name') || ''), 'image/jpeg'); } catch (e) { return send(res, 404, { error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/weather/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2 || q.length > 80) return send(res, 200, { results: [] });
    try {
      const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=${encodeURIComponent(q)}`);
      return send(res, 200, { results: (g.results || []).map(h => ({ name: [h.name, h.admin1, h.country_code].filter(Boolean).join(', '), lat: h.latitude, lon: h.longitude, pop: h.population || 0 })) });
    } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/weather') {
    try { return send(res, 200, await weather()); } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (req.method === 'PUT' && url.pathname === '/api/weather/location') {
    const b2 = await readJson(req), { query, units } = b2;
    const cur = await getSettings();
    if (units !== undefined) {
      if (units !== 'c' && units !== 'f') return send(res, 400, { error: 'units must be c or f' });
      cur.units = units;
    }
    if (b2.place !== undefined) {                       // a result picked from search, or a saved place
      const p = b2.place;
      if (!p || typeof p.name !== 'string' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return send(res, 400, { error: 'bad place' });
      const place = { name: p.name.slice(0, 80), lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4) };
      cur.location = place;
      cur.places = [place, ...(cur.places || []).filter(x => !(x.lat === place.lat && x.lon === place.lon))].slice(0, 6);
    }
    if (b2.remove !== undefined) cur.places = (cur.places || []).filter(x => !(x.lat === b2.remove.lat && x.lon === b2.remove.lon));
    if (query !== undefined) {
      if (typeof query !== 'string' || !query.trim() || query.length > 80) return send(res, 400, { error: 'enter a city name' });
      try {
        const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(query.trim())}`);
        const hit = g.results?.[0];
        if (!hit) return send(res, 404, { error: `no place found for "${query.trim()}"` });
        cur.location = { name: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', '), lat: hit.latitude, lon: hit.longitude };
      } catch (e) { return send(res, 502, { error: e.message }); }
    }
    await saveSettings(cur); wxCache = null;
    try { return send(res, 200, await weather()); } catch (e) { return send(res, 502, { error: e.message }); }
  }
  return send(res, 404, { error: 'not found' });
}

async function serveStatic(res, pathname) {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return send(res, 404, 'not found', 'text/plain');   // the admin page lives on its own loopback-only port
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(WEB, '.' + rel);
  if (!file.startsWith(WEB + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  try {
    const data = await fs.readFile(file);
    return send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  } catch { return send(res, 404, 'not found', 'text/plain'); }
}

// ================================================================ admin (separate port, published on the Mac's loopback only)
const secret = v => ({ set: Boolean(v) });
const keepSecret = (given, old) => given === undefined || given === '' ? old : given === '__clear__' ? '' : String(given);
function connView() {
  return { host: { target: conn.host.target },
    ha: { url: conn.ha.url, entities: conn.ha.entities.join(', '), token: secret(conn.ha.token) },
    printer: { url: conn.printer.url, type: conn.printer.type, key: secret(conn.printer.key) },
    github: { user: conn.github.user, token: secret(conn.github.token) } };
}
async function saveConn(b) {
  const next = { host: { ...conn.host }, ha: { ...conn.ha }, printer: { ...conn.printer }, github: { ...conn.github } };
  if (b.host) {
    const t = String(b.host.target ?? '').trim();
    if (t && !/^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,100}$/.test(t)) throw new Error('Computer login should look like you@host.docker.internal');
    next.host.target = t;
  }
  if (b.ha) {
    const u = urlOf(b.ha.url); if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw new Error('Home Assistant URL must start with http:// or https://');
    next.ha = { url: u, token: keepSecret(b.ha.token, conn.ha.token), entities: entList(b.ha.entities) };
  }
  if (b.printer) {
    const u = urlOf(b.printer.url); if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw new Error('Printer URL must start with http:// or https://');
    next.printer = { url: u, type: b.printer.type === 'octoprint' ? 'octoprint' : 'moonraker', key: keepSecret(b.printer.key, conn.printer.key) };
  }
  if (b.github) {
    const u = String(b.github.user ?? '').trim(); if (u && !/^[A-Za-z0-9-]{1,39}$/.test(u)) throw new Error('GitHub user name looks wrong');
    next.github = { user: u, token: keepSecret(b.github.token, conn.github.token) };
  }
  saved = next; await atomicWrite(CONN_FILE, JSON.stringify(saved)); applyConn(); wxCache = aiCache = prCache = null;
  console.log('Connections updated from the admin page.');
}
async function testConn(name) {
  const t0 = Date.now(), done = (ok, msg) => ({ ok, ms: Date.now() - t0, msg });
  try {
    if (name === 'host') {
      if (!host.enabled) return done(false, 'Not configured (set the computer login)');
      const out = await host.run('stats', 10_000);
      return done(true, 'Connected to ' + ((out.match(/^name=(.*)$/m) || [])[1] || 'your computer'));
    }
    if (name === 'ha') {
      if (!HA_URL || !HA_TOKEN) return done(false, 'Not configured');
      const r = await ha('/api/'); return done(true, r.message || 'Connected');
    }
    if (name === 'printer') {
      if (!printerOn) return done(false, 'Not configured');
      await pr(PRINTER_TYPE === 'octoprint' ? '/api/version' : '/server/info'); return done(true, PRINTER_TYPE + ' answered');
    }
    if (name === 'github') {
      if (!GH_TOKEN) return done(false, 'Not configured (the computer connection can fetch GitHub without a token)');
      const r = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + GH_TOKEN, 'User-Agent': 'dashling' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return done(false, 'GitHub answered ' + r.status);
      return done(true, 'Token belongs to ' + (await r.json()).login);
    }
    if (name === 'internet') {
      const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      return done(r.ok, r.ok ? 'Reached Yahoo Finance (stocks)' : 'Yahoo answered ' + r.status);
    }
  } catch (e) { return done(false, e.message); }
  return done(false, 'unknown check');
}
async function diag() {
  let writable = true; try { await fs.writeFile(path.join(DATA, '.probe'), 'ok'); await fs.rm(path.join(DATA, '.probe')); } catch { writable = false; }
  const mem = process.memoryUsage();
  return { node: process.version, uptime: Math.round((Date.now() - STARTED) / 1000), rssMB: Math.round(mem.rss / 1048576), dataDir: DATA, dataWritable: writable,
    devices: devices.length, notifications: inbox.length, customLayout: layoutOut().custom, port: PORT,
    connected: { host: host.enabled, ha: haOn, printer: printerOn, github: ghOn } };
}
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
async function admin(req, res, url) {
  // DNS-rebinding and cross-site guards: only a loopback Host, same-origin requests, and a custom header on writes.
  if (!LOCAL_HOST.test(req.headers.host || '')) return send(res, 403, 'forbidden', 'text/plain');
  const p = url.pathname;
  if (!p.startsWith('/admin/api/')) {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain');
    const rel = p === '/' ? '/index.html' : p;
    for (const base of [path.join(WEB, 'admin'), WEB]) {
      const file = path.resolve(base, '.' + rel);
      if (!file.startsWith(base + path.sep)) continue;
      try { const d = await fs.readFile(file); return send(res, 200, d, MIME[path.extname(file)] || 'application/octet-stream'); } catch {}
    }
    return send(res, 404, 'not found', 'text/plain');
  }
  if (req.method !== 'GET') {
    const o = req.headers.origin;
    if ((o && o !== 'http://' + req.headers.host) || req.headers['x-dashling-admin'] !== '1') return send(res, 403, { error: 'forbidden' });
  }
  const r = p.slice('/admin/api/'.length);
  try {
    if (r === 'layout' && req.method === 'GET') return send(res, 200, { ...layoutOut(), default: cleanLayout(DEFAULT_LAYOUT) });
    if (r === 'layout' && req.method === 'PUT') { const l = cleanLayout(await readJson(req)); await saveLayout(l); console.log('Layout saved from the admin page.'); return send(res, 200, layoutOut()); }
    if (r === 'layout/reset' && req.method === 'POST') { await saveLayout(null); console.log('Layout reset to default.'); return send(res, 200, layoutOut()); }
    if (r === 'connections' && req.method === 'GET') return send(res, 200, connView());
    if (r === 'connections' && req.method === 'PUT') { await saveConn(await readJson(req)); return send(res, 200, connView()); }
    if (r.startsWith('test/') && req.method === 'POST') return send(res, 200, await testConn(r.slice(5)));
    if (r === 'diag') return send(res, 200, await diag());
    if (r === 'logs') return send(res, 200, { logs: LOGS });
    if (r === 'devices' && req.method === 'GET') return send(res, 200, { devices: devices.map(({ id, label, created }) => ({ id, label, created })) });
    if (r.startsWith('devices/') && req.method === 'DELETE') {
      const id = r.slice(8); devices = id === 'all' ? [] : devices.filter(d => d.id !== id); await saveDevices(); return send(res, 200, { ok: true });
    }
    if (r === 'pair-code' && req.method === 'POST') { startPairing(); return send(res, 200, { code: pairing.code, expires: pairing.exp }); }
    if (r === 'test-notification' && req.method === 'POST') {
      inbox.unshift({ id: ++inboxId, ts: Date.now(), title: 'Admin', message: 'Test notification from the admin page', level: 'info' }); inbox.length = Math.min(inbox.length, 20);
      return send(res, 200, { ok: true });
    }
    if (r === 'clear-caches' && req.method === 'POST') { host.cache = null; wxCache = aiCache = prCache = null; return send(res, 200, { ok: true }); }
  } catch (e) { return send(res, 400, { error: e.message }); }
  return send(res, 404, { error: 'not found' });
}
const ADMIN_PORT = Number(process.env.ADMIN_PORT ?? 8081);
if (ADMIN_PORT) http.createServer(async (req, res) => {
  try { return await admin(req, res, new URL(req.url, 'http://x')); }
  catch (e) { console.error(e.message); send(res, 500, { error: 'server error' }); }
}).listen(ADMIN_PORT, () => console.log('Admin page ready (open it on the Mac that runs Docker; see README).'));

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(res, url.pathname);
  } catch (e) {
    console.error(e.message);
    send(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`Dashling listening on :${PORT} (host: ${host.enabled ? host.target : 'off'}, home assistant: ${haOn ? HA_ENTITIES.length + ' entities' : 'off'}, contributions: ${host.enabled ? 'gh+glab via Mac' : ghOn ? GH_USER : 'off'}, printer: ${printerOn ? PRINTER_TYPE : 'off'})`));
