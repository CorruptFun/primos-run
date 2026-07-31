// localStorage, defensively — private mode and locked-down browsers throw.
//
// This stays the AUTHORITATIVE copy of a player's progress even once cloud save
// is on. The cloud is a mirror: js/cloud.js pulls it at boot, merges, writes the
// winner back through here, and pushes from here afterwards. Losing the network
// therefore loses freshness and nothing else, and the game runs identically with
// the cloud switched off entirely.

const KEY = 'primos-run.v1';

// Stamped into `trainedAt` for a save that predates the tutorial. Truthy, so it
// counts as trained, and distinguishable from a real timestamp if we ever care.
const LEGACY = -1;

// Fields the wallet owns. They are read/modified/written straight against
// storage by js/wallet.js, never through a caller's in-memory blob — see
// readEcon/writeEcon at the bottom of this file and the guard in save().
const ECON_KEYS = ['chelas', 'shelf', 'walletSeeded'];

const DEFAULTS = {
  best: 0,
  bestBeers: 0,
  runs: 0,
  totalBeers: 0,
  // Spendable, and NOT the same number as totalBeers: that one is a lifetime
  // stat the menu shows and it must never go down. `chelas` is a wallet — it
  // banks at the end of a run and la tiendita draws it back down.
  chelas: 0,
  // Bought and not yet used: { itemId: count }. One of each is consumed at the
  // start of the next run.
  shelf: null,
  // Set once, the first time js/wallet.js looks at this save, so the one-time
  // seed from totalBeers can never run twice.
  walletSeeded: false,
  character: 'chuy',
  customImage: null,   // URL or data URL for the player's own Primo
  primoNumber: null,   // token number, when it came from the index
  muted: false,
  trainedAt: 0,        // ms timestamp of the training session; 0 = never trained
  // null means "never chosen", which is NOT the same as 'en': it is what lets
  // i18n fall back to the device language. Once the player touches the switch
  // this holds their choice and the device is never consulted again.
  lang: null,
  // --- cloud/leaderboard fields ---------------------------------------------
  days: {},            // { 'YYYY-MM-DD': best score that day } — the daily board's source
  handle: null,        // chosen race name; null means "show the anonymous one"
  handleSetAt: 0,      // when it was chosen — the merge tiebreak (see js/merge.js)
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw);
    return blob && typeof blob === 'object' ? blob : null;
  } catch {
    return null;
  }
}

/**
 * Force a restored blob into the expected SHAPE.
 *
 * Everything here arrives from storage, a pasted backup code, or another
 * device's cloud row, so none of it can be trusted to be well-formed — a
 * truncated code or a hand-edited entry must degrade to defaults rather than
 * put a NaN into a leaderboard submission. Unknown keys are preserved so a save
 * written by a NEWER build survives a round-trip through an older one.
 *
 * `trainedAt` and `lang` are deliberately NOT coerced: LEGACY is -1, which the
 * positive-number rule below would flatten to 0 and replay the training for
 * every grandfathered player.
 */
export function coerce(raw) {
  const out = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  for (const k of ['best', 'bestBeers', 'runs', 'totalBeers', 'handleSetAt']) {
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  out.muted = !!out.muted;
  out.handle = typeof out.handle === 'string' && out.handle.trim() !== '' ? out.handle : null;
  const days = {};
  if (out.days && typeof out.days === 'object') {
    for (const [key, v] of Object.entries(out.days)) {
      const n = Number(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(n) && n > 0) days[key] = Math.floor(n);
    }
  }
  out.days = days;
  return out;
}

export function load() {
  const blob = read();
  if (!blob) return coerce(null);
  // Grandfather clause. A save written before the tutorial shipped has no
  // `trainedAt` at all. If it has runs on the clock the player already knows
  // the alley, and being sat down for training would read as a bug — so they
  // are stamped trained on sight. A save with no runs (someone who picked a
  // Primo and closed the tab) is treated as fresh and still gets taught.
  if (blob.trainedAt == null && (blob.runs > 0 || blob.best > 0)) blob.trainedAt = LEGACY;
  return coerce(blob);
}

// Persist subscribers. js/cloud.js registers one at boot so every existing
// store.save() call site debounce-pushes to the cloud without any of them
// having to know the cloud exists.
const listeners = new Set();

/** Subscribe to persists. Returns an unsubscribe fn. */
export function onSave(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function save(data) {
  try {
    const prev = read();
    // `trainedAt` is written out of band by markTrained(), because the tutorial
    // finishes long after main.js took its copy of the save. Without this
    // guard the next ordinary save() — game over, mute toggle, crew pick —
    // would carry that stale `trainedAt: 0` back to disk and the training
    // would replay forever.
    let out = data;
    if (!data.trainedAt && prev && prev.trainedAt) out = { ...data, trainedAt: prev.trainedAt };
    // Same hazard, same fix, for the money: main.js holds ONE copy of the save
    // taken at boot, and a purchase made three screens later moves the balance
    // on disk without touching that copy. Whatever is on disk wins for these
    // keys, always — otherwise the next mute toggle refunds the shop.
    if (prev) {
      for (let i = 0; i < ECON_KEYS.length; i++) {
        const k = ECON_KEYS[i];
        if (prev[k] !== undefined) {
          if (out === data) out = { ...data };
          out[k] = prev[k];
        }
      }
    }
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* out of quota or blocked — the run still plays, it just won't persist */
  }
  // Notified even when the write above failed: a blocked localStorage is exactly
  // the case where getting the save into the cloud matters most. Each listener
  // is isolated so one throwing can never break a persist.
  for (const l of listeners) {
    try { l(data); } catch { /* a listener must not cascade into the game */ }
  }
}

// --- device backup ----------------------------------------------------------
// Deliberately independent of sign-in. A file in Downloads survives clearing
// site data, which is the exact event that loses everything else, and it is the
// only durability on offer before the cloud is configured at all.

/** The whole save as a paste-able code, or '' if it can't be produced. */
export function exportSave() {
  try {
    // The unescape/encodeURIComponent sandwich is not decoration: plain btoa
    // throws on any non-Latin-1 character, and player-chosen race names contain
    // them constantly.
    return btoa(unescape(encodeURIComponent(JSON.stringify(load()))));
  } catch {
    return '';
  }
}

/** Restore from a code. Returns false (and changes nothing) if it isn't one. */
export function importSave(code) {
  try {
    const json = decodeURIComponent(escape(atob(String(code).trim())));
    const data = coerce(JSON.parse(json));
    if (!data || typeof data !== 'object') return false;
    save(data);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------- economy
// The seam js/wallet.js sits on. Everything money-shaped goes through these
// two, so a cloud save can later wrap wallet.js without any screen learning
// that storage moved.

/** The raw economy fields, exactly as they sit on disk. May be junk. */
export function readEcon() {
  const blob = read() || {};
  return {
    chelas: blob.chelas,
    shelf: blob.shelf,
    walletSeeded: blob.walletSeeded,
    totalBeers: blob.totalBeers,
  };
}

/**
 * Read/modify/write against storage in one go, so a spend and the thing it
 * bought can never tear apart.
 * @param {(blob: object) => void} fn mutates the blob in place
 */
export function writeEcon(fn) {
  const blob = read() || {};
  fn(blob);
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
  } catch {
    /* blocked — the purchase still applies to this session, it just won't persist */
  }
  return blob;
}

// ------------------------------------------------------------------ training
// Read/modify/write straight against storage rather than through a caller's
// in-memory blob, so finishing the tutorial can never clobber a stat and a
// stat can never clobber the tutorial flag.

export function isTrained() {
  const blob = read();
  if (!blob) return false;
  if (blob.trainedAt) return true;
  return blob.trainedAt == null && (blob.runs > 0 || blob.best > 0);
}

export function markTrained() {
  const blob = read() || {};
  blob.trainedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
  } catch {
    /* nothing to do — they will simply be offered the training again */
  }
}

/** Dev hook. A reload is the honest way to see it, since main.js caches load(). */
export function clearTrained() {
  const blob = read();
  if (!blob) return;
  blob.trainedAt = 0;
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
  } catch {
    /* ignore */
  }
}
