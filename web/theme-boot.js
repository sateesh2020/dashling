// Runs before first paint so the saved theme never flashes. (Separate file: the CSP forbids inline scripts.)
try { var t = localStorage.getItem('dl_theme') || localStorage.getItem('pb_theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}
