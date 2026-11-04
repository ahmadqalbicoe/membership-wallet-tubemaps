#!/usr/bin/env node
// UK shopping centre brand scraper.
// For every centre with a website it finds the store directory, collects every brand,
// then opens each brand page for its details (category, unit, hours, phone, website, socials, logo).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { fetchText, allowedByRobots, UA } from './lib/http.js';
import { discoverStores, renderPage, closeBrowser } from './lib/discover.js';
import { extractStore, inferCategory, normaliseCategory, slugToName, sameSite } from './lib/extract.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(DIR, (process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'output'));
const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const O = {
  only: opt('only', '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean),
  limit: +opt('limit', 0), concurrency: +opt('concurrency', 3), maxStores: +opt('max-stores', 500),
  details: !flag('no-details'), force: flag('force'), ignoreRobots: flag('ignore-robots'), gapMs: +opt('delay', 700),
  discover: flag('discover'), onlyUnresolved: flag('only-unresolved'), ua: UA,
};

// McArthurGlen links in the sheet that point at the general outlets page
const MCARTHURGLEN = { 'cheshire oaks': 'cheshire-oaks', 'ashford': 'ashford', 'york': 'york', 'bridgend': 'bridgend', 'east midlands': 'east-midlands', 'swindon': 'swindon', 'west midlands': 'west-midlands' };
const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function readJson(f, d) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } }

function resolve(c, overrides) {
  const o = overrides[c.name];
  if (o && o.skip) return { skip: true, why: 'skipped in overrides.json' };
  if (typeof o === 'string' && o) return { url: o, from: 'override' };
  if (o && o.url) return { url: o.url, directoryUrl: o.directoryUrl, from: 'override' };
  if (c.kind === 'official') return { url: c.website, from: 'sheet' };
  if (c.kind === 'mcarthurglen') return { url: c.website.replace(/\/?$/, '/'), directoryUrl: c.website.replace(/\/?$/, '/') + 'stores/', from: 'sheet' };
  if (c.kind === 'mcarthurglen-generic') {
    const k = Object.keys(MCARTHURGLEN).find(k => c.name.toLowerCase().includes(k));
    if (k) { const u = `https://www.mcarthurglen.com/en/outlets/uk/designer-outlet-${MCARTHURGLEN[k]}/`; return { url: u, directoryUrl: u + 'stores/', from: 'mcarthurglen pattern' }; }
  }
  return { none: true, why: 'the sheet links to a directory or article, not the centre\'s own site — add the real URL in overrides.json' };
}

async function scrapeStoreDetails(centre, stores) {
  const out = [];
  for (const [i, s] of stores.entries()) {
    if (!(await allowedByRobots(s.url, O))) { out.push({ ...s, note: 'blocked by robots.txt' }); continue; }
    let r = await fetchText(s.url, { gapMs: O.gapMs });
    let b = r.ok ? extractStore(r.text, r.url, s) : null;
    // JavaScript-only pages: render them when plain HTML gave us almost nothing
    const thin = !b || (!b.description && !b.hours.length && !b.phone && !b.unit && !b.website);
    if (thin) {
      const rr = await renderPage(s.url, { ...O, loadMore: 0 });
      if (rr.html) b = extractStore(rr.html, rr.url, s);
    }
    if (!b) { out.push({ ...s, note: r.error || 'HTTP ' + r.status }); continue; }
    // the directory card's name is usually the cleanest; keep the page's if the card name came from a URL slug
    if (s.name && !s.nameFromSlug && (b.name.toLowerCase().includes(centre.name.toLowerCase()) || b.name.length > s.name.length + 25)) b.name = s.name;
    out.push(b);
    if ((i + 1) % 25 === 0) log(`   ${centre.name}: ${i + 1}/${stores.length} brand pages`);
  }
  return out;
}

function finalise(b) {
  const group = normaliseCategory(b.category) || inferCategory(b);
  const keep = { name: b.name, category: b.category || '', group: group || 'Other', groupInferred: !normaliseCategory(b.category) && !!group, unit: b.unit || '', level: b.level || '', hours: b.hours || [], phone: b.phone || '', email: b.email || '', website: b.website || '', socials: b.socials || {}, logo: b.logo || '', description: b.description || '', url: b.url };
  if (b.note) keep.note = b.note;
  return keep;
}

async function scrapeCentre(c, overrides) {
  const file = path.join(OUT, 'centres', slug(c.name) + '.json');
  if (!O.force) { const cached = await readJson(file, null); if (cached && cached.status === 'ok' && (!O.details || cached.details)) { log(`✓ ${c.name} (cached, ${cached.brands.length} brands)`); return cached; } }
  const res = resolve(c, overrides);
  const base = { centre: c.name, town: c.town, localAuthority: c.localAuthority, region: c.region, sheetWebsite: c.website, scrapedAt: new Date().toISOString() };
  if (res.skip || res.none) { const r = { ...base, status: res.skip ? 'skipped' : 'needs_url', note: res.why, brands: [] }; await save(file, r); log(`– ${c.name}: ${r.status}`); return r; }
  log(`→ ${c.name}  ${res.url}`);
  let d;
  try { d = await discoverStores({ url: res.url, directoryUrl: res.directoryUrl }, O); }
  catch (e) { d = { stores: [], error: String(e.message || e) }; }
  let status = 'ok', note = '';
  if (d.blocked) { status = 'blocked_by_robots'; note = 'robots.txt does not allow this page'; }
  else if (d.unreachable) { status = 'unreachable'; note = d.error; }
  else if (!d.stores.length) { status = 'no_directory_found'; note = 'no store list found on the site; set "directoryUrl" for this centre in overrides.json'; }
  let stores = d.stores.slice(0, O.maxStores);
  if (d.stores.length > O.maxStores) note = `capped at ${O.maxStores} of ${d.stores.length} brands`;
  log(`   ${c.name}: ${d.stores.length} brands via ${d.method || '—'} ${d.directoryUrl || ''}`);
  const brands = (O.details && stores.length ? await scrapeStoreDetails(c, stores) : stores).map(finalise);
  const r = { ...base, url: res.url, urlFrom: res.from, directoryUrl: d.directoryUrl || '', method: d.method || '', status, note, details: O.details, brands, tried: d.tried };
  await save(file, r);
  log(`✓ ${c.name}: ${brands.length} brands (${status})`);
  return r;
}

async function save(f, data) { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(data, null, 1)); }

const csv = v => { const s = Array.isArray(v) ? v.join(' | ') : typeof v === 'object' && v ? Object.values(v).join(' | ') : String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function writeOutputs(results) {
  const centres = {};
  for (const r of results) centres[r.centre] = { status: r.status, note: r.note || '', url: r.url || '', directoryUrl: r.directoryUrl || '', method: r.method || '', scrapedAt: r.scrapedAt, brands: r.brands };
  const all = results.flatMap(r => r.brands.map(b => ({ ...b, centre: r.centre })));
  const summary = { centres: results.length, ok: results.filter(r => r.status === 'ok').length, brands: all.length, uniqueBrands: new Set(all.map(b => b.name.toLowerCase())).size,
    byStatus: results.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}) };
  await save(path.join(OUT, 'brands.json'), { generatedAt: new Date().toISOString(), summary, centres });
  const cols = ['centre', 'name', 'category', 'group', 'unit', 'level', 'hours', 'phone', 'email', 'website', 'socials', 'logo', 'description', 'url'];
  await fs.writeFile(path.join(OUT, 'brands.csv'), '﻿' + [cols.join(','), ...all.map(b => cols.map(k => csv(b[k])).join(','))].join('\n'));
  const rc = ['centre', 'status', 'brands', 'url', 'directoryUrl', 'method', 'note'];
  await fs.writeFile(path.join(OUT, 'report.csv'), '﻿' + [rc.join(','), ...results.map(r => [r.centre, r.status, r.brands.length, r.url, r.directoryUrl, r.method, r.note].map(csv).join(','))].join('\n'));
  return summary;
}

// ---- optional: suggest official sites for centres whose sheet link is a directory/article
async function discoverUrls(centres, overrides) {
  const todo = centres.filter(c => { const r = resolve(c, overrides); return r.none; });
  log(`Searching for official websites of ${todo.length} centres (results go to overrides.suggested.json for you to check)`);
  const BAD = /(ukmalls|shopping-centers\.co|malls\.com|savills|knightfrank|visitbritain|costar|wikipedia|tripadvisor|facebook|instagram|twitter|linkedin|yelp|google\.|bing\.|gov\.uk|yell\.com|completely-retail|propertyweek|placemaking|bbc\.|landsec|hammerson|britishland|nbim|cppinvestments|reddit|youtube|timeout|mapquest|cylex|192\.com|brownbook|thesun|mirror\.co|manchestereveningnews|chroniclelive|walesonline|glasgowlive|liverpoolecho|birminghammail|kentonline)/i;
  const out = await readJson(path.join(DIR, 'overrides.suggested.json'), {});
  for (const c of todo) {
    if (out[c.name]) continue;
    const q = `${c.name} ${c.town} shopping centre official site`;
    const r = await fetchText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { gapMs: 2500 });
    if (!r.ok) { log(`   search failed for ${c.name}`); continue; }
    const $ = cheerio.load(r.text);
    const links = $('a.result__a').map((_, a) => { const h = $(a).attr('href') || ''; const m = h.match(/uddg=([^&]+)/); return m ? decodeURIComponent(m[1]) : h; }).get().filter(h => /^https?:/.test(h) && !BAD.test(h));
    if (links[0]) { const u = new URL(links[0]); out[c.name] = { url: u.origin + '/', candidates: links.slice(0, 3), query: q }; log(`   ${c.name} → ${u.origin}`); }
    else log(`   ${c.name}: no candidate`);
    await save(path.join(DIR, 'overrides.suggested.json'), out);
  }
  log('Done. Check overrides.suggested.json, then copy the correct entries ({"Centre name": {"url": "..."}}) into overrides.json.');
}

async function main() {
  const centres = await readJson(path.resolve(DIR, opt('centres', 'centres.json')), []);
  const overrides = await readJson(path.join(DIR, 'overrides.json'), {});
  if (O.discover) { await discoverUrls(centres, overrides); return; }
  let list = centres.filter(c => !O.only.length || O.only.some(o => c.name.toLowerCase().includes(o)));
  if (O.limit) list = list.slice(0, O.limit);
  log(`Scraping ${list.length} centres · details ${O.details ? 'on' : 'off'} · concurrency ${O.concurrency}`);
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => { while (next < list.length) { const i = next++; try { results[i] = await scrapeCentre(list[i], overrides); } catch (e) { log(`✗ ${list[i].name}: ${e.message}`); results[i] = { centre: list[i].name, status: 'error', note: String(e.message), brands: [] }; } } };
  await Promise.all(Array.from({ length: Math.max(1, O.concurrency) }, worker));
  await closeBrowser();
  // merge with cached results for centres not in this run, so brands.json always covers everything scraped so far
  const all = [];
  for (const c of centres) { const r = results.find(x => x && x.centre === c.name) || await readJson(path.join(OUT, 'centres', slug(c.name) + '.json'), null); if (r) all.push(r); }
  const s = await writeOutputs(all);
  log(`Finished: ${s.ok}/${s.centres} centres OK, ${s.brands} brand entries (${s.uniqueBrands} unique brands). Status: ${JSON.stringify(s.byStatus)}`);
  log(`Files: output/brands.json, output/brands.csv, output/report.csv — run "npm run publish-site" to add the brands to the map.`);
}
main().then(() => process.exit(0)).catch(async e => { console.error(e); await closeBrowser(); process.exit(1); });
