# Cloud Save, Sign-in, Boards and Invites

The whole server-touching half of the game, in one document. Code is the source
of truth; this explains the *why*, the invariants that must not be re-broken,
and the activation steps that are **human-only**.

Built to the **`cloud-saves-and-leaderboards` skill**, which ships in the repo at
[`.claude/skills/`](../.claude/skills/cloud-saves-and-leaderboards/). Read it
before changing anything score-, board-, sign-in- or name-related — most of what
looks fussy in these files is a scar it explains.

---

## It ships DORMANT

`js/cloud-config.js` is empty in the repo. With it empty:

- sign-in, sync, the boards and the invite panel all **no-op**
- **supabase-js is never even fetched** — it is a dynamic import behind the
  config gate, not a top-level one
- the game runs local-only and behaves exactly as it did before the layer existed

Filling in the URL + publishable key is what turns the whole layer on. Device
backup/restore in ACCOUNT works either way, on purpose — a file in Downloads
survives clearing site data, which is the exact event that loses everything else,
and it is the only durability on offer before the cloud exists.

Three contracts hold across `cloud.js`, `leaderboard.js` and `referrals.js`,
identically:

1. **Dormant until configured** (and, for boards/invites, until signed in).
2. **Nothing here may ever throw into the game.** A cloud save is not worth a
   crashed run. Every network path is wrapped and swallows.
3. **localStorage stays AUTHORITATIVE.** The cloud is a mirror.

---

## One project, one player base, designated per game

The Supabase project (`deskabqqxqqibxjffwmb`, "Corrupt Games") hosts **every**
Corrupt game: one Google sign-in, one `auth.users` row, recognised everywhere.

**Saves go in the SHARED `public.game_saves`**, keyed `(user_id, game)`, with
this game's slug `GAME_ID = 'primos-run'`. That table is owned by Turbo Maze's
`0001_game_saves.sql` — a new game needs no new table and no new migration, only
a fresh slug.

> **Do NOT give this game a private saves table.** It would work, and it would
> quietly keep this game's players out of the shared registry, which is the whole
> point of sharing the project.

Only the **boards and invites** are Primos-owned, because a leaderboard cannot be
generic — it carries this game's ranking columns, its guard, its continue flag
and its weekly rollup.

**Every object this repo's migrations create is `primos_`-prefixed**, and in
`0002` that is load-bearing rather than tidy. Viva Maya already owns unprefixed
`public.referral_codes`, `public.referrals` and `public.resolve_referral_code()`
in this same project. An unprefixed collision would **not have announced
itself**: `create table if not exists` finds the existing table and quietly does
nothing, and `create or replace function` with a matching signature *replaces*
the working one. Primos would then be reading and writing Viva Maya's live
referral table. That is strictly worse than the `42P13` abort `0001` hit, because
nothing anywhere would have said a word.

Viva Maya is the exception to all of this: it predates the shared table and keeps
its own `public.saves`.

---

## The save is authoritative; the cloud is a mirror

```
boot ─► pullCloudSave()  ─► mergeSaves(local, remote)  ─► store.save(winner, true)
                                                        ─► pushCloudSave(winner)

every store.save() ─► debounced 1.5s ─► upsert game_saves
                                     ├─► maybeSubmitDaily()      (boards)
                                     └─► maybeRegisterReferral() (invites)
                                         then maybeQualify()
```

**The boards and invites ride the save push.** No second traffic path, no timer
of their own, no per-frame cost. Both are lazily imported so the boot path never
pulls them in.

⚠ **The order inside the push is load-bearing.** `maybeQualify` memoizes "this
account was never referred" as terminal for the session; run it before
`maybeRegisterReferral` and it latches that against a row register is about to
create, so a friend who signed in and immediately beat the qualify score would
not pay out until their next session.

### The merge (`js/merge.js`)

This is the one function in the layer that can **destroy** something. A wrong
board reading is embarrassing; a wrong merge silently eats a player's best run
and there is no undo. It is written to fail toward *"keep more"*, never toward
*"keep newer"*.

| category | rule | why not the obvious thing |
|---|---|---|
| `best`, `bestBeers`, `totalBeers`, `runs` | **MAX** | records and lifetime counters, never spendable |
| `days` / `contDays` | **union by MAX**, mark travels with its score | "the winner's map" deletes a board the player is legitimately on |
| `shelf` | **union per item by MAX** | an unused item was paid for; riding the winner throws the purchase away |
| `chelas` | **never maxed** — carried per `walletSeeded` | it is a *balance*, not a record. Max it and spending on one device is refunded by the other |
| `walletSeeded` | **union** | let a `false` win and the `totalBeers` seed runs a second time, minting the whole lifetime total |
| `handle` / `handleSetAt` | **most recently set wins** | riding the winner republishes an old name to every board |
| `trainedAt` | **latch, not max** | `LEGACY` is −1 and `Math.max(-1, 0)` is `0` — that replays training for every grandfathered player |
| `referralWelcomeClaimed` | **union** | a re-opened latch pays the welcome twice |
| `referredBy` | set-once, local wins | the real referral is the cloud row; this only lets the panel say "you were invited by" |

The three money rules all mint currency if got wrong, and two of them tie in the
**ordinary** case rather than an unlucky one — finishing the tutorial and
collecting a welcome both happen to a nearly-new account whose every progress
metric is zero.

`walletSeeded` also sets its own trap once unioned: if the progress winner is the
side that never seeded, its `chelas` is not a balance at all, it is a zero
meaning "not derived yet". Forcing `seeded = true` over it strands the player at
nothing with the seed permanently disabled. So **when exactly one side is seeded,
that side's balance carries.**

---

## The boards

Two boards, one module (`js/leaderboard.js`), one row shape, so `js/boards.js`
needs no branching:

- **DAILY** — today's shared board, ranked by score, resets at **midnight UTC**.
- **WEEKLY** — the season. Ranked by the **SUM of a player's daily bests**, so it
  rewards turning up: a missed day is a zero you cannot make back with one big
  run.

UTC and not local midnight because the board is **shared**. A local reset would
mean the same board opens and closes at different moments for different players,
and someone in Auckland would be racing a board Los Angeles had already finished.
One clock for everyone is the only version that is fair, even though the reset
lands mid-afternoon somewhere.

Weekly ordering is `(total desc, days_played desc, last_scored_at asc)`. The
middle term is the interesting one: level on the total, the player who spread it
over **more** boards wins, because that is the behaviour the format exists to
reward. Own-rank outside the top rows is therefore a **composite** comparison,
not a single `.gt()` — collapsing it to "total >" reports every tied player as
joint-first.

**Empty is a normal state.** Signed out, cloud not configured, offline, and a
genuinely empty board all arrive at the UI as the empty board and all four render
the same invitation. An error state would be wrong for three of them and
unhelpful for the fourth.

### `raceday.js` and the migration are byte-identical twins

`dayKey`, `weekKey` and `anonName` each have a byte-identical twin in
`supabase/migrations/0001_primos_cloud.sql`, and **the migration refuses to apply
if they drift**. The server validates the day key on every submission, so drift
does not produce a warning — it produces a board that silently goes empty because
the database is rejecting every honest score.

**Change one side and you must change the other, plus the cases in
`dev/cloud-test.html`.**

The SQL side is `public.primos_anon_display_name` — prefixed on purpose, because
Viva Maya owns an unprefixed `anon_display_name` in this same project.

---

## Privacy: a display name may never be derived from the email

**This is the invariant.** The email local-part of a Google account is very often
a real name (`jane.doe`). A client-side fallback to it published real names for
every player who never opened the name picker — that shipped on the sister
project and a player reported it.

It is enforced **three times**, and all three are needed:

1. **In the client.** `preferredName()` is the only thing that decides what
   becomes public, and `cloudSession().email` is deliberately unreachable from
   inside it — the rule holds by construction rather than by discipline. The
   fallback is `anonName(userId)` → `Player 7F3A`, derived from the user id
   already on every board row, so it discloses nothing that reading the board did
   not.
2. **In the guard trigger.** `public_display_name()` compares a submitted name
   against **that account's own** `auth.users.email` local-part — exact, not a
   heuristic — and substitutes the anonymous name.
3. **In a backfill**, because cached PWA clients keep submitting for days after a
   deploy and only the server can refuse them.

### The guard skips its day check when the score doesn't rise

That is what lets a rename reach **closed** boards. `renameEverywhere()` updates
`display_name` on *all* of the player's rows — every board, every past day — and
the whole point of the picker is that a name can be scrubbed from history. A name
left on a closed board, which its owner will never submit to again, defeats that
completely.

⚠ **Restore the day check on every write and scrubbing a name from history
silently stops working** — the client catches and discards the rejection, so
nothing errors and nothing happens.

---

## Invites (`js/referrals.js`, migration `0002`)

```
referrer mints a code ──► link carries ?ref=CODE
                          friend's browser stashes it at BOOT (survives until sign-in)
                          ──► after sign-in: one referrals row, EVER (the PK)
                          ──► best run passes QUALIFY_SCORE → stamps qualified_at
referrer's client finds qualified-unclaimed rows ──► pays out, stamps claimed_at
```

The friend's own welcome chelas ride a latch in the save
(`referralWelcomeClaimed`), not a cloud balance. **The cloud rows only coordinate
the two accounts; they never hold money.**

**Code visibility.** `primos_referral_codes` is own-rows-only from day one.
Resolving somebody else's code goes exclusively through the SECURITY DEFINER
`primos_resolve_referral_code()`. Viva Maya needed three migrations to reach that
state — its table shipped `for select using (true)`, so anyone holding the
publishable key (i.e. every visitor) could dump every invite code alongside its
owner's auth UUID, and closing it took two migrations *sequenced around a client
deploy*. Primos has no cached bundle to sequence around, so the hole never has to
exist. **Do not add a permissive select policy to "make it work"** — the function
is how it works.

The share link is hardcoded to `https://corrupt.solutions/games/primos/` rather
than built from `location.href`, and **the trailing slash stays**. localStorage
is per-origin, so a friend who arrives on the github.io origin gets a save that
has nothing to do with the one they would have had on the canonical domain. The
proxy 308s the slash-less form with the query preserved, but only the slashed
form skips the redirect.

---

## Trust model, stated plainly

Scores are self-reported by an untrusted client and nothing pretends otherwise.

**What IS guaranteed:** RLS stops anyone writing anyone else's row, and the guard
stops the cheap structural attacks — wrong board, lowered score, forged
timestamp, leaked email.

**What is not:** making the score itself unforgeable needs server-side
deterministic replay, and that is a separate project. A **daily** board makes it
easier to defer — a forged score buys one day, not a season.

The publishable anon key is safe to ship in `js/cloud-config.js` precisely
because the policies, not the key, are the protection.

---

## Migrations

| file | what it creates |
|---|---|
| `0001_primos_cloud.sql` | `primos_daily_scores`, the `primos_weekly_totals` view, the guard, `primos_anon_display_name`, `primos_public_display_name` |
| `0002_primos_referrals.sql` | `primos_referral_codes`, `primos_referrals`, the guard, `primos_resolve_referral_code()` |
| `20260731120000_primos_analytics.sql` | events + admin RPC — see [ANALYTICS.md](ANALYTICS.md) |

**Migrations are applied by hand. CI never applies them.** So *applying to
production* and *merging to `main`* are two separate acts, and **the repo does
not describe production until both have happened.** Nothing in this repo or the
vault can tell you what production has — only a probe can.

⚠ **`supabase db push` cannot be used here, and fails silently first.**
`schema_migrations` is per-project and the sibling games already own versions
`0001`–`0022`, so a file numbered `0003` looks already-applied and is skipped
with a success message. Number new migrations by **timestamp** and apply with
`supabase db query --linked -f <file>`. Never run the
`migration repair --status reverted` the CLI suggests — it would mark the other
games' migrations reverted. See
[ANALYTICS.md](ANALYTICS.md#-supabase-db-push-does-not-work-from-this-repo-and-fails-silently).

### Two-phase deploys

**Schema first, client second.** The PWA is prompt-mode, so cached clients keep
running the old bundle for days. Any client change that sends a new column to a
server that doesn't have it yet is rejected per-batch, and any schema change must
tolerate the previous wire shape.

### After every migration, run the audit

```bash
scripts/verify-rls.sh <url> <publishable-key>
```

It checks **effects, not status codes** — PostgREST answers 204 whether it
deleted one row or zero. Every "must be refused" assertion is paired with a
**control probe against a table that does not exist**, because an empty `[]` is
otherwise ambiguous between "RLS refused you" and "the table isn't there",
and those two look identical from the client while meaning opposite things. A
check that cannot distinguish safe from unsafe reports `?`, not green.

---

## Turning it on (human-only steps)

1. **Fill `js/cloud-config.js`** with `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_ESM` and `GAME_ID = 'primos-run'`. Nothing else switches the layer
   on.
2. **Apply the migrations by hand** in the Supabase SQL editor, in order, then
   run `scripts/verify-rls.sh` against production and read the output.
3. **Google OAuth** — the redirect URI registered in the *Google Cloud console*
   goes to the **Supabase callback**
   (`https://<project>.supabase.co/auth/v1/callback`), **not** the game's URL.
   That is the usual mistake. See `references/rollout.md` in the
   `cloud-saves-and-leaderboards` skill for the full checklist.
4. **Supabase → Authentication → URL Configuration → Redirect URLs** must list
   **both** origins the game is reachable on:
   - `https://corruptfun.github.io/primos-run/`
   - `https://corrupt.solutions/games/primos/`

   `signInWithOAuth` passes `redirectTo: location.href`, so a sign-in started
   from an origin that is not allowlisted bounces back to the Site URL and
   **sign-in silently does nothing**. This is a dashboard-only check — an outside
   probe cannot confirm it, because the PKCE state is opaque.
5. **Bump `CACHE_VERSION` in `sw.js`** and deploy.

---

## Checks

- `dev/cloud-test.html` asserts the pure half in-browser — day/week keys, the
  merge, name sanitising, the `anonName` ↔ SQL parity case. It **cache-busts its
  imports**; it had been asserting against stale modules, which on a test page is
  the worst possible place for that.
- `scripts/verify-rls.sh` against production, after every migration.
- The syntax sweep in [BUILD_OVERVIEW.md](BUILD_OVERVIEW.md#checks).
