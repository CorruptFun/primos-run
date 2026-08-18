// The NFT gate's verifier. Deno, deployed as a Supabase Edge Function.
//
//   supabase functions deploy primos-gate --project-ref deskabqqxqqibxjffwmb
//
// ⚠ THIS FILE IS THE WHOLE GATE. js/gate.js is a door handle; it can be edited
// by anyone with a console, and nothing it says is believed here. Ownership is
// decided in this file, from a signature this file checks and a chain lookup
// this file makes, using a key the browser never sees.
//
// FOUR ACTIONS. The first two are the whole gate; the last two exist because a
// phone cannot do the first two in one browser context.
//
//   POST { action: "challenge", claimHash?, adopt? }
//     → { nonce, expiresAt, message }
//     A one-time string to sign. Stored, so it can be spent exactly once.
//     `claimHash` turns it into a HANDOFF (below). `adopt` asks for the message
//     belonging to a nonce already issued, instead of minting a new one.
//
//   POST { action: "verify", wallet, nonce, signature }
//     → { ok, holder, primoCount, pass, expiresAt }
//     Checks the signature against `wallet`, claims the nonce, counts the
//     wallet's Primos on-chain, records the result, and issues `pass` — an
//     HMAC-signed token the client keeps until it expires.
//     On a handoff challenge it returns NO pass: it parks the finding instead.
//
//   POST { action: "claim", nonce, claimToken }
//     → { ok, holder, primoCount, pass, expiresAt } | { ok: false, pending: true }
//     Collects a parked finding. This is the step that crosses a browser
//     boundary the client cannot cross by itself.
//
//   POST { action: "refresh" }   (Authorization: the player's Supabase session)
//     → { ok, holder, primoCount, pass, expiresAt } | { ok: false, linked: false }
//     A new pass for an already-linked wallet, with no wallet interaction at
//     all — the chain is re-asked, so it is a re-check and not a rubber stamp.
//
// ⚠ WHY A HANDOFF EXISTS AT ALL. No wallet injects a provider into mobile Safari
// or mobile Chrome, so on a phone the gate's only route was the wallet's own
// in-app browser — which has no Add to Home Screen. Gating the door made the PWA
// uninstallable on mobile. Wallets can be reached from an ordinary browser by
// universal link, but the answer returns to whichever browser the OS picks, and
// on iOS that is never the installed web app: a home screen web app is not a
// universal-link handler and it gets its own storage jar, so a pass written on
// the way back lands where the app cannot see it. The verdict therefore travels
// through the one place both contexts can reach — this function — and the nonce
// row, already single-use and already service-role only, is what carries it.
//
// WHY A SIGNATURE AT ALL, when the client could just send a wallet address:
// because a public chain means every holder's address is public. Without a
// signature the gate asks "name a holder", which is a question anyone can
// answer with a block explorer and one copy-paste. The signature is what turns
// it into "prove you hold the private key".
//
// ⚠ SECRETS. Set with `supabase secrets set --project-ref <ref> KEY=value`.
// None of these may ever appear in the repo or reach a browser:
//   SOLANA_RPC_URL   a DAS-capable endpoint (Helius, Triton, QuickNode). The
//                    public api.mainnet-beta.solana.com does NOT implement
//                    getAssetsByOwner and will fail every check.
//   PRIMOS_COLLECTION  the verified collection mint. See docs/NFT_GATE.md for
//                    how to resolve it; `scripts/resolve-collection.mjs` prints it.
//   GATE_SECRET      random 32+ bytes, HMAC key for the pass. Rotating it
//                    invalidates every outstanding pass, which is the intended
//                    lever if one ever leaks.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  injected by the platform.

import { createClient } from 'jsr:@supabase/supabase-js@2';

// How long a pass is good for. Holdings change the moment somebody sells, so
// this is the maximum time the game will run on a stale claim. A day is the
// balance struck: short enough that a sold Primo loses access the next day,
// long enough that a holder is not signing a message every launch.
const PASS_TTL_MS = 24 * 60 * 60 * 1000;

// A challenge is signed within seconds of being handed out. Anything longer is
// only widening the window in which a captured one is worth stealing.
const NONCE_TTL_MS = 5 * 60 * 1000;

// A handoff genuinely takes longer, and the tight window above would refuse
// honest players: the challenge is issued in the game, then the player switches
// app, waits for a wallet browser to load a page, unlocks, approves a connect
// and approves a signature. Five minutes is a fumbled passcode away from
// expiring. Widened only for the handoff — the in-page path never leaves the
// tab and keeps the short window, because a longer one there buys nothing but a
// bigger target.
const HANDOFF_NONCE_TTL_MS = 10 * 60 * 1000;

// How long a parked finding may sit uncollected. Generous against the nonce's
// own life because the asking device may have been backgrounded or killed while
// the player was in the wallet — coming back to a dead result would send them
// through the whole dance again for no reason. Short against the pass it mints:
// this is a window on a result, not on access.
const CLAIM_WINDOW_MS = 15 * 60 * 1000;

// A refresh re-asks the chain, and the chain costs money per question. A holder
// verified within this window gets a pass minted from the record rather than a
// fresh RPC round trip — which also bounds what a session can spend by asking
// repeatedly. Short enough that a sold Primo still loses access the same day,
// because the pass it mints expires on PASS_TTL_MS regardless.
const REFRESH_TRUST_MS = 60 * 1000;

// What the wallet is actually asked to sign. Human-readable on purpose: wallet
// software shows this text to the player, and an opaque blob is exactly what a
// phishing prompt looks like. It commits to the nonce, so a signature for one
// challenge cannot be presented for another.
const MESSAGE = (nonce: string) =>
  `PRIMOS: BARRIO RUN\n\nSign in to prove you hold a Primo.\nThis is free and moves nothing.\n\nChallenge: ${nonce}`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ------------------------------------------------------------------ base58
//
// Solana addresses and signatures are base58, and Deno has no built-in decoder.
// Small enough to state outright, and a dependency for eleven lines of alphabet
// arithmetic is a supply-chain surface for no reason.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58decode(str: string): Uint8Array | null {
  if (!str || typeof str !== 'string') return null;
  const bytes: number[] = [0];
  for (const ch of str) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;                       // not base58 at all
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  // Leading '1's are leading zero bytes, by definition of the encoding.
  for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

// --------------------------------------------------------------------- pass
//
// A compact signed token: base64url(payload).base64url(HMAC-SHA256). Not a JWT
// — nothing here needs the algorithm agility that gives JWT its footguns, and a
// fixed algorithm cannot be talked down to `none`.

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
}

async function issuePass(
  secret: string, wallet: string, count: number, tokens: number[], exp: number,
) {
  // `t` is the owned-token list. It rides inside the signed payload rather than
  // beside it so the client cannot widen its own collection: the game reads the
  // list to decide which Primos are selectable, and an unsigned list would make
  // that decision editable from the console.
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ w: wallet, n: count, t: tokens, exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

async function sha256hex(s: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------- chain
//
// ⚠ DAS, not getTokenAccountsByOwner. The plain RPC call returns token accounts
// and nothing about what collection each mint belongs to, which would leave us
// either shipping 3,069 mint addresses to every client or making one metadata
// lookup per NFT in the wallet. getAssetsByOwner answers the actual question in
// one request — and the endpoint that serves it needs a key, which is the
// reason this runs server-side rather than in js/gate.js.
//
// ⚠ IT RETURNS WHICH ONES, NOT JUST HOW MANY, and that is what makes a Primo
// "theirs and theirs only" in the game. The chain already guarantees exactly one
// holder per NFT, so an owned-token list IS the ownership registry — there is no
// claims table to keep, no uniqueness constraint to enforce and no way for two
// players to end up running as #2933. data/primo-claims.json exists because this
// list did not; see the header of claimStatus() in js/primo-picker.js.
function tokenNumber(asset: Record<string, any>): number | null {
  // "Primo #2933" — the same field scripts/harvest-primos.mjs parses, and it
  // rejects anything that does not yield a number rather than guessing.
  const name = asset?.content?.metadata?.name ?? '';
  let m = /#\s*(\d{1,4})\b/.exec(name);
  if (m) return Number(m[1]);
  // Fall back to the pinned metadata path, `…/<dir>/<n>.json`, which is how the
  // index was built in the first place.
  m = /\/(\d{1,4})\.json(?:$|\?)/.exec(asset?.content?.json_uri ?? '');
  return m ? Number(m[1]) : null;
}

async function countPrimos(
  rpc: string, collection: string, wallet: string,
): Promise<{ total: number; tokens: number[] }> {
  let page = 1;
  let total = 0;
  const tokens: number[] = [];
  // Paged rather than first-page-only: a wallet holding more than the page size
  // in OTHER NFTs would push its Primos off page one and read as a non-holder.
  // Bounded so a wallet with thousands of assets cannot hold the request open.
  for (; page <= 10; page++) {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'primos-gate',
        method: 'getAssetsByOwner',
        params: { ownerAddress: wallet, page, limit: 1000, displayOptions: { showCollectionMetadata: false } },
      }),
    });
    if (!res.ok) throw new Error(`rpc ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`rpc ${JSON.stringify(body.error)}`);
    const items = body?.result?.items ?? [];
    for (const asset of items) {
      // ⚠ `verified` is the load-bearing word. Anyone can mint an NFT that
      // NAMES the Primos collection in its grouping; only the collection
      // authority can produce one where that grouping is verified. Counting
      // unverified groupings would make the gate openable for the price of a
      // fake mint.
      const grouped = (asset?.grouping ?? []).some((g: Record<string, unknown>) =>
        g?.group_key === 'collection'
        && g?.group_value === collection
        && g?.verified !== false);
      // A compressed asset that has been burnt still appears; frozen ones are
      // still held and still count.
      if (grouped && asset?.burnt !== true) {
        total++;
        const n = tokenNumber(asset);
        // A Primo whose number cannot be read still COUNTS for the gate — the
        // player plainly holds one — it just cannot be offered as a skin. Better
        // than refusing entry over a metadata quirk.
        if (n !== null && n >= 0 && n < 3069 && !tokens.includes(n)) tokens.push(n);
      }
    }
    if (items.length < 1000) break;
  }
  tokens.sort((a, b) => a - b);
  return { total, tokens };
}

// ------------------------------------------------------------ the account
//
// A verified wallet IS a login. The signature already proves the holder controls
// the key, which is a stronger claim than an emailed code, so once it checks out
// there is nothing further to ask: the wallet gets a Supabase account and the
// client gets a session for it.
//
// ⚠ WHY AN ACCOUNT AT ALL, when the pass already opens the door: because the
// door was never the point. Cloud save, the leaderboard and invites are all
// keyed on `user_id` from auth.users — so minting a REAL Supabase user is what
// makes every one of them work for a wallet player with NO schema change and no
// new policy. The alternative, teaching each of those to accept a wallet
// address, would mean Primos-specific policies on public.game_saves, which is
// the SHARED table another game in this project owns.
//
// ⚠ THE SYNTHETIC ADDRESS IS NOT A CONTACT DETAIL. auth.users wants an email and
// a wallet does not have one, so this is a stable, unroutable stand-in on the
// RFC-2606 `.invalid` TLD — a reserved domain that can never resolve, so nothing
// can ever be sent to it and nobody can register it. It must never be shown to
// the player or used to derive a display name; anonName() already builds from
// the user id instead, and the guard trigger refuses email-derived names anyway.
const WALLET_EMAIL = (w: string) => `${w.toLowerCase()}@wallet.primos.invalid`;

/**
 * Find or create the account behind a wallet, and mint a one-time token the
 * client can exchange for a real session.
 *
 * ⚠ The token is a CREDENTIAL. It is returned only in the response to a request
 * that already proved the wallet's signature, and generateLink issues it
 * single-use — so a captured one is worth nothing twice.
 */
// ⚠ A HANG HERE WOULD REFUSE A GENUINE HOLDER, which is the one outcome this
// whole file exists to avoid. The account step makes two calls to the auth admin
// API from inside a request the player is watching a spinner for, and a THROW is
// already survivable — it is caught, the pass is kept, they get in without an
// account. A hang is not: it would run out the client's 20s fence and surface as
// "the wallet did not connect" to somebody who plainly holds one. So the step is
// bounded and a timeout is made to look exactly like a failure, which is a path
// with a known-good ending.
const ACCOUNT_BUDGET_MS = 8000;

function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`account step exceeded ${ms}ms`)), ms)),
  ]);
}

async function walletAccount(db: any, wallet: string) {
  const email = WALLET_EMAIL(wallet);

  // Create unconditionally and ignore "already registered": the alternative is
  // admin.listUsers(), which pages the ENTIRE user base of a project shared with
  // two other games to answer a question about one row.
  await db.auth.admin.createUser({
    email,
    email_confirm: true,          // no confirmation mail — the address is unroutable
    user_metadata: { wallet, via: 'solana-wallet' },
  });

  // Serves double duty: hands back the user (whether we just made it or it was
  // already there) and the one-time token in the same call.
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`could not issue a session: ${error.message}`);
  return {
    userId: (data?.user?.id as string) ?? null,
    tokenHash: (data?.properties?.hashed_token as string) ?? null,
  };
}

// ⚠ THE THREE PATHS THAT ISSUE A PASS SHARE THESE, and that is the point.
// `verify`, `claim` and `refresh` all end at "this wallet holds N Primos, let
// them in" — three copies of that ending would be three places for the holder
// record, the account link and the pass's contents to drift apart, and a drift
// here is not cosmetic: it is who gets in.

/** The signed-in user behind this request, or null. Never throws. */
async function callerUserId(db: any, req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const { data } = await db.auth.getUser(auth.slice(7));
    return data?.user?.id ?? null;
  } catch {
    // The anon key is a perfectly valid JWT with no user behind it, which is
    // what an unsigned-in client sends. Not an error — just nobody.
    return null;
  }
}

/**
 * Write down what the chain said.
 *
 * ⚠ `user_id` IS OMITTED WHEN UNKNOWN, NEVER WRITTEN AS NULL. PostgREST only
 * sets the columns present in the payload, so leaving it out preserves a link
 * made earlier. Sending null instead would mean any verify from a signed-out
 * context — which is EVERY handoff, since the wallet's browser never has a
 * session — silently unlinks a wallet from the Google account it belongs to,
 * and the board policy that asks "is this user a holder?" would start answering
 * no for somebody who plainly is.
 */
async function recordHolder(
  db: any, wallet: string, userId: string | null, count: number, tokens: number[],
) {
  const row: Record<string, unknown> = {
    wallet, primo_count: count, tokens, verified_at: new Date().toISOString(),
  };
  if (userId) row.user_id = userId;
  await db.from('primos_holders').upsert(row, { onConflict: 'wallet' });
}

/**
 * Link the wallet to a session if there is one, mint an account if there is not.
 *
 * ⚠ AN EXISTING SESSION ALWAYS WINS. Someone already signed in with Google who
 * then connects a wallet is LINKING the two, not starting a second identity —
 * minting a wallet account here would silently strand the progress, boards and
 * invites already sitting under their Google user.
 *
 * Gated on `count > 0` deliberately: a wallet that holds nothing is turned away,
 * and handing it an account first would litter auth.users with a row per
 * passer-by and mean a non-holder had "an account" for a game it cannot open.
 */
async function attachAccount(db: any, wallet: string, userId: string | null, count: number) {
  let sessionToken: string | null = null;
  if (!userId && count > 0) {
    try {
      const acct = await withBudget(walletAccount(db, wallet), ACCOUNT_BUDGET_MS);
      userId = acct.userId;
      sessionToken = acct.tokenHash;
    } catch (e) {
      // ⚠ NOT FATAL, and that is the point. The pass is what opens the door; the
      // account is what makes progress follow them. Failing here would lock a
      // genuine holder out of a game they can play perfectly well offline, over
      // a cloud feature that is optional everywhere else in this codebase.
      console.error('wallet account failed', String(e));
    }
  }
  return { userId, sessionToken };
}

/** The one shape a "you are in" answer has, wherever it was decided. */
async function passResponse(
  secret: string, wallet: string, count: number, tokens: number[], sessionToken: string | null,
) {
  const exp = Date.now() + PASS_TTL_MS;
  return json({
    ok: true,
    holder: true,
    primoCount: count,
    tokens,
    pass: await issuePass(secret, wallet, count, tokens, exp),
    expiresAt: new Date(exp).toISOString(),
    // Present only when this request minted one: absent for a player who was
    // already signed in (their session stands) and for anyone the account step
    // failed for (they still get in on the pass alone).
    ...(sessionToken ? { session: { tokenHash: sessionToken } } : {}),
  });
}

// -------------------------------------------------------------------- serve

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const RPC = Deno.env.get('SOLANA_RPC_URL');
  const COLLECTION = Deno.env.get('PRIMOS_COLLECTION');
  const SECRET = Deno.env.get('GATE_SECRET');
  const URL_ = Deno.env.get('SUPABASE_URL');
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  // Fail CLOSED and say which secret is missing. A gate that silently lets
  // everyone through when misconfigured is worse than one that is plainly down:
  // the first looks like it is working.
  for (const [name, v] of Object.entries({ SOLANA_RPC_URL: RPC, PRIMOS_COLLECTION: COLLECTION, GATE_SECRET: SECRET })) {
    if (!v) return json({ error: `gate misconfigured: ${name} is not set` }, 503);
  }

  const db = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  // ---------------------------------------------------------- challenge
  if (body.action === 'challenge') {
    // ADOPT: the handoff page is handed a nonce in its URL and must sign the
    // very one the game is waiting on, so it asks for that challenge instead of
    // minting a fresh one.
    //
    // ⚠ IT ASKS FOR THE MESSAGE RATHER THAN BUILDING IT. A client that assembled
    // the text locally would be one template edit away from signing something
    // this function will not verify — and, worse, one URL parameter away from
    // being TOLD what to sign, which is the shape of every wallet phishing page
    // ever written. The text shown in the wallet comes from the same place that
    // checks it. Nothing is revealed by answering: the message is a pure
    // function of a nonce the caller is already holding.
    if (body.adopt !== undefined) {
      const adopt = String(body.adopt ?? '');
      const { data: rows, error } = await db
        .from('primos_gate_nonces')
        .select('nonce, expires_at')
        .eq('nonce', adopt)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .limit(1);
      if (error) return json({ error: 'could not read that challenge' }, 500);
      if (!rows || rows.length === 0) {
        return json({ error: 'that challenge is expired or already used' }, 410);
      }
      return json({ nonce: adopt, expiresAt: rows[0].expires_at, message: MESSAGE(adopt) });
    }

    // A claim hash makes this a HANDOFF: the answer will be collected by
    // whoever can produce the matching token, not handed to whoever signs.
    // Malformed is a 400 rather than a silent downgrade to an ordinary
    // challenge — the quiet version leaves the asking device polling a row that
    // will never be marked ready, which looks exactly like a wallet that never
    // answered.
    let claimHash: string | null = null;
    if (body.claimHash !== undefined) {
      claimHash = String(body.claimHash ?? '');
      if (!/^[0-9a-f]{64}$/.test(claimHash)) {
        return json({ error: 'claimHash must be a sha256 hex digest' }, 400);
      }
    }

    const nonce = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(
      Date.now() + (claimHash ? HANDOFF_NONCE_TTL_MS : NONCE_TTL_MS),
    ).toISOString();
    const { error } = await db.from('primos_gate_nonces').insert({
      nonce, expires_at: expiresAt, ...(claimHash ? { claim_hash: claimHash } : {}),
    });
    if (error) return json({ error: 'could not issue a challenge' }, 500);
    return json({ nonce, expiresAt, message: MESSAGE(nonce) });
  }

  // ------------------------------------------------------------- verify
  if (body.action === 'verify') {
    const wallet = String(body.wallet ?? '');
    const nonce = String(body.nonce ?? '');
    const signature = String(body.signature ?? '');
    if (!wallet || !nonce || !signature) return json({ error: 'wallet, nonce and signature are required' }, 400);

    const pub = b58decode(wallet);
    const sig = b58decode(signature);
    if (!pub || pub.length !== 32) return json({ error: 'not a Solana address' }, 400);
    if (!sig || sig.length !== 64) return json({ error: 'not an ed25519 signature' }, 400);

    // ⚠ CLAIM THE NONCE BEFORE CHECKING ANYTHING ELSE, and claim it with a
    // conditional UPDATE rather than a select-then-update. Two requests racing
    // the same nonce both pass a read-then-write; only one of them can win a
    // single statement that filters on used_at is null. Without this the
    // signature is replayable for the length of the nonce's life, which is the
    // entire attack the nonce exists to prevent.
    const { data: claimed, error: claimErr } = await db
      .from('primos_gate_nonces')
      .update({ used_at: new Date().toISOString(), wallet })
      .eq('nonce', nonce)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('nonce, claim_hash');
    if (claimErr) return json({ error: 'challenge lookup failed' }, 500);
    if (!claimed || claimed.length === 0) {
      return json({ error: 'that challenge is expired or already used' }, 401);
    }
    // Whether this challenge was issued for a handoff is decided by the ROW, not
    // by anything in this request. A client cannot talk its way into the handoff
    // branch (or out of it) after the fact.
    const handoff = !!claimed[0].claim_hash;

    // Ed25519 over the exact message the wallet was shown. Deno's WebCrypto
    // implements Ed25519 directly, so there is no third-party curve library in
    // the trust path.
    let good = false;
    try {
      const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
      good = await crypto.subtle.verify(
        { name: 'Ed25519' }, key, sig, new TextEncoder().encode(MESSAGE(nonce)),
      );
    } catch {
      good = false;
    }
    if (!good) return json({ error: 'that signature does not match that wallet' }, 401);

    // The wallet is proved. Now: does it hold anything?
    let count = 0;
    let tokens: number[] = [];
    try {
      ({ total: count, tokens } = await countPrimos(RPC!, COLLECTION!, wallet));
    } catch (e) {
      // ⚠ FAIL CLOSED. An RPC outage must not hand out passes — that is a gate
      // that opens whenever its lock is unplugged. 502 so the client can say
      // "could not check right now" rather than "you do not hold one", which
      // are very different sentences to show a paying holder.
      return json({ error: `could not reach the chain: ${e}`, retryable: true }, 502);
    }

    // ⚠ ON A HANDOFF THE ACCOUNT STEP IS SKIPPED, and that is not tidiness.
    // The browser signing here is the WALLET'S browser — a throwaway context the
    // player closes in a moment, never signed in to anything. Minting a wallet
    // account from it would give a player who is already signed in with Google a
    // SECOND identity, with their progress, boards and invites stranded under
    // the first. The device that COLLECTS is the device that plays, so the
    // account is attached there, where a session can actually be seen.
    const { userId, sessionToken } = handoff
      ? { userId: null as string | null, sessionToken: null as string | null }
      : await attachAccount(db, wallet, await callerUserId(db, req), count);

    // The list, not just the count, so primos_owns_token() can answer "is this
    // player allowed to run as #2933" from the database rather than from
    // anything a browser said. A count of 0 is recorded too, on purpose — a
    // wallet that asked and was turned away is worth knowing about, and it is
    // the only signal the owner has that people are trying to get in without
    // holding.
    await recordHolder(db, wallet, userId, count, tokens);

    if (handoff) {
      // ⚠ THE FINDING IS PARKED, NEVER THE PASS. A pass is a bearer token for
      // the door and this row outlives the request; what goes in the row is what
      // the chain said, and the pass is minted fresh in the claim from a secret
      // the database never holds.
      const { error: parkErr } = await db
        .from('primos_gate_nonces')
        .update({ primo_count: count, tokens, pass_ready_at: new Date().toISOString() })
        .eq('nonce', nonce);
      // A holder who cannot be handed back is worse than one who was never
      // asked: they would sit watching a spinner in the other app forever. Say
      // so, so the wallet browser can tell them to try again.
      if (parkErr) return json({ error: 'could not hand that result back', retryable: true }, 500);
      // No pass and no session in this answer, deliberately: this browser is not
      // the one that plays, and a pass left in it is a credential in a context
      // nobody will ever clean up.
      return json({ ok: true, holder: count > 0, primoCount: count, handoff: true });
    }

    if (count <= 0) return json({ ok: true, holder: false, primoCount: 0 });

    return await passResponse(SECRET!, wallet, count, tokens, sessionToken);
  }

  // -------------------------------------------------------------- collect
  //
  // The other half of a handoff: the game asks for the verdict the wallet's
  // browser left behind.
  if (body.action === 'claim') {
    const nonce = String(body.nonce ?? '');
    const claimToken = String(body.claimToken ?? '');
    if (!nonce || !claimToken) return json({ error: 'nonce and claimToken are required' }, 400);

    // ⚠ CLAIMED WITH ONE CONDITIONAL UPDATE, exactly like the nonce above, and
    // for the same reason: a read-then-write lets two requests both pass. Here
    // that would mean one verdict handed to two devices.
    const { data: rows, error } = await db
      .from('primos_gate_nonces')
      .update({ pass_claimed_at: new Date().toISOString() })
      .eq('nonce', nonce)
      .eq('claim_hash', await sha256hex(claimToken))
      .not('pass_ready_at', 'is', null)
      .is('pass_claimed_at', null)
      .gt('pass_ready_at', new Date(Date.now() - CLAIM_WINDOW_MS).toISOString())
      .select('wallet, primo_count, tokens');
    if (error) return json({ error: 'could not collect that result', retryable: true }, 500);

    // ⚠ EVERY MISS IS "NOT YET", INCLUDING THE ONES THAT ARE REALLY "NEVER".
    // Wrong token, expired window, already collected and still-waiting all
    // answer the same way. The client polls and eventually gives up on its own
    // clock, which costs a caller with a stolen nonce exactly nothing to learn —
    // whereas telling the three apart would turn this endpoint into an oracle
    // for which nonces are live and which tokens are close.
    if (!rows || rows.length === 0) return json({ ok: false, pending: true });

    const row = rows[0];
    const wallet = String(row.wallet ?? '');
    const count = Number(row.primo_count ?? 0);
    const tokens: number[] = Array.isArray(row.tokens) ? row.tokens : [];
    if (!wallet) return json({ ok: false, pending: true });

    if (count <= 0) return json({ ok: true, holder: false, primoCount: 0 });

    // Now — and only now — is there a device with a session worth linking to.
    const { userId, sessionToken } = await attachAccount(db, wallet, await callerUserId(db, req), count);
    if (userId) await recordHolder(db, wallet, userId, count, tokens);

    return await passResponse(SECRET!, wallet, count, tokens, sessionToken);
  }

  // -------------------------------------------------------------- refresh
  //
  // A new pass for a wallet that has already been proved, with no wallet
  // interaction at all.
  //
  // ⚠ THIS IS WHAT KEEPS THE HANDOFF FROM BEING A DAILY CHORE. A pass lasts a
  // day by design, and on iOS every renewal would otherwise mean the whole
  // app-switch dance again, forever. The signature proved the key once; the
  // SESSION carries it from then on, and the session lives in the installed
  // app's own storage where it renews silently.
  //
  // It is not a rubber stamp: the chain is re-asked, so a sold Primo closes the
  // door on the next refresh exactly as it would on the next signature. What is
  // NOT re-asked is control of the key — which is the same trade every "stay
  // signed in" checkbox makes, and strictly stronger than the 24h pass it
  // replaces.
  if (body.action === 'refresh') {
    const userId = await callerUserId(db, req);
    if (!userId) return json({ error: 'no session' }, 401);

    const { data: rows, error } = await db
      .from('primos_holders')
      .select('wallet, primo_count, tokens, verified_at')
      .eq('user_id', userId)
      .order('verified_at', { ascending: false })
      .limit(1);
    if (error) return json({ error: 'could not read your wallet', retryable: true }, 500);
    // No wallet ever linked to this account. Not a refusal — the caller simply
    // has nothing to refresh, and the client falls through to asking for one.
    if (!rows || rows.length === 0) return json({ ok: false, linked: false });

    const row = rows[0];
    const wallet = String(row.wallet ?? '');
    const freshEnough = Date.parse(row.verified_at ?? '') > Date.now() - REFRESH_TRUST_MS;

    let count = Number(row.primo_count ?? 0);
    let tokens: number[] = Array.isArray(row.tokens) ? row.tokens : [];
    if (!freshEnough) {
      try {
        ({ total: count, tokens } = await countPrimos(RPC!, COLLECTION!, wallet));
      } catch (e) {
        // ⚠ 502, NOT "you hold nothing" — the same rule verify follows. Here it
        // matters more, not less: this path runs unattended at launch, so a
        // collapsed distinction would throw a holder back to the wallet screen
        // for no reason they could see.
        return json({ error: `could not reach the chain: ${e}`, retryable: true }, 502);
      }
      await recordHolder(db, wallet, userId, count, tokens);
    }

    if (count <= 0) return json({ ok: true, holder: false, primoCount: 0 });
    // No session token: this request arrived with one.
    return await passResponse(SECRET!, wallet, count, tokens, null);
  }

  return json({ error: 'unknown action' }, 400);
});
