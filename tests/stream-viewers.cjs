// Server probe for shared stream sessions (issue #32): one viewer stopping a
// channel/codec/profile session must not kill it for other viewers.
// Uses the real src/stream.js + src/routes/watch.js with a fake `ffmpeg` on
// PATH and a synthetic lineup. Never contacts or tunes a real device.
// Run: npm run test:streams
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunatv-fake-ffmpeg-'));
fs.writeFileSync(path.join(binDir, 'ffmpeg'), [
  '#!/bin/sh',
  '# Fake ffmpeg: the last argument is the playlist path.',
  'for last; do :; done',
  'trap "exit 0" TERM INT',
  'echo "#EXTM3U" > "$last"',
  'while :; do sleep 0.1; done',
  '',
].join('\n'), { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.HDHOMERUN_HOST = 'synthetic-device.invalid';
process.env.STREAM_VIEWER_TTL_MS = '1500';

const express = require('express');
const hdhr = require('../src/hdhomerun');
hdhr.getLineup = async () => [{ GuideNumber: '2.1', GuideName: 'PBS' }];
hdhr.getDeviceInfo = async () => ({ TunerCount: 4 });
const stream = require('../src/stream');
const sameOrigin = require('../src/middleware/sameOrigin');

const app = express();
app.use(sameOrigin);
app.use(require('../src/routes/watch'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = 'viewer-aaaaaaaa';
const B = 'viewer-bbbbbbbb';
let port;

function req(method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    r.on('error', reject);
    r.end();
  });
}
const base = (profile = 'medium') => `/stream/2.1/h264/${profile}`;
const sessions = () => stream.getMetrics().sessions;
const alive = (profile = 'medium') => stream.getSessionInfo('2.1', 'h264', profile) !== null;

async function waitFor(fn, label, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(`ok - ${name}`);
  } catch (err) {
    results.push(`FAIL - ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

async function reset() {
  for (const p of stream.STREAM_PROFILES) stream.stopSession('2.1', 'h264', p, 'test_reset');
  await waitFor(() => sessions().length === 0, 'sessions to exit');
}

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;

  await test('one viewer stopping leaves the shared session for another', async () => {
    assert.strictEqual((await req('POST', `${base()}/start?viewer=${A}`)).status, 202);
    assert.strictEqual((await req('POST', `${base()}/start?viewer=${B}`)).status, 202);
    assert.strictEqual(sessions().length, 1, 'viewers share one session');
    assert.strictEqual(sessions()[0].viewers, 2);
    await sleep(2200); // clear the 2s anti-teardown-race guard (and lapse the 1.5s test TTL)
    await req('POST', `${base()}/heartbeat?viewer=${A}`);
    await req('POST', `${base()}/heartbeat?viewer=${B}`);
    assert.strictEqual((await req('POST', `${base()}/stop?viewer=${A}`)).status, 204);
    assert.ok(alive(), 'session must survive A leaving');
    assert.strictEqual(sessions()[0].viewers, 1);
    assert.strictEqual((await req('POST', `${base()}/stop?viewer=${B}`)).status, 204);
    await waitFor(() => !alive(), 'last viewer stop to end the session');
    await reset();
  });

  await test('bare (legacy) stop does not kill a session with identified viewers', async () => {
    await req('POST', `${base()}/start?viewer=${A}`);
    await sleep(2200);
    await req('POST', `${base()}/heartbeat?viewer=${A}`);
    assert.strictEqual((await req('POST', `${base()}/stop`)).status, 204);
    assert.ok(alive(), 'bare stop must not kill session while A is active');
    await reset();
  });

  await test('legacy clients without ids keep the old start/ready/stop handshake', async () => {
    assert.strictEqual((await req('POST', `${base()}/start`)).status, 202);
    await waitFor(async () => JSON.parse((await req('GET', `${base()}/ready`)).body).ready, 'ready');
    assert.strictEqual((await req('GET', `${base()}/stream.m3u8`)).status, 200);
    await sleep(2200);
    assert.strictEqual((await req('POST', `${base()}/stop`)).status, 204);
    await waitFor(() => !alive(), 'bare stop to end a sole legacy session');
    await reset();
  });

  await test('lapsed viewer leases stop protecting a session', async () => {
    await req('POST', `${base()}/start?viewer=${A}`);
    await req('POST', `${base()}/start?viewer=${B}`);
    await sleep(2200); // > STREAM_VIEWER_TTL_MS (1.5s) and the stop age guard
    await req('POST', `${base()}/heartbeat?viewer=${B}`);
    assert.strictEqual(sessions()[0].viewers, 1, 'only the heartbeating viewer is active');
    await req('POST', `${base()}/stop?viewer=${B}`);
    await waitFor(() => !alive(), 'stop once no other active lease remains');
    await reset();
  });

  await test('heartbeat refreshes a viewer lease', async () => {
    await req('POST', `${base()}/start?viewer=${A}`);
    await req('POST', `${base()}/start?viewer=${B}`);
    for (let i = 0; i < 4; i += 1) {
      await sleep(600);
      await req('POST', `${base()}/heartbeat?viewer=${A}`);
    }
    await req('POST', `${base()}/stop?viewer=${B}`);
    assert.ok(alive(), 'A is still heartbeating so the session must survive');
    await reset();
  });

  await test('stop right after start is ignored (delayed-teardown guard)', async () => {
    await req('POST', `${base()}/start?viewer=${A}`);
    await req('POST', `${base()}/stop?viewer=${A}`);
    assert.ok(alive());
    await reset();
  });

  await test('profiles remain separate sessions', async () => {
    await req('POST', `${base('low')}/start?viewer=${A}`);
    await req('POST', `${base('high')}/start?viewer=${B}`);
    assert.strictEqual(sessions().length, 2);
    await reset();
  });

  await test('malformed viewer ids are rejected', async () => {
    for (const bad of ['short', 'has space!!', 'x'.repeat(65), '../etc/passwd']) {
      for (const [method, tail] of [['POST', 'start'], ['POST', 'heartbeat'], ['POST', 'stop']]) {
        const r = await req(method, `${base()}/${tail}?viewer=${encodeURIComponent(bad)}`);
        assert.strictEqual(r.status, 400, `${tail} ${bad}`);
      }
    }
    assert.strictEqual((await req('POST', `${base()}/start?viewer=a&viewer=b`)).status, 400);
    assert.strictEqual(sessions().length, 0, 'rejected starts must not spawn ffmpeg');
  });

  await test('viewer leases per session are bounded', async () => {
    await req('POST', `${base()}/start?viewer=${A}`);
    for (let i = 0; i < 100; i += 1) {
      await req('POST', `${base()}/heartbeat?viewer=bounded-${String(i).padStart(4, '0')}`);
    }
    assert.ok(sessions()[0].viewers <= 64, `viewers=${sessions()[0].viewers}`);
    await reset();
  });

  await test('same-origin protection still applies to stop', async () => {
    await req('POST', `${base()}/start?viewer=${A}`);
    await sleep(2200);
    const cross = await req('POST', `${base()}/stop?viewer=${A}`, { Origin: 'https://evil.example' });
    assert.strictEqual(cross.status, 403);
    assert.ok(alive());
    const site = await req('POST', `${base()}/stop?viewer=${A}`, { 'Sec-Fetch-Site': 'cross-site' });
    assert.strictEqual(site.status, 403);
    assert.ok(alive());
    const same = await req('POST', `${base()}/stop?viewer=${A}`, { Origin: `http://127.0.0.1:${port}` });
    assert.strictEqual(same.status, 204);
    await waitFor(() => !alive(), 'same-origin stop');
    await reset();
  });

  await reset();
  server.close();
  fs.rmSync(binDir, { recursive: true, force: true });
  console.log(results.join('\n'));
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
