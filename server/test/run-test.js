// End-to-end test: fake ukmalls.co.uk (real page captures) -> sync -> /brands.json. Run: npm test
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ukm-test-'));
const mock = spawn(process.execPath, [path.join(__dirname, 'mock-ukmalls.js'), '4199'], { stdio: 'ignore' });
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: '4198', DATA_DIR: tmp, SITE_DIR: tmp, ADMIN_TOKEN: 'test-token', UKMALLS_BASE: 'http://localhost:4199', UKMALLS_GAP_MS: '5' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const j = (p, body, token) => fetch('http://localhost:4198' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json() }));
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log((cond ? 'PASS ' : 'FAIL ') + name); };
(async () => {
  try {
    await sleep(900);
    ok('sync without token is refused', (await j('/api/ukmalls/sync', {})).status === 401);
    ok('single-centre sync starts', (await j('/api/ukmalls/sync', { centre: 'Kings Mall' }, 'test-token')).status === 202);
    for (let i = 0; i < 40 && (await j('/api/ukmalls/status')).body.running; i++) await sleep(250);
    const st = (await j('/api/ukmalls/status')).body;
    ok('index has 953 UK Malls centres', st.index.rows === 953);
    ok('most centres matched (>380)', st.matches.linked > 380);
    let b = (await j('/brands.json')).body;
    ok('Kings Mall has its 32 brands', b.centres['Kings Mall'] && b.centres['Kings Mall'].brands.length === 32);
    ok('Kings Mall phone from UK Malls', b.centres['Kings Mall'].ukmalls.phone === '20 8741 2121');
    const key = 'Broadwalk Shopping Centre (Edgware)';
    const cand = (await j('/api/ukmalls/candidates?centre=' + encodeURIComponent(key))).body.candidates;
    const right = cand.find(c => /HA8/.test(c.address));
    ok('candidates include the Edgware Broadwalk', !!right);
    ok('manual link works', (await j('/api/ukmalls/link', { centre: key, path: right.path }, 'test-token')).body.ok);
    for (let i = 0; i < 40 && (await j('/api/ukmalls/status')).body.running; i++) await sleep(250);
    b = (await j('/brands.json')).body;
    ok('manually linked centre has brands', b.centres[key].brands.length > 0 && b.centres[key].ukmalls.matchSource === 'manual');
  } catch (e) { console.error(e); checks.push(['no exceptions', false]); }
  mock.kill(); srv.kill(); fs.rmSync(tmp, { recursive: true, force: true });
  const failed = checks.filter(c => !c[1]).length;
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL TESTS PASSED');
  process.exit(failed ? 1 : 0);
})();
