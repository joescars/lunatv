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

const { createApp } = require('./src/app');
const PORT = process.env.PORT || 8080;

let app;
try {
  app = createApp({ transcoding });
} catch (err) {
  console.error(`Invalid authentication configuration: ${err.message}`);
  process.exit(1);
}

for (const warning of app.locals.auth.describe().warnings) console.warn(`[auth] ${warning}`);

const server = app.listen(PORT, () => {
  console.log(`hdhomerun-web listening on port ${PORT} (auth mode: ${app.locals.auth.config.mode})`);
  console.log(`[transcode] ${transcoding.summary} (HW_ACCEL=${transcoding.hwAccel}, STREAM_DECODE_MODE=${transcoding.decodeMode}, encoders ${transcoding.encoders.h264}/${transcoding.encoders.hevc})`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
