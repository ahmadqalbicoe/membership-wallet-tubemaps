// Finding a centre's store directory: home page links, common paths and sitemaps.
import * as cheerio from 'cheerio';
import { fetchText, allowedByRobots, robotsSitemaps } from './http.js';
import { storePathInfo, extractListing, slugToName, clean, sameSite, dedupe } from './extract.js';

const LINK_WORDS = /(store|shop)s?\s*(directory|guide|a\s*-?\s*z|list)|^(stores|shops|brands|retailers|directory|our stores|our shops|all stores|all shops|shopping|shop|store finder|a-z|a to z|what'?s here)$|eat\s*(&|and)\s*drink|food\s*(&|and)\s*drink|^dine|restaurants/i;
const COMMON_PATHS = ['/stores', '/shops', '/store-directory', '/shop-directory', '/directory', '/brands', '/stores-a-z', '/shopping', '/retailers', '/our-stores', '/eat-drink', '/food-and-drink', '/en/stores', '/shopping/stores'];

let browser = null;
export async function getBrowser() {
  if (!browser) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}
export async function closeBrowser() { if (browser) await browser.close(); browser = null; }

// Render a page with a real browser: wait for scripts, scroll lazy lists, press "load more".
export async function renderPage(url, { timeout = 35000, loadMore = 40, ua } = {}) {
  const b = await getBrowser();
  const ctx = await b.newContext({ userAgent: ua, locale: 'en-GB', viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => ['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    // Privacy first: only press "reject" / "necessary only" style buttons; content is read from the DOM either way.
    await page.locator('button:visible, a[role="button"]:visible').filter({ hasText: /^(reject( all)?|decline( all)?|necessary (cookies )?only|only (necessary|essential)|use necessary cookies only)$/i }).first().click({ timeout: 1500 }).catch(() => {});
    let lastH = 0;
    for (let i = 0; i < loadMore; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(500);
      const btn = page.locator('button:visible, a:visible').filter({ hasText: /^\s*(load|show|view|see)\s+more(\s+(stores|shops|brands|results))?\s*$/i }).first();
      if (await btn.count()) { await btn.click({ timeout: 2500 }).catch(() => {}); await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); continue; }
      const h = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
      if (h === lastH) break; lastH = h;
    }
    return { ok: !!resp && resp.status() < 400, status: resp ? resp.status() : 0, url: page.url(), html: await page.content() };
  } catch (e) {
    return { ok: false, status: 0, url, html: '', error: String(e.message || e).split('\n')[0] };
  } finally { await ctx.close(); }
}

export function directoryLinks(html, base) {
  const $ = cheerio.load(html);
  const scored = new Map();
  $('a[href]').each((_, a) => {
    let href; try { href = new URL($(a).attr('href'), base).href.replace(/#.*$/, ''); } catch { return; }
    if (!sameSite(href, base)) return;
    const t = clean($(a).text() || $(a).attr('aria-label') || '');
    const path = new URL(href).pathname.toLowerCase();
    let s = 0;
    if (LINK_WORDS.test(t)) s += 5;
    if (/\/(stores|shops|brands|store-directory|shop-directory|directory|retailers|stores-a-z|our-stores)\/?$/.test(path)) s += 4;
    if (/\/(eat|food|dine|dining|restaurants|eat-drink|eat-and-drink|food-and-drink|food-drink)\/?$/.test(path)) s += 2;
    if (s) scored.set(href, Math.max(scored.get(href) || 0, s));
  });
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
}

async function sitemapUrls(origin, opts) {
  const roots = new Set([...(await robotsSitemaps(origin, opts)), origin + '/sitemap.xml', origin + '/sitemap_index.xml', origin + '/wp-sitemap.xml']);
  const queue = [...roots], seen = new Set(), urls = [];
  while (queue.length && seen.size < 25) {
    const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm);
    const r = await fetchText(sm, { retries: 0, timeout: 15000, accept: 'application/xml,text/xml,*/*' });
    if (!r.ok || !/<(urlset|sitemapindex)/i.test(r.text)) continue;
    const locs = [...r.text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/gi)].map(m => m[1].trim());
    if (/<sitemapindex/i.test(r.text)) {
      // look at store-ish child sitemaps first
      locs.sort((a, b) => (/(store|shop|brand|retail|tenant|directory|outlet|page)/i.test(b) ? 1 : 0) - (/(store|shop|brand|retail|tenant|directory|outlet|page)/i.test(a) ? 1 : 0));
      queue.push(...locs.slice(0, 20));
    } else urls.push(...locs);
  }
  return urls;
}

// Returns { directoryUrl, method, stores:[{name,url,category,logo,unit}], tried:[] }
export async function discoverStores(centre, opts = {}) {
  const start = centre.directoryUrl || centre.url;
  const origin = new URL(start).origin;
  const tried = [];
  let best = { stores: [], directoryUrl: '', method: '' };
  const consider = (stores, directoryUrl, method) => { if (stores.length > best.stores.length) best = { stores, directoryUrl, method }; };

  if (!(await allowedByRobots(start, opts))) return { ...best, blocked: true, tried };

  // 1) the given URL (it may already be the directory)
  const home = await renderPage(start, opts);
  tried.push({ url: start, status: home.status, error: home.error });
  if (!home.ok && !home.html) return { ...best, unreachable: true, error: home.error || 'HTTP ' + home.status, tried };
  consider(extractListing(home.html, home.url), home.url, 'start page');

  // 2) directory candidates: linked from home page, then common paths
  if (!centre.directoryUrl) {
    const cands = [...new Set([...directoryLinks(home.html, home.url).slice(0, 6), ...COMMON_PATHS.map(p => origin + p)])];
    for (const c of cands) {
      if (best.stores.length >= 8 && /directory/.test(best.method) && tried.length >= 2) break;
      if (!(await allowedByRobots(c, opts))) continue;
      // quick existence check with plain HTTP before paying for a browser render
      const head = await fetchText(c, { retries: 0, timeout: 12000 });
      if (!head.ok) { tried.push({ url: c, status: head.status }); continue; }
      const quick = extractListing(head.text, head.url);
      consider(quick, head.url, 'directory (html)');
      const r = await renderPage(head.url, opts);
      tried.push({ url: head.url, status: r.status, error: r.error });
      if (r.html) consider(extractListing(r.html, r.url), r.url, 'directory (rendered)');
    }
  }

  // 3) sitemap: store detail URLs listed directly
  if (best.stores.length < 15) {
    const urls = await sitemapUrls(origin, opts).catch(() => []);
    const groups = new Map();
    for (const u of urls) { const info = storePathInfo(u, origin); if (!info) continue; if (!groups.has(info.prefix)) groups.set(info.prefix, []); groups.get(info.prefix).push(u); }
    const top = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (top && top[1].length >= 5) consider(dedupe(top[1].map(u => ({ name: slugToName(u), url: u, source: 'sitemap', nameFromSlug: true }))), origin + top[0], 'sitemap');
  }
  return { ...best, tried };
}
