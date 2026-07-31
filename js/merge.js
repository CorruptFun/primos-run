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
 * and correct.
 *
 * THE SPENDABLE FIELDS ARE NOT HERE AND MUST NOT BE ADDED. `chelas` is a
 * balance and `shelf` is goods; both are handled below, for stated reasons.
 * Maxing a spendable number across two devices mints it.
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
  const days = {};
  const contDays = {};
  for (const src of [a, b]) {                    // `a` first, so a tie keeps local
    const map = src && src.days;
    if (!map || typeof map !== 'object') continue;
    for (const [key, v] of Object.entries(map)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      const n = Math.floor(v);
      if (key in days && n <= days[key]) continue;
      days[key] = n;
      // The continue mark travels WITH the score it describes. Taking the union
      // instead would mark a day whose winning run was clean, and taking the
      // winner's whole map would drop the mark off a score it kept — either way
      // the board would be telling the player something untrue about a run.
      if (src.contDays && src.contDays[key]) contDays[key] = true;
      else delete contDays[key];
    }
  }
  return { days, contDays };
}

/**
 * BOUGHT GOODS, unioned per item by MAX.
 *
 * Not the winner's shelf. An item sitting unused was paid for with chelas the
 * player actually earned, and letting it ride the progress winner throws that
 * purchase away the first time another device syncs. The opposite error is the
 * cheaper one and it self-corrects: an item consumed on one device can come
 * back once, which costs the game a single power-up, where the other way costs
 * the player money they already spent.
 *
 * No cap here on purpose — wallet.js cleanShelf() clamps to MAX_STOCK on every
 * read and writes the repair back, so this file stays dependency-free instead
 * of carrying a second copy of that constant for the two to drift apart.
 */
function mergeShelf(a, b) {
  const out = {};
  for (const src of [a.shelf, b.shelf]) {
    if (!src || typeof src !== 'object') continue;
    for (const [id, v] of Object.entries(src)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      const count = Math.floor(n);
      if (!(id in out) || count > out[id]) out[id] = count;
    }
  }
  return out;
}

/**
 * The WALLET, and the one-time latch that guards its seed. Three hazards here,
 * and every one of them mints currency.
 *
 * `chelas` MUST NEVER BE MAXED. Spend 500 on the phone, then sync a tablet that
 * still reads 500, and a max hands back what was already spent. It is a
 * balance, not a record — it goes down, which is exactly what LATCHES is not
 * for.
 *
 * `walletSeeded` MUST UNION. It is the latch meaning "this wallet has already
 * been derived from totalBeers" (see js/wallet.js state()). Let a `false` from
 * either side win and the seed runs a SECOND time — against a totalBeers that
 * LATCHES has just maxed — minting the entire lifetime total over again.
 *
 * And unioning that latch sets its own trap. If the progress winner happens to
 * be the side that never seeded, its `chelas` is not a balance at all, it is a
 * zero that means "not derived yet". Forcing seeded=true over it strands the
 * player at nothing with the seed permanently disabled. So when exactly ONE
 * side is seeded, that side's balance is the only real one and it carries.
 *
 * Two seeded sides ride the progress winner like the rest of the record: always
 * a balance some device genuinely held, so nothing is invented. Neither seeded
 * leaves the latch false and the seed still to come, which is correct — it has
 * simply not happened yet on either device.
 */
function pickWallet(a, b, winner) {
  const aSeeded = !!a.walletSeeded;
  const bSeeded = !!b.walletSeeded;
  let src = winner;                              // both seeded, or neither
  if (aSeeded !== bSeeded) src = aSeeded ? a : b;  // exactly one — it holds the real balance
  const n = Number(src.chelas);
  return {
    chelas: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    walletSeeded: aSeeded || bSeeded,
  };
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
  const boards = mergeDays(a, b);
  out.days = boards.days;
  out.contDays = boards.contDays;
  out.shelf = mergeShelf(a, b);
  Object.assign(out, pickWallet(a, b, winner));
  Object.assign(out, pickHandle(a, b));
  return out;
}
