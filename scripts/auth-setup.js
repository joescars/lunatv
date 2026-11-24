#!/usr/bin/env node
'use strict';
// Generates LunaTV auth secrets without putting them in chat, shell history or
// the repo. Nothing is written unless you redirect it; the plaintext is shown
// once on stderr, the value to configure goes to stdout.
//
//   node scripts/auth-setup.js password        prompts (hidden) -> prints AUTH_ADMIN_PASSWORD_HASH=...
//   node scripts/auth-setup.js token           random Roku/API token; prints AUTH_API_TOKEN_HASH=...
//   node scripts/auth-setup.js secret          random AUTH_SESSION_SECRET=...
//   node scripts/auth-setup.js                 all three, appended-ready `.env` block
//
// Hashes are scrypt (password) and sha256 (high-entropy token); neither contains
// `$`, so they are safe in a Docker Compose `.env` file.
const crypto = require('crypto');
const { hashPassword } = require('../src/auth');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const what = args[0] || 'all';

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { data += c; });
      process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
      process.stdin.on('error', reject);
      return;
    }
    process.stderr.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    stdin.on('data', function onData(ch) {
      for (const c of ch) {
        if (c === '\u0003') { process.stderr.write('\n'); process.exit(130); }
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stderr.write('\n');
          return resolve(value);
        }
        if (c === '\u007f') value = value.slice(0, -1); else value += c;
      }
    });
  });
}

async function password() {
  const first = await promptHidden('Admin password (min 12 chars): ');
  if (first.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
  if (process.stdin.isTTY) {
    const second = await promptHidden('Repeat password: ');
    if (second !== first) { console.error('Passwords do not match.'); process.exit(1); }
  }
  return `AUTH_ADMIN_PASSWORD_HASH=${await hashPassword(first)}`;
}

function token() {
  const t = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(t).digest('hex');
  process.stderr.write(`\nAPI token (shown once; give it to the Roku build as HDHOMERUN_API_TOKEN in roku/.env):\n  ${t}\n\n`);
  return `AUTH_API_TOKEN_HASH=${hash}`;
}

const secret = () => `AUTH_SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`;

(async () => {
  const out = [];
  if (what === 'password' || what === 'all') out.push(await password());
  if (what === 'token' || what === 'all') out.push(token());
  if (what === 'secret' || what === 'all') out.push(secret());
  if (!out.length) { console.error('Usage: node scripts/auth-setup.js [password|token|secret]'); process.exit(1); }
  console.log(out.join('\n'));
})().catch((err) => { console.error(err.message); process.exit(1); });
