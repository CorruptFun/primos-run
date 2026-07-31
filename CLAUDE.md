# Primos: Barrio Run

Endless runner down LA alleyways starring the Primos Solana NFT collection.
Live repo: <https://github.com/CorruptFun/primos-run>
Live game: <https://corrupt.solutions/games/primos/> (the canonical URL — see
`js/referrals.js` for why it is hardcoded rather than built from `location`)

## Long-form docs live in `docs/`

This file is the guardrail — the things that have actually bitten. The reasoning
is written down properly next door, and it is worth reading before a substantial
change rather than re-deriving it:

| doc | what's in it |
|---|---|
| `docs/BUILD_OVERVIEW.md` | architecture, boot order, render pipeline, the rig, the world generator |
| `docs/GAME_DESIGN.md` | every rule and number, with the reasoning behind each |
| `docs/CLOUD_AND_LEADERBOARDS.md` | cloud save, sign-in, boards, invites, the merge, migrations |
| `docs/ANALYTICS.md` | the event pipe, the dashboard, what is collected and what is not |
| `docs/GO_LIVE_CHECKLIST.md` | what must be true before and after a deploy |

**Update them with the code.** A stale doc is worse than none — the last one to
go stale here claimed 520 of 3,069 tokens for a day after full coverage landed.

## Do not assume

- **The character's body is real 3D, not artwork.** `js/art/runner.js` solves a
  3D skeleton (x lateral, y up, z forward) from a keyframed run cycle, then
  draws each bone as a depth-sorted chain of overlapping spheres. Joints share
  spheres, so the surface is continuous by construction.

  This was reached by elimination, so do not "simplify" it back: procedural 2D
  capsules and Gemini-painted limb cut-outs were both tried and both read as
  loose parts. A skinned mesh is what keeps limbs connected in Subway Surfers,
  and sphere chains are the cheapest honest version of that in canvas 2D.

- **Limbs swing in DEPTH, not across the screen.** For a runner seen from
  behind the motion is almost entirely z-axis. Rotating limbs in the image
  plane reads as doing the splits. Related trap: raise `TILT` in `runner.js`
  and the foot's world-space rise is cancelled by depth pushing it back down
  the screen — the legs go visually dead. `TILT` is low on purpose; `YAW`
  carries readability.

- **Checkpoints, border walls and cruisers cannot be jumped, by design.** Their
  heights are set above the jump apex deliberately (`RUN.jumpV` in `config.js`,
  and the comment on `PROP_SPEC` in `js/art/props.js`). Lane changes are the
  answer. Dumpsters/crates/cones are jumpable; clotheslines/awnings need a slide.

- **`data/primos-index.json` is built offline by `scripts/harvest-primos.mjs`,
  and it no longer touches Magic Eden.** ME could only ever reach ~520 of 3,069:
  it serves ~150 listings, caps `activities` near a thousand records, and an
  activity only exists for a token that has *traded*. No budget fixes that. The
  harvester now reads the collection's on-chain Metaplex metadata URI via Solana
  RPC to find the pinned IPFS directory, then walks `<dir>/<n>.json` for every
  token across a pool of gateways. Full 3,069 coverage, ~167KB, CIDs only.
- **The collection is numbered 0–3068, not 1–3069.** Token #0 exists. Any
  `min`/`max` on a number input has to allow it.
- `ipfs.io` sends `access-control-allow-origin: *`, so a player's Primo loads
  untainted and its pixels can be sampled for outfit colours. `cloudflare-ipfs.com`
  is dead (ENOTFOUND) — do not put it back in the gateway list. Gateways also
  *stall* rather than erroring, so any fetch through one needs its own timeout or
  the fallback chain never advances.

- **No collection artwork lives in this repo, and none should.** The index holds
  IPFS CIDs only. Player images are fetched client-side at the player's request
  and kept in `localStorage`.

- **`art/*.png` is generated, not hand-drawn.** `scripts/gen_art.py` calls
  Gemini and chroma-keys the result. `art/raw/` is gitignored.

## Run it

`.claude/launch.json` (in `~/Creative/`) → entry `primos-run`, port 4177.
Use the preview tools, not `python3` in a Bash call.

## Iterate on the character in the harness, not in-game

`dev/rig-test.html` renders the whole run cycle plus air/slide poses side by
side, with a live oversized view and a real Primo loaded from IPFS. It
cache-busts its imports on purpose — `python3 -m http.server` answers with
`Last-Modified` and browsers reuse stale ES modules, which silently shows you
the previous build. The game itself does NOT cache-bust, so clear the service
worker (`primos-run-<CACHE_VERSION>`, whatever `sw.js` currently says) when
testing there. `pwa-register.js` already skips registration on localhost, which
covers the dev loop; a stale cache is a symptom of having tested on a deploy.

## Layout

| path | role |
|---|---|
| `js/game.js` | rules: movement, stamina, chase, scoring, collision |
| `js/world.js` | chunk generator — chunks are hand-authored and always fair |
| `js/render.js` | scene renderer, painter's algorithm |
| `js/config.js` | every tunable lives here |
| `js/art/runner.js` | skeleton, run cycle, toon-3D body |
| `js/art/primo-head.js` | PFP → head sprite (crop, mask, palette, lighting) |
| `js/art/scenery.js` | sky + alley walls |
| `js/art/sprites.js` | painted cut-out rig (unused for the body) + prop sprites |
| `js/store.js` | localStorage + backup code — the AUTHORITATIVE save |
| `js/cloud.js` | Google sign-in, cloud save pull/merge/push |
| `js/leaderboard.js` | board submit/read + the race-name rules |
| `js/referrals.js` | invite codes, `?ref=` capture, qualify + payout |
| `js/merge.js`, `js/raceday.js` | pure: save reconciliation, day/week keys |
| `js/account.js`, `js/boards.js` | the ACCOUNT and LEADERBOARD screens |
| `js/analytics.js` | the event pipe — `track()`, crash telemetry, opt-out |
| `js/version.js` | the build stamp. Bump WITH `sw.js`'s `CACHE_VERSION` |
| `stats.html`, `js/stats/` | the admin analytics dashboard (never precached) |
| `scripts/gen_art.py` | Gemini art generation + chroma key |
| `scripts/make-icons.js` | PWA icons, zero dependencies |
| `scripts/verify-rls.sh` | RLS audit — run after any migration |

## Cloud save, sign-in and the boards

**It ships DORMANT.** `js/cloud-config.js` is empty, so sign-in, sync and the
boards all no-op and the game runs local-only — supabase-js is never even
fetched. Filling in the URL + anon key is what turns the whole layer on. Device
backup/restore in ACCOUNT works either way, on purpose.

**One project, one player base, designated per game.** The Supabase project
(`deskabqqxqqibxjffwmb`) hosts every Corrupt game: one Google sign-in, one
`auth.users` row, recognised everywhere. **Saves go in the SHARED
`public.game_saves`**, keyed `(user_id, game)`, with this game's slug
`GAME_ID = 'primos-run'`. That table is owned by Turbo Maze's
`0001_game_saves.sql` — a new game needs no new table and no new migration,
only a fresh slug. Do NOT give this game a private saves table; it would work
and would quietly keep its players out of the shared registry.

Only the **boards** are Primos-owned, because a leaderboard cannot be generic —
ranking columns, guard, continue flag, weekly rollup. Every object this repo's
migration creates is `primos_`-prefixed. Viva Maya is the exception to all of
this: it predates the shared table and keeps its own `public.saves`.

Use the **`cloud-saves-and-leaderboards` skill** before changing anything
score-, board-, sign-in- or name-related. It is the distilled version of this
exact stack and most of what looks fussy in these files is a scar it explains.
`references/rollout.md` has the Google OAuth checklist — the redirect URI goes
to the *Supabase* callback, not the game's URL, which is the usual mistake.

Three things that will bite otherwise:

- **`js/raceday.js` and `js/leaderboard.js`'s `anonName` have byte-identical
  twins in the migration**, which validates every submission and *refuses to
  apply* if they drift. Change one side and you must change the other, plus the
  cases in `dev/cloud-test.html`. The SQL side is
  `public.primos_anon_display_name` — **prefixed on purpose**: this project
  shares a Supabase project with Viva Maya and Turbo Maze, and Viva Maya owns an
  unprefixed `anon_display_name`. Every object this migration creates is
  `primos_`-prefixed; keep it that way.
- **A display name may never be derived from the email.** Enforced in the
  client, again in the guard trigger, and once more by a backfill — because
  cached PWA clients keep submitting for days after a deploy.
- **The guard skips its day check when the score doesn't rise.** That is what
  lets a rename reach closed boards. Restore the check on every write and
  scrubbing a name from history silently stops working.

Migrations are applied by hand; CI never applies them. So applying to production
and merging to `main` are two separate acts, and *the repo does not describe
production until both have happened*.

## Invites (`js/referrals.js`, migration `0002`)

Send a link → your friend signs in and puts up `QUALIFY_SCORE` → you get
`REFERRER_CHELAS`, they get `REFEREE_CHELAS`. All four constants live at the top
of `js/referrals.js`. Ported from Viva Maya's `src/core/referrals.ts`, which is
the shipped original if you need to compare.

- **The `primos_` prefix here is not style, it is the whole safety.** Viva Maya
  already owns UNPREFIXED `referral_codes`, `referrals` and
  `resolve_referral_code()` in this same Supabase project. Unlike the
  `anon_display_name` collision — which at least aborted with 42P13 —
  `create table if not exists public.referral_codes` finds Viva Maya's table,
  **quietly does nothing, and reports success**, after which this game reads and
  writes Viva Maya's live referral data. `create or replace function` on the
  matching signature would silently replace theirs. Nothing warns you.
- **Ship-hardened in one migration, deliberately unlike Viva Maya's three.**
  Their `referral_codes` shipped world-readable (`for select using (true)`) and
  closing it took 0008 → *client deploy* → 0009, sequenced that way because
  tightening the policy under a cached PWA client makes real codes look dead —
  and a dead code is a DEFINITIVE rejection, so the stash is cleared and the
  referral destroyed rather than retried. Primos has no cached client that ever
  resolved a code, so the hole never has to exist. **Do not add a permissive
  select policy to "make it work"** — `primos_resolve_referral_code()` is how it
  works. `scripts/verify-rls.sh` asserts exactly this, with a control pair that
  distinguishes a real permission denial from a function that was never applied.
- **The invite link hardcodes `https://corrupt.solutions/games/primos/?ref=`**,
  not `location.href`. localStorage is per-origin, so a link built from wherever
  the sender happened to be spreads the github.io origin and lands the friend on
  a different save. The trailing slash stays — the proxy 308s the slash-less
  form with `?ref=` intact, but only the slashed form skips the redirect.
- **`referralWelcomeClaimed` is in `ECON_KEYS` and unioned by `mergeSaves`.**
  Both are load-bearing and both mint chelas if removed: without the first, the
  next ordinary `save()` carries a boot-time `false` back over the spent latch;
  without the second, a fresh device wins the progress tie (collecting a welcome
  happens to a nearly-new account, so every metric ties) and re-opens it.
- **Registration must run before qualification** in the push chain —
  `maybeQualify` memoizes "never referred" as terminal for the session.
- The referee's welcome pays out on the visit *after* the run that qualified
  them, because the qualify stamp goes up on the save push. That is the accepted
  simplification, not a bug.

## Analytics (`js/analytics.js`, `stats.html`, migration `0003`)

First-party, no third-party trackers. Ships dormant with the rest of the cloud
layer. Built to the **`first-party-analytics` skill** — read it before changing
anything here. Full write-up in `docs/ANALYTICS.md`.

- **The `primos_` prefix is the whole safety, again, and worse than in 0002.**
  Viva Maya owns UNPREFIXED `public.events`, `events_guard()`, `prune_events()`,
  `app_admins` AND `admin_analytics()` in this same project. An unprefixed 0003
  would have *silently* adopted its events table and **replaced its hardened
  guard and RPC** — killing that game's event dedupe with no error anywhere.
  Three collisions, none of which announce themselves.
- **`primos_events` has an INSERT policy and NO SELECT POLICY, EVER.** An event
  log is a per-device behavioural history; it is worse to leak than the board.
  The migration ends with a self-check that refuses to apply if a select policy
  exists. Read it through `primos_admin_analytics()`, which returns aggregates
  only. Corollary: `Prefer: return=minimal` on the insert is *correctness* — ask
  PostgREST to return the rows and it tries to read them back and fails the write.
- **THE WIRE IS A PLAIN INSERT. The dedupe is in the guard TRIGGER.** The
  idempotent shape every guide reaches for — `?on_conflict=event_id` +
  `resolution=ignore-duplicates` — **cannot work here**: `ON CONFLICT` makes
  Postgres require SELECT rights, so the rewriter folds the table's SELECT
  policies in as an extra `WITH CHECK`; there are none, so it is a constant
  false and every batch is `42501` → 401. **The error names no policy — that is
  the tell.** No select policy can fix it (the check runs on the NEW row, so it
  would have to be `using (true)`). Worse, it SUCCEEDS on a retry and fails only
  on new data, because a conflict that fires inserts no row and never evaluates
  the check — so a probe that reuses an event_id reports a false pass. Shipped
  broken, caught by `verify-rls.sh` against production, fixed the same day.
- **`js/hud.js` also exports a `track`** (a drawing helper). `js/tutorial.js`
  imports both, so the analytics one is aliased `trackEvent` there. Getting this
  wrong is silent — you draw a slider track instead of recording an event.
- **`supabase db push` DOES NOT WORK from this repo, and its first failure mode
  is silence.** `schema_migrations` is per-PROJECT, and Viva Maya + Turbo Maze
  already own versions `0001`–`0022` there. A migration numbered `0003` looks
  already-applied and is **skipped with a success message**. Number anything new
  by TIMESTAMP. Then push refuses permanently ("remote versions not found
  locally") because this repo will never hold the other games' files — that is
  correct, not a problem to fix. **Never run the `migration repair --status
  reverted` it suggests**: it would mark the other two games' migrations
  reverted and make their next push re-apply twenty files. Apply with
  `supabase db query --linked -f <file>` and record nothing.
- **`EVENTS` is the one source of event names**, and the names 0003's funnels
  filter on are asserted against it in `dev/cloud-test.html`. A misspelled step
  renders as a permanently-zero funnel, which looks exactly like real data, and
  there is no compile step here to catch it.
- **A rate with a zero denominator is null, rendered "—", never 0%**, and D1/D7
  count only cohorts whose day has fully elapsed. Both rules exist because the
  wrong version puts a number on screen that looks like a measurement.
- **`stats.html` and `js/stats/` are never precached, and `sw.js` skips them
  outright** — players must not download the owner's tool, and without the skip
  an offline `/stats.html` is answered with the *game*.
- `window.__renderStats(payload)` renders the dashboard with no database behind
  it — the panels are otherwise behind a Google sign-in and an `app_admins` row.
  `stats.html` does not cache-bust, so re-import with `?v=Date.now()` when
  iterating.

## Checks

ES modules, so `node --check` needs an `.mjs` copy:

```bash
for f in js/*.js js/art/*.js js/stats/*.js; do cp "$f" /tmp/x.mjs; node --check /tmp/x.mjs || echo "FAIL $f"; done
```

`dev/cloud-test.html` asserts every pure module in the browser — day/week keys,
the merge, name sanitising, the analytics vocabulary pin and the dashboard's rate
math. 164 assertions. Open it after touching `raceday.js`, `merge.js`,
`store.js`, `leaderboard.js`, `referrals.js`, `analytics.js` or `js/stats/`.

**Bump `CACHE_VERSION` in `sw.js` on every deploy** or players keep stale JS —
and bump `APP_VERSION` in `js/version.js` in the same commit. If they drift,
`sw.js` is what players feel and `version.js` is what the dashboard reports, so
errors get attributed to the wrong build: precisely the panel you reach for when
something has just broken.
