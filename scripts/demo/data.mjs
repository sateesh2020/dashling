// Fictional data for the demo server and the README screenshots.
// Nothing here comes from a real machine, account or person: names, titles, numbers and places are all invented.
const p2 = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const day = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const wave = (t, period, phase = 0) => Math.sin((t / period) * 2 * Math.PI + phase);

// ---------------------------------------------------------------- the computer
const busy = (t) => Math.max(6, 30 + 16 * wave(t, 41000) + 9 * wave(t, 11300, 1) + 4 * wave(t, 2900, 2));
const memPct = (t) => 66 + 3 * wave(t, 90000) + 1.2 * wave(t, 13000);
const GB = 1073741824;
export function stats(now = Date.now()) {
  const b = busy(now), N = 120, STEP = 2500, r = rng(7);
  const history = Array.from({ length: N }, (_, i) => {
    const t = now - (N - 1 - i) * STEP, burst = Math.max(0, wave(t, 17000, 0.5) * (0.5 + 0.5 * wave(t, 6100, 1.3)) * (0.4 + 0.6 * Math.max(0, wave(t, 53000, 2)))) ** 2;
    return { t, cpu: +busy(t).toFixed(1), mem: +memPct(t).toFixed(1), rx: Math.round(20000 + 900000 * burst + 30000 * r()), tx: Math.round(8000 + 160000 * Math.max(0, wave(t, 23000)) ** 2 + 9000 * r()) };
  });
  return {
    host: {
      name: 'MacBook Pro', cores: 12,
      cpu: { user: +(b * 0.64).toFixed(1), sys: +(b * 0.36).toFixed(1), idle: +(100 - b).toFixed(1) },
      mem: { used: Math.round(memPct(now) / 100 * 32 * GB), total: 32 * GB },
      disk: { used: Math.round(318 * GB), total: Math.round(494 * GB) },
      battery: { pct: 82, state: 'charging', time: '' },
      load: [+(b / 12 + 0.6).toFixed(2), +(b / 12 + 0.9).toFixed(2), +(b / 12 + 1.1).toFixed(2)],
      procs: [
        { cpu: +(b * 0.9).toFixed(1), mem: 4.2, pid: 4181, mine: true, name: 'Code Helper (Renderer)' },
        { cpu: +(b * 0.6).toFixed(1), mem: 3.1, pid: 3377, mine: true, name: 'Google Chrome Helper' },
        { cpu: +(b * 0.4).toFixed(1), mem: 0.9, pid: 5120, mine: true, name: 'node' },
        { cpu: +(b * 0.3).toFixed(1), mem: 1.6, pid: 612, mine: false, name: 'WindowServer' },
        { cpu: +(b * 0.2).toFixed(1), mem: 2.2, pid: 2054, mine: true, name: 'Slack Helper' },
        { cpu: +(b * 0.1).toFixed(1), mem: 0.4, pid: 331, mine: false, name: 'mds_stores' },
      ],
      boot: Math.floor(now / 1000) - (3 * 86400 + 7 * 3600), volume: 62,
      net: { rx: 48000000000 + Math.floor(now / 10), tx: 9000000000 + Math.floor(now / 40) },
    },
    history,
  };
}
export const fans = (t = Date.now()) => ({ fans: { setup: false, none: false, rpm: [Math.round(2140 + 90 * wave(t, 30000)), Math.round(2290 + 90 * wave(t, 30000, 1))] } });
export const temps = (t = Date.now()) => ({ temps: { setup: false, none: false, p: [58, 61, 57, 63, 60, 59, 62, 56].map((v, i) => Math.round(v + 4 * wave(t, 20000, i))), e: [49, 52, 50, 51].map((v, i) => Math.round(v + 2 * wave(t, 15000, i))), gpu: Math.round(54 + 3 * wave(t, 18000)) } });
export const power = (t = Date.now()) => ({ power: { sysW: +(19 + 5 * wave(t, 21000)).toFixed(1), inW: +(27 + 5 * wave(t, 21000)).toFixed(1), battW: -2.4, ac: true, ratedW: 96, cycles: 187, health: 94, tempC: 31.4 } });
export const display = () => ({ display: { brightness: 70 } });
export const docker = () => ({ docker: { down: false, containers: [
  { name: 'web', state: 'running', status: 'Up 3 hours', image: 'nginx:1.27', self: false },
  { name: 'api', state: 'running', status: 'Up 3 hours', image: 'acme/api:2.4', self: false },
  { name: 'postgres', state: 'running', status: 'Up 2 days (healthy)', image: 'postgres:16', self: false },
  { name: 'redis', state: 'running', status: 'Up 2 days', image: 'redis:7', self: false },
  { name: 'grafana', state: 'running', status: 'Up 9 hours', image: 'grafana/grafana', self: false },
  { name: 'nightly-job', state: 'exited', status: 'Exited (0) 5 minutes ago', image: 'acme/jobs:1.1', self: false },
  { name: 'dashling', state: 'running', status: 'Up 4 days (healthy)', image: 'ghcr.io/sateesh2020/dashling:latest', self: true },
] } });
export const calendar = (now = Date.now()) => { const m = 60000, s = (x) => Math.floor(x / 1000); return { calendar: { setup: false, denied: false, unsupported: false, events: [
  { start: s(now + 25 * m), end: s(now + 55 * m), allDay: false, calendar: 'Work', title: 'Team standup' },
  { start: s(now + 3 * 3600e3), end: s(now + 4 * 3600e3), allDay: false, calendar: 'Work', title: 'Design review' },
  { start: s(now + 5 * 3600e3), end: s(now + 6 * 3600e3), allDay: false, calendar: 'Personal', title: 'Lunch with Sam' },
  { start: s(now + 27 * 3600e3), end: s(now + 28 * 3600e3), allDay: false, calendar: 'Work', title: 'Release planning' },
  { start: s(now + 28 * 3600e3), end: s(now + 52 * 3600e3), allDay: true, calendar: 'Personal', title: 'Weekend trip' },
] } }; };
export const obs = () => ({ obs: { up: true, version: '31.0.0', streaming: false, streamTime: '00:00:00', recording: true, paused: false, recTime: '00:12:41', scene: 'Screen share', scenes: ['Webcam', 'Screen share', 'Be right back', 'Starting soon'] } });
export const nowplaying = (t = Date.now()) => ({ np: { src: 'com.spotify.client', source: 'Spotify', title: 'Midnight Drive', artist: 'Neon Harbor', album: 'Afterglow', duration: 214, elapsed: (t / 1000) % 214, playing: true, key: 'Midnight Drive|Neon Harbor|Afterglow', arturl: '' } });
export const feed = () => ({ notifications: [
  { id: 3, level: 'info', title: 'Deploy finished', message: 'web v2.4.1 is live in production', ts: Date.now() - 4 * 60000 },
  { id: 2, level: 'warn', title: 'Disk space', message: 'Build cache is using 41 GB', ts: Date.now() - 55 * 60000 },
  { id: 1, level: 'info', title: 'Backup complete', message: 'Nightly backup finished in 6 minutes', ts: Date.now() - 6 * 3600e3 },
], values: { Build: 'passing', Uptime: '99.98%', 'Open PRs': '4', Queue: '12 jobs' }, ha: false });

// ---------------------------------------------------------------- weather, air, news, money (Lisbon: an arbitrary example city)
export function weather(now = new Date()) {
  const base = new Date(now); base.setMinutes(0, 0, 0);
  const hours = Array.from({ length: 24 }, (_, i) => new Date(base.getTime() + i * 3600e3));
  const dcode = [1, 2, 3, 61, 61, 2, 1], dmax = [23, 24, 22, 20, 19, 21, 23], dmin = [15, 16, 15, 14, 13, 14, 15];
  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
  return {
    location: { name: 'Lisbon, Lisboa, PT', lat: 38.72, lon: -9.14 }, units: 'c',
    current: { temperature_2m: 21.4, apparent_temperature: 21.0, weather_code: 1, wind_speed_10m: 12.6, is_day: 1 },
    daily: { time: days.map(day), temperature_2m_max: dmax, temperature_2m_min: dmin, weather_code: dcode,
      sunrise: days.map((d) => `${day(d)}T07:05`), sunset: days.map((d) => `${day(d)}T17:28`), uv_index_max: [3, 3, 2, 1, 1, 2, 3], precipitation_probability_max: [5, 10, 20, 70, 65, 15, 5] },
    hourly: { time: hours.map(isoLocal), temperature_2m: hours.map((h) => +(16 + 6 * wave(h.getHours() - 9, 24)).toFixed(1)),
      weather_code: hours.map((h, i) => (i % 7 === 3 ? 2 : h.getHours() > 18 || h.getHours() < 7 ? 0 : 1)), precipitation_probability: hours.map((_, i) => (i > 14 ? 15 + i : 4)) },
    places: [{ name: 'Lisbon, Lisboa, PT', lat: 38.72, lon: -9.14 }, { name: 'Tokyo, JP', lat: 35.68, lon: 139.69 }, { name: 'Berlin, DE', lat: 52.52, lon: 13.4 }],
  };
}
export const air = () => ({ air: { european_aqi: 16, pm2_5: 4, pm10: 8, ozone: 62, nitrogen_dioxide: 9 }, place: 'Lisbon, Lisboa, PT' });
export const hn = () => { const t = Date.now(); return { items: [
  ['Show HN: A desk dashboard for the phone in your drawer', 412, 96, 40], ['Why I stopped running five different system monitors', 301, 144, 95], ['SQLite as an application file format, ten years on', 276, 88, 150],
  ['Learning Rust by rewriting my shell scripts', 210, 61, 210], ['The quiet joy of boring technology', 188, 73, 280], ['Ask HN: What do you keep on your second screen?', 164, 212, 330],
  ['A gentle introduction to eBPF for sysadmins', 143, 37, 420], ['Your homelab does not need Kubernetes', 131, 109, 510], ['Cutting a container image from 1 GB to 60 MB', 122, 41, 600], ['Open weather APIs worth knowing about', 97, 28, 700],
].map(([title, score, comments, mins], i) => ({ id: i + 1, title, url: `https://example.com/story/${i + 1}`, score, comments, by: 'demo', at: t - mins * 60000 })) }; };
export const feeds = () => { const t = Date.now(); return { configured: 2, errors: [], items: [
  { title: 'Release notes: faster startup and a calmer dashboard', link: 'https://example.com/a', at: t - 35 * 60000, source: 'The Example Gazette' },
  { title: 'Ten small habits that made my home network boring', link: 'https://example.com/b', at: t - 3 * 3600e3, source: 'Homelab Weekly' },
  { title: 'What changed in this month\'s security updates', link: 'https://example.com/c', at: t - 5 * 3600e3, source: 'The Example Gazette' },
  { title: 'A tour of the open-source tools on my desk', link: 'https://example.com/d', at: t - 9 * 3600e3, source: 'Homelab Weekly' },
  { title: 'Why local-first software keeps winning', link: 'https://example.com/e', at: t - 20 * 3600e3, source: 'The Example Gazette' },
] }; };
export const rates = () => ({ rates: { base: 'USD', date: day(new Date()), rates: { EUR: { rate: 0.9211, change: 0.18 }, GBP: { rate: 0.7864, change: -0.22 }, INR: { rate: 83.42, change: 0.05 }, JPY: { rate: 151.8, change: 0.41 } } } });
export function stocks(range = '1d') {
  const r = rng(11); const mk = (symbol, name, price, drift, vol) => { let v = price * (1 - drift * 40 / 100); const spark = Array.from({ length: 79 }, () => (v = Math.max(1, v * (1 + drift / 100 + (r() - 0.5) * vol / 100)))); const last = spark[78], prev = spark[0];
    return { symbol, name, exchange: 'NASDAQ', type: 'EQUITY', currency: 'USD', price: +last.toFixed(2), prev: +prev.toFixed(2), change: +(last - prev).toFixed(2), pct: +((last - prev) / prev * 100).toFixed(2), spark: spark.map((x) => +x.toFixed(2)), open: true, time: Math.floor(Date.now() / 1000) }; };
  const quotes = [mk('ACME', 'Acme Corporation', 182.4, 0.06, 0.5), mk('GLBX', 'Globex Industries', 94.1, -0.05, 0.6), mk('INTK', 'Initech Software', 41.7, 0.09, 0.8), mk('STRK', 'Stark Dynamics', 266.9, 0.03, 0.4)];
  return { range, symbols: quotes.map((q) => q.symbol), quotes };
}

// ---------------------------------------------------------------- code + AI pages
export function code() {
  const r = rng(3), end = new Date(); end.setHours(0, 0, 0, 0); const start = new Date(end); start.setDate(start.getDate() - (52 * 7 + end.getDay()));
  let total = 0, best = { d: '', c: 0, s: [], l: 0 };
  const weeks = Array.from({ length: 53 }, (_, w) => Array.from({ length: 7 }, (_, d) => { const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d); if (dt > end) return null;
    const work = dt.getDay() > 0 && dt.getDay() < 6, c = r() < (work ? 0.9 : 0.4) ? 1 + Math.floor(r() ** 1.5 * (work ? 13 : 6)) : 0, l = c === 0 ? 0 : c < 3 ? 1 : c < 6 ? 2 : c < 10 ? 3 : 4; total += c; const o = { d: day(dt), c, s: [], l }; if (c > best.c) best = { ...o }; return o; }).filter(Boolean));
  const today = weeks.at(-1).at(-1);
  return { github: { enabled: true, name: 'Demo Dev', user: 'demo-dev', total, current: 12, longest: 41, today: today.c, best, weeks, reviews: [
    { source: 'github', title: 'Add a dark theme to the settings page', url: 'https://example.com/pr/1042', repo: 'acme/web', number: 1042, author: 'sam-dev', updated: Date.now() - 1800 * 1000, draft: false },
    { source: 'github', title: 'Fix flaky upload test on CI', url: 'https://example.com/pr/1039', repo: 'acme/api', number: 1039, author: 'priya', updated: Date.now() - 9000 * 1000, draft: false },
    { source: 'github', title: 'Refactor the billing module (draft)', url: 'https://example.com/pr/1031', repo: 'acme/api', number: 1031, author: 'lee', updated: Date.now() - 40000 * 1000, draft: true },
    { source: 'github', title: 'Update dependencies for the winter release', url: 'https://example.com/pr/1027', repo: 'acme/web', number: 1027, author: 'bot-updates', updated: Date.now() - 86000 * 1000, draft: false },
  ] }, gitlab: { enabled: false } };
}
export function ai() {
  const r = rng(5), now = Math.floor(Date.now() / 1000), d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 8 }, (_, i) => { const dt = new Date(d0); dt.setDate(d0.getDate() - (7 - i)); const op = Math.round((2 + 7 * r()) * 1e6), so = Math.round((1 + 4 * r()) * 1e6), hk = Math.round(r() * 1e6);
    return { d: day(dt), tokens: op + so + hk, cache: Math.round((op + so) * 6), msgs: Math.round(60 + 160 * r()), in: Math.round((op + so) * 0.3), out: Math.round((op + so) * 0.05), models: { opus: op, sonnet: so, haiku: hk } }; });
  const sessions = ['acme-web', 'acme-api', 'homelab-notes', 'dashling', 'data-pipeline', 'blog'].flatMap((project, i) => [0, 1, 2].map((j) => ({ id: `s${i}${j}a1b2c3d4e5f6`, project, first: now - (i * 5 + j * 2 + 1) * 3600, last: now - (i * 5 + j * 2) * 3600 - 120, tokens: Math.round(2e5 + 3e6 * r()), cache: Math.round(2e6 * r()), msgs: Math.round(8 + 80 * r()), model: j === 1 ? 'sonnet' : 'opus' })));
  return { enabled: true, updated: now, claude: { last: now - 240, block: { start: now - 3 * 3600, end: now + 2 * 3600, tokens: 4800000, cache: 21000000, msgs: 142 }, days,
    models: { opus: days.reduce((a, d) => a + d.models.opus, 0), sonnet: days.reduce((a, d) => a + d.models.sonnet, 0), haiku: days.reduce((a, d) => a + d.models.haiku, 0), other: 0 }, sessions,
    limits: { updated: now - 90, five_hour: { pct: 42, reset: now + 2 * 3600 }, seven_day: { pct: 18, reset: now + 4 * 86400 } } } };
}

// ---------------------------------------------------------------- small stored widgets
export const store = () => ({
  clocks: ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo'],
  checklist: { day: day(new Date()), items: [{ t: 'Stretch for five minutes', done: true }, { t: 'Take vitamins', done: true }, { t: 'Review open pull requests', done: false }, { t: 'Water the plants', done: false }, { t: 'Plan tomorrow', done: false }] },
  counters: [{ name: 'Water', n: 5 }, { name: 'Coffee', n: 2 }, { name: 'Focus blocks', n: 3 }],
  countdown: { label: 'Launch day', at: `${day(new Date(Date.now() + 17 * 86400e3))}T09:00` },
  feeds: ['https://example.com/feed.xml'], rates: null, photoframe: null,
});
export const PHOTOS = ['sunset-hills.jpg', 'mountain-lake.jpg', 'harbour-night.jpg', 'desert-road.jpg', 'pine-forest.jpg', 'coast-morning.jpg'];
const PAL = { 'sunset-hills.jpg': ['#ff9a5a', '#c2417a', '#2b1b4d', '#1b1033'], 'mountain-lake.jpg': ['#9bd3ff', '#4c8fd6', '#1d3f72', '#0e2442'], 'harbour-night.jpg': ['#1c2a5a', '#3a2f7a', '#0b1030', '#050816'], 'desert-road.jpg': ['#ffd68a', '#f29b52', '#9b4a2c', '#4a2216'], 'pine-forest.jpg': ['#bfe8c5', '#5fae7a', '#1f5a45', '#0c2b25'], 'coast-morning.jpg': ['#ffe3c4', '#ffb3a1', '#6fb6c9', '#2a6c85'] };
export function photoSvg(name) { const [a, b, c, d] = PAL[name] || PAL[PHOTOS[0]]; return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#s)"/><circle cx="1130" cy="520" r="120" fill="${a}" opacity=".85"/><path d="M0 700 C260 560 430 640 640 580 S1010 470 1220 560 1480 640 1600 600 V1000 H0Z" fill="${c}" opacity=".9"/><path d="M0 820 C300 720 520 800 800 740 S1280 700 1600 780 V1000 H0Z" fill="${d}"/></svg>`; }
export const artworkSvg = () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0b3d"/><stop offset=".6" stop-color="#b8348a"/><stop offset="1" stop-color="#ff8a5c"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="215" r="92" fill="#ffd36e"/><rect y="215" width="400" height="185" fill="#1a0b3d"/><g stroke="#ff5cc8" stroke-width="2" opacity=".8"><path d="M0 250H400M0 285H400M0 330H400"/><path d="M200 215L40 400M200 215L120 400M200 215L200 400M200 215L280 400M200 215L360 400"/></g></svg>';
