# UK shopping centre brand scraper

Visits the website of every shopping centre in `centres.json`, finds its store directory, collects every brand, then opens each brand's page for its details. The results go into the tube map: each station shows its centres' brands, and the index gets a Brands tab.

## Quick start (Windows, macOS or Linux, Node 18+)

```bash
cd scraper
npm run setup        # installs cheerio + Playwright and downloads Chromium (one time)
npm test             # runs against 3 fake mall sites; should print "TEST PASSED"
npm run scrape       # scrapes every centre (takes a while; safe to stop and restart)
npm run publish-site # copies output/brands.json into ../site for the map
```

Then upload the `site` folder (index.html, brands.json, netlify.toml) to Netlify as before.

**Roman Urdu mein:** `npm run setup` ek dafa, phir `npm test` (TEST PASSED aana chahiye), phir `npm run scrape`, aur aakhir mein `npm run publish-site`. Uske baad `site` folder Netlify par drag kar dein.

## What it collects per brand

| Field | Where it comes from |
|---|---|
| name | directory card, page heading, schema.org data |
| category, group | site category / breadcrumb / schema.org type; `group` maps it onto 13 standard groups (Fashion, Food & drink, Health & beauty …), guessed from the name when the site has no category (`groupInferred: true`) |
| unit, level | "Unit 12", "Upper Mall", "Ground Floor" … |
| hours | schema.org opening hours, or the opening-times block on the page |
| phone, email | `tel:` / `mailto:` links, UK phone pattern |
| website, socials | brand's own site link; Facebook, Instagram, X, TikTok … |
| logo, description | logo image / og:image; schema.org description, first paragraph or meta description |
| url | the brand's page on the centre site |

## How it finds the brands

1. Opens the centre site in headless Chromium (handles JavaScript sites, scrolls and presses "Load more").
2. Looks for the directory: links like "Stores", "Shop directory", "A–Z", "Eat & drink", then common paths (`/stores`, `/shops`, `/directory` …).
3. Reads the brand list from the page links, schema.org lists or the site's embedded JSON (Next.js and similar).
4. If that finds little, reads the sitemap for `/stores/…`-style pages.
5. Visits each brand page (plain HTML first, real browser only when the page needs JavaScript).

It respects `robots.txt`, waits 0.7 s between requests to the same site, and only presses "reject" or "necessary only" on cookie banners.

## Centres it can't scrape yet

The spreadsheet has 204 website links, but only **71** point at a centre's own site (65 centre sites + 6 McArthurGlen outlets). The other **133** link to a directory index (ukmalls, shopping-centers.co.uk, malls.com) or an article (Savills, Landsec …). Those centres come out as `needs_url`.

To include them, add the real site to `overrides.json`:

```json
{
  "Highcross Leicester": { "url": "https://www.highcrossleicester.com/" },
  "Some Centre": { "url": "https://example.co.uk/", "directoryUrl": "https://example.co.uk/our-stores" },
  "Centre to leave out": { "skip": true }
}
```

`overrides.example.json` already lists all 133 names with empty URLs.

To get suggestions automatically: `npm run discover` searches the web for each centre's official site and writes `overrides.suggested.json`. **Check these before you use them**, then copy the right ones into `overrides.json`.

If a centre returns `no_directory_found`, open its site, find the page that lists all stores, and put it in `directoryUrl`.

## Options

```
node scrape.js --only "trafford,bluewater"   # some centres (name contains)
node scrape.js --limit 10                    # first 10 centres
node scrape.js --no-details                  # brand names only, much faster
node scrape.js --force                       # re-scrape even if cached
node scrape.js --concurrency 3               # centres in parallel (default 3)
node scrape.js --max-stores 500              # cap per centre (default 500)
node scrape.js --delay 700                   # ms between requests to one site
```

Results are cached per centre in `output/centres/`, so a stopped run carries on where it left off. Only successful centres are cached; failed ones are tried again next time.

## Output

- `output/brands.json`: everything, grouped by centre (this is what the map reads)
- `output/brands.csv`: one row per brand, opens in Excel
- `output/report.csv`: one row per centre with its status (`ok`, `needs_url`, `no_directory_found`, `unreachable`, `blocked_by_robots`, `skipped`) and a note

## Notes

- Every centre site is built differently. The generic rules cover the usual patterns, but some sites will need a `directoryUrl`, and a few may block automated visits. `report.csv` shows which ones.
- Brand details depend on what each centre publishes: many show only name, category and unit.
- Use the data in line with each website's terms of use.
