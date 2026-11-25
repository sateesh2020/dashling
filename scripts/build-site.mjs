// Builds the GitHub Pages website into _site/ (or the folder you pass). No dependencies.
//   node scripts/build-site.mjs [outDir]
//
//   _site/            the landing page (site/)
//   _site/demo/       the real panel (web/) running on fictional data with NO server: its /api calls are answered in the browser
//   _site/img/        the screenshots from docs/img
//
// The panel uses absolute paths (/app.js, /style.css, ...) because the real server serves it from the root. Under GitHub Pages it
// lives in a sub-folder (/dashling/demo/), so the copy of index.html and style.css is rewritten to relative paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '_site'));
const SITE_URL = 'https://sateesh2020.github.io/dashling/';
const read = (...p) => fs.readFile(path.join(ROOT, ...p), 'utf8');
const copy = (from, to) => fs.cp(path.join(ROOT, from), path.join(OUT, to), { recursive: true });
const write = (to, text) => fs.writeFile(path.join(OUT, to), text);

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, 'demo'), { recursive: true });

// ---- landing page
const { WIDGETS } = await import(pathToFileURL(path.join(ROOT, 'web/widgets.js')));
let index = await read('site/index.html');
index = index.replaceAll('{{WIDGET_COUNT}}', String(WIDGETS.length));
await write('index.html', index);
for (const f of ['styles.css', 'main.js', 'favicon.png', 'og.jpg']) await copy(`site/${f}`, f);

// ---- fonts for the landing page (Inter + JetBrains Mono), and the licence notice that must travel with them
await fs.mkdir(path.join(OUT, 'fonts'), { recursive: true });
for (const f of ['inter-var.woff2', 'jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-latin-700-normal.woff2']) await copy(`web/fonts/${f}`, `fonts/${f}`);
await copy('THIRD_PARTY_NOTICES.md', 'fonts/LICENSES.txt');

// ---- screenshots
await copy('docs/img', 'img');

// ---- the panel, as a static demo
for (const f of ['app.js', 'extras.js', 'icons.js', 'widgets.js', 'theme-boot.js', 'style.css', 'index.html', 'manifest.webmanifest', 'fonts', 'icons']) await copy(`web/${f}`, `demo/${f}`);
await copy('THIRD_PARTY_NOTICES.md', 'demo/fonts/LICENSES.txt');
await copy('scripts/demo/data.mjs', 'demo/data.mjs');
await copy('site/demo-shim.mjs', 'demo/demo-shim.mjs');
await write('demo/router.mjs', (await read('scripts/demo/router.mjs')).replace("'../../web/widgets.js'", "'./widgets.js'"));

let panel = await read('web/index.html');
panel = panel.replace(/(href|src)="\/(?!\/)/g, '$1="./');                                  // /app.js -> ./app.js
const appTag = '<script type="module" src="./app.js"></script>';
if (!panel.includes(appTag)) throw new Error('web/index.html no longer loads ./app.js the way the site build expects');
panel = panel.replace(appTag, `<script type="module" src="./demo-shim.mjs"></script>\n${appTag}`);   // the shim must run first
await write('demo/index.html', panel);
await write('demo/style.css', (await read('web/style.css')).replaceAll('url(/fonts/', 'url(fonts/'));

// ---- housekeeping
await write('.nojekyll', '');
await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}</loc></url></urlset>\n`);
await write('404.html', `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · Dashling</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#05060f;color:#eef2ff;font:17px system-ui,sans-serif;text-align:center">
<div><h1 style="font-size:3rem;margin:0">404</h1><p>That page drifted off.</p><p><a style="color:#00f0e0" href="${SITE_URL}">Back to Dashling</a></p></div></body>\n`);

console.log(`Built ${path.relative(process.cwd(), OUT) || '.'}: ${WIDGETS.length} widgets, landing page + live demo + images`);
