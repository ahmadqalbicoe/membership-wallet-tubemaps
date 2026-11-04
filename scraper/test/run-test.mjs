// Starts three fake mall websites and runs the scraper against them, to check the install works.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const srv = spawn(process.execPath, ['test/mock-server.mjs'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const run = spawn(process.execPath, ['scrape.js', '--centres', 'test/centres.test.json', '--out', 'test/output', '--delay', '50', '--force'], { stdio: 'inherit' });
run.on('exit', code => {
  srv.kill();
  const d = JSON.parse(fs.readFileSync('test/output/brands.json', 'utf8'));
  const n = Object.fromEntries(Object.entries(d.centres).map(([k, v]) => [k, v.brands.length]));
  const pass = n['Centre A'] === 12 && n['Centre B'] === 30 && n['Centre C'] === 6;
  console.log(pass ? '\nTEST PASSED' : '\nTEST FAILED', n);
  process.exit(pass && code === 0 ? 0 : 1);
});
