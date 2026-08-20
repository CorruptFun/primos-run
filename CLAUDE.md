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

- **A hair cut or a hat in `head-back.js` is ONE PATH, filled once.** Every
  extra shape a cut adds — a spike, a bushy lobe, a cap's adjuster notch — is a
  subpath of the same path, unioned by nonzero winding. Paint one on top
  instead and it stays flat under the cel light pass while the crown goes
  lighter around it, and a few flat marks high on an egg are a pair of eyes: the
  head grows a face, which is the one thing that file exists to prevent. The
  sheen is on its third attempt for exactly this reason and is now a tapered
  band following the crown, because a *blob* says nothing about which way a
  surface turns and two of them say "eyes".

- **The traits separate by SILHOUETTE. Detail inside the shape is noise.** At
  75px across, the cap's script mark read as a scribble, the beanie path's knit
  ribbing turned every Black Bandana into a barrel, and three ruled lines down a
  mullet made it a wooden keg. What distinguishes eleven hats is a notch, a
  crease, a hem, a brim, a pair of tails. Judge it in `dev/head-test.html`,
  which shows every trait at once — one at a time in `rig-test.html` is how a
  batch of them shipped unreadable.

- **A HORN IS WIDE AT THE ROOT AND POINTED AT THE TIP, AND THE FIRST ONE WAS
  BUILT UPSIDE DOWN.** Both edges of the old blade met at a single point where
  it joined the skull and it was still 0.18rx across at the tip — no root to
  grow out of, no point to end in — so what stood on the crown was a pair of
  parallel slivers: the insect antenna its own comment said it must never be.
  The outline is a SPINE now, with the half-width driven to zero along it, so
  outer edge and inner edge are one curve offset by a width that can only
  shrink and the taper cannot be got backwards again. It also has to CURVE:
  the first fix tapered correctly but swept straight up, and a tapering
  triangle at the top corner of a round head is a CAT'S EAR whatever colour it
  is drawn in — the two growth rings low on it promptly became the fold inside
  one, which is how far the eye will go to finish that picture. They are gone.
  **Horns are the ONE piece of headwear drawn UNDER the hair**, because they
  grow out of the skull rather than sit on it; laid on top, a root wide enough
  to read shows its base as a straight cut across the crown.

- **A KEYLINE ON A NARROW SHAPE IS ONE FLAT FILL, NEVER A `cel()` PASS.**
  `cel()` offsets its lit copy by `LX`/`LY` of the whole head box, which on
  something a few pixels across lands the pale tone almost entirely OUTSIDE the
  shape. The horns shipped with `cel(build(g), { base: hat.light, dark: RIM })`
  as their backlight and what that draws is a salmon ghost hanging off one side
  of each horn — at gameplay size the ghost is a third horn, and it is the pale
  drooping crescents in every screenshot of the bug. Grow the path, fill it once
  in `RIM`, let the horn's own `cel()` supply the light.

- **The sheen is gated on `capped`, not on "is there a hat".** A visor and a
  pair of horns both leave the crown WIDE OPEN — that is the whole point of
  both, and `capped` already says so — but the gate read `!capCol`, so those two
  traits were the only bare crowns in the collection denied the one pass that
  guarantees a light value on the head. They rendered as the featureless dark
  blob the top of this file exists to prevent.

- **`primo-traits.js` hands over structure; the PFP sampler hands over colour.**
  Earrings carry a `kind` as well as a colour (`hoop`/`stud`/`drop`) because
  eight names all rendered as the same gold hoop otherwise. The earring is drawn
  on ONE ear, last, overlapping the head — a matched pair at the two edges of a
  dark oval is another face, and drawn before the hair the hair covers the half
  that says "this hangs off an ear".

- **THE FOCAL LENGTH IS CAPPED AGAINST HEIGHT, AND WITHOUT THAT CAP THE RUNNER
  WALKS OFF THE BOTTOM OF EVERY DESKTOP.** `baseFocal` was `w * CAM.focal` —
  width and nothing else — so the runner's on-screen size scaled with WIDTH
  while the frame it had to fit in was the HEIGHT. Tuned to ~21% of frame
  height on a phone in portrait, the same camera measured 63% on a 1280x800
  laptop, 70% at 1080p, 85% on a phone in landscape and 94% on an ultrawide,
  with the feet projected to 128–170% — i.e. the legs, the slide and the
  skateboard stance were all off-screen on every landscape device. `CAM.focalH`
  (1.00, against height) is the ceiling. It BINDS ONLY PAST ~4:3, so every
  portrait phone keeps the exact framing the camera was tuned against —
  verified by `capBinding: false` at 375x812 — and everything from a 844x390
  phone in landscape to a 2560x1080 ultrawide settles on one framing: runner
  34% of height, feet at 87%, wall tops still above the frame so the alley
  stays enclosed. Judge any change to this at BOTH aspects; one of them is
  always lying to you about the other.

- **RESOLUTION IS NOT THE LEVER. PATH COUNT IS.** `MOBILE.scaleMin` /
  `dprCap` / the whole `perf.js` ladder shed PIXELS, and pixels are close to
  free here: measured against a frozen late-game frame, an eighth of the pixels
  (1280x800 -> 448x280) bought 1.9%, inside the noise, on both a desktop and a
  phone viewport. The frame is ~2,300 fills and strokes and it is the per-path
  setup that costs, not the area covered. So a struggling device today gets a
  soft picture and the same frame rate. Anything that actually helps has to
  draw FEWER PATHS — `DRESS_ALPHA` in `js/art/scenery.js` is the worked
  example, and `js/config.js`'s MOBILE block carries the measurement and the
  caveat (it was taken on desktop Skia, never on a real phone).

- **THE WALLS ARE THE FRAME BUDGET — half of it.** Phase-timed at 1280x800:
  walls 51%, of which the per-kind dressing alone is 25% of the whole frame;
  then blit 13%, HUD 8%, skyline 7%, props 7%, sky 4%, ground 4%. Everything
  else rounds to nothing. Optimise anything but `drawWallSegment` and its
  `kind*` helpers and you are polishing the 4%. The dressing is already
  LOD-thinned per tier — what it was missing was that past the haze it kept
  drawing sub-pixel detail under a fog wash that had taken more than half of it
  away, which is what `DRESS_ALPHA` cuts. That gate is on the fog ALPHA, not a
  distance, so it stays honest if `FOG_START` or `DRAW_DIST` move.

- **EVERY BURST IN THE GAME GOES OFF AT THE PLAYER'S OWN PLANE, WHICH IS THE
  BIGGEST SCALE IN THE SCENE.** A pickup is collected where the player is
  standing, a smash lands on their chest, the landing puff is under their feet —
  all eight `burst()` sites in `game.js` plus `dust()` are within a unit of
  `player.z`, so `CAM.back`'s 4.25u is not the far case for particles, it is the
  only one. A 0.13u spark projects to sixty-odd pixels there, and eighteen of
  them spawned on ONE point draw as ONE opaque square: the hard-edged flat slab
  of powerup colour over the runner's neck on the frame a powerup is collected
  (`#ff4d9d` magnet, `#9ee34f` taco). `SIZE_NEAR` and `LEAD` in
  `js/particles.js` are the guard, and both halves are needed — capped but
  coincident is a smaller slab, spread but uncapped is sparks the size of the
  head. **It was NOT `drawProps`'s `dz < 2.6` cull**, which is the natural
  reading and is wrong twice over: that guard says CAMERA and means it, and
  `takePickup` sets `dead` before `renderScene` ever sees the frame, so the
  collected prop is not drawn at all. Raising it toward `CAM.back` would make an
  obstacle vanish beside the runner mid-collision and fix nothing.
  `dev/frame-probe.js` stops on that frame; `probe.blob()` scores FILL RATIO,
  because a burst and a slab differ in coverage, not in pixel count.

- **A COLLISION TEST THAT SAMPLES A WINDOW IS FRAME-RATE DEPENDENT, AND THIS
  GAME MOVES FAST ENOUGH FOR THAT TO MATTER.** The drone shipped asking whether
  it was within 0.6u of the player on the frame it was sampled, while closing at
  `DRONE.approach` *plus* the player's own speed — ~58 u/s. That is 1.45u of
  travel in a 40fps frame against a 1.2u window, so **below ~45fps the drone
  could not hit anyone**, and `drones` scored the non-event as a dodge feeding a
  jale. It is a crossing test now (`gap <= 0`, latched once per pass), which is
  correct at any step size. `collide()` has the same exposure at the `dt` clamp
  (1/20 against a 1.55u prop window at `RUN.maxSpeed`) and floors its z window at
  the distance covered that frame — the term is inert above ~24fps, so feel is
  untouched. `scripts/verify-chunks.mjs` prints the geometry these depend on; any
  new hazard that moves toward the player needs the same treatment.

- **Checkpoints, border walls and cruisers cannot be jumped, by design.** Their
  heights are set above the jump apex deliberately (`RUN.jumpV` in `config.js`,
  and the comment on `PROP_SPEC` in `js/art/props.js`). Lane changes are the
  answer. Dumpsters/crates/cones are jumpable; clotheslines/awnings need a slide.

- **The skateboard powerup was `lowrider` until v16 and the shelf remembers.**
  A shelf is `{ itemId: count }` in the player's save and NOTHING validates it
  against the catalog: `cleanShelf` keeps any key, `takeStock` hands every key
  to `loadoutFor()`, and `loadoutFor` ignores an id it does not know. So the
  rename does not error anywhere — it silently bins a 55-chela item off the
  shelf of everyone who bought one. `RENAMED` in `js/wallet.js` is what carries
  it across, and it is the pattern for any future id change.

  `poseRide()` in `runner.js` is **inverse-kinematics against the deck**: both
  ankles solve to y = 0.02, where `drawBoard()` in `render.js` puts the plate.
  Change `hipY` and all four leg angles have to be re-solved — they are not
  numbers to nudge. The stagger is paid in z, not x, because the projection
  turns 0.26H of depth into ~0.09H across the screen. Corrupt still pulls up in
  a lowrider in `cont.body`; that is his car and it stays.

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

- **COUNT OPERATORS IN `GATEWAYS`, NOT URLS.** The list read as four gateways and
  was two: `ipfs.io` and `dweb.link` are both Protocol Labs behind ONE per-IP rate
  limiter and refuse together, and `w3s.link` + `nftstorage.link` are both Storacha
  (the latter the sunset NFT.Storage gateway), neither of which pins this
  collection. One throttle took out half the chain and the surviving half was the
  half least likely to hold Primos art — i.e. the whole chain, i.e. the stand-in
  cartoons stay on screen. The list is now six, ordered so consecutive attempts
  always change operator, and it matches the set `scripts/harvest-primos.mjs`
  round-robins — the one with evidence behind it, since it built the index.

- **THE FALLBACK CHAIN HAS A MEMORY NOW, AND IT IS NOT AN OPTIMISATION.** A dead
  gateway does not fail fast, it holds the connection for the full 9s fence. With
  a chain walked from the top for every image, a 20-tile page paid that fence
  twenty times per dead gateway — 36s a tile, four deep, at 8 concurrent, while
  `CREW_ART_GRACE` (900ms) had long since given up and painted cartoons. So
  `js/primo-cache.js` benches a gateway that fails (5 min for a 429/5xx, 1 min
  otherwise) and starts at whichever one last answered: the discovery cost is paid
  once per session, not once per image. Cooling gateways are DEMOTED, never
  dropped, so a chain where everything is cooling still tries everything.

- **THE WALK HEDGES, because the dominant gateway failure is a STALL.** A
  throttling gateway accepts the connection and holds it, so a strictly
  sequential chain spends its entire budget on one dead member while live ones
  sit untried — and widening the list to six made that *worse*: 6 × the 9s fence
  is 54s before a tile gives up, by which time the stand-ins have been on screen
  for a minute. `walkGateways` starts the next gateway alongside the current one
  after `HEDGE_MS` (2.5s) rather than waiting it out, first answer wins, losers
  are cancelled. A stall costs 2.5s instead of 9s and a merely-slow gateway can
  still win its own race. ⚠ Each attempt carries its OWN AbortController: the
  winner's Response is headers-only when the losers are cancelled, so a shared
  signal would abort the very body about to be baked and cached.

- **A 200 IS NOT PROOF OF AN IMAGE, and caching one that isn't is permanent.**
  Gateways serve HTML — block-not-found pages, queue interstitials — with a 200.
  Baking that fails harmlessly; *caching* it does not, because the bucket is keyed
  on the CID and answers every future load on that device with the same undecodable
  bytes, long after the gateway recovered. `fetchArt` content-type checks before
  storing, and `loadPrimoArt` calls `evict(cid)` when bytes it holds will not bake.

- **When the whole chain fails, `fetchArt` logs one line.** Every layer below it is
  a deliberate graceful degradation — a grey tile, a kept cartoon — and the sum of
  that politeness is an outage with nothing in the console, which is how all three
  previous art faults presented and why each cost a debugging session. Whole chain
  down is a fault, not a degradation. `gatewayHealth()` prints what the walk
  currently believes.

- **`loadHead` must NOT set `crossOrigin` on a `blob:` URL.** Most loads are blobs
  now that the cache serves them; a blob minted by this document is already
  same-origin and never taints a canvas, so the attribute buys nothing — and it
  routes the load through the CORS path, which WebKit has historically failed
  outright for `blob:`. Invisible on desktop Chromium, total on iOS. Same shape as
  the `aspect-ratio`-on-a-button bug in the Primo grid.

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

- **WITH THE GATE ON, THE CREW ROW IS THE WALLET, and the stranger draw must
  never show through it.** `crewOwned` (from the signed pass, via
  `readCrewOwned`) replaces the daily draw with the wallet's own tokens; slots
  beyond what it holds are HIDDEN, and an owned tile with no art yet keeps the
  neutral silhouette FOREVER rather than falling back to the cartoons — Rosa
  standing on a connected holder's menu was the shipped bug this exists to
  prevent. Three ordering traps: the boot draw runs before a first-connect pass
  exists, so `crewDraw` returns EMPTY behind a blocking gate and `gateEnter()`
  must call `refreshCrew()`; `crewNums` is seeded synchronously from the pass so
  a tile never spends the index fetch labelled ROSA; and a remembered
  `saved.character` can point at a slot the wallet does not fill, so every
  `selectCrew` restore goes through `slotLive()`. The browser walks OWNED-FIRST
  (`buildOrder` in `js/primo-browser.js`): the order array always holds all
  3,069 (moved, never duplicated), and every token→page mapping must go through
  `pageOf()`, never `n / PAGE_SIZE`.

- **`loadPrimoArt` must fetch each image ONCE.** Its first version baked from the
  gateway with an `<img>` and then re-fetched the same bytes to fill the cache:
  32 requests for a 24-tile page, i.e. a caching layer that doubled first-visit
  bandwidth to halve the second visit's. Go through `fetchArt` and bake from what
  it returns. The `<img>` walk that remains is the fallback for a gateway with no
  CORS headers, where `fetch` cannot serve at all.

- **`art/*.png` is generated, not hand-drawn.** `scripts/gen_art.py` calls
  Gemini and chroma-keys the result. `art/raw/` is gitignored.

## Run it

`.claude/launch.json` — **this repo's own, which overrides the one in
`~/Creative/`** — entry `primos-run`, port 4177. Use the preview tools, not
`python3` in a Bash call.

**That entry must invoke `scripts/dev-server.py`, and it silently did not.** It
was `python3 -m http.server 4177` — the exact stock server the harness section
below warns about — so *every* session in this repo was served heuristically
cacheable ES modules and shown the previous build after an edit. It cost a
debugging session: a verified-correct fix kept reproducing the bug, because the
page was still running the pre-edit module while `curl` and `fetch` both
returned the new file. **The tell is `Last-Modified` with no `Cache-Control`:**

```bash
curl -sI http://localhost:4177/js/game.js | grep -i "cache-control\|last-modified"
```

`no-store` and no `Last-Modified` means `dev-server.py`. Anything else means
something is squatting the port — check `lsof -nP -iTCP:4177 -sTCP:LISTEN`
before you debug a single line of code. A stray server from an earlier session
outlives that session and wins the port.

## Iterate on the character in the harness, not in-game

Two harnesses, and reaching for the wrong one is how the trait pass shipped
half-broken:

- **`dev/rig-test.html` — the POSE.** The whole run cycle plus air, slide, lean
  and the skateboard stance, with a live oversized view and a real Primo off
  IPFS. One Primo at a time, moving.
- **`dev/head-test.html` — the TRAITS.** Every hat, cut, hair colour, accessory
  and the collisions between them, all on screen together, on a size slider from
  gameplay to 2×. A hat that reads as a lump is only obvious beside the five
  that do not. `window.only('<section>')` collapses it to one row, because an
  automated browser screenshots the first viewport and never follows a scroll.

Both cache-bust their imports, and **`scripts/dev-server.py` serves `no-store`**
so the game does not need to. If an edit does not appear, check what is actually
listening on the port before debugging the code — a stray `python3 -m
http.server` squatting 4177 serves the same files WITH caching, and the symptom
is a file you just saved rendering as its previous version with nothing in the
console. The deployed game does not cache-bust either, so clear the service
worker (`primos-run-<CACHE_VERSION>`, whatever `sw.js` says) when testing there;
`pwa-register.js` skips registration on localhost, so a stale cache is a symptom
of having tested on a deploy.

## Layout

| path | role |
|---|---|
| `js/game.js` | rules: movement, stamina, chase, scoring, collision |
| `js/world.js` | chunk generator — chunks are hand-authored and always fair |
| `js/render.js` | scene renderer, painter's algorithm |
| `js/config.js` | every tunable lives here |
| `js/art/runner.js` | the POSES — run cycle, air, slide, the skateboard stance |
| `js/art/primo-runner.js` | projects a pose and paints the toon-3D body |
| `js/art/head-back.js` | the back of the head — every hat and cut, one path each |
| `js/art/primo-traits.js` | collection metadata → the fields head-back draws |
| `js/art/primo-head.js` | PFP → head sprite (crop, mask, palette, lighting) |
| `js/art/scenery.js` | sky + alley walls |
| `js/art/sprites.js` | painted cut-out rig (unused for the body) + prop sprites |
| `js/gate.js`, `wallet.html` | the NFT gate's door handle, and the mobile handoff page |
| `js/primo-cache.js` | the local art cache — fetch a Primo's pixels once per device |
| `js/store.js` | localStorage + backup code — the AUTHORITATIVE save |
| `js/cloud.js` | Google sign-in, cloud save pull/merge/push |
| `js/leaderboard.js` | board submit/read + the race-name rules |
| `js/referrals.js` | invite codes, `?ref=` capture, qualify + payout |
| `js/merge.js`, `js/raceday.js` | pure: save reconciliation, day/week keys |
| `js/racha.js`, `js/jales.js` | pure: daily streak + daily missions — see below |
| `js/particles.js` | pooled sparks + footfall dust — see the near guard at the top |
| `js/art/gear.js` | el fit draw code (shop icons + worn mask/chain) |
| `js/account.js`, `js/boards.js` | the ACCOUNT and LEADERBOARD screens |
| `js/ui-feedback.js` | what a DOM button does when pressed — see below |
| `js/analytics.js` | the event pipe — `track()`, crash telemetry, opt-out |
| `js/feedback.js` | the suggestion box — what players write to Corrupt |
| `js/version.js` | the build stamp. Bump WITH `sw.js`'s `CACHE_VERSION` |
| `stats.html`, `js/stats/` | the admin analytics dashboard (never precached) |
| `scripts/gen_art.py` | Gemini art generation + chroma key |
| `scripts/make-icons.js` | PWA icons, zero dependencies |
| `scripts/verify-rls.sh` | RLS audit — run after any migration |
| `scripts/verify-chunks.mjs` | alley fairness audit — the authoring rules, enforced |
| `press/` | the marketing pack — CTA banner, screenshots, share cards |
| `dev/marketing-shots.js` | capture harness — autopilots a real run, shoots the canvas |
| `scripts/capture-sink.py` | receives those PNGs (a 2880×1620 blob is too big to eval back) |
| `scripts/render-cards.mjs` | renders `press/render/card.html` to the static cards |

## El fit, la racha and los jales (the retention loop)

Design in `docs/GAME_DESIGN.md` → "El Fit" and "Coming back tomorrow". The
rules that will bite if rediscovered the hard way:

- **Every payout and the latch that says it was paid share ONE storage write.**
  Run takings, the racha bonus and jale rewards all land through
  `wallet.bankRun`'s single `writeEcon` in `fillGameOver()` — the settle
  callback stamps `racha`/`jales` on the same blob the deposit writes. Split
  that into deposit-then-stamp and a crash between the two (or a cloud push of
  the gap) re-opens the day and mints the bonus again. Same class of scar as
  `referralWelcomeClaimed`.
- **`gear`, `fit`, `fitSetAt`, `racha`, `jales` are all in `ECON_KEYS`** —
  written straight against storage, disk always beats a caller's boot-time
  copy. Remove one and the next mute-toggle `save()` silently reverts it.
- **Merge rules are not interchangeable.** `gear` unions (paid goods), `fit`
  rides its own timestamp like the handle (a preference), `racha` takes the
  LATER day — maxing lengths would resurrect a broken streak — and `jales`
  unions `done` per same-day only. Each has a stated reason in `js/merge.js`;
  swapping one for another compiles fine and mints or destroys quietly.
- **`jalesForDay(dayKey)` must stay pure and deterministic** — every player on
  earth draws the same three. It runs on the boards' UTC `dayKey`, never local
  midnight (double-dip by timezone otherwise).
- **The jales pool prices stats `game.js` counts** (`jumps`, `slides`,
  `smashes`, `powerups`, `bestMult`, …). Stop counting one and its mission
  becomes a permanently-stuck bar — which looks like a mission bug, not a
  game.js bug. `dev/cloud-test.html` pins the pool's stats against a run-stat
  bundle shape.
- **A worn mask deliberately replaces the hair/hat silhouette** (a balaclava
  over a fitted cap is two hats). The renderer draws `rig.fit.mask` INSTEAD of
  the head-back hair pass, not on top of it. Outfit colours still come off the
  player's PFP, on purpose — that identity trade is the player's to make.
- **Retention pays by RUNNING, never by showing up.** No login bonus, no claim
  button. If a future feature wants one, read the design chapter first — the
  streak resets are the loss-aversion hook and a claim button breaks the "no
  payment sheet, chelas in chelas out" honesty stance.
- **The ICE drone is TIME-gated (`DRONE.startTime`), lane-locked at the
  WARNING, and slide-clearable — all three are fairness, not flavour.** Gate it
  on distance and it arrives faster every minute survived (the pacing scar);
  let it retarget mid-dive and no dodge is guaranteed; raise `height` above
  the slide hitbox and one of the two taught verbs stops working. A strike
  goes through the same `hit()` as every prop — do not give it its own damage
  path. `reprieve()` cancels an event in flight, on purpose. The `drones`
  counter is passes DODGED (not hits) and a jale prices it — stop counting it
  and that mission bar sticks at zero forever.

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

## The NFT gate (`js/gate.js`, `wallet.html`, Edge Function, migrations `2026081x21xxxx`)

Hold a Primo in a Solana wallet or you do not get in. Full runbook in
`docs/NFT_GATE.md` — read it before touching any of this.

- **NO WALLET INJECTS A PROVIDER INTO MOBILE SAFARI OR MOBILE CHROME, AND THAT
  MADE THE PWA UNINSTALLABLE.** The gate's only mobile route was the wallet's own
  in-app browser, which has no Add to Home Screen — so turning the gate on took
  away the home screen icon for every phone player, and `#gate-none` told someone
  with Phantom on their home screen there was "no Solana wallet in this browser".
  The fix is the HANDOFF: a universal link into the wallet's browser
  (`wallet.html`), and the verdict collected back through the Edge Function.
- **THE VERDICT TRAVELS THROUGH THE BACKEND BECAUSE ON iOS NOTHING ELSE CAN.** A
  home screen web app is not a universal-link handler, so the wallet's redirect
  lands in Safari — and iOS gives the installed app its OWN storage jar, so a
  pass written on the way back is written where the app will never see it. Carry
  the answer in the return URL "because it is simpler" and it works on Android
  and silently never works on an installed iOS app. Once it goes through the
  server, WHERE the wallet hands back stops mattering at all, which is the
  property worth protecting.
- **THE NONCE TRAVELS, THE CLAIM TOKEN NEVER LEAVES THE DEVICE.** The nonce goes
  into another app's browser in a URL; the claim demands the nonce AND a random
  token that stayed home, and the database stores only its sha256. Put the token
  in the link and anyone who sees it collects somebody else's pass. Relatedly:
  **every miss on `claim` answers `pending`**, including wrong-token and expired
  — telling them apart makes the endpoint an oracle for live nonces.
- **NOTHING IS PARKED THAT IS A CREDENTIAL.** The obvious design stores the
  minted pass for the app to fetch; a pass is a bearer token for the door and one
  sitting in a row until the pruner runs has a lifetime nobody chose. The row
  holds the FINDING (wallet, count, tokens) and the pass is minted in the claim.
  Same for the one-time session token — generated for the collecting device,
  never stored for it.
- **`user_id` IS OMITTED, NEVER WRITTEN AS NULL, in `recordHolder`.** PostgREST
  only sets the columns present in the payload. Writing null instead means every
  handoff — which is signed from a context that is never logged in — silently
  unlinks a wallet from its Google account, and the board policy that asks "is
  this user a holder?" starts answering no for someone who plainly is. The
  account step is skipped on a handoff and done at COLLECT time for the same
  family of reason: the device that collects is the device that plays.
- **THE WALLET LINK IS A REAL `<a href>`, FETCHED BEFORE THE TAP, AND HAS NO
  `target="_blank"`.** iOS hands an https URL to an app only on a genuine link
  activation — a `location.href` set after an `await` has lost the gesture and
  opens the WEBSITE, dropping the player on phantom.app instead of in Phantom.
  `_blank` fails the same way via in-app browser sheets, which do not honour
  universal links. Losing the page when the wallet is absent is the accepted
  cost, and it is recoverable because the handoff is stored before they leave.
- **`refresh` IS WHAT STOPS THIS BEING A DAILY CHORE.** A pass lasts 24h and on
  iOS every renewal would be the whole app-switch trip again. A signed-in holder
  renews on their session with no wallet in the loop; the chain is still re-asked
  server-side, so a sold Primo still closes the door. It runs after
  `bootstrapCloud()` because there is no session before it.
- **`wallet.html` is skipped by `sw.js` outright, like `stats.html`.** Without
  the skip an offline navigation is answered with `cache.match("./")` — the GAME
  — so a player who tapped through to sign lands in a second copy of the game
  showing them the gate they were trying to get past.
- **Phantom is `/ul/browse/`, Solflare is `/ul/v1/browse/`.** Not the same path;
  copying one over the other 404s inside the wallet. Backpack publishes none, so
  it is offered only where it is injected.

- **`js/gate.js` IS A DOOR HANDLE, NOT A LOCK, and the distinction is the whole
  design.** The game is static files on a public host: anyone can download it,
  delete `gateFirst()` and play, and no client code can change that. What the
  Edge Function buys is that the CLAIM cannot be forged — nobody convinces the
  backend they hold a Primo when they do not — so everything server-side (the
  board today, whatever comes later) enforces it for real. Never describe the
  game itself as protected. Same distinction `claimStatus()` already draws.
- **The two migrations are split because the second one RESTRICTS.**
  `…210000` is additive and safe under the live ungated client. `…210001`
  tightens the board's write policies and must not be applied until the gated
  client has been out long enough for holders to verify — otherwise every
  legitimate score is silently refused. That inverts the usual "schema first,
  client second" rule and is exactly the scar Viva Maya's 0008 → client → 0009
  sequence paid for.
- **`verified` on the collection grouping is the entire ownership check.** Anyone
  can mint an NFT that *names* the Primos collection; only the collection
  authority can make that grouping verified. Drop that condition in
  `countPrimos()` and the gate opens for the price of a fake mint.
- **The nonce is claimed with a conditional UPDATE, never select-then-update.**
  Two requests racing the same nonce both pass a read-then-write; only one wins a
  single statement filtering `used_at is null`. Without it a captured
  `{wallet, nonce, signature}` is a reusable key to someone else's identity.
- **`primos_gate_nonces` has RLS on and NO policies, deliberately** — that denies
  every client, which is right for a table only the function touches. A browser
  that could mint or read a nonce could replay a signature. `primos_holders` is
  never client-writable for the same class of reason: writing there is asserting
  NFT ownership. Both are asserted by self-checks in the migration.
- **A chain outage is NOT a refusal.** The function fails closed with 502 and the
  client says `gate.chainDown`, never `gate.noPrimo`. Telling someone who paid
  for a Primo that they own nothing because an RPC blinked is the worst sentence
  this screen can produce; the two must never collapse into one message.
- **`getAssetsByOwner` is paged and the loop matters.** A wallet holding more than
  a page of *other* NFTs would push its Primos off page one and read as a
  non-holder. Do not "simplify" it to a single request.
- **The board's READ policy stays open on purpose.** A leaderboard only holders
  can see cannot advertise the collection. Gate the write; the read protects
  nothing and is the gate's only marketing surface.
- **No wallet address in the event log**, ever — `GATE_PASS`/`GATE_FAIL` carry a
  count and a reason. A wallet is a fingerprint on a public chain, the same rule
  `PRIMO_SET` follows for token numbers.
- **A PRIMO IN YOUR WALLET IS YOURS AND NOBODY ELSE'S, and the chain is what
  makes that free.** The Edge Function returns WHICH tokens a wallet holds, not
  just how many, signed into the pass — and since exactly one wallet can hold
  #2933, exclusivity needs no claims table, no uniqueness constraint and no
  reconciliation. This supersedes `data/primo-claims.json` wherever the gate is
  on; `claimStatus()` consults the gate first and the file only when it is off.
  `ownedTokens()` reads the SIGNED payload, never the convenience copy beside it
  — a console can overwrite a whole pass but cannot edit one, and editing is what
  someone would do to append a Primo they do not hold.
- **Unowned tiles are LOCKED, NOT HIDDEN.** All 3,069 stay browsable so the
  collection is still a shop window; you just cannot wear one that is not yours.
  Same reasoning as the board's open read policy. Hiding them would turn a
  3,069-piece collection into a private album.
- **`primos_owns_token()` exists and nothing calls it yet, on purpose.**
  `primoNumber` lives only in the local save, and the save table is the SHARED
  `public.game_saves` owned by another game — it must not grow Primos-specific
  policies. It is the seam for the day the board shows which Primo ran, which is
  the only surface where exclusivity is publicly observable.
- **`scripts/verify-gate.mjs` pins the grouping filter, and it is the one place
  in this project where a wrong answer is a security bug** rather than a
  cosmetic one: too strict refuses every genuine holder, too loose opens the
  gate for the price of a counterfeit mint. It runs offline against fixtures —
  `scripts/probe-gate.mjs <wallet>` is the same logic against a real key. Both
  are TWINS of `countPrimos()`/`tokenNumber()` in the Edge Function and must not
  drift; they cannot be shared, because that one is Deno and these are Node with
  no build step between them (same situation as `raceday.js` and its SQL copy).
- **DAS omits `verified` when it is TRUE.** So absence must not read as false —
  getting that backwards refuses every holder in the collection. Only an
  explicit `verified: false` is a counterfeit.
- `dev/gate-test.html` covers the client half with no wallet and no backend. It
  cannot test the part that matters, and says so at the top.

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

## Press feedback (`js/ui-feedback.js`)

Every DOM button's press, click, buzz and confirmation, delegated at the
document so a screen that wires its own controls cannot be born silent — which
is how the whole ACCOUNT screen was. Written up in `docs/BUILD_OVERVIEW.md`.

- **`.pressed` is not a duplicate of `:active`, it is the only one that fires on
  a phone.** iOS Safari withholds `:active` until it knows the touch is not a
  scroll, and every menu is inside `.screen` (`overflow-y: auto`,
  `touch-action: pan-y`), so on a quick tap the verdict arrives after the finger
  has gone and the button never moves. The body also sets
  `-webkit-tap-highlight-color: transparent` deliberately, so there is no OS
  flash underneath to save it. Both selectors share ONE rule per button family
  — keep it that way or the two presses drift.
- **`uiClick()` drops a repeat inside 120ms, and that is load bearing.**
  ui-feedback clicks on `pointerdown`; ~20 buttons in `js/main.js` also click in
  their own handler. Same gesture, twice, ~80ms apart — heard as a flam. Remove
  the guard and every menu button stutters.
- **The toast is fixed to the VIEWPORT, and centred by `left/right` + auto
  margins, never `left: 50%`** — a fixed box with no width shrinks to fit the
  space left of its containing block's right edge, so `left: 50%` silently caps
  it at half the screen and messages wrap for no visible reason.
- **`busy()` writes `textContent`**, so it is for buttons only. Point it at
  `.file-btn` and it deletes the hidden file input inside the label.
- `#btn-claim:disabled` predates the general `.btn:disabled` and carries
  `opacity: 1` to opt out of it. It is a shorter button with a 2px lip and its
  own tuning; without the opt-out the two dimmings stack.

## The interface has three containers, and the alert box is not one of them

The v18 UI pass stripped `border-left` accent bars from every status, note,
warning, payout row and the toast — nine instances of the stock callout-box
pattern, which bends visibly around rounded corners and belongs to a dashboard,
not this game. Do not reintroduce one "to make a message stand out"; pick from
the three surfaces the game already owns:

- **Recessed well** (inset shadow on near-black) — settings and inputs: the
  language switch, the URL rows, the browse grid, the till.
- **Tinted card** (colour at ~10% fill + ~30% hairline) — gold for *yours*
  (racha chip, payout rows, TELL CORRUPT, your board row and `.board-me`,
  owned shelf rows), red for *danger* (the help warning, the failed toast).
- **Pill** (999px) — chips and controls: the wallet chip, the toast, and
  `.tabs`, which is deliberately the SAME segmented control as `.lang` —
  TODAY/WEEK and GLITCH/IDEA/OTHER must never grow a second pick-one style.

Inline statuses (`#acct-status`, `#fb-status`, `#primo-status`, `.shop-note`)
are SPOKEN, not boxed: bold teal text, red under `.bad`, in the register
`.rank-line` set. The shop's per-item `--tone` lives on the icon plate
(`color-mix` frame + inner glow; neutral where unsupported, muted for free by
`.broke`'s grayscale) — never on a row edge. And the racha chip's count/label
gap is CSS (`#racha-len`'s margin), because the i18n swap rewrites the label's
textContent and eats any leading space a string carries.

## Checks

ES modules, so `node --check` needs an `.mjs` copy:

```bash
for f in js/*.js js/art/*.js js/stats/*.js; do cp "$f" /tmp/x.mjs; node --check /tmp/x.mjs || echo "FAIL $f"; done
```

`scripts/verify-chunks.mjs` enforces the alley's authoring rules, which until
now lived only in a doc comment and had been broken by hand twice:

```bash
node scripts/verify-chunks.mjs
```

Rows ≥8u apart and ≥9u across a verb change, no row shutting all three lanes, no
lane demanding a jump and a slide at once, no pickup out of reach or parked
inside a dodge prop — plus the geometry the verbs rest on (jump apex vs every
`jump` prop, slide box vs every `slide` prop, drone strike height between the
two). It exits non-zero, so it can gate a deploy. Run it after touching `CHUNKS`,
`PROP_SPEC`, `RUN`, `HITBOX` or `DRONE`. **The 2-lane-move warnings are known and
deliberate** — `zigzag-walls` is named for what it does — but a NEW one means a
tier-3 pattern got tighter than anything that shipped.

`dev/art-cache-test.html` drives the whole Primo art pipeline with `fetch` stubbed
to a local PNG — the gateway walk's ordering and health memory, the refusal to
cache a 200 that is not an image, eviction, and the blob → canvas bake staying
untainted. No network, so it reproduces offline the faults that previously needed
a real gateway to misbehave. Open it after touching `primo-cache.js`, `GATEWAYS`
or `loadHead`.

`dev/frame-probe.js` drives a real run to a frame you cannot press a key on —
`await probe.collect('magnet')` stops on the frame the pickup lands, `probe.blob()`
measures how solid one colour is there, `probe.sheet(8)` tiles the next eight
frames over the page because an automated browser shoots one viewport and cannot
scrub. Paste it into the console or `import('/dev/frame-probe.js')`. Reach for it
after touching `particles.js`, a `burst()` call, or anything drawn at the
player's own plane.

`dev/gate-test.html` covers the NFT gate's client half — base58, the pass store
and its expiry ceiling, wallet detection, and the mobile handoff (the claim token
never reaching the link, a conclusive answer ending the handoff, a timeout not
being read as a refusal, and `refresh` keeping 502 apart from "you hold none") —
with `fetch` and the wallet stubbed. It reads `gate.enabled()` rather than
pinning it: it used to assert the gate ships dormant, and went red the day it
went live while saying nothing about the code.

`dev/cloud-test.html` asserts every pure module in the browser — day/week keys,
the merge, name sanitising, the analytics vocabulary pin, the feedback bounds and
sanitisers, and the dashboard's rate math. 255 assertions. Open it after touching
`raceday.js`, `merge.js`, `store.js`, `leaderboard.js`, `referrals.js`,
`analytics.js`, `feedback.js` or `js/stats/`.

`window.__step(n, dt)` / `window.__draw()` on the game page are the seam for
driving the run headlessly at a CHOSEN frame rate — which is how the drone bug
was caught and how any future collision change should be checked. Stepping at
`dt = 1/20` and `1/60` and getting different outcomes is the whole signal.

**Bump `CACHE_VERSION` in `sw.js` on every deploy** or players keep stale JS —
and bump `APP_VERSION` in `js/version.js` in the same commit. If they drift,
`sw.js` is what players feel and `version.js` is what the dashboard reports, so
errors get attributed to the wrong build: precisely the panel you reach for when
something has just broken.
