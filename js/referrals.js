// INVITES — the read/write surface over public.primos_referral_codes and
// public.primos_referrals (supabase/migrations/0002_primos_referrals.sql).
//
// FLOW: every signed-in player mints one short code (mintMyCode). The invite
// link carries ?ref=CODE; the friend's browser stashes it at boot
// (captureRefFromUrl) and it survives there until they sign in — even if that is
// days later. After sign-in their client inserts its own referrals row
// (maybeRegisterReferral — one per account, EVER). Once their best run passes
// QUALIFY_SCORE their client stamps qualified_at (maybeQualify); the referrer's
// client later finds qualified-unclaimed rows (fetchPendingRewards), pays out
// and stamps claimed_at (claimReferralRewards). The friend's own welcome chelas
// ride a latch in the save (isWelcomePending / claimWelcome).
//
// Design contract (mirrors js/cloud.js and js/leaderboard.js exactly):
//   · DORMANT until configured AND signed in. Every export no-ops or returns
//     empty when js/cloud-config.js is blank or the player is signed out, so the
//     invite panel simply does not appear on the build this game ships as.
//   · NOTHING HERE MAY EVER THROW INTO THE GAME. A referral is not worth a
//     crashed run, or a crashed ACCOUNT screen.
//   · The SAVE stays authoritative for everything the player owns — the chelas
//     and the welcome latch. The cloud rows only coordinate the two accounts;
//     they never hold a balance.
//   · Registration and qualification PIGGYBACK the cloud-save push (js/cloud.js
//     calls both after each successful upsert), so there is no new traffic path
//     and no timer. Session memos keep the steady state at zero queries.
//
// CODE VISIBILITY: this module reads primos_referral_codes only for the caller's
// OWN row. Resolving somebody else's code goes through the SECURITY DEFINER
// primos_resolve_referral_code() — the table is own-rows-only and there is no
// permissive select policy to fall back on. See the long note in the migration
// about why Viva Maya needed three migrations to reach that state and this game
// starts there.

import { cloudSession, isCloudConfigured, sbClient } from './cloud.js';
import * as store from './store.js';
import { balance } from './wallet.js';

// ------------------------------------------------------------------ constants

/**
 * The referee must have a BEST RUN this good before the referral pays out.
 *
 * Real play, not a click. Score is roughly one point per world unit plus ten a
 * chela (js/config.js SCORE), so this is a couple of minutes of genuinely
 * dodging things rather than a fresh account that pressed start and died. That
 * gate is most of what makes farming unattractive: the work per head is real and
 * the prize is two runs' pocket money.
 */
export const QUALIFY_SCORE = 1500;

/** Lifetime cap on REWARDED invites per player. Farming stays unprofitable. */
export const REFERRAL_CAP = 20;

/**
 * What each side banks, in chelas.
 *
 * Priced against la tiendita (js/tiendita.js): the shelf runs 20–55 and a good
 * run pays 25–45, so the referrer's cut buys the top of the shelf outright and
 * the newcomer's welcome covers a mid item on their first day. Generous enough
 * to be worth sending, small enough that beating the anti-farm rules wins you
 * about two runs' takings.
 */
export const REFERRER_CHELAS = 60;
export const REFEREE_CHELAS = 30;

/**
 * The share link's base, hardcoded to the CANONICAL url rather than built from
 * location.href.
 *
 * corrupt.solutions/games/primos/ fronts the GitHub Pages deploy and is the URL
 * the game is advertised under, so that is the one that should circulate. A link
 * built from wherever the player happens to be running would spread the
 * github.io origin instead — and localStorage is per-origin, so a friend who
 * arrives there gets a save that has nothing to do with the one they would have
 * had on the canonical domain.
 *
 * THE TRAILING SLASH STAYS. The corrupt.solutions proxy 308s the slash-less form
 * to this one with the query preserved, so `?ref=` survives either way — but
 * only the slashed form skips the redirect.
 */
const SHARE_BASE = 'https://corrupt.solutions/games/primos/';

/** Where a captured invite waits until sign-in resolves it. */
const REF_STASH_KEY = 'primos-run:ref';

const CODE_RE = /^[A-Z0-9]{6}$/;
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const int = (n) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** Lazy, shared client — cloud.js owns the singleton; this never makes a second. */
async function client() {
  if (!isCloudConfigured() || !cloudSession()) return null;
  return sbClient();
}

// -------------------------------------------------------------- the ?ref= stash

function readStash() {
  try {
    const raw = localStorage.getItem(REF_STASH_KEY);
    return raw && CODE_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function clearStash() {
  try {
    localStorage.removeItem(REF_STASH_KEY);
  } catch {
    /* best-effort — a stash we cannot clear just costs one redundant lookup */
  }
}

/**
 * Boot hook (one line in js/main.js): capture a `?ref=CODE` invite into
 * localStorage before anything can navigate it away, and mirror it into the save
 * so the panel can say who invited you.
 *
 * NEVER OVERWRITES AN EXISTING STASH — the first inviter wins. Otherwise the last
 * link a player happened to click would silently steal a friend's referral, and
 * whoever sends the most links wins rather than whoever actually brought the
 * player in.
 *
 * Local-only and safe when dormant: this runs on the shipping build too, it just
 * never gets redeemed until the cloud is configured.
 */
export function captureRefFromUrl() {
  try {
    const raw = new URLSearchParams(window.location.search).get('ref');
    if (!raw) return;
    const code = raw.trim().toUpperCase();
    if (!CODE_RE.test(code)) return;
    if (readStash()) return;
    localStorage.setItem(REF_STASH_KEY, code);
    store.setReferredBy(code);
  } catch {
    /* storage blocked or a malformed URL — the invite is lost, never the boot */
  }
}

/** The invite URL for a code — what the share button and the copy field hand out. */
export function inviteLink(code) {
  return `${SHARE_BASE}?ref=${encodeURIComponent(code)}`;
}

// ------------------------------------------------------- my code (referrer side)

// Memoized per user id so the steady state costs nothing; cleared on sign-out.
let myCodeMemo = null;

function randomCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}

/**
 * Get-or-create this player's own 6-character invite code.
 *
 * Mints on first call and memoizes for the session. Returns null when dormant,
 * signed out or offline — the panel reads that as "not yet", never as an error.
 *
 * The retry loop handles a code collision (36^6 keyspace, so vanishingly rare)
 * and the genuinely likely race: the same account minting from two devices at
 * once. Both surface as the same unique violation, so on any insert error we
 * re-read our own row before trying again — if the other device won, its code is
 * now ours and there is nothing left to do.
 */
export async function mintMyCode() {
  try {
    const s = cloudSession();
    if (!s) return null;
    if (myCodeMemo && myCodeMemo.userId === s.userId) return myCodeMemo.code;
    const c = await client();
    if (!c) return null;

    // user_id is UNIQUE, so there is at most one row to find.
    const existing = await c
      .from('primos_referral_codes')
      .select('code')
      .eq('user_id', s.userId)
      .maybeSingle();
    const found = existing.data && existing.data.code;
    if (typeof found === 'string' && CODE_RE.test(found)) {
      myCodeMemo = { userId: s.userId, code: found };
      return found;
    }
    // A read that FAILED is not the same as a read that found nothing. Minting
    // on a transient error would hand this account a second code it can never
    // use, so back off and let the next call try again.
    if (existing.error) return null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomCode();
      const ins = await c.from('primos_referral_codes').insert({ code, user_id: s.userId });
      if (!ins.error) {
        myCodeMemo = { userId: s.userId, code };
        return code;
      }
      const raced = await c
        .from('primos_referral_codes')
        .select('code')
        .eq('user_id', s.userId)
        .maybeSingle();
      const racedCode = raced.data && raced.data.code;
      if (typeof racedCode === 'string' && CODE_RE.test(racedCode)) {
        myCodeMemo = { userId: s.userId, code: racedCode };
        return racedCode;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------- register (referee side)

// Once registration reaches a TERMINAL state this becomes a free no-op for the
// session. The absent stash is the natural cross-session memo: success and
// definitive rejection both clear it, a transient failure keeps it.
let registerDoneFor = null;

/**
 * If an invite is stashed and this account has never been referred, resolve the
 * code to its owner and insert our referrals row.
 *
 * THE STASH IS ONLY CLEARED ON A DEFINITIVE ANSWER — dead code, our own code,
 * already registered, or a server rejection that says so (23505 duplicate,
 * 23514 self-referral). Every other failure is treated as transient and keeps
 * the stash for the next push, because clearing it destroys the referral
 * outright: there is no second copy and no way to ask the friend to click again.
 *
 * Self-referral and double-referral are impossible server-side regardless (the
 * check constraint and the PK); the client-side checks exist so the common cases
 * resolve without a round trip that is guaranteed to fail.
 */
export async function maybeRegisterReferral() {
  try {
    const s = cloudSession();
    if (!s || registerDoneFor === s.userId) return;
    const stash = readStash();
    if (!stash) {
      registerDoneFor = s.userId;
      return;
    }
    const c = await client();
    if (!c) return;

    // Already referred? The PK is the referee, so there is one row per account.
    const mine = await c
      .from('primos_referrals')
      .select('referee_user_id')
      .eq('referee_user_id', s.userId)
      .maybeSingle();
    if (mine.error) return;                 // transient — retry on the next push
    if (mine.data) {
      clearStash();                         // definitive: already registered
      registerDoneFor = s.userId;
      return;
    }

    // Resolve through the SECURITY DEFINER function, never a table read — see the
    // note at the top of this file and the migration.
    const owner = await c.rpc('primos_resolve_referral_code', { p_code: stash });
    if (owner.error) return;                // transient — retry on the next push
    const referrerId = typeof owner.data === 'string' ? owner.data : null;
    if (!referrerId || referrerId === s.userId) {
      clearStash();                         // definitive: dead code, or our own
      registerDoneFor = s.userId;
      return;
    }

    const ins = await c
      .from('primos_referrals')
      .insert({ referee_user_id: s.userId, referrer_user_id: referrerId });
    if (!ins.error) {
      clearStash();
      registerDoneFor = s.userId;
      return;
    }
    const code = ins.error && ins.error.code;
    if (code === '23505' || code === '23514') {
      clearStash();
      registerDoneFor = s.userId;
    }
  } catch {
    /* transient — the stash survives and the next push retries */
  }
}

// -------------------------------------------------------- qualify (referee side)

// Qualification is a one-way latch (set-once server-side), so once we have seen a
// terminal state this is free for the rest of the session. Memoing "no row" is
// safe because registration always runs BEFORE this in the push chain, so a row
// minted this session is seen by the very next call.
let qualifyDoneFor = null;

/**
 * If this account was referred and its best run now passes QUALIFY_SCORE, stamp
 * qualified_at. The guard trigger overwrites our timestamp with the server
 * clock and makes it set-once, so a client lying about the time buys nothing.
 *
 * @param {object} save the save being pushed — cloud.js hands us the authoritative
 *   blob it just wrote, not a caller's stale copy.
 */
export async function maybeQualify(save) {
  try {
    const s = cloudSession();
    if (!s || qualifyDoneFor === s.userId) return;
    if (int(save && save.best) < QUALIFY_SCORE) return;
    const c = await client();
    if (!c) return;

    const mine = await c
      .from('primos_referrals')
      .select('qualified_at')
      .eq('referee_user_id', s.userId)
      .maybeSingle();
    if (mine.error) return;                 // transient — retry on the next push
    if (!mine.data) {
      qualifyDoneFor = s.userId;            // never referred — terminal
      return;
    }
    if (mine.data.qualified_at !== null) {
      qualifyDoneFor = s.userId;            // already stamped (set-once)
      return;
    }
    const upd = await c
      .from('primos_referrals')
      .update({ qualified_at: new Date().toISOString() })
      .eq('referee_user_id', s.userId);
    if (!upd.error) qualifyDoneFor = s.userId;
  } catch {
    /* transient — the next push retries */
  }
}

// ------------------------------------------------------- rewards (referrer side)

async function fetchMyRows() {
  const s = cloudSession();
  if (!s) return null;
  const c = await client();
  if (!c) return null;
  const { data, error } = await c
    .from('primos_referrals')
    .select('referee_user_id, qualified_at, claimed_at')
    .eq('referrer_user_id', s.userId);
  if (error || !data) return null;
  return data;
}

/**
 * Counts for the invite panel: how many friends registered, how many have played
 * far enough to pay out, and how many have already been collected. Null when
 * dormant / signed out / offline, which the panel shows as "—" rather than zero —
 * a real zero and "we could not ask" are different things to a player counting
 * their invites.
 */
export async function fetchMyReferralStats() {
  try {
    const rows = await fetchMyRows();
    if (!rows) return null;
    return {
      invited: rows.length,
      qualified: rows.filter((r) => r.qualified_at !== null).length,
      claimed: rows.filter((r) => r.claimed_at !== null).length,
      cap: REFERRAL_CAP,
    };
  } catch {
    return null;
  }
}

/**
 * My qualified-but-unclaimed invites, oldest first, trimmed so the lifetime
 * rewarded count can never pass REFERRAL_CAP. Empty when dormant or when there
 * is nothing to collect.
 */
export async function fetchPendingRewards() {
  try {
    const rows = await fetchMyRows();
    if (!rows) return [];
    const claimed = rows.filter((r) => r.claimed_at !== null).length;
    const room = Math.max(0, REFERRAL_CAP - claimed);
    if (room === 0) return [];
    return rows
      .filter((r) => r.qualified_at !== null && r.claimed_at === null)
      .sort((a, b) => String(a.qualified_at).localeCompare(String(b.qualified_at)))
      .slice(0, room)
      .map((r) => ({ refereeUserId: r.referee_user_id, qualifiedAt: r.qualified_at }));
  } catch {
    return [];
  }
}

/**
 * Collect the rows from fetchPendingRewards: stamp each claimed_at in the cloud
 * FIRST, then pay out locally for the stamps that actually landed.
 *
 * That order is the whole design. The guarded update — RLS confines us to our own
 * rows, `.is('claimed_at', null)` makes a raced double-claim match ZERO rows, and
 * `.select()` returns only what was truly stamped — is what makes the payout
 * exactly-once. Paying first and stamping after would mint chelas on every failed
 * stamp, and two devices collecting at the same moment would both pay.
 *
 * Rows that fail to stamp (offline, or another device got there first) pay
 * NOTHING and simply reappear in the next fetch.
 *
 * @returns {Promise<{claimed: number, chelas: number|null}>}
 */
export async function claimReferralRewards(rows) {
  try {
    const s = cloudSession();
    const c = await client();
    if (!s || !c || !rows || rows.length === 0) return { claimed: 0, chelas: null };
    let claimed = 0;
    for (const row of rows.slice(0, REFERRAL_CAP)) {
      const upd = await c
        .from('primos_referrals')
        .update({ claimed_at: new Date().toISOString() })
        .eq('referee_user_id', row.refereeUserId)
        .eq('referrer_user_id', s.userId)
        .is('claimed_at', null)
        .select('referee_user_id');
      if (!upd.error && Array.isArray(upd.data) && upd.data.length > 0) claimed++;
    }
    if (claimed === 0) return { claimed: 0, chelas: null };
    return { claimed, chelas: grantChelas(claimed * REFERRER_CHELAS) };
  } catch {
    return { claimed: 0, chelas: null };
  }
}

/**
 * Add chelas through the money seam.
 *
 * balance() first, always: it runs the one-time wallet migration that derives a
 * returning player's balance from their lifetime beers (js/wallet.js state()).
 * Adding to an unseeded wallet and then letting that migration run would throw
 * the reward away.
 */
function grantChelas(amount) {
  const add = int(amount);
  if (!add) return null;
  balance();
  let out = null;
  store.writeEcon((b) => {
    out = int(b.chelas) + add;
    b.chelas = out;
  });
  return out;
}

// -------------------------------------------------------- welcome (referee side)

// Once we know our own row is qualified, stop asking — the remaining gate is the
// local latch, which is free to check.
let welcomeQualifiedFor = null;

/**
 * Should the newcomer's one-time welcome play? True when signed in, our own
 * referral row has qualified, and the save's latch has not been spent yet.
 */
export async function isWelcomePending(save) {
  try {
    if (save && save.referralWelcomeClaimed) return false;
    const s = cloudSession();
    if (!s) return false;
    if (welcomeQualifiedFor === s.userId) return true;
    const c = await client();
    if (!c) return false;
    const mine = await c
      .from('primos_referrals')
      .select('qualified_at')
      .eq('referee_user_id', s.userId)
      .maybeSingle();
    if (mine.error || !mine.data) return false;
    const qualified = mine.data.qualified_at !== null;
    if (qualified) welcomeQualifiedFor = s.userId;
    return qualified;
  } catch {
    return false;
  }
}

/**
 * Pay the newcomer's welcome, ONCE — the chelas and the latch flip in a single
 * write against storage, so the two can never tear apart and be paid twice.
 *
 * Purely local. The latch rides the cloud-synced save and js/merge.js unions it,
 * so signing in on a second device cannot re-open it.
 *
 * @returns {number|null} the new balance, or null when it was already claimed.
 */
export function claimWelcome() {
  balance();                                // seed the wallet before touching it
  let out = null;
  store.writeEcon((b) => {
    // Already spent — return without touching the blob, so writeEcon sees no
    // change, writes nothing and costs no cloud push.
    if (b.referralWelcomeClaimed) return;
    b.referralWelcomeClaimed = true;
    out = int(b.chelas) + REFEREE_CHELAS;
    b.chelas = out;
  });
  return out;
}
