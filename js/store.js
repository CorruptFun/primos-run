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

// Fields written STRAIGHT AGAINST STORAGE — by js/wallet.js and js/referrals.js
// — never through a caller's in-memory blob. See readEcon/writeEcon at the
// bottom of this file and the guard in save(): for these keys whatever is on
// disk always wins, because the caller's copy is routinely older than they are.
//
// The referral pair is here for exactly the wallet's reason and one sharper one.
// `referralWelcomeClaimed` is the latch that makes the newcomer's welcome chelas
// a one-time grant; it flips long after main.js took its copy of the save, so
// without this the next ordinary save() — a mute toggle, a crew pick — would
// carry the stale `false` back to disk and the welcome could be collected
// again, and again, minting currency. `referredBy` is set once at boot from a
// ?ref= link, before there is any account to attach it to.
const ECON_KEYS = ['chelas', 'shelf', 'walletSeeded', 'referredBy', 'referralWelcomeClaimed'];

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
  // { 'YYYY-MM-DD': true } for the days whose BEST was bought a continue. Only
  // marked days are listed, so an untouched save carries nothing.
  contDays: {},
  handle: null,        // chosen race name; null means "show the anonymous one"
  handleSetAt: 0,      // when it was chosen — the merge tiebreak (see js/merge.js)
  // --- referral fields (js/referrals.js) -------------------------------------
  // The invite code this player arrived on, mirrored out of the ?ref= stash so
  // the ACCOUNT screen can say they were invited. SET ONCE — the first inviter
  // wins, here and in the stash. null means they came on their own.
  referredBy: null,
  // Spent latch for the one-time welcome grant. Unioned by js/merge.js, never
  // taken from the progress winner: a re-opened latch pays the welcome twice.
  referralWelcomeClaimed: false,
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
  const contDays = {};
  if (out.contDays && typeof out.contDays === 'object') {
    // Truthy only, and only against a real day key: this rides into a board
    // submission, so a hand-edited entry must not put a string on the wire.
    for (const [key, v] of Object.entries(out.contDays)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && v) contDays[key] = true;
    }
  }
  out.contDays = contDays;
  // Referral fields. `referredBy` rides into a cloud lookup, so a hand-edited or
  // truncated value must degrade to "no inviter" rather than go on the wire —
  // the same shape rule js/referrals.js applies to the stash.
  out.referredBy = typeof out.referredBy === 'string' && /^[A-Z0-9]{6}$/.test(out.referredBy)
    ? out.referredBy
    : null;
  out.referralWelcomeClaimed = out.referralWelcomeClaimed === true;
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

/**
 * Hand the subscribers the blob that is now AUTHORITATIVE — what went to disk,
 * never what a caller happened to be holding. The two differ: save() restores
 * the econ fields from disk over a caller's stale copy, and pushing the copy
 * instead would mirror a stale balance over a correct one in the cloud.
 */
function notify(blob) {
  for (const l of listeners) {
    try { l(blob); } catch { /* a listener must not cascade into the game */ }
  }
}

/**
 * @param {object} data
 * @param {boolean} [econIsAuthoritative] skip the econ-restore below and write
 *   the caller's money as given. ONLY the cloud reconcile may pass this: its
 *   input is a fresh load() merged against the remote row, so it already holds
 *   the newest local balance. Every other caller is holding a boot-time copy
 *   that predates the shop, which is exactly what the restore protects.
 */
export function save(data, econIsAuthoritative = false) {
  let out = data;
  try {
    const prev = read();
    // `trainedAt` is written out of band by markTrained(), because the tutorial
    // finishes long after main.js took its copy of the save. Without this
    // guard the next ordinary save() — game over, mute toggle, crew pick —
    // would carry that stale `trainedAt: 0` back to disk and the training
    // would replay forever.
    if (!data.trainedAt && prev && prev.trainedAt) out = { ...data, trainedAt: prev.trainedAt };
    // Same hazard, same fix, for the money: main.js holds ONE copy of the save
    // taken at boot, and a purchase made three screens later moves the balance
    // on disk without touching that copy. Whatever is on disk wins for these
    // keys, always — otherwise the next mute toggle refunds the shop.
    if (prev && !econIsAuthoritative) {
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
  // the case where getting the save into the cloud matters most.
  notify(out);
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
  const before = JSON.stringify(blob);
  fn(blob);
  const after = JSON.stringify(blob);
  // A refused purchase runs this with a no-op fn. Returning early keeps the
  // push beat meaning "money MOVED" rather than "someone asked", so being short
  // at the counter costs no traffic and no redundant upsert.
  if (after === before) return blob;
  try {
    localStorage.setItem(KEY, after);
  } catch {
    /* blocked — the purchase still applies to this session, it just won't persist */
  }
  // Money moved, so the cloud has to hear about it. The push is a save()
  // listener and nothing on this path goes through save(), which is why a spend
  // or a shelf item used to be invisible to it. Coerced because `blob` is a
  // bare {} on a first-ever write and a partial row must never reach the cloud.
  //
  // One fn, one write, one notify — so a purchase and the spend that paid for
  // it are mirrored together or not at all. See wallet.buy().
  notify(coerce(blob));
  return blob;
}

// ------------------------------------------------------------------ training
// Read/modify/write straight against storage rather than through a caller's
// in-memory blob, so finishing the tutorial can never clobber a stat and a
// stat can never clobber the tutorial flag.
//
// Both writers below therefore bypass save() — and so must notify() by hand, for
// the same reason writeEcon() does: the cloud push is a save() listener (see
// js/cloud.js), so a write that never reaches it never reaches the cloud. That
// is not cosmetic here. `trainedAt` stuck on disk means a player who finishes
// the training on a phone gets sat down for it again on a tablet.

export function isTrained() {
  const blob = read();
  if (!blob) return false;
  if (blob.trainedAt) return true;
  return blob.trainedAt == null && (blob.runs > 0 || blob.best > 0);
}

export function markTrained() {
  const blob = read() || {};
  // Already taught — a real stamp or a grandfathered LEGACY. Re-stamping would
  // move the number without changing the answer to "has this player been
  // taught", and every write here costs a cloud upsert, so nothing moved and
  // nothing is sent. finishTutorial()'s "never again" guarantee is unaffected:
  // it is the existing truthy value that provides it.
  if (blob.trainedAt) return;
  blob.trainedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
  } catch {
    /* nothing to do — they will simply be offered the training again */
  }
  // Coerced for the same reason writeEcon() coerces: `blob` is a bare {} on a
  // first-ever write and a partial row must never reach the cloud. `trainedAt`
  // itself passes through coerce() untouched, by design — see the note there.
  notify(coerce(blob));
}

/** Dev hook. A reload is the honest way to see it, since main.js caches load(). */
export function clearTrained() {
  const blob = read();
  if (!blob) return;
  // Already cleared, so nothing moves. Note ABSENT is not cleared: a save that
  // predates the tutorial has no `trainedAt` key at all and still reads as
  // trained (see isTrained), so writing the 0 over it is the thing that clears
  // it. `undefined === 0` is false, which is exactly the wanted answer.
  if (blob.trainedAt === 0) return;
  blob.trainedAt = 0;
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
  } catch {
    /* ignore */
  }
  // Mirrored like markTrained, so the cloud row matches the device. The merge
  // latches "has trained at all" (js/merge.js pickTrained), so the next
  // reconcile against a device that HAS been taught will set this back — this
  // clears the tutorial here and now, which is all the dev hook is for.
  notify(coerce(blob));
}

// ------------------------------------------------------------------ referrals
// Written straight against storage for the same reason as the two above: this
// happens at BOOT, from a ?ref= link, long before main.js has a save in hand —
// and on a page load where the player may never sign in at all.

/**
 * Record the invite code this player arrived on. SET ONCE: an existing code is
 * never overwritten, so a second invite link cannot reassign a player who is
 * already somebody's referral. Mirrors the same rule the localStorage stash
 * enforces in js/referrals.js — both have to hold, because either one alone can
 * be cleared independently of the other.
 */
export function setReferredBy(code) {
  const clean = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) return;
  const blob = read() || {};
  if (blob.referredBy) return;               // first inviter wins — nothing moves
  blob.referredBy = clean;
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
  } catch {
    /* blocked — the stash is still authoritative for registration */
  }
  // Coerced for the same reason writeEcon() and markTrained() coerce: `blob` is
  // a bare {} on a first-ever write and a partial row must never reach the cloud.
  notify(coerce(blob));
}
