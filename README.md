# PRIMOS: BARRIO RUN

An endless runner down Los Angeles alleyways, starring the
[Primos](https://magiceden.us/marketplace/primos) collection.

Grab chelas, eat tacos for stamina, dodge police checkpoints and border walls,
and stay ahead of ICE.

**Play: <https://corrupt.solutions/games/primos/>**

Vanilla ES modules + canvas 2D. **No build step, no framework, no bundler** —
open `index.html` on a static server and it runs. Installable as a PWA.

> Unofficial fan project, not affiliated with the Primos collection.
> No collection artwork is stored in this repo — a player's Primo is fetched
> from public IPFS, in their browser, at their request. See
> [Running as a real Primo](#running-as-a-real-primo).

## Play

```bash
python3 -m http.server 4177
```

Then open <http://localhost:4177>.

| input | action |
|---|---|
| swipe ← → / arrows / A D | change lane |
| swipe ↑ / space / W | jump |
| swipe ↓ / S | slide |
| tap | jump |
| Esc / P | pause · M mute |

## The rules

- **Chelas** (beers) are the score *and* the currency. Consecutive pickups build
  a multiplier; crashing resets it.
- **Tacos** refill stamina. Stamina drains faster the faster you run — at zero
  you gas out, your speed halves, and the cruiser reels you in. This is the
  main thing separating the run from Subway Surfers: you cannot just dodge, you
  have to eat.
- **Police checkpoints**, **border walls** and **cruisers** are taller than the
  jump apex by design (see `RUN.jumpV` in `js/config.js`) — lane changes are the
  only honest answer. Dumpsters, crates and cones are jumpable; laundry lines
  and taco-shop awnings must be slid under.
- **ICE** is a pressure meter, not instant death. A crash adds ~46; clean
  running bleeds it off. Fill it and you are caught.
- Power-ups: **Piñata Magnet** (pulls chelas in), **Chancla Rush** (invincible
  speed burst that flattens obstacles), **Lowrider** (hoverboard that eats one
  crash and jumps higher).
- **La Tiendita** is Corrupt's corner store. A good run pays 25–45 chelas and the
  shelf runs 20–55, so everything is priced against one run. Running is the only
  way to get chelas — there is no payment sheet anywhere in this game.
- Caught? Corrupt makes an offer. A continue costs `25 × 2ⁿ` and **never stops
  doubling**. It buys more alley and never buys score.

Full tuning rationale in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Documentation

| doc | what's in it |
|---|---|
| [BUILD_OVERVIEW.md](docs/BUILD_OVERVIEW.md) | architecture, boot order, the render pipeline, the character rig, the world generator |
| [GAME_DESIGN.md](docs/GAME_DESIGN.md) | every rule and every number, with the reasoning |
| [CLOUD_AND_LEADERBOARDS.md](docs/CLOUD_AND_LEADERBOARDS.md) | cloud save, sign-in, boards, invites, the merge, migrations |
| [ANALYTICS.md](docs/ANALYTICS.md) | the event pipe, the admin dashboard, what is collected and what is not |
| [FEEDBACK.md](docs/FEEDBACK.md) | the suggestion box: Corrupt on HELP, the guard, the triage queue |
| [GO_LIVE_CHECKLIST.md](docs/GO_LIVE_CHECKLIST.md) | what must be true before and after a deploy |

## Layout

| path | role |
|---|---|
| `index.html` | shell + DOM menus |
| `js/main.js` | bootstrap, loop, menus, persistence |
| `js/game.js` | rules: movement, stamina, chase, scoring, collision |
| `js/world.js` | chunk-based alley generator — hand-authored, always fair |
| `js/render.js` | painter's-algorithm scene renderer |
| `js/camera.js` | pseudo-3D projection + camera juice |
| `js/config.js` | every tunable |
| `js/hud.js` | in-run HUD (canvas) |
| `js/perf.js` | DPR cap + dynamic render scale |
| `js/tutorial.js` | first-run training — the escuela del callejón |
| `js/i18n.js` | every word the game says, EN + ES |
| `js/art/runner.js` | the Primo: skeleton, run cycle, toon-3D body |
| `js/art/head-back.js` | the back of the head, drawn from trait fields |
| `js/art/primo-head.js` | turns a Primo PFP into a head sprite |
| `js/art/scenery.js` | sky, alley walls, fixtures |
| `js/art/props.js` | procedural props (obstacles + pickups) |
| `js/art/ice.js` | the ICE units — the rig for later levels |
| `js/store.js` | localStorage + backup code — the **authoritative** save |
| `js/wallet.js` · `js/tiendita.js` | chelas, the shelf, the continue offer |
| `js/cloud.js` · `js/merge.js` | Google sign-in, cloud save, the reconciliation |
| `js/leaderboard.js` · `js/boards.js` | daily/weekly boards and the screen |
| `js/referrals.js` | invite codes, qualification, rewards |
| `js/analytics.js` | the event pipe |
| `js/feedback.js` | the suggestion box — what players write to Corrupt |
| `js/primo-cache.js` | the local art cache — each Primo downloaded once, ever |
| `js/account.js` | ACCOUNT — sign-in, race name, backup, invites, privacy |
| `stats.html` · `js/stats/` | the admin analytics dashboard |
| `dev/rig-test.html` | character pose harness — iterate here, not in-game |
| `dev/cloud-test.html` | in-browser assertions for every pure module |
| `scripts/gen_art.py` | generates art via Gemini, chroma-keys it |
| `scripts/harvest-primos.mjs` | builds `data/primos-index.json` |
| `scripts/make-icons.js` | renders the PWA icons (zero deps) |
| `scripts/verify-rls.sh` | RLS audit — run after any migration |

## How the character works

Subway Surfers characters are a single skinned 3D mesh, which is why their
limbs never come apart. 2D cut-outs cannot reproduce that — parts either abut
or overlap, and both read as loose pieces.

So the body is **actually 3D**. `js/art/runner.js` solves a skeleton in local 3D
(x lateral, y up, z forward) from a keyframed run cycle, then renders each bone
as a chain of overlapping spheres, depth-sorted back to front. Joints share
spheres, so the surface is continuous by construction. Each bone fills its
spheres from one shared screen-space gradient, so consecutive circles blend
into a smooth shaded tube instead of a string of beads.

Two things that are easy to get wrong and were:

- **Limbs swing in depth, not across the screen.** Running seen from behind is
  almost entirely a z-axis motion. Rotating limbs in the image plane reads as
  doing the splits.
- **Depth tilt fights the heel kick.** Project depth too strongly (`TILT`) and
  the foot rises in world space exactly as much as depth pushes it back down
  the screen — the legs go visually dead. `TILT` is deliberately low and `YAW`
  carries the readability instead.

The **head** is a separate sprite so it can be a real Primo — and it faces
**forward**, away from the camera (`js/art/head-back.js`). The baked front-facing
sprite is still what the menu tiles and the HUD badge use, because those do look
at you.

## Running as a real Primo

The menu takes a Primo number, or any image URL, or a local file.

- `data/primos-index.json` maps Primo number → IPFS CID. It holds **URLs only**
  — no artwork. All **3,069 tokens**, ~167KB.
- It is built offline by `scripts/harvest-primos.mjs`, which reads the
  collection's on-chain Metaplex metadata URI via Solana RPC to find the pinned
  IPFS directory, then walks `<dir>/<n>.json` across a pool of gateways.
  **Magic Eden is not involved** — its API could only ever reach ~520 of 3,069,
  because it serves ~150 listings, caps `activities` near a thousand records, and
  an activity only exists for a token that has *traded*.
- **The collection is numbered 0–3068, not 1–3069.** Token #0 exists.
- `js/art/primo-head.js` crops the head out of the 1080² bust, feathers away
  the photographic background, samples the outfit colours off the shirt, and
  bakes backlighting into the sprite.
- `ipfs.io` sends `access-control-allow-origin: *`, so the image loads untainted
  and its pixels can be read. `cloudflare-ipfs.com` is dead and must not go back
  in the list. Gateways *stall* rather than erroring, so every fetch through one
  needs its own timeout.

Nothing is uploaded anywhere; the chosen image lives in `localStorage`.

## Cloud save, boards and invites

Optional, and **the layer ships dormant** — with `js/cloud-config.js` empty,
sign-in, sync, the boards and invites all no-op, supabase-js is never even
fetched, and the game runs local-only. Device backup/restore in ACCOUNT works
either way, on purpose.

Signed in with Google, progress follows the player to a new phone and survives a
cleared browser, and their best run lands on a **daily** board (resets midnight
UTC) that rolls up into a **weekly** season ranked by the sum of daily bests.

Two rules that are enforced in three places each and must not be relaxed: **a
display name may never be derived from the email**, and **the save stays
authoritative** — the cloud is a mirror. See
[docs/CLOUD_AND_LEADERBOARDS.md](docs/CLOUD_AND_LEADERBOARDS.md).

## Analytics

First-party, no third-party trackers. An append-only event log the client can
write and **not read**, an anonymous random device id (never a fingerprint), a
working opt-out in ACCOUNT, and an admin-gated dashboard at `stats.html`. Ships
dormant with the rest of the cloud layer. See
[docs/ANALYTICS.md](docs/ANALYTICS.md).

## Telling Corrupt

Tap Corrupt's face on the HOW TO PLAY sheet and you get a box: glitch, idea, or
other. It goes to an append-only table nobody but the owner can read, carrying
your message, which build you are on and an anonymous device id — nothing else,
and not your email unless you type it in the optional reply field. The run stays
paused while you write, so reporting a bug can never cost the run that produced
it. Reports land at the top of `stats.html`, where they can be marked read.
Rate limited in the database, not just in the client. See
[docs/FEEDBACK.md](docs/FEEDBACK.md).

## Regenerating art

Body parts and props are generated with Gemini and chroma-keyed:

```bash
source ~/.gemini_env && python3 scripts/gen_art.py parts
source ~/.gemini_env && python3 scripts/gen_art.py props
```

Needs `GEMINI_API_KEY` and Pillow. Output lands in `art/`. The API only returns
JPEG, so every asset is generated on a pure green field and keyed out locally.

Icons are dependency-free — they rasterise into a buffer and hand-encode a PNG:

```bash
node scripts/make-icons.js
```

## Checks

There is no CI test job. These are the test suite:

```bash
for f in js/*.js js/art/*.js js/stats/*.js; do cp "$f" /tmp/x.mjs; node --check /tmp/x.mjs || echo "FAIL $f"; done
```

- `dev/cloud-test.html` — every pure module, asserted in the browser.
- `dev/rig-test.html` — the character, whole run cycle side by side.
- `scripts/verify-rls.sh` — the live RLS posture, after any migration.

## Notes

- **Bump `CACHE_VERSION` in `sw.js` on every deploy**, and `APP_VERSION` in
  `js/version.js` with it. The service worker is network-first for navigations
  but stale-while-revalidate for assets; without the bump, players keep the old
  JS.
- `dev/rig-test.html` and `dev/cloud-test.html` cache-bust their imports on
  purpose — `python3 -m http.server` answers with `Last-Modified` and browsers
  happily reuse a stale ES module, which silently shows you the previous build.
  The game and `stats.html` do **not**.
- Migrations are applied **by hand**; CI never applies them. Merging to `main`
  and applying to production are two separate acts.
