import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const fixture = fork('tests/ui-fixture.cjs', [], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let logs = '';
fixture.stdout.on('data', data => { logs += data; });
fixture.stderr.on('data', data => { logs += data; });
const origin = `http://127.0.0.1:${port}`;
const screenshots = process.env.UI_SCREENSHOTS || '.impeccable/review';
await mkdir(screenshots, { recursive: true });
let browser;
const failures = [];
async function scenario(value) {
  const reply = once(fixture, 'message');
  fixture.send({ scenario: value });
  await reply;
}
async function check(name, fn) {
  try { await fn(); console.log('PASS', name); }
  catch (error) { failures.push({ name, error: error.message }); console.error('FAIL', name, error.message); }
}
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(origin)).ok) break; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
    if (i === 49) throw new Error('Fixture failed to start: ' + logs);
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  async function goto(route) {
    await page.goto(origin + route);
    await page.waitForFunction(() => !!customElements.get('md-filled-button'));
    if (route === '/guide' || route === '/') await page.waitForSelector('.guide-item');
    if (route === '/recordings') await page.waitForSelector('#recordings-content .card');
    await page.evaluate(() => document.fonts.ready);
  }
  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const device = viewport.width === 390 ? 'mobile' : 'desktop';
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(origin);
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      for (const route of ['/guide', '/guide/grid', '/admin', '/admin/channels', '/admin/scan', '/admin/status', '/recordings', '/watch/2.1', '/recordings/abcdef/watch']) {
        await check(`${theme}/${device} ${route}`, async () => {
          await goto(route);
          assert.equal(await page.locator('html').getAttribute('data-bs-theme'), theme);
          assert.ok(await page.locator('h1').count(), 'Page needs a primary heading');
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
          assert.equal(overflow, false, 'Document overflow; grid scrolling must stay contained');
          const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          assert.deepEqual(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
        });
        const name = route.replaceAll('/', '-').replace(/^-/, '');
        await page.screenshot({ path: path.join(screenshots, `${device}-${theme}-${name}.png`), fullPage: true });
        if (theme === 'light' && route === '/guide') await page.screenshot({ path: path.join(screenshots, `${device}.png`), fullPage: true });
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await check('Guide search, favorites, hidden channels, clear and cross-view persistence', async () => {
    await goto('/guide');
    assert.equal(await page.locator('.guide-item:visible').count(), 9);
    await page.locator('label[for="guide-filter-favorites"]').click();
    assert.equal(await page.locator('.guide-item:visible').count(), 2);
    await page.locator('#guide-search').fill('no such program');
    assert.equal(await page.locator('.guide-item:visible').count(), 0);
    assert.equal(await page.locator('#guide-filter-empty').isVisible(), true);
    await page.locator('#guide-clear-filters').click();
    assert.equal(await page.locator('.guide-item:visible').count(), 9);
    await page.locator('label[for="guide-filter-show-hidden"]').click();
    assert.equal(await page.locator('.guide-item:visible').count(), 10);
    await page.locator('#guide-search').fill('PBS');
    await goto('/guide/grid');
    assert.equal(await page.locator('#guide-search').inputValue(), 'PBS');
    assert.equal(await page.locator('.guide-item:visible').count(), 1);
    await page.locator('#guide-search').fill('');
  });
  await check('Expanded upcoming programs and focus-safe overlay / Escape / Back', async () => {
    await goto('/guide');
    await page.locator('.guide-channel-info').first().click();
    await page.waitForSelector('#guide-0.show');
    const watch = page.locator('.btn-watch').first();
    await watch.click();
    assert.equal(await page.locator('#watch-overlay').evaluate(el => el.open), true);
    await page.locator('#watch-overlay-frame').contentFrame().locator('#player-status').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#watch-overlay').evaluate(el => el.open), false);
    assert.equal(await watch.evaluate(el => document.activeElement === el), true);
    await page.waitForTimeout(150);
    await watch.click();
    await page.goBack();
    assert.equal(await page.locator('#watch-overlay').evaluate(el => el.open), false);
    assert.equal(await page.locator('#guide-0').getAttribute('class').then(c => c.includes('show')), true);
    await goto('/guide/grid');
    await page.locator('.guide-channel-cell').first().click();
    assert.equal(await page.locator('#watch-overlay').evaluate(el => el.open), true);
    await page.locator('#watch-overlay-close').click();
  });
  await check('Resumed guide list and grid refresh only when stale and keep state', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await ctx.addInitScript(() => {
      const real = Date.now.bind(Date);
      window.__skewMs = 0;
      Date.now = () => real() + window.__skewMs;
    });
    const guidePage = await ctx.newPage();
    const errors = [];
    guidePage.on('pageerror', error => errors.push(error.message));
    let fetches = [];
    guidePage.on('request', request => { const p = new URL(request.url()).pathname; if (p === '/guide/fragment' || p === '/guide/grid') fetches.push(p); });
    const resume = (skewMinutes, persisted) => guidePage.evaluate(([minutes, restored]) => {
      window.__skewMs = minutes * 60000;
      if (restored) window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      else document.dispatchEvent(new Event('visibilitychange'));
    }, [skewMinutes, persisted]);
    try {
      await guidePage.goto(origin + '/guide');
      await guidePage.waitForSelector('.guide-item');
      await guidePage.locator('.guide-channel-info').first().click();
      await guidePage.waitForSelector('#guide-0.show');
      await guidePage.locator('.guide-channel-info').nth(2).focus();
      await guidePage.evaluate(() => { window.scrollTo(0, 120); document.querySelector('.guide-channel').dataset.stale = '1'; });
      const before = await guidePage.evaluate(() => window.scrollY);
      fetches = [];
      await resume(4, false);
      await guidePage.waitForTimeout(300);
      assert.deepEqual(fetches, [], 'fresh data must not refetch');
      await resume(6, false);
      await guidePage.waitForFunction(() => !document.querySelector('[data-stale]'));
      assert.deepEqual(fetches, ['/guide/fragment']);
      assert.equal(await guidePage.locator('#guide-0.show').count(), 1);
      assert.equal(await guidePage.locator('[data-bs-target="#guide-0"]').first().getAttribute('aria-expanded'), 'true', 'expanded toggle state restored');
      assert.equal(await guidePage.evaluate(() => document.activeElement === document.querySelectorAll('.guide-channel-info')[2]), true, 'list focus restored');
      assert.equal(await guidePage.evaluate(() => window.scrollY), before);
      assert.ok(await guidePage.locator('.airing-time').first().textContent(), 'times are re-hydrated');
      await resume(6, true);
      await resume(6, false);
      await guidePage.waitForTimeout(300);
      assert.equal(fetches.length, 1, 'a refresh resets staleness; no refetch storm');

      fetches = [];
      await guidePage.goto(origin + '/guide/grid');
      await guidePage.waitForSelector('.guide-row');
      await guidePage.locator('#guide-search').fill('PBS');
      await guidePage.locator('.guide-item:not([hidden]) .guide-block').nth(1).focus();
      const focused = await guidePage.evaluate(() => { const el = document.activeElement; document.querySelector('.guide-row').dataset.stale = '1'; return el.dataset.start; });
      fetches = [];
      await resume(4, true);
      await guidePage.waitForTimeout(300);
      assert.deepEqual(fetches, [], 'fresh grid must not refetch');
      await resume(6, true);
      await guidePage.waitForFunction(() => !document.querySelector('[data-stale]'));
      assert.deepEqual(fetches, ['/guide/grid']);
      assert.equal(await guidePage.evaluate(start => document.activeElement.classList.contains('guide-block') && document.activeElement.dataset.start === start, focused), true, 'grid focus restored');
      assert.equal(await guidePage.locator('.guide-item:visible').count(), 1, 'filters are reapplied');
      await resume(6, false);
      await guidePage.waitForTimeout(300);
      assert.equal(fetches.length, 1);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
  await check('Embedded playback status bar auto-hides after playback starts', async () => {
    await goto('/watch/2.1?embedded=1');
    const statusOverlay = page.locator('.watch-fullbleed-overlay');
    await page.waitForFunction(() => document.getElementById('player-status').textContent.includes('Tuner is busy'));
    assert.equal(await statusOverlay.isVisible(), true, 'Startup errors should remain visible');
    await page.locator('#player').evaluate(video => video.dispatchEvent(new Event('playing')));
    await page.waitForFunction(() => {
      const overlay = document.querySelector('.watch-fullbleed-overlay');
      return overlay && overlay.classList.contains('is-hidden') && getComputedStyle(overlay).visibility === 'hidden';
    }, null, { timeout: 4000 });
    assert.equal(await statusOverlay.isVisible(), false);
    await page.screenshot({ path: path.join(screenshots, 'embedded-watch-overlay-hidden.png') });
  });
  // Player recovery: synthetic stream endpoints and a stub hls.js; no tuner or video is involved.
  const hlsStub = `window.Hls = class {
    static isSupported() { return true; }
    constructor() { this.h = {}; this.calls = []; (window.__hls = window.__hls || []).push(this); }
    loadSource() { this.calls.push('loadSource'); }
    attachMedia() {}
    on(name, fn) { (this.h[name] = this.h[name] || []).push(fn); }
    startLoad() { this.calls.push('startLoad'); }
    recoverMediaError() { this.calls.push('recoverMediaError'); }
    destroy() { this.destroyed = true; }
    emit(name, data) { (this.h[name] || []).forEach(fn => fn(name, data)); }
  };
  Hls.Events = { MANIFEST_PARSED: 'm', FRAG_BUFFERED: 'f', ERROR: 'e' };
  Hls.ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };`;
  async function playerPage({ hls = true } = {}) {
    const p = await context.newPage();
    const errors = [];
    p.on('pageerror', error => errors.push(error.message));
    const requests = [];
    await p.route('**/hls.min.js*', route => route.fulfill({ contentType: 'text/javascript', body: hls ? hlsStub : '' }));
    await p.route(/\/(stream|recordings)\/.*\/(start|ready|heartbeat|stop)(\?.*)?$/, route => {
      const request = route.request();
      const name = new URL(request.url()).pathname.split('/').pop();
      requests.push(name);
      route.fulfill({ status: name === 'start' ? 202 : name === 'ready' ? 200 : 204, contentType: 'application/json', body: name === 'ready' ? '{"ready":true}' : '' });
    });
    if (!hls) await p.route('**/stream.m3u8', () => {});
    if (!hls) await p.addInitScript(() => { HTMLMediaElement.prototype.canPlayType = () => 'maybe'; });
    return { p, errors, requests, count: name => requests.filter(r => r === name).length };
  }
  const hlsFatal = (p, index, type, details = 'synthetic') => p.evaluate(([i, t, d]) => window.__hls[i].emit('e', { fatal: true, type: t, details: d }), [index, type, details]);
  for (const [name, route] of [['live', '/watch/2.1'], ['recording', '/recordings/abcdef/watch']]) {
    await check(`Player (${name}) restarts through start/ready after a bfcache restore`, async () => {
      const t = await playerPage();
      try {
        await t.p.goto(origin + route);
        await t.p.waitForFunction(() => window.__hls && window.__hls.length === 1);
        assert.equal(t.count('start'), 1);
        await t.p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        assert.equal(await t.p.evaluate(() => window.__hls[0].destroyed), true, 'pagehide should release hls.js');
        if (name === 'recording') assert.equal(t.count('stop'), 1, 'recording pagehide keeps its stop request');
        await t.p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
        assert.equal(t.count('start'), 1, 'non-bfcache pageshow must not restart');
        await t.p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await t.p.waitForFunction(() => window.__hls.length === 2);
        assert.equal(t.count('start'), 2, 'restore must re-run POST start before loading the playlist');
        assert.ok(t.count('ready') >= 2, 'restore must poll /ready again');
        assert.deepEqual(await t.p.evaluate(() => window.__hls.map(h => h.destroyed || false)), [true, false]);
        assert.deepEqual(t.errors, []);
      } finally { await t.p.close(); }
    });
    await check(`Player (${name}) bounds hls.js fatal recovery, then stops and offers Retry`, async () => {
      const t = await playerPage();
      try {
        await t.p.goto(origin + route);
        await t.p.waitForFunction(() => window.__hls && window.__hls.length === 1);
        await t.p.evaluate(() => window.__hls[0].emit('m'));
        for (let i = 0; i < 3; i++) await hlsFatal(t.p, 0, 'networkError', 'fragLoadError');
        for (let i = 0; i < 3; i++) await hlsFatal(t.p, 0, 'mediaError', 'bufferStalled');
        assert.deepEqual(await t.p.evaluate(() => window.__hls[0].calls), ['loadSource', 'startLoad', 'startLoad', 'startLoad', 'recoverMediaError', 'recoverMediaError', 'recoverMediaError']);
        assert.equal(await t.p.locator('#player-retry').isVisible(), false, 'recoverable errors should not show Retry');
        assert.equal(await t.p.evaluate(() => window.__hls[0].destroyed || false), false);
        await hlsFatal(t.p, 0, 'mediaError', 'bufferStalled');
        assert.equal(await t.p.evaluate(() => window.__hls[0].destroyed), true);
        await t.p.locator('#player-retry').waitFor({ state: 'visible' });
        assert.match(await t.p.locator('#player-status').textContent(), /Playback failed: bufferStalled/);
        assert.equal(t.count('stop'), 1, 'terminal failure must release the session');
        await t.p.locator('#player-retry').click();
        await t.p.waitForFunction(() => window.__hls.length === 2);
        assert.equal(t.count('start'), 2, 'Retry must re-run the start handshake');
        assert.equal(await t.p.locator('#player-retry').isVisible(), false);
        assert.deepEqual(t.errors, []);
      } finally { await t.p.close(); }
    });
    await check(`Player (${name}) handles native HLS video errors with bounded retries`, async () => {
      const t = await playerPage({ hls: false });
      try {
        await t.p.goto(origin + route);
        await t.p.waitForFunction(() => document.getElementById('player').getAttribute('src'));
        for (let i = 0; i < 3; i++) await t.p.locator('#player').evaluate(v => v.dispatchEvent(new Event('error')));
        assert.equal(await t.p.locator('#player-retry').isVisible(), false);
        await t.p.locator('#player').evaluate(v => v.dispatchEvent(new Event('error')));
        await t.p.locator('#player-retry').waitFor({ state: 'visible' });
        assert.equal(await t.p.locator('#player').getAttribute('src'), null);
        assert.equal(t.count('stop'), 1);
        assert.deepEqual(t.errors, []);
      } finally { await t.p.close(); }
    });
  }
  await check('Live player stops heartbeats after pagehide and terminal failure', async () => {
    const t = await playerPage();
    try {
      await t.p.clock.install();
      await t.p.goto(origin + '/watch/2.1');
      await t.p.waitForFunction(() => window.__hls && window.__hls.length === 1);
      await t.p.evaluate(() => window.__hls[0].emit('m'));
      await t.p.clock.runFor(9000);
      await t.p.waitForTimeout(300);
      const running = t.count('heartbeat');
      assert.ok(running >= 3, `heartbeat should be running (saw ${running})`);
      await hlsFatal(t.p, 0, 'otherError');
      const before = t.count('heartbeat');
      await t.p.clock.runFor(12000);
      await t.p.waitForTimeout(300);
      assert.equal(t.count('heartbeat'), before, 'heartbeat must stop after terminal failure');
      await t.p.locator('#player-retry').click();
      await t.p.waitForFunction(() => window.__hls.length === 2);
      await t.p.evaluate(() => window.__hls[1].emit('m'));
      await t.p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      const afterHide = t.count('heartbeat');
      await t.p.clock.runFor(12000);
      await t.p.waitForTimeout(300);
      assert.equal(t.count('heartbeat'), afterHide, 'heartbeat must stop on pagehide');
    } finally { await t.p.close(); }
  });
  await check('Theme preference survives viewer/admin navigation', async () => {
    await goto('/guide');
    const old = await page.locator('html').getAttribute('data-bs-theme');
    await page.locator('#theme-toggle').click();
    const next = old === 'light' ? 'dark' : 'light';
    await goto('/admin');
    assert.equal(await page.locator('html').getAttribute('data-bs-theme'), next);
  });
  await check('Channel favorite updates encode + and replace row accessibly', async () => {
    await goto('/admin/channels');
    const row = page.locator('#channel-3-1');
    await row.locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('#channel-3-1 button').getAttribute('aria-pressed') === 'true');
  });
  await check('Failed htmx requests surface a dismissible alert instead of failing silently', async () => {
    await page.route('**/admin/channels/flag*', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'device offline' }));
    try {
      await goto('/admin/channels');
      await page.locator('#channel-3-1 button').first().click();
      const alert = page.locator('#htmx-errors [role="alert"]');
      await alert.waitFor();
      assert.match(await alert.textContent(), /Couldn’t update the channel \(HTTP 500: device offline\)/);
      assert.equal(await page.locator('#channel-3-1 button').first().isEnabled(), true, 'button is usable again after the error');
      await alert.locator('.btn-close').click();
      assert.equal(await page.locator('#htmx-errors [role="alert"]').count(), 0);
    } finally { await page.unroute('**/admin/channels/flag*'); }
  });
  await check('Bootstrap, icons, htmx and hls.js are served locally (works offline)', async () => {
    const externalRequests = [];
    const probe = await context.newPage();
    probe.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) externalRequests.push(request.url()); });
    try {
      for (const route of ['/guide', '/admin/channels', '/watch/2.1', '/recordings/abcdef/watch']) {
        await probe.goto(origin + route);
        await probe.waitForLoadState('networkidle');
        const html = await probe.content();
        const external = html.match(/<(?:script[^>]+src|link[^>]+href)="https?:\/\/[^"]*/);
        assert.equal(external, null, `${route} references an external asset: ${external}`);
      }
      assert.equal(await probe.evaluate(() => typeof window.htmx), 'object');
      assert.equal(await probe.evaluate(() => typeof window.bootstrap), 'object');
      for (const asset of ['/vendor/hls.min.js', '/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2']) assert.equal((await fetch(origin + asset)).status, 200, asset);
      assert.deepEqual(externalRequests, []);
    } finally { await probe.close(); }
  });
  await check('Channel filters are re-applied after Hide/Unfavorite row swaps', async () => {
    await goto('/admin/channels');
    const count = () => page.locator('#channel-count').textContent();
    const visibleRows = () => page.locator('.channel-row:visible').count();
    // Hide with Show Hidden off: the row must disappear and the count must follow.
    const before = await visibleRows();
    await page.locator('#channel-4-1 button[title="Hide"]').click();
    await page.locator('#channel-4-1').waitFor({ state: 'hidden' });
    assert.equal(await visibleRows(), before - 1);
    assert.equal(await count(), `${before - 1} channels`);
    // Unfavorite under the Favorites filter: the row must leave the filtered list.
    await page.locator('label[for="filter-favorites"]').click();
    const favorites = await visibleRows();
    assert.ok(favorites >= 2, 'fixture should have favorites');
    await page.locator('#channel-2-1 button[title="Unfavorite"]').click();
    await page.locator('#channel-2-1').waitFor({ state: 'hidden' });
    assert.equal(await visibleRows(), favorites - 1);
    assert.equal(await count(), `${favorites - 1} channel${favorites - 1 === 1 ? '' : 's'}`);
    // Restore shared fixture state: unhide the row and re-favorite the first channel.
    await page.locator('label[for="filter-favorites"]').click();
    await page.locator('label[for="filter-hidden"]').click();
    await page.locator('#channel-4-1 button[title="Unhide"]').click();
    await page.waitForFunction(() => document.querySelector('#channel-4-1 button[title="Hide"]'));
    await page.locator('#channel-2-1 button[title="Favorite"]').click();
    await page.waitForFunction(() => document.querySelector('#channel-2-1 button[title="Unfavorite"]'));
  });
  await check('Scan source, start, progress and abort', async () => {
    await goto('/admin/scan');
    await page.selectOption('#scan-source', 'Cable');
    await page.getByRole('button', { name: 'Start Scan' }).click();
    await page.getByRole('button', { name: 'Abort Scan' }).waitFor();
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '42');
    await page.getByRole('button', { name: 'Abort Scan' }).click();
    await page.getByRole('button', { name: 'Start Scan' }).waitFor();
  });
  await check('320px and tablet layouts remain contained', async () => {
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['/guide', '/guide/grid', '/admin/channels']) {
        await goto(route);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${route} overflows at ${width}px`);
      }
    }
  });
  await check('Empty and disconnected guide states have recovery actions', async () => {
    // Scenario changes bypass the production fragment's intentional HTTP cache.
    await page.route(origin + '/guide/fragment', route => route.continue());
    await page.setViewportSize({ width: 390, height: 844 });
    for (const value of ['empty', 'error']) {
      await scenario(value);
      await page.goto(origin + '/guide');
      await page.waitForSelector('#guide-content .guide-empty');
      assert.equal(await page.locator('#guide-content .guide-item').count(), 0);
      assert.equal(await page.locator('#guide-filter-empty').isVisible(), false);
      assert.ok(await page.locator('#guide-content .guide-empty .btn').count());
      await page.screenshot({ path: path.join(screenshots, `guide-${value}.png`), fullPage: true });
    }
    await scenario('normal');
    await page.unroute(origin + '/guide/fragment');
  });
  await check('Guide error responses are not cached (Try again re-requests)', async () => {
    // Fresh context = empty HTTP cache, so earlier guide loads can't mask the error response.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(origin + '/admin/status');
    const browserFetch = url => page.evaluate(async u => { const r = await fetch(u); return { status: r.status, cc: r.headers.get('cache-control'), body: await r.text() }; }, url);
    await scenario('error');
    for (const url of ['/guide/fragment', '/guide/grid', '/api/guide', '/api/guide?slim=1']) {
      const res = await browserFetch(url);
      assert.equal(res.cc, 'no-store', `${url} error Cache-Control was ${res.cc}`);
    }
    await scenario('normal');
    for (const url of ['/guide/fragment', '/guide/grid']) {
      const res = await browserFetch(url);
      assert.equal(res.status, 200);
      assert.ok(!res.body.includes("couldn’t load"), `${url} still served the cached error after recovery`);
    }
    const ok = await browserFetch('/api/guide');
    assert.equal(ok.status, 200);
    assert.match(ok.cc, /max-age=15/);
    await ctx.close();
  });
  await check('Optional DVR remains optional', async () => {
    await scenario('dvr-off');
    await page.goto(origin + '/recordings');
    await page.getByText('Recording is not configured on this server.').waitFor();
    await scenario('normal');
  });
  await check('Cross-origin mutating requests are rejected', async () => {
    const post = headers => fetch(origin + '/admin/scan/abort', { method: 'POST', headers }).then(r => r.status);
    assert.equal(await post({ Origin: 'https://evil.example' }), 403);
    assert.equal(await post({ Origin: 'null' }), 403);
    assert.equal(await post({ 'Sec-Fetch-Site': 'cross-site' }), 403);
    assert.equal(await post({ Origin: `http://localhost:${port}` }), 403);
    assert.notEqual(await post({ Origin: origin, 'Sec-Fetch-Site': 'same-origin' }), 403);
    assert.notEqual(await post({}), 403);
  });
  await check('No uncaught browser exceptions', async () => assert.deepEqual(pageErrors, []));
} finally {
  await browser?.close();
  fixture.kill();
}
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
else console.log('UI checks passed. Synthetic screenshots:', screenshots);
