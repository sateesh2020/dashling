// Starts the real server (no computer connected, no network needed) and checks the things that must never regress:
// authentication, security headers, static-file safety, the storage whitelist, and refusals when nothing is connected.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'test-token-0123456789abcdef';
let proc, dir, base, logs = '';
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const call = (path, { method = 'GET', body, auth = true } = {}) => fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dashling-test-'));
  const [port, admin] = [await freePort(), await freePort()];
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server/index.js'], { env: { PATH: process.env.PATH, DATA_DIR: dir, PORT: String(port), ADMIN_PORT: String(admin), DASHLING_TOKEN: TOKEN, OBS_URL: '', HOST_SSH: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { logs += d; }); proc.stderr.on('data', (d) => { logs += d; });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start:\n' + logs);
});
after(async () => { proc?.kill(); await rm(dir, { recursive: true, force: true }); });

test('health is public and reports a build fingerprint', async () => {
  const j = await (await call('/api/health', { auth: false })).json();
  assert.equal(j.ok, true); assert.match(j.build, /^[0-9a-f]{12}$/);
});

test('API calls need the token', async () => {
  for (const p of ['/api/stats', '/api/layout', '/api/obs', '/api/store/clocks', '/api/power']) assert.equal((await call(p, { auth: false })).status, 401, p);
  assert.equal((await fetch(base + '/api/stats', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
});

test('with the token, stats say no computer is connected', async () => {
  const r = await call('/api/stats'); assert.equal(r.status, 200); assert.equal((await r.json()).host, null);
});

test('security headers are present', async () => {
  const r = await call('/', { auth: false });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(await r.text(), /Dashling/);
});

test('the front-end files are served', async () => {
  for (const f of ['/app.js', '/extras.js', '/widgets.js', '/style.css', '/sw.js']) assert.equal((await call(f, { auth: false })).status, 200, f);
});

test('static serving cannot escape the web folder', async () => {
  const [host, port] = [new URL(base).hostname, new URL(base).port];
  for (const path of ['/../server/index.js', '/..%2fserver/index.js', '/%2e%2e/server/index.js', '/....//server/index.js']) {
    const raw = await new Promise((res) => { const s = net.connect(port, host, () => s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)); let b = ''; s.on('data', (d) => { b += d; }); s.on('close', () => res(b)); });
    assert.doesNotMatch(raw, /import http from/, `leaked server source via ${path}`);
    assert.match(raw.split('\r\n')[0], /\s(403|404)\s/, `${path} -> ${raw.split('\r\n')[0]}`);
  }
});

test('the default layout is served and valid', async () => {
  const j = await (await call('/api/layout')).json();
  assert.ok(j.layout.pages.length >= 1); assert.equal(j.custom, false);
});

test('storage: whitelist, size cap and round trip', async () => {
  assert.equal((await call('/api/store/evil', { method: 'PUT', body: { value: 1 } })).status, 404);
  assert.equal((await call('/api/store/../../etc/passwd')).status, 404);
  assert.equal((await call('/api/store/counters', { method: 'PUT', body: { value: 'x'.repeat(25000) } })).status, 400);
  assert.equal((await call('/api/store/checklist', { method: 'PUT', body: { value: { day: 'd', items: [{ t: 'a', done: false }] } } })).status, 200);
  assert.deepEqual((await (await call('/api/store/checklist')).json()).value.items, [{ t: 'a', done: false }]);
});

test('controls are refused cleanly when no computer is connected', async () => {
  for (const [path, body] of [['/api/ctl', { action: 'lock' }], ['/api/proc/kill', { pid: 4242 }], ['/api/action', { action: 'playpause' }]]) {
    const r = await call(path, { method: 'POST', body }); assert.equal(r.status, 400, path); assert.match((await r.json()).error, /no host/);
  }
});

test('OBS is disabled when OBS_URL is empty', async () => {
  assert.deepEqual(await (await call('/api/obs')).json(), { obs: { disabled: true } });
});

test('photo names cannot be paths', async () => {
  for (const n of ['../../etc/passwd', '..%2f..%2fetc%2fpasswd', 'a.txt']) assert.equal((await call('/api/photo?name=' + n)).status, 404, n);
});

test('weather search ignores one-letter queries without calling out', async () => {
  assert.deepEqual(await (await call('/api/weather/search?q=a')).json(), { results: [] });
});

test('the admin page is not on the public port', async () => {
  assert.equal((await call('/admin/api/layout')).status, 404);
});
