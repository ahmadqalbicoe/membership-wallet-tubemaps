# Shopping Malls Tube Map

**Just want to look?** Open `site/index.html` (double-click). Everything works offline.

**Want the "Fetch from UK Malls" buttons?** Run the server (Node 18+):  `cd server && node server.js`  then open http://localhost:4003.

## Tabs

- **Shopping Malls Tube Map:** 504 UK shopping centres (472 original + 32 new from Batch 1; 30 re-researched with units, parking, footfall, anchors, loyalty, app, nearest university and contacts) as a metro network. Each line is a region and each station a council. Click a station to list its centres, then a centre to see all its brands (25,509 brands for 406 centres, from ukmalls.co.uk, 4 Nov 2026). Search any brand to light up every station that has it. 🎓 marks stations with a university or students' union.
- **Ownership and data gaps:** owners, pension fund stakes, missing data.
- **Student benefits:** 230 student schemes (Student Beans, UNiDAYS, TOTUM, SU and university schemes, brand offers, Freshers channels), scored 1–5 for Membership Wallet, plus the census of 133 students' unions. Unions are placed on the map, and the brands a scheme names link to the malls that have them.
- **Retailers & affiliate APIs:** 92 affiliate networks, banks and loyalty platforms, and 682 retailers with their affiliate route (Awin, impact.com, Rakuten, CJ, Partnerize…). Each retailer shows how many mapped centres stock it and which student schemes name it.
- **Offer data sources:** 28 sources for UK retailer details and offers (affiliate networks, card-linked offers, gift cards, location data, Companies House), with a filterable capability matrix, a phased plan, and links to the retailers that use each route. From `UK_Retailer_Offer_Data_Sources.xlsx`.

## Folders

- `site/`: the built map (index.html + brands-data.js)
- `server/`: port-4003 server with the UK Malls brand module and its local database. See `server/README.md`.
- `deploy/`: deploy to 77.68.110.85:4003. See `deploy/README.md`.
- `scraper/`: optional scraper for centres' own websites
- `src/`: page template, data and the source spreadsheets (incl. `Batch_1_progress_40.xlsx`). `master_rows.json` is the merged centre list; `build_layout.py` turns it into `map.json`; `build_site.py` builds `site/index.html`.

Brand lists: the UK Malls records synced on 4 Nov 2026 are kept unchanged. Shops from a centre's own directory (Batch 1) are shown next to them: matching ones get a ✓, extra ones are marked ●.
