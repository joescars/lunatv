'use strict';
// Route -> required access level (issue #58). One table, deny by default:
// anything not listed needs `viewer` for reads and `admin` for writes, so a
// route added later without an entry fails closed instead of open.
//
// Levels, lowest to highest:
//   live      guide + live /stream playback. Anonymous unless AUTH_PUBLIC_LIVE=0
//   viewer    any signed-in user / valid API token: recordings (list, playback)
//   operator  change DVR or tuner favorites state: record, stop/delete
//             recordings, favorite a channel
//   admin     /admin/* (channel flags, scans, status) and /stream/metrics
//
// Matching is case-insensitive with an optional trailing slash because Express
// routing is (a request for /ADMIN/scan/start still reaches the admin router).
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const SEG = '[^/]+';
const rules = [
  { re: /^\/healthz\/?$/i, level: 'public' },
  { re: /^\/admin(?:\/|$)/i, level: 'admin' },
  { re: /^\/stream\/metrics\/?$/i, level: 'admin' },
  { re: /^\/stream\//i, level: 'live' },
  { methods: ['POST'], re: new RegExp(`^/recordings/${SEG}/delete/?$`, 'i'), level: 'operator' },
  { methods: ['POST'], re: new RegExp(`^/api/recordings/${SEG}/(?:delete|stop)/?$`, 'i'), level: 'operator' },
  { methods: ['POST'], re: new RegExp(`^/watch/${SEG}/record/?$`, 'i'), level: 'operator' },
  { methods: ['POST'], re: new RegExp(`^/api/channels/${SEG}/favorite/?$`, 'i'), level: 'operator' },
  // Everything else under recordings, including playback start/stop (they
  // spawn/stop an ffmpeg transcode of DVR content): any authenticated caller.
  { re: /^\/(?:api\/)?recordings(?:\/|$)/i, level: 'viewer' },
  { methods: ['GET', 'HEAD'], re: /^\/(?:guide(?:\/(?:fragment|grid))?)?\/?$/i, level: 'live' },
  { methods: ['GET', 'HEAD'], re: /^\/api\/guide\/?$/i, level: 'live' },
  { methods: ['GET', 'HEAD'], re: new RegExp(`^/watch/${SEG}/?$`, 'i'), level: 'live' },
];

function requiredLevel(method, path) {
  const m = String(method || 'GET').toUpperCase();
  for (const rule of rules) {
    if (rule.methods && !rule.methods.includes(m)) continue;
    if (rule.re.test(path)) return rule.level;
  }
  return SAFE_METHODS.has(m) ? 'viewer' : 'admin';
}

module.exports = { requiredLevel, SAFE_METHODS };
