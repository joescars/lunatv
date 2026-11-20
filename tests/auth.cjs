'use strict';
// Authentication / authorization / CSRF probes for issue #58. Runs the real
// app (src/app.js) on ephemeral ports with the device, DVR and guide clients
// stubbed, so no tuner, ffmpeg or network is used.
//   npm run test:auth
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lunatv-auth-'));
process.env.HDHOMERUN_HOST = '10.1.2.3';
process.env.RECORD_ENGINE_HOST = '10.9.8.7';
process.env.RECORD_ENGINE_PORT = '80';

const src = (name) => path.join(__dirname, '..', 'src', name);
const hdhr = require(src('hdhomerun.js'));
const record = require(src('hdhomerunRecord.js'));
const guide = require(src('guide.js'));
const { createApp } = require(src('app.js'));
const { requiredLevel } = require(src('authPolicy.js'));
const { hashPassword, verifyPassword } = require(src('auth.js'));

// ---- stubs: record every device-side effect so we can assert none happened.
const effects = [];
const recording = { id: 'abc123', Title: 'T', EpisodeTitle: 'E', Synopsis: '', ChannelNumber: '2.1', ChannelName: 'PBS', recording: true };
hdhr.getDeviceInfo = async () => ({ FriendlyName: 'Stub', ModelNumber: 'X', FirmwareName: 'f', FirmwareVersion: '1', DeviceID: 'D', TunerCount: 2 });
hdhr.getLineup = async () => [];
hdhr.getLineupStatus = async () => ({ ScanInProgress: 0 });
hdhr.getTunerStatus = async () => [];
hdhr.startScan = async () => { effects.push('scan:start'); };
hdhr.abortScan = async () => { effects.push('scan:abort'); };
hdhr.setChannelFlag = async (g, m) => { effects.push(`flag:${g}:${m}`); return {}; };
guide.getGuide = async () => [];
guide.getCurrentProgram = async () => ({ SeriesID: 'S', Title: 'Show', StartTime: 1 });
record.isConfigured = () => true;
record.getRecordings = async () => [];
record.getRecording = async () => recording;
record.recordCurrentAiring = async () => { effects.push('record'); };
record.deleteRecording = async () => { effects.push('delete'); };
record.stopRecording = async () => { effects.push('stoprec'); };

const SECRET = 'x'.repeat(40);
const PW = 'correct horse battery staple';
let adminHash;
let operatorHash;
let viewerHash;
const TOKEN = 'roku-token-' + crypto.randomBytes(8).toString('hex');
const tokenHash = crypto.createHash('sha256').update(TOKEN).digest('hex');
let usersFile;

test.before(async () => {
  [adminHash, operatorHash, viewerHash] = await Promise.all([hashPassword(PW), hashPassword(PW + '-op'), hashPassword(PW + '-view')]);
  usersFile = path.join(process.env.TMPDIR, 'users.json');
  fs.writeFileSync(usersFile, JSON.stringify([
    { username: 'olivia', role: 'operator', passwordHash: operatorHash },
    { username: 'vic', role: 'viewer', passwordHash: viewerHash },
  ]));
});

function baseEnv(extra = {}) {
  return {
    AUTH_ADMIN_PASSWORD_HASH: adminHash,
    AUTH_USERS_FILE: usersFile,
    AUTH_SESSION_SECRET: SECRET,
    AUTH_API_TOKEN_HASH: tokenHash,
    ...extra,
  };
}

async function withApp(env, fn) {
  const app = createApp({ env });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  const call = (method, urlPath, { headers = {}, body, cookie } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : (typeof body === 'string' ? body : new URLSearchParams(body).toString());
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (payload !== undefined) { h['content-type'] = 'application/x-www-form-urlencoded'; h['content-length'] = Buffer.byteLength(payload); }
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: h }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
  const origin = `http://127.0.0.1:${port}`;
  const login = async (username, password) => {
    const res = await call('POST', '/login', { body: { username, password } });
    const set = res.headers['set-cookie'];
    return { res, cookie: set ? set[0].split(';')[0] : null };
  };
  try { return await fn({ call, login, origin, app, port }); } finally { server.close(); }
}

const browserHeaders = (origin) => ({ origin, 'sec-fetch-site': 'same-origin' });
const denied = (res) => res.status === 401 || res.status === 403;
const settled = (res) => !denied(res) && !(res.status === 302 && /\/login/.test(res.headers.location || ''));

const ISSUE_ROUTES = [
  ['GET', '/admin'], ['GET', '/admin/'], ['GET', '/admin/channels'], ['GET', '/admin/scan'], ['GET', '/admin/status'],
  ['POST', '/admin/channels/flag?guide=2.1&mode=%2B'],
  ['POST', '/admin/scan/start'], ['POST', '/admin/scan/abort'],
  ['POST', '/watch/2.1/record'],
  ['POST', '/recordings/abc123/delete'],
  ['POST', '/recordings/abc123/medium/start'], ['POST', '/recordings/abc123/medium/stop'],
  ['POST', '/api/recordings/abc123/delete'], ['POST', '/api/recordings/abc123/stop'],
  ['POST', '/api/channels/2.1/favorite?favorite=1'],
  ['GET', '/recordings'], ['GET', '/recordings/fragment'], ['GET', '/api/recordings'], ['GET', '/stream/metrics'],
];

// ------------------------------------------------------------- policy table
test('policy: every issue #58 route has an explicit non-public level; unknown routes fail closed', () => {
  const expected = {
    'GET /admin': 'admin', 'POST /admin/channels/flag': 'admin', 'POST /admin/scan/start': 'admin', 'POST /ADMIN/scan/abort/': 'admin',
    'POST /watch/2.1/record': 'operator', 'POST /recordings/x/delete': 'operator',
    'POST /api/recordings/x/delete': 'operator', 'POST /api/recordings/x/stop': 'operator',
    'POST /api/channels/2.1/favorite': 'operator',
    'POST /recordings/x/medium/start': 'viewer', 'POST /recordings/x/medium/stop': 'viewer', 'GET /recordings': 'viewer',
    'GET /stream/metrics': 'admin',
    'GET /guide': 'live', 'GET /': 'live', 'GET /watch/2.1': 'live', 'GET /api/guide': 'live',
    'POST /stream/2.1/h264/medium/start': 'live', 'GET /stream/2.1/h264/medium/stream.m3u8': 'live',
    'GET /healthz': 'public',
    'GET /something-new': 'viewer', 'POST /something-new': 'admin', 'DELETE /anything': 'admin',
  };
  for (const [key, level] of Object.entries(expected)) {
    const [method, p] = key.split(' ');
    assert.equal(requiredLevel(method, p), level, key);
  }
});

test('password hashing: scrypt round-trip, wrong password and malformed hashes rejected', async () => {
  const h = await hashPassword('s3cret-passphrase');
  assert.match(h, /^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/);
  assert.equal(await verifyPassword('s3cret-passphrase', h), true);
  assert.equal(await verifyPassword('nope', h), false);
  assert.equal(await verifyPassword('x', 'plaintext'), false);
});

// ------------------------------------------------------ anonymous, session
test('session mode: anonymous callers are rejected on every protected route and nothing runs', async () => {
  effects.length = 0;
  await withApp(baseEnv(), async ({ call, origin }) => {
    for (const [method, url] of ISSUE_ROUTES) {
      // Roku-style (no browser headers) and browser-style (same-origin) alike.
      for (const headers of [{}, browserHeaders(origin)]) {
        const res = await call(method, url, { headers });
        assert.equal(res.status, 401, `${method} ${url} ${JSON.stringify(headers)} -> ${res.status}`);
      }
    }
    assert.deepEqual(effects, [], 'no device/DVR side effect for anonymous callers');

    const nav = await call('GET', '/admin', { headers: { accept: 'text/html' } });
    assert.equal(nav.status, 302);
    assert.equal(nav.headers.location, '/login?next=%2Fadmin');
    const api = await call('POST', '/api/channels/2.1/favorite?favorite=1', { headers: { accept: 'application/json' } });
    assert.equal(api.status, 401);
    assert.match(api.body, /Authentication required/);
    const htmx = await call('POST', '/admin/scan/start', { headers: { 'hx-request': 'true', ...browserHeaders(origin) } });
    assert.equal(htmx.headers['hx-redirect'], '/login?next=%2Fadmin%2Fscan%2Fstart');
  });
});

test('case, trailing-slash and double-slash variants of protected paths do not bypass the gate', async () => {
  effects.length = 0;
  await withApp(baseEnv(), async ({ call }) => {
    for (const url of ['/ADMIN/scan/start', '/Admin/scan/start/', '/admin/SCAN/start', '/WATCH/2.1/RECORD', '/Recordings/abc123/Delete', '//admin/scan/start']) {
      const res = await call('POST', url);
      assert.ok(denied(res) || res.status === 404, `${url} -> ${res.status}`);
      assert.notEqual(res.status, 200, url);
    }
    assert.deepEqual(effects, []);
  });
});

test('public surface stays reachable anonymously: healthz, login page, guide, watch page, /stream playback', async () => {
  await withApp(baseEnv(), async ({ call }) => {
    assert.equal((await call('GET', '/healthz')).status, 200);
    assert.equal((await call('GET', '/login')).status, 200);
    for (const [method, url] of [
      ['GET', '/'], ['GET', '/guide'], ['GET', '/api/guide'], ['GET', '/watch/2.1'],
      ['GET', '/stream/2.1/h264/ready'], ['POST', '/stream/2.1/h264/medium/stop'], ['POST', '/stream/2.1/h264/medium/heartbeat'],
      ['GET', '/stream/2.1/h264/medium/stats'],
    ]) {
      const res = await call(method, url);
      assert.ok(settled(res), `${method} ${url} -> ${res.status}`);
    }
  });
});

test('login form: bad credentials 401 without cookie; good credentials set an HttpOnly SameSite cookie', async () => {
  await withApp(baseEnv(), async ({ login, call }) => {
    let r = await login('admin', 'wrong');
    assert.equal(r.res.status, 401);
    assert.equal(r.cookie, null);
    r = await login('nobody', PW);
    assert.equal(r.res.status, 401);
    r = await login('admin', PW);
    assert.equal(r.res.status, 303);
    assert.equal(r.res.headers.location, '/');
    const setCookie = r.res.headers['set-cookie'][0];
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.doesNotMatch(setCookie, /Secure/, 'plain-HTTP LAN: Secure only when the request is https');
    assert.equal((await call('GET', '/admin', { cookie: r.cookie })).status, 200);

    const secure = await call('POST', '/login', { body: { username: 'admin', password: PW }, headers: { 'x-forwarded-proto': 'https' } });
    assert.doesNotMatch(secure.headers['set-cookie'][0], /Secure/, 'X-Forwarded-Proto ignored unless TRUST_PROXY is set');
  });
  await withApp(baseEnv({ TRUST_PROXY: '1' }), async ({ call }) => {
    const res = await call('POST', '/login', { body: { username: 'admin', password: PW }, headers: { 'x-forwarded-proto': 'https' } });
    assert.match(res.headers['set-cookie'][0], /Secure/);
  });
  await withApp(baseEnv({ AUTH_COOKIE_SECURE: '1' }), async ({ call }) => {
    const res = await call('POST', '/login', { body: { username: 'admin', password: PW } });
    assert.match(res.headers['set-cookie'][0], /Secure/);
  });
});

test('login: open-redirect "next" values are neutralised', async () => {
  await withApp(baseEnv(), async ({ call }) => {
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '/login', '']) {
      const res = await call('POST', '/login', { body: { username: 'admin', password: PW, next } });
      assert.equal(res.status, 303);
      assert.equal(res.headers.location, '/', next);
    }
    const ok = await call('POST', '/login', { body: { username: 'admin', password: PW, next: '/admin/scan' } });
    assert.equal(ok.headers.location, '/admin/scan');
  });
});

test('login: repeated failures from one address are throttled (429), correct password still checked after window only', async () => {
  await withApp(baseEnv(), async ({ call }) => {
    for (let i = 0; i < 10; i += 1) assert.equal((await call('POST', '/login', { body: { username: 'admin', password: 'bad' + i } })).status, 401);
    assert.equal((await call('POST', '/login', { body: { username: 'admin', password: PW } })).status, 429);
  });
});

// ------------------------------------------------------------------- roles
test('roles: admin may do everything; operator no /admin; viewer only reads recordings/live', async () => {
  effects.length = 0;
  await withApp(baseEnv(), async ({ call, login, origin }) => {
    const h = browserHeaders(origin);
    const admin = (await login('admin', PW)).cookie;
    const operator = (await login('olivia', PW + '-op')).cookie;
    const viewer = (await login('vic', PW + '-view')).cookie;
    assert.ok(admin && operator && viewer);

    const adminOnly = [['GET', '/admin'], ['POST', '/admin/scan/start'], ['POST', '/admin/scan/abort'], ['POST', '/admin/channels/flag?guide=2.1&mode=%2B'], ['GET', '/stream/metrics']];
    const operatorUp = [['POST', '/watch/2.1/record'], ['POST', '/recordings/abc123/delete'], ['POST', '/api/recordings/abc123/delete'], ['POST', '/api/recordings/abc123/stop'], ['POST', '/api/channels/2.1/favorite?favorite=1']];
    const viewerUp = [['GET', '/recordings'], ['GET', '/recordings/fragment'], ['GET', '/api/recordings']];

    for (const [m, u] of adminOnly) {
      assert.ok(settled(await call(m, u, { cookie: admin, headers: h })), `admin ${m} ${u}`);
      assert.equal((await call(m, u, { cookie: operator, headers: h })).status, 403, `operator ${m} ${u}`);
      assert.equal((await call(m, u, { cookie: viewer, headers: h })).status, 403, `viewer ${m} ${u}`);
    }
    for (const [m, u] of operatorUp) {
      assert.ok(settled(await call(m, u, { cookie: admin, headers: h })), `admin ${m} ${u}`);
      assert.ok(settled(await call(m, u, { cookie: operator, headers: h })), `operator ${m} ${u}`);
      assert.equal((await call(m, u, { cookie: viewer, headers: h })).status, 403, `viewer ${m} ${u}`);
    }
    for (const [m, u] of viewerUp) {
      assert.ok(settled(await call(m, u, { cookie: viewer, headers: h })), `viewer ${m} ${u}`);
    }
    // Recording playback transcodes: viewers allowed, anonymous not (checked above).
    assert.ok(settled(await call('POST', '/recordings/abc123/medium/stop', { cookie: viewer, headers: h })));
  });
  assert.ok(effects.includes('scan:start') && effects.includes('record') && effects.includes('delete') && effects.includes('stoprec'));
  assert.ok(effects.includes('flag:2.1:+'));
});

// -------------------------------------------------------------------- CSRF
test('CSRF: cookie-authenticated mutations need a same-origin Origin/Sec-Fetch-Site; cross-site is rejected', async () => {
  effects.length = 0;
  await withApp(baseEnv(), async ({ call, login, origin }) => {
    const { cookie } = await login('admin', PW);
    const url = '/admin/scan/start';
    // sameOrigin(): wrong Origin, "null" Origin, cross-site fetch metadata.
    for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { origin, 'sec-fetch-site': 'cross-site' }]) {
      assert.equal((await call('POST', url, { cookie, headers })).status, 403, JSON.stringify(headers));
    }
    // sameOrigin() lets header-less clients through (Roku); with an ambient
    // cookie that is not enough - a browser must positively say same-origin.
    assert.equal((await call('POST', url, { cookie })).status, 403, 'cookie + no Origin/Sec-Fetch-Site');
    assert.equal((await call('POST', url, { cookie, headers: { 'sec-fetch-site': 'same-site' } })).status, 403, 'same-site is not same-origin');
    assert.deepEqual(effects, []);
    assert.ok(settled(await call('POST', url, { cookie, headers: { origin } })));
    assert.ok(settled(await call('POST', url, { cookie, headers: { 'sec-fetch-site': 'same-origin' } })));
    assert.deepEqual(effects, ['scan:start', 'scan:start']);
    // Login CSRF defence: cross-origin login POST is rejected before auth.
    assert.equal((await call('POST', '/login', { body: { username: 'admin', password: PW }, headers: { origin: 'https://evil.example' } })).status, 403);
  });
});

// ----------------------------------------------------- tokens (Roku client)
test('Roku compatibility: bearer token works without browser headers; scoped by role; wrong token rejected', async () => {
  effects.length = 0;
  await withApp(baseEnv(), async ({ call }) => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    // operator token (default): favorite + record + recording delete/stop work with NO Origin header.
    assert.ok(settled(await call('POST', '/api/channels/2.1/favorite?favorite=1', { headers: auth })));
    assert.ok(settled(await call('POST', '/watch/2.1/record', { headers: auth })));
    assert.ok(settled(await call('POST', '/recordings/abc123/delete', { headers: auth })));
    assert.ok(settled(await call('POST', '/recordings/abc123/medium/stop', { headers: auth })));
    assert.ok(settled(await call('GET', '/recordings', { headers: auth })));
    // ...but it is not an admin credential.
    assert.equal((await call('POST', '/admin/scan/start', { headers: auth })).status, 403);
    assert.equal((await call('GET', '/stream/metrics', { headers: auth })).status, 403);
    // Wrong / malformed tokens.
    for (const authorization of ['Bearer nope', `Basic ${TOKEN}`, `Bearer ${TOKEN}x`, 'Bearer']) {
      assert.equal((await call('POST', '/api/channels/2.1/favorite?favorite=1', { headers: { authorization } })).status, 401, authorization);
    }
    // A token does not make a cross-site browser request acceptable.
    assert.equal((await call('POST', '/api/channels/2.1/favorite?favorite=1', { headers: { ...auth, origin: 'https://evil.example' } })).status, 403);
  });
  assert.deepEqual(effects.filter((e) => e === 'scan:start'), []);
  await withApp(baseEnv({ AUTH_API_TOKEN_ROLE: 'viewer' }), async ({ call }) => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    assert.ok(settled(await call('GET', '/recordings', { headers: auth })));
    assert.equal((await call('POST', '/api/channels/2.1/favorite?favorite=1', { headers: auth })).status, 403);
  });
});

test('anonymous Roku (no token) keeps working for live TV: guide + stream handshake endpoints are not blocked', async () => {
  await withApp(baseEnv(), async ({ call }) => {
    // Roku sends no Origin/Sec-Fetch headers; sameOrigin lets it through and live is public.
    for (const [m, u] of [['GET', '/api/guide?hours=4'], ['GET', '/stream/2.1/h264/medium/ready'], ['POST', '/stream/2.1/h264/medium/stop'], ['GET', '/stream/2.1/h264/medium/stats'], ['GET', '/']]) {
      assert.ok(settled(await call(m, u)), `${m} ${u}`);
    }
    // Roku POST /start must reach the handler (400/500 from the stub-less stream layer is fine; 401/403 is not).
    const start = await call('POST', '/stream/not-a-channel/h264/medium/start');
    assert.ok(!denied(start), `start -> ${start.status}`);
  });
});

test('AUTH_PUBLIC_LIVE=0: live playback needs a session or token (Roku sends its token)', async () => {
  await withApp(baseEnv({ AUTH_PUBLIC_LIVE: '0', AUTH_API_TOKEN_ROLE: 'viewer' }), async ({ call, login }) => {
    for (const [m, u] of [['GET', '/'], ['GET', '/stream/2.1/h264/ready'], ['POST', '/stream/2.1/h264/medium/stop'], ['GET', '/api/guide']]) {
      assert.equal((await call(m, u)).status, 401, `${m} ${u}`);
    }
    assert.ok(settled(await call('GET', '/stream/2.1/h264/ready', { headers: { authorization: `Bearer ${TOKEN}` } })));
    assert.ok(settled(await call('POST', '/stream/2.1/h264/medium/stop', { headers: { authorization: `Bearer ${TOKEN}` } })));
    const { cookie } = await login('vic', PW + '-view');
    assert.ok(settled(await call('GET', '/guide', { cookie })));
    assert.equal((await call('GET', '/healthz')).status, 200);
  });
});

// ---------------------------------------------------------------- sessions
test('sessions: tampered, expired and revoked cookies are rejected; logout clears', async () => {
  await withApp(baseEnv(), async ({ call, login }) => {
    const { cookie } = await login('admin', PW);
    const [name, value] = [cookie.split('=')[0], cookie.slice(cookie.indexOf('=') + 1)];
    const [body, sig] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'admin', f: 'x', e: Date.now() + 1e9 })).toString('base64url');
    for (const bad of [`${name}=${body}.AAAA`, `${name}=${forged}.${sig}`, `${name}=garbage`, `${name}=`]) {
      assert.equal((await call('GET', '/admin', { cookie: bad })).status, 401, bad);
    }
    const out = await call('POST', '/logout', { cookie, headers: { origin: `http://127.0.0.1` } });
    assert.equal(out.status, 403, 'logout is CSRF-protected too (wrong origin port)');
  });

  // Expired
  const realNow = Date.now;
  await withApp(baseEnv({ AUTH_SESSION_TTL_HOURS: '1' }), async ({ call, login }) => {
    const { cookie } = await login('admin', PW);
    assert.equal((await call('GET', '/admin', { cookie })).status, 200);
    Date.now = () => realNow() + 2 * 3600 * 1000;
    try { assert.equal((await call('GET', '/admin', { cookie })).status, 401); } finally { Date.now = realNow; }
  });

  // Revoked: same secret, but the account's password hash was rotated / role changed / user removed.
  let cookie;
  await withApp(baseEnv(), async ({ login }) => { cookie = (await login('olivia', PW + '-op')).cookie; });
  const rotated = path.join(process.env.TMPDIR, 'users-rotated.json');
  fs.writeFileSync(rotated, JSON.stringify([{ username: 'olivia', role: 'operator', passwordHash: await hashPassword('another passphrase!') }]));
  await withApp(baseEnv({ AUTH_USERS_FILE: rotated }), async ({ call }) => {
    assert.equal((await call('GET', '/recordings', { cookie })).status, 401, 'password rotation revokes sessions');
  });
  await withApp(baseEnv({ AUTH_USERS_FILE: '' }), async ({ call }) => {
    assert.equal((await call('GET', '/recordings', { cookie })).status, 401, 'removed user');
  });

  // Logout
  await withApp(baseEnv(), async ({ call, login, origin }) => {
    const l = await login('admin', PW);
    const out = await call('POST', '/logout', { cookie: l.cookie, headers: { origin } });
    assert.equal(out.status, 303);
    assert.match(out.headers['set-cookie'][0], /Max-Age=0/);
  });
});

// ------------------------------------------------------------- fail closed
test('no credentials configured: protected routes unreachable, live TV and healthz still work; sign-in reports it', async () => {
  const app = createApp({ env: { AUTH_SESSION_SECRET: SECRET } });
  assert.match(app.locals.auth.describe().warnings.join(' '), /No users or API token/);
  await withApp({ AUTH_SESSION_SECRET: SECRET }, async ({ call }) => {
    for (const [m, u] of ISSUE_ROUTES) assert.equal((await call(m, u)).status, 401, `${m} ${u}`);
    assert.equal((await call('GET', '/healthz')).status, 200);
    assert.ok(settled(await call('GET', '/guide')));
    const login = await call('GET', '/login');
    assert.match(login.body, /No users are configured/);
    assert.equal((await call('POST', '/login', { body: { username: 'admin', password: 'x' } })).status, 401);
  });
});

test('misconfiguration fails at startup instead of silently opening or breaking auth', () => {
  assert.throws(() => createApp({ env: { AUTH_MODE: 'basic' } }), /AUTH_MODE/);
  assert.throws(() => createApp({ env: { AUTH_ADMIN_PASSWORD_HASH: 'plaintext' } }), /scrypt hash/);
  assert.throws(() => createApp({ env: { AUTH_API_TOKEN_HASH: 'not-hex' } }), /sha256/);
  assert.throws(() => createApp({ env: { AUTH_API_TOKEN_HASH: tokenHash, AUTH_API_TOKEN_ROLE: 'root' } }), /AUTH_API_TOKEN_ROLE/);
  assert.throws(() => createApp({ env: { AUTH_MODE: 'proxy' } }), /AUTH_PROXY_SECRET/);
  assert.throws(() => createApp({ env: { AUTH_MODE: 'proxy', AUTH_PROXY_SECRET: 'short' } }), /AUTH_PROXY_SECRET/);
});

// ------------------------------------------------------------ proxy mode
test('proxy mode: identity headers are trusted only with the shared secret; roles from allow-lists', async () => {
  effects.length = 0;
  const env = { AUTH_MODE: 'proxy', AUTH_PROXY_SECRET: 'p'.repeat(24), AUTH_PROXY_ADMINS: 'Alice', AUTH_PROXY_OPERATORS: 'bob', AUTH_API_TOKEN_HASH: tokenHash };
  const secretHeader = { 'x-lunatv-proxy-secret': 'p'.repeat(24) };
  await withApp(env, async ({ call, origin }) => {
    const same = browserHeaders(origin);
    // Forged identity without the secret, or with a wrong one: anonymous.
    assert.equal((await call('POST', '/admin/scan/start', { headers: { 'x-forwarded-user': 'alice', ...same } })).status, 401);
    assert.equal((await call('POST', '/admin/scan/start', { headers: { 'x-forwarded-user': 'alice', 'x-lunatv-proxy-secret': 'wrong', ...same } })).status, 401);
    assert.deepEqual(effects, []);
    // Secret but no user header: anonymous.
    assert.equal((await call('GET', '/admin', { headers: secretHeader })).status, 401);
    // Role mapping (case-insensitive usernames).
    const as = (user, extra = {}) => ({ headers: { ...secretHeader, 'x-forwarded-user': user, ...same, ...extra } });
    assert.ok(settled(await call('POST', '/admin/scan/start', as('ALICE'))));
    assert.equal((await call('POST', '/admin/scan/start', as('bob'))).status, 403);
    assert.ok(settled(await call('POST', '/watch/2.1/record', as('bob'))));
    assert.equal((await call('POST', '/watch/2.1/record', as('carol'))).status, 403, 'default role viewer');
    assert.ok(settled(await call('GET', '/recordings', as('carol'))));
    // CSRF still applies to proxy-authenticated browsers.
    assert.equal((await call('POST', '/admin/scan/start', { headers: { ...secretHeader, 'x-forwarded-user': 'alice' } })).status, 403);
    assert.equal((await call('POST', '/admin/scan/start', { headers: { ...secretHeader, 'x-forwarded-user': 'alice', origin: 'https://evil.example' } })).status, 403);
    // Bearer tokens still work for Roku behind the proxy; /login is inert.
    assert.ok(settled(await call('POST', '/api/channels/2.1/favorite?favorite=1', { headers: { authorization: `Bearer ${TOKEN}` } })));
    assert.equal((await call('GET', '/login')).status, 302);
  });
});

// ------------------------------------------------------------------- off
test('AUTH_MODE=off is an explicit opt-out: everything reachable, startup warns', async () => {
  const app = createApp({ env: { AUTH_MODE: 'off' } });
  assert.match(app.locals.auth.describe().warnings.join(' '), /AUTH_MODE=off/);
  await withApp({ AUTH_MODE: 'off' }, async ({ call, origin }) => {
    assert.ok(settled(await call('POST', '/admin/scan/start', { headers: browserHeaders(origin) })));
    assert.ok(settled(await call('GET', '/admin')));
    // sameOrigin remains in force.
    assert.equal((await call('POST', '/admin/scan/start', { headers: { origin: 'https://evil.example' } })).status, 403);
  });
});

test('auth setup script emits values the server accepts, and never plaintext', () => {
  const { spawnSync } = require('node:child_process');
  const script = path.join(__dirname, '..', 'scripts', 'auth-setup.js');
  const pw = spawnSync('node', [script, 'password'], { input: 'a long enough passphrase\n', encoding: 'utf8' });
  assert.equal(pw.status, 0, pw.stderr);
  assert.match(pw.stdout, /^AUTH_ADMIN_PASSWORD_HASH=scrypt:/);
  assert.doesNotMatch(pw.stdout + pw.stderr, /long enough passphrase/);
  const tok = spawnSync('node', [script, 'token'], { encoding: 'utf8' });
  const hash = /AUTH_API_TOKEN_HASH=([0-9a-f]{64})/.exec(tok.stdout)[1];
  const plain = /\n {2}(\S+)\n/.exec(tok.stderr)[1];
  assert.equal(crypto.createHash('sha256').update(plain).digest('hex'), hash);
  assert.doesNotMatch(tok.stdout, new RegExp(plain));
  const env = { AUTH_ADMIN_PASSWORD_HASH: /=(.*)$/.exec(pw.stdout.trim())[1], AUTH_API_TOKEN_HASH: hash };
  assert.doesNotThrow(() => createApp({ env }));
  const weak = spawnSync('node', [script, 'password'], { input: 'short\n', encoding: 'utf8' });
  assert.notEqual(weak.status, 0);
});
