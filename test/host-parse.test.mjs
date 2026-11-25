// Contract test: what each OS's gate prints must parse into what the web app expects.
// The fixtures are hand-written samples in each gate's real output format.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HostConnector } from '../server/host.js';

const fx = (n) => readFile(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const host = (outputs) => { const h = new HostConnector({ target: 'me@host', key: 'k', knownHosts: 'k' }); h.run = async (cmd) => { if (!(cmd in outputs)) throw new Error(`unexpected command ${cmd}`); return outputs[cmd]; }; return h; };

for (const os of ['macos', 'linux', 'windows']) {
  test(`${os}: stats parse into the shape the web app reads`, async () => {
    const s = await host({ stats: await fx(`${os}-stats.txt`) }).stats();
    assert.ok(s.name); assert.ok(s.cores > 0);
    assert.ok(s.cpu.idle >= 0 && s.cpu.idle <= 100); assert.ok(s.mem.total > s.mem.used); assert.ok(s.disk.total > s.disk.used);
    assert.equal(typeof s.boot, 'number'); assert.ok(s.net.rx >= 0 && s.net.tx >= 0);
    assert.ok(Array.isArray(s.procs) && s.procs.length > 0, 'top processes');
    for (const p of s.procs) { assert.equal(typeof p.pid, 'number'); assert.equal(typeof p.mine, 'boolean'); assert.ok(p.name); }
    assert.ok(s.battery === null || (s.battery.pct >= 0 && ['charging', 'discharging', 'charged'].includes(s.battery.state)), 'battery state is one of three words');
  });
}

test('a process name that contains a pipe survives parsing', async () => {
  const s = await host({ stats: 'name=x\ncores=1\ncpu_idle=90\nmem_total=2\nmem_used=1\nproc1=5.0|1.0|123|1|weird|name\n' }).stats();
  assert.equal(s.procs[0].name, 'weird|name');
});

test('temps: performance cores, efficiency cores and gpu', async () => {
  const t = await host({ temps: 'pcore1=60\npcore2=62\npcore10=70\necore1=50\ngpu=55\n' }).temps();
  assert.deepEqual(t.p, [60, 62, 70], 'numeric sort, so pcore10 comes after pcore2');
  assert.deepEqual(t.e, [50]); assert.equal(t.gpu, 55);
});
test('temps and fans: "none" and "setup" states', async () => {
  assert.equal((await host({ temps: 'temp_none=1\n' }).temps()).none, true);
  assert.equal((await host({ temps: 'temp_setup=1\n' }).temps()).setup, true);
  assert.deepEqual((await host({ fans: 'fan1=2400\nfan2=2650\n' }).fans()).rpm, [2400, 2650]);
  assert.equal((await host({ fans: 'fan_none=1\n' }).fans()).none, true);
});

test('power: battery health is nominal / design capacity', async () => {
  const p = await host({ power: await fx('macos-power.txt') }).power();
  assert.equal(p.health, 88); assert.equal(p.cycles, 234); assert.equal(p.tempC, 30.2); assert.equal(p.ac, true); assert.equal(p.ratedW, 60);
});
test('power on a desktop (no battery) still parses', async () => {
  const p = await host({ power: 'ac=1\n' }).power();
  assert.equal(p.ac, true); assert.equal(p.health, null); assert.equal(p.sysW, null);
});

test('calendar: events, empty, denied and unsupported', async () => {
  const c = await host({ calendar: 'ev=1795600000|1795603600|0|Work|Standup\nev=1795686400|1795772800|1|Home|Trip | Paris\n' }).calendar();
  assert.equal(c.events.length, 2); assert.equal(c.events[0].title, 'Standup'); assert.equal(c.events[1].allDay, true); assert.equal(c.events[1].title, 'Trip | Paris');
  assert.equal((await host({ calendar: 'cal_denied=1\n' }).calendar()).denied, true);
  assert.equal((await host({ calendar: 'cal_unsupported=1\n' }).calendar()).unsupported, true);
});

test('docker: containers and "docker is down"', async () => {
  const d = await host({ 'docker-ps': 'web|running|Up 2 hours|nginx\ndashling-dashling-1|running|Up 1 hour (healthy)|dashling:local\ndb|exited|Exited (0)|postgres\n' }).docker();
  assert.equal(d.containers.length, 3); assert.equal(d.containers[1].self, true, 'the panel\'s own container is flagged'); assert.equal(d.containers[2].state, 'exited');
  assert.equal((await host({ 'docker-ps': 'docker_down=1\n' }).docker()).down, true);
});

test('control(): only fixed, validated commands are sent', async () => {
  const sent = []; const h = new HostConnector({ target: 'me@host', key: 'k', knownHosts: 'k' }); h.run = async (c) => { sent.push(c); return 'ok'; };
  await h.control('brightness', 40); await h.control('docker', 'restart web'); await h.control('lock');
  assert.deepEqual(sent, ['display-set 40', 'docker-act restart web', 'lock']);
  for (const [a, v] of [['brightness', 101], ['brightness', '5; id'], ['brightness', 1.5], ['docker', 'rm web'], ['docker', 'stop x; ls'], ['shortcut', '../x'], ['shortcut', 'a;b'], ['nope', 1]]) {
    await assert.rejects(() => h.control(a, v), undefined, `${a} ${v} must be rejected`);
  }
  assert.equal(sent.length, 3, 'rejected requests never reach the SSH call');
});

test('killProc: pid must be a sane integer', async () => {
  const sent = []; const h = new HostConnector({ target: 'me@host', key: 'k', knownHosts: 'k' }); h.run = async (c) => { sent.push(c); return 'ok'; };
  await h.killProc(4242, false); await h.killProc(4242, true);
  assert.deepEqual(sent, ['proc-kill 4242', 'proc-kill9 4242']);
  for (const bad of [1, 9, '123', -5, 1.5, 99999999, NaN]) await assert.rejects(() => h.killProc(bad, false));
});
