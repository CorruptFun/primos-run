# Primos: Barrio Run

Endless runner down LA alleyways starring the Primos Solana NFT collection.
Live repo: <https://github.com/CorruptFun/primos-run>

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

- **Magic Eden's API blocks browser CORS.** That is why `data/primos-index.json`
  is built offline by `scripts/harvest-primos.mjs`. `ipfs.io` *does* send
  `access-control-allow-origin: *`, so a player's Primo loads untainted and its
  pixels can be sampled for outfit colours.

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
worker (`primos-run-v1`) when testing there.

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
| `scripts/gen_art.py` | Gemini art generation + chroma key |
| `scripts/make-icons.js` | PWA icons, zero dependencies |

## Checks

ES modules, so `node --check` needs an `.mjs` copy:

```bash
for f in js/*.js js/art/*.js; do cp "$f" /tmp/x.mjs; node --check /tmp/x.mjs || echo "FAIL $f"; done
```

**Bump `CACHE_VERSION` in `sw.js` on every deploy** or players keep stale JS.
