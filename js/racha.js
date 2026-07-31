// La racha — the daily streak. Pure and dependency-free, like js/raceday.js,
// so dev/cloud-test.html can hammer it and main.js can settle it inside a
// single economy write.
//
// THE DESIGN RULE THIS FILE ENFORCES: the streak pays for RUNNING, never for
// showing up. There is no claim button and no login bonus anywhere — the bonus
// lands with the takings of the first run you BANK each UTC day, inside the
// same atomic write (see wallet.bankRun and its caller in js/main.js). A streak
// you can collect from the couch is an obligation to open an app; a streak you
// run for is a reason to play.
//
// UTC day, same clock as the boards (js/raceday.js dayKey), for the boards'
// stated reason: one reset for everyone, even though it lands mid-afternoon
// somewhere. A local-midnight streak would also let a traveller double-dip a
// day by crossing a timezone, which is exactly the kind of hole that never
// gets noticed until someone farms it.

/**
 * Bonus chelas by streak length. Index 0 unused — a streak you are on is at
 * least one day long.
 *
 * CAPPED AT 7 ON PURPOSE. An ever-growing bonus turns a habit into a hostage,
 * and a long-streak player does not need more money — they need the streak
 * itself to matter (the number is the reward by then). 40/day is a mid-shelf
 * consumable every single day, and about a third of the daily retention
 * ceiling; see docs/GAME_DESIGN.md "Coming back tomorrow".
 */
export const RACHA_TABLE = [0, 5, 10, 15, 20, 25, 30, 40];

/** A racha we can trust: {len: int >= 0, day: 'YYYY-MM-DD' | ''}. */
export function coerceRacha(raw) {
  const out = { len: 0, day: '' };
  if (!raw || typeof raw !== 'object') return out;
  const n = Number(raw.len);
  out.len = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  out.day = typeof raw.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : '';
  // A day with no length (or a length with no day) is not a streak — repair to
  // nothing rather than let half a record pay a bonus.
  if (!out.day || !out.len) return { len: 0, day: '' };
  return out;
}

/** Is `b` the UTC day immediately after `a`? Both 'YYYY-MM-DD'. */
function isNextDay(a, b) {
  if (!a || !b) return false;
  const [y, m, d] = a.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 86400000).toISOString().slice(0, 10) === b;
}

/**
 * Settle the streak against a run banked on `key`.
 *
 * Idempotent within a day: the second run of a day changes nothing and pays
 * nothing — that is the latch that stops the bonus minting once per run. The
 * caller stamps the returned racha in the SAME storage write that deposits the
 * bonus (wallet.bankRun), so the payment and the latch that says it happened
 * can never tear apart. That is the exact lesson `referralWelcomeClaimed`
 * taught this codebase; see js/store.js ECON_KEYS.
 *
 * @param {object} prevRaw the save's racha field, straight off disk (untrusted)
 * @param {string} key today's board day, from raceday.dayKey()
 * @returns {{racha: {len: number, day: string}, bonus: number, counted: boolean}}
 *   `counted` is true only when THIS run was the one that advanced the streak —
 *   the game-over sheet keys its celebration line off it.
 */
export function settleRacha(prevRaw, key) {
  const prev = coerceRacha(prevRaw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) {
    // A junk day key must not reset a real streak — leave everything alone.
    return { racha: prev, bonus: 0, counted: false };
  }
  if (prev.day === key) return { racha: prev, bonus: 0, counted: false };
  const len = isNextDay(prev.day, key) ? prev.len + 1 : 1;
  const bonus = RACHA_TABLE[Math.min(len, RACHA_TABLE.length - 1)];
  return { racha: { len, day: key }, bonus, counted: true };
}

/**
 * Is the streak still alive but NOT yet counted today? This is the menu's
 * "run today or lose it" state — the one moment loss aversion has something
 * true to say. Alive-and-counted and dead both return false; a streak that is
 * safe needs no shouting, and a dead one has nothing left to protect.
 */
export function rachaAtRisk(raw, todayKey, prevDayKey) {
  const r = coerceRacha(raw);
  return r.len > 0 && r.day === prevDayKey && r.day !== todayKey;
}

/**
 * The streak as the menu should show it: the live length, or 0 when it has
 * lapsed (yesterday didn't count and neither has today). Without this check a
 * player coming back after a week away would see the old number, run, and
 * watch it "reset" — which reads as the game stealing a streak it had actually
 * already lost.
 */
export function rachaShown(raw, todayKey, prevDayKey) {
  const r = coerceRacha(raw);
  if (r.day === todayKey || r.day === prevDayKey) return r.len;
  return 0;
}
