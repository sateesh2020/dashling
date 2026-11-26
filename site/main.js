// Dashling website behaviour. No dependencies. Everything degrades gracefully: without JS the page is static and readable.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.remove('no-js');

  // ---------- reveal on scroll + count-up ----------
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('revealed'); io.unobserve(e.target); } }), { threshold: 0.12 });
  $$('.reveal').forEach((n) => io.observe(n));
  const countIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; countIO.unobserve(e.target);
    const to = Number(e.target.dataset.count); if (reduce || !to) return;
    const t0 = performance.now(), dur = 1100;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur); e.target.textContent = Math.round(to * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  $$('[data-count]').forEach((n) => countIO.observe(n));

  // ---------- cursor spotlight on cards ----------
  $$('.spot').forEach((c) => c.addEventListener('pointermove', (e) => { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', `${e.clientX - r.left}px`); c.style.setProperty('--my', `${e.clientY - r.top}px`); }));

  // ---------- tabs ----------
  const tabs = $$('.tabs [role=tab]');
  const pick = (t) => { tabs.forEach((b) => { const on = b === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; $('#' + b.getAttribute('aria-controls')).hidden = !on; }); };
  tabs.forEach((b, i) => { b.addEventListener('click', () => pick(b)); b.addEventListener('keydown', (e) => { const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1; if (j >= 0) { const n = tabs[(j + tabs.length) % tabs.length]; n.focus(); pick(n); } }); });

  // ---------- copy buttons ----------
  $$('.copy').forEach((b) => b.addEventListener('click', async () => {
    const text = $('code', b.parentElement).innerText;
    try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1600);
  }));

  // ---------- latest release (version + APK link), cached for the session ----------
  (async () => {
    try {
      let rel = JSON.parse(sessionStorage.getItem('dl_rel') || 'null');
      if (!rel) { const r = await fetch('https://api.github.com/repos/sateesh2020/dashling/releases/latest', { headers: { Accept: 'application/vnd.github+json' } }); if (!r.ok) return; rel = await r.json(); sessionStorage.setItem('dl_rel', JSON.stringify({ tag_name: rel.tag_name, assets: rel.assets.map((a) => ({ name: a.name, browser_download_url: a.browser_download_url })) })); }
      $('#ver').textContent = `${rel.tag_name} · MIT`;
      const apk = rel.assets.find((a) => /\.apk$/.test(a.name));
      if (apk) { const b = $('#apkBtn'); b.href = apk.browser_download_url; b.textContent = `Download the Android app (${rel.tag_name})`; }
    } catch { /* offline or rate-limited: the static text and link stay */ }
  })();

  // ---------- the live demo ----------
  const PAGES = [['home', 'Home'], ['system', 'System'], ['mac', 'Computer'], ['time', 'Time'], ['personal', 'Personal'], ['news', 'News'], ['code', 'Code'], ['ai', 'AI'], ['media', 'Media']];
  const THEMES = [['glass', 'Liquid Glass', 'linear-gradient(135deg,#7c5cff,#cfe3ff)'], ['light', 'Liquid Light', 'linear-gradient(135deg,#e9eefb,#c9b8ff)'], ['graphite', 'Graphite', 'linear-gradient(135deg,#2a2d33,#ffb224)'],
    ['dots', 'Dot Matrix', 'linear-gradient(135deg,#111,#ff3b30)'], ['cyber', 'Cyberdeck', 'linear-gradient(135deg,#07091a,#00f0e0 55%,#ff2bd6)'], ['terminal', 'Terminal', 'linear-gradient(135deg,#020a03,#34ff6a)'], ['clay', 'Claymorphism', 'linear-gradient(135deg,#ffb3cc,#c9b6ff)']];
  const stage = $('#demo'), inner = $('#stageInner'), tab = $('#devTablet'), phone = $('#devPhone'), fT = $('#frameTablet'), fP = $('#framePhone');
  if (!stage) return;
  let page = 0, theme = 'glass', tour = !reduce, userTouched = false, visible = true, started = false;

  // chips
  const pageChips = $('#pageChips'), themeChips = $('#themeChips'), themeRow = $('#themeRow'), tourBtn = $('#tourBtn');
  PAGES.forEach(([id, label], i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label; b.dataset.i = i; b.addEventListener('click', () => { stopTour(); setPage(i); }); pageChips.append(b); });
  THEMES.forEach(([id, label, bg]) => {
    const s = document.createElement('button'); s.type = 'button'; s.className = 'sw'; s.dataset.t = id; s.style.background = bg; s.title = label; s.setAttribute('aria-label', `${label} theme`); s.addEventListener('click', () => { stopTour(); setTheme(id); }); themeChips.append(s);
    const r = document.createElement('button'); r.type = 'button'; r.className = 'chip'; r.textContent = label; r.dataset.t = id; r.addEventListener('click', () => { stopTour(); setTheme(id); stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); }); themeRow.append(r);
  });
  const refresh = () => {
    $$('.chip[data-i]', pageChips).forEach((c) => c.classList.toggle('on', Number(c.dataset.i) === page));
    $$('.sw', themeChips).forEach((c) => c.classList.toggle('on', c.dataset.t === theme));
    $$('.chip[data-t]', themeRow).forEach((c) => c.classList.toggle('on', c.dataset.t === theme));
    tourBtn.setAttribute('aria-pressed', String(tour));
  };

  // talking to the two live panels (same origin, so we can reach into them)
  const docOf = (f) => { try { return f.contentDocument; } catch { return null; } };
  const dock = (f, label) => { const d = docOf(f); const b = d && $$('#dock button', d).find((x) => x.textContent.trim().startsWith(label)); if (b) b.click(); };
  function setPage(i) { page = i; dock(fT, PAGES[i][1]); dock(fP, PAGES[(i + 1) % PAGES.length][1]); refresh(); }
  function setTheme(t) { theme = t; [fT, fP].forEach((f) => { const d = docOf(f); const b = d && $(`#themes button[data-t="${t}"]`, d); if (b) b.click(); }); refresh(); }
  function stopTour() { userTouched = true; tour = false; refresh(); }
  tourBtn.addEventListener('click', () => { tour = !tour; userTouched = true; refresh(); });
  let step = 0;
  setInterval(() => { if (!tour || !visible || document.hidden || !started) return; step += 1; page = (page + 1) % PAGES.length; setPage(page); if (step % 2 === 0) setTheme(THEMES[(THEMES.findIndex((t) => t[0] === theme) + 1) % THEMES.length][0]); }, 5200);

  // sizing: the panels render at their real CSS size and are scaled to fit
  const TW = 1100, TH = 700, TB = 14, PW = 390, PH = 800, PB = 11;
  function layout() {
    const W = stage.clientWidth, narrow = W < 760;
    if (narrow) {
      tab.style.display = 'none'; const s = Math.min(1, (W * 0.8) / (PW + 2 * PB));
      phone.style.transform = `scale(${s})`; phone.style.left = `${(W - (PW + 2 * PB) * s) / 2}px`; phone.style.top = '0px';
      stage.style.setProperty('--stage-h', `${(PH + 2 * PB) * s + 6}px`);
    } else {
      tab.style.display = ''; const tw = TW + 2 * TB, th = TH + 2 * TB, pw = PW + 2 * PB, ph = PH + 2 * PB;
      const s = Math.min(1, (W * 0.8) / tw), sp = s * 0.8, overhang = pw * sp * 0.52, group = tw * s + overhang, x0 = (W - group) / 2;
      tab.style.transform = `scale(${s})`; tab.style.left = `${x0}px`; tab.style.top = '0px';
      phone.style.transform = `scale(${sp})`; phone.style.left = `${x0 + tw * s - pw * sp + overhang}px`; phone.style.top = `${th * s - ph * sp * 0.82}px`;
      stage.style.setProperty('--stage-h', `${Math.max(th * s, th * s - ph * sp * 0.82 + ph * sp) + 4}px`);
    }
  }
  layout(); new ResizeObserver(layout).observe(stage);

  // load the panels when the stage is near the viewport: tablet first, then the phone (they share localStorage, so one at a time)
  const start = () => {
    if (started) return; started = true;
    const afterPhone = () => { setTimeout(() => { setTheme(theme); refresh(); }, 700); };
    fP.addEventListener('load', afterPhone, { once: true });
    fT.addEventListener('load', () => { fP.src = fP.dataset.src; }, { once: true });
    if (getComputedStyle(tab).display === 'none') { fP.src = fP.dataset.src; } else { fT.src = fT.dataset.src; }
  };
  new IntersectionObserver((es) => { es.forEach((e) => { visible = e.isIntersecting; if (e.isIntersecting) start(); }); }, { rootMargin: '300px' }).observe(stage);
  refresh();

  // click to interact; release when the pointer leaves, on Escape, or on a tap elsewhere (so the page always scrolls normally)
  const activate = () => { stage.classList.add('live'); stopTour(); };
  const release = () => stage.classList.remove('live');
  stage.addEventListener('click', activate);
  stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') release(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') release(); });
  document.addEventListener('pointerdown', (e) => { if (!stage.contains(e.target)) release(); });

  // gentle 3D tilt that follows the pointer (desktop, motion allowed)
  if (!reduce && matchMedia('(hover: hover)').matches) {
    stage.addEventListener('pointermove', (e) => { if (stage.classList.contains('live')) return; const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; inner.style.transform = `rotateY(${x * 7}deg) rotateX(${-y * 5}deg)`; });
    stage.addEventListener('pointerleave', () => { inner.style.transform = ''; });
  }
})();
