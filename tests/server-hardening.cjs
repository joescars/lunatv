// Server-side hardening probes for issue #36. No tuner, ffmpeg or network is
// used: child_process.spawn and global fetch are stubbed, and the Express
// routers run against stubbed device clients on an ephemeral port.
//   npm run test:server
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

// Keep every temp dir the modules create inside a throwaway root.
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lunatv-hardening-'));
process.env.RECORD_ENGINE_HOST = '10.9.8.7';
process.env.RECORD_ENGINE_PORT = '80';
process.env.STREAM_KILL_GRACE_MS = '60';
process.env.HDHOMERUN_HOST = '10.1.2.3';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const src = (name) => path.join(__dirname, '..', 'src', name);

function freshRequire(name, env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  delete require.cache[require.resolve(src(name))];
  try { return require(src(name)); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// ffmpeg stand-in: records args and lets tests drive stderr/exit/error.
const spawned = [];
function installFakeSpawn() {
  childProcess.spawn = (cmd, args) => {
    const proc = new EventEmitter();
    proc.cmd = cmd;
    proc.args = args;
    proc.stderr = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.exitCode = null;
    proc.signalCode = null;
    proc.killed = false;
    proc.signals = [];
    proc.kill = (signal) => { proc.killed = true; proc.signals.push(signal); return true; };
    proc.finish = (code) => { proc.exitCode = code; proc.emit('exit', code, null); };
    spawned.push(proc);
    return proc;
  };
}
const realSpawn = childProcess.spawn;
installFakeSpawn();
test.after(() => { childProcess.spawn = realSpawn; });

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function request(server, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path: urlPath, method,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------- cache
test('cache: clearPrefix removes every slot key; sweep evicts expired entries only', () => {
  const cache = require(src('cache.js'));
  cache.clear();
  cache.set('guide:roku:duration:4:1000', 1, 60_000);
  cache.set('guide:roku:duration:4:2800', 2, 60_000);
  cache.set('guide:duration:4', 3, 60_000);
  cache.clearPrefix('guide:roku:duration:4:');
  assert.equal(cache.get('guide:roku:duration:4:1000'), null);
  assert.equal(cache.get('guide:roku:duration:4:2800'), null);
  assert.equal(cache.get('guide:duration:4'), 3);

  cache.set('stale', 1, 10);
  cache.set('fresh', 1, 60_000);
  assert.equal(cache.sweep(Date.now() + 1000), 1);
  assert.equal(cache.get('fresh'), 1);
  cache.clear();
});

test('favorite change clears the current slim guide cache slot (seconds, not ms)', async () => {
  const hdhr = require(src('hdhomerun.js'));
  const cache = require(src('cache.js'));
  hdhr.setChannelFlag = async () => ({});
  const app = express();
  app.use(require(src('routes/api.js')));
  const server = await listen(app);
  try {
    const slot = Math.floor(Date.now() / 1000 / 1800) * 1800;
    cache.set(`guide:roku:duration:4:${slot}`, { channels: [] }, 60_000);
    cache.set('guide:duration:4', [], 60_000);
    const res = await request(server, 'POST', '/api/channels/2.1/favorite?favorite=1');
    assert.equal(res.status, 200);
    assert.equal(cache.get(`guide:roku:duration:4:${slot}`), null);
    assert.equal(cache.get('guide:duration:4'), null);
  } finally { server.close(); cache.clear(); }
});

// -------------------------------------------------------- channels flag
test('/admin/channels/flag validates guide and mode before calling the device', async () => {
  const hdhr = require(src('hdhomerun.js'));
  const calls = [];
  hdhr.setChannelFlag = async (guide, mode) => { calls.push([guide, mode]); return {}; };
  hdhr.getLineup = async () => [];
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/admin', require(src('routes/channels.js')));
  const server = await listen(app);
  try {
    for (const q of [
      'guide=2.1&mode=%2B%2B', 'guide=2.1&mode=y', 'guide=2.1', 'guide=2.1&mode=', 'guide=2.1&mode=%2B&mode=-',
      'guide=abc&mode=%2B', 'guide=2.1%26x%3D1&mode=%2B', 'mode=%2B', 'guide=2.1&guide=3.1&mode=%2B',
    ]) {
      const res = await request(server, 'POST', `/admin/channels/flag?${q}`);
      assert.equal(res.status, 400, q);
    }
    assert.deepEqual(calls, [], 'device must not be called for invalid input');
    for (const mode of ['%2B', '-', 'x']) {
      const res = await request(server, 'POST', `/admin/channels/flag?guide=2.1&mode=${mode}`);
      assert.equal(res.status, 404, 'valid input reaches the device; empty lineup => 404');
    }
    assert.deepEqual(calls, [['2.1', '+'], ['2.1', '-'], ['2.1', 'x']]);
  } finally { server.close(); }
});

// -------------------------------------------------------------- RECORD
test('RECORD with RECORD_ENGINE_PORT=80: delete accepts the engine CmdURL', async () => {
  const record = freshRequire('hdhomerunRecord.js');
  const fetched = [];
  global.fetch = async (url, options) => {
    fetched.push({ url: String(url), method: options && options.method });
    return { ok: true, status: 200, statusText: 'OK', text: async () => '' };
  };
  await record.deleteRecording({ id: 'ab', CmdURL: 'http://10.9.8.7/cmd?id=ab' });
  assert.equal(fetched.length, 1);
  assert.match(fetched[0].url, /^http:\/\/10\.9\.8\.7\/cmd\?id=ab&cmd=delete$/);
  assert.equal(fetched[0].method, 'POST');
  // The explicit-port spelling of the same origin is also the same origin.
  await record.deleteRecording({ id: 'ab', CmdURL: 'http://10.9.8.7:80/cmd?id=ab' });
  assert.equal(fetched.length, 2);
  // A different host is still rejected.
  await assert.rejects(record.deleteRecording({ id: 'ab', CmdURL: 'http://10.9.8.8/cmd?id=ab' }), /invalid/);
  await assert.rejects(record.deleteRecording({ id: 'ab', CmdURL: 'http://10.9.8.7:8080/cmd?id=ab' }), /invalid/);
  assert.equal(fetched.length, 2);
});

test('RECORD with a non-default port still matches exactly', async () => {
  const record = freshRequire('hdhomerunRecord.js', { RECORD_ENGINE_PORT: '37899' });
  global.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => '' });
  await record.deleteRecording({ id: 'ab', CmdURL: 'http://10.9.8.7:37899/cmd?id=ab' });
  await assert.rejects(record.deleteRecording({ id: 'ab', CmdURL: 'http://10.9.8.7/cmd?id=ab' }), /invalid/);
});

test('recordCurrentAiring refuses a missing SeriesID (422) without calling any API', async () => {
  const record = freshRequire('hdhomerunRecord.js');
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; throw new Error('should not be called'); };
  for (const seriesId of [undefined, null, '']) {
    await assert.rejects(
      record.recordCurrentAiring({ seriesId, channel: '2.1', startTime: 1 }),
      (err) => err.status === 422 && /series ID/.test(err.message),
    );
  }
  assert.equal(fetchCalls, 0);
});

test('POST /watch/:channel/record returns 422 for a program without SeriesID', async () => {
  const guide = require(src('guide.js'));
  const record = require(src('hdhomerunRecord.js'));
  const recordCalls = [];
  const origRecord = record.recordCurrentAiring;
  record.recordCurrentAiring = async (args) => { recordCalls.push(args); return {}; };
  const app = express();
  app.set('view engine', 'ejs');
  app.use(require(src('routes/watch.js')));
  const server = await listen(app);
  try {
    guide.getCurrentProgram = async () => ({ Title: 'News', StartTime: 5 });
    const res = await request(server, 'POST', '/watch/2.1/record');
    assert.equal(res.status, 422);
    assert.match(JSON.parse(res.body).error, /series ID/);
    assert.deepEqual(recordCalls, []);

    guide.getCurrentProgram = async () => ({ Title: 'News', StartTime: 5, SeriesID: 'S1' });
    const ok = await request(server, 'POST', '/watch/2.1/record');
    assert.equal(ok.status, 200);
    assert.equal(recordCalls.length, 1);
    assert.equal(recordCalls[0].seriesId, 'S1');
  } finally { server.close(); record.recordCurrentAiring = origRecord; }
});

// ------------------------------------------------------ error sanitizing
test('sanitizeFfmpegError: short messages, keywords the clients rely on, no leaks', () => {
  const { sanitizeFfmpegError, GENERIC_MESSAGE } = require(src('ffmpegSupport.js'));
  const leaky = [
    '[http @ 0x55] HTTP error 503 Service Unavailable',
    '[in#0 @ 0x55] Error opening input: Server returned 503 Service Unavailable',
    'Error opening input file http://192.168.1.50:5004/auto/v2.1.',
  ].join('\n');
  const busy = sanitizeFfmpegError(leaky);
  assert.match(busy, /busy/i); // Roku -> tuner_busy, browser -> "Tuner is busy"
  assert.match(busy, /tuner/i);
  assert.ok(!/192\.168|5004|0x55/.test(busy));

  assert.match(sanitizeFfmpegError('Server returned 403 Forbidden'), /forbidden/i);
  assert.match(sanitizeFfmpegError('Connection timed out'), /timed out/i);
  assert.match(sanitizeFfmpegError('Server returned 404 Not Found'), /channel|signal/i);
  assert.match(sanitizeFfmpegError('Connection refused'), /network/i);
  assert.match(sanitizeFfmpegError('spawn ffmpeg ENOENT'), /ffmpeg could not be started/i);

  const driver = 'Failed to open /dev/dri/renderD128 (Permission denied)\nqsv init failed at 10.0.0.9';
  const hw = sanitizeFfmpegError(driver);
  assert.ok(!/dev\/dri|10\.0\.0\.9/.test(hw));
  assert.match(hw, /encoder/i);

  assert.equal(sanitizeFfmpegError('some totally unknown 10.0.0.1 text'), GENERIC_MESSAGE);
  assert.equal(sanitizeFfmpegError(''), GENERIC_MESSAGE);
  assert.equal(sanitizeFfmpegError(undefined, 'custom'), 'custom');
  // The newest matching line wins.
  assert.match(sanitizeFfmpegError('Connection refused\nServer returned 503'), /busy/);
  // Every generated message is short and single-line.
  for (const raw of [leaky, driver, 'Connection refused', 'x'.repeat(5000)]) {
    const msg = sanitizeFfmpegError(raw);
    assert.ok(msg.length <= 80 && !msg.includes('\n'), msg);
  }
});

test('stream /ready returns sanitized errors; raw stderr stays in the server log', () => {
  const stream = freshRequire('stream.js');
  const logs = [];
  const origWarn = console.warn;
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    stream.start('7.1', 'h264', 'medium', 4);
    const proc = spawned[spawned.length - 1];
    proc.stderr.emit('data', Buffer.from(
      'Error opening input: Server returned 503 Service Unavailable\n'
      + 'Error opening input file http://10.1.2.3:5004/auto/v7.1.\n',
    ));
    proc.finish(1);
    const ready = stream.isReady('7.1', 'h264', 'medium');
    assert.equal(ready.failed, true);
    assert.match(ready.error, /busy/i);
    assert.ok(!/10\.1\.2\.3|5004/.test(ready.error), ready.error);
    assert.ok(logs.some((l) => /10\.1\.2\.3/.test(l)), 'details are logged server-side');

    stream.start('8.1', 'h264', 'medium', 4);
    const proc2 = spawned[spawned.length - 1];
    proc2.stderr.emit('data', Buffer.from('weird failure at /dev/dri/renderD128 host 10.1.2.3\n'));
    proc2.finish(1);
    const ready2 = stream.isReady('8.1', 'h264', 'medium');
    assert.equal(ready2.failed, true);
    assert.ok(!/dev\/dri|10\.1\.2\.3/.test(ready2.error), ready2.error);
    assert.ok(ready2.error.length > 0);
  } finally { console.warn = origWarn; }
});

// ------------------------------------------------------- decode config
function inputArgs(proc) { return proc.args.slice(0, proc.args.indexOf('-i')); }
function outputArgs(proc) { return proc.args.slice(proc.args.indexOf('-i') + 2); }

test('software decode: no forced mpeg2 decoder; encoder (h264 for browsers, hevc for Roku) unchanged', () => {
  const stream = freshRequire('stream.js', { STREAM_DECODE_MODE: 'sw' });
  for (const [channel, codec, encoder] of [['11.1', 'h264', 'h264_qsv'], ['11.2', 'hevc', 'hevc_qsv']]) {
    stream.start(channel, codec, 'medium', 20);
    const proc = spawned[spawned.length - 1];
    const before = inputArgs(proc);
    assert.ok(!before.includes('-c:v'), `no input decoder forced: ${before.join(' ')}`);
    assert.ok(!proc.args.includes('mpeg2video') && !proc.args.includes('mpeg2_qsv'));
    assert.ok(!before.includes('-hwaccel'), 'software decode must not enable a hwaccel');
    assert.deepEqual(before.slice(before.indexOf('-init_hw_device')), ['-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw']);
    const after = outputArgs(proc);
    assert.equal(after[after.indexOf('-c:v') + 1], encoder);
    assert.ok(after.join(' ').includes('format=nv12,hwupload=extra_hw_frames=64'));
    assert.equal(stream.getSessionInfo(channel, codec, 'medium').ffmpeg.decodeMode, 'sw');
  }
  // h264 keeps the A/53 caption flag; hevc does not (unchanged behaviour).
  const h264 = spawned.filter((p) => p.args.includes('h264_qsv')).pop();
  assert.ok(outputArgs(h264).includes('-a53cc'));
});

test('direct mode (Roku) is untouched; qsv decode mode keeps hwaccel but no longer forces mpeg2_qsv', () => {
  const stream = freshRequire('stream.js', { STREAM_DECODE_MODE: 'sw' });
  stream.start('12.1', 'direct', 'medium', 20);
  const direct = spawned[spawned.length - 1];
  assert.ok(direct.args.join(' ').includes('-c copy'));
  assert.ok(!direct.args.some((a) => /qsv|mpeg2video/.test(a)));

  const qsv = freshRequire('stream.js', { STREAM_DECODE_MODE: 'qsv' });
  qsv.start('12.2', 'h264', 'medium', 20);
  const proc = spawned[spawned.length - 1];
  assert.deepEqual(
    inputArgs(proc).slice(inputArgs(proc).indexOf('-hwaccel')),
    ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv'],
  );
});

// ---------------------------------------------- exit handler / SIGKILL
test('exit after an error event does not evict or wipe a newer session for the same key', () => {
  const stream = freshRequire('stream.js');
  stream.start('13.1', 'h264', 'medium', 20);
  const oldProc = spawned[spawned.length - 1];
  const exitedBefore = stream.getMetrics().sessionsExited;
  oldProc.emit('error', new Error('spawn ffmpeg EAGAIN'));
  assert.equal(stream.getMetrics().sessionsExited, exitedBefore + 1);
  assert.equal(stream.isReady('13.1', 'h264', 'medium').failed, true);

  // A retry spawns a fresh session on the same key and directory.
  stream.start('13.1', 'h264', 'medium', 20);
  const newProc = spawned[spawned.length - 1];
  assert.notEqual(newProc, oldProc);
  const dir = stream.channelDir('13.1', 'h264', 'medium');
  assert.ok(fs.existsSync(dir));
  const sessionsBefore = stream.getMetrics().activeSessions;

  oldProc.finish(1); // late 'exit' from the process that already errored
  assert.equal(stream.getMetrics().activeSessions, sessionsBefore, 'newer session still registered');
  assert.equal(stream.getMetrics().sessionsExited, exitedBefore + 1, 'not double counted');
  assert.ok(fs.existsSync(dir), 'newer session directory not removed');
  assert.ok(stream.getSessionInfo('13.1', 'h264', 'medium'));
});

test('stopSession escalates to SIGKILL only if ffmpeg ignores SIGTERM, once', async () => {
  const stream = freshRequire('stream.js');
  stream.start('14.1', 'h264', 'medium', 20);
  const stubborn = spawned[spawned.length - 1];
  stream.stopSession('14.1', 'h264', 'medium', 'manual');
  stream.stopSession('14.1', 'h264', 'medium', 'manual'); // idle sweeps repeat this
  assert.deepEqual(stubborn.signals, ['SIGTERM']);
  await sleep(150);
  assert.deepEqual(stubborn.signals, ['SIGTERM', 'SIGKILL']);

  stream.start('14.2', 'h264', 'medium', 20);
  const polite = spawned[spawned.length - 1];
  stream.stopSession('14.2', 'h264', 'medium', 'manual');
  polite.finish(255);
  await sleep(150);
  assert.deepEqual(polite.signals, ['SIGTERM'], 'no SIGKILL after a clean exit');
});

test('terminate() really SIGKILLs a process that ignores SIGTERM', async () => {
  const { terminate } = require(src('ffmpegSupport.js'));
  const proc = realSpawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], { stdio: 'ignore' });
  await sleep(300); // let it install the handler
  const exit = new Promise((resolve) => proc.once('exit', (code, signal) => resolve(signal)));
  terminate(proc, 200);
  assert.equal(await exit, 'SIGKILL');
});

// ---------------------------------------------------- recording streams
test('recordingStream: every start gets its own directory; an old exit cannot remove a newer one', () => {
  const rs = freshRequire('recordingStream.js');
  rs.start('abc123', 'http://10.9.8.7/recorded/play?id=abc123', 'medium');
  const first = spawned[spawned.length - 1];
  const dir1 = rs._sessions.get('abc123:medium').dir;
  assert.ok(fs.existsSync(dir1));

  // First ffmpeg was told to stop but is still shutting down when the user restarts.
  first.killed = true;
  rs.start('abc123', 'http://10.9.8.7/recorded/play?id=abc123', 'medium');
  const second = spawned[spawned.length - 1];
  assert.notEqual(second, first);
  const dir2 = rs._sessions.get('abc123:medium').dir;
  assert.notEqual(dir2, dir1);
  assert.ok(fs.existsSync(dir1) && fs.existsSync(dir2));
  assert.ok(second.args.some((a) => a.startsWith(dir2)), 'new ffmpeg writes into the new dir');
  assert.ok(!second.args.some((a) => a.startsWith(dir1)));

  first.finish(255); // old ffmpeg finally dies
  assert.ok(!fs.existsSync(dir1), 'old dir cleaned up');
  assert.ok(fs.existsSync(dir2), 'new session dir untouched');
  assert.equal(rs._sessions.get('abc123:medium').process, second);

  // Even a clean (code 0) exit of a replaced session must not leak its dir.
  rs.start('def456', 'http://10.9.8.7/recorded/play?id=def456', 'low');
  const a = spawned[spawned.length - 1];
  const dirA = rs._sessions.get('def456:low').dir;
  a.killed = true;
  rs.start('def456', 'http://10.9.8.7/recorded/play?id=def456', 'low');
  a.finish(0);
  assert.ok(!fs.existsSync(dirA));
});

test('recordingStream: isReady sanitizes stderr and SIGKILL fallback applies on stop', async () => {
  const rs = freshRequire('recordingStream.js');
  rs.start('beef01', 'http://10.9.8.7/recorded/play?id=beef01', 'medium');
  const proc = spawned[spawned.length - 1];
  proc.stderr.emit('data', Buffer.from('Connection refused http://10.9.8.7:80/recorded/play?id=beef01\n'));
  proc.finish(1);
  const state = rs.isReady('beef01', 'medium');
  assert.equal(state.ready, false);
  assert.ok(state.error && !/10\.9\.8\.7|beef01/.test(state.error), state.error);

  rs.start('beef02', 'http://10.9.8.7/recorded/play?id=beef02', 'medium');
  const stubborn = spawned[spawned.length - 1];
  rs.stopById('beef02', 'medium');
  rs.stopById('beef02', 'medium');
  assert.deepEqual(stubborn.signals, ['SIGTERM']);
  await sleep(150);
  assert.deepEqual(stubborn.signals, ['SIGTERM', 'SIGKILL']);
});

// ------------------------------------------- qsv decode: no forced mpeg2
test('STREAM_DECODE_MODE=qsv: hwaccel stays on, decoder is auto-selected for h264/hevc encodes', () => {
  const stream = freshRequire('stream.js', { STREAM_DECODE_MODE: 'qsv' });
  for (const [channel, codec, encoder] of [['21.1', 'h264', 'h264_qsv'], ['21.2', 'hevc', 'hevc_qsv']]) {
    stream.start(channel, codec, 'medium', 20);
    const proc = spawned[spawned.length - 1];
    const before = inputArgs(proc);
    assert.ok(!before.includes('-c:v'), `no forced input decoder: ${before.join(' ')}`);
    assert.ok(!proc.args.some((a) => /mpeg2/.test(a)), proc.args.join(' '));
    assert.deepEqual(before.slice(before.indexOf('-hwaccel')), ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv']);
    const after = outputArgs(proc);
    assert.equal(after[after.indexOf('-c:v') + 1], encoder);
    assert.ok(!after.join(' ').includes('hwupload'), 'frames are already on the GPU in qsv decode mode');
    const info = stream.getSessionInfo(channel, codec, 'medium');
    assert.equal(info.ffmpeg.decodeMode, 'qsv');
  }
});

// -------------------------------------- WebVTT sidecar diagnostics (/stats)
test('/stats WebVTT sidecar diagnostics never expose raw stderr, IPs, or paths; detail is logged', async () => {
  const stream = freshRequire('stream.js', { WEBVTT_SIDECAR_MODE: 'on' });
  const logs = [];
  const origWarn = console.warn;
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    stream.start('31.1', 'h264', 'medium', 20);
    const main = spawned[spawned.length - 1];
    fs.writeFileSync(path.join(stream.channelDir('31.1', 'h264', 'medium'), 'stream.m3u8'), '#EXTM3U\n');
    await stream.attachSession('31.1', 'h264', 'medium');
    const sidecar = spawned[spawned.length - 1];
    assert.notEqual(sidecar, main, 'sidecar ffmpeg was spawned');
    assert.ok(sidecar.args.join(' ').includes('webvtt'));

    sidecar.stderr.emit('data', Buffer.from(
      'driver /dev/dri/renderD128 failed\n'
      + 'Error opening input: Server returned 503 http://10.1.2.3:5004/auto/v31.1\n',
    ));
    const running = stream.getSessionInfo('31.1', 'h264', 'medium').webvtt;
    assert.equal(running.stderrTail, undefined);
    assert.equal(running.stderrLines, 2, 'activity is still visible as a line count');

    sidecar.finish(1);
    const info = stream.getSessionInfo('31.1', 'h264', 'medium');
    const dump = JSON.stringify(info.webvtt);
    assert.equal(info.webvtt.state, 'failed');
    assert.equal(info.webvtt.reason, 'ffmpeg_exit', 'machine-readable reason is kept');
    assert.match(info.webvtt.lastError, /busy/i, 'sanitized summary keeps the useful cause');
    assert.ok(!/10\.1\.2\.3|5004|dev\/dri|hdhomerun-web-streams|stderrTail/.test(dump), dump);
    assert.ok(logs.some((l) => /webvtt sidecar exited code=1/.test(l) && /10\.1\.2\.3/.test(l)), 'raw detail is logged server-side');

    // Spawn failures too.
    stream.start('31.2', 'h264', 'medium', 20);
    fs.writeFileSync(path.join(stream.channelDir('31.2', 'h264', 'medium'), 'stream.m3u8'), '#EXTM3U\n');
    await stream.attachSession('31.2', 'h264', 'medium');
    spawned[spawned.length - 1].emit('error', new Error("spawn /usr/lib/jellyfin-ffmpeg/ffmpeg ENOENT http://10.1.2.3:5004"));
    const spawnFail = stream.getSessionInfo('31.2', 'h264', 'medium').webvtt;
    assert.equal(spawnFail.reason, 'spawn_error');
    assert.ok(!/10\.1\.2\.3|jellyfin-ffmpeg|5004/.test(spawnFail.lastError), spawnFail.lastError);
  } finally { console.warn = origWarn; }
});

test('/stream/.../stats response omits the VTT file path and sanitizes tuner errors', async () => {
  const stream = freshRequire('stream.js');
  const hdhr = require(src('hdhomerun.js'));
  hdhr.getTunerStatus = async () => { throw new Error('connect ECONNREFUSED 10.1.2.3:80'); };
  stream.getSessionInfoWithCaptions = async (...a) => stream.getSessionInfo(...a);
  delete require.cache[require.resolve(src('routes/watch.js'))];
  stream.start('32.1', 'h264', 'medium', 20);
  const app = express();
  app.use(require(src('routes/watch.js')));
  const server = await listen(app);
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const res = await request(server, 'GET', '/stream/32.1/h264/medium/stats');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(!/10\.1\.2\.3|hdhomerun-web-streams|stderrTail/.test(res.body), res.body);
    assert.equal(body.session.webvtt.path, undefined);
    assert.equal(typeof body.session.webvtt.state, 'string');
    assert.match(body.signalError, /reach the HDHomeRun/);
  } finally { console.warn = origWarn; server.close(); }
});

// ------------------------------------------------ Docker: non-root + health
test('Dockerfile: amd64 Jellyfin ffmpeg7 kept; HEALTHCHECK (unauthenticated /healthz) and non-root entrypoint present', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /Architectures: amd64/);
  assert.match(dockerfile, /jellyfin-ffmpeg7/);
  assert.match(dockerfile, /^HEALTHCHECK .*\\\n\s+CMD \["node", "-e", ".*\/healthz/m);
  assert.match(dockerfile, /^ENTRYPOINT \["\/app\/docker-entrypoint\.sh"\]$/m);
  assert.match(dockerfile, /^CMD \["node", "server\.js"\]$/m);
  const mode = fs.statSync(path.join(__dirname, '..', 'docker-entrypoint.sh')).mode;
  assert.ok(mode & 0o100, 'entrypoint is executable in the repo');
});

test('docker-entrypoint.sh: drops root to node with the GPU node group IDs (stubbed id/stat/setpriv)', () => {
  const bin = fs.mkdtempSync(path.join(process.env.TMPDIR, 'entry-'));
  const dri = path.join(bin, 'dri');
  fs.mkdirSync(dri);
  for (const n of ['renderD128', 'card1', 'card0']) fs.writeFileSync(path.join(dri, n), '');
  const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 }); };
  stub('id', 'echo ${FAKE_UID:-0}');
  stub('stat', 'case "$3" in */renderD128) echo 992;; */card1) echo 44;; */card0) echo ${CARD0_GID:-44};; esac');
  stub('setpriv', 'echo "setpriv $*"');
  const script = fs.readFileSync(path.join(__dirname, '..', 'docker-entrypoint.sh'), 'utf8')
    .replace(/\/dev\/dri\//g, `${dri}/`);
  const runner = path.join(bin, 'entry.sh');
  fs.writeFileSync(runner, script, { mode: 0o755 });
  const run = (env = {}, args = ['node', 'server.js']) => childProcess.spawnSync('/bin/sh', [runner, ...args], {
    env: { PATH: `${bin}:/usr/bin:/bin`, ...env }, encoding: 'utf8',
  });

  let out = run();
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim(), 'setpriv --reuid=node --regid=node --groups 992,44 -- node server.js', 'GIDs de-duplicated');

  out = run({ CARD0_GID: '0' });
  assert.match(out.stdout, /--groups 992,44 /, 'root-owned nodes never grant the root group');

  out = run({ FAKE_UID: '1000' });
  assert.equal(out.stdout.trim(), '', 'already non-root: run directly, no setpriv');
  fs.rmSync(path.join(dri), { recursive: true });
  fs.mkdirSync(dri);
  out = run();
  assert.match(out.stdout, /--clear-groups -- node server\.js/);
  assert.match(out.stderr, /no group-accessible \/dev\/dri/);
});
