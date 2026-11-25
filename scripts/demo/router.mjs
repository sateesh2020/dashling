// What the demo API answers. Pure functions only (no Node-only APIs): used by the Node demo server (server.mjs) and, in the
// browser, by the landing page's live demo (build-site.mjs copies this file next to the panel).
import { DEFAULT_LAYOUT, cleanLayout } from '../../web/widgets.js';
import * as D from './data.mjs';

export const CODE = '123456';

// A demo-friendly order. Pages that need hardware we don't fake (printer, shortcuts) are left out.
const ORDER = ['home', 'system', 'mac', 'time', 'personal', 'news', 'code', 'ai', 'stocks', 'media'];
const byId = new Map(DEFAULT_LAYOUT.pages.map((p) => [p.id, p]));
export const LAYOUT = cleanLayout({ pages: ORDER.map((id) => ({ ...byId.get(id), title: id === 'mac' ? 'Computer' : byId.get(id).title })) });
// The photo frame first, so the Personal page opens on something pretty.
LAYOUT.pages.find((p) => p.id === 'personal').widgets = ['photos', 'checklist', 'counter', 'quote'].map((id) => ({ id }));
const STORE = D.store();

const ok = (body, status = 200) => ({ status, type: 'application/json', body: JSON.stringify(body) });
const svg = (body) => ({ status: 200, type: 'image/svg+xml', body });

// route({ method, pathname, searchParams, authorized, body }) -> { status, type, body }
export function route({ method, pathname: p, searchParams, authorized, body = {} }) {
  if (p === '/api/health') return ok({ ok: true, build: 'demo' });
  if (p === '/api/pair/start') return ok({ ok: true });
  if (p === '/api/pair') return body.code === CODE ? ok({ token: 'demo-token' }) : ok({ error: 'wrong code' }, 401);
  if (!authorized) return ok({ error: 'unauthorized' }, 401);
  const now = Date.now();
  switch (p) {
    case '/api/layout': return ok({ layout: LAYOUT, rev: 'demo', custom: false });
    case '/api/stats': return ok(D.stats(now));
    case '/api/fans': return ok(D.fans(now));
    case '/api/temps': return ok(D.temps(now));
    case '/api/power': return ok(D.power(now));
    case '/api/display': return ok(D.display());
    case '/api/docker': return ok(D.docker());
    case '/api/calendar': return ok(D.calendar(now));
    case '/api/obs': return ok(method === 'POST' ? { ok: true } : D.obs());
    case '/api/nowplaying': return ok(D.nowplaying(now));
    case '/api/artwork': return svg(D.artworkSvg());
    case '/api/feed': return ok(D.feed());
    case '/api/weather': return ok(D.weather());
    case '/api/air': return ok(D.air());
    case '/api/hn': return ok(D.hn());
    case '/api/feeds': return ok(D.feeds());
    case '/api/rates': return ok(D.rates());
    case '/api/stocks': return ok(D.stocks(searchParams.get('range') || '1d'));
    case '/api/code': return ok(D.code());
    case '/api/ai': return ok(D.ai());
    case '/api/photos': return ok({ photos: D.PHOTOS });
    case '/api/photo': return svg(D.photoSvg(searchParams.get('name') || ''));
    case '/api/apps': return ok({ apps: ['Safari', 'Music', 'Notes', 'Calendar'] });
    case '/api/notes': return ok({ text: method === 'PUT' ? '' : 'Ideas for the weekend:\n- tidy the cable drawer\n- try the new coffee beans' });
    case '/api/weather/search': return ok({ results: [{ name: 'Lisbon, Lisboa, PT', lat: 38.72, lon: -9.14 }, { name: 'Lisbon, Maine, US', lat: 44.03, lon: -70.1 }] });
  }
  if (p.startsWith('/api/store/')) {
    const key = p.slice(11);
    if (method === 'PUT') { STORE[key] = body.value ?? null; return ok({ ok: true }); }
    return ok({ value: STORE[key] ?? null });
  }
  return ok(method === 'GET' ? {} : { ok: true });     // anything else (volume, actions, controls...) just succeeds
}
