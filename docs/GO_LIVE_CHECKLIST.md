# Go-Live Checklist

What has to be true before a deploy, and what has to be checked after it. There
is no CI test job — these steps are the gate.

## Where it lives

| | |
|---|---|
| Repo | <https://github.com/CorruptFun/primos-run> (public) |
| Pages deploy | <https://corruptfun.github.io/primos-run/> |
| **Canonical URL** | **<https://corrupt.solutions/games/primos/>** |
| Supabase project | `deskabqqxqqibxjffwmb` — "Corrupt Games", shared across every Corrupt game |

`corrupt.solutions/games/primos/` proxies the GitHub Pages `main` deploy, so a
push to `main` is live on the domain with no sync step. `/games/Primos` — the
collection's own capitalisation — 308s to the lowercase canonical.

**The canonical URL is the one to share.** localStorage is per-origin, so a
player who arrives on github.io gets a save that has nothing to do with the one
they would have had on the domain. `js/referrals.js` hardcodes the canonical base
into invite links for exactly this reason, trailing slash included.

---

## Before every deploy

- [ ] **Syntax sweep passes.** ES modules, so `node --check` needs an `.mjs` copy:

      ```bash
      for f in js/*.js js/art/*.js js/stats/*.js; do cp "$f" /tmp/x.mjs; node --check /tmp/x.mjs || echo "FAIL $f"; done
      ```

- [ ] **`dev/cloud-test.html` is green** if anything under `raceday.js`,
      `merge.js`, `store.js`, `leaderboard.js`, `analytics.js` or `feedback.js`
      moved. It cache-busts its imports, so a reload is enough.
- [ ] **`dev/rig-test.html` still reads right** if the character changed. Iterate
      there, not in-game.
- [ ] **⚠ `CACHE_VERSION` in `sw.js` is bumped.** Skip this and players keep
      stale JS — this is the single most-repeated deploy mistake on the project.
- [ ] **New same-origin files are in `sw.js` PRECACHE**, and the ones that must
      *not* be are still absent:
      - supabase-js (cross-origin CDN — the fetch handler never touches
        cross-origin GETs, and precaching it would ship it to players on a build
        where `cloud-config.js` is empty)
      - `stats.html` and `js/stats/` (players must not download the owner's tool
        — `js/stats/feedback.js` included, for the same reason)
- [ ] **No collection artwork was added.** `data/primos-index.json` holds IPFS
      CIDs only. `art/raw/` stays gitignored.
- [ ] **No keys in the repo.** `js/cloud-config.js` carries the *publishable* anon
      key only — never a service-role key, which must never reach a browser.
- [ ] **The i18n voice policy still holds** if copy changed: `en` is full English
      all the way down; proper nouns only. Read the header of `js/i18n.js`.

## If the NFT gate is involved

Full runbook: [NFT_GATE.md](NFT_GATE.md). The order is load-bearing and two
steps lock people out if taken early.

- [ ] **`GATE_ENABLED` is only true on a build whose Edge Function is deployed
      and answering.** Flipping it first locks out everyone including the owner,
      with no way back but another deploy.
- [ ] **`20260816210001_primos_gate_enforce_boards.sql` has NOT been applied
      before holders have had time to verify.** It is a restricting change under
      a prompt-mode PWA — the inverse of the schema-first rule. Its own tail
      carries the rollback.
- [ ] **The function's secrets are set** (`SOLANA_RPC_URL`, `PRIMOS_COLLECTION`,
      `GATE_SECRET`) and none of them is in the repo. It fails closed with 503
      naming the missing one.
- [ ] **`PRIMOS_COLLECTION` was checked against a block explorer.** Wrong in one
      direction it refuses every holder; wrong in the other it admits everyone.
- [ ] **A real wallet completed the flow end to end.** The signing path cannot be
      probed from outside a wallet — there is no substitute for doing it once.

## If a migration is involved

Migrations are **applied by hand; CI never applies them.** Applying to production
and merging to `main` are two separate acts, and *the repo does not describe
production until both have happened*.

> ⚠ **`supabase db push` cannot be used from this repo, and its first failure
> mode is silence.** `schema_migrations` is per-project, and the two sibling
> games already own versions `0001`–`0022` in it — so a file numbered `0003`
> looks already-applied and is **skipped with a success message**. Number
> anything new by **timestamp**, apply with
> `supabase db query --linked -f <file>`, and record nothing in the history
> table. **Never run the `migration repair --status reverted` the CLI suggests**
> — it would mark the other games' migrations reverted. Full explanation in
> [ANALYTICS.md](ANALYTICS.md#-supabase-db-push-does-not-work-from-this-repo-and-fails-silently).

- [ ] **Two-phase order: schema first, client second.** The PWA is prompt-mode,
      so cached clients keep running the old bundle for days. A client that sends
      a column the server does not have yet is rejected per-batch.
- [ ] Every new object is **`primos_`-prefixed**. This project shares a Supabase
      project with Viva Maya and Turbo Maze, and an unprefixed collision does not
      announce itself — `create table if not exists` silently adopts the other
      game's table.
- [ ] Applied in order, via `supabase db query --linked -f <file>` or the SQL
      editor — **not** `db push`.
- [ ] **`scripts/verify-rls.sh <url> <publishable-key>` run against production**,
      and the output actually read. It checks effects, not status codes, and
      reports `?` for anything it cannot distinguish.
- [ ] **The verify probe rows are cleared afterwards.** The feedback rate-limit
      check deliberately WRITES five reports to prove the limit is real, and they
      land in the box marked `new` — i.e. in the owner's unread queue:

      ```sql
      delete from public.primos_feedback where app_version = 'verify';
      ```
- [ ] The vault note's Current State says what was applied **from a real probe**,
      not from intent.

## After every deploy

- [ ] **Verify against the LIVE bundle, not the repo.** Fetch the deployed JS and
      grep for a marker from the change. A commit on `main` is not a deploy, and
      a deploy is not a cache eviction.
- [ ] Load the canonical URL, check the console is clean, play one run.
- [ ] If sign-in changed: sign in with a real Google account end to end. This
      cannot be probed from outside — the PKCE state is opaque.
- [ ] If the boards changed: check a score actually lands on today's board and
      the weekly total moves.
- [ ] `stats.html` still loads and answers (see [ANALYTICS.md](ANALYTICS.md)).

---

## One-time activation (human-only)

These are the steps no agent can do. All are complete as of 2026-07-31 unless
noted.

1. **`js/cloud-config.js` filled** — URL, publishable anon key, `SUPABASE_ESM`,
   `GAME_ID = 'primos-run'`. ✅
2. **Migrations applied** to the Corrupt Games project, `verify-rls.sh` passing
   against it. ✅ for `0001`; check `git log` and re-probe for the rest.
3. **Google OAuth redirect URI** registered in the Google Cloud console pointing
   at the **Supabase callback** (`https://<project>.supabase.co/auth/v1/callback`)
   — *not* the game's URL. That is the usual mistake. ✅
4. **Supabase → Authentication → URL Configuration → Redirect URLs** lists
   **both** `https://corruptfun.github.io/primos-run/` and
   `https://corrupt.solutions/games/primos/`. ✅ (owner-confirmed 2026-07-31)

   `signInWithOAuth` passes `redirectTo: location.href`. An origin that is not
   allowlisted bounces back to the Site URL and **sign-in silently does nothing**.
   If a player ever reports sign-in bouncing to the menu, re-check this first.
5. **`app_admins` seeded** with the owner's user id, or the analytics dashboard
   answers 403 to everyone. See [ANALYTICS.md](ANALYTICS.md#getting-in). The same
   row gates the FEEDBACK panel.
6. **`20260731190000_primos_feedback.sql` applied**, or the Corrupt row on HELP
   sends every report into a 404 and every player who writes in is told it did
   not go through. Unlike the analytics pipe, they will notice — they are
   watching a status line. See [FEEDBACK.md](FEEDBACK.md#rolling-it-out).

---

## Rollback

There is no build artifact to roll back to — the deploy *is* the repo. To undo:

1. `git revert` the commit and push. Pages redeploys.
2. **Bump `CACHE_VERSION` again.** A revert without a bump leaves every existing
   player on the bad bundle, which is the state you were trying to leave.
3. A migration cannot be reverted by reverting its file. "Idempotent" means
   *survives a re-run*, **not** *preserves what came after it* — replaying an
   older migration can silently undo a newer one's changes to the same function.
   Write a new forward migration instead.
