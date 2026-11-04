#!/usr/bin/env node
// Run the UK Malls sync from a terminal or cron (same database as the server).
//   node sync-cli.js                     fetch every matched centre (skips ones fetched in the last 24 h)
//   node sync-cli.js --force             re-fetch everything
//   node sync-cli.js --centre "Bluewater Shopping Centre"
//   node sync-cli.js --refresh-index --rematch
// Stop the server first, or run it while the server is idle: both write data/db.json.
'use strict';
const fs = require('fs'), path = require('path');
const { JsonDB } = require('./lib/db');
const { Sync } = require('./lib/sync');
const a = process.argv.slice(2), has = f => a.includes(f), val = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; };
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const centres = JSON.parse(fs.readFileSync(path.join(__dirname, 'centres.json'), 'utf8'));
const db = new JsonDB(path.join(DATA, 'db.json'));
const sync = new Sync(db, centres);
const tick = setInterval(() => { const s = sync.state; if (s.running) process.stdout.write(`\r${s.phase} ${s.done}/${s.total} ${String(s.current).slice(0, 50).padEnd(50)}`); }, 1000);
sync.run({ centres: val('--centre') ? [val('--centre')] : null, refreshIndex: has('--refresh-index'), rematch: has('--rematch'), force: has('--force') })
  .then(() => { clearInterval(tick); const s = sync.status(); console.log(`\n${sync.state.message}\nIndex ${s.index.rows} · linked ${s.matches.linked} · to review ${s.matches.suggested} · fetched ${s.fetched} · brands ${s.brands}`); if (sync.state.errors.length) console.log('Errors:\n  ' + sync.state.errors.join('\n  '));
    const { buildBrands } = require('./lib/sync'); const site = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..', 'site'));
    try { fs.writeFileSync(path.join(site, 'brands-data.js'), 'window.__BRANDS=' + JSON.stringify(buildBrands(db, null)) + ';\n'); console.log('Updated site/brands-data.js'); } catch (e) { console.log('Could not update site/brands-data.js: ' + e.message); } });
