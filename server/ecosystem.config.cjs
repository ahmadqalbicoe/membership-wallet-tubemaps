// pm2 start ecosystem.config.cjs   -> keeps the map running on port 4003 and restarts it after reboots (pm2 save; pm2 startup)
module.exports = { apps: [{ name: 'uk-shopping-tube-map', script: 'server.js', cwd: __dirname, env: { PORT: 4003, HOST: '0.0.0.0' } }] };
