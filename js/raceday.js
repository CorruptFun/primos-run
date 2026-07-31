// Which board a run belongs to. Pure — no network, no storage — so dev/cloud-test.html
// can assert it, and so the same answers are cheap to compute anywhere.
//
// THE RULE THAT MATTERS: every function here has a byte-identical twin in
// supabase/migrations/0001_primos_cloud.sql, and that migration REFUSES TO APPLY
// if the two disagree. The server validates the day key on every submission, so
// drift does not produce a warning — it produces a board that silently goes
// empty because the database is rejecting every honest score. Change one side
// and you must change the other, plus the cases in dev/cloud-test.html.

/**
 * The board a moment belongs to, as 'YYYY-MM-DD' in UTC.
 *
 * UTC, not the player's local midnight, because the board is SHARED: a local
 * reset would mean the "same" board opens and closes at different moments for
 * different players, and someone in Auckland would be racing a board Los Angeles
 * had already finished. One clock for everyone is the only version that is fair,
 * even though it means the reset lands mid-afternoon somewhere.
 */
export function dayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Yesterday's board — for the "how did I do?" recap after a reset. */
export function previousDayKey(now = new Date()) {
  return dayKey(new Date(now.getTime() - 86400000));
}

/**
 * The ISO week a DAY belongs to, as 'YYYY-Www'. ISO weeks start Monday and the
 * year is the ISO year, which is why this is not just "the year of that date":
 * 2025-12-29 is already 2026-W01.
 *
 * Zero-padded, so week keys compare lexicographically in true chronological
 * order — across year boundaries included.
 */
export function weekOfDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Shift to the Thursday of this week: the ISO year is whichever year that
  // Thursday falls in, which is the whole trick that makes the seams work.
  const dow = (dt.getUTCDay() + 6) % 7;          // Monday = 0
  dt.setUTCDate(dt.getUTCDate() - dow + 3);
  const isoYear = dt.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const fdow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdow + 3);
  const week = 1 + Math.round((dt - firstThursday) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** The week a moment belongs to. */
export function weekKey(now = new Date()) {
  return weekOfDay(dayKey(now));
}

/**
 * The player's best score on a given board, out of the save's per-day map.
 * Shape-tolerant: the map is restored straight from localStorage and may have
 * been hand-edited, so anything that isn't a finite positive number reads as 0
 * rather than propagating NaN into a submission.
 */
export function bestForDay(save, key) {
  const n = save && save.days ? save.days[key] : 0;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Record a run against today's board, keeping the day's best. Mutates and
 * returns the save — callers persist it themselves, on the same beat as every
 * other end-of-run write.
 */
export function recordDay(save, score, now = new Date(), continued = false) {
  const key = dayKey(now);
  if (!save.days || typeof save.days !== 'object') save.days = {};
  if (!save.contDays || typeof save.contDays !== 'object') save.contDays = {};
  const prev = bestForDay(save, key);
  if (score > prev) {
    save.days[key] = Math.floor(score);
    // The mark belongs to the run that SET the standing score, so it is written
    // here and nowhere else. A later clean run that fails to beat it must not
    // scrub the mark off a score that is still the one on the board.
    if (continued) save.contDays[key] = true;
    else delete save.contDays[key];
  }
  return save;
}

/**
 * Did the run that set this day's best pay for a continue?
 *
 * Continued runs ARE eligible for the boards — a decision made deliberately, on
 * the grounds that the score shown at game over should be the score submitted.
 * The cost of that is a board where a full wallet buys distance, so every place
 * one of these scores is displayed says so. This is what the UI asks.
 */
export function dayWasContinued(save, key) {
  return !!(save && save.contDays && save.contDays[key]);
}

/**
 * Drop day entries older than `keep` days. The map is mirrored into the cloud
 * save on every push, so without this it grows forever and a two-year player
 * would be shipping a kilobyte of dead history on each write. Old days are
 * already immutable on the server — nothing is lost by forgetting them here.
 */
export function pruneDays(save, keep = 60, now = new Date()) {
  const cutoff = dayKey(new Date(now.getTime() - keep * 86400000));
  // Both maps, or the continue marks outlive the scores they annotate and the
  // save grows the exact history pruning exists to stop.
  for (const map of [save.days, save.contDays]) {
    if (!map || typeof map !== 'object') continue;
    for (const key of Object.keys(map)) {
      if (key < cutoff) delete map[key];
    }
  }
  return save;
}

/** The weekly board's readout: the total, then the turnout that explains it. */
export function formatWeekStanding(total, days) {
  return `${Math.floor(total).toLocaleString()} · ${days}d`;
}
