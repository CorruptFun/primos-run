# PRIMOS: BARRIO RUN

An endless runner down Los Angeles alleyways, starring the
[Primos](https://magiceden.us/marketplace/primos) collection.

Grab chelas, eat tacos for stamina, dodge police checkpoints and border walls,
and stay ahead of La Migra.

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

- **Chelas** (beers) are the score. Consecutive pickups build a multiplier;
  crashing resets it.
- **Tacos** refill stamina. Stamina drains faster the faster you run — at zero
  you gas out, your speed halves, and the cruiser reels you in. This is the
  main thing separating the run from Subway Surfers: you cannot just dodge, you
  have to eat.
- **Police checkpoints**, **border walls** and **cruisers** are taller than the
  jump apex by design (see `RUN.jumpV` in `js/config.js`) — lane changes are the
  only honest answer. Dumpsters, crates and cones are jumpable; laundry lines
  and taqueria awnings must be slid under.
- **La Migra** is a pressure meter, not instant death. A crash adds ~46; clean
  running bleeds it off. Fill it and you are caught.
- Power-ups: **Piñata Magnet** (pulls chelas in), **Chancla Rush** (invincible
  speed burst that flattens obstacles), **Lowrider** (hoverboard that eats one
  crash and jumps higher).

## Layout

| path | role |
|---|---|
| `index.html` | shell + DOM menus |
| `js/main.js` | bootstrap, loop, menus, persistence |
| `js/game.js` | rules: movement, stamina, chase, scoring, collision |
| `js/world.js` | chunk-based alley generator — hand-authored, always fair |
| `js/render.js` | painter's-algorithm scene renderer |
| `js/camera.js` | pseudo-3D projection |
| `js/config.js` | every tunable |
| `js/hud.js` | in-run HUD (canvas) |
| `js/art/runner.js` | the Primo: skeleton, run cycle, toon-3D body |
| `js/art/primo-head.js` | turns a Primo PFP into a head sprite |
| `js/art/sprites.js` | painted-asset rig + prop sprites |
| `js/art/scenery.js` | sky and alley walls |
| `js/art/props.js` | procedural props (fallback + pickups) |
| `dev/rig-test.html` | character pose harness — iterate here, not in-game |
| `scripts/gen_art.py` | generates art via Gemini, chroma-keys it |
| `scripts/harvest-primos.mjs` | builds `data/primos-index.json` |
| `scripts/make-icons.js` | renders the PWA icons (zero deps) |

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

The **head** is a separate sprite so it can be a real Primo.

## Running as a real Primo

The menu takes a Primo number, or any image URL, or a local file.

- `data/primos-index.json` maps Primo number → IPFS CID. It holds **URLs only**
  — no artwork. Built by `scripts/harvest-primos.mjs` from Magic Eden's public
  API. Currently 520 of 3,069 (the API only exposes listed tokens plus recent
  activity); every other holder can paste their image URL, which always works.
- `js/art/primo-head.js` crops the head out of the 1080² bust, feathers away
  the photographic background, samples the outfit colours off the shirt, and
  bakes backlighting into the sprite.
- Magic Eden's API blocks browser CORS, which is why the index is built offline.
  `ipfs.io` *does* send `access-control-allow-origin: *`, so the image loads
  untainted and its pixels can be read.

Nothing is uploaded anywhere; the chosen image lives in `localStorage`.

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

## Notes

- **Bump `CACHE_VERSION` in `sw.js` on every deploy.** The service worker is
  network-first for navigations but stale-while-revalidate for assets; without
  the bump, players keep the old JS.
- `dev/rig-test.html` cache-busts its imports on purpose — `python3 -m
  http.server` answers with `Last-Modified` and browsers happily reuse a stale
  ES module, which silently shows you the previous build.
