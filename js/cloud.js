// Cloud save + Google sign-in. The single public surface for the sync layer —
// nothing else in the game talks to Supabase directly, so the two contracts
// below are enforced in one place.
//
// DESIGN CONTRACT:
//   · DORMANT UNTIL CONFIGURED. With js/cloud-config.js empty, every export here
//     no-ops and the game behaves exactly as it did before this file existed.
//     The supabase-js module is never even fetched.
//   · NOTHING HERE MAY EVER THROW INTO THE GAME. Every network path is wrapped
//     and swallows. A cloud save is not worth a crashed run.
//   · localStorage stays AUTHORITATIVE (js/store.js). At boot we pull the cloud
//     row, MERGE it with local (js/merge.js), persist the winner, and push it
//     back so both ends converge. Thereafter every store.save() debounce-pushes.
//   · Identity is a Google account, so progress survives a cleared browser and
//     follows the player to a new phone.

import { GAME_ID, SUPABASE_ANON_KEY, SUPABASE_ESM, SUPABASE_URL } from './cloud-config.js';
import { mergeSaves } from './merge.js';
import * as store from './store.js';

/** True only when both config strings are set — the gate every path checks. */
export function isCloudConfigured() {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

let clientPromise = null;

/**
 * Lazily load supabase-js — ONLY when configured.
 *
 * A dynamic import rather than a top-level one, for two reasons that both
 * matter here: this project has no bundler, so the specifier is a CDN URL and a
 * static import would make the whole game's boot wait on a third-party host;
 * and the dormant contract means an unconfigured build must never make the
 * request at all. sw.js does not (and must not) precache it — cross-origin GETs
 * are explicitly not intercepted there, so offline it simply fails and the game
 * carries on local-only, which is the correct behaviour.
 */
async function sb() {
  if (!isCloudConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import(/* @vite-ignore */ SUPABASE_ESM)
      .then((m) =>
        m.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          // detectSessionInUrl is what completes the OAuth redirect on the way
          // back in. Without it the player lands back on the game still signed
          // out, with the tokens sitting unread in the URL.
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        }),
      )
      .catch(() => null);   // offline / CDN down — stay dormant rather than throw
  }
  return clientPromise;
}

/** Shared accessor for js/leaderboard.js — hands out the SAME lazy singleton. */
export function sbClient() {
  return sb();
}

let session = null;          // { userId, email } or null
const listeners = new Set();

function notify() {
  for (const l of listeners) {
    try { l(); } catch { /* a listener error must not cascade */ }
  }
}

/** Subscribe to auth/session changes (the sign-in UI uses this). */
export function onCloudChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The current signed-in session, or null (signed out / unconfigured). */
export function cloudSession() {
  return session;
}

// ------------------------------------------------------------- pull / push

/** The signed-in player's cloud save, coerced — or null. */
export async function pullCloudSave() {
  const c = await sb();
  if (!c || !session) return null;
  try {
    // public.game_saves is SHARED across every game in this project, keyed
    // (user_id, game) — see GAME_ID in cloud-config.js. Both halves of the key
    // are required or a player's Turbo Maze save would answer for this one.
    const { data, error } = await c
      .from('game_saves')
      .select('data')
      .eq('user_id', session.userId)
      .eq('game', GAME_ID)
      .maybeSingle();
    if (error || !data) return null;
    return store.coerce(data.data);
  } catch {
    return null;
  }
}

let pushTimer = null;
let pending = null;

/**
 * Debounced upsert of the save. A finished run writes the save two or three
 * times in a second and one upsert should carry them all — hence 1.5s. No-op
 * when dormant or signed out. Never throws.
 */
export function pushCloudSave(data) {
  if (!isCloudConfigured() || !session) return;
  pending = data;
  if (pushTimer) return;
  pushTimer = setTimeout(() => { void flushPush(); }, 1500);
}

/**
 * Push the queued save NOW, skipping the debounce.
 *
 * The debounce is right for gameplay and WRONG for a deliberate one-off act the
 * player expects to have stuck. "Set my race name, then close the browser" fits
 * inside 1.5s: the name would reach the boards (setHandle renames those rows
 * directly) but never the cloud SAVE, so the next device would restore progress
 * without it. Safe to call with nothing queued.
 */
export async function flushCloudSaveNow() {
  if (!isCloudConfigured() || !session) return;
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  try {
    await flushPush();
  } catch {
    // flushPush guards its own upsert, but `await sb()` is a dynamic import and
    // can fail outside that guard. Callers use `void flushCloudSaveNow()`, so a
    // rejection would surface as an unhandled one.
  }
}

async function flushPush() {
  pushTimer = null;
  const c = await sb();
  const data = pending;
  pending = null;
  if (!c || !session || !data) return;
  try {
    await c.from('game_saves').upsert(
      { user_id: session.userId, game: GAME_ID, data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,game' },   // the composite key — 'user_id' alone would collide across games
    );
    // The board rides the same beat — no second traffic path, no timer of its
    // own. Fire-and-forget and lazily imported: a leaderboard must never block
    // or fail a save, and the boot path must not pull it in.
    void import('./leaderboard.js').then((m) => { void m.maybeSubmitDaily(data); });
    // Invites ride the same beat, for the same reasons — no second traffic path,
    // no timer, and lazily imported so the boot path never pulls them in.
    //
    // THE ORDER IS LOAD-BEARING. maybeQualify memoizes "this account was never
    // referred" as terminal for the session; run it first and it would latch
    // that against a row maybeRegisterReferral is about to create, so a friend
    // who signed in and immediately beat the qualify score would not pay out
    // until their next session.
    void import('./referrals.js').then(async (r) => {
      await r.maybeRegisterReferral();
      await r.maybeQualify(data);
    });
  } catch {
    pending = data;   // offline / transient → retry on the next persist or 'online'
  }
}

/**
 * Reconcile local ↔ cloud: pull, merge (see js/merge.js), persist the winner —
 * which re-triggers a push through the store listener — so both ends converge.
 */
export async function syncNow() {
  if (!session) return;
  const remote = await pullCloudSave();
  const local = store.load();
  const winner = remote ? mergeSaves(local, remote) : local;   // LOCAL first — it wins ties
  // The one caller allowed to write the money as-is: `local` above is a fresh
  // read, so `winner` already holds the newest balance this device has. Without
  // the flag save() would restore the econ fields from disk and the reconciled
  // wallet — the whole point of the money rules in js/merge.js — never lands.
  store.save(winner, true);
  // The race name rides the save. Adopt the merge winner's handle into this
  // device FIRST, then repair the player's board rows — in that order, or the
  // repair publishes whatever name this device happened to have instead of the
  // reconciled one. This is what restores a name after a cleared browser.
  void import('./leaderboard.js').then((m) => {
    m.adoptHandle(winner);
    void m.reconcileName();
  });
  pushCloudSave(winner);   // ensures a first-ever cloud row exists even if local was newest
}

// ------------------------------------------------------------------- auth

/**
 * Start Google sign-in. This REDIRECTS THE WHOLE PAGE to Google and back to
 * `redirectTo`, so nothing runs after it on success — the return is a fresh page
 * load where the client (detectSessionInUrl) establishes the session,
 * onAuthStateChange fires, and the null→session transition reconciles via
 * syncNow(). The only failure reportable from here is "the redirect couldn't be
 * started".
 *
 * Google rather than an emailed code because Supabase's built-in email sender is
 * throttled to roughly 2/hour and is explicitly testing-only — a code flow that
 * tests fine fails the day real players arrive — and because Google is one tap.
 */
export async function signInWithGoogle() {
  const c = await sb();
  if (!c) return { ok: false, error: 'Cloud save isn’t set up on this build.' };
  try {
    const { error } = await c.auth.signInWithOAuth({
      provider: 'google',
      // Strip the hash so we return to a clean URL; Supabase appends its own params.
      options: { redirectTo: window.location.href.split('#')[0] },
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch {
    return { ok: false, error: 'Couldn’t start Google sign-in. Please try again.' };
  }
}

/**
 * Finish signing in as a wallet.
 *
 * The Edge Function has already checked the signature and minted a one-time
 * token against the wallet's account; this trades it for a real session. From
 * here the wallet player is an ordinary signed-in user — cloud save, the board
 * and invites all key on `user_id` and none of them know or care how the
 * session was obtained.
 *
 * ⚠ NEVER CALLED WITH A TOKEN FROM ANYWHERE BUT THE GATE'S OWN RESPONSE. It is
 * a credential: whoever holds it becomes that wallet's account.
 *
 * Failure is survivable on purpose — js/gate.js keeps the pass either way, so a
 * holder whose session could not be established still gets into the game and
 * still plays locally. The account attaches on the next verify.
 */
export async function signInWithWalletToken(tokenHash) {
  const c = await sb();
  if (!c) return { ok: false, error: 'Cloud save isn’t set up on this build.' };
  try {
    const { error } = await c.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch {
    return { ok: false, error: 'Couldn’t finish signing in with that wallet.' };
  }
}

/**
 * Is this session a wallet account rather than a Google one?
 *
 * ⚠ The check is on the DOMAIN, and the address it matches is unroutable by
 * construction (RFC 2606 reserves `.invalid`). This exists so the ACCOUNT screen
 * never renders that address at a player: it is a stand-in auth.users demanded,
 * not a contact detail, and showing it would be both meaningless and alarming.
 */
export function isWalletSession() {
  return !!session?.email && session.email.endsWith('@wallet.primos.invalid');
}

export async function signOutCloud() {
  const c = await sb();
  if (!c) return;
  try { await c.auth.signOut(); } catch { /* best-effort */ }
}

// ------------------------------------------------------------------- boot

function applySession(s) {
  session = s && s.user ? { userId: s.user.id, email: s.user.email ?? null } : null;
}

/** Restore any existing session and wire listeners. Instant when unconfigured. */
export async function initCloud() {
  const c = await sb();
  if (!c) return;

  c.auth.onAuthStateChange((event, s) => {
    const hadSession = session !== null;
    applySession(s);
    notify();
    // OAuth returns via a full-page redirect with NO explicit verify step, so a
    // newly-established session — the null→session transition, which is exactly
    // what the redirect return produces — MUST reconcile here, BEFORE any local
    // persist can mirror a fresh save over the player's real cloud progress.
    // Idempotent alongside bootstrapCloud's own syncNow; the two just converge.
    //
    // Note the transition is NOT the same as the SIGNED_IN event: a returning
    // player's boot restore is also null→session, delivered as INITIAL_SESSION.
    // Reconcile on the transition (both need it); count only the event.
    if (session && !hadSession) void syncNow();
  });

  try {
    const { data } = await c.auth.getSession();
    applySession(data.session);
  } catch {
    session = null;
  }

  // Drain anything the network ate while offline.
  window.addEventListener('online', () => { if (pending) void flushPush(); });

  // Every existing store.save() call site now debounce-pushes, without any of
  // them knowing this file exists.
  store.onSave((data) => pushCloudSave(data));

  notify();
}

/**
 * Boot entry. For a signed-in returning player, reconcile BEFORE the game reads
 * the save — bounded by a timeout so a slow or captive network can never stall
 * first paint. Never throws.
 */
export async function bootstrapCloud(timeoutMs = 3000) {
  if (!isCloudConfigured()) return;
  try {
    await initCloud();
    if (session) {
      await Promise.race([syncNow(), new Promise((r) => setTimeout(r, timeoutMs))]);
    }
  } catch {
    // cloud must never block boot
  }
}
