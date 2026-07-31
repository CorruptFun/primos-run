// Los jales del día — three daily missions. Pure and dependency-free, like
// js/raceday.js and js/racha.js, so dev/cloud-test.html can hammer every rule
// and main.js can settle a run's progress inside a single economy write.
//
// THE SAME THREE FOR EVERYONE. The day's jales are drawn deterministically
// from the board's day key — no network, no server row, no config to deploy.
// That buys two things: "did you finish the taco one" is a conversation
// between players rather than a coincidence, and the whole system is testable
// with a string. The cost is that everyone gets the same difficulty, which is
// fine — targets sit low enough that any engaged session clears them.
//
// CUMULATIVE BY DEFAULT. Most goals progress across every run of the day, so a
// bad run still moves something — a daily that demands one perfect run teaches
// the player to resent it. The single-run goals (score, distance, combo) exist
// because "one good run" is its own kind of goal, and the boards already ask
// for it anyway.
//
// UTC day, same clock as the boards and the racha, for the stated reasons.

/** Paid per jale, and for finishing all three. Ceiling: 3×15 + 25 = 70/day. */
export const JALE_REWARD = 15;
export const JALE_SWEEP = 25;

/**
 * The pool. `kind: 'day'` accumulates a run stat across the day; `kind: 'run'`
 * asks a single run to reach the target. `stat` names a field of the run-stats
 * bundle main.js builds at game over — game.js counts all of these.
 *
 * Tiers are [easy, mid, hard]; the day's tier is drawn per slot. Targets are
 * calibrated against docs/GAME_DESIGN.md numbers: a good run is 25–45 chelas,
 * ~1500–3000 score, a couple of minutes.
 */
export const JALE_POOL = [
  { id: 'chelas', kind: 'day', stat: 'beers',    tiers: [60, 90, 130] },
  { id: 'tacos',  kind: 'day', stat: 'tacos',    tiers: [6, 9, 12] },
  { id: 'slides', kind: 'day', stat: 'slides',   tiers: [15, 25, 40] },
  { id: 'jumps',  kind: 'day', stat: 'jumps',    tiers: [20, 30, 50] },
  { id: 'powers', kind: 'day', stat: 'powerups', tiers: [3, 5, 8] },
  { id: 'smash',  kind: 'day', stat: 'smashes',  tiers: [4, 8, 12] },
  { id: 'score',  kind: 'run', stat: 'score',    tiers: [1500, 2500, 4000] },
  { id: 'dist',   kind: 'run', stat: 'distance', tiers: [800, 1200, 1800] },
  { id: 'combo',  kind: 'run', stat: 'bestMult', tiers: [4, 6, 8] },
];

// ------------------------------------------------------------------ the draw

/** djb2, then mulberry32 — tiny, deterministic, and plenty for picking three. */
function hashDay(key) {
  let h = 5381;
  const s = String(key);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The day's three jales, in a stable display order. Same input, same answer,
 * on every device on earth — that property is load-bearing (see header) and
 * dev/cloud-test.html pins it.
 * @returns {{id: string, kind: string, stat: string, target: number}[]}
 */
export function jalesForDay(key) {
  const rng = mulberry32(hashDay(key));
  // Draw 3 distinct pool slots by partial shuffle.
  const idx = JALE_POOL.map((_, i) => i);
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx.slice(0, 3).map((i) => {
    const m = JALE_POOL[i];
    return { id: m.id, kind: m.kind, stat: m.stat, target: m.tiers[Math.floor(rng() * 3)] };
  });
}

// ----------------------------------------------------------------- the state

/**
 * The save's jales record we can trust:
 * {day, prog: {stat: int}, done: {id: true}, sweepPaid: bool}.
 * Anything else — junk, another day's record, a hand-edit — degrades toward
 * "nothing done yet" rather than toward a payout.
 */
export function coerceJales(raw) {
  const out = { day: '', prog: {}, done: {}, sweepPaid: false };
  if (!raw || typeof raw !== 'object') return out;
  out.day = typeof raw.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : '';
  if (!out.day) return { day: '', prog: {}, done: {}, sweepPaid: false };
  if (raw.prog && typeof raw.prog === 'object') {
    for (const [k, v] of Object.entries(raw.prog)) {
      const n = Number(v);
      if (typeof k === 'string' && Number.isFinite(n) && n > 0) out.prog[k] = Math.floor(n);
    }
  }
  if (raw.done && typeof raw.done === 'object') {
    for (const [k, v] of Object.entries(raw.done)) {
      if (typeof k === 'string' && v === true) out.done[k] = true;
    }
  }
  out.sweepPaid = raw.sweepPaid === true;
  return out;
}

const int = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);

/**
 * Fold one finished run into the day's record and price what it earned.
 *
 * The `done` map is the spent latch, per jale per day: a jale pays the moment
 * it completes and can never pay again, because completion is checked against
 * the map the payment writes. The caller stamps the returned state in the SAME
 * storage write that deposits the payout (wallet.bankRun in js/main.js), so
 * the two cannot tear — `referralWelcomeClaimed`'s lesson, again.
 *
 * A record from another day is discarded wholesale, not migrated: yesterday's
 * half-done jale is worth nothing today, and the daily reset IS the product.
 *
 * @param {object} prevRaw the save's jales field, straight off disk (untrusted)
 * @param {string} key today's board day, from raceday.dayKey()
 * @param {object} run this run's stat bundle {beers, tacos, slides, jumps,
 *   powerups, smashes, score, distance, bestMult} — ints, already floored
 * @returns {{state: object, completedNow: string[], sweepNow: boolean, payout: number}}
 */
export function applyJalesRun(prevRaw, key, run) {
  const prev = coerceJales(prevRaw);
  const state = prev.day === key ? prev : { day: key, prog: {}, done: {}, sweepPaid: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) {
    return { state: prev, completedNow: [], sweepNow: false, payout: 0 };
  }
  const missions = jalesForDay(key);
  const completedNow = [];
  let payout = 0;
  for (const m of missions) {
    const gained = int(run && run[m.stat]);
    // Progress is kept for BOTH kinds — cumulative for 'day', best-attempt for
    // 'run' — so the menu can always show a bar that only ever moves forward.
    const before = int(state.prog[m.stat]);
    const value = m.kind === 'day' ? before + gained : Math.max(before, gained);
    if (value > 0) state.prog[m.stat] = value;
    if (state.done[m.id]) continue;
    const met = m.kind === 'day' ? value >= m.target : gained >= m.target;
    if (met) {
      state.done[m.id] = true;
      completedNow.push(m.id);
      payout += JALE_REWARD;
    }
  }
  let sweepNow = false;
  if (!state.sweepPaid && missions.every((m) => state.done[m.id])) {
    state.sweepPaid = true;
    sweepNow = true;
    payout += JALE_SWEEP;
  }
  return { state, completedNow, sweepNow, payout };
}

/**
 * The day's jales as a screen should show them: target, current value, done.
 * Reads the record without writing anything — a menu must not be able to
 * change what a run will be paid.
 */
export function jalesStatus(raw, key) {
  const state = coerceJales(raw);
  const fresh = state.day === key ? state : { day: key, prog: {}, done: {}, sweepPaid: false };
  const missions = jalesForDay(key);
  return {
    list: missions.map((m) => ({
      id: m.id,
      kind: m.kind,
      target: m.target,
      value: Math.min(m.target, int(fresh.prog[m.stat])),
      done: !!fresh.done[m.id],
    })),
    allDone: missions.every((m) => !!fresh.done[m.id]),
    sweepPaid: fresh.sweepPaid,
  };
}
