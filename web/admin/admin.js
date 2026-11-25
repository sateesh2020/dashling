import { icon } from '/icons.js';
import { WIDGETS, WIDTHS, PAGE_ICONS } from '/widgets.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const CAT = new Map(WIDGETS.map(w => [w.id, w]));
$('logo').append(icon('activity'));

async function api(path, method = 'GET', body) {
  const r = await fetch('/admin/api/' + path, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Dashling-Admin': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
let toastT;
function toast(msg, bad) { const t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' err' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500); }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------------------------------------------------------------- tabs
const TABS = ['layout', 'conn', 'devices', 'diag', 'logs'];
function tab(name) {
  if (!TABS.includes(name)) name = 'layout';
  for (const t of TABS) $('t-' + t).hidden = t !== name;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === name));
  location.hash = name;
  if (name === 'devices') loadDevices(); if (name === 'diag') { loadDiag(); runChecks(); } if (name === 'logs') loadLogs(); if (name === 'conn') loadConn();
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) tab(b.dataset.t); });

// ---------------------------------------------------------------- layout editor
let L = { pages: [] }, orig = '', defaults = null, dragId = null;
const snap = () => JSON.stringify(L);
function dirty() {
  const d = snap() !== orig;
  $('dirty').hidden = !d; $('l-save').disabled = !d; $('l-revert').disabled = !d;
}
const newId = () => 'p' + Math.random().toString(36).slice(2, 8);
const placed = () => new Set(L.pages.flatMap(p => p.widgets.map(w => w.id)));
const unplaced = () => WIDGETS.filter(w => !placed().has(w.id));

function take(id) { for (const p of L.pages) { const i = p.widgets.findIndex(w => w.id === id); if (i >= 0) return p.widgets.splice(i, 1)[0]; } return { id }; }
function put(id, pageIdx, at) {                  // pageIdx -1 = back to the unplaced tray
  const w = take(id);
  if (pageIdx < 0) return;
  const list = L.pages[pageIdx].widgets;
  list.splice(at === undefined ? list.length : Math.min(at, list.length), 0, w);
}
function rowFor(w, pageIdx, n) {
  const def = CAT.get(w.id), li = el('li', 'w'); li.draggable = true; li.dataset.id = w.id;
  li.append(el('span', 'n', def.name));
  if (def.resize && pageIdx >= 0) {
    const sel = el('select'); sel.title = 'Width (of 12 columns)';
    for (const x of WIDTHS) { const o = el('option', '', x === 12 ? 'Full' : `${x}/12`); o.value = x; sel.append(o); }
    sel.value = w.w || def.w;
    sel.addEventListener('change', () => { if (Number(sel.value) === def.w) delete w.w; else w.w = Number(sel.value); dirty(); renderPreview(); });
    li.append(sel);
  }
  if (pageIdx >= 0) {
    const up = el('button', 'btn sm', '↑'), dn = el('button', 'btn sm', '↓'), rm = el('button', 'btn sm', '✕');
    up.title = 'Move up'; dn.title = 'Move down'; rm.title = 'Remove from this page';
    up.disabled = n === 0; dn.disabled = n === L.pages[pageIdx].widgets.length - 1;
    up.addEventListener('click', () => { put(w.id, pageIdx, n - 1); render(); });
    dn.addEventListener('click', () => { put(w.id, pageIdx, n + 1); render(); });
    rm.addEventListener('click', () => { put(w.id, -1); render(); });
    li.append(up, dn, rm);
  } else if (L.pages.length) {
    const sel = el('select'); const o0 = el('option', '', 'Add to…'); o0.value = ''; sel.append(o0);
    L.pages.forEach((p, i) => { const o = el('option', '', p.title); o.value = i; sel.append(o); });
    sel.addEventListener('change', () => { if (sel.value !== '') { put(w.id, Number(sel.value)); render(); } });
    li.append(sel);
  }
  li.addEventListener('dragstart', e => { dragId = w.id; e.dataTransfer.setData('text/plain', w.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => li.classList.add('drag'), 0); });
  li.addEventListener('dragend', () => { dragId = null; render(); });
  return li;
}
function list(pageIdx) {
  const ul = el('ul', 'wl');
  const items = pageIdx < 0 ? unplaced().map(w => ({ id: w.id })) : L.pages[pageIdx].widgets;
  items.forEach((w, n) => ul.append(rowFor(w, pageIdx, n)));
  if (!items.length) ul.append(el('li', 'empty', pageIdx < 0 ? 'Everything is placed.' : 'Drop widgets here'));
  const indexAt = y => { const rows = [...ul.querySelectorAll('.w')]; const i = rows.findIndex(r => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; }); return i < 0 ? rows.length : i; };
  const clear = () => { ul.classList.remove('over', 'ins-end'); ul.querySelectorAll('.ins').forEach(r => r.classList.remove('ins')); };
  ul.addEventListener('dragover', e => {
    if (!dragId) return; e.preventDefault(); clear(); ul.classList.add('over');
    if (pageIdx < 0) return;
    const rows = [...ul.querySelectorAll('.w')], i = indexAt(e.clientY);
    if (i < rows.length) rows[i].classList.add('ins'); else ul.classList.add('ins-end');
  });
  ul.addEventListener('dragleave', e => { if (!ul.contains(e.relatedTarget)) clear(); });
  ul.addEventListener('drop', e => {
    e.preventDefault(); const id = dragId; if (!id) return;
    let at = pageIdx < 0 ? undefined : indexAt(e.clientY);
    if (pageIdx >= 0) { const cur = L.pages[pageIdx].widgets.findIndex(w => w.id === id); if (cur >= 0 && cur < at) at--; }
    put(id, pageIdx, at); dragId = null; render();
  });
  return ul;
}
function column(p, i) {
  const col = el('div', 'col'), head = el('div', 'col-head');
  const ic = el('button', 'ico'); ic.title = 'Change icon'; ic.append(icon(p.icon));
  ic.addEventListener('click', () => { p.icon = PAGE_ICONS[(PAGE_ICONS.indexOf(p.icon) + 1) % PAGE_ICONS.length]; render(); });
  const name = el('input'); name.type = 'text'; name.value = p.title; name.maxLength = 20; name.setAttribute('aria-label', 'Page name');
  name.addEventListener('input', () => { p.title = name.value; dirty(); renderPreview(); });
  name.addEventListener('focus', () => { if (pvPage !== i) { pvPage = i; renderPreview(); } });
  const l = el('button', 'btn sm', '←'), r = el('button', 'btn sm', '→'), x = el('button', 'btn sm danger', '✕');
  l.title = 'Move page left'; r.title = 'Move page right'; x.title = 'Delete page (its widgets go to Unplaced)';
  l.disabled = i === 0; r.disabled = i === L.pages.length - 1; x.disabled = L.pages.length === 1;
  l.addEventListener('click', () => { L.pages.splice(i - 1, 0, L.pages.splice(i, 1)[0]); render(); });
  r.addEventListener('click', () => { L.pages.splice(i + 1, 0, L.pages.splice(i, 1)[0]); render(); });
  x.addEventListener('click', () => { if (!p.widgets.length || confirm(`Delete page "${p.title}"? Its widgets move to Unplaced.`)) { L.pages.splice(i, 1); render(); } });
  head.append(ic, name, l, r, x);
  col.append(head, list(i));
  return col;
}
// ---- preview: a scaled sketch of the unsaved layout
let pvPage = 0;
const PV_H = { 'stat-cpu': 34, 'stat-mem': 34, 'stat-disk': 34, 'stat-batt': 34, clock: 44, weather: 44, 'now-playing': 34, battery: 24,
  'chart-cpu': 52, 'chart-mem': 52, 'chart-net': 52, disk: 52, code: 110, ai: 110, stocks: 90, printer: 80, media: 80, shortcuts: 70, 'media-keys': 40, apps: 50, ha: 50, timer: 70, notes: 70, inbox: 80, values: 80 };
function renderPreview() {
  const box = $('pv'), mode = $('pv-dev').value; box.className = 'pv ' + mode; box.replaceChildren();
  if (!L.pages.length) return;
  pvPage = Math.min(pvPage, L.pages.length - 1);
  const p = L.pages[pvPage], top = el('div', 'pv-top'), grid = el('div', 'pv-grid'), dock = el('div', 'pv-dock');
  top.append(el('b', '', p.title || 'Untitled'), el('span', '', 'Dashling'));
  for (const w of p.widgets) {
    const def = CAT.get(w.id), span = mode === 'port' ? (w.id.startsWith('stat-') ? 6 : 12) : (def.resize ? (w.w || def.w) : 12);
    const t = el('div', 'pv-w' + (def.resize ? '' : ' fixed'), def.name); t.style.gridColumn = 'span ' + span; t.style.height = (PV_H[w.id] || 50) * (mode === 'port' ? 0.8 : 1) + 'px';
    grid.append(t);
  }
  if (!p.widgets.length) grid.append(el('div', 'pv-empty', 'Empty page'));
  L.pages.forEach((q, i) => { const b = el('button', i === pvPage ? 'on' : ''); b.title = q.title; b.append(icon(q.icon)); b.addEventListener('click', () => { pvPage = i; renderPreview(); }); dock.append(b); });
  box.append(top, grid, dock);
}
$('pv-dev').addEventListener('change', renderPreview);
function render() {
  const b = $('board'); b.replaceChildren();
  L.pages.forEach((p, i) => b.append(column(p, i)));
  const tray = el('div', 'col tray'), h = el('div', 'col-head'); h.append(el('b', '', 'Unplaced widgets'));
  tray.append(h, el('p', 'hint', 'Not shown anywhere. Drag one onto a page to add it.'), list(-1));
  b.append(tray);
  dirty(); renderPreview();
}
async function loadLayout() {
  const r = await api('layout'); defaults = r.default;
  L = JSON.parse(JSON.stringify(r.layout)); orig = snap(); render();
}
$('l-add').addEventListener('click', () => { if (L.pages.length >= 16) return toast('16 pages is the limit', true); L.pages.push({ id: newId(), title: 'New page', icon: 'grid', widgets: [] }); render(); $('board').lastElementChild.previousElementSibling.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
$('l-save').addEventListener('click', guard(async () => {
  if (L.pages.some(p => !p.title.trim())) throw new Error('Every page needs a name');
  const r = await api('layout', 'PUT', L); L = JSON.parse(JSON.stringify(r.layout)); orig = snap(); render(); toast('Saved. Devices update within ~15 seconds.');
}));
$('l-revert').addEventListener('click', () => { L = JSON.parse(orig); render(); });
$('l-reset').addEventListener('click', () => { if (confirm('Replace the editor with the default layout? (Nothing changes on devices until you save.)')) { L = JSON.parse(JSON.stringify(defaults)); render(); } });
$('l-export').addEventListener('click', () => {
  const a = el('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(L, null, 2)], { type: 'application/json' })); a.download = 'dashling-layout.json'; a.click(); URL.revokeObjectURL(a.href);
});
$('l-import').addEventListener('click', () => { $('import-text').value = ''; $('import-dlg').showModal(); });
$('import-ok').addEventListener('click', () => {
  try { const j = JSON.parse($('import-text').value); if (!Array.isArray(j.pages)) throw new Error('no pages'); L = { pages: j.pages.map(p => ({ id: String(p.id || newId()), title: String(p.title || 'Page').slice(0, 20), icon: PAGE_ICONS.includes(p.icon) ? p.icon : 'grid', widgets: (p.widgets || []).filter(w => CAT.has(w?.id)).map(w => ({ id: w.id, ...(w.w ? { w: Number(w.w) } : {}) })) })) }; render(); toast('Loaded into the editor. Press Save to apply.'); }
  catch (e) { toast('That is not a valid layout: ' + e.message, true); }
});
window.addEventListener('beforeunload', e => { if (snap() !== orig) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- connections
const SECTIONS = [
  { key: 'host', title: 'Mac (SSH)', test: 'host', note: 'Where stats, now playing, GitHub/GitLab and AI usage come from. Format: login@host.docker.internal. Needs the SSH key set up as in the README.',
    fields: [['target', 'Mac login', 'text', 'you@host.docker.internal']] },
  { key: 'ha', title: 'Home Assistant', test: 'ha', note: 'A long-lived access token. Only the entities listed here can be read or toggled.',
    fields: [['url', 'URL', 'url', 'http://homeassistant.local:8123'], ['token', 'Access token', 'secret'], ['entities', 'Entities (comma separated)', 'text', 'light.desk, switch.fan']] },
  { key: 'printer', title: '3D printer', test: 'printer', note: 'Moonraker (Klipper) or OctoPrint on your network.',
    fields: [['url', 'URL', 'url', 'http://voron.local:7125'], ['type', 'Type', 'select', ['moonraker', 'octoprint']], ['key', 'API key (OctoPrint)', 'secret']] },
  { key: 'github', title: 'GitHub token', test: 'github', note: 'Optional. Only needed if the Mac connection is off. A token with no scopes is enough for public contributions.',
    fields: [['user', 'User name', 'text', 'octocat'], ['token', 'Token', 'secret']] },
];
let CONN = null;
function connCard(s) {
  const card = el('div', 'panel'), data = CONN[s.key], inputs = {}, clear = {};
  card.append(el('h2', '', s.title), el('p', 'hint', s.note));
  for (const [k, label, type, ph] of s.fields) {
    const f = el('div', 'field'), lab = el('label', '', label); f.append(lab);
    let inp;
    if (type === 'select') { inp = el('select'); for (const o of ph) { const op = el('option', '', o); op.value = o; inp.append(op); } inp.value = data[k]; }
    else { inp = el('input'); inp.type = type === 'secret' ? 'password' : type === 'url' ? 'url' : 'text'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.placeholder = ph || '';
      if (type === 'secret') { inp.placeholder = data[k].set ? '•••••••• saved (leave empty to keep)' : 'Not set'; inp.value = ''; }
      else inp.value = data[k] ?? ''; }
    inputs[k] = inp; f.append(inp);
    if (type === 'secret' && data[k].set) { const lbl = el('label', 'chk'), cb = el('input'); cb.type = 'checkbox'; clear[k] = cb; lbl.append(cb, 'Remove the saved value'); f.append(lbl); }
    card.append(f);
  }
  const res = el('span', 'res'), row = el('div', 'row'), save = el('button', 'btn primary', 'Save'), test = el('button', 'btn', 'Test connection');
  save.addEventListener('click', guard(async () => {
    const body = {}; for (const [k, , type] of s.fields) body[k] = type === 'secret' ? (clear[k]?.checked ? '__clear__' : inputs[k].value) : inputs[k].value;
    CONN = await api('connections', 'PUT', { [s.key]: body }); toast(s.title + ' saved'); renderConn();
  }));
  test.addEventListener('click', guard(async () => { res.textContent = 'Testing…'; res.className = 'res'; const r = await api('test/' + s.test, 'POST'); res.textContent = `${r.ok ? '✓' : '✕'} ${r.msg}${r.ok ? ` (${r.ms} ms)` : ''}`; res.className = 'res ' + (r.ok ? 'ok' : 'bad'); }));
  row.append(save, test, res); card.append(row);
  return card;
}
function renderConn() { $('conn-grid').replaceChildren(...SECTIONS.map(connCard)); }
async function loadConn() { CONN = await api('connections'); renderConn(); }

// ---------------------------------------------------------------- devices
const when = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
let pairT;
async function loadDevices() {
  const { devices } = await api('devices'), ul = $('dev-list'); ul.replaceChildren();
  $('dev-empty').hidden = devices.length > 0; $('dev-all').hidden = devices.length === 0;
  for (const d of devices) {
    const li = el('li'), g = el('div', 'grow'), rv = el('button', 'btn sm danger', 'Revoke');
    g.append(el('div', '', d.label), el('div', 'muted', 'Paired ' + when(d.created)));
    rv.addEventListener('click', guard(async () => { if (confirm(`Revoke "${d.label}"? It will need a new code.`)) { await api('devices/' + d.id, 'DELETE'); loadDevices(); } }));
    li.append(g, rv); ul.append(li);
  }
}
$('pair-btn').addEventListener('click', guard(async () => {
  const r = await api('pair-code', 'POST'); $('pair-code').textContent = r.code.slice(0, 3) + ' ' + r.code.slice(3);
  clearInterval(pairT);
  const upd = () => { const s = Math.round((r.expires - Date.now()) / 1000); if (s <= 0) { clearInterval(pairT); $('pair-code').textContent = ''; $('pair-left').textContent = 'Code expired.'; } else $('pair-left').textContent = `valid for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  upd(); pairT = setInterval(upd, 1000);
}));
$('dev-all').addEventListener('click', guard(async () => { if (confirm('Revoke every paired device?')) { await api('devices/all', 'DELETE'); loadDevices(); } }));

// ---------------------------------------------------------------- diagnostics
const CHECKS = [['host', 'Mac connection (SSH)'], ['ha', 'Home Assistant'], ['printer', '3D printer'], ['github', 'GitHub token'], ['internet', 'Internet (stocks, weather)']];
async function runChecks() {
  const ul = $('checks'); ul.replaceChildren();
  await Promise.all(CHECKS.map(async ([k, name]) => {
    const li = el('li'), d = el('span', 'dot'), g = el('div', 'grow'), m = el('div', 'muted', 'Checking…');
    g.append(el('div', '', name), m); li.append(d, g); ul.append(li);
    try { const r = await api('test/' + k, 'POST'); d.className = 'dot ' + (r.ok ? 'ok' : (/not configured/i.test(r.msg) ? '' : 'bad')); m.textContent = r.msg + (r.ok ? ` · ${r.ms} ms` : ''); }
    catch (e) { d.className = 'dot bad'; m.textContent = e.message; }
  }));
}
async function loadDiag() {
  const d = await api('diag'), dl = $('sys'); dl.replaceChildren();
  const rows = [['Node', d.node], ['Uptime', `${Math.floor(d.uptime / 3600)}h ${Math.floor(d.uptime % 3600 / 60)}m`], ['Memory (RSS)', d.rssMB + ' MB'], ['Data folder', d.dataDir + (d.dataWritable ? ' (writable)' : ' (NOT writable, settings will not persist!)')],
    ['Layout', d.customLayout ? 'custom (saved)' : 'default'], ['Paired devices', d.devices], ['Notifications held', d.notifications], ['Panel port (inside container)', d.port]];
  for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', String(v)));
}
$('diag-run').addEventListener('click', guard(runChecks));
$('diag-notif').addEventListener('click', guard(async () => { await api('test-notification', 'POST'); toast('Sent. Check the Inbox page on a device.'); }));
$('diag-cache').addEventListener('click', guard(async () => { await api('clear-caches', 'POST'); toast('Caches cleared'); }));

// ---------------------------------------------------------------- logs
let logT;
async function loadLogs() {
  const { logs } = await api('logs'), pre = $('log'), stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 40;
  pre.replaceChildren();
  for (const x of logs) { const s = el('div', x.k === 'error' ? 'e' : x.k === 'warn' ? 'w2' : '', `${new Date(x.t).toLocaleTimeString()}  ${x.m}`); pre.append(s); }
  if (!logs.length) pre.textContent = 'Nothing logged yet.';
  if (stick) pre.scrollTop = pre.scrollHeight;
}
logT = setInterval(() => { if (!$('t-logs').hidden && $('log-auto').checked && !document.hidden) loadLogs().catch(() => {}); }, 3000);
$('log-copy').addEventListener('click', guard(async () => { await navigator.clipboard.writeText($('log').textContent); toast('Copied'); }));

loadLayout().catch(e => toast(e.message, true));
tab(location.hash.slice(1));
