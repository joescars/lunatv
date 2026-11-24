const express = require('express');
const path = require('path');
const compression = require('compression');

// Fail fast on a mistyped HW_ACCEL before any stream module loads; otherwise
// it would only surface as encoder failures at playback time (docs/adr/0001).
const { describeTranscoding, HwAccelConfigError } = require('./src/hwAccel');
let transcoding;
try {
  transcoding = describeTranscoding();
} catch (err) {
  if (!(err instanceof HwAccelConfigError)) throw err;
  console.error(`[config] ${err.message}`);
  process.exit(1);
}

const hdhr = require('./src/hdhomerun');
const requestTiming = require('./src/middleware/requestTiming');
const sameOrigin = require('./src/middleware/sameOrigin');
const indexRoutes = require('./src/routes/index');
const channelsRoutes = require('./src/routes/channels');
const scanRoutes = require('./src/routes/scan');
const statusRoutes = require('./src/routes/status');
const guideRoutes = require('./src/routes/guide');
const watchRoutes = require('./src/routes/watch');
const recordingsRoutes = require('./src/routes/recordings');
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 8080;
const ASSET_VERSION = process.env.ASSET_VERSION || Date.now().toString();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(requestTiming);
app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  etag: true,
  lastModified: true,
  immutable: true,
}));
app.use(express.urlencoded({ extended: false }));

app.locals.deviceSystemLogUrl = `http://${hdhr.HOST}/log.html`;
app.locals.assetVersion = ASSET_VERSION;
app.locals.transcoding = transcoding;
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// The mobile guide (guideRoutes) is the primary client experience, mounted
// at the root. Device-setup/management pages live under /admin - they're
// not gone, just no longer the front door (see CHANGELOG for the LunaTV
// mobile client redesign).
app.use(sameOrigin);
app.use('/admin', indexRoutes);
app.use('/admin', channelsRoutes);
app.use('/admin', scanRoutes);
app.use('/admin', statusRoutes);
app.use(guideRoutes);
app.use(watchRoutes);
app.use(recordingsRoutes);
app.use(apiRoutes);

const server = app.listen(PORT, () => {
  console.log(`hdhomerun-web listening on port ${PORT}`);
  console.log(`[transcode] ${transcoding.summary} (HW_ACCEL=${transcoding.hwAccel}, STREAM_DECODE_MODE=${transcoding.decodeMode}, encoders ${transcoding.encoders.h264}/${transcoding.encoders.hevc})`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
