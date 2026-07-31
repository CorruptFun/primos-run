// The suggestion box — what players write to Corrupt, and how it gets to him.
//
// The server half is supabase/migrations/20260731190000_primos_feedback.sql; the
// UI is the Corrupt badge on the HELP sheet and the sheet it opens; the read
// path is the FEEDBACK panel on stats.html. docs/FEEDBACK.md is the write-up.
//
// WHY THIS EXISTS. Analytics answers "where do runs end" and cannot answer "the
// slide doesn't register on my phone" or "let us replay the tutorial". Those
// arrive as sentences or not at all, and before this the only channel was a
// player who cared enough to find a Twitter account. A glitch nobody can report
// is a glitch that gets reported by everyone quietly leaving.
//
// DESIGN CONTRACT — the same one js/cloud.js, js/leaderboard.js,
// js/referrals.js and js/analytics.js keep, because one contract for the whole
// server-touching half of the game is the point:
//   · DORMANT UNTIL CONFIGURED. With js/cloud-config.js empty every export here
//     no-ops, and the UI hides the entry point rather than offering a form that
//     cannot send. A button that lies is worse than a missing button.
//   · NOTHING HERE MAY EVER THROW INTO THE GAME. Every path is wrapped.
//   · IT REPORTS ITS OWN OUTCOME HONESTLY. This is the one place the analytics
//     contract is inverted: track() is fire-and-forget because a lost metric is
//     free, and a lost report is not. The player is watching a status line, so
//     every send resolves to a result the UI can put into a sentence — and it
//     is only ever called "sent" when the server actually took it.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './cloud-config.js';
import { cloudSession, isCloudConfigured, sbClient } from './cloud.js';
import { deviceId } from './analytics.js';
import { APP_VERSION } from './version.js';
import { getLang } from './i18n.js';

// ------------------------------------------------------------------ vocabulary

/**
 * The three lanes, and the whole list. Mirrored in the guard trigger, which
 * buckets anything else as 'other' rather than rejecting the row — so adding a
 * fourth here ships safely to a cached client on the old server: the reports
 * land, they just land in 'other' until the migration catches up.
 */
export const KINDS = ['bug', 'idea', 'other'];

export const MAX_MESSAGE = 1000;
export const MIN_MESSAGE = 4;
export const MAX_CONTACT = 80;

// ⚠ PAIRED WITH THE GUARD. supabase/migrations/20260731190000_primos_feedback.sql
// enforces exactly these two, and it is the enforcement — this copy exists so a
// player who has already said their piece is told so BEFORE typing another
// paragraph, rather than after a round trip that reads like the message failed.
// If they drift, the client's number must be the SMALLER one or it promises a
// send the server will refuse. Change one side and change the other.
const HOUR_LIMIT = 5;
const DAY_LIMIT = 20;

const SENT_KEY = 'primos-run:feedback-sent';

// ------------------------------------------------------------------- storage

function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked — the server's own limit is the real one; this is just courtesy */
  }
}

function uuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * When this device's reports actually landed, newest last. Only SUCCESSFUL
 * sends are recorded: a retry that the server deduped never happened as far as
 * the limit is concerned, which keeps this ledger at or below the server's own
 * count and means the two can only ever disagree in the safe direction.
 */
function sentLog() {
  try {
    const raw = JSON.parse(readLocal(SENT_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return raw.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > cutoff);
  } catch {
    return [];
  }
}

function recordSend() {
  try {
    const log = sentLog();
    log.push(Date.now());
    writeLocal(SENT_KEY, JSON.stringify(log.slice(-DAY_LIMIT)));
  } catch {
    /* never throws */
  }
}

// -------------------------------------------------------------------- pure

/** True when a report could actually reach anyone. */
export function isFeedbackConfigured() {
  return isCloudConfigured() && !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

/** One of KINDS, always. Unknown input becomes 'other', matching the guard. */
export function normalizeKind(kind) {
  const k = String(kind ?? '').trim().toLowerCase();
  return KINDS.includes(k) ? k : 'other';
}

/**
 * What will actually be stored for the text typed.
 *
 * Control characters go first and it is not decoration: this string's whole
 * destination is a dashboard authenticated as the owner, and a stray C0 byte in
 * a message is at best an invisible mess in a <td>. Tabs and newlines survive
 * because people paste steps-to-reproduce as a list.
 *
 * Runs of blank lines collapse to one — a message typed on a phone keyboard
 * arrives with a dozen of them and they cost the reader a scroll each.
 */
export function sanitizeMessage(text) {
  const raw = String(text ?? '');
  return raw
    .replace(/\r\n?/g, '\n')
    // Strip C0 controls and DEL, keeping tab and newline. The escapes are
    // spelled out rather than typed literally so this line survives every
    // editor, diff and clipboard between here and the next person to read it.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_MESSAGE);
}

/**
 * The optional "how to reach me" line.
 *
 * ⚠ NEVER PREFILLED FROM THE ACCOUNT. Same rule as the race name in
 * js/leaderboard.js and for the same reason: an address the player did not type
 * is an address they did not agree to hand over, and a field that fills itself
 * in from the session looks like a convenience right up until someone notices
 * their email was attached to a message they thought was anonymous.
 */
export function sanitizeContact(text) {
  return String(text ?? '')
    // Every control character becomes a space here, newlines included — this is
    // one line on a dashboard row and a pasted linebreak would break the layout
    // of the table it lands in.
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONTACT);
}

/**
 * Can this be sent right now?
 *
 * @returns {{ok: boolean, reason: string|null}} `reason` is a stable key the UI
 *   turns into a sentence — never a message string, so the two languages stay in
 *   js/i18n.js where every other one lives.
 */
export function validateFeedback({ message } = {}) {
  if (!isFeedbackConfigured()) return { ok: false, reason: 'off' };
  const clean = sanitizeMessage(message);
  if (clean.length < MIN_MESSAGE) return { ok: false, reason: 'empty' };
  const log = sentLog();
  const hourAgo = Date.now() - 3600 * 1000;
  if (log.filter((n) => n > hourAgo).length >= HOUR_LIMIT) return { ok: false, reason: 'rate' };
  if (log.length >= DAY_LIMIT) return { ok: false, reason: 'rate' };
  return { ok: true, reason: null };
}

/**
 * Trim the caller's context bag to something the guard will keep.
 *
 * The guard replaces a context over 1KB with `{}` — losing every field rather
 * than the offending one — so the bounding happens HERE, where the fields are
 * still individually identifiable, and the guard stays the backstop rather than
 * the mechanism.
 */
function safeContext(context) {
  try {
    if (!context || typeof context !== 'object' || Array.isArray(context)) return {};
    const out = {};
    for (const [k, v] of Object.entries(context)) {
      if (v === null || v === undefined) continue;
      const key = String(k).slice(0, 24);
      if (typeof v === 'number') out[key] = Number.isFinite(v) ? Math.round(v) : 0;
      else if (typeof v === 'boolean') out[key] = v;
      else out[key] = String(v).slice(0, 60);
    }
    const json = JSON.stringify(out);
    return json.length > 900 ? {} : out;
  } catch {
    return {};
  }
}

// -------------------------------------------------------------------- send

/**
 * The signed-in player's JWT, so RLS admits the `user_id` on their row. Read
 * through cloud.js's lazy singleton, and only when there IS a session — a
 * signed-out player sends the publishable key and a null user_id, which is
 * exactly what the insert policy expects.
 */
async function authToken() {
  try {
    if (!cloudSession()) return null;
    const c = await sbClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * File a report. Never throws; always resolves.
 *
 * @param {object} input
 * @param {string} input.kind      one of KINDS
 * @param {string} input.message   what they wrote
 * @param {string} [input.contact] optional, player-typed
 * @param {object} [input.context] what was happening — screen, score, best
 * @returns {Promise<{ok: boolean, reason: string|null}>} `reason` is a stable
 *   key ('off' | 'empty' | 'rate' | 'net'), never a sentence.
 */
export async function sendFeedback({ kind, message, contact, context } = {}) {
  const check = validateFeedback({ message });
  if (!check.ok) return check;

  const row = {
    device_id: deviceId(),
    user_id: cloudSession()?.userId ?? null,
    kind: normalizeKind(kind),
    message: sanitizeMessage(message),
    contact: sanitizeContact(contact) || null,
    context: safeContext(context),
    app_version: APP_VERSION,
    lang: getLang(),
    // Minted per attempt and REUSED across this call's retries — that is the
    // dedupe. The guard drops a second arrival of the same id and answers 201,
    // so a player who presses SEND again on a stalled connection gets one row
    // and one "sent", not two of each.
    feedback_id: uuid(),
  };

  try {
    const token = await authToken();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/primos_feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
        // return=minimal is CORRECTNESS here, not a size optimisation, and it is
        // the same trap primos_events has: this table has no SELECT policy, so
        // asking PostgREST to return the inserted row makes it read a row it is
        // not allowed to read and the whole write fails. See the long note in
        // js/analytics.js flush() — that one shipped broken for exactly this
        // reason, in the on_conflict form.
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
      cache: 'no-store',
    });

    if (res.ok) {
      recordSend();
      return { ok: true, reason: null };
    }
    // The guard raises with PostgREST's PTxyz convention so the limit arrives as
    // a real 429. The STATUS is what is read, never the body — if that mapping
    // ever goes away the player gets the generic sentence instead of the
    // specific one, which is a wording regression and not a broken box.
    if (res.status === 429) return { ok: false, reason: 'rate' };
    if (res.status === 400) return { ok: false, reason: 'empty' };
    return { ok: false, reason: 'net' };
  } catch {
    // Offline, blocked, DNS — all the same to the player, and all of them mean
    // "it did not go". NOT queued for later: a report the player was told was
    // sent, sent silently an hour later from a different screen, is a promise
    // this file cannot keep honestly. Ask them to try again.
    return { ok: false, reason: 'net' };
  }
}
