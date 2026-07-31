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
| `js/store.js` | localStorage + backup code — the AUTHORITATIVE save |
| `js/cloud.js` | Google sign-in, cloud save pull/merge/push |
| `js/leaderboard.js` | board submit/read + the race-name rules |
| `js/merge.js`, `js/raceday.js` | pure: save reconciliation, day/week keys |
| `js/account.js`, `js/boards.js` | the ACCOUNT and LEADERBOARD screens |
| `scripts/gen_art.py` | Gemini art generation + chroma key |
| `scripts/make-icons.js` | PWA icons, zero dependencies |
| `scripts/verify-rls.sh` | RLS audit — run after any migration |

## Cloud save, sign-in and the boards

**It ships DORMANT.** `js/cloud-config.js` is empty, so sign-in, sync and the
boards all no-op and the game runs local-only — supabase-js is never even
fetched. Filling in the URL + anon key is what turns the whole layer on. Device
backup/restore in ACCOUNT works either way, on purpose.

Use the **`cloud-saves-and-leaderboards` skill** before changing anything
score-, board-, sign-in- or name-related. It is the distilled version of this
exact stack and most of what looks fussy in these files is a scar it explains.
`references/rollout.md` has the Google OAuth checklist — the redirect URI goes
to the *Supabase* callback, not the game's URL, which is the usual mistake.

Three things that will bite otherwise:

- **`js/raceday.js` and `js/leaderboard.js`'s `anonName` have byte-identical
  twins in the migration**, which validates every submission and *refuses to
  apply* if they drift. Change one side and you must change the other, plus the
  cases in `dev/cloud-test.html`.
- **A display name may never be derived from the email.** Enforced in the
  client, again in the guard trigger, and once more by a backfill — because
  cached PWA clients keep submitting for days after a deploy.
- **The guard skips its day check when the score doesn't rise.** That is what
  lets a rename reach closed boards. Restore the check on every write and
  scrubbing a name from history silently stops working.

Migrations are applied by hand; CI never applies them. So applying to production
and merging to `main` are two separate acts, and *the repo does not describe
production until both have happened*.

## Checks

ES modules, so `node --check` needs an `.mjs` copy:

```bash
for f in js/*.js js/art/*.js; do cp "$f" /tmp/x.mjs; node --check /tmp/x.mjs || echo "FAIL $f"; done
```

`dev/cloud-test.html` asserts the pure half of the cloud layer — day/week keys,
the merge, name sanitising — in the browser. Open it after touching
`raceday.js`, `merge.js`, `store.js` or `leaderboard.js`.

**Bump `CACHE_VERSION` in `sw.js` on every deploy** or players keep stale JS.
