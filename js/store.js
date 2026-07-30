// localStorage, defensively — private mode and locked-down browsers throw.

const KEY = 'primos-run.v1';

const DEFAULTS = {
  best: 0,
  bestBeers: 0,
  runs: 0,
  totalBeers: 0,
  character: 'chuy',
  customImage: null,   // URL or data URL for the player's own Primo
  primoNumber: null,   // token number, when it came from the index
  muted: false,
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* out of quota or blocked — the run still plays, it just won't persist */
  }
}
