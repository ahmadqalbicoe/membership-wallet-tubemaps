import http from 'node:http';
const page=(t,b,head='')=>`<!doctype html><html><head><title>${t}</title>${head}</head><body><header><nav><a href="/">Home</a><a href="/store-directory">Store Directory</a><a href="/parking">Parking</a></nav></header><main>${b}</main><footer><a href="https://facebook.com/centreA">fb</a></footer></body></html>`;
const A=['Primark','Boots','Costa Coffee','JD Sports','Pandora','Waterstones','Five Guys','Next','The Entertainer','Superdrug','Greggs','H&M'];
const sl=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-');
// Site A: server-rendered directory + plain HTML store pages
const siteA=(u)=>{
 if(u=='/')return page('Centre A',`<h1>Welcome</h1><a href="/store-directory">Shop directory</a>`);
 if(u=='/store-directory')return page('Stores | Centre A','<h1>Stores</h1><ul>'+A.map((n,i)=>`<li class="card"><a href="/stores/${sl(n)}"><img src="/logo/${sl(n)}.png" alt="${n} logo"><h3>${n}</h3></a><span class="category">${i%3?'Fashion':'Food & Drink'}</span></li>`).join('')+'</ul><a href="/stores/all">View all</a>');
 const m=u.match(/^\/stores\/(.+)$/);if(m){const n=A.find(x=>sl(x)==m[1]);if(!n)return null;
  return page(`${n} | Centre A`,`<h1>${n}</h1><p>${n} is a much loved brand offering great products for the whole family, found in the heart of Centre A shopping.</p><h2>Opening hours</h2><ul><li>Monday</li><li>9am - 6pm</li><li>Tuesday 9am - 6pm</li><li>Wednesday 9:00 - 18:00</li><li>Sunday Closed</li></ul><p>Find us: Unit 12, Upper Mall</p><a href="tel:01234 567890">Call</a><a href="https://www.${sl(n)}.co.uk/">Visit website</a><a href="https://instagram.com/${sl(n)}">ig</a>`,`<meta name="description" content="${n} at Centre A">`)}
 return null};
// Site B: JS-rendered list with load more; LD+JSON store pages rendered by JS
const B=Array.from({length:30},(_,i)=>'Brand '+String.fromCharCode(65+i%26)+(i>25?'2':''));
const siteB=(u)=>{
 if(u=='/')return page('Centre B','<p>Hi</p><a href="/shops">Shops</a>');
 if(u=='/api/stores.json')return JSON.stringify(B.map(n=>({name:n,slug:'/shops/'+sl(n)})));
 if(u=='/shops')return page('Shops','<div id="list"></div><button id="more">Load more</button><script>let all=[],n=10;fetch("/api/stores.json").then(r=>r.json()).then(j=>{all=j;draw()});function draw(){document.getElementById("list").innerHTML=all.slice(0,n).map(s=>`<div class="tile"><a href="${s.slug}">${s.name}</a></div>`).join("");if(n>=all.length)document.getElementById("more").remove()}document.getElementById("more").onclick=()=>{n+=10;draw()}</script>');
 const m=u.match(/^\/shops\/(.+)$/);if(m){const n=B.find(x=>sl(x)==m[1]);if(!n)return null;
  const ld={"@context":"https://schema.org","@type":"ClothingStore","name":n,"telephone":"020 7946 0000","openingHoursSpecification":[{"dayOfWeek":["Monday","Tuesday"],"opens":"09:00","closes":"20:00"}],"address":{"streetAddress":"Unit 4B, Level 1"}};
  return page(n+' – Centre B','<div id="app"></div><script>document.getElementById("app").innerHTML="<h1>'+n+'</h1><p>Rendered by JavaScript with a long enough description for the extractor to pick.</p>"</script>','<script type="application/ld+json">'+JSON.stringify(ld)+'</script>')}
 return null};
// Site C: no links, only sitemap index -> stores; robots disallows one store
const C=['Apple','Lush','Vue Cinema','Nando\'s','Clarks','Lego'];
const siteC=(u)=>{
 if(u=='/')return page('Centre C','<p>Nothing linked here</p>');
 if(u=='/robots.txt')return 'User-agent: *\nDisallow: /retailers/lego\nSitemap: http://localhost:8003/sitemap_index.xml';
 if(u=='/sitemap_index.xml')return '<?xml version="1.0"?><sitemapindex><sitemap><loc>http://localhost:8003/sitemap-pages.xml</loc></sitemap><sitemap><loc>http://localhost:8003/sitemap-retailers.xml</loc></sitemap></sitemapindex>';
 if(u=='/sitemap-pages.xml')return '<?xml version="1.0"?><urlset><url><loc>http://localhost:8003/about</loc></url></urlset>';
 if(u=='/sitemap-retailers.xml')return '<?xml version="1.0"?><urlset>'+C.map(n=>`<url><loc>http://localhost:8003/retailers/${sl(n)}</loc></url>`).join('')+'</urlset>';
 const m=u.match(/^\/retailers\/(.+)$/);if(m){const n=C.find(x=>sl(x)==m[1]);if(!n)return null;return page(`${n} | Centre C`,`<h1>${n}</h1><div class="store-category"><a href="#">Technology</a></div><p>Opening Times</p><p>Mon - Sat: 10am - 8pm</p><p>Sun: 11am - 5pm</p><p>Ground Floor, Unit 7</p>`)}
 return null};
for(const [port,fn] of [[8001,siteA],[8002,siteB],[8003,siteC]]){
 http.createServer((q,s)=>{const u=q.url.split('?')[0].replace(/\/$/,'')||'/';const b=fn(u);if(b==null){s.writeHead(404);s.end('nf');return}
  s.writeHead(200,{'content-type':u.endsWith('.json')?'application/json':u.endsWith('.xml')?'application/xml':u.endsWith('.txt')?'text/plain':'text/html'});s.end(b)}).listen(port);}
console.log('mock up');
