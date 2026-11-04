# Windows (PowerShell): uploads the map + brand server and starts it on port 4003.
# Usage:  .\deploy\deploy.ps1 -User root            (asks for your SSH password, or uses your SSH key)
#         .\deploy\deploy.ps1 -User root -SeedDb    (also uploads server\data\db.json, replacing the server's database)
param([string]$User = "root", [string]$Server = "77.68.110.85", [string]$Dir = "/opt/uk-shopping-tube-map", [int]$Port = 4003, [switch]$SeedDb)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = "$User@$Server"
Write-Host "Preparing $Dir on $Server ..."
ssh $target "mkdir -p $Dir/site $Dir/server/lib $Dir/server/data"
Write-Host "Uploading the site ..."
scp -r "$root\site\*" "${target}:$Dir/site/"
Write-Host "Uploading the server ..."
scp "$root\server\server.js" "$root\server\sync-cli.js" "$root\server\centres.json" "$root\server\package.json" "$root\server\ecosystem.config.cjs" "${target}:$Dir/server/"
scp "$root\server\lib\*.js" "${target}:$Dir/server/lib/"
# The brand database lives on the server. It is only uploaded the first time (or with -SeedDb), so brands fetched there are kept.
$hasDb = ssh $target "test -f $Dir/server/data/db.json && echo yes || echo no"
if ($SeedDb -or ($hasDb.Trim() -eq "no")) {
  if (Test-Path "$root\server\data\db.json") { Write-Host "Uploading the brand database ..."; scp "$root\server\data\db.json" "${target}:$Dir/server/data/db.json" }
}
Write-Host "Starting on port $Port ..."
ssh $target "cd $Dir/server && (command -v pm2 >/dev/null || npm i -g pm2) && PORT=$Port pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save && (command -v ufw >/dev/null && ufw allow $Port/tcp >/dev/null || true); sleep 2; echo; echo Admin token for the Fetch brands buttons:; cat data/admin-token.txt"
Write-Host "Done: http://${Server}:$Port"
