// Painted body parts, driven by the procedural skeleton.
//
// This is the standard 2D cut-out rig: the art is authored once as isolated
// limb pieces, and the animation comes from placing each piece between two
// solved joints. That gets painted-quality art AND exact joint registration,
// which neither pre-rendered frames nor pure procedural drawing manage alone.
//
// Everything degrades gracefully — if the PNGs are missing or still loading,
// runner.js falls back to drawing the body procedurally.

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

// Painted props. Unlike body parts these are independent — a missing one just
// falls back to the procedural drawing for that single prop.
export const PROP_ART = {
  // Pickups are drawn larger than their hitbox on purpose: the hitbox is
  // generous by design (see the loose dy test in game.collide), and readable
  // collectibles matter more than a 1:1 match.
  beer: { size: 1.55, centred: true, glow: 'rgba(255,201,60,0.42)' },
  taco: { size: 1.95, centred: true, glow: 'rgba(158,227,79,0.40)' },
  checkpoint: { art: 'barricade' },
  border: { art: 'borderwall' },
  copcar: { art: 'copcar' },
  dumpster: { art: 'dumpster' },
};

const images = new Map();
const props = new Map();
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
    img.onload = () => props.set(type, mip(img, 256));
    img.src = `${BASE}${file}.png`;
  }
}

export function propSprite(type) {
  return props.get(type) || null;
}

/**
 * Draw a painted prop standing on the ground at (sx, sy).
 *
 * Scaled to the prop's world height so it matches its own hitbox — width
 * follows the art's aspect rather than the hitbox's, because the collision
 * box is a lane-width abstraction and the art is not.
 *
 * @param {number} u pixels per world unit at this depth
 * @param {object} o the world object ({ h, kind })
 */
export function drawPropSprite(ctx, img, sx, sy, u, o, t) {
  const cfg = PROP_ART[o.type] || {};
  const h = o.h * u * (cfg.size || 1);
  const w = h * (img.width / img.height);
  // Ground props stand on sy; floating pickups are centred on it instead.
  const base = cfg.centred ? sy + h / 2 : sy;

  if (cfg.glow) {
    const r = h * 0.95;
    const cy = base - h * 0.5;
    const g = ctx.createRadialGradient(sx, cy, 0, sx, cy, r);
    g.addColorStop(0, cfg.glow);
    g.addColorStop(1, cfg.glow.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.fillRect(sx - r, cy - r, r * 2, r * 2);
  } else {
    // contact shadow so it isn't pasted onto the asphalt
    ctx.save();
    ctx.globalAlpha *= 0.42;
    ctx.fillStyle = '#140a1c';
    ctx.beginPath();
    ctx.ellipse(sx, base, w * 0.46, h * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const bob = o.kind === 'pickup' || o.kind === 'power'
    ? Math.sin(t * 3 + o.seed) * h * 0.07 : 0;
  ctx.drawImage(img, sx - w / 2, base - h + bob, w, h);
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
