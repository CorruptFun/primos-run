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
| `js/ui-feedback.js` | what a DOM button does when pressed — see below |
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
| `js/racha.js` | pure: the daily streak — settle, at-risk, display rules |
| `js/jales.js` | pure: daily missions — the day's draw, progress, payout |
| `js/art/gear.js` | el fit's draw code — shop icons + the worn mask/chain |
| `js/leaderboard.js` | board submit/read + the race-name rules |
| `js/referrals.js` | invite codes, qualification, rewards |
| `js/analytics.js` | the event pipe (see [ANALYTICS.md](ANALYTICS.md)) |
| `js/boards.js` | LA TABLA — the leaderboard screen |
| `js/account.js` | CUENTA — sign-in, race name, device backup, invites |

### Not shipped to players

| path | role |
|---|---|
| `dev/rig-test.html` | character POSE harness — **iterate here, not in-game** |
| `dev/head-test.html` | every TRAIT side by side — hats, cuts, colours, combos |
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
rather than an emptier alley.

⚠ **And that is why it barely works.** The design above rests on "fill rate, not
logic, is what drops a phone under 60 here", and that premise was measured on
2026-08-18 and did not survive. Against a frozen late-game frame, cutting the
scene buffer from 1280×800 to 448×280 — an eighth of the pixels — bought **1.9%**,
inside the noise, and the same held on a phone viewport. The frame is ~2,300
fills and strokes and the cost is the per-path setup, not the area covered. So
the governor's only lever is close to inert: a struggling device gets the soft
picture *and* the same frame rate.

The knobs are deliberately left where they are — that measurement is desktop
Chrome/Skia, where rasterising is cheap, and no real phone has been profiled —
but the practical consequence is that **anything which actually speeds this up
has to draw fewer paths.** `DRESS_ALPHA` in `scenery.js` is the worked example.

Where the frame actually goes, phase-timed at 1280×800:

| phase | share |
|---|---|
| alley walls | **51%** (the per-`kind` dressing alone is 25%) |
| blit (scene buffer → display canvas) | 13% |
| HUD | 8% |
| skyline | 7% |
| props | 7% |
| sky | 4% |
| ground | 4% |

Optimise anything but `drawWallSegment` and you are polishing the 4%.

## The renderer

Painter's algorithm, back to front, on one canvas:

```
sky + skyline → alley walls + graffiti + fixtures → road + wet pass
   → props (depth-sorted) → the runner → the cruiser → particles → HUD
```

The camera is a pseudo-3D projection (`js/camera.js`): world `(x, y, z)` →
screen, with focal length `min(CAM.focal × canvasWidth, CAM.focalH × canvasHeight)`.
There is no matrix stack and no z-buffer — draw order *is* the depth test, which
is why every prop carries a `z` and the sort is not optional.

**The height term is a cap, and it is load-bearing.** Focal came off the width
alone, which made the runner's on-screen size scale with WIDTH while the frame
they had to fit into was the HEIGHT: tuned to ~21% of frame height on a phone in
portrait, the identical camera put them at 63% on a 1280×800 laptop, 70% at
1080p, 85% on a phone in landscape and 94% on an ultrawide — feet at 128–170%,
so the legs, the slide and the whole skateboard stance were off-screen on every
landscape device. `CAM.focalH` (1.00) binds only past roughly 4:3, so portrait
phones are untouched and every landscape size lands on one framing: runner 34%
of height, feet at 87%, wall tops still above the frame.

`CAM.back` is 4.25 and `CAM.height` 2.25, deliberately close and low. Sitting
further back shrinks the runner to a sixteenth of the screen, which on a phone
is the difference between a character you play as and a sprite you supervise.
The cost is less warning before an obstacle, and `RUN.startSpeed` plus the chunk
spacing in `world.js` are what pay for it.

**That closeness is also why `js/particles.js` has a near guard of its own.**
`CAM.back` 4.25 with a focal length near the frame's width is the largest scale
anything in the alley ever gets — and *every* burst the game fires goes off
there: a pickup is collected where the player is standing, a smash lands against
their chest, the landing puff is under their feet. A 0.13u spark projects to
sixty-odd pixels at that range, and eighteen of them spawned on the same point
draw as ONE opaque square over the runner's neck. That was the flat slab of
powerup colour on the frame a powerup is collected — for years read as the glow
ring surviving `drawProps`'s cull, which it does not: `takePickup` marks the
prop dead before `renderScene` ever sees the frame. `SIZE_NEAR` sizes a spark as
though it were never nearer than 12u, and `LEAD` gives each one a random
sub-frame head start down its own path so a burst is never N sparks on one
pixel. `dev/frame-probe.js` is what stops on that exact frame.

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

**Every hair cut and every hat is ONE PATH, filled once.** Anything painted on
top of the hair as a separate shape stays flat under the cel light pass, and a
few flat marks high on an egg become a face — which is the single failure this
whole file exists to prevent. So a tuft, a spike, a bushy lobe and a cap's
adjuster notch are all part of an outline, unioned by nonzero winding. The
corollary is that **the traits separate by silhouette, not by surface detail**: a
script mark on the cap read as a scribble, knit ribbing turned a do-rag into a
barrel, and three ruled lines down a mullet made it a wooden keg. All three are
gone. See the header of `head-back.js` for the full list.

**Horns are the exception to the draw order, and the only one.** Every other
piece of headwear is painted over the hair, because that is where a hat sits. A
horn does not sit on a skull, it grows out of one, so it goes down BEFORE the
hair mass and the crown closes over its root — which is what lets the root be
wide enough to read without its base showing as a straight cut across the hair.
Its outline is still one path filled once, like everything else here, but it is
built from a SPINE with the half-width driven to zero along it rather than from
two hand-authored edges: the pair that shipped met at a point where they joined
the skull and were still 0.18rx apart at the tip, i.e. a horn assembled upside
down, and two of those on a dark crown read as insect antennae. Taper alone does
not finish the job either — the shape has to curve, because a tapering triangle
at the top corner of a round head is a cat's ear whatever colour it is drawn in.

Two general rules fell out of that fix. A KEYLINE ON A NARROW SHAPE is one flat
fill of the grown path, never a `cel()` pass — `cel()` offsets its lit copy by
`LX`/`LY` of the whole head box, so on something a few pixels across the pale
tone lands almost entirely outside the shape and hangs off it as a ghost. And
the hair's SHEEN is gated on `capped`, not on whether a hat exists: a visor and
a pair of horns leave the crown wide open, so their hair needs the pass that
guarantees a light value on the head exactly as much as a bare head does.

**Two harnesses, and they answer different questions.**

- **`dev/rig-test.html` — the POSE.** The whole run cycle plus air, slide, lean
  and the skateboard stance side by side, with a live oversized view and a real
  Primo loaded from IPFS. One Primo at a time, moving.
- **`dev/head-test.html` — the TRAITS.** Every hat, cut, hair colour, accessory
  and the combinations that collide, all at once, at a size slider that covers
  gameplay through 2×. A hat that reads as a lump is only obvious next to the
  five hats that do not, and that is a comparison rig-test structurally cannot
  make. Synthetic rigs through the real `applyTraits()`, so nothing is faked, and
  a row of real tokens off IPFS as the check on that.

Both cache-bust their imports, and `dev/head-test.html` also exposes
`window.only('<section>')` because an automated browser screenshots the first
viewport only and never follows a scroll.

**Serve dev with `scripts/dev-server.py`, not `python3 -m http.server`.** The
latter answers with `Last-Modified` and no `Cache-Control`, so the browser reuses
the module it already has: you edit a file, reload, and are shown the PREVIOUS
build with nothing in the console. If a harness edit does not appear, check what
is actually listening on the port before you debug the code.

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

## Press feedback

`js/ui-feedback.js`. A DOM button in this game has to answer for itself, and
before this module three separate holes all reached the player as one
complaint — *I press it and nothing happens*.

**The press.** `-webkit-tap-highlight-color: transparent` is set on the body on
purpose (the OS flash is a grey rectangle over a gold button), which leaves
`.btn:active` as the only press state. iOS Safari withholds `:active` until it
has decided the touch is not the start of a scroll, and every menu lives inside
`.screen` — `overflow-y: auto`, `touch-action: pan-y`. For a quick tap the
verdict routinely lands after the finger has lifted, so the button never moves.
A delegated `pointerdown` adds `.pressed`, which shares one rule with `:active`
so the two cannot drift.

**The click and the buzz.** `sfx.uiClick()` was wired per button in
`js/main.js`, so every control wired anywhere else was silent — the whole
ACCOUNT screen. Both now come from the delegated listener. `uiClick()` drops a
repeat inside 120ms so the buttons that still call it themselves do not double
up.

**The result.** `uiToast()` is fixed to the VIEWPORT. The ACCOUNT sheet is far
taller than a phone and its `#acct-status` line sits at the bottom of it, so a
confirmation for a button in the middle of the scroll was written several
hundred pixels below the fold. The inline line stays as the record; the toast
is the half that gets read.

Plus the two states a button needs about itself: `flashLabel()` (COPY becomes
COPIED, original remembered so hammering cannot latch it) and `busy()` (label +
disabled + pulse, returns the function that ends it — call that in *both*
branches). `.btn:disabled` did not exist at all before this, so `disabled = true`
changed nothing on screen: `#btn-claim:disabled` predates it, keeps its own
tuning, and opts out of the general rule's opacity.

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

### The gateway walk

The fallback chain is the single point of failure for every Primo image on
screen, and it has now failed three times in three different ways. What it looks
like each time is identical and gives nothing away: the hand-drawn stand-ins on
the menu, grey squares in the browser, nothing in the console.

**Count operators, not URLs.** `GATEWAYS` in `js/primo-picker.js` read as four
entries and was two: `ipfs.io` and `dweb.link` are one Protocol Labs backend
behind one per-IP rate limiter, so they refuse together; `w3s.link` and
`nftstorage.link` are both Storacha, and neither pins this collection. A single
throttle therefore ended the walk. The list is six now — the same set
`scripts/harvest-primos.mjs` round-robins, which is the set with evidence behind
it — ordered so consecutive attempts always change operator.

**The walk remembers.** A gateway that fails is benched (five minutes for a 429
or 5xx, one minute otherwise) and the one that last answered is tried first. This
is not a nicety: a dead gateway holds the connection for the full 9s fence rather
than failing fast, so a chain walked from the top for every image made a 20-tile
page pay that fence twenty times per dead gateway, four deep, at eight concurrent
— while `CREW_ART_GRACE` (900ms) had long since painted the cartoons. Now the
discovery cost is paid once per session. Cooling gateways are demoted, never
dropped, so a chain where everything is benched still tries everything.

**The walk hedges.** The dominant gateway failure is not an error, it is a
stall: the connection is accepted and then held while a block is chased, and
only the fence ends it. A strictly sequential chain therefore spends its whole
budget on one dead member while five live ones wait behind it — and widening the
list to six made the worst case *longer*, 54s at a 9s fence, which is no better
than never for someone looking at a menu. `walkGateways` starts the next gateway
alongside the current one after `HEDGE_MS` (2.5s) instead of waiting it out;
first answer wins and the losers are cancelled. A stall costs 2.5s, a
merely-slow gateway can still win its own race, and the all-stall worst case
lands near 16s rather than 54s.

Each attempt carries its **own** `AbortController`. The winner's `Response` is
headers-only at the moment the losers are cancelled — its body has not been read
— so cancelling through a shared signal would abort the very bytes about to be
baked and cached.

**A 200 is not proof of an image.** Gateways answer with HTML — block-not-found
pages, queue interstitials — at status 200. Failing to bake that is harmless;
*caching* it is not, because `primos-art-v1` is keyed on the CID and would answer
every future load on that device with the same undecodable bytes, permanently.
`fetchArt` checks the content type before storing, and `loadPrimoArt` evicts bytes
it holds that will not bake.

**When the whole chain fails, say so.** Every layer below `fetchArt` degrades
gracefully on purpose, and the sum of that is an outage with an empty console.
One `console.warn` names the CID and dumps `gatewayHealth()`.

`dev/art-cache-test.html` exercises all of the above with `fetch` stubbed to a
local PNG, so none of it needs a real gateway to misbehave to be reproducible.

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
- `dev/rig-test.html` for the character's pose, `dev/head-test.html` for the
  traits on its head, `dev/items-test.html` for props and shop icons.

There is no CI test job. These four pages are the test suite.
