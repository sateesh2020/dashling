// Single source of truth for what can be on the panel. Imported by the dashboard, the admin page and the server
// (which validates saved layouts against it). A widget is one card (or one group of cards) in index.html tagged data-w="<id>".
// w = default width in a 12-column grid; resize:false means the widget lays itself out (several cards, or its own grid).
export const WIDGETS = [
  { id: 'clock',     name: 'Clock',               w: 5,  resize: true },
  { id: 'weather',   name: 'Weather',             w: 7,  resize: true },
  { id: 'now-playing', name: 'Now playing (compact)', w: 12, resize: true },
  { id: 'stat-cpu',  name: 'CPU ring',            w: 3,  resize: true },
  { id: 'stat-mem',  name: 'Memory ring',         w: 3,  resize: true },
  { id: 'stat-disk', name: 'Disk ring',           w: 3,  resize: true },
  { id: 'stat-batt', name: 'Battery ring',        w: 3,  resize: true },
  { id: 'stat-up',   name: 'Uptime',              w: 3,  resize: true },
  { id: 'stat-load', name: 'Load average',        w: 3,  resize: true },
  { id: 'chart-cpu', name: 'CPU history',         w: 6,  resize: true },
  { id: 'chart-mem', name: 'Memory history',      w: 6,  resize: true },
  { id: 'chart-net', name: 'Network history',     w: 8,  resize: true },
  { id: 'disk',      name: 'Disk usage',          w: 4,  resize: true },
  { id: 'power',     name: 'Power draw',          w: 4,  resize: true },
  { id: 'batt-health', name: 'Battery health',    w: 4,  resize: true },
  { id: 'controls',  name: 'Mac controls (lock, brightness, focus)', w: 6, resize: true },
  { id: 'world-clocks', name: 'World clocks',       w: 6,  resize: true },
  { id: 'analog',    name: 'Analog clock',        w: 3,  resize: true },
  { id: 'stopwatch', name: 'Stopwatch',           w: 4,  resize: true },
  { id: 'countdown', name: 'Countdown',           w: 4,  resize: true },
  { id: 'time-progress', name: 'Day / week / month / year progress', w: 4, resize: true },
  { id: 'forecast',  name: 'Forecast (hourly + 7 days)', w: 12, resize: true },
  { id: 'sun-moon',  name: 'Sun & moon',          w: 4,  resize: true },
  { id: 'air',       name: 'Air quality',         w: 4,  resize: true },
  { id: 'checklist', name: 'Daily checklist',     w: 6,  resize: true },
  { id: 'counter',   name: 'Counters',            w: 4,  resize: true },
  { id: 'quote',     name: 'Quote of the day',    w: 6,  resize: true },
  { id: 'photos',    name: 'Photo frame',         w: 6,  resize: true },
  { id: 'hn',        name: 'Hacker News',         w: 6,  resize: true },
  { id: 'feeds',     name: 'News feeds (RSS)',    w: 6,  resize: true },
  { id: 'rates',     name: 'Exchange rates',      w: 4,  resize: true },
  { id: 'obs',       name: 'OBS controls',        w: 6,  resize: true },
  { id: 'calendar',  name: 'Calendar events',     w: 6,  resize: true },
  { id: 'docker',    name: 'Docker containers',   w: 6,  resize: true },
  { id: 'temps',     name: 'Core temperatures',   w: 6,  resize: true },
  { id: 'fans',      name: 'Fan speed',           w: 6,  resize: true },
  { id: 'procs',     name: 'Top processes',       w: 6,  resize: true },
  { id: 'battery',   name: 'Battery bar',         w: 12, resize: true },
  { id: 'code',      name: 'GitHub / GitLab + reviews', w: 12, resize: false },
  { id: 'ai',        name: 'AI tool usage',       w: 12, resize: false },
  { id: 'stocks',    name: 'Stock watchlist',     w: 12, resize: true },
  { id: 'printer',   name: '3D printer',          w: 12, resize: false },
  { id: 'media',     name: 'Media player (large)', w: 12, resize: true },
  { id: 'shortcuts', name: 'Shortcuts',           w: 12, resize: true },
  { id: 'media-keys', name: 'Media keys',         w: 12, resize: true },
  { id: 'apps',      name: 'Mac apps',            w: 6,  resize: true },
  { id: 'ha',        name: 'Home Assistant',      w: 6,  resize: true },
  { id: 'timer',     name: 'Timer / Pomodoro',    w: 6,  resize: true },
  { id: 'notes',     name: 'Notes',               w: 6,  resize: true },
  { id: 'inbox',     name: 'Notifications',       w: 7,  resize: true },
  { id: 'values',    name: 'Pushed values',       w: 5,  resize: true },
];
export const WIDTHS = [3, 4, 5, 6, 7, 8, 9, 12];
export const PAGE_ICONS = ['home', 'activity', 'github', 'spark', 'trend', 'printer', 'music', 'bolt', 'timer', 'bell', 'grid', 'cpu', 'layers', 'drive', 'battery', 'terminal', 'globe', 'bulb', 'window', 'link', 'moon', 'code', 'thermo'];

const P = (id, title, icon, ws) => ({ id, title, icon, widgets: ws.map(w => ({ id: w })) });
export const DEFAULT_LAYOUT = {
  pages: [
    P('home', 'Home', 'home', ['clock', 'weather', 'now-playing', 'stat-cpu', 'stat-mem', 'stat-disk', 'stat-batt']),
    P('system', 'System', 'activity', ['chart-cpu', 'chart-mem', 'chart-net', 'disk', 'battery', 'stat-up', 'stat-load', 'temps', 'fans', 'power', 'batt-health', 'procs']),
    P('time', 'Time', 'timer', ['world-clocks', 'analog', 'stopwatch', 'countdown', 'time-progress', 'forecast', 'sun-moon', 'air']),
    P('personal', 'Personal', 'bulb', ['checklist', 'counter', 'quote', 'photos']),
    P('news', 'News', 'globe', ['hn', 'feeds', 'rates']),
    P('mac', 'Mac', 'window', ['controls', 'obs', 'calendar', 'docker']),
    P('code', 'Code', 'github', ['code']),
    P('ai', 'AI', 'spark', ['ai']),
    P('stocks', 'Stocks', 'trend', ['stocks']),
    P('printer', 'Printer', 'printer', ['printer']),
    P('media', 'Media', 'music', ['media']),
    P('shortcuts', 'Shortcuts', 'bolt', ['shortcuts', 'media-keys', 'apps', 'ha']),
    P('focus', 'Focus', 'timer', ['timer', 'notes']),
    P('inbox', 'Inbox', 'bell', ['inbox', 'values']),
  ],
};

// Returns a clean layout or throws. Unknown widgets are dropped, a widget can sit on one page only.
export function cleanLayout(input) {
  const pages = input?.pages;
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 16) throw new Error('between 1 and 16 pages');
  const known = new Map(WIDGETS.map(w => [w.id, w])), used = new Set(), ids = new Set();
  const out = pages.map((p, n) => {
    const title = String(p?.title ?? '').trim().slice(0, 20);
    if (!title) throw new Error(`page ${n + 1} needs a name`);
    let id = /^[a-z0-9_-]{1,24}$/.test(p?.id || '') ? p.id : 'p' + Math.random().toString(36).slice(2, 8);
    if (ids.has(id)) id = 'p' + Math.random().toString(36).slice(2, 8);
    ids.add(id);
    const widgets = [];
    for (const w of Array.isArray(p.widgets) ? p.widgets : []) {
      const def = known.get(w?.id);
      if (!def || used.has(def.id)) continue;
      used.add(def.id);
      const item = { id: def.id };
      if (def.resize && WIDTHS.includes(Number(w.w)) && Number(w.w) !== def.w) item.w = Number(w.w);
      widgets.push(item);
    }
    return { id, title, icon: PAGE_ICONS.includes(p.icon) ? p.icon : 'grid', widgets };
  });
  return { pages: out };
}
