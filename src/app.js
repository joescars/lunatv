const express = require('express');
const path = require('path');
const compression = require('compression');

const hdhr = require('./hdhomerun');
const requestTiming = require('./middleware/requestTiming');
const sameOrigin = require('./middleware/sameOrigin');
const { createAuth } = require('./auth');
const indexRoutes = require('./routes/index');
const channelsRoutes = require('./routes/channels');
const scanRoutes = require('./routes/scan');
const statusRoutes = require('./routes/status');
const guideRoutes = require('./routes/guide');
const watchRoutes = require('./routes/watch');
const recordingsRoutes = require('./routes/recordings');
const apiRoutes = require('./routes/api');

// Builds the Express app without listening so tests can drive the real
// middleware order. `env` only feeds the auth configuration.
function createApp({ env = process.env } = {}) {
  const app = express();
  const ASSET_VERSION = env.ASSET_VERSION || Date.now().toString();
  const auth = createAuth(env);
  app.locals.auth = auth;

  // Set TRUST_PROXY (e.g. `1` or `loopback`) when running behind a reverse
  // proxy so req.ip / req.secure come from X-Forwarded-* (login throttling and
  // Secure session cookies). Never trusts the header otherwise.
  if (env.TRUST_PROXY) {
    const v = env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : (v === 'true' ? true : v));
  }

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(requestTiming);
  app.use(compression());
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    immutable: true,
  }));
  app.use(express.urlencoded({ extended: false }));

  app.locals.deviceSystemLogUrl = `http://${hdhr.HOST}/log.html`;
  app.locals.assetVersion = ASSET_VERSION;
  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    next();
  });

  // The mobile guide (guideRoutes) is the primary client experience, mounted
  // at the root. Device-setup/management pages live under /admin - they're
  // not gone, just no longer the front door (see CHANGELOG for the LunaTV
  // mobile client redesign).
  //
  // Order matters: sameOrigin (CSRF) first, then identify the caller, then
  // login/health routes, then the route-policy gate (src/authPolicy.js) in
  // front of every router.
  app.use(sameOrigin);
  app.use(auth.attach);
  app.use(auth.loginRoutes(express));
  app.use(auth.authorize);
  app.use('/admin', indexRoutes);
  app.use('/admin', channelsRoutes);
  app.use('/admin', scanRoutes);
  app.use('/admin', statusRoutes);
  app.use(guideRoutes);
  app.use(watchRoutes);
  app.use(recordingsRoutes);
  app.use(apiRoutes);
  return app;
}

module.exports = { createApp };
