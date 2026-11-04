# UK shopping centres tube map

**Just want to look?** Open `site/index.html` (double-click). Brands come from `site/brands-data.js`: 25,509 brands for 406 centres, read from ukmalls.co.uk on 4 Nov 2026.

**Want the "Fetch from UK Malls" buttons?** Run the server (Node 18+):  `cd server && node server.js`  then open http://localhost:4003. The buttons only appear when the page is served by this server.

- `site/`: the map. Click a station to list its centres, then a centre to see all its brands.
- `server/`: serves the map on port 4003 and runs the UK Malls brand module with its local database (`server/data/db.json`). After every sync it also rewrites `site/brands-data.js`. See `server/README.md`.
- `deploy/`: one-command deploy to 77.68.110.85:4003. See `deploy/README.md`.
- `scraper/`: optional scraper for centres' own websites. Its results are merged in automatically.
