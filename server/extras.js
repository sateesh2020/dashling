// Outbound data for the news / money / weather widgets. Everything here runs on the server, so the browser CSP stays 'self' only.
import dns from 'node:dns/promises';
import net from 'node:net';

// ---------- safe fetch: user-supplied feed URLs must never reach your LAN, the Mac, or cloud metadata
const privateV4 = (ip) => { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; };
const privateV6 = (ip) => { const s = ip.toLowerCase(); return s === '::1' || s === '::' || s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('::ffff:') || s.startsWith('ff'); };
async function assertPublic(rawHost) {
  const host = rawHost.replace(/^\[|\]$/g, '');          // URL.hostname keeps the brackets around IPv6 literals
  if (net.isIP(host)) { if (net.isIPv4(host) ? privateV4(host) : privateV6(host)) throw new Error('address not allowed'); return; }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => (a.family === 4 ? privateV4(a.address) : privateV6(a.address)))) throw new Error('address not allowed');
}
export async function safeFetchText(input, { max = 1_000_000, hops = 3 } = {}) {
  let url = new URL(input);
  for (let i = 0; i <= hops; i++) {
    if (url.protocol !== 'https:') throw new Error('only https links are allowed');     // TLS also stops DNS-rebinding onto internal HTTP services
    if (url.username || url.password || (url.port && url.port !== '443')) throw new Error('link not allowed');
    await assertPublic(url.hostname);
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Dashling/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url); continue; }
    if (!r.ok) throw new Error(`feed answered ${r.status}`);
    const reader = r.body.getReader(); const chunks = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > max) { reader.cancel(); throw new Error('feed too large'); } chunks.push(value); }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('too many redirects');
}

// ---------- RSS / Atom (small, forgiving parser; no dependencies)
const ent = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" }[k])).replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? ent(m[1]) : ''; };
export function parseFeed(xml, source) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const feedTitle = tag(xml.replace(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi, ''), 'title') || source;
  for (const b of blocks.slice(0, 15)) {
    let link = tag(b, 'link'); if (!link) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : ''; }
    const when = Date.parse(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || '') || 0;
    const title = tag(b, 'title'); if (!title) continue;
    out.push({ title: title.slice(0, 200), link: /^https?:\/\//i.test(link) ? link : '', at: when, source: feedTitle.slice(0, 60) });
  }
  return out;
}

// ---------- Hacker News (public Firebase API, no key)
export async function hackerNews(n = 12) {
  const ids = await (await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(8000) })).json();
  const items = await Promise.all(ids.slice(0, n).map(async (id) => { try { return await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(8000) })).json(); } catch { return null; } }));
  return items.filter(Boolean).map(i => ({ id: i.id, title: String(i.title || '').slice(0, 200), url: i.url || `https://news.ycombinator.com/item?id=${i.id}`, score: i.score || 0, comments: i.descendants || 0, by: i.by || '', at: (i.time || 0) * 1000 }));
}

// ---------- exchange rates (Frankfurter: ECB reference rates, no key)
export async function exchangeRates(base, symbols) {
  if (!/^[A-Z]{3}$/.test(base) || !symbols.length || symbols.some(s => !/^[A-Z]{3}$/.test(s))) throw new Error('bad currency code');
  const now = await (await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${symbols.join(',')}`, { signal: AbortSignal.timeout(8000) })).json();
  const prevDate = new Date(Date.parse(now.date) - 4 * 864e5).toISOString().slice(0, 10);
  let prev = {}; try { const p = await (await fetch(`https://api.frankfurter.dev/v1/${prevDate}?base=${base}&symbols=${symbols.join(',')}`, { signal: AbortSignal.timeout(8000) })).json(); prev = p.rates || {}; } catch {}
  return { base, date: now.date, rates: Object.fromEntries(Object.entries(now.rates || {}).map(([k, v]) => [k, { rate: v, change: prev[k] ? +(((v - prev[k]) / prev[k]) * 100).toFixed(2) : null }])) };
}

// ---------- air quality (Open-Meteo, no key)
export async function airQuality(lat, lon) {
  const q = new URLSearchParams({ latitude: lat, longitude: lon, current: 'european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide' });
  const r = await (await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}`, { signal: AbortSignal.timeout(8000) })).json();
  return r.current || null;
}
