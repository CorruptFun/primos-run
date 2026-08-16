// Turns a Primo into a head sprite the runner can wear.
//
// Real collection art is loaded live from the public IPFS gateway (which sends
// `access-control-allow-origin: *`, so the canvas stays untainted and we can
// read pixels). Nothing from the collection is stored in this repo — only the
// player's own image, in their own browser.

import { drawPrimoPortrait } from './runner.js';

const SIZE = 256;

// Where the head sits inside a 1080x1080 Primo bust, as fractions of the
// source. Measured against the collection's fixed composition.
// SQUARE, or faces come out stretched — the sprite is square, so the crop must
// be too. Sized to hold hair, hats and chin across the collection.
const CROP = { x: 0.170, y: 0.055, size: 0.700 };
// Soft mask over the crop, in sprite pixels. Feathered hard enough that the
// grainy photo backgrounds these PFPs sit on fade out instead of leaving a
// speckled ring around the hair.
const MASK = { cx: 128, cy: 132, rx: 96, ry: 104, feather: 12 };

// Bands sampled for outfit colour. Taken as a MEDIAN, not a mean: the
// collection puts a candy sticker over the bottom-right of the chest and an
// average drags the whole flannel toward it.
const SHIRT_BAND = { x0: 0.17, x1: 0.83, y0: 0.79, y1: 0.97, skipMid: 0.10 };
const SKIN_PTS = [[0.68, 0.58], [0.63, 0.66], [0.36, 0.60], [0.70, 0.50], [0.34, 0.52]];
// Crown of the head. Whatever sits here — hair, a cap, a bandana, a hood — is
// what the TOP of the head should be made of, so it is sampled without trying to
// decide which of those it is.
//
// These used to sit at y 0.11-0.16, which is ABOVE the head in the collection's
// composition: it was sampling the grainy shop photo these PFPs are pasted onto,
// which is why so many runners came out wearing a muddy brown that appears
// nowhere on their Primo. The head starts around y 0.20.
const CROWN_PTS = [[0.50, 0.24], [0.44, 0.26], [0.56, 0.26], [0.50, 0.30], [0.46, 0.22]];
// The composition is not fixed across the collection and the backdrop is a
// different photo every time, so the backdrop is measured rather than assumed
// and any sample that lands on it is thrown away.
const BG_PTS = [[0.03, 0.05], [0.97, 0.05], [0.05, 0.28], [0.95, 0.28]];

// A second sample beside the face, to tell a cap apart from the hair under it,
// was tried across the collection and abandoned. Framing varies enough Primo to
// Primo that the side points land on hair, on a shoulder or on the backdrop
// roughly at random, and one bad sample is worse than none: #4 came back with a
// pale grey "hair" that rendered as a blindfold across the head. The crown is
// the one point that is reliably ON the character, so it is the only one taken,
// and head-back.js pushes the cap and the hair apart by VALUE instead of asking
// the image a question it cannot answer.

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, x: c.getContext('2d', { willReadFrequently: true }) };
}

/**
 * Build a head sprite from a loaded image.
 * @returns {{head: HTMLCanvasElement, shirt: string, shirtDark: string, skin: string, skinDark: string}}
 */
export function headFromImage(img) {
  const { c, x: ctx } = canvas2d(SIZE, SIZE);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;

  const side = CROP.size * Math.min(sw, sh);
  ctx.drawImage(
    img,
    CROP.x * sw, CROP.y * sh, side, side,
    0, 0, SIZE, SIZE
  );

  // Feathered elliptical cutout: keeps hair and chin, drops the busy
  // photographic background these PFPs sit on.
  ctx.globalCompositeOperation = 'destination-in';
  if (typeof ctx.filter === 'string') ctx.filter = `blur(${MASK.feather}px)`;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(MASK.cx, MASK.cy, MASK.rx, MASK.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Twice: squaring the feather crushes its long low-alpha tail toward zero,
  // which is what leaves a faint rectangle of leftover PFP background floating
  // around the hair. The opaque core is unaffected.
  ctx.fill();
  ctx.filter = 'none';
  shadeHead(ctx);
  ctx.globalCompositeOperation = 'source-over';

  const palette = samplePalette(img, sw, sh);
  return { head: c, ...palette };
}

/**
 * Light the head to match the scene: the runner is heading into a low sun, so
 * they are backlit — warm rim down both edges, cool shadow through the middle,
 * and the collar's occlusion under the chin. Baked once, free every frame.
 */
function shadeHead(ctx) {
  ctx.globalCompositeOperation = 'source-atop';

  // Kept restrained: the mask's feathered edge is semi-transparent, so a
  // strong warm stop out here paints a glowing halo around the hair.
  const across = ctx.createLinearGradient(0, 0, SIZE, 0);
  across.addColorStop(0.00, 'rgba(255,178,112,0.30)');
  across.addColorStop(0.22, 'rgba(255,178,112,0.00)');
  across.addColorStop(0.50, 'rgba(30,16,44,0.24)');
  across.addColorStop(0.78, 'rgba(255,178,112,0.00)');
  across.addColorStop(1.00, 'rgba(255,178,112,0.30)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const down = ctx.createLinearGradient(0, 0, 0, SIZE);
  down.addColorStop(0.00, 'rgba(255,206,150,0.30)');   // sky catch on the crown
  down.addColorStop(0.42, 'rgba(0,0,0,0)');
  down.addColorStop(1.00, 'rgba(24,12,34,0.42)');      // shadow into the collar
  ctx.fillStyle = down;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

/** Render one of the built-in code-drawn crew into the same sprite format. */
export function headFromCharacter(ch) {
  const { c, x: ctx } = canvas2d(SIZE, SIZE);
  // drawPrimoPortrait draws head + shoulders; push the shoulders below the
  // frame so only the head survives, matching the image path.
  ctx.save();
  ctx.translate(0, 12);
  drawPrimoPortrait(ctx, SIZE / 2, SIZE * 0.52, SIZE * 0.82, ch, {});
  ctx.restore();

  ctx.globalCompositeOperation = 'destination-in';
  if (typeof ctx.filter === 'string') ctx.filter = 'blur(5px)';
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(SIZE / 2, 124, 104, 112, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = 'none';
  shadeHead(ctx);
  ctx.globalCompositeOperation = 'source-over';

  return {
    head: c,
    shirt: ch.shirt,
    shirtDark: ch.shirtDark,
    skin: ch.skin,
    skinDark: ch.skinDark,
    // Traits the runner's back-of-head is built from. The baked sprite above is
    // still used for the menu tiles and the HUD badge, which face the player.
    hair: ch.hair,
    hairDark: ch.hairDark || null,
    hairLight: ch.hairLight || null,
    cap: ch.cap || null,
    hairStyle: ch.hairStyle,
    bandana: ch.bandana,
    beanie: ch.beanie,
    hoops: ch.hoops,
    shades: ch.shades,
  };
}

// ------------------------------------------------------------------ palette

function samplePalette(img, sw, sh) {
  const fallback = {
    shirt: '#3c5f9e', shirtDark: '#28406d',
    skin: '#b9784e', skinDark: '#96593a',
    hair: '#221a1e', hairDark: '#150f12', hairLight: '#3d2f34',
    cap: '#1b1b24',
    hairStyle: 'messy',
  };
  try {
    const { x: ctx } = canvas2d(sw, sh);
    ctx.drawImage(img, 0, 0);
    let shirt = medianBand(ctx, sw, sh, SHIRT_BAND);
    const skin = averageAt(ctx, sw, sh, SKIN_PTS, isSkinLike);

    // Backdrop first, then reject anything that looks like it. The PFPs sit on
    // photographs, and a sample that lands on one is worse than no sample: it
    // gives a plausible-looking colour that belongs to a shop shelf.
    const bg = averageAt(ctx, sw, sh, BG_PTS, null);
    const notBg = bg ? (r, g, b) => dist(r, g, b, bg) > 46 : null;
    const crown = medianAt(ctx, sw, sh, CROWN_PTS, notBg);
    const hair = crown;
    const cap = crown;
    // A near-grey sample means we landed on a white tee or a washed plaid, not
    // the shirt's actual colour — a grey runner reads as a smudge in game.
    if (shirt) {
      const mx = Math.max(...shirt), mn = Math.min(...shirt);
      if (mx < 40 || (mx ? (mx - mn) / mx : 0) < 0.13) shirt = null;
    }
    return {
      shirt: shirt ? rgb(shirt) : fallback.shirt,
      shirtDark: shirt ? rgb(shade(shirt, 0.62)) : fallback.shirtDark,
      skin: skin ? rgb(skin) : fallback.skin,
      skinDark: skin ? rgb(shade(skin, 0.78)) : fallback.skinDark,
      hair: hair ? rgb(hair) : fallback.hair,
      hairDark: hair ? rgb(shade(hair, 0.6)) : fallback.hairDark,
      // Clamped up rather than scaled: near-black hair scaled by 1.5 is still
      // near-black, and the crown sheen would never show.
      hairLight: hair ? rgb(lift(hair, 46)) : fallback.hairLight,
      cap: cap ? rgb(cap) : fallback.cap,
      hairStyle: 'messy',
    };
  } catch {
    // Tainted canvas (a gateway without CORS) — the head still draws fine.
    return fallback;
  }
}

/**
 * Median colour over a band of the image, skipping a vertical strip down the
 * middle (that's the white tee, not the flannel). Median beats mean here
 * because stickers, buttons and logos are bright local outliers.
 */
function medianBand(ctx, sw, sh, band) {
  const rs = [], gs = [], bs = [];
  const STEPS = 9;
  for (let i = 0; i < STEPS; i++) {
    const fx = band.x0 + (band.x1 - band.x0) * (i / (STEPS - 1));
    if (Math.abs(fx - 0.5) < band.skipMid) continue;
    for (let j = 0; j < STEPS; j++) {
      const fy = band.y0 + (band.y1 - band.y0) * (j / (STEPS - 1));
      const px = Math.min(sw - 1, Math.max(0, Math.floor(fx * sw)));
      const py = Math.min(sh - 1, Math.max(0, Math.floor(fy * sh)));
      const d = ctx.getImageData(px, py, 1, 1).data;
      if (d[3] < 200) continue;
      rs.push(d[0]); gs.push(d[1]); bs.push(d[2]);
    }
  }
  if (!rs.length) return null;
  // Bias to the more saturated half of the samples: a plaid's pale threads are
  // as numerous as its dyed ones, and a plain median lands on the washed-out
  // squares rather than the colour a person would name the shirt.
  const sat = rs.map((_, i) => {
    const mx = Math.max(rs[i], gs[i], bs[i]), mn = Math.min(rs[i], gs[i], bs[i]);
    return { i, s: mx ? (mx - mn) / mx : 0 };
  }).sort((a, b) => b.s - a.s);
  const keep = sat.slice(0, Math.max(3, Math.ceil(sat.length / 2))).map((o) => o.i);
  const mid = (arr) => {
    const a = keep.map((i) => arr[i]).sort((x, y) => x - y);
    return a[a.length >> 1];
  };
  return [mid(rs), mid(gs), mid(bs)];
}

/**
 * Median colour over a handful of points, rejecting whatever `accept` turns
 * down. Median rather than mean because these points straddle edges — one
 * sample landing on a highlight or an outline drags an average somewhere the
 * colour never actually was.
 */
function medianAt(ctx, sw, sh, points, accept) {
  const rs = [], gs = [], bs = [];
  for (const [fx, fy] of points) {
    const px = Math.min(sw - 3, Math.max(0, Math.floor(fx * sw)));
    const py = Math.min(sh - 3, Math.max(0, Math.floor(fy * sh)));
    const d = ctx.getImageData(px, py, 3, 3).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const k = d.length / 4;
    r /= k; g /= k; b /= k;
    if (accept && !accept(r, g, b)) continue;
    rs.push(r); gs.push(g); bs.push(b);
  }
  if (!rs.length) return null;
  const mid = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  return [mid(rs), mid(gs), mid(bs)];
}

function dist(r, g, b, c) {
  return Math.hypot(r - c[0], g - c[1], b - c[2]);
}

function averageAt(ctx, sw, sh, points, accept) {
  let r = 0, g = 0, b = 0, n = 0;
  for (const [fx, fy] of points) {
    const px = Math.min(sw - 3, Math.max(0, Math.floor(fx * sw)));
    const py = Math.min(sh - 3, Math.max(0, Math.floor(fy * sh)));
    const d = ctx.getImageData(px, py, 3, 3).data;
    let rr = 0, gg = 0, bb = 0;
    for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
    const k = d.length / 4;
    rr /= k; gg /= k; bb /= k;
    if (accept && !accept(rr, gg, bb)) continue;
    r += rr; g += gg; b += bb; n++;
  }
  if (!n) return null;
  return [r / n, g / n, b / n];
}

function isSkinLike(r, g, b) {
  // Primos skins run brown through red — reject grey, near-black and blue.
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return r >= g && g >= b - 12 && max > 55 && max - min > 14;
}

const shade = ([r, g, b], k) => [r * k, g * k, b * k];
const lift = ([r, g, b], n) => [Math.min(255, r + n), Math.min(255, g + n), Math.min(255, b + n)];
const rgb = ([r, g, b]) =>
  `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/** Load an image URL into a head sprite. Resolves null on failure. */
export function loadHead(src) {
  return new Promise((resolve) => {
    const img = new Image();
    // Needed so getImageData works on the gateway response.
    //
    // ⚠ NOT for a blob: URL, which is where most loads now come from since
    // js/primo-cache.js started handing out cached bytes. A blob minted by this
    // document is already same-origin and never taints a canvas, so the
    // attribute buys nothing — and it is not free: it puts the load through the
    // CORS path, which WebKit has historically failed outright for blob: URLs.
    // That failure mode is invisible on desktop Chromium and total on iOS, and
    // it looks exactly like the art not loading. Same shape as the
    // `aspect-ratio`-on-a-button bug in the Primo grid.
    if (typeof src === 'string' && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        resolve({ head: headFromImage(img), img });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      // Retry without CORS: the head still renders, we just lose colour
      // sampling and fall back to the default flannel.
      const plain = new Image();
      plain.onload = () => {
        try { resolve({ head: headFromImage(plain), img: plain }); }
        catch { resolve(null); }
      };
      plain.onerror = () => resolve(null);
      plain.src = src;
    };
    img.src = src;
  });
}
