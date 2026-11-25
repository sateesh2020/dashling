// OBS Studio control over obs-websocket v5 (built into OBS 28+: Tools > WebSocket Server Settings).
// One lazy connection shared by every viewer; closed after a minute without use. Talks to OBS on the Mac only.
import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');

export class ObsClient {
  constructor({ url, password }) {
    this.url = url; this.password = password || '';
    this.enabled = Boolean(url);
    this.ws = null; this.ready = null; this.pending = new Map(); this.seq = 0; this.idle = null;
  }

  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => { if (!settled) { settled = true; reject(err); } this.drop(); };
      let ws;
      try { ws = new WebSocket(this.url, 'obswebsocket.json'); } catch (e) { return fail(new Error('down')); }
      this.ws = ws;
      const timer = setTimeout(() => fail(new Error('down')), 4000);
      ws.onerror = () => { clearTimeout(timer); fail(new Error('down')); };
      ws.onclose = (ev) => { clearTimeout(timer); fail(new Error(ev.code === 4009 ? 'auth' : 'down')); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.op === 0) {                                   // Hello: answer with Identify (+ password proof if OBS asks for one)
          const d = { rpcVersion: 1, eventSubscriptions: 0 };
          if (m.d.authentication) {
            if (!this.password) return fail(new Error('auth'));
            d.authentication = sha(sha(this.password + m.d.authentication.salt) + m.d.authentication.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (m.op === 2) { clearTimeout(timer); settled = true; resolve(); }
        else if (m.op === 7) {
          const p = this.pending.get(m.d.requestId); if (!p) return;
          this.pending.delete(m.d.requestId);
          m.d.requestStatus?.result ? p.resolve(m.d.responseData || {}) : p.reject(new Error(m.d.requestStatus?.comment || 'OBS refused'));
        }
      };
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  drop() {
    try { this.ws?.close(); } catch {}
    this.ws = null; this.ready = null;
    for (const p of this.pending.values()) p.reject(new Error('down'));
    this.pending.clear();
  }

  async request(type, data) {
    await this.connect();
    clearTimeout(this.idle); this.idle = setTimeout(() => this.drop(), 60_000);
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('OBS did not answer')); }, 5000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data } }));
    });
  }

  // never throws: the widget shows a friendly state for "OBS not running" and "wrong password"
  async status() {
    if (!this.enabled) return { disabled: true };
    try {
      const [ver, stream, rec, scenes] = await Promise.all([this.request('GetVersion'), this.request('GetStreamStatus'), this.request('GetRecordStatus'), this.request('GetSceneList')]);
      return {
        up: true, version: ver.obsVersion,
        streaming: Boolean(stream.outputActive), streamTime: (stream.outputTimecode || '').split('.')[0],
        recording: Boolean(rec.outputActive), paused: Boolean(rec.outputPaused), recTime: (rec.outputTimecode || '').split('.')[0],
        scene: scenes.currentProgramSceneName, scenes: [...(scenes.scenes || [])].sort((a, b) => b.sceneIndex - a.sceneIndex).map((s) => s.sceneName),
      };
    } catch (e) { return e.message === 'auth' ? { up: false, auth: true } : { up: false }; }
  }

  async control(action, value) {
    if (!this.enabled) throw new Error('OBS is not configured');
    switch (action) {
      case 'record-start': return void await this.request('StartRecord');
      case 'record-stop': return void await this.request('StopRecord');
      case 'record-pause': return void await this.request('ToggleRecordPause');
      case 'stream-start': return void await this.request('StartStream');
      case 'stream-stop': return void await this.request('StopStream');
      case 'scene': {
        const { scenes } = await this.request('GetSceneList');
        if (typeof value !== 'string' || !scenes.some((s) => s.sceneName === value)) throw new Error('unknown scene');   // only scenes OBS actually has
        return void await this.request('SetCurrentProgramScene', { sceneName: value });
      }
      default: throw new Error('unknown OBS action');
    }
  }
}
