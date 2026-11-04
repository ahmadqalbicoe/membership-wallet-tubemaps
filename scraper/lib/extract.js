// HTML extraction: store lists from directory pages, brand details from store pages.
import * as cheerio from 'cheerio';

export const STORE_KW = ['stores', 'store', 'shops', 'shop', 'brands', 'brand', 'retailers', 'retailer', 'directory',
  'store-directory', 'shop-directory', 'stores-a-z', 'shops-a-z', 'a-z', 'our-stores', 'our-shops', 'tenants', 'units',
  'eat', 'eat-drink', 'eat-and-drink', 'food', 'food-drink', 'food-and-drink', 'dine', 'dining', 'restaurants', 'restaurant',
  'cafes', 'leisure', 'whats-here', 'what-s-here', 'outlets', 'store-guide', 'shopping', 'retail'];
const STORE_KW_SET = new Set(STORE_KW);
const NAV_WORDS = /^(view all|see all|all|stores?|shops?|brands?|a-z|a to z|directory|store directory|shop directory|opening hours|open(ing)? times|directions|contact( us)?|more|read more|find out more|learn more|discover more|view store|view shop|visit store|shop now|menu|home|load more|show more|filter|search|categories|category|map|centre map|eat & drink|food & drink|leisure|offers|events|news|parking|accessibility|jobs|careers|login|sign in|register|newsletter|privacy|cookies|terms|sitemap|facebook|instagram|twitter|x|tiktok|youtube|linkedin|\d+)$/i;
const SLUG_STOP = new Set(['all', 'a-z', 'category', 'categories', 'search', 'page', 'map', 'filter', 'offers', 'events', 'news', 'tag', 'tags', 'type', 'index', 'list', 'opening-hours', 'feed']);
const SOCIAL = /(facebook|instagram|twitter|x\.com|tiktok|youtube|linkedin|pinterest|snapchat|threads\.net|whatsapp)/i;
const IGNORE_EXT = /(google\.[a-z.]+\/maps|goo\.gl|maps\.app|apple\.com\/maps|apps\.apple|play\.google|what3words|onetrust|cookiebot|addtoany|sharethis|wa\.me|mailto:|tel:|javascript:)/i;

export const clean = s => String(s || '').replace(/\s+/g, ' ').replace(/[​­]/g, '').trim();
const abs = (href, base) => { try { return new URL(href, base).href.replace(/#.*$/, ''); } catch { return null; } };
const regDomain = h => h.replace(/^www\./, '').split('.').slice(-3).join('.').replace(/^(?:[^.]+\.)?([^.]+\.(?:co|org|ac|gov)\.uk)$/, '$1');
export const sameSite = (a, b) => { try { return regDomain(new URL(a).host) === regDomain(new URL(b).host); } catch { return false; } };
const segs = p => p.replace(/\/+$/, '').split('/').filter(Boolean);
const titleCase = s => s.replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, m => m.toUpperCase());

export function slugToName(url) {
  const s = segs(new URL(url).pathname).pop() || '';
  return titleCase(decodeURIComponent(s).replace(/\.(html?|php|aspx)$/, '').replace(/-\d+$/, '')).replace(/\bAnd\b/g, '&');
}

// ---- JSON-LD
export function jsonLd($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).contents().text().trim());
      const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); out.push(n); if (n['@graph']) walk(n['@graph']); };
      walk(j);
    } catch { /* ignore broken JSON-LD */ }
  });
  return out;
}
const typeOf = n => [].concat(n['@type'] || []).join(',');
const STORE_TYPES = /(Store|LocalBusiness|Restaurant|CafeOrCoffeeShop|FoodEstablishment|BarOrPub|FastFoodRestaurant|HealthAndBeautyBusiness|EntertainmentBusiness|Bakery|Optician|Pharmacy|BeautySalon|HairSalon|SportsActivityLocation|MovieTheater|Organization|Brand)/;

// ---- Is this path a plausible store detail URL?
export function storePathInfo(url, origin) {
  let u; try { u = new URL(url); } catch { return null; }
  if (origin && !sameSite(u.href, origin)) return null;
  const s = segs(u.pathname);
  if (s.length < 2) return null;
  const slug = s[s.length - 1].toLowerCase();
  if (SLUG_STOP.has(slug) || /^page-?\d+$/.test(slug) || /\.(pdf|jpe?g|png|svg|webp|zip)$/.test(slug)) return null;
  // any earlier segment is a store keyword  -> prefix up to and including it
  for (let i = s.length - 2; i >= 0; i--) {
    if (STORE_KW_SET.has(s[i].toLowerCase())) {
      if (s.length - 1 - i > 2) return null;          // too deep beneath the keyword
      if (s.length - 1 - i === 2 && SLUG_STOP.has(s[i + 1].toLowerCase())) return null;
      return { prefix: '/' + s.slice(0, i + 1).join('/') + '/', slug };
    }
  }
  return null;
}

function nameFromAnchor($, a) {
  const $a = $(a);
  const h = $a.find('h1,h2,h3,h4,h5,[class*="title" i],[class*="name" i]').first().text();
  const cands = [h, $a.attr('aria-label'), $a.attr('title'), $a.find('img[alt]').first().attr('alt'), $a.text()];
  for (let c of cands) {
    c = clean(c).replace(/^(view|visit|go to|discover)\s+/i, '').replace(/\s*(store|shop) (details|page)$/i, '').replace(/\s*logo$/i, '');
    if (c && c.length <= 60 && !NAV_WORDS.test(c)) return c;
  }
  return '';
}

function nearCategory($, a) {
  const $card = $(a).closest('li,article,[class*="card" i],[class*="item" i],[class*="tile" i]');
  const t = clean($card.find('[class*="categor" i],[class*="tag" i],[class*="type" i]').first().text());
  return t && t.length < 50 ? t : '';
}
function nearLogo($, a, base) {
  const img = $(a).find('img').first();
  const src = img.attr('data-src') || img.attr('src') || (img.attr('srcset') || '').split(' ')[0];
  return src && !src.startsWith('data:') ? abs(src, base) : '';
}

// Walk embedded JSON (Next.js / Nuxt / Gatsby / generic) for arrays of store-like objects.
function embeddedStores($, base, dirUrl) {
  const blobs = [];
  $('script#__NEXT_DATA__, script[type="application/json"], script#__NUXT_DATA__').each((_, el) => { try { blobs.push(JSON.parse($(el).contents().text())); } catch { } });
  $('script:not([src])').each((_, el) => {
    const t = $(el).contents().text();
    const m = t.match(/window\.(?:__INITIAL_STATE__|__PRELOADED_STATE__|__APOLLO_STATE__|__DATA__)\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (m) try { blobs.push(JSON.parse(m[1])); } catch { }
  });
  const found = [];
  const pick = o => {
    const name = clean(o.name || o.title || o.storeName || o.brandName || o.displayName || (o.fields && (o.fields.name || o.fields.title)) || '');
    const slug = o.url || o.href || o.link || o.path || o.uri || o.slug || (o.fields && o.fields.slug) || '';
    return { name, slug: typeof slug === 'string' ? slug : (slug && (slug.current || slug.url)) || '' };
  };
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 14) return;
    if (Array.isArray(n)) {
      const objs = n.filter(x => x && typeof x === 'object' && !Array.isArray(x));
      if (objs.length >= 5) {
        const p = objs.map(pick);
        const good = p.filter(x => x.name && x.name.length <= 60 && x.slug);
        if (good.length >= Math.max(5, objs.length * 0.6)) {
          objs.forEach((o, i) => {
            const x = p[i]; if (!x.name || !x.slug) return;
            let url = /^https?:/.test(x.slug) ? x.slug : x.slug.startsWith('/') ? abs(x.slug, base) : abs(x.slug.replace(/^\/?/, ''), dirUrl.replace(/\/?$/, '/'));
            const cat = o.category?.name || o.category?.title || o.categories?.[0]?.name || o.categories?.[0]?.title || (typeof o.category === 'string' ? o.category : '') || o.type || '';
            found.push({ name: x.name, url, category: clean(typeof cat === 'string' ? cat : ''), logo: o.logo?.url || o.logo?.src || (typeof o.logo === 'string' ? o.logo : '') || '', unit: clean(o.unit || o.unitNumber || o.location || ''), source: 'embedded-json' });
          });
          return;
        }
      }
      n.forEach(x => walk(x, depth + 1));
    } else Object.values(n).forEach(x => walk(x, depth + 1));
  };
  blobs.forEach(b => walk(b, 0));
  return found;
}

// ---- Directory page -> list of stores
export function extractListing(html, pageUrl) {
  const $ = cheerio.load(html);
  const base = $('base[href]').attr('href') ? abs($('base[href]').attr('href'), pageUrl) : pageUrl;
  const dirPath = new URL(pageUrl).pathname.replace(/\/?$/, '/');
  const out = [];
  // 1) JSON-LD ItemList / Store nodes
  for (const n of jsonLd($)) {
    if (/ItemList/.test(typeOf(n)) && Array.isArray(n.itemListElement)) {
      n.itemListElement.forEach(it => { const i = it.item || it; const url = abs(i.url || it.url || '', base); const name = clean(i.name || it.name); if (name && url) out.push({ name, url, source: 'json-ld' }); });
    }
  }
  // 2) embedded framework JSON
  out.push(...embeddedStores($, base, pageUrl));
  // 3) anchors, grouped by store path prefix (children of this page count double)
  const groups = new Map();
  $('a[href]').each((_, a) => {
    if ($(a).closest('header,footer,nav,[role="navigation"],[class*="breadcrumb" i],[class*="menu" i]').length) return;
    const url = abs($(a).attr('href'), base); if (!url || url === pageUrl) return;
    const info = storePathInfo(url, pageUrl); if (!info) return;
    const name = nameFromAnchor($, a); if (!name) return;
    const isChild = new URL(url).pathname.startsWith(dirPath) && new URL(url).pathname !== dirPath;
    const key = isChild ? dirPath : info.prefix;
    if (!groups.has(key)) groups.set(key, { key, child: isChild, items: new Map() });
    const g = groups.get(key);
    const prev = g.items.get(url);
    if (!prev || (!prev.logo && nearLogo($, a, base))) g.items.set(url, { name: prev?.name && prev.name.length > name.length ? prev.name : name, url, category: nearCategory($, a), logo: nearLogo($, a, base), source: 'links' });
  });
  const ranked = [...groups.values()].sort((x, y) => (y.items.size * (y.child ? 2 : 1)) - (x.items.size * (x.child ? 2 : 1)));
  // keep the best group, plus other keyword groups that are also big (e.g. /stores/ and /eat-drink/)
  if (ranked.length) {
    const top = ranked[0].items.size;
    ranked.filter((g, i) => i === 0 || g.items.size >= Math.max(5, top * 0.25)).forEach(g => out.push(...g.items.values()));
  }
  return dedupe(out);
}

export function dedupe(list) {
  const m = new Map();
  for (const x of list) {
    if (!x.url || !x.name || NAV_WORDS.test(x.name)) continue;
    const k = x.url.replace(/\/$/, '').toLowerCase();
    const p = m.get(k);
    m.set(k, p ? { ...x, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) } : x);
  }
  // same name with several URLs (e.g. /stores/x and /stores/x?ref=) -> keep the first
  const byName = new Map();
  for (const x of m.values()) { const k = x.name.toLowerCase(); if (!byName.has(k)) byName.set(k, x); }
  return [...byName.values()];
}

// ---- Store page -> brand details
const DAYS = '(mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?';
const DAY_RE = new RegExp('^\\s*(' + DAYS + '(\\s*(-|–|to|&)\\s*' + DAYS + ')?|bank holidays?|public holidays?|today|weekdays|weekends)', 'i');
const TIME_RE = /(\d{1,2}([:.]\d{2})?\s*(am|pm)?\s*(-|–|to)\s*\d{1,2}([:.]\d{2})?\s*(am|pm)?|closed|24 hours|open 24)/i;
const PHONE_RE = /(?:\+44\s?\(?0?\)?\s?|\b0)(?:\d[\s-]?){9,10}\b/;
const UNIT_RE = /\b(?:Units?|Shop(?:\s+No\.?)?|Kiosk|Store)\s*(?:No\.?\s*)?[A-Z]{0,3}\s?\d{1,4}[A-Z]?(?:\s*(?:-|–|&|\/|and)\s*[A-Z]{0,3}\d{1,4}[A-Z]?)?\b/;
const LEVEL_RE = /\b(?:(?:Ground|First|Second|Third|Lower|Upper|Mezzanine|Lower Ground|Upper Ground)\s+(?:Floor|Level|Mall)|Level\s*-?\d|Floor\s*\d)\b/i;
const TYPE_CAT = [[/Clothing|Shoe/, 'Fashion'], [/Jewelry/, 'Jewellery & watches'], [/Restaurant|Cafe|Food|Bar|Bakery|IceCream/, 'Food & drink'], [/HealthAndBeauty|BeautySalon|HairSalon|Pharmacy|Optician|DaySpa/, 'Health & beauty'],
  [/Electronics|ComputerStore|MobilePhone/, 'Technology'], [/HomeGoods|Furniture|Hardware|GardenStore/, 'Home'], [/Toy|Hobby/, 'Kids & toys'], [/SportingGoods|Sports/, 'Sports & outdoor'], [/Book|Music/, 'Books, music & gifts'],
  [/MovieTheater|Entertainment|Bowling|AmusementPark/, 'Leisure'], [/Department/, 'Department store'], [/Grocery|Supermarket|Convenience/, 'Supermarket & convenience'], [/Bank|Financial|Insurance|Post/, 'Services']];

function hoursFromLd(n) {
  const out = [];
  [].concat(n.openingHours || []).forEach(h => typeof h === 'string' && out.push(clean(h)));
  [].concat(n.openingHoursSpecification || []).forEach(s => {
    if (!s) return;
    const days = [].concat(s.dayOfWeek || []).map(d => String(d).split('/').pop()).join(', ');
    if (days) out.push(`${days}: ${s.opens || '?'}–${s.closes || '?'}`);
  });
  return out;
}

function hoursFromText(text) {
  const lines = text.split(/\n+/).map(clean).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length && out.length < 14; i++) {
    const l = lines[i];
    if (DAY_RE.test(l)) {
      if (TIME_RE.test(l) && l.length < 80) out.push(l);
      else if (l.length < 25 && lines[i + 1] && TIME_RE.test(lines[i + 1]) && lines[i + 1].length < 40) { out.push(l + ' ' + lines[i + 1]); i++; }
    } else if (out.length && out.length < 7 && !TIME_RE.test(l)) {
      if (out.length >= 3) break;
    }
  }
  return [...new Set(out)];
}

export function cleanBrandName(name, siteName) {
  let n = clean(name);
  const parts = n.split(/\s+[|–—]\s+|\s+-\s+|\s*\|\s*/);
  if (parts.length > 1) n = parts.sort((a, b) => (siteName && b.toLowerCase().includes(siteName) ? -1 : 0) - (siteName && a.toLowerCase().includes(siteName) ? -1 : 0))[0];
  return clean(n.replace(/\b(store|shop) (details|info(rmation)?)\b/i, '').replace(/^(welcome to)\s+/i, ''));
}

export function extractStore(html, pageUrl, hint = {}) {
  const $ = cheerio.load(html);
  const ld = jsonLd($);
  const node = ld.find(n => STORE_TYPES.test(typeOf(n)) && !/WebSite|WebPage|BreadcrumbList/.test(typeOf(n)) && (n.openingHours || n.openingHoursSpecification || n.telephone || /Store|Restaurant|LocalBusiness/.test(typeOf(n)))) || {};
  const crumbs = ld.find(n => /BreadcrumbList/.test(typeOf(n)));
  const og = p => $(`meta[property="og:${p}"],meta[name="og:${p}"]`).attr('content');
  const siteName = clean(og('site_name')).toLowerCase();
  const $main = $('main').length ? $('main').first() : $('body');
  $main.find('script,style,noscript,svg,header,footer,nav,[class*="cookie" i],[id*="cookie" i],[class*="newsletter" i]').remove();
  $main.find('br').replaceWith('\n');
  $main.find('p,li,dd,dt,td,th,tr,span,div,h1,h2,h3,h4,h5,h6,time,a,section,article,address').each((_, e) => { $(e).append('\n'); });
  const blockText = $main.text().replace(/\t/g, ' ');
  const text = blockText.replace(/[ \u00a0]+/g, ' ');

  let name = clean(node.name) || clean($main.find('h1').first().text()) || cleanBrandName(og('title') || $('title').text(), siteName);
  name = cleanBrandName(name, siteName) || hint.name || '';
  if (!name || name.length > 80 || NAV_WORDS.test(name)) name = hint.name || slugToName(pageUrl);

  const metaDesc = clean($('meta[name="description"]').attr('content') || og('description'));
  const para = $main.find('p').map((_, p) => clean($(p).text())).get().find(t => t.length > 70 && !/cookie|newsletter|sign up|privacy/i.test(t));
  const description = clean(node.description) || para || metaDesc || '';

  const tel = $('a[href^="tel:"]').first().attr('href');
  const phone = clean(node.telephone) || (tel ? decodeURIComponent(tel.slice(4)) : '') || (text.match(PHONE_RE) || [''])[0];
  const mail = $('a[href^="mailto:"]').map((_, a) => $(a).attr('href').slice(7).split('?')[0]).get().find(m => !/info@|enquir|marketing|management|centre|center/i.test(m) || hint.allowGenericEmail) || '';
  const email = clean(node.email) || mail;

  const socials = {}; let website = '';
  const exts = [];
  $('a[href^="http"]').each((_, a) => {
    const h = $(a).attr('href'); if (!h || IGNORE_EXT.test(h) || sameSite(h, pageUrl)) return;
    if ($(a).closest('footer,header').length) return;
    const sm = h.match(SOCIAL);
    if (sm) { const key = sm[1].replace('.com', '').replace('.net', ''); if (!socials[key]) socials[key] = h; return; }
    exts.push({ h, t: clean($(a).text()).toLowerCase() });
  });
  const pref = exts.find(e => /website|visit|shop online|book|order|menu|online/.test(e.t)) || exts[0];
  website = (typeof node.sameAs === 'string' && !SOCIAL.test(node.sameAs) ? node.sameAs : '') || (node.url && !sameSite(node.url, pageUrl) ? node.url : '') || (pref ? pref.h : '');

  let hours = hoursFromLd(node);
  if (!hours.length) hours = hoursFromText(blockText);

  const unit = clean(hint.unit) || clean(node.address && (node.address.streetAddress || '')).match(UNIT_RE)?.[0] || (text.match(UNIT_RE) || [''])[0];
  const level = (clean(node.address && node.address.streetAddress).match(LEVEL_RE) || text.match(LEVEL_RE) || [''])[0];

  let category = '', categorySource = '';
  const catEl = clean($main.find('[class*="categor" i] a, [class*="categor" i], [class*="tag" i] a').first().text());
  if (hint.category) { category = hint.category; categorySource = 'directory'; }
  else if (catEl && catEl.length < 40 && !NAV_WORDS.test(catEl)) { category = catEl; categorySource = 'page'; }
  else if (crumbs && Array.isArray(crumbs.itemListElement) && crumbs.itemListElement.length >= 3) {
    const c = crumbs.itemListElement[crumbs.itemListElement.length - 2]; const t = clean(c.name || c.item?.name);
    if (t && !/^(home|stores?|shops?|brands?|directory)$/i.test(t)) { category = t; categorySource = 'breadcrumb'; }
  }
  if (!category) { const t = typeOf(node); const m = TYPE_CAT.find(([re]) => re.test(t)); if (m) { category = m[1]; categorySource = 'schema'; } }

  const logoLd = typeof node.logo === 'string' ? node.logo : node.logo?.url;
  const imgLd = typeof node.image === 'string' ? node.image : Array.isArray(node.image) ? (typeof node.image[0] === 'string' ? node.image[0] : node.image[0]?.url) : node.image?.url;
  const logoEl = $main.find('img[class*="logo" i], [class*="logo" i] img, img[alt*="logo" i]').first();
  const logo = abs(logoLd || hint.logo || logoEl.attr('data-src') || logoEl.attr('src') || imgLd || og('image') || '', pageUrl) || '';

  return { name, category, categorySource, description: description.slice(0, 600), unit, level, phone: clean(phone), email, website, hours, socials, logo, url: pageUrl };
}

// ---- keyword category fallback, so the map can break brands down even when sites don't label them
const KW = [
  ['Department store', /\b(john lewis|marks (&|and) spencer|m&s|debenhams|house of fraser|fenwick|selfridges|harvey nichols|frasers|beales|tk ?maxx|homesense)\b/i],
  ['Supermarket & convenience', /\b(tesco|sainsbury|asda|morrisons|aldi|lidl|iceland|co-?op|waitrose|spar|farmfoods|heron foods|marks (&|and) spencer food)\b/i],
  ['Food & drink', /\b(caf[eé]|coffee|costa|starbucks|pret|greggs|nando|mcdonald|burger|kfc|subway|pizza|wagamama|five guys|restaurant|kitchen|grill|bar\b|pub\b|bakery|krispy|creams|tea\b|sushi|noodle|taco|chicken|dessert|ice cream|juice|bubble|doughnut|donut|yo! ?sushi|zizzi|ask italian|frankie|wetherspoon|leon\b|itsu|wasabi|tortilla|chopstix|bella italia|harvester|toby carvery|taco bell|popeyes|wingstop)\b/i],
  ['Health & beauty', /\b(boots|superdrug|the body shop|lush|space nk|sephora|mac cosmetics|kiehl|rituals|holland (&|and) barrett|specsavers|vision express|optic|pharmacy|chemist|barber|hair|salon|nails?|beauty|brow|lash|perfume|fragrance shop|the perfume shop|bodycare|savers|clinic|dentist|spa\b)\b/i],
  ['Jewellery & watches', /\b(pandora|h\.? ?samuel|ernest jones|goldsmiths|beaverbrooks|swarovski|warren james|claire'?s|f\.?hinds|watch|jewel|diamond|accessorize|lovisa|links of london|thomas sabo)\b/i],
  ['Technology', /\b(apple|samsung|currys|ee\b|o2\b|vodafone|three|carphone|game\b|cex|computer|phone|mobile|tech|hmv|smiggle|cex)\b/i],
  ['Sports & outdoor', /\b(jd\b|jd sports|sports direct|footasylum|nike|adidas|puma|foot locker|decathlon|go outdoors|mountain warehouse|trespass|regatta|millets|blacks|cotswold outdoor|footlocker|schuh|deichmann|skechers|gym\b|pure gym|the gym|snow)\b/i],
  ['Kids & toys', /\b(the entertainer|smyths|lego|disney store|build-a-bear|mothercare|toys?|kids|baby|early learning|card factory)\b/i],
  ['Home', /\b(next home|dunelm|the range|wilko|b&m|home ?bargains|poundland|poundstretcher|the works|lakeland|robert dyas|ikea|habitat|oliver bonas|t ?k ?maxx|homesense|furniture|bed|sofa|carpet|interiors?|kitchen ?ware|cook|candle|yankee)\b/i],
  ['Books, music & gifts', /\b(waterstones|whsmith|wh smith|the works|clintons|card factory|paperchase|hmv|gift|cards?|book|stationery|hotel chocolat|thorntons|lindt|hobbycraft|flying tiger)\b/i],
  ['Leisure', /\b(cinema|vue|odeon|cineworld|bowling|tenpin|hollywood bowl|arcade|escape|soft play|trampoline|crazy golf|adventure|play|leisure|bingo|casino|gym)\b/i],
  ['Services', /\b(bank|barclays|hsbc|lloyds|natwest|santander|halifax|nationwide|post office|travel|tui|key ?cutting|timpson|repair|dry clean|tailor|alteration|estate agent|bureau|money|vape|nail bar|recruitment|council|library|job ?centre|nhs|doctor|toilet|change ?place)\b/i],
  ['Fashion', /\b(primark|h&m|zara|next\b|river island|new look|topshop|topman|mango|uniqlo|gap\b|monsoon|fat face|white stuff|joules|seasalt|superdry|hollister|abercrombie|jack wills|levi|tommy|calvin|ralph lauren|ted baker|reiss|whistles|hobbs|phase eight|jigsaw|oasis|warehouse|wallis|dorothy perkins|burton|peacocks|matalan|bonmarch|select|quiz|pull ?& ?bear|bershka|stradivarius|ann summers|la senza|boux avenue|clarks|office|kurt geiger|dune|moss|suit|menswear|womenswear|fashion|clothing|shoes?|boutique|outfit|lingerie|denim|tk maxx|sports direct|footwear|accessor)\b/i],
];
export function inferCategory(b) {
  const s = `${b.name} ${b.category || ''} ${(b.description || '').slice(0, 160)}`;
  const m = KW.find(([, re]) => re.test(s));
  return m ? m[0] : '';
}
// Map free-text site categories onto the same small set so the map can compare centres.
export function normaliseCategory(raw) {
  if (!raw) return '';
  const s = raw.toLowerCase();
  const map = [['Food & drink', /food|drink|eat|dine|dining|restaurant|caf|coffee|bar|takeaway/], ['Health & beauty', /health|beauty|pharm|optic|hair|cosmetic|wellbeing|well-being/], ['Fashion', /fashion|cloth|apparel|wear|shoe|footwear|lingerie|accessor/],
    ['Jewellery & watches', /jewel|watch/], ['Technology', /tech|electr|mobile|phone|gaming|computer/], ['Home', /home|interior|furnish|garden|homeware|discount|variety/], ['Kids & toys', /kid|child|toy|baby/], ['Sports & outdoor', /sport|outdoor|fitness/],
    ['Books, music & gifts', /book|music|gift|card|stationery|hobby|craft|confection|sweet|chocolate/], ['Leisure', /leisure|entertain|cinema|bowling|play|activity|attraction/], ['Department store', /department/], ['Supermarket & convenience', /supermarket|grocery|convenience|food store/], ['Services', /service|bank|finance|travel|repair|post|community/]];
  const m = map.find(([, re]) => re.test(s));
  return m ? m[0] : '';
}
