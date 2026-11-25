import { icon, hydrate } from './icons.js';
import { WIDGETS, DEFAULT_LAYOUT } from './widgets.js';
import { mountExtras } from './extras.js';
const $ = id => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
// one-time carry-over of settings saved under the app's old name (pb_*), so nobody has to log in again
try { for (const k of Object.keys(localStorage)) if (k.startsWith('pb_') && localStorage.getItem('dl_' + k.slice(3)) === null) localStorage.setItem('dl_' + k.slice(3), localStorage.getItem(k)); } catch {}
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let token = store.get('dl_token') || '';
hydrate();

// ---------------------------------------------------------------- api
const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  if (res.status === 401) { store.set('dl_token', ''); token = ''; showLogin('Please pair this device again.'); throw new Error('unauthorized'); }
  return res.json();
}

// ---------------------------------------------------------------- login
let tokenMode = false, lastPair = 0;
function pairStart() { if (Date.now() - lastPair > 30_000) { lastPair = Date.now(); fetch('/api/pair/start', { method: 'POST' }).catch(() => {}); } }
function loginMode(tok) {
  tokenMode = tok; $('token').hidden = !tok; $('code').hidden = tok; $('token').required = tok; $('code').required = !tok;
  $('login-alt').textContent = tok ? 'Use a pairing code instead' : 'Use access token instead';
  $('login-hint').hidden = tok; if (!tok) pairStart();
}
function showLogin(msg = '') { $('shell').hidden = true; $('login').hidden = false; $('login-err').textContent = msg; stopPolling(); loginMode(tokenMode); }
$('login-alt').addEventListener('click', () => loginMode(!tokenMode));
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!tokenMode) {
    const res = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('code').value }) });
    if (res.status === 429) return showLogin('Too many attempts, wait a minute.');
    if (!res.ok) { lastPair = 0; $('code').value = ''; showLogin('Wrong or expired code. A new one is in the terminal.'); return; }
    token = (await res.json()).token; store.set('dl_token', token); return start();
  }
  token = $('token').value.trim();
  const res = await fetch('/api/stats', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) return showLogin('Token rejected.');
  if (res.status === 429) return showLogin('Too many attempts, wait a minute.');
  store.set('dl_token', token); start();
});

// ---------------------------------------------------------------- pager (swipe, dots, arrows, keys)
const pager = $('pager'), bin = $('bin'), CAT = new Map(WIDGETS.map(w => [w.id, w]));
let dockBtns = [], TITLES = [], PAGES = [], idx = 0, layoutRev = '';
const pageHas = (i, w) => Boolean(PAGES[i]?.ws.includes(w));
const pageOf = w => PAGES.findIndex(p => p.ws.includes(w));

// The pages, dock and widget order come from the layout saved by the admin page (or the default). Widgets are
// tagged data-w in index.html; applying a layout just moves those elements, so everything bound to them keeps working.
function applyLayout(layout, rev = '') {
  const keep = PAGES[idx]?.id;
  bin.append($('code-dot'), $('inbox-dot'));
  $$('[data-w]').forEach(w => bin.append(w));
  pager.replaceChildren(); $$('#dock button').forEach(b => b.remove());
  PAGES = layout.pages.map((p, n) => {
    const sec = el('section', 'page'), ws = [];
    sec.dataset.id = p.id;
    for (const it of p.widgets) {
      const w = document.querySelector(`[data-w="${it.id}"]`), def = CAT.get(it.id);
      if (!w || !def) continue;
      w.style.removeProperty('--w'); if (def.resize && it.w) w.style.setProperty('--w', it.w);
      sec.append(w); ws.push(it.id);
    }
    pager.append(sec);
    const b = el('button'), ic = el('span'); b.dataset.i = n; b.setAttribute('aria-label', p.title); ic.dataset.icon = p.icon;
    b.append(ic, el('i', '', p.title));
    if (ws.includes('code')) b.append($('code-dot')); if (ws.includes('inbox')) b.append($('inbox-dot'));
    b.addEventListener('click', () => go(n));
    $('dock').append(b);
    return { id: p.id, title: p.title, ws };
  });
  hydrate($('dock')); hydrate(pager);
  dockBtns = $$('#dock button'); TITLES = PAGES.map(p => p.title); layoutRev = rev;
  const at = PAGES.findIndex(p => p.id === keep);
  go(at >= 0 ? at : Math.min(idx, PAGES.length - 1), false); requestAnimationFrame(moveLens);
}
async function syncLayout(first) {
  let L = null, rev = '';
  try { const r = await api('/api/layout'); L = r.layout; rev = r.rev; store.set('dl_layout', JSON.stringify(r)); }
  catch { if (!first) return; try { const r = JSON.parse(store.get('dl_layout')); L = r.layout; rev = r.rev; } catch {} }
  if (!L) { L = DEFAULT_LAYOUT; rev = 'default'; }
  if (first || rev !== layoutRev) applyLayout(L, rev);
}
function go(i, smooth = true) { i = Math.max(0, Math.min(TITLES.length - 1, i)); pager.scrollTo({ left: i * pager.clientWidth, behavior: smooth ? 'smooth' : 'auto' }); if (!smooth) setIdx(i); }
function moveLens() {       // slide the glass selection pill under the active dock item (horizontal dock, or vertical rail on landscape phones)
  const b = dockBtns[idx], l = $('lens'), d = $('dock'); if (!b || !l) return;
  if (getComputedStyle(d).flexDirection === 'column') {
    l.style.width = ''; l.style.height = `${b.offsetHeight}px`; l.style.transform = `translateY(${b.offsetTop}px)`;
    if (d.scrollHeight > d.clientHeight) d.scrollTo({ top: b.offsetTop - (d.clientHeight - b.offsetHeight) / 2, behavior: 'smooth' });
    return;
  }
  l.style.height = ''; l.style.width = `${b.offsetWidth}px`; l.style.transform = `translateX(${b.offsetLeft}px)`;
  if (d.scrollWidth > d.clientWidth) d.scrollTo({ left: b.offsetLeft - (d.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
}
function setIdx(i) {
  idx = i; $('page-title').textContent = TITLES[i]; store.set('dl_page', i); if (typeof X !== 'undefined' && !$('shell').hidden) X.refresh();
  if (typeof pollFans === 'function' && !$('shell').hidden) { pollFans(); pollTemps(); pollPower(); pollDisplay(); pollCalendar(); pollDocker(); pollObs(); }
  dockBtns.forEach((b, n) => b.classList.toggle('on', n === i));
  $('nav-prev').classList.toggle('off', i === 0); $('nav-next').classList.toggle('off', i === TITLES.length - 1);
  moveLens();
  if (pageHas(i, 'inbox')) markInboxSeen();
  if (pageHas(i, 'stocks') && typeof loadStocks === 'function') loadStocks();
}
pager.addEventListener('scroll', () => { const i = Math.round(pager.scrollLeft / (pager.clientWidth || 1)); if (i !== idx) setIdx(i); }, { passive: true });
window.addEventListener('resize', () => { go(idx, false); moveLens(); });
$('nav-prev').addEventListener('click', () => go(idx - 1));
$('nav-next').addEventListener('click', () => go(idx + 1));
document.addEventListener('keydown', e => {
  if (/input|textarea/i.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') go(idx - 1); if (e.key === 'ArrowRight') go(idx + 1);
});

// ---------------------------------------------------------------- rings
const R = 40, C = 2 * Math.PI * R, NS = 'http://www.w3.org/2000/svg';
function makeRing(host) {
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 100 100');
  const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
  mk('circle', { class: 'track', cx: 50, cy: 50, r: R });
  const bar = mk('circle', { class: 'bar', cx: 50, cy: 50, r: R, 'stroke-dasharray': `0 ${C}` });
  const txt = el('span', 'rt', '--');
  host.replaceChildren(svg, txt);
  return (pct, label, tone) => {
    if (pct == null) { txt.textContent = '--'; bar.setAttribute('stroke-dasharray', `0 ${C}`); return; }
    const p = Math.max(0, Math.min(100, pct));
    bar.setAttribute('stroke-dasharray', `${(p / 100) * C} ${C}`);
    bar.setAttribute('class', 'bar' + (tone ? ' ' + tone : p >= 90 ? ' bad' : p >= 75 ? ' warn' : ''));
    txt.textContent = label ?? `${Math.round(p)}%`;
  };
}
const rings = {};
for (const k of ['cpu', 'mem', 'disk', 'batt']) rings[k] = [$(`r-${k}-s`), $(`r-${k}`)].filter(Boolean).map(makeRing);
const setRing = (k, ...a) => rings[k].forEach(f => f(...a));
const gb = b => (b / 1073741824).toFixed(b >= 107374182400 ? 0 : 1) + ' GB';
const uptime = boot => { const s = Math.max(0, Date.now() / 1000 - boot), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };


// ---------------------------------------------------------------- history charts (CPU / memory / network)
const N = 120;                                   // samples shown (~5 min at the 2.5 s poll)
function makeChart(svg, nSeries) {
  svg.setAttribute('viewBox', '0 0 300 100'); svg.setAttribute('preserveAspectRatio', 'none');
  const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
  for (const y of [25, 50, 75]) mk('line', { class: 'grid', x1: 0, x2: 300, y1: y, y2: y });
  const areas = [], lines = [];
  for (let i = 0; i < nSeries; i++) { areas.push(mk('path', { class: `area a${i}` })); lines.push(mk('path', { class: `ln l${i}` })); }
  return (series, max) => series.forEach((vals, i) => {
    const pts = [], len = vals.length;
    vals.forEach((v, k) => { if (v != null) pts.push([300 - (len - 1 - k) * (300 / (N - 1)), 100 - Math.max(0, Math.min(100, v / max * 100))]); });
    if (pts.length < 2) { areas[i].removeAttribute('d'); lines[i].removeAttribute('d'); return; }
    const d = 'M' + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L');
    lines[i].setAttribute('d', d); areas[i].setAttribute('d', `${d}L${pts.at(-1)[0].toFixed(1)} 100L${pts[0][0].toFixed(1)} 100Z`);
  });
}
const chartCpu = makeChart($('g-cpu'), 1), chartMem = makeChart($('g-mem'), 1), chartNet = makeChart($('g-net'), 2);
const rate = b => b == null ? '--' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB/s` : b >= 1024 ? `${Math.round(b / 1024)} KB/s` : `${Math.round(b)} B/s`;
const last = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
function drawHistory(hist) {
  const h = (hist || []).slice(-N), col = k => h.map(x => x[k]);
  const cpu = col('cpu'), mem = col('mem'), rx = col('rx'), tx = col('tx');
  chartCpu([cpu], 100); chartMem([mem], 100);
  const peak = Math.max(102400, ...rx.filter(v => v != null), ...tx.filter(v => v != null)) * 1.15;
  chartNet([rx, tx], peak);
  const c = last(cpu), m = last(mem);
  $('v-cpu').textContent = c == null ? '--' : `${Math.round(c)}%`; $('v-mem').textContent = m == null ? '--' : `${Math.round(m)}%`;
  $('v-rx').textContent = rate(last(rx)); $('v-tx').textContent = rate(last(tx));
  $('net-sub').textContent = `scale 0 – ${rate(peak)}`;
}

// ---------------------------------------------------------------- stats
function setStatus(text, cls) { const s = $('status'); s.textContent = text; s.className = 'badge ' + (cls || ''); }
const fill = s => s.style.setProperty('--pct', `${(s.value - s.min) / (s.max - s.min) * 100}%`);
let volTouching = false;
async function pollStats() {
  try {
    const r = await api('/api/stats');
    if (!r.host) { setStatus(r.error ? 'host unreachable' : 'no host', 'bad'); return; }
    setStatus('live', 'ok');
    const h = r.host; $('host-name').textContent = h.name; drawHistory(r.history);
    setRing('cpu', h.cpu.idle == null ? null : 100 - h.cpu.idle);
    $('cpu-sub').textContent = h.cpu.user == null ? '' : `user ${h.cpu.user}% · system ${h.cpu.sys}% · ${h.cores} cores`;
    if (h.mem.total) { setRing('mem', h.mem.used / h.mem.total * 100); $('mem-sub').textContent = `${gb(h.mem.used)} of ${gb(h.mem.total)}`; }
    if (h.disk.total) { setRing('disk', h.disk.used / h.disk.total * 100); $('disk-sub').textContent = `${gb(h.disk.used)} of ${gb(h.disk.total)}`; }
    const b = h.battery;
    if (b) { setRing('batt', b.pct, undefined, b.state.startsWith('charg') || b.state === 'charged' ? 'ok' : b.pct < 10 ? 'bad' : b.pct < 25 ? 'warn' : 'ok'); $('batt-sub').textContent = `${b.pct}% · ${b.state}${b.time ? ' · ' + b.time + ' left' : ''}`; $('batt-bar').style.width = `${b.pct}%`; }
    else { setRing('batt', null); $('batt-sub').textContent = 'no battery'; $('batt-bar').style.width = '0%'; }
    const cb = $('chip-batt'); cb.hidden = !b; if (b) cb.textContent = `${b.pct}% ${b.state}`;
    const up = h.boot ? uptime(h.boot) : '--'; $('up-val').textContent = up; $('up-sub').textContent = h.boot ? `since ${new Date(h.boot * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '';
    $('load-val').textContent = h.load ? h.load[0].toFixed(2) : '--'; $('load-sub').textContent = h.load ? `5m ${h.load[1].toFixed(2)} · 15m ${h.load[2].toFixed(2)} · ${h.cores} cores` : '';
    if (!killing) drawProcs(h.procs || []);
    const cu = $('chip-up'); cu.hidden = !h.boot; if (h.boot) cu.textContent = `up ${uptime(h.boot)}`;
    if (h.volume != null && !volTouching) { const v = $('volume'); v.value = h.volume; fill(v); $('vol-sub').textContent = h.volume; $('mute-btn').replaceChildren(icon(h.volume === 0 ? 'volume-x' : 'volume')); }
  } catch (e) { if (e.message !== 'unauthorized') setStatus('offline', 'bad'); }
}

// top processes: tap ✕ on one of your own, then Quit (graceful) or Force; processes owned by the system have no button
let killing = null, procMsgT = null;
function procMsg(t) { $('procs-msg').textContent = t; clearTimeout(procMsgT); procMsgT = setTimeout(() => { $('procs-msg').textContent = ''; }, 4000); }
async function killProc(pid, force) {
  killing = null;
  try { const r = await api('/api/proc/kill', { method: 'POST', body: JSON.stringify({ pid, force }) }); procMsg(r.error ? r.error : force ? 'Force-killed' : 'Asked to quit'); }
  catch (e) { if (e.message !== 'unauthorized') procMsg('Could not reach your computer'); }
  setTimeout(pollStats, 700);
}
let lastProcs = [];
function drawProcs(list) {
  lastProcs = list;
  $('procs-list').replaceChildren(...list.map(p => {
    const li = el('li'); li.append(el('span', 'pn', p.name), el('b', '', `${p.cpu.toFixed(1)}%`), el('span', 'muted', `${p.mem.toFixed(1)}%`));
    if (killing === p.pid) {
      li.classList.add('confirm'); li.replaceChildren(el('span', 'pn', `Quit ${p.name}?`));
      const mk = (t, cls, fn) => { const b = el('button', 'btn btn-sm ' + cls, t); b.addEventListener('click', fn); return b; };
      li.append(mk('Quit', 'btn-secondary', () => killProc(p.pid, false)), mk('Force', 'btn-secondary', () => killProc(p.pid, true)), mk('Cancel', 'btn-ghost', () => { killing = null; drawProcs(lastProcs); }));
    } else if (p.mine) { const b = el('button', 'proc-x', '✕'); b.setAttribute('aria-label', `Quit ${p.name}`); b.addEventListener('click', () => { killing = p.pid; drawProcs(lastProcs); }); li.append(b); }
    else li.append(el('span', 'proc-x off', ''));
    return li;
  }));
}
const tcls = v => v >= 95 ? 'bad' : v >= 80 ? 'warn' : '';
async function pollTemps() {
  if (!pageHas(idx, 'temps')) return;          // only ask the Mac when this page shows the widget
  try {
    const { temps } = await api('/api/temps'), box = $('temp-body'), sub = $('temp-sub');
    const msg = m => { box.replaceChildren(el('p', 'muted empty', m)); sub.textContent = ''; };
    if (!temps) return msg('no host');
    if (temps.setup) return msg('Needs the sensor reader: run  ./host/dashling.sh helpers');
    if (temps.none || !(temps.p.length + temps.e.length)) return msg('No temperature sensors found on this computer.');
    const all = [...temps.p, ...temps.e]; sub.textContent = `hottest ${Math.max(...all)}°`;
    // one compact grid: P = performance cores, E = efficiency cores, G = GPU average
    const grid = el('div', 'tgrid');
    const add = (vals, prefix) => vals.forEach((v, i) => { const c = el('div', 'tc ' + tcls(v)); c.append(el('span', 'muted', vals.length > 1 || prefix !== 'G' ? `${prefix}${i + 1}` : 'GPU'), el('b', '', `${v}°`)); grid.append(c); });
    add(temps.p, 'P'); add(temps.e, 'E'); if (temps.gpu != null) add([temps.gpu], 'G');
    const legend = el('p', 'muted sub', 'P performance · E efficiency · GPU average');
    box.replaceChildren(grid, legend);
  } catch {}
}
// ---- power, battery health, Computer controls, calendar, docker: each polls only while its page is on screen
const fmtW = v => v == null ? '--' : `${Math.abs(v) >= 10 ? Math.round(v) : v.toFixed(1)} W`;
async function pollPower() {
  if (!pageHas(idx, 'power') && !pageHas(idx, 'batt-health')) return;
  try {
    const { power: p } = await api('/api/power'); if (!p) return;
    $('pw-val').textContent = fmtW(p.sysW);
    $('pw-sub').textContent = p.ac ? 'on power' : 'on battery';
    $('pw-detail').textContent = [p.ac && p.inW != null ? `charger ${fmtW(p.inW)}${p.ratedW ? ` of ${p.ratedW} W` : ''}` : '', p.battW != null && Math.abs(p.battW) >= 0.5 ? `battery ${p.battW < 0 ? 'charging' : 'draining'} ${fmtW(Math.abs(p.battW))}` : ''].filter(Boolean).join(' · ');
    $('bh-val').textContent = p.health == null ? '--' : `${p.health}%`; $('bh-bar').style.width = `${p.health ?? 0}%`;
    $('bh-sub').textContent = p.health == null ? '' : p.health >= 80 ? 'good' : p.health >= 70 ? 'ok' : 'service soon';
    $('bh-detail').textContent = [p.cycles != null ? `${p.cycles} cycles` : '', p.tempC != null ? `${p.tempC}°C` : ''].filter(Boolean).join(' · ');
  } catch {}
}
let ctlMsgT = null;
const ctlMsg = t => { $('ctl-msg').textContent = t; clearTimeout(ctlMsgT); ctlMsgT = setTimeout(() => { $('ctl-msg').textContent = ''; }, 4000); };
async function ctl(action, value) {
  try { const r = await api('/api/ctl', { method: 'POST', body: JSON.stringify({ action, value }) }); if (r.error) { ctlMsg(r.error); return false; } return true; }
  catch (e) { if (e.message !== 'unauthorized') ctlMsg('Could not reach your computer'); return false; }
}
let brightTouch = false, brightSend = null;
const bright = $('bright');
bright.addEventListener('pointerdown', () => { brightTouch = true; });
bright.addEventListener('input', () => { fill(bright); $('bright-val').textContent = `${bright.value}%`; clearTimeout(brightSend); brightSend = setTimeout(() => ctl('brightness', Number(bright.value)), 150); });
bright.addEventListener('change', () => setTimeout(() => { brightTouch = false; }, 1500));
$('btn-lock').addEventListener('click', async () => { if (await ctl('shortcut', 'Dashling Lock').catch(() => false)) return; if (await ctl('lock')) ctlMsg('Locking…'); });
$('btn-dnd').addEventListener('click', async () => { if (await ctl('shortcut', 'Dashling DND')) ctlMsg('Toggled Do Not Disturb'); else if (!$('ctl-msg').textContent) ctlMsg('Create a Shortcut named “Dashling DND”'); });
async function pollDisplay() {
  if (!pageHas(idx, 'controls') || brightTouch) return;
  try { const { display: d } = await api('/api/display'); if (!d || d.brightness == null) { bright.disabled = true; $('bright-val').textContent = 'n/a'; return; }
    bright.disabled = false; bright.value = d.brightness; fill(bright); $('bright-val').textContent = `${d.brightness}%`; } catch {}
}
const clock = s => new Date(s * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayName = s => { const d = new Date(s * 1000), t = new Date(); return d.toDateString() === t.toDateString() ? 'Today' : new Date(t.getTime() + 864e5).toDateString() === d.toDateString() ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short' }); };
async function pollCalendar() {
  if (!pageHas(idx, 'calendar')) return;
  try {
    const { calendar: c } = await api('/api/calendar'), list = $('cal-list');
    const msg = m => list.replaceChildren(el('li', 'muted empty', m));
    if (!c) return msg('no host');
    if (c.unsupported) return msg('Calendar events are not available on this operating system yet.');
    if (c.setup) return msg('Needs the helper install: run  ./host/dashling.sh helpers');
    if (c.denied) return msg('Calendar access is off for the SSH helper. Allow it in System Settings > Privacy > Calendars.');
    $('cal-sub').textContent = c.events.length ? `${c.events.length} upcoming` : '';
    if (!c.events.length) return msg('Nothing in the next two days.');
    list.replaceChildren(...c.events.map(e => { const li = el('li'); li.append(el('span', 'ev-t', e.allDay ? 'all day' : clock(e.start)), el('span', 'ev-n', e.title || '(no title)'), el('span', 'muted', dayName(e.start))); return li; }));
  } catch {}
}
// ---- OBS: record / stream / scenes. Going live asks for a second tap, because it is public.
let obsMsgT = null, obsLiveArm = null, obsState = null;
const obsMsg = t => { $('obs-msg').textContent = t; clearTimeout(obsMsgT); obsMsgT = setTimeout(() => { $('obs-msg').textContent = ''; }, 4500); };
async function obsDo(action, value) {
  try { const r = await api('/api/obs', { method: 'POST', body: JSON.stringify({ action, value }) }); if (r.error) obsMsg(r.error); }
  catch (e) { if (e.message !== 'unauthorized') obsMsg('Could not reach your computer'); }
  setTimeout(pollObs, 500);
}
$('obs-rec').addEventListener('click', () => obsDo(obsState?.recording ? 'record-stop' : 'record-start'));
$('obs-pause').addEventListener('click', () => obsDo('record-pause'));
$('obs-live').addEventListener('click', () => {
  if (obsState?.streaming) return obsDo('stream-stop');
  if (obsLiveArm) { clearTimeout(obsLiveArm); obsLiveArm = null; $('obs-live').textContent = 'Go live'; return obsDo('stream-start'); }
  $('obs-live').textContent = 'Tap again to go live';
  obsLiveArm = setTimeout(() => { obsLiveArm = null; $('obs-live').textContent = 'Go live'; }, 4000);
});
async function pollObs() {
  if (!pageHas(idx, 'obs')) return;
  try {
    const { obs: o } = await api('/api/obs'), sc = $('obs-scenes'), sub = $('obs-sub'); obsState = o;
    const off = (m, sd) => { $('obs-rec').disabled = $('obs-live').disabled = true; $('obs-rec').textContent = 'Record'; $('obs-live').textContent = 'Go live'; $('obs-pause').hidden = true; sc.replaceChildren(el('p', 'muted empty', m)); sub.textContent = sd || ''; };
    if (!o || o.disabled) return off('OBS is not configured.');
    if (o.auth) return off('OBS needs its WebSocket password: set OBS_PASSWORD for the container.', 'locked');
    if (!o.up) return off('OBS is not running, or its WebSocket server is off (OBS > Tools > WebSocket Server Settings).', 'offline');
    $('obs-rec').disabled = $('obs-live').disabled = false;
    $('obs-rec').textContent = o.recording ? `Stop recording ${o.recTime}` : 'Record'; $('obs-rec').classList.toggle('rec', o.recording);
    $('obs-pause').hidden = !o.recording; $('obs-pause').textContent = o.paused ? 'Resume' : 'Pause';
    if (!obsLiveArm) $('obs-live').textContent = o.streaming ? `Stop stream ${o.streamTime}` : 'Go live'; $('obs-live').classList.toggle('rec', o.streaming);
    sub.textContent = o.streaming ? '● LIVE' : o.recording ? (o.paused ? 'paused' : '● REC') : `OBS ${o.version}`;
    sc.replaceChildren(...o.scenes.map(n => { const b = el('button', 'btn btn-sm ' + (n === o.scene ? 'btn-default' : 'btn-secondary'), n); b.addEventListener('click', () => obsDo('scene', n)); return b; }));
  } catch {}
}
let dkMsgT = null;
async function dockerAct(act, name) {
  $('dk-msg').textContent = `${act}…`;
  try { const r = await api('/api/ctl', { method: 'POST', body: JSON.stringify({ action: 'docker', value: `${act} ${name}` }) }); $('dk-msg').textContent = r.error || `${name}: ${act} done`; }
  catch (e) { if (e.message !== 'unauthorized') $('dk-msg').textContent = 'Could not reach your computer'; }
  clearTimeout(dkMsgT); dkMsgT = setTimeout(() => { $('dk-msg').textContent = ''; }, 4000); pollDocker(true);
}
let dkBusy = false;
async function pollDocker(force) {
  if (!pageHas(idx, 'docker') || (dkBusy && !force)) return;
  try {
    const { docker: d } = await api('/api/docker'), list = $('dk-list');
    if (!d) { list.replaceChildren(el('li', 'muted empty', 'no host')); return; }
    if (d.down) { list.replaceChildren(el('li', 'muted empty', 'Docker is not running on your computer.')); $('dk-sub').textContent = ''; return; }
    const up = d.containers.filter(c => c.state === 'running').length; $('dk-sub').textContent = `${up} running · ${d.containers.length} total`;
    if (!d.containers.length) { list.replaceChildren(el('li', 'muted empty', 'No containers.')); return; }
    list.replaceChildren(...d.containers.map(c => {
      const li = el('li'), on = c.state === 'running'; li.append(el('span', 'dk-dot ' + (on ? 'on' : '')), el('span', 'dk-n', c.name), el('span', 'muted dk-s', c.status));
      if (!c.self) { const mk = (t, act, label) => { const b = el('button', 'proc-x', t); b.setAttribute('aria-label', `${label} ${c.name}`); b.addEventListener('click', () => dockerAct(act, c.name)); return b; };
        li.append(...(on ? [mk('↻', 'restart', 'Restart'), mk('■', 'stop', 'Stop')] : [mk('▶', 'start', 'Start')])); }
      return li; }));
  } catch {}
}
async function pollFans() {
  if (!pageHas(idx, 'fans')) return;
  try {
    const { fans } = await api('/api/fans'); const box = $('fan-list'), sub = $('fan-sub');
    if (!fans) { box.replaceChildren(el('p', 'muted empty', 'no host')); sub.textContent = ''; return; }
    if (fans.setup) { box.replaceChildren(el('p', 'muted empty', 'Needs a one-time setup: run  ./host/dashling.sh helpers')); sub.textContent = ''; return; }
    if (fans.none || !fans.rpm.length) { box.replaceChildren(el('p', 'muted empty', 'This computer reports no fans (or they are idle at 0 rpm).')); sub.textContent = ''; return; }
    sub.textContent = fans.rpm.length > 1 ? `${fans.rpm.length} fans` : '';
    box.replaceChildren(...fans.rpm.map((r, i) => { const d = el('div', 'fan'); const bar = el('div', 'progress'); const f = el('i'); f.style.width = `${Math.min(100, r / 65)}%`; bar.append(f);
      d.append(el('b', '', `${r.toLocaleString()} rpm`), bar); return d; }));
  } catch {}
}

// ---------------------------------------------------------------- actions (deck, media keys)
let msgT = null;
function deckMsg(t) { $('deck-msg').textContent = t; clearTimeout(msgT); msgT = setTimeout(() => { $('deck-msg').textContent = ''; }, 3500); }
async function act(action, name, value) {
  try { const r = await api('/api/action', { method: 'POST', body: JSON.stringify({ action, name, value }) }); if (r.error) deckMsg(r.error); else if (action !== 'seek') setTimeout(pollNP, 400); }
  catch (e) { if (e.message !== 'unauthorized') deckMsg('Could not reach your computer'); }
}
function bindActs(root = document) { $$('[data-act]', root).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); act(b.dataset.act); })); }
bindActs();

// volume
const vol = $('volume'); let volSend = null;
vol.addEventListener('pointerdown', () => { volTouching = true; });
vol.addEventListener('input', () => { fill(vol); $('vol-sub').textContent = vol.value; clearTimeout(volSend);
  volSend = setTimeout(() => api('/api/volume', { method: 'POST', body: JSON.stringify({ level: Number(vol.value) }) }).catch(() => {}), 150); });
vol.addEventListener('change', () => setTimeout(() => { volTouching = false; }, 1500));

// ---------------------------------------------------------------- now playing
let NP = null, npAt = 0, artKey = null, artUrl = null, seeking = false;
const mmss = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
async function pollNP() {
  try {
    const { np } = await api('/api/nowplaying');
    NP = np; npAt = performance.now();
    $$('.np-title').forEach(n => { n.textContent = np ? np.title : 'Nothing playing'; });
    $$('.np-artist').forEach(n => { n.textContent = np ? np.artist : 'Play something on your computer'; });
    $$('.np-album').forEach(n => { n.textContent = np ? [np.album, np.source].filter(Boolean).join(' · ') : ''; });
    $$('.np-toggle').forEach(n => n.replaceChildren(icon(np?.playing ? 'pause' : 'play')));
    $$('.np-seek').forEach(s => { s.max = np?.duration || 100; s.disabled = !np?.duration; });
    $$('.np-dur').forEach(n => { n.textContent = np?.duration ? mmss(np.duration) : '0:00'; });
    if (!np) { setArt(null); artKey = null; }
    else if (np.key !== artKey) { artKey = np.key; loadArt(); }
  } catch {}
}
function tickNP() {
  const bar = $$('.np-bar'), seeks = $$('.np-seek'), els = $$('.np-elapsed');
  if (!NP || NP.elapsed == null) { bar.forEach(b => { b.style.width = '0%'; }); return; }
  const el_ = Math.min(NP.duration || Infinity, NP.elapsed + (NP.playing ? (performance.now() - npAt) / 1000 : 0));
  const pct = NP.duration ? el_ / NP.duration * 100 : 0;
  bar.forEach(b => { b.style.width = `${pct}%`; });
  if (!seeking) { seeks.forEach(s => { s.value = el_; fill(s); }); els.forEach(n => { n.textContent = mmss(el_); }); }
}
setInterval(tickNP, 250);
$$('.np-seek').forEach(s => {
  s.addEventListener('pointerdown', () => { seeking = true; });
  s.addEventListener('input', () => { fill(s); $$('.np-elapsed').forEach(n => { n.textContent = mmss(s.value); }); });
  s.addEventListener('change', () => { const v = Math.round(Number(s.value)); if (NP) { NP.elapsed = v; npAt = performance.now(); } act('seek', undefined, v); setTimeout(() => { seeking = false; }, 600); });
});
const toMedia = () => { const i = pageOf('media'); if (i >= 0) go(i); };
$('mini-np').addEventListener('click', toMedia);
$('mini-np').addEventListener('keydown', e => { if (e.key === 'Enter') toMedia(); });

async function loadArt() {
  try {
    const res = await fetch('/api/artwork', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return setArt(null);
    setArt(URL.createObjectURL(await res.blob()));
  } catch { setArt(null); }
}
function setArt(url) {
  if (artUrl) URL.revokeObjectURL(artUrl);
  artUrl = url;
  $$('.art-img').forEach(i => { if (url) { i.src = url; i.hidden = false; } else { i.removeAttribute('src'); i.hidden = true; } });
  if (!url) return document.documentElement.style.removeProperty('--glow');
  const img = new Image(); img.onload = () => {            // average the artwork colour for the ambient glow
    const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const m = Math.max(d[i], d[i + 1], d[i + 2]); if (m > 50) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } }
    if (n) document.documentElement.style.setProperty('--glow', `${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)}`);
  }; img.src = url;
}

// ---------------------------------------------------------------- weather
const WMO = c => c === 0 ? ['☀️', 'Clear'] : c <= 2 ? ['⛅', 'Partly cloudy'] : c === 3 ? ['☁️', 'Overcast'] : c <= 48 ? ['🌫️', 'Fog']
  : c <= 57 ? ['🌦️', 'Drizzle'] : c <= 67 ? ['🌧️', 'Rain'] : c <= 77 ? ['❄️', 'Snow'] : c <= 82 ? ['🌧️', 'Showers'] : c <= 86 ? ['🌨️', 'Snow showers'] : ['⛈️', 'Thunderstorm'];
const X = mountExtras({ api, $, el, pageHas, getIdx: () => idx, WMO, token: () => token });
async function loadWeather() {
  const body = $('wx-body');
  try {
    const w = await api('/api/weather');
    $('wx-units').textContent = w.units === 'f' ? '°F' : '°C';
    body.replaceChildren(); X.onWeather(w);
    if (!w.location) { body.append(el('span', 'wx-meta', 'No city set. Tap "City" to choose one.')); return; }
    const [ico, label] = WMO(w.current.weather_code);
    const now = el('div', 'wx-now'), info = el('div');
    info.append(el('div', 'wx-temp', `${Math.round(w.current.temperature_2m)}°`), el('div', 'wx-meta', `${label} · feels ${Math.round(w.current.apparent_temperature)}°`), el('div', 'wx-meta', w.location.name));
    now.append(el('span', 'wx-ico', ico), info);
    const days = el('div', 'wx-days');
    for (let i = 1; i < Math.min(4, w.daily.time.length); i++) {
      const d = el('div'), dt = new Date(w.daily.time[i] + 'T12:00');
      d.append(el('span', '', dt.toLocaleDateString([], { weekday: 'short' })), el('b', '', WMO(w.daily.weather_code[i])[0]), el('span', '', `${Math.round(w.daily.temperature_2m_max[i])}° ${Math.round(w.daily.temperature_2m_min[i])}°`));
      days.append(d);
    }
    body.append(now, days);
  } catch (e) { if (e.message !== 'unauthorized') body.replaceChildren(el('span', 'wx-meta', 'Weather unavailable right now.')); }
}
$('wx-edit').addEventListener('click', () => { const f = $('wx-form'); f.hidden = !f.hidden; if (!f.hidden) $('wx-q').focus(); });
window.addEventListener('dl-weather-changed', () => loadWeather());
$('wx-units').addEventListener('click', async () => { await api('/api/weather/location', { method: 'PUT', body: JSON.stringify({ units: $('wx-units').textContent === '°C' ? 'f' : 'c' }) }); loadWeather(); });

// ---------------------------------------------------------------- timer + pomodoro (survives reloads: stores the end time)
const FOCUS = 25 * 60e3, BREAK = 5 * 60e3, setTimerRing = makeRing($('r-timer'));
let T = { mode: 'timer', phase: 'focus', total: 5 * 60e3, left: 5 * 60e3, endAt: null, done: false };
try { Object.assign(T, JSON.parse(store.get('dl_timer') || '{}')); } catch {}
const saveT = () => store.set('dl_timer', JSON.stringify(T));
let audio = null;
function beep() {
  try { audio ??= new AudioContext(); audio.resume();
    for (let i = 0; i < 3; i++) { const o = audio.createOscillator(), g = audio.createGain(); o.connect(g); g.connect(audio.destination); o.frequency.value = 880;
      const t0 = audio.currentTime + i * 0.35; g.gain.setValueAtTime(0.2, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25); o.start(t0); o.stop(t0 + 0.26); } } catch {}
}
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function renderT() {
  const left = T.endAt ? T.endAt - Date.now() : T.left;
  setTimerRing(T.total ? left / T.total * 100 : 0, fmt(left), T.done ? 'bad' : T.mode === 'pomo' && T.phase === 'break' ? 'ok' : 'primary');
  $('r-timer').classList.toggle('done', T.done);
  $('tm-toggle').textContent = T.endAt ? 'Pause' : (T.done ? 'Dismiss' : 'Start');
  $('tab-timer').classList.toggle('on', T.mode === 'timer'); $('tab-pomo').classList.toggle('on', T.mode === 'pomo');
  $('tm-presets').hidden = T.mode !== 'timer';
  $('tm-label').textContent = T.mode === 'pomo' ? (T.phase === 'focus' ? 'Focus session' : 'Break time') : '';
}
function setT(total) { T.total = T.left = total; T.endAt = null; T.done = false; saveT(); renderT(); }
function resetT() { setT(T.mode === 'pomo' ? (T.phase === 'focus' ? FOCUS : BREAK) : T.total); }
function tickT() {
  if (T.endAt && T.endAt - Date.now() <= 0) {
    beep();
    if (T.mode === 'pomo') { T.phase = T.phase === 'focus' ? 'break' : 'focus'; T.total = T.left = T.phase === 'focus' ? FOCUS : BREAK; T.endAt = Date.now() + T.total; }
    else { T.endAt = null; T.left = 0; T.done = true; }
    saveT();
  }
  renderT();
}
$('tm-toggle').addEventListener('click', () => {
  audio ??= (() => { try { return new AudioContext(); } catch { return null; } })(); audio?.resume();   // iOS only allows sound after a tap
  if (T.done) return resetT();
  if (T.endAt) { T.left = T.endAt - Date.now(); T.endAt = null; } else { if (T.left <= 0) T.left = T.total; T.endAt = Date.now() + T.left; }
  saveT(); renderT();
});
$('tm-reset').addEventListener('click', resetT);
$$('.preset').forEach(b => b.addEventListener('click', () => setT(Number(b.dataset.min) * 60e3)));
$('tab-timer').addEventListener('click', () => { T.mode = 'timer'; setT(5 * 60e3); });
$('tab-pomo').addEventListener('click', () => { T.mode = 'pomo'; T.phase = 'focus'; setT(FOCUS); });
setInterval(tickT, 250); renderT();

// ---------------------------------------------------------------- notes
const notes = $('notes'); let noteSave = null;
notes.addEventListener('input', () => { clearTimeout(noteSave); noteSave = setTimeout(() => api('/api/notes', { method: 'PUT', body: JSON.stringify({ text: notes.value }) }).catch(() => {}), 600); });

// ---------------------------------------------------------------- inbox, values, Home Assistant, apps
let lastToast = Number(store.get('dl_seen') || 0), inboxSeen = Number(store.get('dl_inbox_seen') || 0), latestId = 0, toastT = null;
function toast(n) { const t = $('toast'); t.className = 'toast ' + n.level; t.textContent = (n.title ? n.title + ': ' : '') + n.message; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 6000); }
function markInboxSeen() { inboxSeen = latestId; store.set('dl_inbox_seen', inboxSeen); $('inbox-dot').hidden = true; }
async function loadFeed() {
  try {
    const f = await api('/api/feed'), ns = f.notifications;
    latestId = ns[0]?.id || 0;
    if (latestId < inboxSeen) { inboxSeen = 0; lastToast = 0; }          // server restarted, ids reset
    $('inbox-empty').hidden = ns.length > 0;
    $('inbox').replaceChildren(...ns.map(n => {
      const li = el('li', n.level), body = el('div'), line = el('div');
      if (n.title) line.append(el('b', '', n.title + ' ')); line.append(document.createTextNode(n.message));
      body.append(line, el('small', '', new Date(n.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
      li.append(icon(n.level === 'info' ? 'info' : 'alert'), body); return li;
    }));
    const fresh = ns.filter(n => n.id > lastToast);
    if (fresh.length) { toast(fresh[0]); lastToast = latestId; store.set('dl_seen', lastToast); }
    if (pageHas(idx, 'inbox')) markInboxSeen(); else $('inbox-dot').hidden = latestId <= inboxSeen;
    const vals = Object.values(f.values);
    $('values-empty').hidden = vals.length > 0;
    $('values').replaceChildren(...vals.map(v => { const d = el('div'); d.append(el('b', '', v.value + (v.unit ? ' ' + v.unit : '')), el('span', '', v.label)); return d; }));
    if (f.ha) loadHA(); else { $('ha').replaceChildren(); $('ha-empty').hidden = false; }
  } catch {}
}
async function loadHA() {
  try {
    const { entities } = await api('/api/ha');
    $('ha-empty').hidden = entities.length > 0;
    $('ha').replaceChildren(...entities.map(e => {
      const b = el('button', 'tile' + (e.state === 'on' ? ' on' : '')); b.append(icon('bulb'), document.createTextNode(e.name));
      b.addEventListener('click', async () => { b.disabled = true; await api('/api/ha/toggle', { method: 'POST', body: JSON.stringify({ entity: e.id }) }).catch(() => {}); setTimeout(loadHA, 400); });
      return b;
    }));
  } catch {}
}
async function loadApps() {
  try {
    const { apps } = await api('/api/apps');
    $('apps').replaceChildren(...apps.map(a => { const b = el('button', 'tile'); b.append(icon('window'), document.createTextNode(a)); b.addEventListener('click', () => act('open-app', a)); return b; }));
  } catch {}
}


// ---------------------------------------------------------------- code: review queue + GitHub and GitLab (separate cards)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SOURCES = [['github', 'GitHub', 'github'], ['gitlab', 'GitLab', 'gitlab']];
const ago = ms => { const m = Math.max(1, Math.round((Date.now() - ms) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
function stat(label, hot) { const d = el('div', 'gh-stat' + (hot ? ' hot' : '')), b = el('b', '', '0'); if (hot) d.append(icon('flame')); d.append(b, el('small', '', label)); return [d, b]; }
function codeCard(key, name, ic) {
  const card = el('article', 'card m12 w12 gh-card'); card.id = `cc-${key}`;
  const head = el('div', 'card-head'), h2 = el('h2'); h2.append(icon(ic), document.createTextNode(name)); const who = el('span', 'muted'); head.append(h2, who);
  const body = el('div'), stats = el('div', 'gh-stats'), S = [stat('day streak', true), stat('longest'), stat('past year'), stat('today')];
  stats.append(...S.map(x => x[0]));
  const scroll = el('div', 'gh-scroll'), svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'gh-map'); scroll.append(svg);
  const foot = el('div', 'gh-foot'), tip = el('span', 'muted', 'Tap a day for details.'), scale = el('span', 'gh-scale muted'); scale.append('less ');
  for (let i = 0; i < 5; i++) scale.append(el('i', `gh-l${i}`)); scale.append(' more'); foot.append(tip, scale);
  const msg = el('p', 'muted empty'); msg.hidden = true;
  body.append(stats, scroll, foot); card.append(head, body, msg);
  svg.addEventListener('click', e => {
    const r = e.target.closest('rect'); if (!r) return;
    const c = Number(r.dataset.c), d = new Date(r.dataset.d + 'T12:00');
    tip.textContent = `${c} contribution${c === 1 ? '' : 's'} on ${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
  });
  return { card, who, body, msg, svg, scroll, vals: S.map(x => x[1]) };
}
const cards = {};
for (const [key, name, ic] of SOURCES) { cards[key] = codeCard(key, name, ic); $('code-cards').append(cards[key].card); }
function drawCalendar(c, g) {
  c.vals[0].textContent = g.current; c.vals[1].textContent = g.longest; c.vals[2].textContent = g.total.toLocaleString(); c.vals[3].textContent = g.today;
  const P = 14, W = g.weeks.length * P, H = 7 * P + 16; c.svg.setAttribute('viewBox', `0 0 ${W} ${H}`); c.svg.replaceChildren();
  let prevM = -1;
  g.weeks.forEach((w, x) => {
    const m = new Date(w[0].d + 'T12:00').getMonth();
    if (m !== prevM && x < g.weeks.length - 2) { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', x * P); t.setAttribute('y', 9); t.setAttribute('class', 'gh-m'); t.textContent = MONTHS[m]; c.svg.append(t); }
    prevM = m;
    w.forEach((d, y) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x * P); r.setAttribute('y', 16 + y * P); r.setAttribute('width', P - 3); r.setAttribute('height', P - 3); r.setAttribute('rx', 3);
      r.setAttribute('class', `gh-l${d.l}`); r.dataset.d = d.d; r.dataset.c = d.c; c.svg.append(r);
    });
  });
  c.scroll.scrollLeft = c.scroll.scrollWidth;
}
function reviewItem(r) {
  const a = el('a', 'rv-item'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  const badge = el('span', 'rv-src'); badge.append(icon(r.source === 'gitlab' ? 'gitlab' : 'github'));
  const t = el('span', 'rv-text'), meta = [r.repo + (r.number ? (r.source === 'gitlab' ? ` !${r.number}` : ` #${r.number}`) : ''), r.author && `by ${r.author}`, r.updated && ago(r.updated)].filter(Boolean).join(' · ');
  t.append(el('b', '', r.title), el('small', 'muted', meta)); a.append(badge, t);
  if (r.draft) a.append(el('span', 'badge draft', 'Draft'));
  return a;
}
async function loadCode() {
  try {
    const d = await api('/api/code'), all = [], errs = [];
    for (const [key, name] of SOURCES) {
      const g = d[key], c = cards[key]; c.card.hidden = !g.enabled; if (!g.enabled) continue;
      c.who.textContent = g.user ? `@${g.user}` : '';
      const ok = !g.error; c.body.hidden = !ok; c.msg.hidden = ok; if (!ok) c.msg.textContent = `${name}: ${g.error}`; else drawCalendar(c, g);
      all.push(...g.reviews); if (g.reviewsError) errs.push(`${name}: ${g.reviewsError}`);
    }
    all.sort((a, b) => b.updated - a.updated);
    $('rv-list').replaceChildren(...all.map(reviewItem));
    $('rv-count').textContent = all.length ? `${all.length} open · newest first` : '';
    $('rv-empty').hidden = all.length > 0 || errs.length > 0;
    $('rv-err').hidden = !errs.length; $('rv-err').textContent = errs.join(' · ');
    $('code-dot').hidden = all.length === 0;
    const none = !d.github.enabled && !d.gitlab.enabled; $('rv-card').hidden = none;
    if (none) { const m = cards.github; m.card.hidden = false; m.body.hidden = true; m.msg.hidden = false; m.msg.textContent = 'No code source connected. Connect your computer (HOST_SSH) with gh and glab logged in, or set GITHUB_USER and GITHUB_TOKEN.'; }
  } catch (e) { if (e.message !== 'unauthorized') { $('rv-err').hidden = false; $('rv-err').textContent = 'Code data unavailable right now.'; } }
}

// ---------------------------------------------------------------- AI coding tools: one card per tool, 60% graphs / 40% sessions
const TOOLS = [['claude', 'Claude Code'], ['codex', 'Codex']];          // a tool's card appears when the Mac reports data for it
const KNOWN = ['opus', 'sonnet', 'haiku', 'fable'], SEG = ['a', 'b', 'c', 'd', 'e'];
const short = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n));
const pretty = k => k === 'other' ? 'Other' : /^[a-z]+$/.test(k) ? k[0].toUpperCase() + k.slice(1) : k;
function aiCard(id, name) {
  const wrap = el('div', 'ai-layout'); wrap.id = `ai-${id}`;
  const card = el('article', 'card'), limits = el('div', 'limits'), scan = el('div', 'scan-note'), scanText = el('span'), scanBar = el('div', 'progress'), scanFill = el('i');
  scanBar.append(scanFill); scan.append(scanText, scanBar); scan.hidden = true;
  const head = el('div', 'card-head'), h2 = el('h2'); h2.append(icon('spark'), document.createTextNode(name)); const badge = el('span', 'badge', '--'); head.append(h2, badge);
  const stats = el('div', 'gh-stats'), S = ['Today', '7 days', '5-hour block', 'Messages today'].map(l => { const d = el('div', 'gh-stat'), b = el('b', '', '--'), sm = el('small', '', l), sub = el('em', 'ai-sub'); d.append(b, sm, sub); stats.append(d); return [b, sub]; });
  const bars = el('div', 'bars'), legend = el('div', 'ai-legend'), note = el('p', 'muted ai-note', 'Tokens counted: input + output + cache writes. Cache reads are listed separately.');
  card.append(head, scan, limits, stats, bars, legend, note);
  const sc = el('article', 'card rv-card'), sh = el('div', 'card-head'), sh2 = el('h2'); sh2.append(icon('review'), document.createTextNode('Sessions')); const cnt = el('span', 'muted'); sh.append(sh2, cnt);
  const list = el('ul', 'rv-list'), none = el('p', 'muted empty', 'Collecting sessions…'); none.hidden = true;
  const more = el('button', 'btn btn-ghost btn-sm ss-more'); more.hidden = true; sc.append(sh, list, none, more);
  wrap.append(card, sc);
  const c = { wrap, badge, S, bars, legend, limits, stats, note, list, none, cnt, more, scan, scanText, scanFill, expanded: false, sessions: [] };
  more.addEventListener('click', () => { c.expanded = !c.expanded; drawSessions(c, c.sessions); });
  return c;
}
const aiCards = {};
for (const [id, name] of TOOLS) { aiCards[id] = aiCard(id, name); $('ai-cards').append(aiCards[id].wrap); }
function drawLimits(c, lim) {
  const rows = [['five_hour', '5-hour limit'], ['seven_day', 'Weekly limit']].filter(([k]) => lim?.[k]);
  if (!rows.length) { c.limits.replaceChildren(el('p', 'muted ai-note', 'Plan limits appear once the tool reports them (Claude: needs the status-line hook and a Pro/Max/Ultra plan).')); return; }
  c.limits.replaceChildren(...rows.map(([k, label]) => {
    const w = lim[k], pct = Math.max(0, Math.min(100, w.pct)), row = el('div', 'limit'), top = el('div', 'limit-top'), bar = el('div', 'progress'), fill = el('i');
    fill.style.setProperty('width', `${pct}%`); fill.className = pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : '';
    const when = new Date(w.reset * 1000), sameDay = when.toDateString() === new Date().toDateString(), hm = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    top.append(el('span', 'limit-name', label), el('b', '', `${Math.round(pct)}%`), el('span', 'muted limit-reset', `resets ${sameDay ? hm : when.toLocaleDateString([], { weekday: 'short' }) + ' ' + hm}`));
    bar.append(fill); row.append(top, bar); return row;
  }));
}
const SESSIONS_SHOWN = 6;                       // the 40% column shows the latest few; "Show all" expands it
function drawSessions(c, all) {
  const list = all || []; c.sessions = list;
  const shown = c.expanded ? list : list.slice(0, SESSIONS_SHOWN);
  c.none.hidden = list.length > 0; c.cnt.textContent = list.length ? `latest ${shown.length} of ${list.length}` : '';
  c.more.hidden = list.length <= SESSIONS_SHOWN; c.more.textContent = c.expanded ? 'Show fewer' : `Show all ${list.length}`;
  c.list.replaceChildren(...shown.map(x => {
    const live = Date.now() / 1000 - x.last < 600, row = el('li', 'rv-item ss-item' + (live ? ' live' : '')), dot = el('span', 'mkt' + (live ? ' open' : '')), t = el('span', 'rv-text');
    t.append(el('b', '', x.project || x.id.slice(0, 8)), el('small', 'muted', [x.id.slice(0, 8), pretty(x.model), `${x.msgs} msgs`, ago(x.last * 1000)].join(' · ')));
    row.append(dot, t, el('span', 'ss-tok', short(x.tokens))); return row;
  }));
}
function drawTool(c, t) {
  drawLimits(c, t.limits); drawSessions(c, t.sessions);
  c.scan.hidden = !t.scan;                       // present only while the Mac is still reading older logs
  if (t.scan) { c.scanText.textContent = `Reading older logs… ${t.scan.done} of ${t.scan.total} files. Recent activity is shown; older days are still filling in.`; c.scanFill.style.setProperty('width', `${Math.round(t.scan.done / Math.max(1, t.scan.total) * 100)}%`); }
  const scanning = !t.days; c.stats.hidden = c.bars.hidden = c.legend.hidden = c.note.hidden = scanning;
  if (scanning) { c.badge.textContent = 'scanning logs…'; c.badge.className = 'badge'; return; }
  const days = t.days.slice(1), today = days.at(-1), week = days.reduce((a, d) => a + d.tokens, 0);      // collected for 8 days; show the last 7
  const idleMin = t.last ? Math.round((Date.now() / 1000 - t.last) / 60) : null;
  c.badge.textContent = idleMin == null ? 'no activity' : idleMin < 10 ? `active · ${Math.max(idleMin, 1)}m ago` : `idle · ${ago(t.last * 1000)}`;
  c.badge.className = 'badge' + (idleMin != null && idleMin < 10 ? ' ok' : '');
  c.S[0][0].textContent = short(today.tokens); c.S[0][1].textContent = `+ ${short(today.cache)} cache reads`;
  c.S[1][0].textContent = short(week); c.S[1][1].textContent = `${days.reduce((a, d) => a + d.msgs, 0).toLocaleString()} messages`;
  if (t.block) { c.S[2][0].textContent = short(t.block.tokens); c.S[2][1].textContent = `resets ${new Date(t.block.end * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; }
  else { c.S[2][0].textContent = '—'; c.S[2][1].textContent = 'no active block'; }
  c.S[3][0].textContent = today.msgs.toLocaleString(); c.S[3][1].textContent = `${short(today.in)} in · ${short(today.out)} out`;
  const fam = k => days.reduce((a, d) => a + (d.models[k] || 0), 0);
  const keys = [...new Set(days.flatMap(d => Object.keys(d.models)))].filter(k => fam(k) > 0)
    .sort((x, y) => (KNOWN.indexOf(x) < 0 ? 9 : KNOWN.indexOf(x)) - (KNOWN.indexOf(y) < 0 ? 9 : KNOWN.indexOf(y)) || fam(y) - fam(x));
  const cls = k => SEG[Math.min(keys.indexOf(k), SEG.length - 1)];
  const max = Math.max(1, ...days.map(d => d.tokens));
  c.bars.replaceChildren(...days.map((d, i) => {
    const col = el('div', 'bar-col' + (i === days.length - 1 ? ' now' : '')), bar = el('div', 'bar');
    for (const k of keys) { const v = d.models[k] || 0; if (!v) continue; const seg = el('i', `seg seg-${cls(k)}`); seg.style.setProperty('height', `${v / max * 100}%`); bar.append(seg); }
    col.append(el('span', 'bar-val muted', d.tokens ? short(d.tokens) : ''), bar, el('span', 'bar-lbl muted', new Date(d.d + 'T12:00').toLocaleDateString([], { weekday: 'short' })));
    return col;
  }));
  c.legend.replaceChildren(...keys.map(k => { const s = el('span', 'lg'); s.append(el('i', `dot seg-${cls(k)}`), document.createTextNode(`${pretty(k)} ${short(fam(k))}`)); return s; }));
}
let aiFast = null;
async function loadAI() {
  try {
    const d = await api('/api/ai'), msg = $('ai-msg');
    for (const [id] of TOOLS) aiCards[id].wrap.hidden = true;
    if (!d.enabled) { msg.hidden = false; $('ai-msg-text').textContent = 'Connect your computer (HOST_SSH) to see AI coding tool usage.'; return; }
    if (d.error) { msg.hidden = false; $('ai-msg-text').textContent = `Usage data isn't ready yet: ${d.error}`; return; }
    let any = false;
    for (const [id] of TOOLS) if (d[id]) { aiCards[id].wrap.hidden = false; drawTool(aiCards[id], d[id]); any = true; }
    clearTimeout(aiFast); if (TOOLS.some(([id]) => d[id]?.scan)) aiFast = setTimeout(loadAI, 6000);      // poll quickly while a backfill is running
    msg.hidden = any; if (!any) $('ai-msg-text').textContent = 'No AI coding tool usage found on this computer yet (looked for Claude Code and Codex).';
  } catch (e) { if (e.message !== 'unauthorized') { $('ai-msg').hidden = false; $('ai-msg-text').textContent = 'AI usage unavailable right now.'; } }
}

// ---------------------------------------------------------------- stocks (Yahoo Finance via the server)
let ST = { range: '1d', edit: false, symbols: [] };
const money = (v, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v); } catch { return `${v.toFixed(2)} ${cur || ''}`; } };
function drawSpark(svg, vals) {
  svg.setAttribute('viewBox', '0 0 100 30'); svg.setAttribute('preserveAspectRatio', 'none'); svg.replaceChildren();
  if (vals.length < 2) return;
  const lo = Math.min(...vals), span = (Math.max(...vals) - lo) || 1;
  const d = 'M' + vals.map((v, i) => `${(i / (vals.length - 1) * 100).toFixed(1)} ${(28 - (v - lo) / span * 26).toFixed(1)}`).join('L');
  for (const [cls, path] of [['area', `${d}L100 30L0 30Z`], ['ln', d]]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('class', cls); p.setAttribute('d', path); svg.append(p); }
}
function tickTile(q) {
  const t = el('div', 'tick'); if (ST.edit) t.classList.add('editing');
  if (q.error) { t.classList.add('bad'); t.append(el('b', '', q.symbol), el('span', 'muted', q.error)); }
  else {
    t.classList.add(q.change == null ? 'flat' : q.change >= 0 ? 'up' : 'down');
    const top = el('div', 'tick-top'), dot = el('i', 'mkt' + (q.open ? ' open' : '')); dot.title = q.open ? 'Market open' : 'Market closed';
    top.append(el('b', '', q.symbol), dot);
    const chg = q.change == null ? '' : `${q.change >= 0 ? '+' : ''}${q.change.toFixed(Math.abs(q.change) >= 100 ? 0 : 2)}  (${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}%)`;
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'spark'); drawSpark(svg, q.spark);
    t.append(top, el('span', 'muted tick-name', q.name), el('div', 'tick-price', money(q.price, q.currency)), el('div', 'tick-chg', chg), svg,
      el('span', 'muted tick-meta', [q.exchange, q.stale ? 'stale' : q.time ? new Date(q.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''].filter(Boolean).join(' · ')));
  }
  if (ST.edit) { const x = el('span', 'sc-x'); x.append(icon('x')); t.append(x); t.setAttribute('aria-label', `Remove ${q.symbol}`); t.addEventListener('click', () => saveWatch(ST.symbols.filter(s => s !== q.symbol))); }
  return t;
}
async function loadStocks() {
  try {
    const d = await api(`/api/stocks?range=${ST.range}`);
    ST.symbols = d.symbols; $('st-empty').hidden = d.symbols.length > 0; $('st-grid').replaceChildren(...d.quotes.map(tickTile)); $('st-err').textContent = '';
  } catch (e) { if (e.message !== 'unauthorized') $('st-err').textContent = 'Could not load prices right now.'; }
}
async function saveWatch(symbols) {
  const r = await api('/api/stocks/watchlist', { method: 'PUT', body: JSON.stringify({ symbols }) });
  if (r.error) { $('st-err').textContent = r.error; return; }
  loadStocks();
}
$$('#st-ranges .tab').forEach(b => b.addEventListener('click', () => { ST.range = b.dataset.r; $$('#st-ranges .tab').forEach(x => x.classList.toggle('on', x === b)); loadStocks(); }));
$('st-edit').addEventListener('click', () => { ST.edit = !ST.edit; $('st-edit').textContent = ST.edit ? 'Done' : 'Edit'; $('st-add').hidden = !ST.edit; loadStocks(); if (ST.edit) $('st-q').focus(); });
let stT = null;
$('st-q').addEventListener('input', () => {
  clearTimeout(stT); const q = $('st-q').value.trim(), ul = $('st-results');
  if (!q) { ul.replaceChildren(); return; }
  stT = setTimeout(async () => {
    try {
      const { results = [], error } = await api(`/api/stocks/search?q=${encodeURIComponent(q)}`);
      if (error) { $('st-err').textContent = error; return; }
      ul.replaceChildren(...results.map(r => {
        const li = el('li'), b = el('button', 'st-res'); b.type = 'button';
        const t = el('span', 'rv-text'); t.append(el('b', '', `${r.symbol}`), el('small', 'muted', [r.name, r.exchange, r.type].filter(Boolean).join(' · '))); b.append(t, icon('plus'));
        b.addEventListener('click', () => { if (!ST.symbols.includes(r.symbol)) saveWatch([...ST.symbols, r.symbol]); $('st-q').value = ''; ul.replaceChildren(); });
        li.append(b); return li;
      }));
    } catch {}
  }, 300);
});

// ---------------------------------------------------------------- 3D printer (Moonraker / OctoPrint)
const setPrintRing = makeRing($('r-print'));
let printerOn = false, cancelArm = null;
const dur = s => { if (s == null) return '--'; s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; };
const temp = t => t.cur == null ? '--' : `${Math.round(t.cur)}°${t.target ? ` / ${Math.round(t.target)}°` : ''}`;
async function loadPrinter() {
  try {
    const p = await api('/api/printer');
    printerOn = p.enabled;
    $('pr-main').hidden = $('pr-temps').hidden = !p.enabled; $('pr-empty').hidden = p.enabled;
    if (!p.enabled) return;
    const live = p.state === 'printing' || p.state === 'paused';
    $('pr-state').textContent = p.state === 'offline' ? 'offline' : p.label;
    $('pr-state').className = 'badge ' + (p.state === 'printing' ? 'ok' : p.state === 'error' || p.state === 'offline' ? 'bad' : '');
    setPrintRing(p.progress, p.progress == null ? '--' : `${Math.round(p.progress)}%`, p.state === 'paused' ? 'warn' : p.state === 'error' ? 'bad' : 'ok');
    $('pr-file').textContent = p.file ? p.file.replace(/\.(gcode|gco|g)$/i, '') : (p.state === 'offline' ? 'Printer unreachable' : 'No job');
    $('pr-time').textContent = live ? `${dur(p.elapsed)} elapsed · ${dur(p.remaining)} left` : p.state === 'done' ? 'Print finished' : '';
    $('pr-type').textContent = p.type + (p.error ? ` · ${p.error}` : '');
    $('pr-pause').hidden = p.state !== 'printing'; $('pr-resume').hidden = p.state !== 'paused'; $('pr-cancel').hidden = !live;
    $('t-noz').textContent = temp(p.nozzle); $('t-bed').textContent = temp(p.bed);
    for (const [id, t] of [['tb-noz', p.nozzle], ['tb-bed', p.bed]]) $(id).style.width = `${t.cur == null ? 0 : Math.min(100, t.cur / Math.max(t.target || 0, 1) * 100)}%`;
  } catch (e) { if (e.message !== 'unauthorized') $('pr-state').textContent = 'offline'; }
}
async function printerDo(action) {
  try { const r = await api('/api/printer/action', { method: 'POST', body: JSON.stringify({ action }) }); $('pr-msg').textContent = r.error || ''; }
  catch (e) { $('pr-msg').textContent = 'Could not reach the printer'; }
  setTimeout(loadPrinter, 600);
}
$('pr-pause').addEventListener('click', () => printerDo('pause'));
$('pr-resume').addEventListener('click', () => printerDo('resume'));
$('pr-cancel').addEventListener('click', e => {           // two taps, so a stray touch can't kill a 10-hour print
  const b = e.currentTarget;
  if (!cancelArm) { b.textContent = 'Tap again to cancel'; cancelArm = setTimeout(() => { cancelArm = null; b.textContent = 'Cancel print'; }, 3500); return; }
  clearTimeout(cancelArm); cancelArm = null; b.textContent = 'Cancel print'; printerDo('cancel');
});

// ---------------------------------------------------------------- shortcuts (your own tiles)
let SC = { shortcuts: [], icons: [], actions: [], ha: [] }, scEdit = false, scIcon = 'link';
const ACTION_NAMES = { playpause: 'Play / Pause', next: 'Next track', prev: 'Previous track', mute: 'Mute', sleep: 'Sleep display' };
async function loadShortcuts() { try { SC = await api('/api/shortcuts'); renderShortcuts(); renderScForm(); } catch {} }
async function saveShortcuts(list) {
  const r = await api('/api/shortcuts', { method: 'PUT', body: JSON.stringify({ shortcuts: list }) });
  if (r.error) { $('sc-err').textContent = r.error; return false; }
  SC.shortcuts = r.shortcuts; $('sc-err').textContent = ''; renderShortcuts(); return true;
}
function runShortcut(s) {
  if (s.type === 'url') { if (/^https?:/i.test(s.target)) window.open(s.target, '_blank', 'noopener'); else location.href = s.target; }
  else if (s.type === 'app') act('open-app', s.target);
  else if (s.type === 'action') act(s.target);
  else if (s.type === 'ha') api('/api/ha/toggle', { method: 'POST', body: JSON.stringify({ entity: s.target }) }).then(() => setTimeout(loadHA, 400)).catch(() => {});
}
function renderShortcuts() {
  $('sc-empty').hidden = SC.shortcuts.length > 0 || scEdit;
  $('sc-grid').replaceChildren(...SC.shortcuts.map(s => {
    const b = el('button', 'tile sc' + (scEdit ? ' editing' : '')); if (s.color) b.style.setProperty('--tc', s.color);
    b.append(icon(s.icon), document.createTextNode(s.label));
    if (scEdit) { const x = el('span', 'sc-x'); x.append(icon('x')); b.append(x); b.setAttribute('aria-label', `Remove ${s.label}`); b.addEventListener('click', () => saveShortcuts(SC.shortcuts.filter(y => y.id !== s.id))); }
    else b.addEventListener('click', () => runShortcut(s));
    return b;
  }));
}
function renderScForm() {
  $('sc-icons').replaceChildren(...SC.icons.map(n => {
    const b = el('button', 'ic' + (n === scIcon ? ' on' : '')); b.type = 'button'; b.append(icon(n)); b.setAttribute('role', 'radio'); b.setAttribute('aria-label', n); b.setAttribute('aria-checked', String(n === scIcon));
    b.addEventListener('click', () => { scIcon = n; renderScForm(); }); return b;
  }));
  syncScTarget();
}
function syncScTarget() {
  const t = $('sc-type').value, sel = $('sc-target-sel'), inp = $('sc-target');
  const opts = t === 'action' ? SC.actions.map(a => [a, ACTION_NAMES[a] || a]) : t === 'ha' ? SC.ha.map(a => [a, a]) : null;
  sel.hidden = !opts; inp.hidden = Boolean(opts); inp.required = !opts;
  if (opts) sel.replaceChildren(...opts.map(([v, l]) => { const o = el('option', '', l); o.value = v; return o; }));
  if (t === 'app') inp.placeholder = 'App name (must be in apps.allow)'; else if (t === 'url') inp.placeholder = 'https://… or shortcuts://run-shortcut?name=…';
  if (t === 'ha' && !SC.ha.length) { sel.replaceChildren(el('option', '', 'Set HA_ENTITIES first')); }
}
$('sc-type').addEventListener('change', syncScTarget);
$('sc-edit').addEventListener('click', () => { scEdit = !scEdit; $('sc-edit').textContent = scEdit ? 'Done' : 'Edit'; $('sc-form').hidden = !scEdit; renderShortcuts(); });
$('sc-form').addEventListener('submit', async e => {
  e.preventDefault();
  const type = $('sc-type').value, target = ($('sc-target').hidden ? $('sc-target-sel').value : $('sc-target').value).trim();
  const ok = await saveShortcuts([...SC.shortcuts, { label: $('sc-label').value.trim(), type, target, icon: scIcon, color: $('sc-color').value }]);
  if (ok) { $('sc-label').value = ''; $('sc-target').value = ''; }
});

// ---------------------------------------------------------------- themes
const THEMES = [['glass', 'Liquid Glass', 'translucent, follows light/dark'], ['light', 'Liquid Light', 'translucent, always light'], ['graphite', 'Graphite', 'flat, amber, DeskHub style'], ['dots', 'Dot Matrix', 'black, one red dot'],
  ['cyber', 'Cyberdeck', 'neon cyan & magenta'], ['terminal', 'Terminal', 'green phosphor CRT']];
const THEME_BG = { glass: '#070714', light: '#e9eefb', graphite: '#0d0e11', dots: '#050505', cyber: '#07091A', terminal: '#020A03' };
function applyTheme(t) {
  if (!THEMES.some(x => x[0] === t)) t = 'glass';
  document.documentElement.setAttribute('data-theme', t); store.set('dl_theme', t);
  document.querySelector('meta[name=theme-color]').setAttribute('content', THEME_BG[t]);
  $$('#themes button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  requestAnimationFrame(moveLens);
}
$('themes').replaceChildren(...THEMES.map(([id, name, hint]) => {
  const b = el('button', 'theme-opt'); b.dataset.t = id; b.setAttribute('role', 'menuitemradio');
  b.append(el('span', `sw sw-${id}`), (() => { const d = el('span', 'theme-name'); d.append(el('b', '', name), el('small', '', hint)); return d; })());
  b.addEventListener('click', () => { applyTheme(id); $('themes').hidden = true; $('theme-btn').setAttribute('aria-expanded', 'false'); });
  return b;
}));
$('theme-btn').addEventListener('click', () => { const h = !$('themes').hidden; $('themes').hidden = h; $('theme-btn').setAttribute('aria-expanded', String(!h)); });
document.addEventListener('pointerdown', e => { if (!$('themes').hidden && !e.target.closest('#themes, #theme-btn')) { $('themes').hidden = true; $('theme-btn').setAttribute('aria-expanded', 'false'); } });
applyTheme(document.documentElement.getAttribute('data-theme') || 'glass');
if (document.fonts?.ready) document.fonts.ready.then(() => moveLens());

// glass specular: a soft highlight follows the finger / pointer across each card
document.addEventListener('pointermove', e => {
  const c = e.target.closest?.('.card'); if (!c) return;
  const r = c.getBoundingClientRect(); c.style.setProperty('--px', `${e.clientX - r.left}px`); c.style.setProperty('--py', `${e.clientY - r.top}px`);
}, { passive: true });

// ---------------------------------------------------------------- clock
function tick() {
  const d = new Date();
  $('time').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('date').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}
setInterval(tick, 1000); tick();

// ---------------------------------------------------------------- polling lifecycle
let timers = [];
function startPolling() {
  stopPolling(); pollStats(); pollNP(); loadFeed(); pollFans(); pollTemps(); pollPower(); pollDisplay(); pollCalendar(); pollDocker(); pollObs();
  loadCode(); loadPrinter(); loadAI();
  timers = [...X.timers.map(([f, ms]) => setInterval(f, ms)), setInterval(pollStats, 2500), setInterval(pollFans, 6000), setInterval(pollPower, 5000), setInterval(pollDisplay, 4000), setInterval(pollCalendar, 60_000), setInterval(pollDocker, 5000), setInterval(pollObs, 3000), setInterval(pollTemps, 5000), setInterval(pollNP, 2000), setInterval(loadFeed, 5000), setInterval(loadWeather, 600_000),
    setInterval(loadCode, 300_000), setInterval(loadAI, 30_000), setInterval(() => { if (pageHas(idx, 'stocks')) loadStocks(); }, 60_000), setInterval(() => { if (printerOn) loadPrinter(); }, 4000), setInterval(syncLayout, 15_000)];
}
function stopPolling() { timers.forEach(clearInterval); timers = []; }
// Self-update: if the server was rebuilt with new front-end files, reload this page (checked on open, on return to the app, and every 30 s).
let buildId = null;
async function checkBuild() {
  try {
    const { build } = await (await fetch('/api/health', { cache: 'no-store' })).json();
    if (!build) return;
    if (buildId && build !== buildId) { try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch {} location.reload(); return; }
    buildId = build;
  } catch {}
}
checkBuild(); setInterval(checkBuild, 30_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkBuild();
  if ($('shell').hidden) return;
  if (document.hidden) stopPolling(); else { startPolling(); }
});

async function start() {
  $('login').hidden = true; $('shell').hidden = false;
  idx = Number(store.get('dl_page') || 0); await syncLayout(true);
  try { const n = await api('/api/notes'); notes.value = n.text || ''; } catch {}
  startPolling(); loadWeather(); loadApps(); loadShortcuts(); X.refresh();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
token ? start() : showLogin();
