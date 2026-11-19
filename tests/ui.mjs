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
