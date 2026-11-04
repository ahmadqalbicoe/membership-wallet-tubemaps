#!/usr/bin/env node
// Copies the scraped brands into the tube map site folder as brands.json.
// Usage: node publish.js [path-to-site-folder]   (default: ../site)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(process.argv[2] || path.join(DIR, '..', 'site'));
const src = JSON.parse(await fs.readFile(path.join(DIR, 'output', 'brands.json'), 'utf8'));
for (const c of Object.values(src.centres)) c.brands = c.brands.map(({ url, ...b }) => ({ ...b, url, socials: Object.keys(b.socials || {}).length ? b.socials : undefined }));
await fs.mkdir(site, { recursive: true });
await fs.writeFile(path.join(site, 'brands.json'), JSON.stringify(src));
console.log(`Wrote ${path.join(site, 'brands.json')}: ${src.summary.brands} brands across ${src.summary.ok} centres. Deploy the site folder (index.html, brands.json, netlify.toml) to Netlify.`);
