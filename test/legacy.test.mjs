import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (f) => readFile(new URL(`../web/${f}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

// The lite page and the compat check must stay parseable by browsers from ~2010 (BlackBerry OS 6/7): no post-ES5 syntax.
const BANNED = [[/=>/, 'arrow function'], [/\b(const|let|class)\s/, 'const/let/class'], [/`/, 'template literal'], [/\?\./, 'optional chaining'], [/\?\?/, 'nullish coalescing'],
  [/\basync\b|\bawait\b/, 'async/await'], [/\.\.\./, 'spread/rest'], [/\bimport\b|\bexport\b/, 'modules'], [/\bfetch\(/, 'fetch'], [/\bPromise\b/, 'Promise'], [/\.(includes|startsWith|endsWith|padStart|forEach\b.*=>)/, 'ES6+ method']];
for (const f of ['compat.js', 'lite.js']) {
  test(`${f} contains only ES5 syntax`, async () => {
    const src = strip(await read(f));
    // compat.js names fetch/Promise only to detect them; lite.js must not call them
    for (const [re, name] of BANNED) if (f === 'lite.js' || !['fetch', 'Promise'].includes(name)) assert.ok(!re.test(src), `${f} uses ${name}`);
    new vm.Script(await read(f));       // and it parses
  });
}

test('lite.css avoids features old WebKit lacks', async () => {
  const css = await read('lite.css');
  for (const re of [/var\(--/, /display:\s*(flex|grid)/, /\bgap:/, /clamp\(/, /backdrop-filter/]) assert.ok(!re.test(css), `lite.css uses ${re}`);
});

test('lite.html uses no inline script or style (the CSP forbids both)', async () => {
  const html = await read('lite.html');
  assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), 'inline <script>');
  assert.ok(!/\sstyle=/.test(html), 'inline style attribute');
  assert.ok(!/\son[a-z]+=/.test(html), 'inline event handler');
});

test('compat.js sends an old browser to /lite.html, and leaves a modern one alone', async () => {
  const src = await read('compat.js');
  const run = ({ modern, search = '' }) => {
    let to = null;
    const ctx = { location: { search, replace: (u) => { to = u; } }, sessionStorage: { getItem: () => null, setItem() {} } };
    if (modern) Object.assign(ctx, { fetch() {}, Promise, CSS: { supports: () => true } });
    ctx.window = ctx;                    // in a browser, window is the global object
    ctx.String = modern ? String : { prototype: {} };
    vm.runInNewContext(src, ctx);
    return to;
  };
  assert.equal(run({ modern: true }), null);
  assert.equal(run({ modern: false }), '/lite.html');
  assert.equal(run({ modern: false, search: '?full=1' }), null, '?full=1 must override');
});

test('index.html loads compat.js first, and lite.html exists for it to point at', async () => {
  const html = await read('index.html');
  assert.ok(html.indexOf('/compat.js') > -1 && html.indexOf('/compat.js') < html.indexOf('/theme-boot.js'));
  assert.ok((await read('lite.html')).includes('/lite.js'));
});
