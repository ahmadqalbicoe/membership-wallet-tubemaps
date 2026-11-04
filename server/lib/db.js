// Local database: one JSON file (data/db.json), written atomically. No dependencies, works on any Node 18+.
'use strict';
const fs = require('fs');
const path = require('path');

const EMPTY = () => ({ version: 1, index: { fetchedAt: null, rows: [] }, matches: {}, centres: {}, runs: [] });

class JsonDB {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
    catch (e) {
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.broken-' + Date.now()); // keep a copy of anything unreadable
      this.data = EMPTY();
    }
    this.timer = null;
    this.version = 0;
  }
  save(now = false) {
    this.version++;
    clearTimeout(this.timer);
    const write = () => { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); };
    if (now) write(); else this.timer = setTimeout(write, 400);
  }
  // matches: { centreName: { path, ukName, score, confidence, status: 'linked'|'suggested'|'none', source: 'auto'|'manual' } }
  setMatch(name, m) { this.data.matches[name] = { ...m, updatedAt: new Date().toISOString() }; this.save(); }
  setCentre(p, rec) { this.data.centres[p] = { ...rec, fetchedAt: new Date().toISOString() }; this.save(); }
  addRun(run) { this.data.runs.unshift(run); this.data.runs = this.data.runs.slice(0, 30); this.save(); }
}
module.exports = { JsonDB };
