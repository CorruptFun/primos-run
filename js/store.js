// localStorage, defensively — private mode and locked-down browsers throw.

const KEY = 'primos-run.v1';

// Stamped into `trainedAt` for a save that predates the tutorial. Truthy, so it
// counts as trained, and distinguishable from a real timestamp if we ever care.
const LEGACY = -1;

const DEFAULTS = {
  best: 0,
  bestBeers: 0,
  runs: 0,
  totalBeers: 0,
  character: 'chuy',
  customImage: null,   // URL or data URL for the player's own Primo
  primoNumber: null,   // token number, when it came from the index
  muted: false,
  trainedAt: 0,        // ms timestamp of the training session; 0 = never trained
  // null means "never chosen", which is NOT the same as 'en': it is what lets
  // i18n fall back to the device language. Once the player touches the switch
  // this holds their choice and the device is never consulted again.
  lang: null,
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

export function load() {
  const blob = read();
  if (!blob) return { ...DEFAULTS };
  // Grandfather clause. A save written before the tutorial shipped has no
  // `trainedAt` at all. If it has runs on the clock the player already knows
  // the alley, and being sat down for training would read as a bug — so they
  // are stamped trained on sight. A save with no runs (someone who picked a
  // Primo and closed the tab) is treated as fresh and still gets taught.
  if (blob.trainedAt == null && (blob.runs > 0 || blob.best > 0)) blob.trainedAt = LEGACY;
  return { ...DEFAULTS, ...blob };
}

export function save(data) {
  try {
    // `trainedAt` is written out of band by markTrained(), because the tutorial
    // finishes long after main.js took its copy of the save. Without this
    // guard the next ordinary save() — game over, mute toggle, crew pick —
    // would carry that stale `trainedAt: 0` back to disk and the training
    // would replay forever. Only the untrained path pays for the extra read.
    let out = data;
    if (!data.trainedAt) {
      const prev = read();
      if (prev && prev.trainedAt) out = { ...data, trainedAt: prev.trainedAt };
    }
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* out of quota or blocked — the run still plays, it just won't persist */
  }
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
