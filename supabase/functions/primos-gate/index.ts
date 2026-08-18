// The NFT gate's verifier. Deno, deployed as a Supabase Edge Function.
//
//   supabase functions deploy primos-gate --project-ref deskabqqxqqibxjffwmb
//
// ⚠ THIS FILE IS THE WHOLE GATE. js/gate.js is a door handle; it can be edited
// by anyone with a console, and nothing it says is believed here. Ownership is
// decided in this file, from a signature this file checks and a chain lookup
// this file makes, using a key the browser never sees.
//
// TWO ACTIONS:
//
//   POST { action: "challenge" }
//     → { nonce, expiresAt }
//     A one-time string to sign. Stored, so it can be spent exactly once.
//
//   POST { action: "verify", wallet, nonce, signature }
//     → { ok, holder, primoCount, pass, expiresAt }
//     Checks the signature against `wallet`, claims the nonce, counts the
//     wallet's Primos on-chain, records the result, and issues `pass` — an
//     HMAC-signed token the client keeps until it expires.
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
    const nonce = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();
    const { error } = await db.from('primos_gate_nonces').insert({ nonce, expires_at: expiresAt });
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
      .select('nonce');
    if (claimErr) return json({ error: 'challenge lookup failed' }, 500);
    if (!claimed || claimed.length === 0) {
      return json({ error: 'that challenge is expired or already used' }, 401);
    }

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

    // Link the wallet to the signed-in account when there is one, so the board
    // policy can ask "is the user writing this row a holder?".
    //
    // ⚠ AN EXISTING SESSION ALWAYS WINS. Someone already signed in with Google
    // who then connects a wallet is LINKING the two, not starting a second
    // identity — minting a wallet account here would silently strand the
    // progress, boards and invites already sitting under their Google user.
    let userId: string | null = null;
    const auth = req.headers.get('Authorization');
    if (auth?.startsWith('Bearer ')) {
      const { data } = await db.auth.getUser(auth.slice(7));
      userId = data?.user?.id ?? null;
    }

    // No session and they hold: the wallet becomes the login. Gated on
    // `count > 0` deliberately — a wallet that holds nothing is turned away
    // below, and handing it an account first would litter auth.users with a row
    // per passer-by and mean a non-holder had "an account" for a game it cannot
    // open.
    let sessionToken: string | null = null;
    if (!userId && count > 0) {
      try {
        const acct = await withBudget(walletAccount(db, wallet), ACCOUNT_BUDGET_MS);
        userId = acct.userId;
        sessionToken = acct.tokenHash;
      } catch (e) {
        // ⚠ NOT FATAL, and that is the point. The pass below is what opens the
        // door; the account is what makes progress follow them. Failing the
        // whole verify here would lock a genuine holder out of a game they can
        // play perfectly well offline, over a cloud feature that is optional
        // everywhere else in this codebase.
        console.error('wallet account failed', String(e));
      }
    }

    const now = new Date().toISOString();
    await db.from('primos_holders').upsert({
      wallet,
      user_id: userId,
      primo_count: count,
      // The list, not just the count, so primos_owns_token() can answer "is this
      // player allowed to run as #2933" from the database rather than from
      // anything a browser said.
      tokens,
      verified_at: now,
    }, { onConflict: 'wallet' });

    if (count <= 0) {
      // Recorded above with a count of 0 on purpose — a wallet that asked and
      // was turned away is worth knowing about, and it is the only signal the
      // owner has that people are trying to get in without holding.
      return json({ ok: true, holder: false, primoCount: 0 });
    }

    const exp = Date.now() + PASS_TTL_MS;
    return json({
      ok: true,
      holder: true,
      primoCount: count,
      tokens,
      pass: await issuePass(SECRET!, wallet, count, tokens, exp),
      expiresAt: new Date(exp).toISOString(),
      // Present only when this request minted one: absent for a player who was
      // already signed in (their session stands) and for anyone the account
      // step failed for (they still get in on the pass alone).
      ...(sessionToken ? { session: { tokenHash: sessionToken } } : {}),
    });
  }

  return json({ error: 'unknown action' }, 400);
});
