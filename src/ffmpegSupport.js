// Helpers shared by the live-stream and recording-stream ffmpeg supervisors.

const DEFAULT_KILL_GRACE_MS = 5000;

// ffmpeg stderr carries tuner/engine IPs, device paths and driver details, so
// it must never reach clients verbatim. Messages below are short and keep the
// keywords the clients already key off: the browser's streamFailureText()
// looks for "busy"/"tuner"/"timed out"; the Roku StreamStartTask classifier
// looks for "busy", "forbidden", "timed out", "signal" and "channel".
const GENERIC_MESSAGE = 'Stream failed to start. See the server logs for details.';
const RULES = [
  { re: /\bENOENT\b|\bEACCES\b|\bEMFILE\b|\bEAGAIN\b|failed to spawn/i, message: 'ffmpeg could not be started on the server.' },
  {
    re: /resource busy|already in use|all tuners|Server returned 503|HTTP error 503/i,
    message: 'Tuner is busy. Stop another stream and try again.',
  },
  {
    re: /Server returned 40[13]|HTTP error 40[13]|unauthorized|forbidden|access denied/i,
    message: 'Access to this channel was denied (forbidden).',
  },
  { re: /timed out|timeout|ETIMEDOUT/i, message: 'Stream startup timed out. Retrying may help.' },
  {
    re: /Server returned 404|HTTP error 404|Invalid data found|End of file|matches no streams|does not contain any stream|Output file is empty|Could not find codec parameters/i,
    message: 'Channel unavailable or no signal.',
  },
  {
    re: /Connection refused|Connection reset|No route to host|Network is unreachable|Name or service not known|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|Input\/output error/i,
    message: 'Could not reach the HDHomeRun over the network.',
  },
  {
    re: /qsv|libmfx|vaapi|\/dev\/dri|hwaccel|hw device|device creation|Error initializing|Error while opening (?:en|de)coder|Unknown (?:en|de)coder|(?:En|De)coder .* not found|Failed to (?:create|initialize|set)/i,
    message: 'Video encoder failed to start. See the server logs for details.',
  },
];

// Maps raw ffmpeg stderr (or an error message) to a short client-safe message.
// Lines are checked newest-first because the last lines of ffmpeg's output are
// the closest to the actual failure.
function sanitizeFfmpegError(raw, fallback = GENERIC_MESSAGE) {
  const lines = String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    for (const rule of RULES) {
      if (rule.re.test(lines[i])) return rule.message;
    }
  }
  return fallback;
}

function hasExited(proc) {
  return proc.exitCode !== null || proc.signalCode !== null;
}

const pendingKills = new WeakMap();

// SIGTERM, then SIGKILL if the process has still not exited after a grace
// period (ffmpeg blocked on a stalled network read can ignore SIGTERM and
// would otherwise hold its tuner forever). Idempotent per process.
function terminate(proc, graceMs) {
  if (!proc || hasExited(proc) || pendingKills.has(proc)) return;
  const grace = graceMs || Number(process.env.STREAM_KILL_GRACE_MS) || DEFAULT_KILL_GRACE_MS;
  try { proc.kill('SIGTERM'); } catch (err) { /* already gone */ }
  const timer = setTimeout(() => {
    pendingKills.delete(proc);
    if (hasExited(proc)) return;
    console.warn(`[stream] ffmpeg pid=${proc.pid} ignored SIGTERM for ${grace}ms; sending SIGKILL`);
    try { proc.kill('SIGKILL'); } catch (err) { /* already gone */ }
  }, grace);
  timer.unref();
  pendingKills.set(proc, timer);
  proc.once('exit', () => {
    clearTimeout(timer);
    pendingKills.delete(proc);
  });
}

module.exports = { sanitizeFfmpegError, terminate, GENERIC_MESSAGE };
