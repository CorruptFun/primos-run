# Build Overview

How PRIMOS: BARRIO RUN is put together. Code is the source of truth; this
explains the shape, the boot order, and the reasons behind the parts that look
strange. For the *rules* of the run see [GAME_DESIGN.md](GAME_DESIGN.md); for
sign-in, saves and boards see
[CLOUD_AND_LEADERBOARDS.md](CLOUD_AND_LEADERBOARDS.md); for measurement see
[ANALYTICS.md](ANALYTICS.md).

## The one-paragraph version

Vanilla ES modules and a single 2D canvas. **No build step, no framework, no
bundler, no dependencies** — `index.html` on any static server is the whole
deploy. The game is a fixed-function pipeline: `main.js` owns the loop and the
DOM screens, `game.js` owns the rules, `world.js` generates the alley,
`render.js` paints it back to front, and everything tunable lives in
`config.js`. The cloud layer (`cloud.js`, `leaderboard.js`, `referrals.js`,
`analytics.js`) is bolted on the side and **ships dormant** — with
`js/cloud-config.js` empty, every one of those paths no-ops and the game runs
local-only.

## Why there is no build step

The game is deployed to GitHub Pages and proxied at
`corrupt.solutions/games/primos/`. A bundler would buy tree-shaking and minified
output for a project whose entire JS is ~21k lines of first-party source with no
npm dependencies at runtime. What it would cost is the thing that actually makes
this repo pleasant: you can open `js/config.js` in a browser devtools source
tab, change a number, and see it. Everything below assumes that trade.

The consequence to remember: **there is no compile step to catch you**. There is
no type checker, and `node --check` needs an `.mjs` copy (see
[Checks](#checks)). The dev harnesses in `dev/` exist to replace what a test
runner would otherwise give you.

## Module map

### The loop

| module | role |
|---|---|
| `js/main.js` | bootstrap, rAF loop, every DOM screen, persistence, crew picker |
| `js/game.js` | rules: movement, stamina, La Migra pressure, scoring, collision |
| `js/world.js` | chunk-based alley generator — hand-authored, always fair |
| `js/render.js` | scene renderer, painter's algorithm |
| `js/camera.js` | pseudo-3D projection + juice (tilt, bob, FOV kick, shake) |
| `js/input.js` | pointer/keyboard → four verbs (lane, jump, slide, pause) |
| `js/config.js` | **every tunable in the game** |
| `js/hud.js` | in-run HUD, drawn on the canvas (not DOM) |
| `js/perf.js` | DPR cap + dynamic render scale |
| `js/particles.js` | pooled bursts and footfall dust |
| `js/audio.js` | WebAudio SFX + music, synthesised (no audio files) |
| `js/haptics.js` | vibration patterns, gated by the sound toggle |
| `js/intro.js` | the opening camera move |
| `js/tutorial.js` | first-run training — the escuela del callejón |
| `js/i18n.js` | every word the game says, EN + ES |

### The art

| module | role |
|---|---|
| `js/art/runner.js` | the skeleton, the run cycle, and the toon-3D body |
| `js/art/head-back.js` | the BACK of the runner's head, drawn from trait fields |
| `js/art/primo-head.js` | PFP → head sprite (crop, mask, palette, lighting) |
| `js/art/primo-runner.js` | the player's Primo assembled onto the rig |
| `js/art/scenery.js` | sky, alley walls, fixtures, papel picado, skyline |
| `js/art/graffiti.js` | throw-ups and tags on the alley walls |
| `js/art/props.js` | procedural props — obstacles and pickups |
| `js/art/sprites.js` | painted cut-out rig (unused for the body) + prop sprites |
| `js/art/wet.js` | perspective puddles, neon reflection streaks, depth grade |
| `js/art/ice.js` | the ICE units — a second rig, for later levels |
| `js/art/trainer.js` | Corrupt himself (shop badge, tutorial) |
| `js/art/logo.js` | the title treatment |
| `js/art/palette.js` | shared colours + `roundRect` |

### The economy and the meta

| module | role |
|---|---|
| `js/store.js` | localStorage + backup code — **the AUTHORITATIVE save** |
| `js/wallet.js` | the chela balance and the shelf — a seam over `store.js` |
| `js/tiendita.js` | the shop catalog, the shelf UI, the continue offer |
| `js/primo-picker.js` | find-and-claim a Primo by token number |
| `js/cloud.js` | Google sign-in, cloud save pull/merge/push |
| `js/merge.js` | pure: cross-device save reconciliation |
| `js/raceday.js` | pure: day/week keys, per-day bests |
| `js/leaderboard.js` | board submit/read + the race-name rules |
| `js/referrals.js` | invite codes, qualification, rewards |
| `js/analytics.js` | the event pipe (see [ANALYTICS.md](ANALYTICS.md)) |
| `js/boards.js` | LA TABLA — the leaderboard screen |
| `js/account.js` | CUENTA — sign-in, race name, device backup, invites |

### Not shipped to players

| path | role |
|---|---|
| `dev/rig-test.html` | character pose harness — **iterate here, not in-game** |
| `dev/cloud-test.html` | asserts the pure half of the cloud layer, in-browser |
| `dev/items-test.html` | prop/shop icon harness |
| `stats.html`, `js/stats/` | the analytics dashboard (admin-gated) |
| `scripts/gen_art.py` | Gemini art generation + chroma key |
| `scripts/harvest-primos.mjs` | builds `data/primos-index.json` |
| `scripts/make-icons.js` | PWA icons, zero dependencies |
| `scripts/verify-rls.sh` | RLS audit — run after any migration |

## Boot order

`js/main.js` → `boot()`. The order is load-bearing in three places, marked ⚠.

1. `captureRefFromUrl()` — read `?ref=` **before anything else touches the URL**
   and stash it. The player may never sign in; the stash is what survives that.
2. `initLang()` — restores the chosen language, or falls back to the device's.
3. `store.load()` — one read, cached for the session. ⚠ **`main.js` holds this
   copy for the whole session**, which is why `store.save()` restores the
   economy fields from disk over a caller's stale copy (see
   [The save is authoritative](#the-save-is-authoritative)).
4. `attachInput()`, `resize()`, crew picker built, sprites/props loaded.
5. `bootstrapCloud()` — ⚠ for a signed-in returning player this **reconciles
   before the game reads the save**, bounded by a 3s timeout so a captive
   network can never stall first paint.
6. `initBoards()`, `initAccount()`, analytics `init()`.
7. rAF loop starts. State is `MENU`; the alley scrolls behind the menu.

⚠ The third ordering rule is inside `cloud.js`'s push: `maybeRegisterReferral()`
runs **before** `maybeQualify()`, because qualify memoizes "this account was
never referred" as terminal for the session and would latch it against a row
register is about to create.

## The frame

```
frame(now) ─┬─ step(dt)        game.update(dt) — rules only, no drawing
            └─ drawFrame(dt)   render.renderScene() → hud.drawHUD()
                               sampleFrame(ms) → maybe resizeScene()
```

`dt` is clamped. The number handed to `sampleFrame` is **our own work**, measured
around the draw — not the gap between frames, which includes the browser's
compositing and would make the perf governor chase its own tail.

**`js/perf.js` is wired.** It caps DPR at `MOBILE.dprCap` (1.5 — past that,
retina buys nothing at arm's length) and scales the scene buffer between
`scaleMin` and `scaleMax` based on a 24-frame window. Both levers take away
*pixels* and never *geometry*, so a struggling phone gets a softer picture
rather than an emptier alley. Fill rate, not logic, is what drops a phone under
60 here.

## The renderer

Painter's algorithm, back to front, on one canvas:

```
sky + skyline → alley walls + graffiti + fixtures → road + wet pass
   → props (depth-sorted) → the runner → the cruiser → particles → HUD
```

The camera is a pseudo-3D projection (`js/camera.js`): world `(x, y, z)` →
screen, with focal length `CAM.focal × canvasWidth`. There is no matrix stack
and no z-buffer — draw order *is* the depth test, which is why every prop
carries a `z` and the sort is not optional.

`CAM.back` is 4.25 and `CAM.height` 2.25, deliberately close and low. Sitting
further back shrinks the runner to a sixteenth of the screen, which on a phone
is the difference between a character you play as and a sprite you supervise.
The cost is less warning before an obstacle, and `RUN.startSpeed` plus the chunk
spacing in `world.js` are what pay for it.

## The character is real 3D

This is the single most important "do not simplify" in the repo.

`js/art/runner.js` solves a skeleton in local 3D (x lateral, y up, z forward)
from a keyframed run cycle, then renders each bone as a chain of overlapping
spheres, depth-sorted back to front. Joints share spheres, so the surface is
continuous **by construction**. Each bone fills its spheres from one shared
screen-space gradient, so consecutive circles blend into a smooth shaded tube
instead of a string of beads.

It was reached by elimination. Procedural 2D capsules and Gemini-painted limb
cut-outs were both built and both read as loose parts — because a skinned mesh
is what actually keeps limbs connected in Subway Surfers, and sphere chains are
the cheapest honest version of that in canvas 2D.

Two traps that were fallen into and must not be re-entered:

- **Limbs swing in DEPTH, not across the screen.** For a runner seen from behind
  the motion is almost entirely z-axis. Rotating limbs in the image plane reads
  as doing the splits.
- **Depth `TILT` fights the heel kick.** Project depth too strongly and the
  foot's world-space rise is exactly cancelled by depth pushing it back down the
  screen — the legs go visually dead. `TILT` is low on purpose; `YAW` carries
  the readability.

**The head faces FORWARD, away from the camera.** `js/art/head-back.js` draws the
back of the head procedurally from trait fields (hair, hairStyle, bandana,
beanie, hoops, shades). The old rig blitted the front-facing PFP crop onto a body
seen from behind — a face on the back of someone's head. The baked sprite is
still correct for menu tiles and the HUD badge, which *do* look at you.
`primo-head.js` samples hair colour off the PFP crown so a custom Primo keeps its
own look from behind.

**Iterate in `dev/rig-test.html`, not in-game.** It renders the whole run cycle
plus air/slide poses side by side, with a live oversized view and a real Primo
loaded from IPFS. It cache-busts its imports on purpose — `python3 -m
http.server` answers with `Last-Modified` and browsers happily reuse a stale ES
module, which silently shows you the previous build.

## The world generator

`js/world.js` assembles the alley from **hand-authored chunks** (`CHUNKS`), never
from per-object randomness. A chunk is a small pattern of props with a
guaranteed-passable line through it, so the alley is always fair by
construction rather than by rejection sampling.

Two mistakes were made here, both the same mistake:

- **Tiers were gated on distance.** Distance accelerates, so tiers arrived about
  three times faster than the speed curve — gauntlets landed 90s in while top
  speed is 150s away. `PACING.tierSeconds` gates on **time survived**;
  `secondsAt(distance)` derives it in closed form so nothing outside `world.js`
  had to change.
- **Chunk spacing was authored in fixed world units.** A fixed distance is a
  *shrinking* reaction time: 9u is 0.60s at 15 u/s and 0.27s at 33 u/s, below
  human reaction time — the only way to survive it is to have memorised the
  pattern. `PACING.speedComp` stretches every chunk along z as speed climbs, so
  the seconds between rows stay roughly flat.

The useful consequence: a chunk takes a roughly constant amount of *time*
whatever the speed, so tacos, powerups and stamina — all metered per chunk —
stay in step for free.

## The save is authoritative

`js/store.js` is the source of truth for a player's progress, and it stays that
way even with the cloud switched on. `js/cloud.js` pulls the remote row, merges
it (`js/merge.js`), writes the winner back **through `store.js`**, and pushes
from there. Losing the network therefore loses freshness and nothing else.

Three fields are written **straight against storage**, never through a caller's
in-memory blob, and `save()` restores them from disk over whatever the caller
was holding:

```js
const ECON_KEYS = ['chelas', 'shelf', 'walletSeeded', 'referredBy', 'referralWelcomeClaimed'];
```

The reason is the boot-time copy in step 3 above. `main.js` holds one save from
boot; a purchase made three screens later moves the balance on disk without
touching that copy, so the next ordinary `save()` — a mute toggle, a crew pick —
would carry the stale balance back and **refund the shop**. `trainedAt` has the
same shape of hazard and the same guard.

The corollary that has bitten twice: **anything bypassing `save()` must
`notify()` by hand**. The cloud push is a `save()` listener, so a write that
never reaches it never reaches the cloud. That is what `writeEcon()`,
`markTrained()`, `clearTrained()` and `setReferredBy()` all do at the end.

## PWA

`sw.js` + `manifest.json` + `pwa-register.js`, from the `pwa-vanilla-setup`
skill. Network-first for navigations, stale-while-revalidate for assets, with a
prompt-mode update nudge.

- **Bump `CACHE_VERSION` in `sw.js` on every deploy** or players keep stale JS.
- `pwa-register.js` **skips registration on localhost** — its cache was silently
  serving pre-edit ES modules for several reloads during development.
- supabase-js is deliberately **not** precached: it is a cross-origin CDN URL,
  the fetch handler never touches cross-origin GETs, and precaching it would ship
  it to players on a build where `cloud-config.js` is still empty.
- `stats.html` and `js/stats/` are deliberately **not** precached — players must
  not download the owner's tool.

## Internationalisation

`js/i18n.js` holds every string, EN and ES. The voice policy is stated at the
top of that file and has been narrowed three times; read it before touching
copy. The short version: **`en` is full English, all the way down** — the old
"protected vocabulary" list is retracted and must not be reinstated. The only
things that stay Spanish in English are **proper nouns** (Primos, Corrupt, a
Primo's name, Pendleton, Rojo Base).

The antagonist is named in the reader's language: `en` says ICE, `es` says LA
MIGRA. That is the one thing that must land plainly rather than as a term the
reader might not parse, because it is what is being satirised.

## Art generation

`art/*.png` is **generated, not hand-drawn**. `scripts/gen_art.py` calls Gemini
and chroma-keys the result; `art/raw/` is gitignored. The API only returns JPEG,
so every asset is generated on a pure green field and keyed out locally.

```bash
source ~/.gemini_env && python3 scripts/gen_art.py parts
source ~/.gemini_env && python3 scripts/gen_art.py props
node scripts/make-icons.js
```

**No collection artwork lives in this repo, and none should.**
`data/primos-index.json` holds IPFS CIDs only (~167KB, all 3,069 tokens). Player
images are fetched client-side at the player's request and kept in
`localStorage`.

`scripts/harvest-primos.mjs` builds that index offline. It **no longer touches
Magic Eden** — ME could only ever reach ~520 of 3,069, because it serves ~150
listings, caps `activities` near a thousand records, and an activity only exists
for a token that has *traded*. No budget fixes that. The harvester now reads the
collection's on-chain Metaplex metadata URI via Solana RPC to find the pinned
IPFS directory, then walks `<dir>/<n>.json` for every token across a pool of
gateways.

Two gateway facts: `ipfs.io` sends `access-control-allow-origin: *`, so a
player's Primo loads untainted and its pixels can be sampled for outfit colours;
`cloudflare-ipfs.com` is dead (ENOTFOUND) and must not go back in the list.
Gateways also **stall** rather than erroring, so any fetch through one needs its
own timeout or the fallback chain never advances.

**The collection is numbered 0–3068, not 1–3069.** Token #0 exists. Any
`min`/`max` on a number input has to allow it.

## Run it

`.claude/launch.json` (in `~/Creative/`) → entry `primos-run`, port 4177. Use the
preview tools, not `python3` in a Bash call.

```bash
python3 -m http.server 4177
```

## Checks

ES modules, so `node --check` needs an `.mjs` copy:

```bash
for f in js/*.js js/art/*.js js/stats/*.js; do cp "$f" /tmp/x.mjs; node --check /tmp/x.mjs || echo "FAIL $f"; done
```

- `dev/cloud-test.html` asserts the pure half of the cloud layer — day/week keys,
  the merge, name sanitising, the analytics vocabulary and rate math. Open it
  after touching `raceday.js`, `merge.js`, `store.js`, `leaderboard.js` or
  `analytics.js`.
- `scripts/verify-rls.sh` audits the live RLS posture. Run it after **any**
  migration, against production, and read the effects rather than the status
  codes.
- `dev/rig-test.html` for the character, `dev/items-test.html` for props and shop
  icons.

There is no CI test job. These three pages are the test suite.
