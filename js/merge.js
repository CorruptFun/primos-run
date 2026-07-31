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
 *
 * `trainedAt` is not here either, for the opposite reason — it IS a latch, but
 * one a max silently breaks. See pickTrained().
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
 * GEAR OWNED, unioned — mergeShelf's reasoning without the counts. A mask was
 * paid for with chelas the player actually earned, and a merge must never
 * delete a purchase. There is no "came back once" cost here at all: gear is a
 * latch per item, not a stock, so the union is simply correct.
 */
function mergeGear(a, b) {
  const out = {};
  for (const src of [a && a.gear, b && b.gear]) {
    if (!src || typeof src !== 'object') continue;
    for (const [id, v] of Object.entries(src)) {
      if (typeof id === 'string' && id && v === true) out[id] = true;
    }
  }
  return out;
}

/**
 * WHAT IS WORN — the handle's rule, for the handle's reason. Wearing a mask is
 * a preference, not progress: the device you dressed yourself on last is the
 * one telling the truth, and riding the progress winner would quietly change
 * the player's outfit because a different device had the better run. Carried
 * as-is (readers re-clean the shape), tie keeps local like everywhere else.
 *
 * A worn item the merged gear no longer owns is NOT possible by construction —
 * gear is unioned above, so anything either side could wear, the merged save
 * owns. wallet.js re-validates on read anyway, because a hand-edited save can
 * claim to wear anything.
 */
function pickFit(a, b) {
  const at = a.fitSetAt || 0;
  const bt = b.fitSetAt || 0;
  const src = bt > at ? b : a;
  return { fit: src.fit ?? null, fitSetAt: src.fitSetAt || 0 };
}

/**
 * LA RACHA — the side with the LATER DAY wins; same day, the longer streak.
 *
 * Never summed and never maxed blind: a streak is a fact about consecutive
 * days, and the device that counted a run most recently holds the freshest
 * fact. Maxing lengths across different days would resurrect a streak that
 * already broke (phone shows a 9 from last month, tablet a 2 from today — the
 * 2 is the truth). Same-day max covers the fresh-device case: both counted
 * today, but one carries the history.
 *
 * The BONUS this record gates is out of scope here, deliberately: it was paid
 * into whichever balance pickWallet keeps, in the same write that stamped the
 * day. Nothing in this function can re-open a paid day, which is the property
 * that matters.
 */
function pickRacha(a, b) {
  const clean = (r) => {
    if (!r || typeof r !== 'object') return { len: 0, day: '' };
    const n = Number(r.len);
    const len = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    const day = typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : '';
    return len && day ? { len, day } : { len: 0, day: '' };
  };
  const ra = clean(a.racha);
  const rb = clean(b.racha);
  if (!ra.day && !rb.day) return { racha: null };
  if (ra.day === rb.day) return { racha: { len: Math.max(ra.len, rb.len), day: ra.day } };
  // Day keys compare lexicographically in chronological order.
  return { racha: ra.day > rb.day ? ra : rb };
}

/**
 * LOS JALES — later day wins outright; same day unions `done` and takes max
 * progress per stat.
 *
 * Discarding the older day wholesale is the point of a daily, not a loss. The
 * same-day union can let two devices played offline pay the same jale once
 * each — bounded at the day's 70-chela ceiling, and partly self-cancelling
 * because pickWallet keeps only one side's balance. Accepted and documented in
 * docs/GAME_DESIGN.md. What the union may never do is UN-pay: `done` and
 * `sweepPaid` only ever accumulate here, so a paid jale stays paid and cannot
 * pay again on either device.
 */
function pickJales(a, b) {
  const clean = (j) => {
    if (!j || typeof j !== 'object') return null;
    const day = typeof j.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.day) ? j.day : '';
    if (!day) return null;
    const prog = {};
    if (j.prog && typeof j.prog === 'object') {
      for (const [k, v] of Object.entries(j.prog)) {
        const n = Number(v);
        if (typeof k === 'string' && Number.isFinite(n) && n > 0) prog[k] = Math.floor(n);
      }
    }
    const done = {};
    if (j.done && typeof j.done === 'object') {
      for (const [k, v] of Object.entries(j.done)) {
        if (typeof k === 'string' && v === true) done[k] = true;
      }
    }
    return { day, prog, done, sweepPaid: j.sweepPaid === true };
  };
  const ja = clean(a.jales);
  const jb = clean(b.jales);
  if (!ja && !jb) return { jales: null };
  if (!ja || !jb || ja.day !== jb.day) {
    if (!ja) return { jales: jb };
    if (!jb) return { jales: ja };
    return { jales: ja.day > jb.day ? ja : jb };
  }
  const prog = { ...ja.prog };
  for (const [k, v] of Object.entries(jb.prog)) {
    if (!(k in prog) || v > prog[k]) prog[k] = v;
  }
  return {
    jales: {
      day: ja.day,
      prog,
      done: { ...ja.done, ...jb.done },
      sweepPaid: ja.sweepPaid || jb.sweepPaid,
    },
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
 * THE TUTORIAL LATCH — "has this player been taught at all", never "when".
 *
 * It cannot ride the progress winner. Finish the training on a phone and sign in
 * on a tablet and NEITHER side has a run yet, so every metric in progressWinner
 * ties, the tie prefers local, and the tablet's `trainedAt: 0` sits the player
 * back down for a course they already did. The tie is not the unlucky case here,
 * it is the ordinary one: finishing the tutorial is the moment before the first
 * run, so a freshly-taught save looks identical to an untouched one.
 *
 * Nor can it join LATCHES. A save that predates the tutorial carries the
 * sentinel -1 (LEGACY in js/store.js — a marker, not a timestamp), and
 * Math.max(-1, 0) is 0. That would replay the training for every grandfathered
 * player, which is the exact thing the sentinel exists to prevent.
 *
 * So: a real stamp beats the sentinel, the sentinel beats never-trained, and
 * only "neither side has trained" comes out untrained. Nothing here can move a
 * player from trained back to untrained, which is the whole property. The -1 is
 * returned by carrying whichever side holds it rather than by naming it, so this
 * file stays dependency-free with no second copy of the constant to drift.
 */
function pickTrained(a, b) {
  const at = Number(a.trainedAt) || 0;               // absent / NaN / junk → 0
  const bt = Number(b.trainedAt) || 0;
  if (at > 0 || bt > 0) return Math.max(at, bt);     // a real session wins, newest of the two
  return at || bt || 0;                              // else the sentinel, if either side holds it
}

/**
 * THE REFERRAL PAIR — a spent latch and a set-once label. The latch is the one
 * that matters, and it mints chelas if it rides the progress winner.
 *
 * `referralWelcomeClaimed` MUST UNION, for walletSeeded's reason sharpened by
 * pickTrained's. It means "the welcome grant has been spent", so letting a
 * `false` from either side win pays it a second time — js/referrals.js
 * claimWelcome() checks exactly this field and nothing else. And the tie is the
 * ORDINARY case here, not the unlucky one: collecting a welcome is something
 * that happens to a nearly-new account, so both sides sit on the same tiny
 * numbers, every metric in progressWinner ties, the tie prefers local, and a
 * freshly-cleared device would hand back a grant it already made. Nothing may
 * ever move this from claimed back to unclaimed.
 *
 * `referredBy` is a set-once label — who invited this player. Whichever side has
 * one carries it, and a disagreement keeps local like everywhere else in this
 * file. It cannot be wrong in a way that costs anything: the REAL referral is
 * the cloud row, whose primary key is the referee, so a player has at most one
 * no matter what this field says. It exists so the invite panel can say "you
 * were invited by" after a cleared browser.
 */
function pickReferral(a, b) {
  return {
    referralWelcomeClaimed: !!a.referralWelcomeClaimed || !!b.referralWelcomeClaimed,
    referredBy: a.referredBy ?? b.referredBy ?? null,
  };
}

/**
 * Merge local (`a`) with cloud (`b`). Returns a WHOLE record — never a
 * field-wise blend of the two, except for the categories above that are
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
  out.gear = mergeGear(a, b);
  out.trainedAt = pickTrained(a, b);
  Object.assign(out, pickWallet(a, b, winner));
  Object.assign(out, pickHandle(a, b));
  Object.assign(out, pickFit(a, b));
  Object.assign(out, pickRacha(a, b));
  Object.assign(out, pickJales(a, b));
  Object.assign(out, pickReferral(a, b));
  return out;
}
