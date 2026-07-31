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
| `docs/FEEDBACK.md` | the suggestion box: Corrupt on HELP, the guard, the triage queue |
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
  and kept in `localStorage` — and, since `js/primo-cache.js`, in a Cache Storage
  bucket on the player's own device. Nothing is uploaded anywhere.

- **PRIMO ART HAS NOTHING TO DO WITH SUPABASE.** It is the natural assumption and
  it is wrong: the pixels come from public IPFS gateways and
  `data/primos-index.json` is a static file on this game's own host (precached by
  `sw.js`). Supabase serves saves, boards, analytics and feedback only. When
  someone asks to "reduce Supabase pulls" for the art, the honest answer is that
  there were never any — the traffic to cut is the gateways' and the static
  host's, which is what the art cache does.

- **`sw.js`'s activate sweep must only delete its OWN `primos-run-` caches.** It
  used to delete every cache whose key was not the current shell — the shape
  every service-worker tutorial ships — which silently wiped `primos-art-v1` on
  **every deploy**, turning a permanent per-device cache into a per-release one.
  The players who update most often would have paid the most bandwidth and
  nothing would have logged a thing.

- **`aspect-ratio` on a `<button>` is not honoured by Safari's form-control
  layout.** The Primo grid's tiles are buttons whose only content is an `<img>`
  with no `src`, so every row collapsed to a couple of pixels and the tiles
  stacked into unreadable vertical stripes ON IPHONE ONLY — Chromium renders it
  fine, so it cannot be caught on a desktop. `.primo-grid` states
  `grid-auto-rows` outright; nothing about the grid's geometry may go back to
  depending on what the tile is made of.

- **The Primo browser is PAGINATED (`PAGE_SIZE = 20`), not one long scroll.** The
  first version built all 3,069 tiles up front: measured at 3,069 DOM nodes, a
  61,000px scroll height and just over a second of layout before the sheet could
  open — on a desktop. 20 is sized to the grid's own height cap so a page fits
  with nothing clipped; 24 spilled a sixth row under the fold, which meant the
  page you were told you were on was not the page you could see.

- **The crew draw rotates DAILY, and that is what makes the art cache work.** It
  used to pick four fresh tokens on every launch, so the four menu images could
  never be anything but a cache miss — every launch re-fetched four PFPs and the
  hand-drawn stand-ins sat on screen until they landed, which is the "art flashes
  on load" bug. Keep the rotation coarse enough that a returning player hits
  cache. `paintCrew` also holds a neutral placeholder for `CREW_ART_GRACE` rather
  than painting cartoons it is about to replace — four faces visibly changing
  identity is a much louder event than four faces arriving.

- **`loadPrimoArt` must fetch each image ONCE.** Its first version baked from the
  gateway with an `<img>` and then re-fetched the same bytes to fill the cache:
  32 requests for a 24-tile page, i.e. a caching layer that doubled first-visit
  bandwidth to halve the second visit's. Go through `fetchArt` and bake from what
  it returns. The `<img>` walk that remains is the fallback for a gateway with no
  CORS headers, where `fetch` cannot serve at all.

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
| `js/primo-cache.js` | the local art cache — fetch a Primo's pixels once per device |
| `js/store.js` | localStorage + backup code — the AUTHORITATIVE save |
| `js/cloud.js` | Google sign-in, cloud save pull/merge/push |
| `js/leaderboard.js` | board submit/read + the race-name rules |
| `js/referrals.js` | invite codes, `?ref=` capture, qualify + payout |
| `js/merge.js`, `js/raceday.js` | pure: save reconciliation, day/week keys |
| `js/account.js`, `js/boards.js` | the ACCOUNT and LEADERBOARD screens |
| `js/analytics.js` | the event pipe — `track()`, crash telemetry, opt-out |
| `js/feedback.js` | the suggestion box — what players write to Corrupt |
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

## The suggestion box (`js/feedback.js`, migration `20260731190000`)

Corrupt's face on the HELP sheet opens a form; the reports land in the FEEDBACK
panel at the top of `stats.html`. Ships dormant with the rest of the cloud
layer. Built to the **`player-feedback` skill** — read it before changing
anything here. Full write-up in `docs/FEEDBACK.md`.

Everything the analytics section says about the `primos_` prefix, `db push`, and
"no SELECT policy, ever" applies here unchanged. What is *different*:

- **This guard THROWS where the analytics guard degrades.** `primos_events_guard`
  may never raise — its error lands in a fetch next to the game loop. This one is
  behind a button the player pressed and is watching a status line for, so
  silently dropping a report you told someone was sent is the worse failure. It
  raises with PostgREST's `PTxyz` SQLSTATEs (`PT429`, `PT400`); the client reads
  the STATUS CODE and never the body, so losing that mapping costs the wording
  and not the box.
- **It is rate limited IN THE DATABASE** — 5/device/hour, 20/day. Every other
  write path here is bounded by what an honest client would send; a free-text
  POST endpoint on a public origin is not. `HOUR_LIMIT`/`DAY_LIMIT` in
  `js/feedback.js` are a PAIRED COPY and a courtesy. If they drift the client's
  must be the SMALLER, or it promises a send the server will refuse.
- **Dedupe runs BEFORE the rate limit.** A retry of a report that already landed
  must not spend the retrier's allowance — otherwise a flaky connection burns the
  hour on one message and refuses the one they actually wanted to send.
- **The read RPC returns RAW ROWS**, unlike `primos_admin_analytics`. An
  aggregate of a suggestion box says how many people wrote and nothing about
  what. That is exactly why the table has no select policy — one door, and the
  sentence is what is behind it.
- **`status` is not decoration.** A box you cannot mark as read shows the same
  thirty messages every visit, so you stop opening it. Hence
  `primos_admin_feedback_status()`, hence the panel refetching after every change
  (the tiles are counts over the same rows), and hence the panel reading a YEAR
  instead of following the 7/14/30/90 buttons — a report unread for three weeks
  must not fall out of the window along with the count pointing at it.
  `primos_prune_feedback` never prunes a row still marked `new`, for the same
  reason.
- **The contact field is never prefilled from the account email** (the display
  name rule again), and the dashboard renders it as TEXT, not a `mailto:` — an
  `href` built from a player-typed string puts a `javascript:` URI one click away
  in the owner's own session.
- **The message never enters the event log.** `feedback_send` carries its
  LENGTH. Two tables, two retentions, and only one of them is unreadable; a prop
  with the sentence in it copies the thing that split exists to contain.
- `window.__renderFeedback(payload)` is the panel's twin of `__renderStats`.
- ⚠ `scripts/verify-rls.sh`'s rate-limit probe **writes five rows**, and they
  arrive marked `new`. Clear them after a production run:
  `delete from public.primos_feedback where app_version = 'verify';`

## Checks

ES modules, so `node --check` needs an `.mjs` copy:

```bash
for f in js/*.js js/art/*.js js/stats/*.js; do cp "$f" /tmp/x.mjs; node --check /tmp/x.mjs || echo "FAIL $f"; done
```

`dev/cloud-test.html` asserts every pure module in the browser — day/week keys,
the merge, name sanitising, the analytics vocabulary pin, the feedback bounds and
sanitisers, and the dashboard's rate math. 196 assertions. Open it after touching
`raceday.js`, `merge.js`, `store.js`, `leaderboard.js`, `referrals.js`,
`analytics.js`, `feedback.js` or `js/stats/`.

**Bump `CACHE_VERSION` in `sw.js` on every deploy** or players keep stale JS —
and bump `APP_VERSION` in `js/version.js` in the same commit. If they drift,
`sw.js` is what players feel and `version.js` is what the dashboard reports, so
errors get attributed to the wrong build: precisely the panel you reach for when
something has just broken.
