// ukmalls.co.uk: index of every centre, matching to our centres, store list per centre.
// No dependencies: the pages are simple and parsed with focused regexes.
//   /shopping-centres                     a.listing-item  (.listing-badge "N stores", h3 name, span address)
//   /shopping-centres/<c>/<r>/<town>/<slug> JSON-LD ShoppingCenter + #listing-stores ul.stores-list-new li a
'use strict';
const BASE = process.env.UKMALLS_BASE || 'https://www.ukmalls.co.uk';
const UA = process.env.UKMALLS_UA || 'Mozilla/5.0 (compatible; UKShoppingCentreMap/1.0; +brand directory for a UK shopping centre map)';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = s => String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
const strip = s => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/[\s‎]+/g, ' ').trim();
const PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const postcode = s => { const m = String(s || '').toUpperCase().match(PC); return m ? m[1] + ' ' + m[2] : ''; };
const pathOf = href => { try { return new URL(href, BASE).pathname.replace(/^\/shopping-centres\//, '').replace(/\/+$/, ''); } catch { return ''; } };

// ---------- HTTP (polite: one request at a time per process, with a gap)
let last = 0;
async function get(url, { gapMs = +process.env.UKMALLS_GAP_MS || 1100, timeout = 25000, retries = 2 } = {}) {
  for (let i = 0; ; i++) {
    const wait = last + gapMs - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' }, signal: ctl.signal });
      const text = await res.text(); clearTimeout(t);
      if ((res.status === 429 || res.status >= 500) && i < retries) { await new Promise(r => setTimeout(r, 4000 * (i + 1))); continue; }
      return { ok: res.ok, status: res.status, text, url: res.url };
    } catch (e) {
      clearTimeout(t);
      if (i >= retries) return { ok: false, status: 0, text: '', error: String(e.message || e) };
      await new Promise(r => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

// ---------- parsing
function parseIndex(html) {
  const rows = new Map();
  const re = /<a\s[^>]*href="([^"]*\/shopping-centres\/[^"]+)"[^>]*class="[^"]*listing-item[^"]*"[^>]*>([\s\S]*?)<\/a>|<a\s[^>]*class="[^"]*listing-item[^"]*"[^>]*href="([^"]*\/shopping-centres\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1] || m[3], inner = m[2] || m[4];
    const path = pathOf(href); if (path.split('/').length !== 4 || rows.has(path)) continue;
    const name = strip((inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
    const address = strip((inner.match(/<div[^>]*listing-item-inner[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i) || inner.match(/<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
    const count = parseInt(strip((inner.match(/listing-badge[^>]*>([\s\S]*?)</i) || [])[1]), 10) || 0;
    rows.set(path, { path, name, address, postcode: postcode(address), storeCount: count, town: path.split('/')[2] });
  }
  return [...rows.values()];
}

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim();
    for (const txt of [raw, raw.replace(/,\s*([}\]])/g, '$1')]) { try { [].concat(JSON.parse(txt)).forEach(n => out.push(n)); break; } catch { } }
  }
  return out;
}
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// ukmalls gives closing times on a 12-hour clock without am/pm ("10:00"–"09:00" means 10am–9pm)
const pm = (o, c) => { if (!o || !c) return c; const [oh] = o.split(':').map(Number), [ch, cm] = c.split(':').map(Number); return ch < 12 && (ch <= oh || ch - oh < 4) ? String(ch + 12).padStart(2, '0') + ':' + String(cm || 0).padStart(2, '0') : c; };
const hoursOf = n => [].concat(n.openingHoursSpecification || []).map(s => ({ d: [].concat(s.dayOfWeek || []).map(x => String(x).split('/').pop()).join(', '), o: s.opens, c: pm(s.opens, s.closes) }))
  .sort((a, b) => DAYS.indexOf(a.d.split(',')[0]) - DAYS.indexOf(b.d.split(',')[0])).map(h => `${h.d}: ${h.o || '?'}–${h.c || '?'}`);

function parseCentre(html, url) {
  const node = jsonLd(html).find(n => /ShoppingCenter|Mall/i.test([].concat(n['@type']).join())) || {};
  const a = node.address || {};
  const block = (html.match(/<div[^>]*id="listing-stores"[^>]*>([\s\S]*?)(?:<\/ul>|<h3)/i) || html.match(/<ul[^>]*stores-list-new[^>]*>([\s\S]*?)<\/ul>/i) || [])[1] || '';
  const stores = [], seen = new Set();
  for (const m of block.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(m[1], BASE).href.replace(/\/+$/, ''); const name = strip(m[2]);
    if (!name || JUNK.test(name) || seen.has(href)) continue; seen.add(href);
    stores.push({ name: tidyName(name), url: href });
  }
  const body = strip(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
  let website = strip(node.url || ''); if (website && !/^https?:/i.test(website)) website = 'https://' + website.replace(/^\/+/, '');
  return {
    url, name: strip(node.name) || strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]).replace(/\s+located in.*$/i, ''),
    address: [a.streetAddress, a.addressLocality, a.postalCode].filter(Boolean).map(strip).join(', '),
    postcode: postcode(a.postalCode), website, phone: (/not available/i.test(node.telephone || '') ? '' : strip(node.telephone)) || ((body.match(/Phone(?: number)?:\s*([+\d][\d ]{7,}\d)/) || [])[1] || '').trim(),
    hours: hoursOf(node), storeCount: parseInt((html.match(/<title>[^<]*?(\d+)\s+stores/i) || [])[1], 10) || stores.length, stores,
  };
}
// ukmalls writes some names as "H&m", "Jd Sports": restore common capitalisation
const FIX = { 'h&m': 'H&M', 'jd sports': 'JD Sports', 'tk maxx': 'TK Maxx', 'ee': 'EE', 'o2': 'O2', 'hmv': 'HMV', 'kfc': 'KFC', 'hsbc': 'HSBC', 'tsb': 'TSB', 'mac': 'MAC', 'ugg': 'UGG', 'whsmith': 'WHSmith', 'wh smith': 'WHSmith', 'm&s': 'M&S', 'b&m': 'B&M', 'river island': 'River Island', 'cex': 'CeX', 'ted baker': 'Ted Baker', 'jd': 'JD' };
function tidyName(n) { return FIX[n.toLowerCase()] || n; }

// ---------- brand groups (same 13 groups the website scraper uses)
const KW = [
  ['Department store', /\b(john lewis|marks (&|and) spencer|m&s|debenhams|house of fraser|fenwick|selfridges|harvey nichols|frasers|beales|bhs)\b/i],
  ['Supermarket & convenience', /\b(tesco|sainsbury'?s?|asda|morrisons|aldi|lidl|iceland|co-?op|waitrose|spar|farmfoods|heron foods)\b/i],
  ['Food & drink', /\b(muffin break|mcdonalds|spudulike|chiquito|shakeaway|las iguanas|nandos|pizzaexpress|caff[eé] nero|cooplands|pho\b|poundbakery|el mexicana|barburrito|wildwood|thaikhun|franco manca|browns|domo|cadbury|whittard|tea|krispy|greggs|nero|coffee|cafe|burrito|kebab|grill|noodles?|pretzels?|bill'?s|byron|caf[eéè] rouge|caff[eè] nero|carluccio|comptoir|cote|giraffe|godiva|harry ramsden|il gusto|jamie'?s|joe delucci|loch fyne|lola'?s|pretzel|nespresso|shawa|sizzled|stacked|tapas|tgi|wahaca|bubbleology|herbal|t2\b|cupcake|pancake|brasserie|gelato|patisserie valerie|wok|shake shack|cosy club|prezzo|pizza express|honest burger|gourmet|yo!|tortilla|cinnabon|auntie anne|millie'?s|ben'?s cookies|krispy kreme|caf[eé]|coffee|costa|starbucks|pret|greggs|nando|mcdonald|burger|kfc|subway|pizza|wagamama|five guys|restaurant|kitchen|grill|bar\b|pub\b|bakery|krispy|creams|tea\b|sushi|noodle|taco|chicken|dessert|ice cream|juice|bubble|doughnut|donut|zizzi|ask italian|frankie|wetherspoon|leon\b|itsu|wasabi|tortilla|chopstix|bella italia|harvester|toby carvery|popeyes|wingstop|canteen|patisserie|deli|food|eat|diner|grill|chippy|fish|cookie|waffle|crepe|shake|smoothie|boost|millie|subway)\b/i],
  ['Health & beauty', /\b(regis|vip\b|vip electronic|better brows|lashious|love aroma|semichem|body shop|clarins|urban decay|bobbi brown|trade secret|cosmetics|vaporized|amplifon|scrivens|boots|kiehl'?s|aveda|jo malone|kiehl|l'?occitane|molton brown|neal'?s yard|penhaligon|smashbox|supercuts|obey your body|charlotte tilbury|benefit|clinique|estee|bare minerals|crabtree|the fragrance shop|bodycare|boots|superdrug|the body shop|lush|space nk|sephora|mac\b|kiehl|rituals|holland (&|and) barrett|specsavers|vision express|optic|pharmacy|chemist|barber|hair|salon|nails?|beauty|brow|lash|perfume|fragrance|savers|clinic|dental|dentist|spa\b|kiko|toni (&|and) guy|tanning|tattoo|vape|e-?cig)\b/i],
  ['Jewellery & watches', /\b(f\.? ?hinds|claire[’']?s|chapelle|argento|chisholm hunter|fraser hart|mappin|omega|swatch|watchfinder|links of london|david clulow|tag heuer|rolex|pandora|h\.? ?samuel|ernest jones|goldsmiths|beaverbrooks|swarovski|warren james|claire'?s|f\.?hinds|watch|jewel|diamond|accessorize|lovisa|thomas sabo|gold)\b/i],
  ['Technology', /\b(brighthouse|bright house|grainger games|jessops|maplin|sony|uberfone|3\b|3 store|bose|dyson|ismash|tesla|rockar|tempur|menkind|typo|sega|apple|samsung|currys|ee\b|o2\b|vodafone|three|carphone|game\b|cex|computer|phone|mobile|tech|hmv|virgin media|sky\b|repair)\b/i],
  ['Sports & outdoor', /\b(dw sports|halfords|foot asylum|runnersneed|gravity|jd\b|jd sports|sports direct|footasylum|foot ?locker|nike|adidas|puma|decathlon|go outdoors|mountain warehouse|trespass|regatta|millets|blacks|cotswold outdoor|schuh|skechers|gym\b|pure gym|snow|golf|cycle|bike|sport)\b/i],
  ['Kids & toys', /\b(hamleys|toytown|mamas (&|and) papas|explore learning|games workshop|that'?s entertainment|build a bear|elc|hawkins bazaar|splat|young driver|the entertainer|smyths|lego|disney|build-a-bear|mothercare|toys?|kids|baby|early learning|smiggle)\b/i],
  ['Home', /\b(poundworld|wilkinson|denby|laura ashley|procook|sharps|harry corry|poundland|poundlan|le creuset|steamer trading|cookshop|whitewall|castle galleries|galleries|tempur|dunelm|the range|wilko|b&m|home ?bargains|poundland|poundstretcher|lakeland|robert dyas|ikea|habitat|oliver bonas|homesense|furniture|bed|sofa|carpet|interiors?|cook|candle|yankee|home|tiger|flying tiger|card factory|savers|pound|discount|dfs|argos)\b/i],
  ['Books, music & gifts', /\b(ryman|grape tree|hallmark|scribbler|supernews|newspoint|castle fine art|waterstone'?s|sweets from heaven|harris'?s|waterstones|whsmith|wh smith|the works|clintons|paperchase|gift|cards?|book|stationery|hotel chocolat|thorntons|lindt|hobbycraft|sweet|candy|chocolate|florist|flowers)\b/i],
  ['Leisure', /\b(showcase|sega active|cinema|vue|odeon|cineworld|bowling|tenpin|hollywood bowl|arcade|escape|soft play|trampoline|golf|adventure|play|leisure|bingo|casino|frame|fitness|yoga)\b/i],
  ['Services', /\b(eurochange|ladbrokes|william hill|betfred|coral|paddy power|shopmobility|max spielmann|snappy snaps|timpsons?|h&t|no\.? ?1 currency|amazon locker|customer service|inter car|car clean|thomson|shoecare|crawshaws|building society|british heart foundation|oxfam|sue ryder|salvation army|debra|charity|cancer research|barnardo|age uk|kanoo|foreign exchange|kuoni|virgin holidays|car wash|transform your images|newsagent|bank|barclays|hsbc|lloyds|natwest|santander|halifax|nationwide|tsb|post office|travel|tui|key ?cutting|timpson|dry clean|tailor|alteration|estate agent|bureau|money|cash|recruitment|council|library|job ?centre|nhs|doctor|toilet|insurance|solicitor|photo|print|pawn|cash converters|ramsdens|optical|hearing)\b/i],
  ['Fashion', /\b(roman|blue inc|usc|socialites|glamour forever|french connection|pavers|ecco|julian charles|ben sherman|bench|boss|tog ?24|pep (&|and) co|cotton traders|officers club|stormfront|hotter|druckers|jacamo|simply be|t\.?m\.?lewin|jaeger|klass|jeff banks|two seasons|christy|dr\.? martens|guess|new balance|fuel|asics|saltrock|fiorelli|levis|osprey|trade secret|paul smith|original penguin|jack jones|bravissimo|outfit|khaadi|vivienne westwood|treds|barbour|jacques vert|essential|rush|charles clinkard|mulberry|musto|bedeck|antler|samsonite|scotts|tj hughes|dunnes|aldo|alex and ani|allsaints|animal|apricot|base\b|calzedonia|cath kidston|charles tyrwhitt|coach|coast|diesel|fatface|fossil|fred perry|gant|hackett|hawes|intimissimi|jack wills|jones bootmaker|karen millen|kate spade|l\.?k\.? ?bennett|lacoste|massimo dutti|michael kors|miss selfridge|missguided|o'?neill|radley|reebok|rigby|russell (&|and) bromley|sole trader|speedo|sweaty betty|tessuti|the north face|timberland|tm lewin|topman|urban outfitters|victoria'?s secret|aspinal|bags|tailor|kurt|skinnydip|choice|sunglass|ray-?ban|ugg|cos\b|arket|sosandar|hobbs|white stuff|zara|bershka|nike|trespass|jigsaw|boden|whistles|mint velvet|sweaty|lululemon|gymshark|primark|h&m|zara|next\b|river island|new look|topshop|mango|uniqlo|gap\b|monsoon|fat face|white stuff|joules|seasalt|superdry|hollister|abercrombie|levi|tommy|calvin|ralph lauren|ted baker|reiss|whistles|hobbs|phase eight|jigsaw|oasis|warehouse|wallis|dorothy perkins|burton|peacocks|matalan|bonmarch|select|quiz|pull ?& ?bear|bershka|stradivarius|ann summers|la senza|boux avenue|clarks|office|kurt geiger|dune|moss|suit|menswear|womenswear|fashion|clothing|shoes?|boutique|lingerie|denim|tk maxx|footwear|accessor|sinchow|yours|evans|m&co|bon ?marche|weird fish|crew|jack (&|and) jones|vans|converse|deichmann|shoe zone|brantano|shoezone|trespass|edinburgh woollen|mint velvet|white company|cos\b|& other stories|lipsy|jd williams)\b/i],
];
const groupOf = name => { const n = String(name).replace(/[’`]/g, "'"); return (KW.find(([, re]) => re.test(n)) || ['Other'])[0]; };
const JUNK = /^(show all stores|view all stores|all stores|show more|more stores)$/i;

// ---------- matching our centres to ukmalls centres
const STOP = new Set(['the', 'shopping', 'centre', 'center', 'centres', 'mall', 'and', 'of', 'at', 'in', 'uk', 'ltd', 'retail', 'park', 'precinct', 'arcade', 'walk', 'square', 'outlet', 'designer', 'village', 'place', 'quarter', 'plaza', 'gallery', 'galleries', 'complex', 'formerly', 'intu', 'now', 's']);
const nameTokens = s => { const all = String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); const core = all.filter(t => !STOP.has(t)); return core.length ? core : all.filter(t => !['the', 'and', 'of'].includes(t)); };
const slugTokens = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !['north', 'south', 'east', 'west', 'city', 'of', 'scotland', 'wales', 'northern', 'ireland', 'england', 'upon', 'on', 'the'].includes(t));
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); let i = 0; A.forEach(x => B.has(x) && i++); return A.size + B.size - i ? i / (A.size + B.size - i) : 0; };
const containment = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let i = 0; A.forEach(x => B.has(x) && i++); return i / Math.min(A.size, B.size); };

function scorePair(c, r) {
  const rn = nameTokens(r.name), rs = nameTokens(r.path.split('/').pop().replace(/-\d+$/, ''));
  let nameSim = 0;
  for (const nm of [c.name, ...(c.aliases || [])]) { const n = nameTokens(nm); nameSim = Math.max(nameSim, jaccard(n, rn), 0.85 * containment(n, rn), 0.95 * jaccard(n, rs)); }
  const cpc = postcode(c.postcode), rpc = r.postcode;
  const pcExact = !!(cpc && rpc && cpc === rpc), pcDistrict = !!(cpc && rpc && cpc.split(' ')[0] === rpc.split(' ')[0]);
  const townToks = new Set([...slugTokens(c.town), ...slugTokens(String(c.localAuthority || '').replace(/(london borough of|royal borough of|city of|borough|district|county|metropolitan|council|city)/gi, ' '))]);
  const rTown = new Set([...slugTokens(r.town), ...slugTokens(r.address)]);
  const townHit = [...townToks].some(t => t.length > 2 && rTown.has(t));
  const score = nameSim * 0.62 + (pcExact ? 0.38 : pcDistrict ? 0.14 : 0) + (townHit ? 0.18 : 0);
  return { score: +score.toFixed(3), nameSim: +nameSim.toFixed(3), pcExact, townHit };
}
const confidence = s => s >= 0.8 ? 'high' : s >= 0.65 ? 'medium' : 'low';

// returns Map(centreName -> {path, ukName, score, confidence, ...}) — one ukmalls page per centre
function matchCentres(centres, rows, { minScore = 0.55 } = {}) {
  const cands = [];
  centres.forEach((c, ci) => rows.forEach((r, ri) => { const s = scorePair(c, r); if (s.score >= minScore && (s.nameSim >= 0.34 || (s.pcExact && s.nameSim >= 0.2))) cands.push({ ci, ri, ...s }); }));
  cands.sort((a, b) => b.score - a.score);
  const usedC = new Set(), usedR = new Set(), out = new Map();
  for (const m of cands) {
    if (usedC.has(m.ci) || (usedR.has(m.ri) && m.score < 0.8)) continue; // the sheet lists a few centres twice under different names
    usedC.add(m.ci); usedR.add(m.ri);
    const r = rows[m.ri];
    out.set(centres[m.ci].key || centres[m.ci].name, { path: r.path, ukName: r.name, storeCount: r.storeCount, score: m.score, nameSim: m.nameSim, pcExact: m.pcExact, townHit: m.townHit, confidence: confidence(m.score) });
  }
  return out;
}
function candidates(c, rows, n = 6) {
  return rows.map(r => ({ r, s: scorePair(c, r) })).sort((a, b) => b.s.score - a.s.score).slice(0, n)
    .map(({ r, s }) => ({ path: r.path, ukName: r.name, address: r.address, storeCount: r.storeCount, url: BASE + '/shopping-centres/' + r.path, ...s, confidence: confidence(s.score) }));
}

const hoursFromSpec = spec => hoursOf({ openingHoursSpecification: spec });
module.exports = { JUNK, BASE, get, parseIndex, parseCentre, matchCentres, candidates, scorePair, groupOf, postcode, tidyName, hoursFromSpec };
