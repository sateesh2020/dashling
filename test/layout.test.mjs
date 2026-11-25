import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLayout, DEFAULT_LAYOUT, WIDGETS, WIDTHS } from '../web/widgets.js';

test('the default layout is valid and uses only known widgets', () => {
  const l = cleanLayout(DEFAULT_LAYOUT);
  const known = new Set(WIDGETS.map((w) => w.id));
  for (const p of l.pages) for (const w of p.widgets) assert.ok(known.has(w.id), `unknown widget ${w.id}`);
});

test('every widget has a unique id, a name and a default width the grid understands', () => {
  const ids = WIDGETS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate widget ids');
  for (const w of WIDGETS) { assert.ok(w.name, `${w.id} needs a name`); assert.ok(WIDTHS.includes(w.w), `${w.id} width ${w.w} is not in WIDTHS`); }
});

test('every widget in the default layout appears on exactly one page', () => {
  const seen = new Map();
  for (const p of DEFAULT_LAYOUT.pages) for (const w of p.widgets) seen.set(w.id, (seen.get(w.id) || 0) + 1);
  for (const [id, n] of seen) assert.equal(n, 1, `${id} is on ${n} pages`);
});

test('every widget id has a matching card in index.html', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const w of WIDGETS) assert.match(html, new RegExp(`data-w="${w.id}"`), `index.html has no data-w="${w.id}"`);
});

test('unknown widgets are dropped and a widget can sit on one page only', () => {
  const l = cleanLayout({ pages: [
    { id: 'a', title: 'A', icon: 'home', widgets: [{ id: 'clock' }, { id: 'nope' }, { id: 'clock' }] },
    { id: 'b', title: 'B', icon: 'home', widgets: [{ id: 'clock' }, { id: 'weather' }] },
  ] });
  assert.deepEqual(l.pages[0].widgets.map((w) => w.id), ['clock']);
  assert.deepEqual(l.pages[1].widgets.map((w) => w.id), ['weather']);
});

test('invalid layouts are rejected', () => {
  assert.throws(() => cleanLayout({}), /pages/);
  assert.throws(() => cleanLayout({ pages: [] }), /pages/);
  assert.throws(() => cleanLayout({ pages: [{ title: '  ', widgets: [] }] }), /name/);
  assert.throws(() => cleanLayout({ pages: Array.from({ length: 17 }, (_, i) => ({ title: `P${i}`, widgets: [] })) }), /pages/);
});

test('widths are validated and an unknown icon falls back', () => {
  const l = cleanLayout({ pages: [{ title: 'X', icon: 'bogus', widgets: [{ id: 'clock', w: 7 }, { id: 'weather', w: 11 }] }] });
  assert.equal(l.pages[0].icon, 'grid');
  assert.equal(l.pages[0].widgets[0].w, 7);
  assert.equal(l.pages[0].widgets[1].w, undefined, 'a width outside WIDTHS must be ignored');
});
