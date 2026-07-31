// Painted body parts, driven by the procedural skeleton.
//
// This is the standard 2D cut-out rig: the art is authored once as isolated
// limb pieces, and the animation comes from placing each piece between two
// solved joints. That gets painted-quality art AND exact joint registration,
// which neither pre-rendered frames nor pure procedural drawing manage alone.
//
// Everything degrades gracefully — if the PNGs are missing or still loading,
// runner.js falls back to drawing the body procedurally.

// Painted props obey the same affordance language as the procedural ones, so
// the ground half of the dodge rule comes straight from props.js rather than
// being re-typed here — one set of flasher colours, one rule. props.js imports
// nothing from this file, so there is no cycle.
import { coldSpill } from './props.js';

// Resolved against this module, not the page, so dev/ harnesses load it too.
const BASE = new URL('../../art/', import.meta.url).href;

/**
 * Per-part rig data: where the two joints sit INSIDE the art, as fractions of
 * the trimmed image (0,0 = top-left). The generated pieces are posed at
 * natural angles rather than axis-aligned, so a top-centre/bottom-centre
 * assumption skews them — both pivots need an x as well as a y.
 *
 * `bulk` scales the art's own aspect: 1 keeps it undistorted.
 * Tuned by eye against dev/rig-test.html.
 */
export const PART = {
  // `by` 0.80 (not the bottom of the art) so the shirt hem hangs BELOW the hip
  // joint rather than stopping at it.
  torso:    { ax: 0.50, ay: 0.075, bx: 0.50, by: 0.885, bulk: 1.26 },
  upperarm: { ax: 0.55, ay: 0.075, bx: 0.33, by: 0.905, bulk: 0.92 },
  forearm:  { ax: 0.55, ay: 0.055, bx: 0.44, by: 0.880, bulk: 0.92 },
  thigh:    { ax: 0.40, ay: 0.050, bx: 0.56, by: 0.950, bulk: 0.96 },
  shin:     { ax: 0.46, ay: 0.055, bx: 0.50, by: 0.930, bulk: 0.96 },
  shoe:     { ax: 0.30, ay: 0.260, bx: 0.84, by: 0.720, bulk: 1.00 },
};

/**
 * Painted props. Unlike body parts these are independent — a missing one just
 * falls back to the procedural drawing for that single prop.
 *
 * Fields beyond `art`/`size`/`centred` all exist to put painted art under the
 * same affordance language as the procedural props in props.js:
 *
 *   rim    Colour of the silhouette stamp drawn behind the sprite. Warm =
 *          sunlight, and your body gets past this thing. Cold = flasher light,
 *          and it does not. See `stamp` for how the silhouette is extracted.
 *   halo   Three flat disc colours behind a pickup, outermost first.
 *   pool   Spill on the asphalt under a floating pickup. At distance this is
 *          the only cue for which LANE the thing is in.
 *   lamp   [x, y] of the painted light bar as fractions of the drawn box (x
 *          from centre, y up from the base), so the flasher can actually flash.
 *   maxW   Cap on drawn width, as a multiple of the HITBOX width.
 *   fit    How to obey `maxW`: 'squash' (default) or 'crop'.
 *
 * `maxW` is load bearing, not polish. Painted art is authored on its own
 * bounding box and width follows the art's aspect, which for the fence works
 * out at 3.07 world units of drawn wall for a 0.99u hitbox — nearly the whole
 * 4.1u alley. Every border chunk in world.js spawns two walls and leaves one
 * lane open, and at that width the second wall paints straight over the gap the
 * chunk left you. You cannot dodge into a lane you cannot see.
 *
 * The fence crops rather than squashes because squashing 3.07u down to 1.3u
 * puts 21 bollards inside ~78px, which aliases into moiré at any distance;
 * cropping keeps the slats their real width and just shows fewer of them. The
 * barricade and the cruiser only need ~15%, which squashes invisibly.
 */
export const PROP_ART = {
  // Pickups are drawn larger than their hitbox on purpose: the hitbox is
  // generous by design (see the loose dy test in game.collide), and readable
  // collectibles matter more than a 1:1 match.
  beer: {
    size: 1.55, centred: true, rim: 'rgba(255,238,190,1)',
    halo: ['rgba(255,178,40,0.14)', 'rgba(255,206,84,0.17)', 'rgba(255,238,176,0.24)'],
    pool: 'rgba(255,196,86,0.20)',
  },
  taco: {
    size: 1.95, centred: true, rim: 'rgba(255,244,200,1)',
    halo: ['rgba(150,220,70,0.14)', 'rgba(198,238,98,0.17)', 'rgba(242,255,186,0.24)'],
    pool: 'rgba(176,232,96,0.20)',
  },
  // `lamp` measured off the trimmed art: the barricade's bar sits at rows
  // 1..25 of 363 centred on x 0.405, the cruiser's at 0.25h centred on x 0.394.
  checkpoint: { art: 'barricade', rim: 'rgba(176,214,255,1)', maxW: 1.5, lamp: [-0.095, 0.96] },
  border: { art: 'borderwall', rim: 'rgba(176,214,255,1)', maxW: 1.36, fit: 'crop' },
  copcar: { art: 'copcar', rim: 'rgba(176,214,255,1)', maxW: 1.55, lamp: [-0.106, 0.745] },
  dumpster: { art: 'dumpster', rim: 'rgba(255,206,140,1)' },
};

/**
 * Rim strength per kind. Pickups shout; a jumpable only needs its edge back.
 *
 * Kept this low because the three stamps overlap: at 0.5 each the corners
 * composite to 0.88 and the result stops being a rim light and starts being a
 * selection outline, which is the exact line between art and debug UI.
 */
const RIM_ALPHA = { pickup: 0.45, power: 0.45, jump: 0.34, slide: 0.34, dodge: 0.36 };

const images = new Map();
const props = new Map();
const rims = new Map();
let state = 'idle';   // idle | loading | ready | missing

export function spritesReady() {
  return state === 'ready';
}

export function sprite(name) {
  return images.get(name) || null;
}

/**
 * Kick off loading. Resolves true only if EVERY part loaded — a partial set
 * would mix painted and procedural limbs on one body, which looks worse than
 * either alone.
 */
export function loadSprites() {
  if (state !== 'idle') return Promise.resolve(state === 'ready');
  state = 'loading';

  const names = Object.keys(PART);
  return Promise.all(names.map((name) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { images.set(name, mip(img, 192)); resolve(true); };
    img.onerror = () => resolve(false);
    img.src = `${BASE}${name}.png`;
  }))).then((results) => {
    const ok = results.every(Boolean);
    state = ok ? 'ready' : 'missing';
    if (!ok) images.clear();
    return ok;
  });
}

/** Load painted props. Each is optional and resolves independently. */
export function loadProps() {
  for (const [type, cfg] of Object.entries(PROP_ART)) {
    const file = cfg.art || type;
    const img = new Image();
    img.onload = () => {
      const clean = mip(dekey(img), 256);
      props.set(type, clean);
      if (cfg.rim) rims.set(type, stamp(clean, cfg.rim));
    };
    img.src = `${BASE}${file}.png`;
  }
}

export function propSprite(type) {
  return props.get(type) || null;
}

/**
 * Second pass over gen_art.py's chroma key.
 *
 * The key runs on pure green and leaves anything the studio light turned
 * yellow-green behind: the beer keeps a 13px chartreuse halo all the way round
 * the bottle, and the cruiser keeps a lump of the green screen's own hot spot
 * floating off its roof. Both are the brightest thing on a prop that is
 * supposed to read at speed.
 *
 * A colour threshold alone cannot do this — the beer's gold cap and the taco's
 * cilantro are legitimately greener than parts of the residue. What separates
 * them is topology: residue is connected to the outside of the image and the
 * subject is not. So this floods in from the border through transparent and
 * green-screen pixels and clears only what it can reach, which leaves anything
 * enclosed by the subject alone no matter what colour it is.
 *
 * The threshold is g - b, and 95 is the number: every residue pixel measured on
 * all six props clears it and the beer's own glass (74) does not.
 */
const KEY_GB = 95;

function dekey(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return img;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);

  let px;
  try {
    px = x.getImageData(0, 0, w, h);
  } catch {
    return img;   // tainted canvas: keep the art as it came
  }
  const d = px.data;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;

  const isBg = (i) => {
    const o = i * 4;
    return d[o + 3] < 8 || d[o + 1] - d[o + 2] > KEY_GB;
  };
  const push = (i) => {
    if (!seen[i] && isBg(i)) { seen[i] = 1; queue[tail++] = i; }
  };
  for (let i = 0; i < w; i++) { push(i); push((h - 1) * w + i); }
  for (let j = 0; j < h; j++) { push(j * w); push(j * w + w - 1); }

  while (head < tail) {
    const i = queue[head++];
    d[i * 4 + 3] = 0;
    const cx = i % w, cy = (i / w) | 0;
    if (cx > 0) push(i - 1);
    if (cx < w - 1) push(i + 1);
    if (cy > 0) push(i - w);
    if (cy < h - 1) push(i + w);
  }
  x.putImageData(px, 0, 0);
  return c;
}

/**
 * Flat-colour copy of a sprite's own silhouette, built once at load.
 *
 * Canvas cannot tint a drawImage, so a rim light on painted art has to come
 * from somewhere — drawing this stamp two or three times at small offsets
 * behind the sprite gives an edge that hugs the real silhouette exactly, for
 * the price of a few extra drawImage calls and no per-frame work at all.
 */
function stamp(img, colour) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, w, h);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = colour;
  x.fillRect(0, 0, w, h);
  return c;
}

const TAU = Math.PI * 2;

/**
 * Draw a painted prop standing on the ground at (sx, sy).
 *
 * Scaled to the prop's world height so it matches its own hitbox — width
 * follows the art's aspect rather than the hitbox's, because the collision box
 * is a lane-width abstraction and the art is not, except where that runs away
 * with itself and hides a lane (see `maxW` on PROP_ART).
 *
 * @param {number} u pixels per world unit at this depth
 * @param {object} o the world object ({ h, w, y, kind, seed })
 */
export function drawPropSprite(ctx, img, sx, sy, u, o, t) {
  const cfg = PROP_ART[o.type] || {};
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const h = o.h * u * (cfg.size || 1);
  // Ground props stand on sy; floating pickups are centred on it instead.
  const base = cfg.centred ? sy + h / 2 : sy;

  let w = h * (iw / ih);
  let sx0 = 0, sw = iw;
  if (cfg.maxW) {
    const cap = o.w * u * cfg.maxW;
    if (w > cap) {
      if (cfg.fit === 'crop') {
        sw = iw * (cap / w);
        sx0 = (iw - sw) * 0.5;
      }
      w = cap;
    }
  }

  const bob = o.kind === 'pickup' || o.kind === 'power'
    ? Math.sin(t * 3 + o.seed) * h * 0.07 : 0;
  const x = sx - w / 2;
  const y = base - h + bob;

  if (cfg.halo) {
    // Warm pool on the asphalt first. render.js hands us sy already lifted by
    // `o.y`, so putting it back finds the road again — which matters, because
    // pickups get lifted to arc over obstacles and a pool that rode up with
    // them would stop meaning "this lane".
    ctx.fillStyle = cfg.pool;
    ctx.beginPath();
    ctx.ellipse(sx, sy + o.y * u, w * 0.85, w * 0.26, 0, 0, TAU);
    ctx.fill();
    // Halo as three flat discs rather than a createRadialGradient per pickup
    // per frame: at this size the banding is invisible and nothing allocates.
    const cy = base - h * 0.5 + bob;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = cfg.halo[i];
      ctx.beginPath();
      ctx.arc(sx, cy, h * 0.95 * (1 - i * 0.27), 0, TAU);
      ctx.fill();
    }
  } else {
    // Dodge rule, ground half: cold flasher spill on the road first, since it
    // is light and everything else sits in it.
    const dodge = o.kind === 'dodge';
    const beat = Math.floor(t * 6 + o.seed) % 2 === 0;
    if (dodge) coldSpill(ctx, sx, base, w * 0.8, cfg.lamp ? (beat ? 0 : 1) : 2);

    // contact shadow so it isn't pasted onto the asphalt
    ctx.save();
    ctx.globalAlpha *= 0.42;
    ctx.fillStyle = '#140a1c';
    ctx.beginPath();
    ctx.ellipse(sx, base, w * 0.46, h * 0.09, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (dodge) {
      // Then the footing, standing in that shadow rather than under it, and cut
      // 6% wider than the art so a lip of it shows either side. The lip is the
      // whole point: it says the thing is cast into the road, not resting on it.
      const th = Math.max(2, u * 0.075);
      ctx.fillStyle = '#17141f';
      ctx.fillRect(sx - w * 0.53, base - th, w * 1.06, th);
      ctx.fillStyle = 'rgba(150,192,244,0.3)';
      ctx.fillRect(sx - w * 0.53, base - th, w * 1.06, th * 0.26);
    }
  }

  // Rim: the sprite's own silhouette in flat colour, offset behind it. Three
  // stamps, and the one pushed straight up carries most of the weight, because
  // the sun is low and behind the runner — the shoulders of a thing catch it
  // and the flanks only graze it.
  const rim = rims.get(o.type);
  if (rim) {
    const d = Math.max(1.2, h * 0.015);
    const a = (RIM_ALPHA[o.kind] || 0.34) * ctx.globalAlpha;
    ctx.save();
    ctx.globalAlpha = a * 0.55;
    ctx.drawImage(rim, sx0, 0, sw, ih, x - d, y - d, w, h);
    ctx.drawImage(rim, sx0, 0, sw, ih, x + d, y - d, w, h);
    ctx.globalAlpha = a;
    ctx.drawImage(rim, sx0, 0, sw, ih, x, y - d * 1.6, w, h);
    ctx.restore();
  }

  ctx.drawImage(img, sx0, 0, sw, ih, x, y, w, h);

  // Dodge rule, light half. The painted light bar is a still frame — both lamps
  // are already in the art — so all that is missing is the flash, which goes on
  // as a glow that alternates colour and side over the lamp the art put there.
  // It never goes dark between beats: a bar that blinks out spends half its
  // time not saying "police", and that is the half a guessing player needs.
  if (cfg.lamp) {
    const beat = Math.floor(t * 6 + o.seed) % 2 === 0;
    const lx = sx + cfg.lamp[0] * w;
    const ly = base - cfg.lamp[1] * h;
    ctx.save();
    ctx.fillStyle = beat ? '#ff3b3b' : '#3f60ff';
    ctx.globalAlpha *= 0.19;
    ctx.beginPath();
    ctx.arc(lx, ly, h * 0.3, 0, TAU);
    ctx.fill();
    ctx.globalAlpha *= 2;
    ctx.beginPath();
    ctx.arc(lx + (beat ? -w * 0.06 : w * 0.06), ly, h * 0.14, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Pre-shrink by repeated halving.
 *
 * The whole runner is only ~130px tall in game, so a 530px source would be
 * minified ~14x in one step. Canvas does a single bilinear tap when it
 * downsamples, which turns a plaid shirt into crawling noise as the limb
 * moves. Halving repeatedly averages every source pixel in properly.
 */
function mip(img, targetMax) {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) <= targetMax) return img;

  let src = img;
  while (Math.max(w, h) > targetMax * 2) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w / 2));
    c.height = Math.max(1, Math.round(h / 2));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c; w = c.width; h = c.height;
  }
  const k = targetMax / Math.max(w, h);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * k));
  out.height = Math.max(1, Math.round(h * k));
  const ox = out.getContext('2d');
  ox.imageSmoothingQuality = 'high';
  ox.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/**
 * Draw a part so its two pivots land exactly on joints `a` and `b`.
 *
 * @param {{x:number,y:number}} a proximal joint (top of the art)
 * @param {{x:number,y:number}} b distal joint (bottom of the art)
 * @param {number} H  full body height in px, for width scaling
 * @param {number} widthScale extra width multiplier (perspective foreshortening)
 * @param {number} flip -1 mirrors the art horizontally (left vs right limb)
 * @param {number} dim  1 = full light, <1 knocks the limb back into shadow
 */
export function drawPart(ctx, name, a, b, H, widthScale = 1, flip = 1, dim = 1) {
  const img = images.get(name);
  if (!img) return false;
  const cfg = PART[name];

  const iw = img.width, ih = img.height;
  // Joint positions inside the art, in art pixels.
  const p0x = (flip < 0 ? 1 - cfg.ax : cfg.ax) * iw;
  const p0y = cfg.ay * ih;
  const p1x = (flip < 0 ? 1 - cfg.bx : cfg.bx) * iw;
  const p1y = cfg.by * ih;

  const avx = p1x - p0x, avy = p1y - p0y;
  const artLen = Math.hypot(avx, avy);
  const svx = b.x - a.x, svy = b.y - a.y;
  const scrLen = Math.hypot(svx, svy);
  if (artLen < 0.01 || scrLen < 0.01) return true;

  // Similarity transform taking the art's two joints onto the skeleton's.
  const scale = scrLen / artLen;
  const angle = Math.atan2(svy, svx) - Math.atan2(avy, avx);

  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(angle);
  // widthScale squashes ACROSS the limb (perspective foreshortening); it is
  // applied after the rotation so it acts in the limb's own frame.
  ctx.scale(scale * cfg.bulk * widthScale, scale * cfg.bulk);
  ctx.translate(-p0x, -p0y);
  if (flip < 0) {
    // Mirror about the art's centre line. p0x/p1x were already mirrored above,
    // so this lands the same anatomical joint on the same skeleton joint.
    ctx.translate(iw, 0);
    ctx.scale(-1, 1);
  }
  if (dim < 1) {
    // Canvas has no per-draw tint. ctx.filter is the cheap way to push a limb
    // into shadow; where it is unsupported, alpha at least separates depth.
    if (HAS_FILTER) ctx.filter = `brightness(${dim}) saturate(${0.7 + dim * 0.3})`;
    else ctx.globalAlpha = 0.55 + dim * 0.45;
  }
  ctx.drawImage(img, 0, 0, iw, ih);
  ctx.restore();
  return true;
}

const HAS_FILTER = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.filter = 'brightness(0.5)';
    return c.filter !== 'none';
  } catch {
    return false;
  }
})();
