# The NFT Gate

Hold a Primo in a Solana wallet, or you do not get in.

| | |
|---|---|
| Switch | `js/gate-config.js` → `GATE_ENABLED` (**ships `false`**) |
| Client | `js/gate.js`, screen `#screen-gate`, wired in `js/main.js` (`gateFirst`) |
| Verifier | `supabase/functions/primos-gate/index.ts` |
| Schema | `20260816210000_primos_nft_gate.sql`, then `20260816210001_primos_gate_enforce_boards.sql` |
| Harness | `dev/gate-test.html` |

---

## What this actually guarantees, stated plainly

**The game is static files on a public host.** Anyone can download the JS, delete
`gateFirst()`, and play. That is a property of shipping a game as files, not a
flaw in this design, and no amount of client code changes it. Any claim that the
game itself is "protected" would be false.

What server-side verification buys is that **the claim cannot be forged**. Nobody
can convince the backend they hold a Primo when they do not, because the verdict
comes from a signature the Edge Function checks and a chain lookup it makes with
a key the browser never sees. So everything the backend owns — the leaderboard
today, anything added later — enforces the gate *for real*.

This is the same distinction `js/primo-picker.js` already draws for
`claimStatus()`: a client-side check is UX, and the server is the guarantee.

Concretely, after both migrations:

| | gated? |
|---|---|
| Playing the game in a modified client | **no** — impossible to prevent |
| The front door, for an ordinary player | yes |
| Submitting a score to the leaderboard | **yes, enforced in the database** |
| Claiming to hold a Primo you do not | **yes, impossible** |

---

## Yours, and yours only

A Primo in your wallet is yours in the game, and nobody else can run as it.

**The chain is the registry.** `getAssetsByOwner` returns *which* Primos a wallet
holds, not just how many, and that list rides inside the HMAC-signed pass. Since
exactly one wallet can hold #2933, exclusivity needs no claims table, no
uniqueness constraint and no reconciliation — it is a property of the asset, not
a rule the game maintains.

That supersedes `data/primo-claims.json` wherever the gate is on. That file was
always an editorial patch — the owner hand-assigning a token back to whoever
should have had it — and its own header said the real guarantee "is going to live
server-side at WRITE time". This is that, arriving from a direction it did not
predict: not a server deciding who claimed first, but the chain having already
decided who owns it. `claimStatus()` consults the gate first and the file only
when the gate is off.

- Selecting a Primo you do not hold is refused at both doors — the number search
  (via `claimStatus`) and the browser grid.
- Unowned tiles are **locked, not hidden**. All 3,069 stay browsable so the
  collection is still a shop window; you just cannot wear one that is not yours.
  Same reasoning as leaving the leaderboard's read policy open.
- `ownedTokens()` reads the list out of the **signed payload**, never the
  convenience copy beside it in localStorage. A console can overwrite a whole
  pass but cannot edit one — and editing is precisely what someone would do to
  append a Primo they do not hold to an otherwise genuine pass.
- `primos_owns_token(uid, n)` asks the same question of the database. Nothing
  calls it yet: `primoNumber` lives only in the local save, and the save table is
  the **shared** `public.game_saves` owned by another game in this project, which
  must not grow Primos-specific policies. It is the seam for the day the board
  displays which Primo ran — at which point exclusivity becomes enforced on the
  one surface where it is publicly observable.

⚠ **Where this is and is not enforced.** Client-side, ownership is as strong as
the gate itself — which is to say a modified client can ignore it, exactly as it
can ignore the door. There is currently no public surface where one player sees
another's Primo, so a bypasser wearing #2933 locally is visible to nobody. The
moment such a surface exists it must go through `primos_owns_token()`, or the
guarantee becomes decorative on the only screen where it would matter.

## The wallet is also a login

A verified wallet does not just open the door — it *is* an account. Signing
proves control of the key, which is a stronger claim than an emailed code, so
once the signature checks out there is nothing further to ask.

**Why an account rather than teaching everything about wallets.** Cloud save, the
leaderboard and invites all key on `user_id` from `auth.users`. Minting a real
Supabase user for the wallet makes every one of them work with **no schema change
and no new policy**. The alternative — teaching each of those to accept a wallet
address — would mean Primos-specific policies on `public.game_saves`, which is the
SHARED table Turbo Maze owns and which this project must not touch.

| the player | what happens |
|---|---|
| Already signed in with Google, then connects a wallet | **Links.** `primos_holders.user_id` is set to the existing account. No second identity. |
| Not signed in, holds a Primo | Wallet account found or created, one-time token returned, client trades it for a session. |
| Not signed in, holds nothing | Refused. **No account is created** — `auth.users` does not collect a row per passer-by. |
| Session could not be established | **Still gets in.** The pass is kept before the exchange runs. |

- **An existing session always wins.** Minting a wallet account for someone
  already signed in with Google would silently strand the progress, boards and
  invites sitting under their Google user.
- **The pass is kept BEFORE the session is exchanged, and that order is the
  point.** Getting through the door and having an account are separate goods; a
  holder whose session cannot be established — CDN down, storage blocked, a
  Supabase hiccup — must still walk through the door they proved they own. The
  account re-attaches on the next verify.
- **⚠ THE SYNTHETIC ADDRESS IS NOT A CONTACT DETAIL.** `auth.users` demands an
  email and a wallet has none, so the function stores
  `<wallet>@wallet.primos.invalid` — the RFC 2606 reserved TLD, which can never
  resolve and can never be registered, so nothing can be sent to it. It must
  never reach the player: `paintAuth()` renders `acct.signedInWallet` instead,
  and `anonName()` already builds display names from the user id. This is the
  display-name-from-email rule applied to the one screen that prints an address.
- **The one-time token is a credential.** `generateLink` issues it single-use and
  it is returned only in the response to a request that already proved the
  wallet's signature. `signInWithWalletToken()` must never be called with a token
  from anywhere else.
- **The wallet → user mapping lives in `primos_holders`,** which is why creating
  the account needs no `admin.listUsers()` — that call pages the entire user base
  of a project shared with two other games to answer a question about one row.

## Rollout, in order

**The order is load-bearing.** Two of these steps lock people out if taken early.

### 1. Apply the additive migration

```bash
supabase db query --linked -f supabase/migrations/20260816210000_primos_nft_gate.sql
```

Creates `primos_gate_nonces`, `primos_holders`, `primos_is_holder()`. Changes no
existing policy, so it is safe under the current ungated client.

> `supabase db push` does **not** work from this repo and fails silently — see
> CLAUDE.md. Record nothing in `schema_migrations`.

### 2. Get an RPC endpoint that speaks DAS

**Try the key before you build anything on it:**

```bash
SOLANA_RPC_URL='https://mainnet.helius-rpc.com/?api-key=<KEY>' \
  node scripts/probe-gate.mjs <a-wallet-that-holds-a-primo>
```

It reports whether the endpoint speaks DAS, lists every collection that wallet
holds, and prints the verdict the gate would reach plus the token numbers that
become "yours and yours only". Nothing needs deploying. Run
`node scripts/verify-gate.mjs` alongside it — that pins the same filter against
fixtures, offline.

⚠ Pass the key in the **environment**, never as an argument: arguments are
visible in `ps` to every process on the machine and land in shell history.

#### Which provider

Helius, Triton or QuickNode. The **public `api.mainnet-beta.solana.com` will not
work** — it does not implement `getAssetsByOwner`, which is the call that answers
"does this wallet hold a Primo" in one request instead of one per NFT.

### 3. Find the collection mint

```bash
SOLANA_RPC_URL=<your rpc> node scripts/resolve-collection.mjs
```

Reads Primo #4's on-chain Metaplex metadata (`SEED_MINT` in
`scripts/harvest-primos.mjs`) and prints the verified collection address. Check it
against a block explorer before trusting it — this one string decides who gets in.

### 4. Set the secrets and deploy the function

```bash
supabase secrets set --project-ref deskabqqxqqibxjffwmb \
  SOLANA_RPC_URL='https://mainnet.helius-rpc.com/?api-key=…' \
  PRIMOS_COLLECTION='<from step 3>' \
  GATE_SECRET="$(openssl rand -base64 32)"

supabase functions deploy primos-gate --project-ref deskabqqxqqibxjffwmb
```

`GATE_SECRET` signs the pass. Rotating it invalidates every outstanding pass,
which is the lever to pull if one ever leaks.

### 5. Prove the function answers

```bash
curl -s -X POST 'https://deskabqqxqqibxjffwmb.supabase.co/functions/v1/primos-gate' \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H 'Content-Type: application/json' -d '{"action":"challenge"}'
```

A `nonce` and a `message` come back. A `503` naming a secret means step 4 is
incomplete — the function **fails closed** on purpose, because a gate that opens
when its lock is unplugged is worse than one that is plainly down.

Then verify end to end with a wallet you control: flip `GATE_ENABLED` locally,
run `scripts/dev-server.py`, and connect. There is no substitute for this — the
signing path cannot be probed from outside a wallet.

### 6. Turn it on

Flip `GATE_ENABLED` to `true` in `js/gate-config.js`, bump `CACHE_VERSION` and
`APP_VERSION`, deploy.

> ⚠ Doing this before step 4 **locks out everyone including you**, with no way
> back but another deploy.

### 7. Wait, then close the boards

Give holders time to open the game and verify — a day at least. The PWA is
prompt-mode, so players keep running a cached bundle for days.

```bash
supabase db query --linked -f supabase/migrations/20260816210001_primos_gate_enforce_boards.sql
```

> ⚠ **This is the step that inverts the usual "schema first, client second"
> rule.** It is a *restricting* change: applied before holders have verified, it
> silently refuses every score submission from players who legitimately earned
> them — a working game that looks broken, with nothing on screen to explain it.
> That is the sequence Viva Maya paid for with 0008 → client deploy → 0009. The
> migration warns if `primos_holders` is empty; the rollback statements are in
> its own tail.

---

## Things that will bite

- **`verified` on the collection grouping is the whole check.** Anyone can mint an
  NFT that *names* the Primos collection; only the collection authority can make
  that grouping verified. `countPrimos()` requires it. Drop that condition and the
  gate opens for the price of a fake mint.
- **The nonce is claimed with a conditional `UPDATE`, not select-then-update.**
  Two requests racing the same nonce both pass a read-then-write; only one wins a
  single statement filtering on `used_at is null`. Without it a captured
  `{wallet, nonce, signature}` is a reusable key to somebody else's identity.
- **`primos_gate_nonces` has RLS on and NO policies, deliberately.** That denies
  every client. A browser that could mint or read a nonce could replay a
  signature. The migration's self-check refuses to apply if a policy appears.
- **`primos_holders` is never client-writable.** Writing there is asserting NFT
  ownership. Only the function writes, after checking the chain itself.
- **A chain outage is not a refusal.** The function returns `502` and the client
  shows `gate.chainDown`, never `gate.noPrimo`. Telling someone who paid for a
  Primo that they own nothing because an RPC blinked is the worst sentence this
  screen can produce. Keep the two apart.
- **`getAssetsByOwner` is paged.** A wallet holding more than a page of *other*
  NFTs would push its Primos off page one and read as a non-holder. The loop pages
  to a bound; do not "simplify" it to one request.
- **The pass has a local expiry ceiling too.** `keepPass` clamps the server's
  expiry to `PASS_TTL_MS`, so a bug or tampered response handing out a ten-year
  pass cannot become a permanent bypass on that device.
- **No wallet address in the event log.** `GATE_PASS`/`GATE_FAIL` carry a count and
  a reason, never the address — a wallet is a fingerprint on a public chain, the
  same rule `PRIMO_SET` follows for token numbers.
- **The board's read policy stays open, on purpose.** A leaderboard only holders
  can see cannot advertise the collection. Gating the write is the point; gating
  the read costs the gate its only marketing surface and protects nothing.

## What gating breaks, and what was decided

Gating the front door cuts against three systems built for an open funnel:

- **Invites** (`js/referrals.js`) pay you for bringing a friend who now cannot get
  in without buying a Primo first. The invite still works — it just becomes a
  pitch for the collection rather than for the game.
- **Existing players** without a Primo lose access to a save they built up. Their
  local save is untouched and returns if they ever hold one.
- **Analytics funnels** that start at `app_open` now measure arrivals at a door,
  not players. `GATE_SHOWN` is the honest denominator for anything after it.

These are consequences of the decision, not bugs. If any of them turns out to
matter more than the gate, the middle option — game open to all, cloud save and
boards for holders only — is a policy change in
`20260816210001_primos_gate_enforce_boards.sql` plus `GATE_ENABLED = false`, and
nothing else.
