// CSRF defence for state-changing routes (issue #26). The app has no auth, so
// a cross-site page must not be able to POST to it from a visitor's browser.
// Browsers always attach Origin and/or Sec-Fetch-Site to such requests and
// page scripts cannot forge them; non-browser clients (Roku, curl) send
// neither and are allowed through.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(origin) {
  try { return new URL(origin).host.toLowerCase(); } catch (_) { return null; }
}

function sameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const site = req.get('sec-fetch-site');
  // 'same-site' (e.g. another port on this host) is not trusted on its own;
  // the Origin comparison below decides it.
  if (site === 'cross-site') return reject(res);

  const origin = req.get('origin');
  if (origin !== undefined) {
    const originHost = origin === 'null' ? null : hostOf(origin);
    // X-Forwarded-Host is accepted too so reverse proxies that rewrite Host
    // keep working. A cross-site page cannot set either header.
    const allowed = [req.get('host'), req.get('x-forwarded-host')]
      .filter(Boolean)
      .flatMap(h => h.split(','))
      .map(h => h.trim().toLowerCase());
    if (!originHost || !allowed.includes(originHost)) return reject(res);
  }
  next();
}

function reject(res) {
  res.status(403).type('text/plain').send('Cross-origin request blocked');
}

module.exports = sameOrigin;
