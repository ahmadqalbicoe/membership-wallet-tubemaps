#!/usr/bin/env bash
# macOS / Linux: uploads the map + brand server and starts it on port 4003.
# Usage:  ./deploy/deploy.sh root            (user name; default root)
#         SEED_DB=1 ./deploy/deploy.sh root  (also uploads server/data/db.json, replacing the server's database)
set -euo pipefail
USER_NAME="${1:-root}"; SERVER="${SERVER:-77.68.110.85}"; DIR="${DIR:-/opt/uk-shopping-tube-map}"; PORT="${PORT:-4003}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$USER_NAME@$SERVER"
ssh "$T" "mkdir -p $DIR/site $DIR/server/lib $DIR/server/data"
scp -r "$ROOT"/site/* "$T:$DIR/site/"
scp "$ROOT"/server/{server.js,sync-cli.js,centres.json,package.json,ecosystem.config.cjs} "$T:$DIR/server/"
scp "$ROOT"/server/lib/*.js "$T:$DIR/server/lib/"
# the brand database lives on the server: only uploaded the first time (or with SEED_DB=1)
if [ "${SEED_DB:-}" = "1" ] || [ "$(ssh "$T" "test -f $DIR/server/data/db.json && echo yes || echo no")" = "no" ]; then
  [ -f "$ROOT/server/data/db.json" ] && scp "$ROOT/server/data/db.json" "$T:$DIR/server/data/db.json"
fi
ssh "$T" "cd $DIR/server && (command -v pm2 >/dev/null || npm i -g pm2) && PORT=$PORT pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save && (command -v ufw >/dev/null && ufw allow $PORT/tcp >/dev/null || true)"
echo "Done: http://$SERVER:$PORT"
