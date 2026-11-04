// Serves a fake ukmalls.co.uk built from real page captures, for offline tests.
const http = require('http'), fs = require('fs'), path = require('path');
const F = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const rows = JSON.parse(F('index-rows.json'));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const indexHtml = '<html><body><div class="entity-list">' + rows.map(([p, n, a, c]) => `<div class="listing-item-container"><a href="https://www.ukmalls.co.uk/shopping-centres/${p}" class="listing-item"><div class="listing-item-content"><div class="listing-badge now-open distance">${c} stores</div><div class="listing-item-inner"><h3>${esc(n)} <i class="versified-icon"></i></h3><span>${esc(a)}</span></div></div></a></div>`).join('\n') + '</div></body></html>';
const kings = F('kings.html'), blue = F('bluewater.html');
const port = +process.argv[2] || 4099;
http.createServer((q, s) => {
  const u = q.url.replace(/\/$/, '');
  if (u === '/shopping-centres') return s.end(indexHtml);
  if (u.endsWith('/kings-mall-shopping-centre')) return s.end(kings);
  if (u.endsWith('/greenhithe/bluewater')) return s.end(blue);
  const m = u.match(/^\/shopping-centres\/(.+)$/); const r = m && rows.find(x => x[0] === m[1]);
  if (r) return s.end(`<html><head><title>${esc(r[1])} - 3 stores</title><script type="application/ld+json">{"@type":"ShoppingCenter","name":${JSON.stringify(r[1])},"address":{"streetAddress":"x","addressLocality":"Town","postalCode":"AB1 2CD"},"telephone":"0123 456789",}</script></head><body><div id="listing-stores"><h2>Store list</h2><ul class="stores-list-new"><li><a href="/shopping-centres/${r[0]}/boots">Boots</a></li><li><a href="/shopping-centres/${r[0]}/costa">Costa</a></li><li><a href="/shopping-centres/${r[0]}/next">Next</a></li></ul></div></body></html>`);
  s.writeHead(404); s.end('nf');
}).listen(port, () => console.log('mock ukmalls on', port));
