'use strict';
// Static checks for the Roku package plus an end-to-end probe of roku/deploy.sh
// against a local fake Roku (digest auth). No device is contacted.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const test = require('node:test');

const roku = path.join(__dirname, '..', 'roku');
const read = (file) => fs.readFileSync(path.join(roku, file), 'utf8');
const components = fs.readdirSync(path.join(roku, 'components'));

test('every component script reference resolves and each component is well-formed', () => {
  for (const file of components.filter((f) => f.endsWith('.xml'))) {
    const xml = read(`components/${file}`);
    assert.match(xml, /<component name="[^"]+" extends="[^"]+"/, file);
    for (const [, uri] of xml.matchAll(/uri="([^"]+\.brs)"/g)) {
      const name = uri.replace(/^pkg:\/components\//, '');
      assert.ok(components.includes(name), `${file} references missing ${uri}`);
    }
  }
});

test('BrightScript function/sub blocks are balanced', () => {
  for (const file of components.filter((f) => f.endsWith('.brs'))) {
    const code = read(`components/${file}`).split('\n').map((l) => l.replace(/"[^"]*"/g, '""').replace(/'.*$/, ''));
    const count = (re) => code.filter((l) => re.test(l.trim())).length;
    assert.equal(count(/^function\s/i), count(/^end function$/i), `${file} function`);
    assert.equal(count(/^sub\s/i), count(/^end sub$/i), `${file} sub`);
  }
});

test('network I/O stays inside Net.brs helpers called from Tasks', () => {
  for (const file of components.filter((f) => f.endsWith('.brs') && f !== 'Net.brs')) {
    assert.doesNotMatch(read(`components/${file}`), /roUrlTransfer/, `${file} must use Net_Http*`);
  }
  for (const file of ['RecordingStopTask', 'RecordingStreamTask', 'StreamStopTask']) {
    assert.match(read(`components/${file}.xml`), /extends="Task"/);
    assert.match(read(`components/${file}.xml`), /Net\.brs/);
  }
});

test('Net.brs configures a CA bundle for https URLs on both GET and POST', () => {
  const net = read('components/Net.brs');
  assert.match(net, /SetCertificatesFile\("common:\/certs\/ca-bundle\.crt"\)/);
  assert.match(net, /InitClientCertificates\(\)/);
  assert.equal((net.match(/Net_ConfigureTls\(xfer, url\)/g) || []).length, 2);
});

test('recording player releases its transcode on Back and trims errors', () => {
  const screen = read('components/RecordingPlayerScreen.brs');
  const back = screen.slice(screen.indexOf('key = "back"'), screen.indexOf('end function', screen.indexOf('key = "back"')));
  assert.match(back, /requestRecordingStop\(\)/);
  assert.match(screen, /RecordingStopTask/);
  assert.match(read('components/RecordingStopTask.brs'), /"\/recordings\/" \+ m\.top\.recordingId \+ "\/" \+ profile \+ "\/stop"/);
  assert.match(screen, /friendlyError\("Playback failed", reason\)/);
  assert.match(read('components/RecordingStreamTask.brs'), /state\.failed = true/);
  for (const xml of ['PlayerScreen', 'RecordingPlayerScreen']) assert.match(read(`components/${xml}.xml`), /ErrorText\.brs/);
  assert.equal((fs.readFileSync(path.join(roku, 'components/PlayerScreen.brs'), 'utf8').match(/function friendlyError/g) || []).length, 0);
});

test('manifest build_version is bumped past 65', () => {
  assert.ok(Number(read('manifest').match(/^build_version=(\d+)$/m)[1]) >= 66);
});

// ---- deploy.sh against a fake Roku ---------------------------------------
const PASSWORD = 'p"a\\ss w0rd';

function startFakeRoku(status) {
  const seen = { authorized: false, archive: false, bodyLength: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const header = req.headers.authorization;
      if (!header) {
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="rokudev", qop="auth", nonce="abc123", opaque="op"' });
        return res.end();
      }
      const p = Object.fromEntries([...header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map((m) => [m[1], m[2] ?? m[3]]));
      const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
      const ha1 = md5(`rokudev:rokudev:${PASSWORD}`);
      const ha2 = md5(`${req.method}:${p.uri}`);
      const expected = md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:auth:${ha2}`);
      seen.authorized = p.response === expected;
      const body = Buffer.concat(chunks).toString('latin1');
      seen.archive = body.includes('name="archive"') && body.includes('manifest');
      seen.bodyLength = body.length;
      setTimeout(() => {
        res.writeHead(seen.authorized ? status : 401, { 'Content-Type': 'text/html' });
        res.end('<html><body><font color="red">Install Success</font></body></html>');
      }, 1500);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

function runDeploy(port) {
  const cwd = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'roku-deploy-'));
  return new Promise((resolve) => {
    const child = spawn('bash', [path.join(roku, 'deploy.sh')], {
      env: { ...process.env, ROKU_IP: `127.0.0.1:${port}`, ROKU_DEV_PASSWORD: PASSWORD, HDHOMERUN_WEB_URL: '' },
      cwd,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    // Sample the process list while curl is uploading: the password must not be in it.
    let psSnapshot = '';
    setTimeout(() => { psSnapshot = execFileSync('ps', ['-eo', 'args']).toString(); }, 700);
    child.on('close', (code) => resolve({ code, out, psSnapshot }));
  });
}

test('deploy.sh authenticates via stdin config, never exposing the password in ps', async () => {
  const { server, seen, port } = await startFakeRoku(200);
  try {
    const result = await runDeploy(port);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Installed\./);
    assert.ok(seen.authorized, 'digest credentials (incl. quote/backslash/space) accepted');
    assert.ok(seen.archive, 'archive uploaded with manifest');
    assert.ok(result.psSnapshot.includes('plugin_install'), 'ps sampled while curl was running');
    assert.ok(!result.psSnapshot.includes('w0rd'), 'password must not appear on any command line');
  } finally { server.close(); }
});

test('deploy.sh reports a non-2xx upload as a failure without --fail-with-body', async () => {
  const { server, port } = await startFakeRoku(500);
  try {
    const result = await runDeploy(port);
    assert.equal(result.code, 1);
    assert.match(result.out, /Upload failed/);
  } finally { server.close(); }
});

test('deploy.sh no longer relies on --fail-with-body or -u password', () => {
  const sh = read('deploy.sh');
  assert.doesNotMatch(sh, /--fail-with-body/);
  assert.doesNotMatch(sh, /-u "rokudev/);
});
