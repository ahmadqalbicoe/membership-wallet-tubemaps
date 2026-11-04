// Polite HTTP helpers: timeouts, retries, robots.txt, per-host pacing.
export const UA = process.env.SCRAPER_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 UKShoppingCentreMap/1.0';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lastHit = new Map();
const robotsCache = new Map();

export async function pace(url, gapMs) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) || 0) + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

export async function fetchText(url, { timeout = 20000, retries = 2, gapMs = 700, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } = {}) {
  let err;
  for (let i = 0; i <= retries; i++) {
    await pace(url, gapMs);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept, 'accept-language': 'en-GB,en;q=0.9' }, redirect: 'follow', signal: ctl.signal });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) { err = new Error('HTTP ' + res.status); await sleep(1500 * (i + 1)); continue; }
      const text = await res.text();
      return { ok: res.ok, status: res.status, url: res.url, text, type: res.headers.get('content-type') || '' };
    } catch (e) { clearTimeout(t); err = e; await sleep(800 * (i + 1)); }
  }
  return { ok: false, status: 0, url, text: '', error: String(err && err.message || err) };
}

// Minimal robots.txt support for "User-agent: *" groups.
export async function allowedByRobots(url, opts = {}) {
  if (opts.ignoreRobots) return true;
  const u = new URL(url);
  const key = u.origin;
  if (!robotsCache.has(key)) {
    const r = await fetchText(key + '/robots.txt', { retries: 0, timeout: 8000, accept: 'text/plain,*/*' });
    const rules = [], sitemaps = [];
    if (r.ok && !/<html/i.test(r.text)) {
      let applies = false, lastWasUA = false;
      for (const raw of r.text.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
        if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'sitemap') { sitemaps.push(v); continue; }
        if (k === 'user-agent') { applies = lastWasUA ? applies || v === '*' : v === '*'; lastWasUA = true; continue; }
        lastWasUA = false;
        if (applies && (k === 'disallow' || k === 'allow') && v) rules.push({ allow: k === 'allow', path: v });
      }
    }
    robotsCache.set(key, { rules, sitemaps });
  }
  const { rules } = robotsCache.get(key);
  const path = u.pathname + u.search;
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length)) best = r;
  }
  return !best || best.allow;
}

export async function robotsSitemaps(origin, opts) {
  await allowedByRobots(origin + '/', opts);
  return robotsCache.get(origin)?.sitemaps || [];
}
