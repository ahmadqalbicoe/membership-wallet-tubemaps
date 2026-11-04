// UK Malls sync job: refresh the index, match our centres, fetch store lists. One job at a time.
'use strict';
const uk = require('./ukmalls');

const DAY = 864e5;
class Sync {
  constructor(db, centres, log = console.log) {
    this.db = db; this.centres = centres; this.log = log;
    this.state = { running: false, phase: 'idle', done: 0, total: 0, current: '', startedAt: null, finishedAt: null, errors: [], message: '' };
    this.stop = false;
  }
  status() {
    const d = this.db.data, m = Object.values(d.matches);
    const linked = Object.entries(d.matches).filter(([, x]) => x.status === 'linked');
    const fetched = linked.filter(([, x]) => d.centres[x.path]);
    return {
      ...this.state,
      index: { rows: d.index.rows.length, fetchedAt: d.index.fetchedAt },
      matches: { linked: linked.length, suggested: m.filter(x => x.status === 'suggested').length, none: m.filter(x => x.status === 'none').length, manual: m.filter(x => x.source === 'manual').length, ofCentres: this.centres.length },
      fetched: fetched.length, brands: fetched.reduce((a, [, x]) => a + (d.centres[x.path].stores || []).length, 0),
      lastRun: d.runs[0] || null,
    };
  }
  requestStop() { if (this.state.running) { this.stop = true; this.state.message = 'Stopping after the current centre…'; } }

  async refreshIndex() {
    this.state.phase = 'index'; this.state.current = 'UK Malls centre list';
    const r = await uk.get(uk.BASE + '/shopping-centres');
    if (!r.ok) throw new Error('could not load the UK Malls centre list (HTTP ' + (r.status || r.error) + ')');
    const rows = uk.parseIndex(r.text);
    if (rows.length < 100) throw new Error('the UK Malls centre list looks different from expected (' + rows.length + ' centres found)');
    this.db.data.index = { fetchedAt: new Date().toISOString(), rows };
    this.db.save();
    this.log(`[ukmalls] index: ${rows.length} centres`);
  }

  autoMatch() {
    this.state.phase = 'match'; this.state.current = 'matching centres';
    const rows = this.db.data.index.rows;
    const manual = new Set(Object.entries(this.db.data.matches).filter(([, m]) => m.source === 'manual').map(([n]) => n));
    const todo = this.centres.filter(c => !manual.has(c.key));
    // rows already claimed by a manual link are not offered to others
    const claimed = new Set(Object.values(this.db.data.matches).filter(m => m.source === 'manual' && m.path).map(m => m.path));
    const found = uk.matchCentres(todo, rows.filter(r => !claimed.has(r.path)));
    for (const c of todo) {
      const m = found.get(c.key);
      if (!m) this.db.data.matches[c.key] = { status: 'none', source: 'auto', updatedAt: new Date().toISOString() };
      else this.db.data.matches[c.key] = { ...m, status: m.confidence === 'low' ? 'suggested' : 'linked', source: 'auto', updatedAt: new Date().toISOString() };
    }
    this.db.save();
    const s = this.status().matches;
    this.log(`[ukmalls] matched: ${s.linked} linked, ${s.suggested} to review, ${s.none} not found`);
  }

  async fetchCentre(name) {
    const m = this.db.data.matches[name];
    if (!m || m.status !== 'linked' || !m.path) return { skipped: true };
    const url = uk.BASE + '/shopping-centres/' + m.path;
    const r = await uk.get(url);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status || r.error}`);
    const info = uk.parseCentre(r.text, url);
    const stores = info.stores.map(s => ({ name: s.name, url: s.url, group: uk.groupOf(s.name) }));
    delete info.stores;
    this.db.setCentre(m.path, { info, stores });
    return { stores: stores.length };
  }

  // opts: { centres?: [names], refreshIndex?: bool, rematch?: bool, force?: bool, maxAgeHours?: number }
  async run(opts = {}) {
    if (this.state.running) throw new Error('a sync is already running');
    this.stop = false;
    const single = Array.isArray(opts.centres) && opts.centres.length;
    this.state = { running: true, phase: 'starting', done: 0, total: 0, current: '', startedAt: new Date().toISOString(), finishedAt: null, errors: [], message: '', scope: single ? opts.centres.join(', ') : 'all' };
    const run = { startedAt: this.state.startedAt, scope: this.state.scope, ok: 0, failed: 0, brands: 0 };
    try {
      const idx = this.db.data.index;
      if (opts.refreshIndex || !idx.rows.length || Date.now() - new Date(idx.fetchedAt || 0) > 7 * DAY) await this.refreshIndex();
      if (opts.rematch || !single || Object.keys(this.db.data.matches).length === 0) this.autoMatch();
      const maxAge = (opts.force || single ? 0 : (opts.maxAgeHours ?? 24)) * 36e5;
      const names = (single ? opts.centres : this.centres.map(c => c.key)).filter(n => {
        const m = this.db.data.matches[n]; if (!m || m.status !== 'linked') return false;
        const rec = this.db.data.centres[m.path]; return !rec || Date.now() - new Date(rec.fetchedAt) >= maxAge;
      });
      // several sheet rows can point at one ukmalls page: fetch each page once
      const seen = new Set(); const work = names.filter(n => { const p = this.db.data.matches[n].path; if (seen.has(p)) return false; seen.add(p); return true; });
      this.state.phase = 'centres'; this.state.total = work.length;
      for (const n of work) {
        if (this.stop) { this.state.message = 'Stopped.'; break; }
        this.state.current = n;
        try { const r = await this.fetchCentre(n); if (!r.skipped) { run.ok++; run.brands += r.stores; } }
        catch (e) { run.failed++; this.state.errors.push(String(e.message || e)); this.state.errors = this.state.errors.slice(-20); }
        this.state.done++;
      }
      if (!this.stop) this.state.message = `Done: ${run.ok} centres updated, ${run.brands} brands${run.failed ? `, ${run.failed} failed` : ''}.`;
    } catch (e) {
      this.state.errors.push(String(e.message || e)); this.state.message = 'Failed: ' + (e.message || e);
    } finally {
      run.finishedAt = new Date().toISOString(); this.db.addRun(run); this.db.save(true);
      Object.assign(this.state, { running: false, phase: 'idle', current: '', finishedAt: run.finishedAt });
      this.log('[ukmalls] ' + this.state.message);
    }
    return run;
  }

  // manual decisions from the map: link to a ukmalls page, or mark "not on UK Malls"
  setManual(name, pathOrNull) {
    const rows = this.db.data.index.rows;
    if (pathOrNull) {
      const r = rows.find(x => x.path === pathOrNull);
      if (!r) throw new Error('unknown UK Malls page');
      this.db.setMatch(name, { path: r.path, ukName: r.name, storeCount: r.storeCount, score: 1, confidence: 'manual', status: 'linked', source: 'manual' });
    } else this.db.setMatch(name, { status: 'none', source: 'manual' });
  }
  candidates(name, q) {
    const c = this.centres.find(x => x.key === name);
    if (!c) throw new Error('unknown centre');
    const rows = this.db.data.index.rows;
    if (q && q.trim()) { // free-text search over UK Malls names, towns and addresses
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hit = rows.filter(r => { const s = (r.name + ' ' + r.address + ' ' + r.path).toLowerCase(); return words.every(w => s.includes(w)); });
      return uk.candidates(c, hit, 12);
    }
    return uk.candidates(c, rows, 8).filter((x, i) => i < 3 || x.score >= 0.2);
  }
}

// brands.json for the map: UK Malls data merged with the website scraper's brands (if any)
function buildBrands(db, websiteBrands) {
  const d = db.data, out = {};
  const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  for (const [name, m] of Object.entries(d.matches)) {
    const rec = m.path ? d.centres[m.path] : null;
    const ukInfo = m.path ? { path: m.path, url: uk.BASE + '/shopping-centres/' + m.path, ukName: m.ukName, confidence: m.confidence, score: m.score, matchSource: m.source, status: m.status, storeCount: m.storeCount,
      fetchedAt: rec?.fetchedAt || null, phone: rec?.info.phone || '', hours: rec?.info.hours || [], website: rec?.info.website || '', address: rec?.info.address || '' } : { status: m.status, matchSource: m.source };
    if (m.status === 'linked' && rec) out[name] = { status: 'ok', source: 'ukmalls', url: ukInfo.url, directoryUrl: ukInfo.url, scrapedAt: rec.fetchedAt, brands: rec.stores.map(s => ({ name: s.name, group: s.group, url: s.url, source: 'ukmalls' })), ukmalls: ukInfo };
    else out[name] = { status: m.status === 'suggested' ? 'needs_review' : m.status === 'linked' ? 'not_fetched' : 'not_on_ukmalls', source: 'ukmalls', brands: [], ukmalls: ukInfo };
  }
  for (const [name, w] of Object.entries(websiteBrands?.centres || {})) {
    if (!w.brands || !w.brands.length) { if (!out[name]) out[name] = w; continue; }
    const base = out[name];
    if (!base || !base.brands.length) { out[name] = { ...w, source: 'website', ukmalls: base?.ukmalls }; continue; }
    const have = new Set(w.brands.map(b => norm(b.name)));
    out[name] = { ...w, status: 'ok', source: 'website+ukmalls', ukmalls: base.ukmalls, brands: [...w.brands.map(b => ({ ...b, source: 'website' })), ...base.brands.filter(b => !have.has(norm(b.name)))] };
  }
  const all = Object.values(out).flatMap(c => c.brands);
  return { generatedAt: new Date().toISOString(), summary: { centres: Object.keys(out).length, ok: Object.values(out).filter(c => c.brands.length).length, brands: all.length, uniqueBrands: new Set(all.map(b => norm(b.name))).size }, centres: out };
}

module.exports = { Sync, buildBrands };
