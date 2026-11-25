// Builds the GitHub Pages site and checks it the way a visitor (and the Pages server) would hit it: every local link resolves,
// the embedded panel has no absolute paths left, the shim runs before the app, and the static demo's API actually answers.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WIDGETS } from '../web/widgets.js';

let out;
const exists = (p) => access(join(out, p)).then(() => true, () => false);
const attrs = (html, names) => [...html.matchAll(new RegExp(`(?:${names.join('|')})="([^"]+)"`, 'g'))].map((m) => m[1]);
const local = (u) => !/^(https?:|mailto:|data:|#|\/\/)/.test(u);
const clean = (u) => u.split('#')[0].split('?')[0];

before(async () => { out = await mkdtemp(join(tmpdir(), 'dashling-site-')); execFileSync(process.execPath, ['scripts/build-site.mjs', out], { stdio: 'pipe' }); });
after(() => rm(out, { recursive: true, force: true }));

test('the site has the pages and files Pages needs', async () => {
  for (const f of ['index.html', 'styles.css', 'main.js', 'favicon.png', 'og.jpg', '404.html', 'robots.txt', 'sitemap.xml', '.nojekyll', 'demo/index.html', 'demo/demo-shim.mjs', 'demo/router.mjs', 'demo/data.mjs', 'fonts/LICENSES.txt', 'demo/fonts/LICENSES.txt']) assert.ok(await exists(f), `${f} is missing`);
  assert.match(await readFile(join(out, 'index.html'), 'utf8'), /<title>Dashling/);
});

test('placeholders are filled and the widget count matches the catalogue', async () => {
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.ok(!html.includes('{{'), 'an unfilled {{placeholder}} is left');
  assert.ok(html.includes(`data-count="${WIDGETS.length}"`), 'widget count on the page is stale');
});

test('every local link, image, script and font on the landing page exists', async () => {
  const html = await readFile(join(out, 'index.html'), 'utf8');
  const css = await readFile(join(out, 'styles.css'), 'utf8');
  const refs = [...attrs(html, ['href', 'src', 'data-src']).filter(local), ...[...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, '')).filter(local)];
  assert.ok(refs.length >= 10, `only ${refs.length} local references found: the checker is probably not parsing the page`);
  for (const r of refs) assert.ok(await exists(clean(r)), `landing page links to ${r}, which is not in the build`);
});

test('the embedded panel works from a sub-folder: relative paths, shim first', async () => {
  const html = await readFile(join(out, 'demo/index.html'), 'utf8');
  assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/, 'an absolute path is left: it would break under /dashling/');
  assert.ok(html.indexOf('demo-shim.mjs') > 0 && html.indexOf('demo-shim.mjs') < html.indexOf('./app.js'), 'the shim must load before the app');
  for (const r of attrs(html, ['href', 'src']).filter(local)) assert.ok(await exists(join('demo', clean(r))), `demo/index.html links to ${r}`);
  const css = await readFile(join(out, 'demo/style.css'), 'utf8');
  assert.doesNotMatch(css, /url\(\/fonts/, 'a font URL is still absolute');
  for (const m of css.matchAll(/url\((fonts\/[^)]+)\)/g)) assert.ok(await exists(join('demo', m[1])), `demo font ${m[1]} is missing`);
});

test('the static demo answers the panel\'s API with the files exactly as shipped', async () => {
  const { route, LAYOUT } = await import(pathToFileURL(join(out, 'demo/router.mjs')).href);   // imports ./data.mjs and ./widgets.js from the build
  assert.ok(LAYOUT.pages.length >= 8);
  const stats = JSON.parse(route({ method: 'GET', pathname: '/api/stats', searchParams: new URLSearchParams(), authorized: true }).body);
  assert.equal(stats.host.name, 'MacBook Pro');
  assert.equal(route({ method: 'GET', pathname: '/api/stats', searchParams: new URLSearchParams(), authorized: false }).status, 401);
});

test('nothing private or server-side is published', async () => {
  const all = [];
  const walk = async (d) => { for (const n of await readdir(join(out, d))) { const p = join(d, n); (await stat(join(out, p))).isDirectory() ? await walk(p) : all.push(p); } };
  await walk('.');
  for (const f of all) assert.doesNotMatch(f, /(^|\/)(admin|server|host|\.env|id_ed25519)|\.(pem|key|keystore|apk)$/, `${f} should not be published`);
  const size = (await Promise.all(all.map(async (f) => (await stat(join(out, f))).size))).reduce((a, b) => a + b, 0);
  assert.ok(size < 9 * 1024 * 1024, `the site is ${(size / 1048576).toFixed(1)} MB: keep it light`);
});
