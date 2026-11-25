// Time, personal, news/data and photo widgets, plus the extra weather widgets (forecast, sun & moon, air quality).
// app.js hands in what these need; each widget only works while its page is on screen (pageHas), so idle pages cost nothing.
export function mountExtras({ api, $, el, pageHas, getIdx, WMO, token }) {
  const on = (id) => pageHas(getIdx(), id);
  const pad = (n) => String(n).padStart(2, '0');
  const kvGet = async (k) => (await api('/api/store/' + k)).value;
  const kvPut = (k, v) => api('/api/store/' + k, { method: 'PUT', body: JSON.stringify({ value: v }) });
  const safeLink = (a, url) => { if (/^https?:\/\//i.test(url || '')) { a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; } return a; };
  const ago = (ms) => { if (!ms) return ''; const m = Math.max(0, (Date.now() - ms) / 60000); return m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const empty = (box, msg) => box.replaceChildren(el('p', 'muted empty', msg));
  const mkBtn = (cls, text, fn, label) => { const b = el('button', cls, text); if (label) b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b; };

  // ============================================================ world clocks
  const DEFAULT_CLOCKS = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo'];
  let clocks = null, clocksEdit = false;
  const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return DEFAULT_CLOCKS; } })();
  const city = (tz) => tz.split('/').pop().replace(/_/g, ' ');
  const fmtIn = (tz, o) => new Intl.DateTimeFormat([], { timeZone: tz, ...o });
  async function loadClocks() { try { const v = await kvGet('clocks'); clocks = Array.isArray(v) && v.length ? v.filter((z) => ZONES.includes(z) || z === 'UTC') : DEFAULT_CLOCKS; } catch { clocks ??= DEFAULT_CLOCKS; } drawClocks(); }
  const saveClocks = () => kvPut('clocks', clocks);
  function drawClocks() {
    const box = $('clk-list'); if (!clocks) return;
    box.replaceChildren(...clocks.map((tz) => { const li = el('li'); li.dataset.tz = tz;
      li.append(el('span', 'clk-c', city(tz)), el('span', 'muted clk-d'), el('b', 'clk-t'));
      if (clocksEdit) li.append(mkBtn('proc-x', '✕', () => { clocks = clocks.filter((z) => z !== tz); saveClocks(); drawClocks(); }, `Remove ${city(tz)}`));
      return li; }));
    $('clk-add').hidden = !clocksEdit; $('clk-edit').textContent = clocksEdit ? 'Done' : 'Edit';
    tickClocks();
  }
  function tickClocks() {
    if (!clocks || !on('world-clocks')) return;
    const now = new Date(), here = now.toDateString();
    for (const li of $('clk-list').children) {
      const tz = li.dataset.tz; li.querySelector('.clk-t').textContent = fmtIn(tz, { hour: 'numeric', minute: '2-digit' }).format(now);
      const d = new Date(now.toLocaleString('en-US', { timeZone: tz })), diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 864e5);
      li.querySelector('.clk-d').textContent = diff === 0 ? 'today' : diff > 0 ? 'tomorrow' : 'yesterday';
    }
  }
  $('clk-edit').addEventListener('click', () => { clocksEdit = !clocksEdit; drawClocks(); });
  $('clk-q').addEventListener('input', () => {
    const q = $('clk-q').value.trim().toLowerCase().replace(/ /g, '_'), res = $('clk-res');
    if (q.length < 2) return res.replaceChildren();
    res.replaceChildren(...ZONES.filter((z) => z.toLowerCase().includes(q) && !clocks.includes(z)).slice(0, 6).map((z) =>
      mkBtn('btn btn-sm btn-secondary', z.replace(/_/g, ' '), () => { clocks.push(z); saveClocks(); $('clk-q').value = ''; res.replaceChildren(); drawClocks(); })));
  });

  // ============================================================ analog clock
  const NS = 'http://www.w3.org/2000/svg';
  const hands = {};
  (() => {
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'an-svg');
    const mk = (tag, a) => { const n = document.createElementNS(NS, tag); for (const k in a) n.setAttribute(k, a[k]); svg.append(n); return n; };
    mk('circle', { cx: 50, cy: 50, r: 47, class: 'an-face' });
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, r1 = i % 3 ? 41 : 38; mk('line', { x1: 50 + 44 * Math.sin(a), y1: 50 - 44 * Math.cos(a), x2: 50 + r1 * Math.sin(a), y2: 50 - r1 * Math.cos(a), class: 'an-tick' }); }
    hands.h = mk('line', { x1: 50, y1: 50, x2: 50, y2: 28, class: 'an-h' }); hands.m = mk('line', { x1: 50, y1: 50, x2: 50, y2: 16, class: 'an-m' }); hands.s = mk('line', { x1: 50, y1: 56, x2: 50, y2: 12, class: 'an-s' });
    mk('circle', { cx: 50, cy: 50, r: 2.6, class: 'an-pin' });
    $('an-box').replaceChildren(svg);
  })();
  function tickAnalog() {
    if (!on('analog')) return;
    const d = new Date(), s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    hands.s.setAttribute('transform', `rotate(${s * 6} 50 50)`); hands.m.setAttribute('transform', `rotate(${m * 6} 50 50)`); hands.h.setAttribute('transform', `rotate(${h * 30} 50 50)`);
    $('an-date').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }

  // ============================================================ stopwatch (per device)
  let sw = lsGet('dl_sw', { run: false, start: 0, acc: 0 });
  const swMs = () => sw.acc + (sw.run ? Date.now() - sw.start : 0);
  function swDraw() {
    const t = swMs(), h = Math.floor(t / 3600e3), m = Math.floor(t / 60e3) % 60, s = Math.floor(t / 1e3) % 60, c = Math.floor(t / 100) % 10;
    $('sw-val').textContent = `${h ? h + ':' + pad(m) : m}:${pad(s)}.${c}`;
    $('sw-go').textContent = sw.run ? 'Pause' : t ? 'Resume' : 'Start'; $('sw-reset').hidden = !t || sw.run;
  }
  $('sw-go').addEventListener('click', () => { if (sw.run) { sw = { run: false, start: 0, acc: swMs() }; } else sw = { run: true, start: Date.now(), acc: sw.acc }; lsSet('dl_sw', sw); swDraw(); });
  $('sw-reset').addEventListener('click', () => { sw = { run: false, start: 0, acc: 0 }; lsSet('dl_sw', sw); swDraw(); });
  const tickStopwatch = () => { if (on('stopwatch') && sw.run) swDraw(); };

  // ============================================================ countdown
  let cd = null, cdEdit = false;
  async function loadCountdown() { try { cd = await kvGet('countdown'); } catch {} drawCountdown(); }
  function drawCountdown() {
    $('cd-form').hidden = !cdEdit; $('cd-edit').textContent = cdEdit ? 'Cancel' : cd ? 'Edit' : 'Set';
    if (!cd?.at) { $('cd-val').textContent = '--'; $('cd-label').textContent = 'No countdown set'; return; }
    $('cd-label').textContent = cd.label || 'Countdown'; tickCountdown();
  }
  function tickCountdown() {
    if (!cd?.at || !on('countdown')) return;
    const ms = Date.parse(cd.at) - Date.now();
    if (!(ms > 0)) { $('cd-val').textContent = 'Now!'; return; }
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
    $('cd-val').textContent = d ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  $('cd-edit').addEventListener('click', () => { cdEdit = !cdEdit; if (cdEdit) { $('cd-name').value = cd?.label || ''; $('cd-at').value = cd?.at || ''; } drawCountdown(); });
  $('cd-form').addEventListener('submit', async (e) => { e.preventDefault(); cd = $('cd-at').value ? { label: $('cd-name').value.trim().slice(0, 40), at: $('cd-at').value } : null; await kvPut('countdown', cd); cdEdit = false; drawCountdown(); });

  // ============================================================ time progress
  function tickProgress() {
    if (!on('time-progress')) return;
    const n = new Date(), y = n.getFullYear(), mo = n.getMonth();
    const startDay = new Date(y, mo, n.getDate()), dow = (n.getDay() + 6) % 7, startWeek = new Date(y, mo, n.getDate() - dow);
    const rows = [['Day', (n - startDay) / 864e5], ['Week', (n - startWeek) / (7 * 864e5)], ['Month', (n - new Date(y, mo, 1)) / (new Date(y, mo + 1, 1) - new Date(y, mo, 1))], ['Year', (n - new Date(y, 0, 1)) / (new Date(y + 1, 0, 1) - new Date(y, 0, 1))]];
    const box = $('tp-list'); if (box.children.length !== rows.length) box.replaceChildren(...rows.map(() => { const d = el('div', 'tp'); d.append(el('span', 'muted'), el('b'), el('div', 'progress')); d.lastChild.append(el('i')); return d; }));
    rows.forEach(([name, f], i) => { const d = box.children[i], p = Math.min(100, Math.max(0, f * 100)); d.children[0].textContent = name; d.children[1].textContent = `${p.toFixed(p < 10 ? 1 : 0)}%`; d.querySelector('i').style.width = `${p}%`; });
  }

  // ============================================================ weather extras: forecast, sun & moon (from /api/weather), air quality
  let lastWx = null;
  const moon = (d = new Date()) => {
    const days = (d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5, cyc = ((days % 29.530588853) + 29.530588853) % 29.530588853, frac = cyc / 29.530588853;
    const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'], icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
    const i = Math.round(frac * 8) % 8; return { name: names[i], icon: icons[i], lit: Math.round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100) };
  };
  function onWeather(w) {
    lastWx = w; drawForecast(); drawSun(); if (on('air')) loadAir();
    drawWxPlaces(w);
  }
  function drawForecast() {
    const w = lastWx, box = $('fc-body'); if (!w) return;
    if (!w.location) return empty(box, 'Pick a city in the Weather card first.');
    const hrs = el('div', 'fc-hours'), h = w.hourly;
    h.time.forEach((t, i) => { const c = el('div', 'fc-h'); c.append(el('span', 'muted', i === 0 ? 'now' : new Date(t).toLocaleTimeString([], { hour: 'numeric' })), el('b', '', WMO(h.weather_code[i])[0]), el('span', '', `${Math.round(h.temperature_2m[i])}°`), el('small', 'muted', h.precipitation_probability[i] ? `${h.precipitation_probability[i]}%` : '')); hrs.append(c); });
    const days = el('ul', 'fc-days'), d = w.daily;
    d.time.forEach((t, i) => { const li = el('li'); li.append(el('span', '', i === 0 ? 'Today' : new Date(t + 'T12:00').toLocaleDateString([], { weekday: 'short' })), el('b', '', WMO(d.weather_code[i])[0]), el('span', 'muted', d.precipitation_probability_max?.[i] ? `${d.precipitation_probability_max[i]}%` : ''), el('span', 'fc-r', `${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°`)); days.append(li); });
    box.replaceChildren(hrs, days); $('fc-sub').textContent = w.location.name;
  }
  function drawSun() {
    const w = lastWx, box = $('sm-body'), m = moon(); if (!w?.location) return empty(box, 'Pick a city in the Weather card first.');
    const rise = new Date(w.daily.sunrise[0]), set = new Date(w.daily.sunset[0]), now = new Date(), t = (x) => x.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const len = set - rise, frac = Math.min(1, Math.max(0, (now - rise) / len)), dl = Math.round(len / 6e4);
    const row = (a, b) => { const r = el('div', 'sm-r'); r.append(el('span', 'muted', a), el('b', '', b)); return r; };
    const bar = el('div', 'progress'); bar.append(el('i')); bar.firstChild.style.width = `${frac * 100}%`;
    box.replaceChildren(row('Sunrise', t(rise)), row('Sunset', t(set)), bar, row('Daylight', `${Math.floor(dl / 60)}h ${dl % 60}m`), row('UV peak', w.daily.uv_index_max?.[0] != null ? String(Math.round(w.daily.uv_index_max[0])) : '--'), row('Moon', `${m.icon} ${m.name} · ${m.lit}%`));
  }
  const AQI = (v) => v == null ? ['--', ''] : v <= 20 ? ['Good', 'ok'] : v <= 40 ? ['Fair', 'ok'] : v <= 60 ? ['Moderate', 'warn'] : v <= 80 ? ['Poor', 'warn'] : ['Very poor', 'bad'];
  async function loadAir() {
    if (!on('air')) return;
    try {
      const r = await api('/api/air'), box = $('air-body');
      if (!r.air) return empty(box, r.error || 'Pick a city in the Weather card first.');
      const a = r.air, [label, tone] = AQI(a.european_aqi); $('air-sub').textContent = r.place || '';
      const big = el('b', 'big-val ' + tone, a.european_aqi == null ? '--' : String(Math.round(a.european_aqi))), lab = el('p', 'sub', `${label} · European AQI`);
      const g = el('div', 'air-g'); for (const [n, v] of [['PM2.5', a.pm2_5], ['PM10', a.pm10], ['O₃', a.ozone], ['NO₂', a.nitrogen_dioxide]]) { const c = el('div'); c.append(el('span', 'muted', n), el('b', '', v == null ? '--' : String(Math.round(v)))); g.append(c); }
      box.replaceChildren(big, lab, g);
    } catch { empty($('air-body'), 'Air quality unavailable right now.'); }
  }

  // ---- weather card: search-as-you-type + saved places
  const wxPut = (body) => api('/api/weather/location', { method: 'PUT', body: JSON.stringify(body) });
  const pickPlace = async (place) => { const r = await wxPut({ place }); $('wx-form').hidden = true; $('wx-q').value = ''; $('wx-results').replaceChildren(); if (!r.error) window.dispatchEvent(new Event('dl-weather-changed')); };
  const search = debounce(async () => {
    const q = $('wx-q').value.trim(), box = $('wx-results'); if (q.length < 2) return box.replaceChildren();
    try {
      const { results } = await api('/api/weather/search?q=' + encodeURIComponent(q));
      if (q !== $('wx-q').value.trim()) return;            // a newer keystroke is already in flight
      box.replaceChildren(...(results.length ? results.map((p) => { const b = mkBtn('wx-res', p.name, () => pickPlace(p)); return b; }) : [el('p', 'muted empty', 'No place found.')]));
    } catch {}
  }, 300);
  $('wx-q').addEventListener('input', search);
  $('wx-form').addEventListener('submit', async (e) => { e.preventDefault(); const first = $('wx-results').querySelector('.wx-res'); if (first) first.click(); });
  function drawWxPlaces(w) {
    const box = $('wx-places'); const places = (w.places || []).filter((p) => !w.location || p.lat !== w.location.lat || p.lon !== w.location.lon);
    box.replaceChildren(...places.map((p) => { const c = el('span', 'wx-chip'); c.append(mkBtn('wx-chip-b', p.name.split(',')[0], () => pickPlace(p), `Show weather for ${p.name}`), mkBtn('wx-chip-x', '✕', async () => { await wxPut({ remove: p }); window.dispatchEvent(new Event('dl-weather-changed')); }, `Remove ${p.name}`)); return c; }));
  }

  // ============================================================ checklist (resets each day)
  let cl = { day: '', items: [] };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const saveCl = debounce(() => kvPut('checklist', cl), 400);
  async function loadChecklist() {
    try { const v = await kvGet('checklist'); if (v && Array.isArray(v.items)) cl = v; } catch {}
    if (cl.day !== today()) { cl.day = today(); cl.items.forEach((i) => { i.done = false; }); saveCl(); }
    drawChecklist();
  }
  function drawChecklist() {
    const box = $('cl-list'); const left = cl.items.filter((i) => !i.done).length; $('cl-sub').textContent = cl.items.length ? `${left} left` : '';
    if (!cl.items.length) return empty(box, 'Add things you repeat every day. Ticks reset at midnight.');
    box.replaceChildren(...cl.items.map((it, n) => { const li = el('li', it.done ? 'done' : ''); const b = mkBtn('cl-box', it.done ? '✓' : '', () => { it.done = !it.done; drawChecklist(); saveCl(); }, it.done ? 'Mark not done' : 'Mark done');
      li.append(b, el('span', 'cl-t', it.t), mkBtn('proc-x', '✕', () => { cl.items.splice(n, 1); drawChecklist(); saveCl(); }, `Remove ${it.t}`)); return li; }));
  }
  $('cl-form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('cl-new').value.trim().slice(0, 60); if (!t || cl.items.length >= 30) return; cl.items.push({ t, done: false }); $('cl-new').value = ''; drawChecklist(); saveCl(); });

  // ============================================================ counters
  let counters = [];
  const saveCt = debounce(() => kvPut('counters', counters), 400);
  async function loadCounters() { try { const v = await kvGet('counters'); if (Array.isArray(v)) counters = v; } catch {} drawCounters(); }
  function drawCounters() {
    const box = $('ct-list'); if (!counters.length) return empty(box, 'Add a counter: water glasses, coffees, reps…');
    box.replaceChildren(...counters.map((c, n) => { const d = el('div', 'ct'); d.append(el('span', 'ct-n', c.name), mkBtn('btn btn-sm btn-secondary', '−', () => { c.n = Math.max(0, c.n - 1); drawCounters(); saveCt(); }, `Decrease ${c.name}`), el('b', 'ct-v', String(c.n)), mkBtn('btn btn-sm btn-secondary', '+', () => { c.n++; drawCounters(); saveCt(); }, `Increase ${c.name}`), mkBtn('proc-x', '✕', () => { counters.splice(n, 1); drawCounters(); saveCt(); }, `Remove ${c.name}`)); return d; }));
  }
  $('ct-form').addEventListener('submit', (e) => { e.preventDefault(); const name = $('ct-new').value.trim().slice(0, 24); if (!name || counters.length >= 8) return; counters.push({ name, n: 0 }); $('ct-new').value = ''; drawCounters(); saveCt(); });

  // ============================================================ quote of the day
  const QUOTES = [
    ['We suffer more often in imagination than in reality.', 'Seneca'], ['What stands in the way becomes the way.', 'Marcus Aurelius'], ['Waste no more time arguing what a good person should be. Be one.', 'Marcus Aurelius'],
    ['It is not that we have a short time to live, but that we waste much of it.', 'Seneca'], ['No man is free who is not master of himself.', 'Epictetus'], ['Well begun is half done.', 'Aristotle'],
    ['We are what we repeatedly do. Excellence, then, is a habit.', 'Will Durant'], ['An investment in knowledge pays the best interest.', 'Benjamin Franklin'], ['Energy and persistence conquer all things.', 'Benjamin Franklin'],
    ['The journey of a thousand miles begins with a single step.', 'Lao Tzu'], ['He who knows he has enough is rich.', 'Lao Tzu'], ['It does not matter how slowly you go as long as you do not stop.', 'Confucius'],
    ['Our greatest glory is not in never falling, but in rising every time we fall.', 'Confucius'], ['In the midst of chaos, there is also opportunity.', 'Sun Tzu'], ['The best way to predict the future is to invent it.', 'Alan Kay'],
    ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'], ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'], ['Nothing will come of nothing.', 'William Shakespeare'],
    ['The unexamined life is not worth living.', 'Socrates'], ['Courage is knowing what not to fear.', 'Plato'], ['Make haste slowly.', 'Augustus'], ['Fortune favors the bold.', 'Virgil'],
    ['Not all those who wander are lost.', 'J. R. R. Tolkien'], ['What we think, we become.', 'Buddha (attributed)'], ['Quality is not an act, it is a habit.', 'Aristotle (attributed)'],
    ['The only thing we have to fear is fear itself.', 'Franklin D. Roosevelt'], ['If you want to go fast, go alone. If you want to go far, go together.', 'African proverb'], ['Done is better than perfect.', 'Sheryl Sandberg'],
  ];
  let qOff = 0;
  function drawQuote() {
    const d = new Date(), n = Math.floor(d / 864e5) + qOff, [t, a] = QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length];
    $('q-text').textContent = `“${t}”`; $('q-by').textContent = `— ${a}`;
  }
  $('q-box').addEventListener('click', () => { qOff++; drawQuote(); });

  // ============================================================ Hacker News + RSS feeds + exchange rates
  async function loadHN() {
    if (!on('hn')) return;
    try {
      const { items, error } = await api('/api/hn'), box = $('hn-list'); if (!items) return empty(box, error || 'Hacker News is unreachable.');
      box.replaceChildren(...items.map((i, n) => { const li = el('li'), a = safeLink(el('a', 'nw-t', i.title), i.url);
        const meta = el('span', 'muted nw-m', `${i.score} pts · ${i.comments} comments · ${ago(i.at)}`); li.append(el('b', 'nw-n', String(n + 1)), el('div', 'nw-b')); li.lastChild.append(a, meta); return li; }));
    } catch { empty($('hn-list'), 'Hacker News is unreachable.'); }
  }
  let feedsEdit = false, feedUrls = [];
  async function loadFeeds() {
    if (!on('feeds')) return;
    try {
      feedUrls = (await kvGet('feeds')) || [];
      const r = await api('/api/feeds'), box = $('fd-list');
      $('fd-form').hidden = !feedsEdit; $('fd-edit').textContent = feedsEdit ? 'Cancel' : 'Feeds';
      if (feedsEdit) $('fd-urls').value = feedUrls.join('\n');
      if (!r.configured) return empty(box, 'Tap Feeds and add RSS/Atom links (https), one per line.');
      const nodes = r.items.map((i) => { const li = el('li'), a = safeLink(el('a', 'nw-t', i.title), i.link); const m = el('span', 'muted nw-m', `${i.source}${i.at ? ' · ' + ago(i.at) : ''}`); li.append(a, m); return li; });
      for (const e of r.errors) nodes.push(el('li', 'muted nw-m', `${new URL(e.url).hostname}: ${e.error}`));
      box.replaceChildren(...(nodes.length ? nodes : [el('li', 'muted empty', 'No items yet.')]));
    } catch { empty($('fd-list'), 'Could not load feeds.'); }
  }
  $('fd-edit').addEventListener('click', () => { feedsEdit = !feedsEdit; loadFeeds(); });
  $('fd-form').addEventListener('submit', async (e) => { e.preventDefault();
    const urls = $('fd-urls').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
    const bad = urls.find((u) => { try { return new URL(u).protocol !== 'https:'; } catch { return true; } }); if (bad) { $('fd-err').textContent = `Use full https:// links (not: ${bad.slice(0, 40)})`; return; }
    $('fd-err').textContent = ''; await kvPut('feeds', urls); feedsEdit = false; loadFeeds(); });
  let ratesEdit = false;
  async function loadRates() {
    if (!on('rates')) return;
    try {
      const cfg = (await kvGet('rates')) || { base: 'USD', symbols: ['EUR', 'GBP', 'INR', 'JPY'] };
      $('fx-form').hidden = !ratesEdit; $('fx-edit').textContent = ratesEdit ? 'Cancel' : 'Edit'; if (ratesEdit) $('fx-cfg').value = `${cfg.base}: ${cfg.symbols.join(', ')}`;
      const r = await api('/api/rates'), box = $('fx-list'); if (!r.rates) return empty(box, r.error || 'Rates unavailable.');
      $('fx-sub').textContent = `1 ${r.rates.base} · ${r.rates.date}`;
      box.replaceChildren(...Object.entries(r.rates.rates).map(([k, v]) => { const li = el('li'), ch = v.change; li.append(el('span', '', k), el('b', '', v.rate >= 100 ? v.rate.toFixed(2) : v.rate.toPrecision(4)), el('span', ch == null ? 'muted' : ch >= 0 ? 'up' : 'down', ch == null ? '' : `${ch > 0 ? '+' : ''}${ch}%`)); return li; }));
    } catch { empty($('fx-list'), 'Rates unavailable.'); }
  }
  $('fx-edit').addEventListener('click', () => { ratesEdit = !ratesEdit; loadRates(); });
  $('fx-form').addEventListener('submit', async (e) => { e.preventDefault();
    const m = $('fx-cfg').value.toUpperCase().match(/[A-Z]{3}/g) || []; if (m.length < 2) { $('fx-err').textContent = 'Write it like  USD: EUR, GBP, INR'; return; }
    $('fx-err').textContent = ''; await kvPut('rates', { base: m[0], symbols: m.slice(1, 9) }); ratesEdit = false; loadRates(); });

  // ============================================================ photo frame (photos come from ~/.dashling/photos on the Mac)
  let photos = [], pIdx = -1, layer = 0, pUrls = [null, null], pTimer = 0, pLoading = false;
  async function loadPhotoList() {
    if (!on('photos')) return;
    try {
      const r = await api('/api/photos'); photos = (r.photos || []).slice().sort(() => Math.random() - 0.5);
      if (!photos.length) { $('ph-msg').hidden = false; $('ph-msg').textContent = r.error ? 'Could not reach your computer.' : 'No photos yet. Put pictures (or a symlink to a folder) in ~/.dashling/photos on your computer.'; return; }
      $('ph-msg').hidden = true; if (pIdx < 0) nextPhoto();
    } catch {}
  }
  async function nextPhoto() {
    if (pLoading || !photos.length || !on('photos')) return; pLoading = true;
    try {
      pIdx = (pIdx + 1) % photos.length;
      const res = await fetch('/api/photo?name=' + encodeURIComponent(photos[pIdx]), { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) throw new Error('photo');
      const url = URL.createObjectURL(await res.blob()), nl = 1 - layer, img = $('ph-' + nl);
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
      img.classList.add('on'); $('ph-' + layer).classList.remove('on'); if (pUrls[layer]) URL.revokeObjectURL(pUrls[layer]); pUrls[layer] = pUrls[nl]; pUrls[nl] = url; layer = nl;
      $('ph-cap').textContent = photos[pIdx].replace(/\.[^.]+$/, '');
    } catch {} finally { pLoading = false; }
  }
  $('ph-box').addEventListener('click', nextPhoto);
  const tickPhotos = () => { if (!on('photos')) return; if (++pTimer >= 15) { pTimer = 0; nextPhoto(); } };

  // ============================================================ wiring
  const tick1 = () => { tickClocks(); tickAnalog(); tickCountdown(); tickProgress(); tickPhotos(); };
  const hourly = () => { if (on('air')) loadAir(); };
  function refresh() {   // called whenever the visible page changes, and once at start
    if (on('world-clocks') && !clocks) loadClocks(); else tickClocks();
    if (on('countdown') && cd === null) loadCountdown();
    if (on('checklist')) loadChecklist(); if (on('counter')) loadCounters(); if (on('quote')) drawQuote();
    if (on('stopwatch')) swDraw(); tick1(); loadHN(); loadFeeds(); loadRates(); loadAir(); loadPhotoList();
  }
  return {
    refresh, onWeather,
    timers: [[tick1, 1000], [tickStopwatch, 250], [loadHN, 300_000], [loadFeeds, 600_000], [loadRates, 1_800_000], [hourly, 900_000], [loadPhotoList, 600_000]],
  };
}
