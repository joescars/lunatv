'use strict';
// Authentication + role-based authorization (issue #58).
//
//   AUTH_MODE=session (default)  built-in login form + signed session cookie
//   AUTH_MODE=proxy              a reverse proxy authenticates; this app trusts
//                                identity headers only when they arrive with a
//                                shared secret header
//   AUTH_MODE=off                explicit opt-out for a fully trusted network
//
// In every mode except `off`, a bearer API token (for the Roku client, which
// cannot do a browser login) is also accepted. See docs/authentication.md.
//
// Nothing here is a default credential: with no users or token configured every
// protected route is simply unreachable (fail closed).
const crypto = require('crypto');
const fs = require('fs');
const { promisify } = require('util');
const { requiredLevel, SAFE_METHODS } = require('./authPolicy');

const scrypt = promisify(crypto.scrypt);
const ROLES = ['viewer', 'operator', 'admin'];
const RANK = { anonymous: 0, viewer: 1, operator: 2, admin: 3 };
const COOKIE = 'lunatv_session';
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

// ------------------------------------------------------------ password hashes
// Format: scrypt:N:r:p:<salt b64url>:<hash b64url>  (no `$`, so it is safe in
// Docker Compose .env files, which interpolate `$`)
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join(':');
}

function parseHash(stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, N, r, p, salt, hash] = parts;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every((n) => Number.isInteger(n) && n > 0)) return null;
  if (params.N > 1 << 20 || params.N & (params.N - 1)) return null;
  return { params, salt: Buffer.from(salt, 'base64url'), hash: Buffer.from(hash, 'base64url') };
}

async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const key = await scrypt(password, parsed.salt, parsed.hash.length, {
    ...parsed.params, maxmem: 256 * 1024 * 1024,
  });
  return key.length === parsed.hash.length && crypto.timingSafeEqual(key, parsed.hash);
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

// ------------------------------------------------------------------- config
function readSecret(env, name) {
  const file = env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, 'utf8').trim();
  return (env[name] || '').trim();
}

function list(value) {
  return String(value || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function loadConfig(env) {
  const mode = (env.AUTH_MODE || 'session').trim().toLowerCase();
  if (!['session', 'proxy', 'off'].includes(mode)) {
    throw new Error(`AUTH_MODE must be session, proxy or off (got "${env.AUTH_MODE}")`);
  }
  const cfg = {
    mode,
    publicLive: !['0', 'false', 'no'].includes(String(env.AUTH_PUBLIC_LIVE || '1').toLowerCase()),
    users: new Map(),
    apiToken: null,
    sessionTtlMs: Math.max(0.1, Number(env.AUTH_SESSION_TTL_HOURS || 12) || 12) * 3600 * 1000,
    cookieSecure: String(env.AUTH_COOKIE_SECURE || 'auto').toLowerCase(),
    sessionSecret: readSecret(env, 'AUTH_SESSION_SECRET') || crypto.randomBytes(32).toString('hex'),
    ephemeralSecret: !readSecret(env, 'AUTH_SESSION_SECRET'),
    proxy: null,
  };
  if (mode === 'off') return cfg;

  const addUser = (username, role, passwordHash) => {
    if (!username || /[\s:]/.test(username)) throw new Error(`Invalid auth username "${username}"`);
    if (!ROLES.includes(role)) throw new Error(`Invalid role "${role}" for ${username} (use ${ROLES.join('|')})`);
    if (!parseHash(passwordHash)) throw new Error(`Password hash for ${username} is not a scrypt hash (use scripts/auth-setup.js)`);
    cfg.users.set(username.toLowerCase(), { username, role, passwordHash });
  };

  if (mode === 'session') {
    const adminHash = readSecret(env, 'AUTH_ADMIN_PASSWORD_HASH');
    if (adminHash) addUser((env.AUTH_ADMIN_USERNAME || 'admin').trim(), 'admin', adminHash);
    if (env.AUTH_USERS_FILE) {
      const entries = JSON.parse(fs.readFileSync(env.AUTH_USERS_FILE, 'utf8'));
      if (!Array.isArray(entries)) throw new Error('AUTH_USERS_FILE must contain a JSON array');
      for (const e of entries) addUser(String(e.username || ''), e.role, e.passwordHash);
    }
  }

  if (mode === 'proxy') {
    const secret = readSecret(env, 'AUTH_PROXY_SECRET');
    if (secret.length < 16) throw new Error('AUTH_MODE=proxy requires AUTH_PROXY_SECRET (16+ chars) so identity headers cannot be forged by direct clients');
    const defaultRole = (env.AUTH_PROXY_DEFAULT_ROLE || 'viewer').toLowerCase();
    if (!ROLES.includes(defaultRole)) throw new Error('AUTH_PROXY_DEFAULT_ROLE must be viewer, operator or admin');
    cfg.proxy = {
      secret,
      secretHeader: (env.AUTH_PROXY_SECRET_HEADER || 'x-lunatv-proxy-secret').toLowerCase(),
      userHeader: (env.AUTH_PROXY_USER_HEADER || 'x-forwarded-user').toLowerCase(),
      admins: new Set(list(env.AUTH_PROXY_ADMINS)),
      operators: new Set(list(env.AUTH_PROXY_OPERATORS)),
      defaultRole,
    };
  }

  const tokenHash = readSecret(env, 'AUTH_API_TOKEN_HASH').toLowerCase();
  if (tokenHash) {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error('AUTH_API_TOKEN_HASH must be a 64-char hex sha256 (use scripts/auth-setup.js token)');
    const role = (env.AUTH_API_TOKEN_ROLE || 'operator').toLowerCase();
    if (!ROLES.includes(role)) throw new Error('AUTH_API_TOKEN_ROLE must be viewer, operator or admin');
    cfg.apiToken = { hash: Buffer.from(tokenHash, 'hex'), role };
  }
  return cfg;
}

// ------------------------------------------------------------------ cookies
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function createAuth(env = process.env) {
  const cfg = loadConfig(env);
  const failures = new Map();
  // Constant-cost miss path so unknown usernames don't answer faster.
  const dummyHash = cfg.users.size ? [...cfg.users.values()][0].passwordHash : null;

  const fingerprint = (user) => sha256(user.passwordHash).toString('hex').slice(0, 12);
  const sign = (body) => crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest('base64url');

  function makeSession(user) {
    const body = Buffer.from(JSON.stringify({ u: user.username, f: fingerprint(user), e: Date.now() + cfg.sessionTtlMs })).toString('base64url');
    return `${body}.${sign(body)}`;
  }

  function readSession(req) {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    if (!raw) return null;
    const [body, sig] = raw.split('.');
    if (!body || !sig) return null;
    const expected = sign(body);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    let data;
    try { data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return null; }
    if (!data || typeof data.e !== 'number' || data.e < Date.now()) return null;
    // Re-resolve the user on every request: removing the user, changing their
    // role or rotating their password hash revokes outstanding sessions.
    const user = cfg.users.get(String(data.u || '').toLowerCase());
    if (!user || data.f !== fingerprint(user)) return null;
    return { user: user.username, role: user.role, via: 'session' };
  }

  function bearer(req) {
    if (!cfg.apiToken) return null;
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    if (!crypto.timingSafeEqual(sha256(m[1]), cfg.apiToken.hash)) return null;
    return { user: 'api-token', role: cfg.apiToken.role, via: 'token' };
  }

  function proxyIdentity(req) {
    const p = cfg.proxy;
    if (!p) return null;
    const secret = req.headers[p.secretHeader];
    if (typeof secret !== 'string' || !safeEqual(secret, p.secret)) return null;
    const user = req.headers[p.userHeader];
    if (typeof user !== 'string' || !user.trim()) return null;
    const name = user.trim();
    const key = name.toLowerCase();
    const role = p.admins.has(key) ? 'admin' : (p.operators.has(key) ? 'operator' : p.defaultRole);
    return { user: name, role, via: 'proxy' };
  }

  function identify(req) {
    if (cfg.mode === 'off') return { user: 'anonymous', role: 'admin', via: 'off' };
    return bearer(req)
      || (cfg.mode === 'proxy' ? proxyIdentity(req) : readSession(req))
      || { user: null, role: 'anonymous', via: null };
  }

  // Cookie/proxy credentials are sent by the browser on its own, so they need
  // CSRF protection on top of sameOrigin(): the request must positively say it
  // is same-origin. Browsers always send Origin on POST; bearer tokens are
  // explicit headers and exempt, which is what keeps Roku (no Origin) working.
  function ambientCsrfOk(req) {
    if (req.get('origin') !== undefined) return true; // value checked by sameOrigin()
    return req.get('sec-fetch-site') === 'same-origin';
  }

  function wantsHtml(req) {
    return req.method === 'GET' && !req.get('hx-request') && /text\/html/i.test(req.get('accept') || '');
  }

  function deny(req, res, status, message) {
    res.set('Cache-Control', 'no-store');
    const loginUrl = `/login?next=${encodeURIComponent(req.originalUrl)}`;
    if (status === 401 && cfg.mode === 'session') {
      if (wantsHtml(req)) return res.redirect(302, loginUrl);
      if (req.get('hx-request')) res.set('HX-Redirect', loginUrl);
      res.set('WWW-Authenticate', 'Bearer realm="LunaTV"');
    }
    const asJson = /^\/api\//i.test(req.path) || /application\/json/i.test(req.get('accept') || '');
    if (asJson) return res.status(status).json({ error: message });
    return res.status(status).type('text/plain').send(message);
  }

  function attach(req, res, next) {
    req.auth = identify(req);
    res.locals.auth = {
      mode: cfg.mode,
      user: req.auth.user,
      role: req.auth.role,
      canSignIn: cfg.mode === 'session',
      canSignOut: req.auth.via === 'session',
    };
    next();
  }

  function authorize(req, res, next) {
    const level = requiredLevel(req.method, req.path);
    if (level === 'public') return next();
    const { role, via } = req.auth;
    if (!SAFE_METHODS.has(req.method) && (via === 'session' || via === 'proxy') && !ambientCsrfOk(req)) {
      return deny(req, res, 403, 'Cross-origin request blocked');
    }
    if (level === 'live') {
      if (cfg.publicLive || RANK[role] >= RANK.viewer) return next();
      return deny(req, res, 401, 'Authentication required');
    }
    if (RANK[role] >= RANK[level]) return next();
    return role === 'anonymous'
      ? deny(req, res, 401, 'Authentication required')
      : deny(req, res, 403, 'Insufficient permissions');
  }

  // ----------------------------------------------------------- login routes
  const safeNext = (value) => (typeof value === 'string' && /^\/(?![/\\])/.test(value) && !/^\/(login|logout)(\/|\?|$)/i.test(value) ? value : '/');

  function cookieSecure(req) {
    if (cfg.cookieSecure === '1' || cfg.cookieSecure === 'true') return true;
    if (cfg.cookieSecure === '0' || cfg.cookieSecure === 'false') return false;
    return req.secure; // honours TRUST_PROXY + X-Forwarded-Proto
  }

  function setCookie(req, res, value, maxAgeMs) {
    res.append('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${cookieSecure(req) ? '; Secure' : ''}`);
  }

  function throttled(ip) {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.first > LOGIN_WINDOW_MS) { failures.delete(ip); return false; }
    return entry.count >= LOGIN_MAX_FAILURES;
  }

  function recordFailure(ip) {
    const entry = failures.get(ip);
    if (entry && Date.now() - entry.first <= LOGIN_WINDOW_MS) entry.count += 1;
    else {
      if (failures.size > 10000) failures.clear();
      failures.set(ip, { first: Date.now(), count: 1 });
    }
  }

  function renderLogin(res, status, message, next) {
    res.status(status).set('Cache-Control', 'no-store').render('login', {
      error: message, next: safeNext(next), configured: cfg.users.size > 0,
    });
  }

  function loginRoutes(express) {
    const router = express.Router();
    router.get('/login', (req, res) => {
      if (cfg.mode !== 'session') return res.redirect(302, '/');
      if (req.auth.via === 'session') return res.redirect(302, safeNext(req.query.next));
      return renderLogin(res, 200, null, req.query.next);
    });
    router.post('/login', async (req, res, next) => {
      if (cfg.mode !== 'session') return res.redirect(302, '/');
      try {
        const { username = '', password = '' } = req.body || {};
        if (throttled(req.ip)) return renderLogin(res, 429, 'Too many failed sign-in attempts. Try again later.', req.body && req.body.next);
        const user = cfg.users.get(String(username).trim().toLowerCase());
        const ok = await verifyPassword(String(password), user ? user.passwordHash : dummyHash);
        if (!user || !ok) {
          recordFailure(req.ip);
          return renderLogin(res, 401, 'Incorrect username or password.', req.body && req.body.next);
        }
        failures.delete(req.ip);
        setCookie(req, res, makeSession(user), cfg.sessionTtlMs);
        return res.redirect(303, safeNext(req.body && req.body.next));
      } catch (err) { return next(err); }
    });
    router.post('/logout', (req, res) => {
      setCookie(req, res, '', 0);
      res.redirect(303, cfg.mode === 'session' ? '/login' : '/');
    });
    router.get('/healthz', (req, res) => res.json({ ok: true }));
    return router;
  }

  function describe() {
    const warnings = [];
    if (cfg.mode === 'off') warnings.push('AUTH_MODE=off: admin and mutation routes are open to anyone who can reach this port.');
    if (cfg.mode === 'session' && cfg.users.size === 0 && !cfg.apiToken) {
      warnings.push('No users or API token configured: sign-in is disabled and admin/recording routes are unreachable. Run `node scripts/auth-setup.js` (see docs/authentication.md).');
    }
    if (cfg.mode === 'session' && cfg.users.size && cfg.ephemeralSecret) {
      warnings.push('AUTH_SESSION_SECRET is not set: sessions are invalidated on every restart.');
    }
    return { mode: cfg.mode, users: cfg.users.size, apiToken: Boolean(cfg.apiToken), publicLive: cfg.publicLive, warnings };
  }

  return { config: cfg, attach, authorize, loginRoutes, describe, identify };
}

module.exports = { createAuth, hashPassword, verifyPassword, ROLES };
