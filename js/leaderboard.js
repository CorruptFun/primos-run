// The race boards — read/submit over public.primos_daily_scores and the
// public.primos_weekly_totals view it rolls up into
// (supabase/migrations/0001_primos_cloud.sql).
//
// TWO BOARDS, ONE MODULE:
//   · DAILY  — today's shared board, ranked by score, resets at midnight UTC.
//   · WEEKLY — the season. Ranked by the SUM of a player's daily bests, so it
//              rewards turning up: a missed day is a zero you cannot make back
//              with one big run.
//
// Design contract (mirrors js/cloud.js exactly): dormant until configured AND
// signed in, the SAVE stays authoritative for the player's own bests, this only
// mirrors them out and reads other players' rows back. Nothing here may throw
// into the game. Submission piggybacks the cloud-save push, so there is no new
// traffic path and no per-frame cost.
//
// PRIVACY — THE INVARIANT: nothing derived from the player's email may ever
// reach a public board. Only the user id, a sanitized display name, the day key
// and the score leave the device. preferredName() is the ONLY thing that decides
// what becomes public, and cloudSession().email is deliberately unreachable from
// inside it — the rule holds by construction rather than by discipline. The
// server enforces the same rule again in public_display_name(), because a cached
// PWA client can keep submitting an old name for days after a deploy.

import { cloudSession, flushCloudSaveNow, isCloudConfigured, sbClient } from './cloud.js';
import { bestForDay, dayKey, dayWasContinued, formatWeekStanding, weekKey } from './raceday.js';
import * as store from './store.js';

/** Lazy, shared client — cloud.js owns the singleton; this never makes a second. */
async function client() {
  if (!isCloudConfigured() || !cloudSession()) return null;
  return sbClient();
}

// --- names ------------------------------------------------------------------

/** Strip arbitrary text down to a friendly 24-char handle. */
export function sanitizeName(raw) {
  // split('@') first, belt and braces: even a caller that hands this an email
  // address cannot publish one. The Unicode property escapes are deliberate —
  // stripping to ASCII would mangle a large share of players' names.
  const base = String(raw ?? '').split('@')[0].replace(/[^\p{L}\p{N} _.\-]/gu, '').trim();
  return (base || 'player').slice(0, 24);
}

/**
 * The public name for a player who has not chosen one — stable, anonymous, and
 * derived from the account's own user id, which is ALREADY on every board row,
 * so it discloses nothing that reading the board did not. Four hex digits keep
 * the board legible; twenty rows of "player" tells a reader nothing.
 *
 * MUST STAY BYTE-IDENTICAL to public.primos_anon_display_name in
 * supabase/migrations/0001_primos_cloud.sql. The server substitutes that exact
 * string when a submission would publish an email name, so any drift shows the
 * player one name in the game and the board another. The migration self-checks
 * the shared case and refuses to apply on drift; dev/cloud-test.html asserts it
 * from this side.
 */
export function anonName(userId) {
  const hex = String(userId ?? '').replace(/-/g, '').slice(0, 4).toUpperCase();
  return /^[0-9A-F]{4}$/.test(hex) ? `Player ${hex}` : 'player';
}

// The chosen handle lives in its own key for a synchronous read on the submit
// path, AND inside the save so it rides cloud sync. Storage-only is why players
// used to have to re-enter their name after clearing a browser: the cloud
// restored their progress but had never been told their name.
const HANDLE_KEY = 'primos-run:handle';

/** The chosen handle (sanitized), or null when none is set. */
export function getHandle() {
  try {
    const raw = localStorage.getItem(HANDLE_KEY);
    if (raw !== null && raw.trim() !== '') return sanitizeName(raw);
  } catch {
    // storage blocked (private mode) — fall through to the save
  }
  try {
    const fromSave = store.load().handle;
    return fromSave && fromSave.trim() !== '' ? sanitizeName(fromSave) : null;
  } catch {
    return null;
  }
}

/**
 * The name submissions carry. The email is unreachable from here on purpose —
 * see the module header.
 */
export function preferredName() {
  return getHandle() ?? anonName(cloudSession()?.userId);
}

/**
 * Set (or clear, with null/empty) the race name. Persists to BOTH homes, then
 * renames every board row the player owns so an old name disappears from
 * current AND past boards without waiting for the next score. Returns the
 * sanitized handle that was stored (null when cleared).
 */
export function setHandle(raw) {
  const clean = raw === null || String(raw).trim() === '' ? null : sanitizeName(raw);
  try {
    if (clean === null) localStorage.removeItem(HANDLE_KEY);
    else localStorage.setItem(HANDLE_KEY, clean);
  } catch {
    // storage blocked — the save write and the rename below still apply
  }
  try {
    const s = store.load();
    s.handle = clean;
    s.handleSetAt = Date.now();   // stamped so the newest rename wins the cross-device merge
    store.save(s);
  } catch {
    // best-effort
  }
  // Skip the push debounce: "set the name, close the browser" fits inside the
  // 1.5s window and would strand the name on this device. The debounced push
  // still stands behind this, so a failure here costs nothing.
  void flushCloudSaveNow();
  void renameEverywhere();
  return clean;
}

/**
 * Adopt a merged save's race name into this device — the recovery half of the
 * bridge, called by cloud.syncNow() right after it persists the winner.
 *
 * Deliberately does NOT re-stamp handleSetAt: an adopted name would then look
 * freshly chosen, win every future merge, and the oldest device to sync would
 * start dictating the name. And it pushes no rename; reconcileName does that.
 */
export function adoptHandle(save) {
  try {
    const cloud = save.handle && save.handle.trim() !== '' ? sanitizeName(save.handle) : null;
    if (cloud === null) return;   // nothing chosen anywhere — leave this device alone
    if (localStorage.getItem(HANDLE_KEY) === cloud) return;
    localStorage.setItem(HANDLE_KEY, cloud);
  } catch {
    // storage blocked — getHandle's save fallback still returns the adopted name
  }
}

let reconciled = false;

/**
 * Repair the player's own board rows once per page-load, after a sign-in/sync —
 * for a name just adopted from the cloud onto a device whose rows never carried
 * it. Idempotent and fire-and-forget; RLS scopes it to the player's own rows.
 */
export async function reconcileName() {
  if (reconciled) return;
  reconciled = true;
  await renameEverywhere();
}

/**
 * UPDATE display_name on ALL of the signed-in player's rows — every board, every
 * past day, not just today's. The whole point of the picker is that a name can
 * be scrubbed from history, and a name left on a closed board (which its owner
 * will never submit to again) defeats that completely.
 *
 * This only works because the server's guard SKIPS its day check when the score
 * is unchanged. A guard that validated the day on every write would raise on
 * each past row, the catch below would swallow it, and scrubbing history would
 * silently never happen. Add a table here whenever a new board starts carrying
 * display_name; the weekly VIEW needs no entry, since renaming its base rows
 * renames it.
 */
async function renameEverywhere() {
  try {
    const s = cloudSession();
    const c = await client();
    if (!s || !c) return;
    const name = preferredName();
    await c.from('primos_daily_scores').update({ display_name: name }).eq('user_id', s.userId);
  } catch {
    // offline / transient — the next submission still carries the new name
  }
}

// --- submit -----------------------------------------------------------------

// (day, score) memo: skip an upsert already sent this page-load. An
// optimisation only — the server's monotonic guard is what makes redundant
// sends harmless.
let lastSent = null;

/**
 * Mirror the save's best for TODAY'S board — called by cloud.js after each
 * successful save push, by which point the save is already authoritative.
 * No-ops when dormant, when today has no score, or when this exact (day, score)
 * already went. Never throws.
 *
 * Only today is ever submitted: the server refuses any other day, so walking the
 * whole `days` map would just generate rejected requests — and every earlier day
 * was already mirrored on the push that recorded it.
 */
export async function maybeSubmitDaily(save, now = new Date()) {
  try {
    const s = cloudSession();
    if (!s) return;
    const day = dayKey(now);
    const score = bestForDay(save, day);
    if (score <= 0) return;
    if (lastSent && lastSent.day === day && lastSent.score >= score) return;
    const c = await client();
    if (!c) return;
    // `continued` rides the score it belongs to. The guard preserves the old
    // value on any write that does not RAISE the score, so this can only ever
    // be set by the run that actually took the standing — a rename cannot
    // launder a bought run into a clean one.
    const { error } = await c.from('primos_daily_scores').upsert(
      {
        user_id: s.userId,
        day_key: day,
        score,
        display_name: preferredName(),
        continued: dayWasContinued(save, day),
      },
      { onConflict: 'user_id,day_key' },
    );
    // Only memo a write that SUCCEEDED, or one offline blip suppresses
    // submissions for the rest of the session.
    if (!error) lastSent = { day, score };
  } catch {
    // offline / transient — the next save push retries; the board loses only freshness
  }
}

// --- read -------------------------------------------------------------------

/**
 * A board, uniform across daily and weekly so the panel needs no branching:
 *   { key, entries: [{ rank, name, score, you, valueText? }], myRank, myScore, myValueText? }
 *
 * Every failure — dormant, signed out, offline, genuinely empty — returns the
 * EMPTY board rather than an error, so the panel renders one invitation for all
 * of them.
 */
function emptyBoard(key) {
  return { key, entries: [], myRank: null, myScore: null };
}

/** Today's board (or any day's), top `limit` rows plus the player's own rank. */
export async function fetchDailyBoard(limit = 25, now = new Date()) {
  const day = dayKey(now);
  try {
    const c = await client();
    if (!c) return emptyBoard(day);
    const s = cloudSession();
    const { data, error } = await c
      .from('primos_daily_scores')
      .select('user_id, display_name, score, continued')
      .eq('day_key', day)
      // Byte-identical to the primos_daily_day_rank index, or it stops being used.
      .order('score', { ascending: false })
      .order('scored_at', { ascending: true })
      .limit(limit);
    if (error || !data) return emptyBoard(day);

    const entries = data.map((r, i) => ({
      rank: i + 1,
      name: sanitizeName(r.display_name),
      score: r.score,
      continued: !!r.continued,
      you: !!s && r.user_id === s.userId,
    }));

    let myRank = null;
    let myScore = null;
    let myContinued = false;
    const mine = entries.find((e) => e.you);
    if (mine) {
      myRank = mine.rank;
      myScore = mine.score;
      myContinued = mine.continued;
    } else if (s) {
      // Outside the top rows: read own row, then COUNT how many beat it —
      // head: true, so no rows cross the wire.
      const own = await c
        .from('primos_daily_scores')
        .select('score, continued')
        .eq('day_key', day)
        .eq('user_id', s.userId)
        .maybeSingle();
      const score = own.data?.score;
      if (typeof score === 'number') {
        myScore = score;
        myContinued = !!own.data.continued;
        const { count } = await c
          .from('primos_daily_scores')
          .select('user_id', { count: 'exact', head: true })
          .eq('day_key', day)
          .gt('score', score);
        myRank = typeof count === 'number' ? count + 1 : null;
      }
    }
    return { key: day, entries, myRank, myScore, myContinued };
  } catch {
    return emptyBoard(day);
  }
}

/**
 * This week's season standings from public.primos_weekly_totals — the summed
 * daily bests.
 *
 * Ordering is (total desc, days_played desc, last_scored_at asc). The middle
 * term is the interesting one: level on the total, the player who spread it over
 * MORE boards wins, because that is the behaviour this format exists to reward.
 *
 * Own-rank outside the top rows is therefore a COMPOSITE comparison, not a
 * single .gt() — a player is beaten by anyone with a bigger total, OR by anyone
 * level on the total with more days. Collapsing that to "total >" would report
 * every tied player as joint-first, exactly the pile-up the tiebreak prevents.
 */
export async function fetchWeeklyBoard(limit = 25, now = new Date()) {
  const week = weekKey(now);
  try {
    const c = await client();
    if (!c) return emptyBoard(week);
    const s = cloudSession();
    const { data, error } = await c
      .from('primos_weekly_totals')
      .select('user_id, display_name, total, days_played, continued')
      .eq('week_key', week)
      .order('total', { ascending: false })
      .order('days_played', { ascending: false })
      .order('last_scored_at', { ascending: true })
      .limit(limit);
    if (error || !data) return emptyBoard(week);

    const entries = data.map((r, i) => ({
      rank: i + 1,
      name: sanitizeName(r.display_name),
      score: r.total,
      // A weekly total is bought if ANY day inside it was — the view takes
      // bool_or. Marking the whole total is the honest reading: the number
      // ranked here is partly made of a run that was paid for.
      continued: !!r.continued,
      you: !!s && r.user_id === s.userId,
      valueText: formatWeekStanding(r.total, r.days_played),
    }));

    let myRank = null;
    let myScore = null;
    let myValueText;
    let myContinued = false;
    const mine = entries.find((e) => e.you);
    if (mine) {
      myRank = mine.rank;
      myScore = mine.score;
      myValueText = mine.valueText;
      myContinued = mine.continued;
    } else if (s) {
      const own = await c
        .from('primos_weekly_totals')
        .select('total, days_played, continued')
        .eq('week_key', week)
        .eq('user_id', s.userId)
        .maybeSingle();
      const row = own.data;
      if (row) {
        myScore = row.total;
        myValueText = formatWeekStanding(row.total, row.days_played);
        myContinued = !!row.continued;
        const higher = await c
          .from('primos_weekly_totals')
          .select('user_id', { count: 'exact', head: true })
          .eq('week_key', week)
          .gt('total', row.total);
        const tied = await c
          .from('primos_weekly_totals')
          .select('user_id', { count: 'exact', head: true })
          .eq('week_key', week)
          .eq('total', row.total)
          .gt('days_played', row.days_played);
        if (typeof higher.count === 'number' && typeof tied.count === 'number') {
          myRank = higher.count + tied.count + 1;
        }
      }
    }
    return { key: week, entries, myRank, myScore, myValueText, myContinued };
  } catch {
    return emptyBoard(week);
  }
}
