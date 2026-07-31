// Reconciling two saves for the same player — the local one and the one the
// cloud had. Pure and dependency-free, so dev/cloud-test.html can hammer it.
//
// This is the one function in the cloud layer that can DESTROY something. A
// wrong board reading is embarrassing; a wrong merge silently eats a player's
// best run and there is no undo. Everything below is written to fail toward
// "keep more", never toward "keep newer".

/**
 * Numbers that only ever go up. Every one of these is a record or a lifetime
 * counter — none is spendable — so taking the MAX of the two sides is both safe
 * and correct. (This is the field-wise union that a currency balance could not
 * have: maxing a spendable number across two devices mints it.)
 */
const LATCHES = ['best', 'bestBeers', 'totalBeers', 'runs'];

/**
 * Pick the record whose PREFERENCES win — chosen crew member, custom Primo,
 * mute — by comparing progress lexicographically. The counters themselves are
 * maxed below regardless, so this vector is only ever deciding which device's
 * settings look more like "the one they actually play on".
 *
 * A dead tie prefers `a`, and callers pass LOCAL first, so an identical cloud
 * never overwrites what is already on the device.
 */
function progressWinner(a, b) {
  const metrics = (s) => [s.best || 0, s.bestBeers || 0, s.totalBeers || 0, s.runs || 0];
  const ma = metrics(a);
  const mb = metrics(b);
  for (let i = 0; i < ma.length; i++) {
    if (mb[i] > ma[i]) return b;
    if (ma[i] > mb[i]) return a;
  }
  return a;
}

/**
 * Per-day bests, unioned by MAX.
 *
 * Not "the winner's map", which is the tempting shortcut and is wrong: two
 * devices played on different days are both telling the truth, and picking a
 * side deletes a board the player is legitimately on. The server keeps its own
 * monotonic copy per (user, day), so a resurrected old day cannot lower
 * anything there either.
 */
function mergeDays(a, b) {
  const out = {};
  for (const src of [a.days, b.days]) {
    if (!src || typeof src !== 'object') continue;
    for (const [key, v] of Object.entries(src)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      const n = Math.floor(v);
      if (!(key in out) || n > out[key]) out[key] = n;
    }
  }
  return out;
}

/**
 * The chosen race name — MOST RECENTLY SET WINS, on its own timestamp.
 *
 * It cannot ride the progress winner. Rename yourself on the phone, then open a
 * tablet that happens to have the better run, and the winner's record would
 * quietly restore the old name — and republish it to every board. Nor is it a
 * latch: a name legitimately changes, and can be cleared, so there is nothing to
 * union. Only recency makes one side right.
 *
 * The recovery case falls out for free: a device whose storage was cleared has
 * handleSetAt 0, so the cloud's stamped name wins and leaderboard.adoptHandle()
 * writes it back to the device.
 */
function pickHandle(a, b) {
  const at = a.handleSetAt || 0;
  const bt = b.handleSetAt || 0;
  const src = bt > at ? b : a;                 // tie → `a` (local), as everywhere else
  return { handle: src.handle ?? null, handleSetAt: src.handleSetAt || 0 };
}

/**
 * Merge local (`a`) with cloud (`b`). Returns a WHOLE record — never a
 * field-wise blend of the two, except for the three categories above that are
 * blended deliberately and for stated reasons.
 */
export function mergeSaves(a, b) {
  const winner = progressWinner(a, b);
  const out = { ...winner };
  for (const k of LATCHES) out[k] = Math.max(a[k] || 0, b[k] || 0);
  out.days = mergeDays(a, b);
  Object.assign(out, pickHandle(a, b));
  return out;
}
