// Syntax-check every JavaScript file in the project (server, web, scripts, tests). No dependencies.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const roots = ['server', 'web', 'scripts', 'test'];
const files = [];
const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (n === 'node_modules') continue; statSync(p).isDirectory() ? walk(p) : ['.js', '.mjs'].includes(extname(p)) && files.push(p); } };
roots.forEach((r) => { try { walk(r); } catch {} });

let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error(`SYNTAX ERROR in ${f}\n${e.stderr}`); }
}
console.log(`${files.length} JavaScript files checked, ${bad} with errors`);
process.exit(bad ? 1 : 0);
