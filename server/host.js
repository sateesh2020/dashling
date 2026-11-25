// Talks to the Mac over SSH. The Mac's authorized_keys pins this key to
// host/dashling-gate.sh, so only the fixed commands below can ever run.
import { execFile } from 'node:child_process';

const SOURCES = { 'com.google.Chrome': 'Chrome', 'com.apple.Safari': 'Safari', 'org.mozilla.firefox': 'Firefox', 'company.thebrowser.Browser': 'Arc',
  'com.microsoft.edgemac': 'Edge', 'com.brave.Browser': 'Brave', 'com.spotify.client': 'Spotify', 'com.apple.Music': 'Music',
  'com.apple.podcasts': 'Podcasts', 'org.videolan.vlc': 'VLC', 'com.apple.TV': 'TV' };
const sourceName = id => !id ? '' : SOURCES[id] || id.split('.').pop();

export class HostConnector {
  constructor({ target, key, knownHosts }) {
    this.target = target; this.key = key; this.knownHosts = knownHosts;
    this.enabled = Boolean(target);
    this.cache = null; this.cacheAt = 0; this.inflight = null;
    this.history = []; this.lastNet = null;       // last ~10 min of samples for the graphs
  }

  run(command, timeout = 15_000) {
    const args = ['-i', this.key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${this.knownHosts}`,
      '-o', 'IdentitiesOnly=yes', this.target, command];
    return new Promise((resolve, reject) => {
      execFile('ssh', args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
        err ? reject(new Error(stderr.trim().split('\n').pop() || err.message)) : resolve(stdout));
    });
  }

  runBuffer(command, timeout = 20_000, max = 8 * 1024 * 1024) {
    const args = ['-i', this.key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${this.knownHosts}`, '-o', 'IdentitiesOnly=yes', this.target, command];
    return new Promise((resolve, reject) => {
      execFile('ssh', args, { timeout, maxBuffer: max, encoding: 'buffer' }, (err, stdout, stderr) =>
        err ? reject(new Error(String(stderr || '').trim().split('\n').pop() || err.message)) : resolve(stdout));
    });
  }

  // Photo frame: names come from the Mac's ~/.dashling/photos; each photo is fetched once, shrunk on the Mac, and kept in a small LRU
  async photos() {
    if (this.photoList && Date.now() - this.photoListAt < 60_000) return this.photoList;
    this.photoList = (await this.run('photo-list')).split('\n').map(s => s.trim()).filter(Boolean); this.photoListAt = Date.now();
    return this.photoList;
  }
  async photo(name) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,100}\.(jpe?g|png|webp|heic)$/i.test(name) || !(await this.photos()).includes(name)) throw new Error('no such photo');
    const c = (this.photoCache ??= new Map());
    if (c.has(name)) { const v = c.get(name); c.delete(name); c.set(name, v); return v; }
    const buf = await this.runBuffer(`photo-get ${name}`);
    if (!buf.length) throw new Error('photo could not be read');
    c.set(name, buf); while (c.size > 8) c.delete(c.keys().next().value);
    return buf;
  }

  // one SSH call at a time, shared by every viewer, cached for 2s
  async stats() {
    if (Date.now() - this.cacheAt < 2000 && this.cache) return this.cache;
    this.inflight ??= this.run('stats').then(out => {
      const o = {};
      for (const line of out.split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i)] = line.slice(i + 1); }
      const num = k => (o[k] === undefined || o[k] === '' ? null : Number(o[k]));
      this.cache = {
        name: o.name || 'Mac', cores: num('cores'),
        cpu: { user: num('cpu_user'), sys: num('cpu_sys'), idle: num('cpu_idle') },
        mem: { used: num('mem_used'), total: num('mem_total') },
        disk: { used: num('disk_used'), total: num('disk_total') },
        battery: o.batt_pct ? { pct: num('batt_pct'), state: o.batt_state || '', time: o.batt_time || '' } : null,
        load: o.load ? o.load.trim().split(/\s+/).map(Number) : null,
        procs: [1, 2, 3, 4, 5, 6].map(i => (o['proc' + i] || '').split('|')).filter(p => p.length >= 5).map(p => ({ cpu: Number(p[0]), mem: Number(p[1]), pid: Number(p[2]), mine: p[3] === '1', name: p.slice(4).join('|') })),
        boot: num('boot'), volume: num('volume'),
        net: { rx: num('net_rx'), tx: num('net_tx') },
      };
      this.cacheAt = Date.now();
      this.record(this.cache);
      return this.cache;
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  // Append one graph sample. Network counters become bytes/second from the previous sample.
  record(c) {
    const now = Date.now(); let rx = null, tx = null;
    if (c.net.rx != null && this.lastNet && now > this.lastNet.t) {
      const dt = (now - this.lastNet.t) / 1000;
      rx = Math.max(0, (c.net.rx - this.lastNet.rx) / dt); tx = Math.max(0, (c.net.tx - this.lastNet.tx) / dt);
    }
    if (c.net.rx != null) this.lastNet = { t: now, rx: c.net.rx, tx: c.net.tx };
    this.history.push({ t: now, cpu: c.cpu.idle == null ? null : +(100 - c.cpu.idle).toFixed(1),
      mem: c.mem.total ? +(c.mem.used / c.mem.total * 100).toFixed(1) : null, rx: rx == null ? null : Math.round(rx), tx: tx == null ? null : Math.round(tx) });
    if (this.history.length > 240) this.history.shift();
  }

  async setVolume(level) {
    if (!Number.isInteger(level) || level < 0 || level > 100) throw new Error('bad level');
    await this.run(`volume-set ${level}`);
    this.cacheAt = 0;
  }

  // Now Playing: one shared SSH call at a time, cached 1.5s
  async nowPlaying() {
    if (this.npCache && Date.now() - this.npAt < 1500) return this.npCache;
    this.npInflight ??= this.run('nowplaying').then(out => {
      const o = {};
      for (const line of out.split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i)] = line.slice(i + 1).trim(); }
      const n = k => { const v = parseFloat((o[k] || '').replace(',', '.')); return Number.isFinite(v) ? v : null; };
      this.npCache = o.title ? {
        src: o.src || '', source: sourceName(o.src), title: o.title, artist: o.artist || '', album: o.album || '',
        duration: n('duration'), elapsed: n('elapsed'), playing: (n('rate') ?? 0) > 0,
        key: `${o.title}|${o.artist}|${o.album}`, arturl: o.arturl || '',
      } : null;
      this.npAt = Date.now();
      this.trackPosition(this.npCache);
      return this.npCache;
    }).finally(() => { this.npInflight = null; });
    return this.npInflight;
  }

  // Browsers and some players never update their position (it stays 0). For those, advance it by the
  // wall clock while playing, and re-sync whenever the app reports a different value.
  trackPosition(np) {
    if (!np) { this.anchor = null; return; }
    if (np.src === 'com.spotify.client' || np.src === 'com.apple.Music') { this.anchor = null; return; }
    const now = Date.now(), a = this.anchor;
    if (!a || a.key !== np.key) this.anchor = { key: np.key, reported: np.elapsed, cur: np.elapsed ?? 0, last: now };
    else {
      if (np.elapsed !== a.reported) { a.reported = np.elapsed; a.cur = np.elapsed ?? a.cur; }
      else if (np.playing) a.cur += Math.min(now - a.last, 3000) / 1000;   // cap: a long gap may have included a pause
      a.last = now;
    }
    const cur = this.anchor.cur;
    np.elapsed = np.duration ? Math.min(cur, np.duration) : cur;
  }

  // Album art for the current track, cached per track. Returns { type, data } or null.
  async artwork() {
    const np = await this.nowPlaying();
    if (!np) return null;
    if (this.artKey === np.key) return this.art;
    let art = null;
    try {
      if (np.arturl.startsWith('https://i.scdn.co/')) {            // only Spotify's image host, never an arbitrary URL
        const r = await fetch(np.arturl, { signal: AbortSignal.timeout(6000) });
        if (r.ok) art = Buffer.from(await r.arrayBuffer());
      }
      if (!art) {                                                  // browsers, Music, anything else: system artwork
        const b64 = (await this.run('artwork')).trim();
        if (b64 && b64 !== 'null') art = Buffer.from(b64, 'base64');
      }
    } catch {}
    if (art && art.length > 8_000_000) art = null;
    const type = !art ? null : art[0] === 0x89 ? 'image/png' : art[0] === 0xff ? 'image/jpeg' : null;
    this.artKey = np.key; this.art = type ? { type, data: art } : null;
    return this.art;
  }

  // contribution sources, read with the gh / glab logins that already exist on the Mac
  async ghContrib() {
    const j = JSON.parse(await this.run('gh-contrib', 40_000));
    const v = j.data?.viewer; if (!v) throw new Error('gh returned no data');
    const days = {};
    for (const w of v.contributionsCollection.contributionCalendar.weeks) for (const d of w.contributionDays) days[d.date] = d.contributionCount;
    return { user: v.login, days };
  }
  async glContrib() {
    const out = await this.run('gl-contrib', 90_000), days = {}; let user = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('user=')) user = line.slice(5).trim();
      else if (/^\d{4}-\d{2}-\d{2}$/.test(line.trim())) days[line.trim()] = (days[line.trim()] || 0) + 1;
    }
    return { user, days };
  }

  // open PRs / MRs waiting for your review (cached by the sync job on the Mac)
  async reviews(which) {
    if (which !== 'gh' && which !== 'gl') throw new Error('bad source');
    const j = JSON.parse(await this.run(`${which}-reviews`)); return Array.isArray(j) ? j : [];
  }

  // AI coding tool usage, collected on the Mac by ai-usage-sync.sh
  async aiUsage() { return JSON.parse(await this.run('ai-usage')); }

  // Fan RPM (needs the one-time sudoers rule from host/enable-fans.sh). Cached 5s, one SSH call shared by all viewers.
  async fans() {
    if (this.fanCache && Date.now() - this.fanAt < 5000) return this.fanCache;
    this.fanInflight ??= this.run('fans').then(out => {
      const o = {};
      for (const line of out.split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i)] = line.slice(i + 1).trim(); }
      this.fanCache = { setup: o.fan_setup === '1', none: o.fan_none === '1', rpm: Object.keys(o).filter(k => /^fan\d+$/.test(k)).map(k => Number(o[k])) };
      this.fanAt = Date.now(); return this.fanCache;
    }).finally(() => { this.fanInflight = null; });
    return this.fanInflight;
  }

  // Core temperatures from the SMC (see host/smcfan.c). Cached 4s.
  async temps() {
    if (this.tCache && Date.now() - this.tAt < 4000) return this.tCache;
    this.tInflight ??= this.run('temps').then(out => {
      const o = {};
      for (const line of out.split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i)] = line.slice(i + 1).trim(); }
      const list = re => Object.keys(o).filter(k => re.test(k)).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, ''))).map(k => Number(o[k]));
      this.tCache = { setup: o.temp_setup === '1', none: o.temp_none === '1', p: list(/^pcore\d+$/), e: list(/^ecore\d+$/), gpu: o.gpu ? Number(o.gpu) : null };
      this.tAt = Date.now(); return this.tCache;
    }).finally(() => { this.tInflight = null; });
    return this.tInflight;
  }

  // generic read helpers: key=value text and "ev=a|b|c" lists, cached briefly and shared by every viewer
  async cached(key, ttl, cmd, parse) {
    const c = (this.xc ??= {}); const e = c[key];
    if (e?.v && Date.now() - e.at < ttl) return e.v;
    e && e.p || (c[key] = { ...(e || {}), p: this.run(cmd).then(out => { const v = parse(out); c[key] = { v, at: Date.now() }; return v; }).finally(() => { if (c[key]) c[key].p = null; }) });
    return c[key].p;
  }
  kv(out) { const o = {}; for (const line of out.split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i)] = line.slice(i + 1).trim(); } return o; }
  power() {
    return this.cached('power', 4000, 'power', out => {
      const o = this.kv(out), n = k => (o[k] === undefined ? null : Number(o[k]));
      const design = n('designcapacity'), nominal = n('nominalchargecapacity');
      return { sysW: n('sys_w'), inW: n('adapter_in_w'), battW: n('batt_w'), ac: o.ac === '1', ratedW: n('adapter_rated_w'),
        cycles: n('cyclecount'), health: design && nominal ? Math.round(nominal / design * 100) : null, tempC: n('temperature') == null ? null : +(n('temperature') / 100).toFixed(1) };
    });
  }
  display() { return this.cached('display', 3000, 'display-get', out => { const o = this.kv(out); return { brightness: o.brightness === undefined ? null : Number(o.brightness) }; }); }
  calendar() {
    return this.cached('calendar', 60_000, 'calendar', out => {
      const o = this.kv(out);
      const events = out.split('\n').filter(l => l.startsWith('ev=')).map(l => { const [s, e, a, cal, ...t] = l.slice(3).split('|'); return { start: Number(s), end: Number(e), allDay: a === '1', calendar: cal, title: t.join('|') }; });
      return { setup: o.cal_setup === '1', denied: o.cal_denied === '1', events };
    });
  }
  docker() {
    return this.cached('docker', 4000, 'docker-ps', out => ({ down: /docker_down=1/.test(out),
      containers: out.split('\n').filter(l => l.includes('|')).map(l => { const [name, state, status, image] = l.split('|'); return { name, state, status, image, self: /dashling/.test(name) }; }) }));
  }
  shortcutList() { return this.cached('shortcuts', 30_000, 'shortcuts', out => out.split('\n').map(x => x.trim()).filter(Boolean)); }
  async control(name, arg) {
    let cmd;
    if (name === 'lock') cmd = 'lock';
    else if (name === 'brightness') { if (!Number.isInteger(arg) || arg < 0 || arg > 100) throw new Error('bad level'); cmd = `display-set ${arg}`; }
    else if (name === 'shortcut') { if (typeof arg !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,60}$/.test(arg)) throw new Error('bad shortcut name'); cmd = `shortcut ${arg}`; }
    else if (name === 'docker') {
      const [act, c] = String(arg || '').split(' ');
      if (!['start', 'stop', 'restart'].includes(act) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(c || '')) throw new Error('bad docker request');
      cmd = `docker-act ${act} ${c}`;
    } else throw new Error('unknown control');
    await this.run(cmd, 30_000);
    if (this.xc) { this.xc.display = null; this.xc.docker = null; }
  }

  async killProc(pid, force) {
    if (!Number.isInteger(pid) || pid < 10 || pid > 9_999_999) throw new Error('bad pid');
    await this.run(`${force ? 'proc-kill9' : 'proc-kill'} ${pid}`);
    this.cacheAt = 0;
  }

  async apps() { return (await this.run('apps')).split('\n').map(x => x.trim()).filter(Boolean); }

  // the only deck actions that exist; server maps each to one fixed gate command
  async action(name, arg) {
    const map = { playpause: 'media playpause', next: 'media next', prev: 'media prev', mute: 'mute', sleep: 'sleep-display' };
    let cmd = map[name];
    if (name === 'seek') {
      if (!Number.isInteger(arg) || arg < 0 || arg > 99999) throw new Error('bad position');
      cmd = `media-seek ${arg}`;
    }
    if (name === 'open-app') {
      if (typeof arg !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}$/.test(arg)) throw new Error('bad app name');
      cmd = `open-app ${arg}`;
    }
    if (!cmd) throw new Error('unknown action');
    await this.run(cmd);
    if (name === 'seek' && this.anchor) { this.anchor.cur = arg; }
    this.cacheAt = 0; this.npAt = 0;
  }
}
