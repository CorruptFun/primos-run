// The NFT gate, player side: connect a Solana wallet, prove it is yours, and
// find out whether it holds a Primo.
//
// ⚠ NOTHING IN THIS FILE DECIDES ANYTHING. It is a door handle. The verdict is
// made by supabase/functions/primos-gate, from a signature that function checks
// and a chain lookup that function makes with a key this browser never sees.
// Everything here can be edited by anyone with a console — so nothing here is
// ever asked to be trustworthy, and no call in this file is the thing that
// keeps a non-holder out of anything that matters.
//
// WHAT THAT MEANS HONESTLY. This is a static game on a public host: the JS is
// downloadable and runs locally, so a determined person can always strip the
// gate out and play. That is not a flaw in this design, it is a property of
// shipping a game as files. What server-side verification buys is that the
// CLAIM cannot be forged — nobody can convince the backend they hold a Primo
// when they do not — so everything the backend owns (the leaderboard, cloud
// save, anything added later) enforces the gate for real. The same distinction
// js/primo-picker.js already draws for claimStatus().
//
// The flow, once per PASS_TTL_MS:
//   1. ask the function for a nonce
//   2. wallet signs a human-readable message containing it
//   3. function verifies the signature, counts Primos on-chain, returns a pass
//   4. pass is kept here until it expires
//
// THERE ARE THREE WAYS TO GET A PASS, and only the first one is the flow above.
//
//   · verify()   — an injected provider, in this tab. Desktop extensions, and
//                  the wallet's own in-app browser.
//   · startHandoff() + collect()
//                — no provider here at all, which is EVERY mobile browser. The
//                  wallet is opened by universal link on the same phone, signs
//                  there, and the verdict is collected back through the Edge
//                  Function rather than through the browser.
//   · refresh()  — a session that is already linked to a proved wallet. No
//                  wallet interaction at all.
//
// ⚠ WHY THE HANDOFF IS NOT OPTIONAL POLISH. No wallet injects a provider into
// mobile Safari or mobile Chrome, so before it existed the only mobile route was
// the wallet's in-app browser — which has no Add to Home Screen. That made this
// PWA uninstallable on a phone the moment the gate went on, which is precisely
// backwards for a game meant to live on a home screen.
//
// ⚠ AND WHY IT GOES THROUGH THE SERVER RATHER THAN THE URL. The obvious version
// carries the answer back in the redirect and reads it here. It cannot work on
// iOS: a home screen web app is not a universal-link handler, so the return
// lands in Safari, and iOS gives the installed app its OWN storage jar — so a
// pass written on the way back is written where the app will never see it. The
// only shared ground between the two contexts is the backend, so that is the
// road the verdict travels. Once it does, WHERE the wallet hands back stops
// mattering at all, which is the property that makes this work on every phone
// rather than on the ones that happen to route links kindly.

import { GATE_ENABLED, GATE_FUNCTION, HANDOFF_PAGE, PASS_TTL_MS, WALLETS } from './gate-config.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './cloud-config.js';

const PASS_KEY = 'primos-run:gate-pass';
const HANDOFF_KEY = 'primos-run:gate-handoff';

/**
 * How long a handoff in progress is worth waiting on. Matches CLAIM_WINDOW_MS in
 * the Edge Function — the client giving up first is fine, the client waiting on
 * a window the server has already closed is a spinner that never resolves.
 */
export const HANDOFF_TTL_MS = 15 * 60 * 1000;

// A wallet prompt can sit unanswered forever — the extension window may be
// behind the browser, or the player may simply walk away. Every await that can
// hang has a fence, for the same reason every gateway fetch does.
const WALLET_TIMEOUT = 120000;   // signing is a human action; be patient
const NET_TIMEOUT = 20000;       // the function is not

/** Is the gate switched on AND pointed at somewhere real? */
export const enabled = () => !!(GATE_ENABLED && SUPABASE_URL && GATE_FUNCTION);

// -------------------------------------------------------------- base58

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Signature bytes -> base58, because that is what Solana tooling speaks and
 * what the Edge Function's decoder expects.
 *
 * Stated outright rather than pulled from a CDN: it is fifteen lines, and this
 * runs on the one path that decides whether the game opens. A dependency here
 * would be a third party able to change what executes in the page, for the sake
 * of an alphabet.
 */
export function b58encode(bytes) {
  if (!bytes || !bytes.length) return '';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  // ⚠ Drop the high-order zero digit, or an all-zero input encodes one
  // character too long. `digits` is little-endian and seeded with [0], so a
  // value of zero never grows past that seed — and then the leading-zero run
  // below writes a '1' for every byte AND this loop writes one more for the
  // seed. 32 zero bytes came out as 33 ones. Every non-zero value already ends
  // on a non-zero digit, so this pops nothing in the normal case.
  while (digits.length && digits[digits.length - 1] === 0) digits.pop();
  // Every leading zero byte is a leading '1', by definition of the encoding.
  let out = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

// -------------------------------------------------------------- the pass

/**
 * The stored verdict, or null.
 *
 * Expiry is checked HERE as well as on the server, and the local check is the
 * one that makes a sold Primo lose access without the player having to do
 * anything. A pass whose clock has run out is dropped rather than sent.
 */
export function storedPass() {
  try {
    const raw = JSON.parse(localStorage.getItem(PASS_KEY) || 'null');
    if (!raw || typeof raw.pass !== 'string' || typeof raw.exp !== 'number') return null;
    if (Date.now() >= raw.exp) return null;
    return raw;
  } catch {
    return null;
  }
}

function keepPass(wallet, pass, exp, count, tokens) {
  try {
    localStorage.setItem(PASS_KEY, JSON.stringify({
      wallet, pass, count,
      // The owned-token list, mirrored out of the signed pass for cheap reads.
      // The PASS is the authority — this copy is a convenience, and ownedTokens()
      // below re-reads it from the signed payload rather than trusting this.
      tokens: Array.isArray(tokens) ? tokens : [],
      // Never trust the server's expiry past our own ceiling: a bug or a
      // tampered response that hands out a ten-year pass must not become a
      // permanent bypass on this device.
      exp: Math.min(exp, Date.now() + PASS_TTL_MS),
    }));
  } catch {
    /* private mode — the gate simply asks again next launch */
  }
}

/** Forget the pass. The wallet is asked again on the next open. */
export function clearPass() {
  try { localStorage.removeItem(PASS_KEY); } catch { /* */ }
}

/**
 * The signed half of a pass, decoded.
 *
 * `base64url(payload).base64url(hmac)` — this reads the payload and nothing
 * else. The HMAC is deliberately not checked: the secret is the server's, and
 * pretending to verify it here would be theatre. What it buys is that every
 * caller reads from ONE signed place rather than from fields sitting beside it,
 * which a console can append to.
 */
function payloadOf(pass) {
  try {
    const [payload] = String(pass).split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/**
 * Take delivery of a winning answer, however it was won.
 *
 * ⚠ THE PASS IS KEPT BEFORE THE SESSION IS EXCHANGED, AND THAT ORDER IS THE
 * POINT. Getting in and having an account are separate goods: a holder whose
 * session cannot be established — CDN down, storage blocked, a Supabase hiccup —
 * must still walk through the door they proved they own. Swallowed for the same
 * reason, and it re-attaches on the next verify.
 *
 * Shared by all three routes on purpose. Three copies of "keep the pass, then
 * try for a session" is three places for that order to be quietly reversed.
 */
async function land(body) {
  // The address off the SIGNED payload rather than out of the response beside
  // it — the same rule ownedTokens() follows, and the reason collect() needs no
  // wallet field of its own.
  const address = String(payloadOf(body.pass)?.w || '');
  keepPass(address, body.pass, Date.parse(body.expiresAt) || (Date.now() + PASS_TTL_MS),
    body.primoCount, body.tokens);

  // The wallet is also a login. The function mints a one-time token when the
  // collecting device had no session, and trading it here is what turns a holder
  // into an ordinary signed-in player: cloud save, the board and invites all key
  // on user_id from that point and none of them need to know a wallet was
  // involved.
  //
  // Imported lazily so the gate path does not pull supabase-js in for the
  // players who never get one (already signed in, or the exchange never fires).
  const tokenHash = body.session?.tokenHash;
  if (tokenHash) {
    try {
      const cloud = await import('./cloud.js');
      await cloud.signInWithWalletToken(tokenHash);
    } catch {
      /* in on the pass, account attaches next time */
    }
  }
  return {
    ok: true, holder: true, count: body.primoCount || 0, address,
    tokens: Array.isArray(body.tokens) ? body.tokens : [],
  };
}

// ------------------------------------------------------------- providers

const reach = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), window);

/**
 * The wallets that can be reached by universal link from an ordinary browser.
 *
 * Not the same question as available(): these need nothing injected, because
 * the point of them is that nothing IS injected.
 */
export function handoffWallets() {
  return WALLETS.filter((w) => typeof w.browse === 'string' && w.browse);
}

/** Can this device be sent to a wallet and back? */
export const canHandoff = () => !!(enabled() && HANDOFF_PAGE && handoffWallets().length > 0);

/** The wallets actually installed in this browser, in WALLETS order. */
export function available() {
  const found = [];
  for (const w of WALLETS) {
    for (const p of w.path) {
      const provider = reach(p);
      // Solana providers all expose these two; the check keeps a half-injected
      // or unrelated global from being offered as a wallet.
      if (provider && typeof provider.connect === 'function'
          && typeof provider.signMessage === 'function') {
        found.push({ ...w, provider });
        break;
      }
    }
  }
  return found;
}

function fence(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms)),
  ]);
}

// ----------------------------------------------------------------- verify

async function callGate(payload, accessToken) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
  };
  const res = await fence(
    fetch(`${SUPABASE_URL}/functions/v1/${GATE_FUNCTION}`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    }),
    NET_TIMEOUT, 'the gate did not answer',
  );
  let body = null;
  try { body = await res.json(); } catch { /* a non-JSON error page */ }
  return { status: res.status, body: body || {} };
}

/**
 * The whole handshake for one wallet.
 *
 * @param {object} wallet one of available()
 * @param {string} [accessToken] the Supabase session token, when signed in, so
 *   the holder row can be linked to the account. Optional — the game plays
 *   local-only without one.
 * @param {{adopt?: string}} [opts] `adopt` signs a challenge that was issued
 *   elsewhere — the handoff page's whole job. The message still comes from the
 *   function, never from the URL that named the nonce.
 * @returns {Promise<{ok: boolean, holder?: boolean, count?: number,
 *   address?: string, handoff?: boolean, error?: string, retryable?: boolean}>}
 *   never throws.
 */
export async function verify(wallet, accessToken, opts = {}) {
  if (!enabled()) return { ok: true, holder: true, count: 0 };

  let address;
  try {
    const conn = await fence(wallet.provider.connect(), WALLET_TIMEOUT, 'wallet never answered');
    address = String(conn?.publicKey ?? wallet.provider.publicKey ?? '');
    if (!address) throw new Error('no public key');
  } catch (e) {
    // A refusal is a decision, not a fault. Distinguished from a failure so the
    // UI can say "you cancelled" rather than accusing the wallet of breaking.
    const msg = String(e?.message || e);
    return { ok: false, error: /reject|denied|cancel/i.test(msg) ? 'cancelled' : 'connect-failed' };
  }

  const challenge = await callGate(
    opts.adopt ? { action: 'challenge', adopt: opts.adopt } : { action: 'challenge' },
    accessToken,
  );
  if (challenge.status !== 200 || !challenge.body.nonce) {
    // 410 is the adopt path's own answer: the game's challenge went stale while
    // the player was getting here. Its own outcome, because "start again in the
    // game" is a different instruction from "the gate is down".
    if (challenge.status === 410) return { ok: false, error: 'handoff-stale' };
    return { ok: false, error: 'no-challenge', retryable: true };
  }

  let signature;
  try {
    const message = new TextEncoder().encode(challenge.body.message);
    const signed = await fence(
      wallet.provider.signMessage(message, 'utf8'), WALLET_TIMEOUT, 'signature never came back',
    );
    // Phantom returns { signature }, some wallets return the bytes directly.
    const bytes = signed?.signature ?? signed;
    signature = b58encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch (e) {
    const msg = String(e?.message || e);
    return { ok: false, error: /reject|denied|cancel/i.test(msg) ? 'cancelled' : 'sign-failed' };
  }

  const out = await callGate({
    action: 'verify', wallet: address, nonce: challenge.body.nonce, signature,
  }, accessToken);

  // ⚠ 502 IS NOT "YOU DO NOT HOLD ONE". The function fails closed when it
  // cannot reach the chain, and telling a paying holder they own nothing
  // because an RPC had a bad minute is the single worst thing this screen can
  // say. Kept as its own outcome all the way to the UI.
  if (out.status === 502 || out.body.retryable) {
    return { ok: false, error: 'chain-unreachable', retryable: true, address };
  }
  if (out.status !== 200 || !out.body.ok) {
    return { ok: false, error: out.body.error ? 'refused' : 'gate-failed', address, retryable: out.status >= 500 };
  }
  // A handoff is answered without a pass, on purpose: this browser is not the
  // one that plays, and the verdict is waiting for the device that asked. All
  // there is to do here is say it went through.
  if (out.body.handoff) {
    return { ok: true, handoff: true, holder: !!out.body.holder, count: out.body.primoCount || 0, address };
  }

  if (!out.body.holder) return { ok: true, holder: false, count: 0, address };

  return { ...(await land(out.body)), address };
}

// ---------------------------------------------------------------- handoff
//
// Sign over there, collect over here.
//
// ⚠ THE NONCE TRAVELS, THE TOKEN STAYS. The nonce goes into the wallet's browser
// in a URL — visible to that app, to its history, and to anything on the phone
// that can watch a deeplink. The claim demands the nonce AND a random token that
// never left this device, so a captured URL is half a key and the half that
// stays home is the half that matters. Put the token in the URL "to keep it
// simple" and anyone who sees that link collects somebody else's pass.

/** 32 bytes of CSPRNG, hex. Not the pass, not a signature — just unguessable. */
function randomToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Where to send the wallet, and where it should land.
 *
 * ⚠ BUILT FROM `location`, WHICH IS THE OPPOSITE OF js/referrals.js — and the
 * reason is worth stating, because the two look like the same decision. An
 * invite link IS the payload: it is going to somebody else's phone, and one
 * built from wherever the sender happened to be spreads the wrong origin and
 * lands the friend on a different save, so it is hardcoded. This link is going
 * five centimetres, to the same device, and the verdict comes back through the
 * Edge Function rather than through the page — so the origin carries nothing and
 * pinning it would only mean a test build sending players to production.
 *
 * @param {object} wallet one of handoffWallets()
 * @param {{nonce: string}} handoff from startHandoff()
 */
export function handoffUrl(wallet, handoff) {
  const page = new URL(HANDOFF_PAGE, location.href);
  page.search = `?n=${encodeURIComponent(handoff.nonce)}`;
  // The player's language rides along, because the page it lands on is in
  // another browser and cannot read the choice they made in this one — the
  // storage jars are separate, which is the whole reason this dance exists.
  const lang = document.documentElement.lang;
  if (lang) page.searchParams.set('l', lang);
  return wallet.browse
    .replace('%u', encodeURIComponent(page.href))
    .replace('%r', encodeURIComponent(new URL('.', location.href).href));
}

/** The handoff this device is waiting on, or null. */
export function pendingHandoff() {
  try {
    const h = JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null');
    if (!h || typeof h.nonce !== 'string' || typeof h.claimToken !== 'string') return null;
    if (Date.now() - (h.at || 0) >= HANDOFF_TTL_MS) return null;
    return h;
  } catch {
    return null;
  }
}

export function clearHandoff() {
  try { localStorage.removeItem(HANDOFF_KEY); } catch { /* */ }
}

/**
 * Begin a handoff: get a challenge nobody but this device can collect, and the
 * link that carries it to the wallet.
 *
 * ⚠ IT IS WRITTEN DOWN BEFORE THE PLAYER LEAVES. The app is about to be
 * backgrounded and may well be killed while they are in the wallet — a handoff
 * held only in a variable would be gone by the time they came back, and they
 * would be looking at the gate again with a perfectly good verdict sitting
 * uncollected on the server.
 *
 * ⚠ IT TAKES NO WALLET, and that is deliberate: one challenge serves every
 * wallet on the screen, because the nonce says nothing about who signs it. Mint
 * one per button instead and a player who taps Solflare after tapping Phantom
 * leaves the app polling a challenge nobody is going to sign.
 *
 * @param {string} [accessToken]
 */
export async function startHandoff(accessToken) {
  if (!enabled()) return { ok: true, holder: true, count: 0 };
  const claimToken = randomToken();
  const res = await callGate({ action: 'challenge', claimHash: await sha256hex(claimToken) }, accessToken);
  if (res.status !== 200 || !res.body.nonce) return { ok: false, error: 'no-challenge', retryable: true };

  const handoff = { nonce: res.body.nonce, claimToken, at: Date.now() };
  try {
    localStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    // Private mode. The dance still works for as long as the tab lives, which is
    // usually long enough — and refusing to start would be a worse answer than
    // one that survives everything except being killed.
  }
  return { ok: true, handoff };
}

/**
 * One attempt to collect. `pending` means keep asking.
 *
 * ⚠ PENDING IS ALSO WHAT A WRONG TOKEN LOOKS LIKE, by design on the server side
 * — wrong, expired, already-taken and not-yet all answer identically, so this
 * endpoint cannot be used to hunt for live nonces. The cost is that the only
 * honest way to stop is a clock, which is what HANDOFF_TTL_MS is for.
 */
export async function collect(handoff, accessToken) {
  if (!enabled()) return { ok: true, holder: true, count: 0 };
  if (!handoff) return { ok: false, error: 'no-handoff' };

  const out = await callGate(
    { action: 'claim', nonce: handoff.nonce, claimToken: handoff.claimToken }, accessToken,
  );
  if (out.status === 502 || out.body.retryable) return { ok: false, pending: true, retryable: true };
  if (out.status !== 200) return { ok: false, error: 'gate-failed', retryable: out.status >= 500 };
  if (out.body.pending) return { ok: false, pending: true };

  // Anything conclusive ends the handoff, including "you hold none" — leaving it
  // in place would have the app keep asking a question that has been answered.
  clearHandoff();
  if (!out.body.ok) return { ok: false, error: 'refused' };
  if (!out.body.holder) return { ok: true, holder: false, count: 0 };
  return await land(out.body);
}

// ---------------------------------------------------------------- refresh

/**
 * A new pass for a wallet this account has already proved, with no wallet in the
 * loop at all.
 *
 * ⚠ THIS IS WHAT STOPS THE HANDOFF FROM BEING A DAILY CHORE. A pass lasts a day,
 * and on iOS every renewal would otherwise be the whole app-switch dance again,
 * forever, because the installed app's storage jar is not the one the wallet
 * hands back to. The signature proved control of the key once; the session
 * carries it from then on, and the session renews silently in the app's own
 * storage.
 *
 * The chain is still re-asked server-side, so a sold Primo closes the door on
 * the next launch exactly as it would have. What is not re-asked is control of
 * the key — the same trade every "stay signed in" makes.
 *
 * @param {string} accessToken the Supabase session token. Without one there is
 *   nothing to refresh from.
 */
export async function refresh(accessToken) {
  if (!enabled()) return { ok: true, holder: true, count: 0 };
  if (!accessToken) return { ok: false, error: 'no-session' };

  const out = await callGate({ action: 'refresh' }, accessToken);
  if (out.status === 502 || out.body.retryable) {
    return { ok: false, error: 'chain-unreachable', retryable: true };
  }
  if (out.status !== 200) return { ok: false, error: 'gate-failed', retryable: out.status >= 500 };
  // No wallet was ever linked to this account. Not a refusal and not a fault —
  // there is simply nothing here, and the caller falls through to asking for a
  // wallet the ordinary way.
  if (out.body.linked === false) return { ok: false, error: 'not-linked' };
  if (!out.body.ok) return { ok: false, error: 'refused' };
  if (!out.body.holder) return { ok: true, holder: false, count: 0 };
  return await land(out.body);
}

/**
 * May this device play right now?
 *
 * The only question the rest of the game asks. With the gate off it is always
 * yes, which is what keeps every caller free of `if (GATE_ENABLED)`.
 */
export function open() {
  if (!enabled()) return true;
  return !!storedPass();
}

/** The wallet behind the current pass, for the ACCOUNT screen. */
export function holder() {
  const p = storedPass();
  return p ? { wallet: p.wallet, count: p.count || 0, exp: p.exp } : null;
}

// ------------------------------------------------------------- what is yours
//
// ⚠ READ OUT OF THE SIGNED PAYLOAD, not out of the convenience copy beside it.
//
// The pass is `base64url(payload).base64url(hmac)`, and the payload carries the
// owned-token list. Reading it here means the list the game trusts is the list
// the Edge Function signed — a console can still overwrite the whole pass, but
// it cannot EDIT one, and the difference matters: editing is what someone would
// do to add a Primo they do not hold to a pass that is otherwise genuine.
//
// The HMAC itself is deliberately not checked here. It cannot be — the secret
// is the server's — and pretending otherwise would be theatre. What this buys is
// that every path in the game reads ownership from one signed place instead of
// from a field anyone can append to.

/**
 * The token numbers this device's pass says the wallet holds.
 * @returns {number[]} empty when the gate is off, or there is no pass.
 */
export function ownedTokens() {
  const p = storedPass();
  if (!p || typeof p.pass !== 'string') return [];
  // A pass we cannot read is a pass we do not honour for ownership. The player
  // still gets in — open() only needs it to exist and be unexpired — they just
  // get no Primos offered, which is recoverable by verifying again rather than
  // being locked out of the game.
  const list = payloadOf(p.pass)?.t;
  if (!Array.isArray(list)) return [];
  return list.filter((n) => Number.isInteger(n) && n >= 0 && n < 3069);
}

/**
 * May this device run as this Primo?
 *
 * With the gate off this is always true, which is what keeps the picker and the
 * browser free of `if (GATE_ENABLED)` — the ungated game behaves exactly as it
 * always has, where any Primo may be worn.
 */
export function owns(n) {
  if (!enabled()) return true;
  return ownedTokens().includes(Number(n));
}
