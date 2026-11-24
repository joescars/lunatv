const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { sanitizeFfmpegError, terminate } = require('./ffmpegSupport');
const { getAccelerator } = require('./hwAccel');

// Recordings are software-decoded and encoded with the configured hardware
// accelerator's H.264 encoder (h264_qsv or h264_nvenc).
const ACCEL = getAccelerator();
const ROOT = path.join(os.tmpdir(), 'hdhomerun-web-recordings');
const IDLE_TIMEOUT_MS = 60_000;
// A recording that transcoded to EOF is a complete VOD; keep it seekable longer than a live session.
const FINISHED_IDLE_MS = 10 * 60_000;
const PROFILES = {
  low: { videoBitrate: '1800k', maxrate: '2200k', bufsize: '3600k', audioBitrate: '96k' },
  medium: { videoBitrate: '3200k', maxrate: '4200k', bufsize: '6400k', audioBitrate: '128k' },
  high: { videoBitrate: '5200k', maxrate: '6800k', bufsize: '9600k', audioBitrate: '160k' },
};
const sessions = new Map();

function normalizeProfile(profile) {
  return PROFILES[profile] ? profile : 'medium';
}

function key(id, profile) {
  return `${id}:${normalizeProfile(profile)}`;
}

function finished(session) {
  return session.process.exitCode === 0 && fs.existsSync(session.playlist);
}

function stop(session, sessionKey) {
  if (!session) return;
  if (session.process.exitCode === null) {
    // Remember the intent: ffmpeg usually exits 0 on SIGTERM, which must not
    // be mistaken for a naturally completed VOD in the exit handler.
    session.stopRequested = true;
    terminate(session.process);
    return;
  }
  // Already exited (e.g. finished VOD kept for seeking): stop means release it.
  if (sessionKey && sessions.get(sessionKey) === session) {
    fs.rmSync(session.dir, { recursive: true, force: true });
    sessions.delete(sessionKey);
  }
}

function start(id, sourceUrl, profile) {
  const normalizedProfile = normalizeProfile(profile);
  const sessionKey = key(id, normalizedProfile);
  const existing = sessions.get(sessionKey);
  if (existing && !existing.spawnError && existing.process.exitCode === null && !existing.process.killed) {
    existing.lastAccess = Date.now();
    return existing;
  }
  if (existing && !existing.spawnError && finished(existing)) {
    existing.lastAccess = Date.now();
    return existing;
  }

  // Unique per session: a restart must not rm/mkdir a directory an older,
  // still-shutting-down ffmpeg for the same id/profile may be writing into.
  const dir = path.join(ROOT, `${id}-${normalizedProfile}-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  const config = PROFILES[normalizedProfile];
  const playlist = path.join(dir, 'stream.m3u8');
  const process = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning',
    '-i', sourceUrl,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', ACCEL.encoders.h264, ...ACCEL.encoderArgs,
    '-b:v', config.videoBitrate, '-maxrate', config.maxrate, '-bufsize', config.bufsize,
    '-g', '30', '-force_key_frames', 'expr:eq(n,0)+gte(t,n_forced*1)',
    '-c:a', 'aac', '-b:a', config.audioBitrate, '-ac', '2',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(dir, 'segment%d.ts'),
    playlist,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  process.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });
  const session = { process, dir, playlist, lastAccess: Date.now(), stderr: () => stderr };
  sessions.set(sessionKey, session);
  process.on('error', (err) => {
    stderr = `${stderr}${err && err.message ? err.message : 'ffmpeg failed to spawn'}\n`.slice(-4000);
    console.error(`[recording-stream] ffmpeg error id=${id}: ${err && err.message}`);
    session.spawnError = err && err.message ? err.message : 'ffmpeg failed to spawn';
    fs.rmSync(dir, { recursive: true, force: true });
    // 'exit' never fires on spawn failure; drop the failed session after the idle window.
    setTimeout(() => {
      if (sessions.get(sessionKey) === session) sessions.delete(sessionKey);
    }, IDLE_TIMEOUT_MS).unref();
  });
  process.on('exit', (code) => {
    const owner = sessions.get(sessionKey) === session;
    // Clean EOF of the current session: keep the finished playlist
    // (EXT-X-ENDLIST) and segments so the player can finish and seek; the idle
    // sweep / stop removes them.
    if (code === 0 && owner && !session.stopRequested) return;
    if (code !== 0 && stderr) {
      console.warn(`[recording-stream] ffmpeg tail id=${id}: ${stderr.replace(/\s+/g, ' ').trim().slice(-1200)}`);
    }
    // The dir is unique to this session, so removing it is always safe -
    // including after a restart replaced this session in the map.
    fs.rmSync(dir, { recursive: true, force: true });
    if (!owner) return;
    if (session.stopRequested) {
      // Explicit stop: release the session now; a replacement (not owner) is untouched.
      sessions.delete(sessionKey);
      return;
    }
    setTimeout(() => {
      if (sessions.get(sessionKey) === session) sessions.delete(sessionKey);
    }, IDLE_TIMEOUT_MS).unref();
  });
  return session;
}

function get(id, profile) {
  const session = sessions.get(key(id, profile));
  if (session) session.lastAccess = Date.now();
  return session || null;
}

function stopById(id, profile) {
  const sessionKey = key(id, profile);
  stop(sessions.get(sessionKey), sessionKey);
}

function isReady(id, profile) {
  const session = get(id, profile);
  if (!session) return { ready: false, error: 'Recording stream has not started' };
  if (session.spawnError) return { ready: false, error: sanitizeFfmpegError(session.spawnError) };
  if (fs.existsSync(session.playlist)) return { ready: true };
  if (session.process.exitCode !== null) return { ready: false, error: sanitizeFfmpegError(session.stderr(), 'Transcoder stopped') };
  return { ready: false };
}

setInterval(() => {
  const now = Date.now();
  for (const [sessionKey, session] of sessions) {
    const limit = session.process.exitCode === 0 ? FINISHED_IDLE_MS : IDLE_TIMEOUT_MS;
    if (now - session.lastAccess > limit) stop(session, sessionKey);
  }
}, 15_000).unref();

module.exports = { start, stopById, get, isReady, normalizeProfile, PROFILES, _sessions: sessions };
