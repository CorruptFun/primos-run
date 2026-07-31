// The Primos brand mark: one PNG, loaded once, baked into ready-to-draw
// canvases.
//
// The source art is a stark white-on-black roundel with a transparent
// surround — a face in slicked hair, shades and a bandana over the mouth.
// Two things follow from that, and both are the reason this module exists:
//
//   • Drawn as-is over the sunset, the black disc punches a hole in the sky.
//     So the DEFAULT variant here is a knockout: the black is dissolved into
//     transparency and only the white shapes survive. The shades and eyebrows
//     are black *on* the white, so they come out as holes — which is exactly
//     the single-colour stencil version of the mark, and it composites onto
//     any background.
//   • Canvas 2D has no per-draw tint. Recolouring means an offscreen pass, so
//     each colour is baked ONCE into its own canvas and cached by colour
//     string. Per-frame callers (the HUD) then pay a Map lookup and one
//     drawImage, and nothing else.
//
// Everything degrades to a no-op: if the PNG never lands, or the page is
// opened from file:// where reading pixels back would taint the canvas, the
// draw helpers return false and paint nothing rather than throwing.

// Resolved against this module, not the page, so dev/ harnesses load it too.
const BASE = new URL('../../art/', import.meta.url).href;
const FILE = 'primos-logo.png';

// Bake resolution. The mark is drawn at roughly 40–120 CSS px in the HUD, so
// ~2x that on a retina backing store; 192 covers every real case without a
// second downscale at draw time. 400 -> 192 is barely 2x, which a single
// bilinear tap handles cleanly — unlike the body parts in sprites.js, whose
// ~14x minification needs repeated halving.
const BAKE = 192;

// Luminance -> alpha, with both ends clipped. The art is strongly bimodal
// (~84% pure black, ~16% pure white by area), so nearly all the mid-tones are
// edge antialiasing. Lifting the toe and dropping the shoulder keeps the
// stencil crisp instead of leaving a grey fringe around every shape.
const TOE = 42;
const SHOULDER = 214;

// A caller that animated a colour would otherwise grow this without bound.
const TINT_MAX = 12;

let source = null;      // the decoded PNG
let disc = null;        // canvas — full roundel, black disc intact
let mark = null;        // canvas — knockout stencil, white, alpha = shape
let state = 'idle';     // idle | loading | ready | missing
let pending = null;
const tints = new Map(); // colour string -> tinted copy of `mark`

/** True once the art has decoded and the variants are baked. */
export function logoReady() {
  return state === 'ready';
}

/**
 * Start loading. Idempotent — repeat calls return the same promise, which
 * resolves false (never rejects) if the art is missing.
 *
 * Called automatically at the bottom of this module, because main.js kicks off
 * loadSprites()/loadProps() by hand and knows nothing about the logo.
 */
export function loadLogo() {
  if (pending) return pending;
  state = 'loading';
  pending = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      source = img;
      bake(img);
      resolve(state === 'ready');
    };
    img.onerror = () => { state = 'missing'; resolve(false); };
    img.src = BASE + FILE;
  });
  return pending;
}

/** The raw decoded PNG, for callers that want their own pipeline. */
export function logoSource() {
  return source;
}

/** The whole mark, black disc and all. Best on light or busy surfaces. */
export function logoDisc() {
  return disc;
}

/**
 * The knockout stencil — white shapes only, disc dissolved.
 *
 * @param {string} [color] any canvas fill style. Tinted copies are baked once
 *   and cached, so passing the same colour every frame costs a Map lookup.
 * @returns {HTMLCanvasElement|null} null while loading, or if the art or the
 *   pixel readback failed.
 */
export function logoMark(color) {
  if (!mark) return null;
  if (!color) return mark;

  const hit = tints.get(color);
  if (hit) return hit;

  const out = document.createElement('canvas');
  out.width = mark.width;
  out.height = mark.height;
  const c = out.getContext('2d');
  c.drawImage(mark, 0, 0);
  c.globalCompositeOperation = 'source-in';   // paint only where the shape is
  c.fillStyle = color;
  c.fillRect(0, 0, out.width, out.height);

  if (tints.size >= TINT_MAX) tints.delete(tints.keys().next().value);
  tints.set(color, out);
  return out;
}

/**
 * Draw the knockout stencil centred on (cx, cy).
 *
 * Positional rather than an options bag on purpose: this is on the HUD's
 * per-frame path, and an options literal would allocate every frame.
 *
 * @param {number} size width in px; height follows the art's aspect
 * @param {string|null} [color] null draws it white
 * @returns {boolean} false if nothing was drawn
 */
export function drawLogo(ctx, cx, cy, size, color, alpha) {
  const a = alpha === undefined ? 1 : alpha;
  if (!(a > 0) || !(size > 0)) return false;
  // Falls back to the full disc if the knockout could not be baked — on the
  // dark HUD the black reads as a soft plate rather than a hole.
  const img = logoMark(color) || disc;
  if (!img) return false;
  paint(ctx, img, cx, cy, size, a);
  return true;
}

/** Draw the full roundel centred on (cx, cy). */
export function drawLogoDisc(ctx, cx, cy, size, alpha) {
  const a = alpha === undefined ? 1 : alpha;
  if (!disc || !(a > 0) || !(size > 0)) return false;
  paint(ctx, disc, cx, cy, size, a);
  return true;
}

// ----------------------------------------------------------------- internals

function paint(ctx, img, cx, cy, w, alpha) {
  const h = w * (img.height / img.width);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}

function bake(img) {
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) { state = 'missing'; return; }

    const k = Math.min(1, BAKE / Math.max(w, h));
    const bw = Math.max(1, Math.round(w * k));
    const bh = Math.max(1, Math.round(h * k));

    disc = document.createElement('canvas');
    disc.width = bw;
    disc.height = bh;
    const dc = disc.getContext('2d');
    dc.imageSmoothingQuality = 'high';
    dc.drawImage(img, 0, 0, bw, bh);

    mark = knockout(disc);
    state = 'ready';
  } catch {
    // A tainted canvas (file://) kills the knockout but not the disc.
    state = disc ? 'ready' : 'missing';
  }
}

/** Rebuild `src` with the black dissolved: white RGB, alpha from luminance. */
function knockout(src) {
  const w = src.width, h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h);
  const p = data.data;
  const span = SHOULDER - TOE;

  for (let i = 0; i < p.length; i += 4) {
    const lum = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000;
    let k = (lum - TOE) / span;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    p[i] = 255;
    p[i + 1] = 255;
    p[i + 2] = 255;
    p[i + 3] *= k;                 // a transparent surround stays transparent
  }

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').putImageData(data, 0, 0);
  return out;
}

if (typeof document !== 'undefined' && typeof Image !== 'undefined') loadLogo();
