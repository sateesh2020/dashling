// Dashling Lite. ES5 ONLY (var, function, XMLHttpRequest): it has to run on browsers from ~2010 (BlackBerry OS 6/7, old Android).
// Same server API and the same stored token as the full app, so pairing in either one signs in both.
(function () {
  'use strict';
  var token = '', timers = [], npAt = 0, NP = null, vol = null, lastPair = 0, tokenMode = false;

  function $(id) { return document.getElementById(id); }
  function show(id, on) { var n = $(id), c = n.className.replace(/\s*\bhide\b/g, ''); n.className = on ? c : c + ' hide'; }
  function text(id, t) { var n = $(id); n.innerHTML = ''; n.appendChild(document.createTextNode(t)); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) {} return ''; }
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function gb(b) { return (b / 1073741824).toFixed(1) + ' GB'; }
  function pct(n) { return Math.max(0, Math.min(100, Math.round(n))) + '%'; }

  // ---- tiny XHR wrapper: cb(err, data, status)
  function xhr(method, path, body, cb) {
    var r = new XMLHttpRequest();
    r.open(method, path, true);
    r.setRequestHeader('Content-Type', 'application/json');
    if (token) r.setRequestHeader('Authorization', 'Bearer ' + token);
    r.onreadystatechange = function () {
      if (r.readyState !== 4) return;
      var d = null; try { d = JSON.parse(r.responseText); } catch (e) {}
      if (r.status === 401 && token) { token = ''; store('dl_token', ''); showLogin('Please pair this device again.'); return; }
      cb(r.status === 0 ? 'offline' : null, d, r.status);
    };
    r.send(body ? JSON.stringify(body) : null);
  }

  // ---- sign in
  function loginMode(tok) {
    tokenMode = tok;
    show('token', tok); show('code', !tok); show('login-hint', !tok);
    text('login-alt', tok ? 'Use a pairing code instead' : 'Use access token instead');
    if (!tok && new Date().getTime() - lastPair > 30000) { lastPair = new Date().getTime(); xhr('POST', '/api/pair/start', null, function () {}); }
  }
  function showLogin(msg) { stop(); show('shell', false); show('login', true); text('login-err', msg || ''); loginMode(tokenMode); }
  function connect() {
    text('login-err', '');
    if (tokenMode) {
      token = $('token').value.replace(/^\s+|\s+$/g, '');
      xhr('GET', '/api/stats', null, function (err, d, s) {
        if (s === 200) { store('dl_token', token); start(); return; }
        token = ''; text('login-err', s === 429 ? 'Too many attempts, wait a minute.' : 'Token rejected.');
      });
      return;
    }
    token = '';
    xhr('POST', '/api/pair', { code: $('code').value }, function (err, d, s) {
      if (s === 200 && d && d.token) { token = d.token; store('dl_token', token); start(); return; }
      lastPair = 0; $('code').value = '';
      text('login-err', s === 429 ? 'Too many attempts, wait a minute.' : 'Wrong or expired code. A new one is in the terminal.');
      loginMode(false);
    });
  }

  // ---- data
  function setStatus(t, cls) { var n = $('status'); n.className = 'badge ' + (cls || ''); text('status', t); }
  function bar(id, p, warnAt, badAt) { var b = $(id); b.style.width = p == null ? '0' : pct(p); b.className = p != null && p >= badAt ? 'bad' : p != null && p >= warnAt ? 'warn' : ''; }
  function uptime(boot) {
    var s = Math.max(0, Math.floor(new Date().getTime() / 1000 - boot)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
  }
  function tickClock() {
    var n = new Date(), days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    text('time', two(n.getHours()) + ':' + two(n.getMinutes()));
    text('date', days[n.getDay()] + ', ' + n.getDate() + ' ' + mons[n.getMonth()]);
    if (NP && NP.duration) {
      var e = NP.elapsed + (NP.playing ? (new Date().getTime() - npAt) / 1000 : 0);
      bar('np-b', Math.min(100, e / NP.duration * 100), 101, 101);
    } else bar('np-b', 0, 101, 101);
  }
  function pollStats() {
    xhr('GET', '/api/stats', null, function (err, r) {
      if (err || !r) { setStatus('offline', 'bad'); return; }
      var h = r.host;
      if (!h) { setStatus(r.error ? 'host unreachable' : 'no host', 'bad'); return; }
      setStatus('live', 'ok'); text('host', h.name || 'Dashling');
      var cpu = h.cpu && h.cpu.idle != null ? 100 - h.cpu.idle : null;
      text('cpu-t', cpu == null ? '--' : pct(cpu)); bar('cpu-b', cpu, 70, 90);
      if (h.mem && h.mem.total) { var m = h.mem.used / h.mem.total * 100; text('mem-t', gb(h.mem.used) + ' of ' + gb(h.mem.total)); bar('mem-b', m, 75, 90); }
      if (h.disk && h.disk.total) { var d = h.disk.used / h.disk.total * 100; text('disk-t', gb(h.disk.used) + ' of ' + gb(h.disk.total)); bar('disk-b', d, 80, 92); }
      var b = h.battery;
      if (b) { text('batt-t', b.pct + '% ' + b.state); bar('batt-b', b.pct, 101, 101); } else { text('batt-t', 'no battery'); bar('batt-b', null, 101, 101); }
      text('up-t', h.boot ? uptime(h.boot) : '--');
      if (h.volume != null) { vol = h.volume; text('vol-t', 'Volume ' + vol + '%'); }
    });
  }
  function pollNP() {
    xhr('GET', '/api/nowplaying', null, function (err, r) {
      if (err || !r) return;
      NP = r.np || null; npAt = new Date().getTime();
      text('np-title', NP ? NP.title : 'Nothing playing');
      text('np-artist', NP ? NP.artist : 'Play something on your computer');
      text('np-toggle', NP && NP.playing ? 'Pause' : 'Play');
    });
  }
  function wxLabel(c) { return c === 0 ? 'Clear' : c < 3 ? 'Partly cloudy' : c === 3 ? 'Cloudy' : c < 50 ? 'Fog' : c < 70 ? 'Rain' : c < 80 ? 'Snow' : c < 90 ? 'Showers' : 'Thunderstorm'; }
  function pollWeather() {
    xhr('GET', '/api/weather', null, function (err, w) {
      if (err || !w || w.error) { text('wx', 'Weather unavailable right now.'); return; }
      if (!w.location) { text('wx', 'No city set (choose one in the full app).'); return; }
      var u = w.units === 'f' ? 'F' : 'C', c = w.current;
      text('wx', Math.round(c.temperature_2m) + '°' + u + ', ' + wxLabel(c.weather_code) + ' (feels ' + Math.round(c.apparent_temperature) + '°) · ' + w.location.name);
    });
  }

  // ---- controls
  var msgT = null;
  function msg(t) { text('msg', t); clearTimeout(msgT); msgT = setTimeout(function () { text('msg', ''); }, 4000); }
  function act(name) { xhr('POST', '/api/action', { action: name, name: name }, function (err, d) { if (d && d.error) msg(d.error); else setTimeout(pollNP, 400); }); }
  function setVol(delta) {
    if (vol == null) return;
    vol = Math.max(0, Math.min(100, vol + delta)); text('vol-t', 'Volume ' + vol + '%');
    xhr('POST', '/api/volume', { level: vol }, function () {});
  }
  function lock() { xhr('POST', '/api/ctl', { action: 'lock' }, function (err, d) { msg(d && d.error ? d.error : 'Locking…'); }); }

  function on(id, fn) { $(id).onclick = fn; }
  function bindActs() {
    var bs = document.getElementsByTagName('button'), i;
    for (i = 0; i < bs.length; i++) (function (b) { var a = b.getAttribute('data-act'); if (a) b.onclick = function () { act(a); }; }(bs[i]));
  }

  function stop() { for (var i = 0; i < timers.length; i++) clearInterval(timers[i]); timers = []; }
  function start() {
    show('login', false); show('shell', true);
    stop(); tickClock(); pollStats(); pollNP(); pollWeather();
    timers.push(setInterval(tickClock, 1000), setInterval(pollStats, 3000), setInterval(pollNP, 4000), setInterval(pollWeather, 600000));
  }

  on('login-go', connect); on('login-alt', function () { loginMode(!tokenMode); });
  on('vol-dn', function () { setVol(-5); }); on('vol-up', function () { setVol(5); }); on('btn-lock', lock);
  bindActs();
  token = store('dl_token');
  if (token) start(); else showLogin('');
}());
