// ES5 on purpose: this must run (and not throw) in browsers that cannot parse the main app.
// Sends browsers that lack what app.js and style.css need to the lightweight page. (Separate file: the CSP forbids inline scripts.)
// Escape hatches: open /?full=1 to force the full app, /lite.html to force the lite page.
(function () {
  try {
    if (/[?&]full=1/.test(location.search)) { try { sessionStorage.setItem('dl_full', '1'); } catch (e) {} return; }
    try { if (sessionStorage.getItem('dl_full') === '1') return; } catch (e) {}
    var ok = typeof window.fetch === 'function' && typeof window.Promise === 'function' &&
      typeof String.prototype.replaceAll === 'function' &&           // shipped alongside optional chaining and ??, which the app uses
      !!(window.CSS && CSS.supports && CSS.supports('display', 'grid') && CSS.supports('color', 'var(--a)'));
    if (!ok) location.replace('/lite.html');
  } catch (e) { location.replace('/lite.html'); }
}());
