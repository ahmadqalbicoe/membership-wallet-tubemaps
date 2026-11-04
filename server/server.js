// Shopping Malls Tube Map: static site + UK Malls brand sync API + local JSON database.
// No dependencies. Node 18+.   PORT=4003 node server.js
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const { JsonDB } = require('./lib/db');
const { Sync, buildBrands } = require('./lib/sync');

const ROOT = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..', 'site'));
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PORT = +process.env.PORT || 4003, HOST = process.env.HOST || '0.0.0.0';

// Admin token protects the buttons that start scraping. Set ADMIN_TOKEN, or one is created in data/admin-token.txt.
fs.mkdirSync(DATA, { recursive: true });
const tokenFile = path.join(DATA, 'admin-token.txt');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : (() => { const t = crypto.randomBytes(12).toString('hex'); fs.writeFileSync(tokenFile, t + '\n', { mode: 0o600 }); return t; })());

const centres = JSON.parse(fs.readFileSync(path.join(__dirname, 'centres.json'), 'utf8'));
const db = new JsonDB(path.join(DATA, 'db.json'));
const sync = new Sync(db, centres);

let brandsCache = { v: -1, wv: '', body: '', gz: null };
function websiteBrands() {
  const f = path.join(ROOT, 'brands.json'); // written by the website scraper ("npm run publish-site")
  try { const st = fs.statSync(f); return { v: String(st.mtimeMs), data: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return { v: '', data: null }; }
}
// site/brands-data.js: the same data as a script, so the map also shows brands when index.html is opened
// straight from disk (file://) or hosted as static files (Netlify). Rewritten after every sync or match change.
function writeStatic() {
  try { const f = path.join(ROOT, 'brands-data.js'), tmp = f + '.tmp'; fs.writeFileSync(tmp, 'window.__BRANDS=' + brandsBody().body + ';\n'); fs.renameSync(tmp, f); }
  catch (e) { console.error('could not write brands-data.js:', e.message); }
}
function brandsBody() {
  const w = websiteBrands();
  if (brandsCache.v !== db.version || brandsCache.wv !== w.v) { const body = JSON.stringify(buildBrands(db, w.data)); brandsCache = { v: db.version, wv: w.v, body, gz: zlib.gzipSync(body, { level: 6 }) }; }
  return brandsCache;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.csv': 'text/csv; charset=utf-8' };
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = req => new Promise((ok, bad) => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e5) { bad(new Error('too large')); req.destroy(); } }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { bad(new Error('bad JSON')); } }); });
const authed = req => { const t = String(req.headers['x-admin-token'] || ''); return t.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN)); };

async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/ukmalls/status' && req.method === 'GET') return send(res, 200, sync.status());
  if (p === '/api/ukmalls/candidates' && req.method === 'GET') {
    if (!db.data.index.rows.length) return send(res, 409, { error: 'Fetch the UK Malls list first (press "Fetch all brands").' });
    try { return send(res, 200, { centre: url.searchParams.get('centre'), candidates: sync.candidates(url.searchParams.get('centre'), url.searchParams.get('q')) }); } catch (e) { return send(res, 404, { error: e.message }); }
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  if (!authed(req)) return send(res, 401, { error: 'admin token required' });
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  if (p === '/api/ukmalls/sync') {
    if (sync.state.running) return send(res, 409, { error: 'a sync is already running', status: sync.status() });
    const names = body.centre ? [body.centre] : null;
    if (names && !centres.some(c => c.key === body.centre)) return send(res, 404, { error: 'unknown centre' });
    sync.run({ centres: names, refreshIndex: !!body.refreshIndex, rematch: !!body.rematch, force: !!body.force }).then(writeStatic).catch(e => console.error(e));
    return send(res, 202, { started: true, status: sync.status() });
  }
  if (p === '/api/ukmalls/stop') { sync.requestStop(); return send(res, 200, sync.status()); }
  if (p === '/api/ukmalls/link') {
    if (!centres.some(c => c.key === body.centre)) return send(res, 404, { error: 'unknown centre' });
    try { sync.setManual(body.centre, body.path || null); } catch (e) { return send(res, 400, { error: e.message }); }
    if (body.path && body.fetch !== false && !sync.state.running) sync.run({ centres: [body.centre] }).then(writeStatic).catch(e => console.error(e)); else writeStatic();
    return send(res, 200, { ok: true, match: db.data.matches[body.centre] });
  }
  if (p === '/api/admin/check') return send(res, 200, { ok: true });
  return send(res, 404, { error: 'not found' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/brands.json') {
      const b = brandsBody();
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return send(res, 200, b.gz, 'application/json; charset=utf-8', { 'content-encoding': 'gzip', vary: 'accept-encoding' });
      return send(res, 200, b.body);
    }
    let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, path.normalize(p));
    if (!f.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(f, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      const type = TYPES[path.extname(f)] || 'application/octet-stream';
      if (/text|json|javascript|svg/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) return send(res, 200, zlib.gzipSync(buf), type, { 'cache-control': 'public, max-age=120', 'content-encoding': 'gzip', vary: 'accept-encoding' });
      send(res, 200, buf, type, { 'cache-control': 'public, max-age=120' });
    });
  } catch (e) { console.error(e); send(res, 500, { error: 'server error' }); }
}).listen(PORT, HOST, () => {
  if (!fs.existsSync(path.join(ROOT, 'brands-data.js'))) writeStatic();
  console.log(`Shopping Malls Tube Map on http://${HOST}:${PORT}  (site: ${ROOT}, data: ${DATA})`);
  console.log(`Admin token for the "Fetch brands" buttons: ${process.env.ADMIN_TOKEN ? '(from ADMIN_TOKEN)' : ADMIN_TOKEN + '  (saved in ' + tokenFile + ')'}`);
});
