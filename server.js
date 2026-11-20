const { createApp } = require('./src/app');

const PORT = process.env.PORT || 8080;

let app;
try {
  app = createApp();
} catch (err) {
  console.error(`Invalid authentication configuration: ${err.message}`);
  process.exit(1);
}

for (const warning of app.locals.auth.describe().warnings) console.warn(`[auth] ${warning}`);

const server = app.listen(PORT, () => {
  console.log(`hdhomerun-web listening on port ${PORT} (auth mode: ${app.locals.auth.config.mode})`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
