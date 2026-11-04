# Tube map server: site + UK Malls brands + local database

`node server.js` serves the map on port 4003 (`PORT` to change) and adds a brand module that reads ukmalls.co.uk.

## How the UK Malls module works

1. **Centre list:** `https://www.ukmalls.co.uk/shopping-centres` lists every centre on the site (953 in Nov 2026) with its address, postcode and store count.
2. **Matching:** each of the map's 472 centres is matched to a UK Malls centre by name, town and postcode (`lib/ukmalls.js`, `matchCentres`).
   - **high / medium** confidence: linked automatically (388 in Nov 2026)
   - **low**: kept as a *suggestion*. The mall panel shows "Possible UK Malls match: … ✓ Yes, use this / Other options / Not on UK Malls".
   - **none**: "Find on UK Malls" lists the closest centres and has a search box, so you can pick one by hand.
   - Manual choices are never overwritten by automatic matching.
3. **Brands:** for each linked centre the module reads the `Store list` on its UK Malls page (`#listing-stores`). It saves the brand names, links to the brand pages, and the centre's phone number, opening hours, website and address. Each brand is put into one of 13 groups (Fashion, Food & drink …) by name.
4. **brands.json:** the map loads `/brands.json`, which the server builds from the database. If the website scraper's `site/brands.json` exists, both are merged: the website's richer entries come first, and UK Malls fills in brands the website didn't list.

Requests go one at a time, 1.1 s apart (`UKMALLS_GAP_MS`). `robots.txt` on ukmalls.co.uk allows these pages. A full run takes about 7 minutes; centres fetched in the last 24 hours are skipped unless you force it.

## Local database

`data/db.json` is a single JSON file, written atomically (temp file + rename). It holds:

- `index`: the UK Malls centre list
- `matches`: one entry per map centre (`path`, `confidence`, `status` linked/suggested/none, `source` auto/manual)
- `centres`: per UK Malls page: `info` (phone, hours, website, address) and `stores`
- `runs`: the last 30 sync runs

Back it up by copying the file. Delete it to start over.

## API

| Method | Path | Token | |
|---|---|---|---|
| GET | `/brands.json` | – | brands for the map |
| GET | `/api/ukmalls/status` | – | progress, counts, last run |
| GET | `/api/ukmalls/candidates?centre=…&q=…` | – | closest UK Malls centres / text search |
| POST | `/api/ukmalls/sync` `{}` / `{centre}` / `{refreshIndex, rematch, force}` | ✓ | start a sync |
| POST | `/api/ukmalls/stop` | ✓ | stop after the current centre |
| POST | `/api/ukmalls/link` `{centre, path}` / `{centre, path:null}` | ✓ | confirm a match / mark not on UK Malls |

The token goes in the `x-admin-token` header (see `data/admin-token.txt`, or set `ADMIN_TOKEN`).

## Files

- `server.js`: HTTP server and API
- `lib/ukmalls.js`: fetching, parsing, brand groups, matching
- `lib/sync.js`: the sync job and the brands.json builder
- `lib/db.js`: the JSON database
- `sync-cli.js`: same sync from the command line
- `centres.json`: the map's 472 centres (name, town, local authority, postcode)
- `test/`: a fake ukmalls.co.uk built from real page captures (`node test/mock-ukmalls.js`, then run the server with `UKMALLS_BASE=http://localhost:4099`)
