// ukmalls.co.uk module: index of all centres, matching to our centres, and store lists per centre.
// Page structure (checked Nov 2026):
//   /shopping-centres                 -> every centre: a.listing-item > .listing-badge "N stores", h3 name, span address
//   /shopping-centres/<c>/<r>/<town>/<slug>  -> centre page: JSON-LD ShoppingCenter + #listing-stores ul.stores-list-new li a
//   .../<slug>/<store-slug>           -> store page: JSON-LD Store with branchOf (brand group)
import * as cheerio from 'cheerio';

export const BASE = 'https://www.ukmalls.co.uk';
const clean = s => String(s || '').replace(/\s+/g, ' ').replace(/‎/g, '').trim();
const PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
export const postcode = s => { const m = String(s || '').toUpperCase().match(PC); return m ? m[1] + ' ' + m[2] : ''; };

// ---------- parsing
export function parseIndex(html) {
  const $ = cheerio.load(html);
  const rows = new Map();
  $('a.listing-item[href*="/shopping-centres/"]').each((_, a) => {
    const href = $(a).attr('href'); const path = new URL(href, BASE).pathname.replace(/^\/shopping-centres\//, '').replace(/\/$/, '');
    if (path.split('/').length !== 4 || rows.has(path)) return;
    const address = clean($(a).find('.listing-item-inner span').first().text());
    rows.set(path, { path, name: clean($(a).find('h3').first().text()), address, postcode: postcode(address), storeCount: parseInt($(a).find('.listing-badge').text(), 10) || 0, town: path.split('/')[2] });
  });
  return [...rows.values()];
}

function ldNodes($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => { try { const j = JSON.parse($(el).contents().text()); [].concat(j).forEach(n => out.push(n)); } catch { /* the site sometimes emits trailing commas */
    try { const j = JSON.parse($(el).contents().text().replace(/,\s*([}\]])/g, '$1')); [].concat(j).forEach(n => out.push(n)); } catch { } } });
  return out;
}
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function hoursOf(n) {
  const spec = [].concat(n.openingHoursSpecification || []);
  return spec.map(s => `${[].concat(s.dayOfWeek || []).map(d => String(d).split('/').pop()).join(', ')}: ${s.opens || '?'}–${s.closes || '?'}`)
    .sort((a, b) => DAYS.findIndex(d => a.startsWith(d)) - DAYS.findIndex(d => b.startsWith(d)));
}

export function parseCentre(html, url) {
  const $ = cheerio.load(html);
  const node = ldNodes($).find(n => /ShoppingCenter|Mall|Place/i.test([].concat(n['@type']).join())) || {};
  const a = node.address || {};
  const stores = [];
  const seen = new Set();
  $('#listing-stores a[href], ul.stores-list-new a[href]').each((_, el) => {
    const href = new URL($(el).attr('href'), BASE).href.replace(/\/$/, '');
    if (seen.has(href)) return; seen.add(href);
    const name = clean($(el).text()); if (!name) return;
    stores.push({ name, url: href, slug: href.split('/').pop() });
  });
  const phone = (clean($('body').text()).match(/Phone:\s*([+\d][\d ]{7,})/) || [])[1] || '';
  let website = clean(node.url || ''); if (website && !/^https?:/i.test(website)) website = 'https://' + website;
  return {
    url, name: clean(node.name) || clean($('h1').first().text()).replace(/\s+located in.*$/i, ''),
    address: [a.streetAddress, a.addressLocality, a.postalCode].filter(Boolean).map(clean).join(', '),
    postcode: postcode(a.postalCode || $('h1').text()), town: clean(a.addressLocality), region: clean(a.addressRegion),
    website, phone: clean(phone), hours: hoursOf(node),
    storeCount: parseInt(($('title').text().match(/(\d+)\s+stores/) || [])[1], 10) || stores.length, stores,
  };
}

export function parseStore(html) {
  const $ = cheerio.load(html);
  const node = ldNodes($).find(n => /Store|LocalBusiness/i.test([].concat(n['@type']).join())) || {};
  const text = $('body').text().replace(/[\t ]+/g, ' ');
  const brand = clean(node.branchOf) || clean((text.match(/Brand name:\s*\n?\s*([^\n]+)/) || [])[1]);
  return { name: clean(node.name), brand };
}

// ---------- matching our centres to ukmalls centres
const STOP = new Set(['the', 'shopping', 'centre', 'center', 'centres', 'mall', 'and', 'of', 'at', 'in', 'uk', 'ltd', 'retail', 'park', 'precinct', 'arcade', 'walk', 'square', 'outlet', 'designer', 'village', 'place', 'quarter', 'plaza', 'gallery', 'galleries', 'complex', 'formerly', 'intu', 'now', 's']);
const KEEP_IF_ALONE = new Set(['park', 'arcade', 'walk', 'square', 'outlet', 'village', 'place', 'quarter', 'plaza', 'galleries']);
export function nameTokens(s) {
  const all = String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const core = all.filter(t => !STOP.has(t));
  return core.length ? core : all.filter(t => KEEP_IF_ALONE.has(t) || !STOP.has(t));
}
const slugTokens = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !['north', 'south', 'east', 'west', 'city', 'of', 'scotland', 'wales', 'northern', 'ireland', 'england', 'upon'].includes(t));
function jaccard(a, b) { const A = new Set(a), B = new Set(b); let i = 0; A.forEach(x => B.has(x) && i++); return A.size + B.size - i ? i / (A.size + B.size - i) : 0; }
function containment(a, b) { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let i = 0; A.forEach(x => B.has(x) && i++); return i / Math.min(A.size, B.size); }

export function scorePair(c, r) {
  // c: {name, aliases?, town, localAuthority, postcode}; r: index row
  const names = [c.name, ...(c.aliases || [])].map(nameTokens);
  const rn = nameTokens(r.name), rs = nameTokens(r.path.split('/').pop().replace(/-\d+$/, ''));
  let nameSim = 0;
  for (const n of names) nameSim = Math.max(nameSim, jaccard(n, rn), 0.85 * containment(n, rn), jaccard(n, rs) * 0.95);
  const cpc = postcode(c.postcode), rpc = r.postcode;
  const pcExact = cpc && rpc && cpc === rpc, pcDistrict = cpc && rpc && cpc.split(' ')[0] === rpc.split(' ')[0];
  const townToks = new Set([...slugTokens(c.town), ...slugTokens(String(c.localAuthority || '').replace(/(london borough of|royal borough of|city of|borough|district|county|metropolitan|council|city)/gi, ' '))]);
  const rTown = new Set([...slugTokens(r.town), ...slugTokens(r.address)]);
  const townHit = [...townToks].some(t => t.length > 2 && rTown.has(t));
  const score = nameSim * 0.62 + (pcExact ? 0.38 : pcDistrict ? 0.14 : 0) + (townHit ? 0.18 : 0);
  return { score: +score.toFixed(3), nameSim: +nameSim.toFixed(3), pcExact: !!pcExact, townHit };
}

export function matchCentres(centres, rows, { minScore = 0.55 } = {}) {
  const cands = [];
  centres.forEach((c, ci) => rows.forEach((r, ri) => {
    const s = scorePair(c, r);
    const ok = s.score >= minScore && (s.nameSim >= 0.34 || (s.pcExact && s.nameSim >= 0.2));
    if (ok) cands.push({ ci, ri, ...s });
  }));
  cands.sort((a, b) => b.score - a.score);
  const usedC = new Set(), usedR = new Set(), out = new Map();
  for (const m of cands) {
    if (usedC.has(m.ci) || (usedR.has(m.ri) && m.score < 0.8)) continue; // the sheet lists a few centres twice under different names
    usedC.add(m.ci); usedR.add(m.ri);
    out.set(centres[m.ci].name, { path: rows[m.ri].path, ukName: rows[m.ri].name, storeCount: rows[m.ri].storeCount, score: m.score, nameSim: m.nameSim, pcExact: m.pcExact, townHit: m.townHit, confidence: m.score >= 0.8 ? 'high' : m.score >= 0.65 ? 'medium' : 'low' });
  }
  return out;
}
