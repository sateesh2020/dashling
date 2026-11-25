// Runs INSIDE the copy of the panel served at /demo/ on the website. It answers the panel's /api/ calls in the browser with the
// same fictional data as `npm run demo` (router.mjs + data.mjs), so the real app runs with no server at all.
import { route, LAYOUT } from './router.mjs';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') || 'glass';
const page = Math.max(0, LAYOUT.pages.findIndex((p) => p.id === (q.get('p') || 'home')));
try { localStorage.setItem('dl_token', 'demo-token'); localStorage.setItem('dl_page', String(page)); localStorage.setItem('dl_theme', theme); } catch { /* private mode: the panel still works */ }
document.documentElement.setAttribute('data-theme', theme);

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  let body = {}; if (init.body) { try { body = JSON.parse(init.body); } catch { /* not JSON */ } }
  const r = route({ method: (init.method || 'GET').toUpperCase(), pathname: url.pathname, searchParams: url.searchParams, authorized: true, body });
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.type } });
};
