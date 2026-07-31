// First-party product analytics — the event pipe.
//
// Built to ~/.claude/skills/first-party-analytics. The server half is
// supabase/migrations/20260731120000_primos_analytics.sql; the dashboard is
// stats.html.
// Read docs/ANALYTICS.md for what the numbers mean and why they are trustworthy.
//
// WHY THIS EXISTS. Before it, the only telemetry this game had was the
// leaderboards, and both require a Google sign-in — so every signed-out player
// was invisible, and none of "how many people opened it", "where do runs end",
// "does the tutorial work", "does la tiendita convert" could be answered at all.
//
// DESIGN CONTRACT (identical in shape to js/cloud.js, js/leaderboard.js and
// js/referrals.js, deliberately — one contract for the whole server-touching
// half of the game):
//   · DORMANT UNTIL CONFIGURED. With js/cloud-config.js empty every export here
//     no-ops and not one byte goes anywhere. Analytics must never be a reason
//     the game behaves differently.
//   · NOTHING HERE MAY EVER THROW INTO THE GAME. Losing a metric is free.
//     Breaking a run is not. Every entry point is wrapped.
//   · FIRE AND FORGET. track() is a synchronous void that appends to an
//     in-memory queue and returns. It does no network work on the caller's
//     frame, which matters because some of these calls sit next to the game
//     loop.
//   · The player can turn it off, and that has to actually work.
//
// ⚠ NAME COLLISION, on purpose and worth knowing: js/hud.js also exports a
// `track` — a drawing helper for the HUD's slider tracks. Nothing imports both
// today. If a file ever needs to, alias at the import site
// (`import { track as trackEvent } from './analytics.js'`) rather than renaming
// either one; both names are right in their own file.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './cloud-config.js';
import { cloudSession, isCloudConfigured, sbClient } from './cloud.js';
import { APP_VERSION } from './version.js';

// ---------------------------------------------------------------- vocabulary

/**
 * THE canonical event names. Everything — the funnels in the migration, the
 * panels in stats.html, the assertions in dev/cloud-test.html — is defined
 * against this object and never against a string literal.
 *
 * That is not tidiness. A funnel step built on a misspelled name renders as a
 * permanently-zero step, which on a dashboard is indistinguishable from a real
 * 0% — and 0% conversion is exactly the kind of number someone acts on. There
 * is no compile step in this project to catch a typo, so dev/cloud-test.html
 * pins every name the dashboard uses back to this object instead.
 *
 * FEWER, WELL-CHOSEN EVENTS BEAT EXHAUSTIVE LOGGING. Each one below answers a
 * question someone has actually asked about this game.
 */
export const EVENTS = {
  APP_OPEN: 'app_open',

  // The run. `run_end` carries the whole shape of the run, so "where do players
  // quit" is answerable as a distribution rather than a step.
  RUN_START: 'run_start',
  RUN_END: 'run_end',

  // The escuela del callejón. Three of the alley's obstacles cannot be jumped
  // at all, so whether this lands is a real question, not a vanity metric.
  TUTORIAL_START: 'tutorial_start',
  TUTORIAL_DONE: 'tutorial_done',
  TUTORIAL_SKIP: 'tutorial_skip',

  // La tiendita. `shop_buy` covers gear too — the item id says which half of
  // the counter it came from. `gear_equip` is separate because wearing is the
  // moment a cosmetic proves it was worth buying, and it happens for free.
  SHOP_OPEN: 'shop_open',
  SHOP_BUY: 'shop_buy',
  SHOP_DENIED: 'shop_denied',
  GEAR_EQUIP: 'gear_equip',

  // Coming back tomorrow. One event per jale COMPLETED (id + day + reward);
  // racha length rides run_end's props instead of its own event, because the
  // streak only ever changes when a run ends.
  MISSION_DONE: 'mission_done',

  // The offer at the bust. `n` on all three is how many continues were already
  // taken this run — which rung of the 25·2ⁿ ladder players actually pay at.
  CONTINUE_OFFER: 'continue_offer',
  CONTINUE_TAKE: 'continue_take',
  CONTINUE_DECLINE: 'continue_decline',

  // Running as your own Primo — the thing that makes this the collection's game
  // rather than a runner with a skin.
  PRIMO_OPEN: 'primo_open',
  PRIMO_SET: 'primo_set',

  SIGN_IN_START: 'sign_in_start',
  SIGN_IN_DONE: 'sign_in_done',
  BOARD_OPEN: 'board_open',
  INVITE_SHARE: 'invite_share',

  // The suggestion box (js/feedback.js). These two answer a question the
  // reports themselves cannot: how many people opened it and then did NOT
  // write. A box nobody finds and a box everybody abandons need opposite fixes
  // and look identical from the pile of messages.
  //
  // ⚠ NEITHER CARRIES THE MESSAGE. What the player wrote goes to
  // primos_feedback — which has no select policy — and not into the event log,
  // which is a different table with a different retention and a different
  // shape of exposure. A prop with their sentence in it would quietly copy the
  // one thing this split exists to keep in one place.
  FEEDBACK_OPEN: 'feedback_open',
  FEEDBACK_SEND: 'feedback_send',

  CLIENT_ERROR: 'client_error',
};

// ------------------------------------------------------------------- tuning

const FLUSH_AT = 20;          // events queued before a flush
const FLUSH_MS = 15000;       // …or this long, whichever comes first
const MAX_QUEUE = 200;        // hard cap, dropping the OLDEST — see enqueue()
const ERROR_LIMIT = 5;        // client_error events per session
const DEVICE_KEY = 'primos-run:device';
const OPTOUT_KEY = 'primos-run:no-analytics';

// ------------------------------------------------------------------- storage

/** localStorage, defensively — private mode and locked-down browsers throw. */
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
    /* blocked — this session simply won't persist its id */
  }
}

function uuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  // Good enough for a collision-free-in-practice id when randomUUID is missing.
  // Not used for anything security-bearing — the server pins user_id itself.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * The anonymous device id: a random UUID minted on first run.
 *
 * NOT a fingerprint and NOT derived from anything about the device or the
 * person. That choice is what makes the privacy note in ACCOUNT honest, and an
 * honest disclosure is the only kind worth writing.
 *
 * Exported for js/feedback.js, which files reports under the SAME id so a bug
 * report can be read next to what that device actually did. Minting a second id
 * there would have cost that link for no privacy gain — it would be one more
 * anonymous UUID for the same browser.
 *
 * ⚠ It is NOT gated on the opt-out, and js/feedback.js is the reason. Analytics
 * respects the toggle by not calling track() at all; feedback is a message the
 * player typed and pressed send on, and it needs an id to be rate-limited by
 * and to group repeat reports under. An opted-out player has no event log for
 * it to join to, so the id links their report to nothing. The UI says so.
 */
export function deviceId() {
  let id = readLocal(DEVICE_KEY);
  if (!id || id.length < 8) {
    id = uuid();
    writeLocal(DEVICE_KEY, id);
  }
  return id;
}

// Minted per app open, memory only — this is what turns a flat stream into
// sessions, bounce rates and lengths.
let sessionId = null;

// ------------------------------------------------------------------- opt-out

/** True when the player has turned analytics off. */
export function isOptedOut() {
  return readLocal(OPTOUT_KEY) === '1';
}

/**
 * Turn collection on or off. Opting out also DROPS whatever is queued — leaving
 * it to flush later would mean the toggle lied about the moment it was flipped.
 */
export function setOptedOut(off) {
  try {
    if (off) {
      localStorage.setItem(OPTOUT_KEY, '1');
      queue.length = 0;
      if (timer) { clearTimeout(timer); timer = null; }
    } else {
      localStorage.removeItem(OPTOUT_KEY);
    }
  } catch {
    /* blocked — nothing else to do */
  }
}

/** The one gate every path checks. */
function live() {
  return isCloudConfigured() && !!SUPABASE_URL && !!SUPABASE_ANON_KEY && !isOptedOut();
}

// --------------------------------------------------------------------- queue

/** @type {Array<object>} */
const queue = [];
let timer = null;

// Session-scoped: set on the first 400 while sending event_ids, meaning the
// server predates the event_id column. Next launch retries ids and heals once
// the migration is applied.
let schemaFallback = false;

function enqueue(row) {
  queue.push(row);
  // Drop the OLDEST past the cap. During a long offline stretch the RECENT
  // events are the ones describing the player now; the old ones are the least
  // valuable thing in the buffer.
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (queue.length >= FLUSH_AT) {
    void flush();
  } else if (!timer) {
    timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS);
  }
}

/**
 * Record something that happened. Synchronous, void, and it cannot throw —
 * call it from anywhere, including next to the game loop.
 *
 * @param {string} name one of EVENTS
 * @param {object} [props] small, JSON-serialisable. The server bounds this to a
 *   2KB object and replaces anything else with {}, so a mistake here costs the
 *   props and never the row.
 */
export function track(name, props) {
  try {
    if (!live() || !name) return;
    sessionId ??= uuid();
    const s = cloudSession();
    enqueue({
      device_id: deviceId(),
      session_id: sessionId,
      user_id: s ? s.userId : null,
      name: String(name).slice(0, 40),
      // Serialised here rather than at flush time so a circular or otherwise
      // unserialisable object is caught by THIS try/catch, next to the caller
      // that can be fixed — not by the flush, which would drop a whole batch of
      // unrelated events for one bad prop.
      props: safeProps(props),
      app_version: APP_VERSION,
      // Minted here and KEPT across re-queues. That persistence IS the dedupe:
      // a flush whose response was lost re-sends the same ids and the server
      // ignores the duplicates.
      event_id: uuid(),
    });
  } catch {
    /* analytics must never be the reason anything else fails */
  }
}

function safeProps(props) {
  try {
    if (!props || typeof props !== 'object') return {};
    const out = JSON.parse(JSON.stringify(props));
    return out && typeof out === 'object' && !Array.isArray(out) ? out : {};
  } catch {
    return {};
  }
}

// --------------------------------------------------------------------- flush

/**
 * The signed-in player's JWT, so RLS admits the `user_id` on their rows.
 *
 * Read through cloud.js's lazy singleton rather than a second client — and only
 * when there IS a session, so an unconfigured or signed-out build never causes
 * the supabase-js import. Signed out, the publishable key is sent instead and
 * the rows carry a null user_id, which is exactly what the policy expects.
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

function requeue(batch) {
  queue.unshift(...batch);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
}

/**
 * Send what is queued.
 *
 * @param {boolean} [unloading] set on the way out of the page. This is the ONLY
 *   path that captures "the player quit here", which is the most valuable event
 *   in the whole set — and `keepalive` is the single flag that lets the request
 *   outlive the document. It is also why this uses raw fetch rather than
 *   supabase-js, which does not expose it.
 */
async function flush(unloading = false) {
  if (!live() || queue.length === 0) return;
  if (timer) { clearTimeout(timer); timer = null; }
  const batch = queue.splice(0, queue.length);

  try {
    const token = await authToken();
    const body = JSON.stringify(
      schemaFallback ? batch.map(({ event_id: _drop, ...rest }) => rest) : batch,
    );
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/primos_events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
          // A PLAIN INSERT. Not `?on_conflict=event_id` +
          // `resolution=ignore-duplicates`, which is the shape the idempotency
          // literature (and this project's own first draft) reaches for.
          //
          // ⚠ THAT SHAPE CANNOT WORK ON THIS TABLE, EVER. `ON CONFLICT` makes
          // Postgres require SELECT rights on the target, so the rewriter folds
          // the table's SELECT policies in as an extra WITH CHECK on the new
          // row. This table has NO select policy, deliberately and permanently,
          // so that check is a constant false and every batch comes back
          // 42501 → 401. Measured against production on 2026-07-31: the plain
          // insert answered 201 and the on_conflict one answered
          // `42501 new row violates row-level security policy` — an error that
          // NAMES NO POLICY, which is the tell.
          //
          // No select policy can fix it either: the check runs against the NEW
          // row, so it would have to be `using (true)` — i.e. publishing the
          // whole behavioural log, which is the one thing this design exists to
          // prevent.
          //
          // The dedupe therefore lives in the GUARD TRIGGER instead (see the
          // migration), which has the further advantage of catching plain
          // inserts from any older cached bundle. Verified live: the same
          // event_id sent twice → 201, 201, one row stored.
          //
          // return=minimal is correctness for the same underlying reason —
          // asking PostgREST to return the inserted rows makes it read them
          // back, which this table also refuses.
          Prefer: 'return=minimal',
        },
        body,
        keepalive: unloading,
        cache: 'no-store',
      },
    );
    if (!res.ok) {
      if (res.status >= 500) {
        requeue(batch);                      // server trouble — keep, retry later
      } else if (!schemaFallback && res.status === 400) {
        // The server predates the event_id column: a client that is ahead of
        // its own migration must DELAY its events, never lose them.
        schemaFallback = true;
        requeue(batch);
      }
      // Any other 4xx is a request this server will never accept. Re-queueing it
      // would retry it forever and starve the queue of events that could land.
      //
      // ⚠ A 401/42501 here is not transient and not the player's fault — it
      // means the insert is being refused by RLS, i.e. the wire shape or the
      // policies have regressed, and EVERY batch is being silently discarded.
      // Nothing in the client can report that (the only channel out is the pipe
      // that is failing), which is exactly why scripts/verify-rls.sh asserts the
      // anonymous insert against production and calls a refusal "analytics is
      // DEAD, and the client cannot tell you". Run it after any migration.
    }
  } catch {
    requeue(batch);                          // transport / offline — keep
  }
}

/** Send everything now. Used by the opt-out UI so a toggle has a visible effect. */
export function flushNow() {
  try {
    void flush();
  } catch {
    /* never throws */
  }
}

// ----------------------------------------------------------- crash telemetry

let errorsSent = 0;
const seenErrors = new Set();

/**
 * A crash, as an event. Capped twice over — N per session AND one per distinct
 * message — because the thing that produces errors here is a render frame, and
 * an error loop in a render frame would otherwise flood the pipe at 60Hz and
 * bury every real signal in the window.
 *
 * On the dashboard these are split BY BUILD. That column is what turns
 * "something broke" into "this deploy broke it"; without this layer a broken
 * deploy is simply silence.
 */
export function reportClientError(message, extra) {
  try {
    const msg = String(message ?? 'unknown').slice(0, 200);
    if (errorsSent >= ERROR_LIMIT || seenErrors.has(msg)) return;
    seenErrors.add(msg);
    errorsSent++;
    track(EVENTS.CLIENT_ERROR, { message: msg, ...(extra || {}) });
  } catch {
    /* the reporter must never itself throw */
  }
}

const basename = (u) => String(u || '').split('/').pop()?.split('?')[0] ?? '';
const firstFrames = (stack) =>
  String(stack ?? '').split('\n').slice(0, 3).join(' | ').slice(0, 300);

// --------------------------------------------------------------------- init

let started = false;

/**
 * Wire the lifecycle listeners and record the open.
 *
 * ⚠ CALL THIS AFTER THE CLOUD HAS BOOTED (js/cloud.js bootstrapCloud), so a
 * returning signed-in player's first events carry their user id rather than a
 * null that later events contradict.
 */
export function initAnalytics() {
  try {
    if (started) return;
    started = true;

    // `??=`, not `=`. Events can legitimately be tracked before init runs — a
    // service-worker update toast, an error during boot — and overwriting the
    // id here would split one session into two.
    sessionId ??= uuid();

    // The leaving flush. visibilitychange→hidden is the ONLY reliable signal on
    // iOS: beforeunload and unload do not fire when an installed PWA is swiped
    // away, and this game installs to exactly that.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush(true);
    });
    window.addEventListener('pagehide', () => { void flush(true); });
    window.addEventListener('online', () => { void flush(); });

    window.addEventListener('error', (e) => {
      reportClientError(e.message, {
        // Basename only. A full URL is bytes, not signal, and on a static host
        // it is the same string on every row.
        source: `${basename(e.filename)}:${e.lineno}`,
        stack: firstFrames(e.error?.stack),
      });
    });
    window.addEventListener('unhandledrejection', (e) => {
      reportClientError(e.reason?.message ?? e.reason, {
        kind: 'promise',
        stack: firstFrames(e.reason?.stack),
      });
    });

    track(EVENTS.APP_OPEN, {
      // Installed usage vs a browser tab. This is the number that says whether
      // the PWA work is doing anything.
      standalone: !!(window.matchMedia?.('(display-mode: standalone)').matches
        || window.navigator.standalone),
      lang: document.documentElement.lang || null,
      signed_in: !!cloudSession(),
    });
  } catch {
    /* boot must never fail because of analytics */
  }
}
