# Deploying to http://77.68.110.85:4003

The server needs **Node.js 18 or newer** (it uses the built-in `fetch`). There are no npm packages to install; `pm2` is installed automatically if it's missing.

**Windows (PowerShell), from the project folder:**

    .\deploy\deploy.ps1 -User root

**macOS / Linux:**

    ./deploy/deploy.sh root

Replace `root` with your SSH user. You'll be asked for its password unless you use an SSH key.

What the script does:

- copies `site/` and `server/` to `/opt/uk-shopping-tube-map`
- uploads `server/data/db.json` (the brand database) **only the first time**, so brands you fetch on the server later are never overwritten. Use `-SeedDb` / `SEED_DB=1` to replace it on purpose.
- starts the app on port 4003 with pm2 (`pm2 logs uk-shopping-tube-map` shows the log)
- opens port 4003 if the server uses `ufw`
- prints the **admin token**

## The admin token

The "Fetch all brands from UK Malls", "Refresh", "Yes, use this" and "Not on UK Malls" buttons change the database, so they need the token. The map asks for it the first time you press one, and the browser remembers it.

The token is created on first start in `server/data/admin-token.txt`. You can use your own instead: set `ADMIN_TOKEN=...` in `ecosystem.config.cjs` (`env`).

## Updating

Run the deploy script again. Your database and token stay as they are.

## Running it on your own computer

    cd server
    node server.js          # http://localhost:4003

## Command line / cron

    cd /opt/uk-shopping-tube-map/server
    node sync-cli.js                      # fetch centres not fetched in the last 24 h
    node sync-cli.js --force              # re-fetch everything
    node sync-cli.js --refresh-index --rematch
    node sync-cli.js --centre "Kings Mall"

Stop the app first (`pm2 stop uk-shopping-tube-map`) or use the buttons instead, because both write the same database file.
