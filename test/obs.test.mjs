import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ObsClient } from '../server/obs.js';

// A tiny fake OBS that speaks obs-websocket v5, including the password challenge.
const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');
function mockObs(password = '') {
  const st = { rec: false, paused: false, stream: false, scene: 'Main' };
  const scenes = ['Main', 'Be right back', 'Screen'];                       // OBS indexes scenes bottom-up
  const wss = new WebSocketServer({ port: 0, handleProtocols: (ps) => [...ps][0] });
  wss.on('connection', (ws) => {
    const salt = crypto.randomBytes(8).toString('base64'), challenge = crypto.randomBytes(8).toString('base64');
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1, ...(password ? { authentication: { challenge, salt } } : {}) } }));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.op === 1) { if (password && m.d.authentication !== sha(sha(password + salt) + challenge)) return ws.close(4009, 'auth'); return ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })); }
      if (m.op !== 6) return;
      const { requestType: t, requestId: id, requestData: rd } = m.d; let data = {}, ok = true;
      if (t === 'GetVersion') data = { obsVersion: '31.0.0' };
      else if (t === 'GetStreamStatus') data = { outputActive: st.stream, outputTimecode: '00:01:02.123' };
      else if (t === 'GetRecordStatus') data = { outputActive: st.rec, outputPaused: st.paused, outputTimecode: '00:00:09.500' };
      else if (t === 'GetSceneList') data = { currentProgramSceneName: st.scene, scenes: scenes.map((n, i) => ({ sceneName: n, sceneIndex: scenes.length - 1 - i })) };
      else if (t === 'StartRecord') st.rec = true; else if (t === 'StopRecord') { st.rec = false; st.paused = false; }
      else if (t === 'ToggleRecordPause') st.paused = !st.paused;
      else if (t === 'StartStream') st.stream = true; else if (t === 'StopStream') st.stream = false;
      else if (t === 'SetCurrentProgramScene') st.scene = rd.sceneName;
      else ok = false;
      ws.send(JSON.stringify({ op: 7, d: { requestType: t, requestId: id, requestStatus: { result: ok, code: ok ? 100 : 204 }, responseData: data } }));
    });
  });
  return new Promise((resolve) => wss.on('listening', () => resolve({ wss, st, url: `ws://127.0.0.1:${wss.address().port}` })));
}

test('reads status and lists scenes in OBS order (top of the list first)', async () => {
  const { wss, url } = await mockObs('secret'); const c = new ObsClient({ url, password: 'secret' });
  try {
    const s = await c.status();
    assert.equal(s.up, true); assert.equal(s.version, '31.0.0'); assert.equal(s.scene, 'Main');
    assert.deepEqual(s.scenes, ['Main', 'Be right back', 'Screen']);
    assert.equal(s.recTime, '00:00:09', 'timecode trimmed to whole seconds');
  } finally { c.drop(); wss.close(); }
});

test('controls: record, pause, scene and stream', async () => {
  const { wss, url } = await mockObs(); const c = new ObsClient({ url });
  try {
    await c.control('record-start'); assert.equal((await c.status()).recording, true);
    await c.control('record-pause'); assert.equal((await c.status()).paused, true);
    await c.control('record-stop'); assert.equal((await c.status()).recording, false);
    await c.control('scene', 'Screen'); assert.equal((await c.status()).scene, 'Screen');
    await c.control('stream-start'); assert.equal((await c.status()).streaming, true);
    await c.control('stream-stop'); assert.equal((await c.status()).streaming, false);
  } finally { c.drop(); wss.close(); }
});

test('refuses scenes OBS does not have and unknown actions', async () => {
  const { wss, url } = await mockObs(); const c = new ObsClient({ url });
  try {
    await assert.rejects(() => c.control('scene', 'Nope'), /unknown scene/);
    await assert.rejects(() => c.control('scene', undefined), /unknown scene/);
    await assert.rejects(() => c.control('format-disk'), /unknown OBS action/);
  } finally { c.drop(); wss.close(); }
});

test('wrong or missing password gives an auth state, not a crash', async () => {
  const { wss, url } = await mockObs('secret');
  try {
    const bad = new ObsClient({ url, password: 'wrong' }); assert.deepEqual(await bad.status(), { up: false, auth: true }); bad.drop();
    const none = new ObsClient({ url }); assert.deepEqual(await none.status(), { up: false, auth: true }); none.drop();
  } finally { wss.close(); }
});

test('nothing listening gives an offline state, not a crash', async () => {
  const c = new ObsClient({ url: 'ws://127.0.0.1:1' });
  assert.deepEqual(await c.status(), { up: false }); c.drop();
});

test('an empty URL disables the client', async () => {
  const c = new ObsClient({ url: '' });
  assert.deepEqual(await c.status(), { disabled: true });
  await assert.rejects(() => c.control('record-start'), /not configured/);
});
