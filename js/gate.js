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

import { GATE_ENABLED, GATE_FUNCTION, PASS_TTL_MS, WALLETS } from './gate-config.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './cloud-config.js';

const PASS_KEY = 'primos-run:gate-pass';

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

function keepPass(wallet, pass, exp, count) {
  try {
    localStorage.setItem(PASS_KEY, JSON.stringify({
      wallet, pass, count,
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

// ------------------------------------------------------------- providers

const reach = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), window);

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
 * @returns {Promise<{ok: boolean, holder?: boolean, count?: number,
 *   address?: string, error?: string, retryable?: boolean}>} never throws.
 */
export async function verify(wallet, accessToken) {
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

  const challenge = await callGate({ action: 'challenge' }, accessToken);
  if (challenge.status !== 200 || !challenge.body.nonce) {
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
  if (!out.body.holder) return { ok: true, holder: false, count: 0, address };

  keepPass(address, out.body.pass, Date.parse(out.body.expiresAt) || (Date.now() + PASS_TTL_MS), out.body.primoCount);
  return { ok: true, holder: true, count: out.body.primoCount || 0, address };
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
