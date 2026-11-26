// The demo server (npm run demo) must keep working, and its data must stay fictional: this is what the README screenshots show.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { WIDGETS } from '../web/widgets.js';

let proc, base, logs = '';
const H = { Authorization: 'Bearer demo' };
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const get = async (p) => (await fetch(base + p, { headers: H })).json();

before(async () => {
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['scripts/demo/server.mjs'], { env: { PATH: process.env.PATH, DEMO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { logs += d; }); proc.stderr.on('data', (d) => { logs += d; });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('demo server did not start:\n' + logs);
});
after(() => proc?.kill());

test('pairing works with the printed code and rejects others', async () => {
  const ok = await fetch(base + '/api/pair', { method: 'POST', body: JSON.stringify({ code: '123456' }) });
  assert.equal(ok.status, 200); assert.ok((await ok.json()).token);
  assert.equal((await fetch(base + '/api/pair', { method: 'POST', body: JSON.stringify({ code: '000000' }) })).status, 401);
  assert.equal((await fetch(base + '/api/stats')).status, 401, 'API needs a token even in the demo');
});

test('the demo layout only uses real widgets and every page has data behind it', async () => {
  const { layout } = await get('/api/layout'); const known = new Set(WIDGETS.map((w) => w.id));
  assert.ok(layout.pages.length >= 8);
  for (const p of layout.pages) for (const w of p.widgets) assert.ok(known.has(w.id), `${w.id} is not a catalogue widget`);
});

test('the main endpoints return the shapes the panel reads', async () => {
  const s = await get('/api/stats'); assert.equal(s.host.name, 'MacBook Pro'); assert.equal(s.history.length, 120); assert.equal(s.host.procs.length, 6);
  assert.equal((await get('/api/weather')).daily.time.length, 7);
  assert.equal((await get('/api/code')).github.weeks.length, 53);
  assert.ok((await get('/api/ai')).claude.sessions.length > 3);
  assert.equal((await get('/api/hn')).items.length, 10);
  assert.ok((await get('/api/docker')).docker.containers.some((c) => c.self));
  assert.equal((await get('/api/temps')).temps.p.length, 8);
  assert.equal((await get('/api/store/checklist')).value.items.length, 5);
  const photo = await fetch(base + '/api/photo?name=sunset-hills.jpg', { headers: H }); assert.match(photo.headers.get('content-type'), /svg/);
});

test('the demo serves the real web app, and the stage page for screenshots', async () => {
  assert.match(await (await fetch(base + '/')).text(), /Dashling/);
  assert.match(await (await fetch(base + '/_stage')).text(), /Dashling demo stage/);
  assert.match(await (await fetch(base + '/_social')).text(), /Dashling social card/);
  assert.match(await (await fetch(base + '/_themetest')).text(), /Dashling theme test screen/);
  assert.equal((await fetch(base + '/extras.js')).status, 200);
});

test('demo data is fictional: nothing that looks like a real person, host, place or project', async () => {
  const paths = ['/api/stats', '/api/weather', '/api/air', '/api/calendar', '/api/docker', '/api/feed', '/api/hn', '/api/feeds', '/api/code', '/api/ai', '/api/nowplaying', '/api/stocks', '/api/obs', '/api/rates', '/api/store/checklist', '/api/store/counters', '/api/notes'];
  const blob = JSON.stringify(await Promise.all(paths.map(get))).toLowerCase();
  for (const bad of ['codemonkey', 'satheesh', 'valluru', 'dhan', 'ziply', 'zoey', 'zai360', 'airflow', 'sunnap', 'andhra', '192.168.', '.local', 'ghp_', 'sk-ant']) assert.ok(!blob.includes(bad), `demo data contains "${bad}"`);
});

test('the demo only listens on localhost', async () => {
  const net_ = await new Promise((res) => { const s = net.connect({ port: new URL(base).port, host: '127.0.0.1' }, () => { s.destroy(); res('ok'); }); s.on('error', () => res('err')); });
  assert.equal(net_, 'ok');
  assert.match(logs, /localhost/);
});
