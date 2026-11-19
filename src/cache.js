const store = new Map();
const SWEEP_INTERVAL_MS = 60_000;

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  return entry.value;
}

function set(key, value, ttlMs) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function clear(key) {
  if (typeof key === 'string') {
    store.delete(key);
    return;
  }
  store.clear();
}

// Drops every key starting with `prefix`. Used for keys that embed a changing
// suffix (e.g. a time slot) so callers don't have to reconstruct it.
function clearPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

// get() only evicts the key it is asked about, so keys that are never read
// again (e.g. slim guide keys that change every 30 minutes) would otherwise
// stay in memory forever.
function sweep(now = Date.now()) {
  let removed = 0;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

setInterval(sweep, SWEEP_INTERVAL_MS).unref();

module.exports = {
  get,
  set,
  clear,
  clearPrefix,
  sweep,
};
