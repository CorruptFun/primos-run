# Press & marketing assets

Everything here is generated from the live build. Nothing is a mockup: the
screenshots are frames the game actually rendered, and the score, multiplier,
chela count and distance on each HUD are a run that was actually played.

| file | what it is | where it goes |
|---|---|---|
| `banner.html` | the drop-in call-to-action banner | a page on corrupt.solutions |
| `banner-og-1200x630.png` | share card | `og:image` / `twitter:image` |
| `banner-square-1080.png` | square post | X, Instagram feed |
| `banner-wide-2400x800.png` | hero strip | a full-bleed band, if HTML is not an option |
| `shots/*.png` | 1290×2796 masters | anything |
| `web/*.jpg` | 645×1398, ~120 KB each | the banner, the site, embeds |
| `render/card.html` | the source the three cards are rendered from | — |

## The banner

Open `banner.html` in a browser to see it; it is a complete page so it can be
resized on its own. To ship it, copy everything between the two `PASTE` markers
— a `<style>` block and a `<section>` — into the host page.

Two things make it safe to drop into a site with its own design system:

- **Every selector is scoped under `.primos-cta`.** Nothing styles a bare
  element, so it cannot reach the host page's buttons, headings or images.
- **It sets no global reset and assumes no layout.** The section is an ordinary
  block; put it wherever a full-width band belongs.

It needs four images. Copy `press/web/` and `art/primos-logo.png` to wherever
the site serves static files, then repoint these four custom properties at the
top of the style block — they are the only paths in the file:

```css
--pc-mark:   url("/img/primos-logo.png");
--pc-shot-1: url("/img/01-jump.jpg");
--pc-shot-2: url("/img/02-drone.jpg");
--pc-shot-3: url("/img/03-rampage.jpg");
```

It responds at three widths: three phones on desktop, two under 1080px, and a
stacked column with a full-width button under 820px. The gold sweep on the
button is the only motion, and it is dropped under `prefers-reduced-motion`.

## The screenshots

Captured from `6f1161f` (`v28-wallet-handoff`). Still current: `v29` changed
only the menu, the Primo browser and the gate — no renderer, art, config, HUD or
world file — so these are the frames the shipped game draws.

| shot | what is happening |
|---|---|
| `01-jump` | mid-air over crates, a chela glowing ahead, taquería down the alley |
| `02-drone` | an ICE drone mid-dive, lamp lit, a border wall closing the lane behind |
| `03-rampage` | sliding under a rampage, a taco banked for fuel |
| `04-magnet` | beer magnet up, 239 chelas, a cruiser parked up the alley |
| `05-lanes` | three lanes open, laundry strung across, magnet running |
| `06-wall` | a border wall shutting a lane — one of the three that cannot be jumped |

**Shoot portrait.** The game's framing is tuned for a phone, and `CAM.focal`
multiplies canvas *width*, so a landscape window gives a much longer focal
length and the runner grows to most of the frame. Captures use an 860×1864 CSS
viewport — phone aspect at 2× — with `devicePixelRatio` pinned to 1.5, which is
exactly `MOBILE.dprCap`, so the scene buffer and the canvas match 1:1 at
1290×2796 with no upscale. The HUD scales as `min(W,H)/420`, so at 2× phone
size every HUD element keeps its true phone proportions.

**The slab on the pickup frame is fixed as of `v30-spark-guard`.** It is worth
knowing what it was, because the obvious diagnosis is wrong. On the frame a
powerup landed, a flat hard-edged square of the powerup's colour appeared across
the runner's neck and back (`#ff4d9d` magnet, `#9ee34f` taco). That is not a
prop drawn too close — `takePickup` marks the prop `dead` before `renderScene`
sees the frame, and `drawProps`'s `dz < 2.6` cull says CAMERA and means it. It
was the **particle burst**: every `burst()` site fires at the player's own
plane, which is the biggest scale in the scene, so eighteen sparks spawned on
one point each projected to sixty-odd pixels and painted as a single opaque
square. `SIZE_NEAR` and `LEAD` in `js/particles.js` are the guard now.

The six shots here were captured just before that fix, so `04-magnet` was
deliberately taken mid-duration rather than on the pickup frame, and all six
were scanned for a solid block of any powerup rim colour. None contain one. A
re-shoot on `v30` or later no longer needs to avoid the frame — and
`dev/frame-probe.js` is the tool for inspecting it, since it scores fill
*ratio*, which is what separates a burst from a slab.


Masters are PNG (~2.5 MB each, ~15 MB total). If that is too much to carry in
the repo, JPEG at q95 is visually lossless here — 46.9 dB PSNR, about a third
of the size:

```bash
cd press/shots && for f in *.png; do sips -s format jpeg -s formatOptions 95 "$f" --out "${f%.png}.jpg"; done
```

## Regenerating

The capture harness drives a real run with an autopilot rather than posing the
numbers, and steps at a fixed `dt` through `window.__step`/`__draw`, because an
automated browser runs the page hidden and `requestAnimationFrame` never fires.

```bash
python3 scripts/dev-server.py 4177 &
python3 scripts/capture-sink.py 4178 press/shots &
```

Then load `dev/marketing-shots.js` into the page and drive `window.__mk`
(`train`, `runTo`, `until`, `findShot`, `shoot`). The sink exists because a
2880×1620 PNG is several megabytes of base64 — too much to hand back through a
browser-automation eval — so the page POSTs the blob instead.

The three cards re-render from `render/card.html` with the dev server up:

```bash
node scripts/render-cards.mjs
```

They are rendered by headless Chrome at 2× and downsampled, not drawn with an
image library, so the wordmark's gold gradient, the font stack and the button
are laid out by the same engine as the game's. A second implementation of the
wordmark is exactly what a brand asset must not have.

## The copy is pitched at holders

The game is gated: `GATE_ENABLED` is `true` in `js/gate-config.js` and
`cloud-config.js` carries live credentials, so the alley opens only for a wallet
holding a Primo — "HOLDERS ONLY · This one is for the family." The banner and
the cards therefore say **CONNECT WALLET**, not "play free", and name the three
wallets the gate accepts. If the gate ever comes off, the strings to change are
the `.primos-cta__btn` label, the `.primos-cta__note` beside it, and the
`.primos-cta__gate` line — plus the same three in `render/card.html`.

Local capture needs the gate flipped off (`GATE_ENABLED = false`) and then
restored with `git checkout js/gate-config.js`. Restore it — a committed `false`
opens the game to everyone.

## The share card is still the old one

`index.html` points `og:image` at `og-image.png`, which is the wordmark on a
flat background — no gameplay. `banner-og-1200x630.png` is a drop-in
replacement at the same 1200×630 the meta tags already declare.

Swapping it is a **deploy**, not an edit: replacing the file changes the card
every existing share renders, and per the project rule any change that ships
needs `CACHE_VERSION` in `sw.js` and `APP_VERSION` in `js/version.js` bumped in
the same commit. That has bitten here before — the `summary_large_image` change
was meta-only, skipped the bump, and no existing player saw the new tags for
eight days.
