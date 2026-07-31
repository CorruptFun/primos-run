// Paint on the walls: throw-ups, wordmarks, painted signs and the crew stencil.
//
// This whole file exists to make pigment read as something that soaked INTO
// masonry rather than a decal floating in front of it. Four things do that
// work, and all four matter:
//
//   1. NO ADDITIVE LIGHT. The old overspray pass composited with 'lighter',
//      which makes paint emit — the single clearest signature of a sticker.
//      Overspray here is a 'multiply' pass, so aerosol mist can only ever
//      darken the wall, the way real dust settles on stucco.
//   2. NOTHING IS OPAQUE. Letter bodies sit near 0.86 alpha, so the segment's
//      shading bands, base colour and brick keep coming through the paint.
//   3. THE WALL GOES BACK ON TOP. After the letters land we scrub chips back
//      to the wall's own base colour, break the stroke with a dashed wear
//      pass, and drag grime down over the piece. Paint that has survived a
//      summer in an alley is never pristine.
//   4. EVERY POINT IS PROJECTED. Nothing is drawn in screen space and then
//      pasted; each vertex goes through the caller's projector, and the whole
//      piece is clipped to the wall face, so it lies in the wall's perspective
//      and can never spill past the parapet or onto the asphalt.
//
// `W` throughout is the caller's wall scratch bundle (scenery.js's `S`): it
// carries the projector `P`, the wall plane `wx`, the segment span, `u`
// (pixels per world unit), `lod`, `dz`, `lit`, and the wall's own base and
// wear colours. It is passed in rather than imported so this module never
// reaches back into the renderer.

import { hash01, hexA, tintA } from './palette.js';
import { WALL_H } from '../config.js';
import { loadLogo, logoSource } from './logo.js';

const TAU = Math.PI * 2;
const INK = 'rgba(9,5,13,0.9)';

// ------------------------------------------------------------- wall geometry

/** Add an axis-aligned wall-plane rect to the current path. */
function addFace(W, za, zb, y0, y1) {
  const { ctx, P, wx } = W;
  const p1 = P(wx, y0, za), p2 = P(wx, y1, za), p3 = P(wx, y1, zb), p4 = P(wx, y0, zb);
  if (!p1 || !p2 || !p3 || !p4) return false;
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.lineTo(p4.x, p4.y);
  ctx.closePath();
  return true;
}

function fillFace(W, za, zb, y0, y1, fill) {
  W.ctx.beginPath();
  if (!addFace(W, za, zb, y0, y1)) return;
  W.ctx.fillStyle = fill;
  W.ctx.fill();
}

/**
 * Clip everything that follows to this segment's wall face, stopping short of
 * the coping and the kerb line. A tag can then be authored generously without
 * ever painting the sky or the asphalt.
 */
function clipFace(W) {
  const ctx = W.ctx;
  ctx.beginPath();
  addFace(W, W.z0, W.z1, WALL_H * 0.035, WALL_H * 0.935);
  ctx.clip();
}

/**
 * A wall segment level with the camera projects at an enormous scale, and a
 * piece drawn on it becomes one clipped slab of colour sliding off the edge of
 * the frame — legible as nothing at all. Every entry point checks this: keep
 * the wall, drop the paint.
 */
function tooClose(W) {
  return W.dz < 3.5;
}

// ------------------------------------------------------------------- letters
//
// A stroke font, because words on a wall have to survive being 14px tall.
// Each glyph is polylines on a 0..10 box — x runs along the wall, y runs up
// from the baseline — written two characters per point so the table stays
// readable at a glance. '/' starts a new stroke. Fat round strokes turn these
// skeletons into blocky slab letters at draw time; that is the whole trick,
// and it is why there is no outline data here.

const DIG = '0123456789a';

const GLYPH_SRC = {
  A: '005aa0/2383',
  B: '000a7aa87606/76a37000',
  C: 'a87a3a07033070a2',
  D: '000a6aa6a46000',
  E: 'aa0a00a0/0575',
  F: 'aa0a00/0575',
  G: 'a87a3a07033070a2a555',
  H: '000a/a0aa/05a5',
  I: '505a/2a8a/2080',
  J: '8a83502002',
  K: '000a/aa15a0',
  L: '0a00a0',
  M: '000a54aaa0',
  N: '000aa0aa',
  O: '3a7aa7a3703003073a',
  P: '000a7aa87505',
  Q: '3a7aa7a3703003073a/63a0',
  R: '000a7aa87505/65a0',
  S: 'a87a3a081694a2703002',
  T: '0aaa/5a50',
  U: '0a033070a3aa',
  V: '0a50aa',
  W: '0a205680aa',
  X: '0aa0/00aa',
  Y: '0a55aa/5550',
  Z: '0aaa00a0',
  '!': '5a53/5150',
};

// Advance widths, in glyph boxes. Only the letters that are not square.
const GLYPH_W = { I: 0.5, J: 0.9, L: 0.9, M: 1.15, T: 0.95, W: 1.15, '!': 0.4, ' ': 0.5 };
const TRACK = 0.17;                 // gap between glyph boxes

const FONT = {};
for (const ch of Object.keys(GLYPH_SRC)) {
  const strokes = GLYPH_SRC[ch].split('/').map((s) => {
    const pts = [];
    for (let i = 0; i + 1 < s.length; i += 2) {
      pts.push([DIG.indexOf(s[i]) / 10, DIG.indexOf(s[i + 1]) / 10]);
    }
    return pts;
  });
  FONT[ch] = { w: GLYPH_W[ch] || 1, s: strokes };
}

// Laid-out words are pure functions of their text, and the vocabulary is a
// fixed list — cache the layout so a frame of walls does no string work.
const LAYOUTS = new Map();

/**
 * Lay a word out into polylines in local units: x from 0 to the returned
 * width, y from 0 (baseline) to 1 (cap height).
 */
function layout(text) {
  let cached = LAYOUTS.get(text);
  if (cached) return cached;
  const polys = [];
  let pen = 0;
  for (const ch of text) {
    const g = FONT[ch];
    const aw = g ? g.w : (GLYPH_W[ch] || 0.5);
    if (g) {
      for (const stroke of g.s) {
        const out = [];
        for (const [x, y] of stroke) out.push([pen + x * aw, y]);
        polys.push(out);
      }
    }
    pen += aw + TRACK;
  }
  cached = { polys, w: Math.max(0.001, pen - TRACK) };
  LAYOUTS.set(text, cached);
  return cached;
}

// The alley talks back. Weighted by repetition rather than a weights table.
const WORDS = [
  'PRIMOS', 'BARRIO', 'PRIMOS', 'CORRE', 'CHELA', 'PRIMO',
  'BARRIO', 'LA MIGRA', 'PRIMOS', 'EL BARRIO', 'CORRE', 'PRIMO',
];

// Painted business signs — the back of every real alley building has one.
const SIGNS = ['TAQUERIA', 'MERCADO', 'LAVANDERIA', 'CARNICERIA', 'PANADERIA', 'BODEGA'];

// How far a letter may be squeezed or stretched, as glyph width / cap height.
// The lower bound is the one that matters: a wall panel is much wider than it
// is tall, so a six-letter word asked to fill it lands near 0.37 — condensed
// far enough that a bold stem is wider than the counter it is supposed to
// leave open, and every O fills in solid. Below 0.58 the word gives up height
// instead of width.
const MIN_ASPECT = 0.58;
const MAX_ASPECT = 1.15;

/**
 * Fit a word into a box. Shared by the legibility gate and the draw, so what
 * gets measured is exactly what gets painted.
 */
function metrics(text, boxW, boxH) {
  const L = layout(text);
  let h = boxH;
  let sx = boxW / L.w;                        // world units per glyph box
  if (sx > h * MAX_ASPECT) sx = h * MAX_ASPECT;
  else if (sx < h * MIN_ASPECT) h = sx / MIN_ASPECT;
  return { L, sx, h, wide: sx * L.w };
}

/**
 * Cap height and per-letter width in screen pixels, for the legibility gate.
 * Letters are the first thing to stop meaning anything as a wall recedes, so
 * a word that would not read is never drawn — the caller falls back to an
 * abstract throw-up, which loses nothing at distance.
 */
function fits(W, text, boxW, boxH) {
  const m = metrics(text, boxW, boxH);
  return W.u * m.h >= 13 && W.u * m.sx >= 6;
}

/** Pick a word from `list` that will actually read in this box, or null. */
export function pickWord(W, sd, boxW, boxH, list) {
  const src = list || WORDS;
  const start = Math.floor(hash01(sd * 3.11) * src.length);
  for (let i = 0; i < src.length; i++) {
    const text = src[(start + i) % src.length];
    if (fits(W, text, boxW, boxH)) return text;
  }
  return null;
}

export function pickSign(W, sd, boxW, boxH) {
  return pickWord(W, sd, boxW, boxH, SIGNS);
}

// --------------------------------------------------------------- paint paths

/**
 * Project a set of wall-space polylines ([z, y] pairs) into one Path2D.
 *
 * Building the path once and re-stroking it is what makes a five-pass piece
 * affordable: the projector runs a single time per vertex, and the shadow /
 * keyline / body / wear passes are then just four more strokes of the same
 * geometry.
 */
function pathOf(W, polys) {
  const { P, wx } = W;
  const path = new Path2D();
  for (const poly of polys) {
    let started = false;
    for (let k = 0; k < poly.length; k++) {
      const p = P(wx, poly[k][1], poly[k][0]);
      if (!p) continue;
      if (started) path.lineTo(p.x, p.y);
      else { path.moveTo(p.x, p.y); started = true; }
    }
  }
  return path;
}

function strokePath(ctx, path, col, w, dx, dy) {
  const moved = dx || dy;
  if (moved) { ctx.save(); ctx.translate(dx, dy); }
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(0.7, w);
  ctx.stroke(path);
  if (moved) ctx.restore();
}

/**
 * Lay one piece of paint down.
 *
 * The pass order is the order a writer actually works, and the compositing is
 * the part that matters: overspray MULTIPLIES (mist can only darken), the
 * body is translucent (the wall shows through), and the last pass is wear,
 * not shine.
 */
function paint(W, path, col, lw, sd, opts) {
  const ctx = W.ctx;
  const o = opts || {};
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Overspray. A can throws mist well past the letter edge; done additively
  // that mist glows and the piece lifts off the wall, so it darkens instead.
  if (W.lod === 2 && !o.flat) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    strokePath(ctx, path, tintA(col, 0.7, 0.17), lw * 2.2, 0, 0);
    ctx.restore();
  }

  if (o.flat) {                                   // a painted sign, not aerosol
    strokePath(ctx, path, col, lw, 0, 0);
    return;
  }

  const drop = Math.max(1, lw * 0.28);
  strokePath(ctx, path, 'rgba(8,4,12,0.34)', lw * 1.08, drop, drop);   // cast shadow
  strokePath(ctx, path, INK, lw * 1.34, 0, 0);                         // hard keyline
  strokePath(ctx, path, hexA(col, 0.86), lw, 0, 0);                    // body

  if (W.lod < 2) return;              // three strokes is the whole piece far off

  // A flat highlight cut inside the top of the body. Kept thin and matte —
  // a wet-looking specular is the other way paint starts reading as plastic.
  strokePath(ctx, path, 'rgba(255,250,238,0.22)', lw * 0.22, -lw * 0.16, -lw * 0.2);

  // Broken coverage. One dashed stroke in the wall's own colour eats the
  // paint back along its length — the cheapest convincing wear there is.
  if (W.wearCol) {
    ctx.save();
    ctx.setLineDash([lw * 0.3, lw * 2.6, lw * 0.16, lw * 4.2]);
    ctx.lineDashOffset = (sd * 37) % 40;
    strokePath(ctx, path, W.wearCol, lw * 0.85, 0, 0);
    ctx.restore();
  }
}

/**
 * Put the wall back over the paint.
 *
 * Chips of bare wall scrubbed through the piece, then a grime streak dragged
 * down it, then a fade into the dirt pooling at the bottom. Without this the
 * paint is the only pristine thing in the frame, which is exactly what makes
 * a tag read as a sticker no matter how it was composited.
 */
function wearPaint(W, za, zb, y0, y1, sd) {
  if (W.lod === 0) return;
  const ctx = W.ctx;
  const zw = zb - za, yh = y1 - y0;

  if (W.wearCol) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const h1 = hash01(sd * 3.1 + i * 5.7);
      const h2 = hash01(sd * 7.3 + i * 2.9);
      const cz = za + h1 * zw * 0.86;
      const cy = y0 + h2 * yh * 0.7;
      addFace(W, cz, cz + zw * (0.04 + h2 * 0.1), cy, cy + yh * (0.12 + h1 * 0.34));
    }
    ctx.fillStyle = W.wearCol;
    ctx.fill();
  }

  // Grime coming off whatever is above the piece, plus the dirt line it sits in.
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const h1 = hash01(sd * 11.3 + i * 4.1);
    const cz = za + h1 * zw * 0.9;
    addFace(W, cz, cz + zw * (0.02 + h1 * 0.05), y0 - yh * 0.1, y1 + yh * 0.5);
  }
  ctx.fillStyle = 'rgba(28,15,32,0.2)';
  ctx.fill();
  fillFace(W, za, zb, y0 - yh * 0.06, y0 + yh * 0.22, 'rgba(24,13,28,0.16)');

  // The wall's own surface carried straight across the piece — mortar courses
  // on brick, float marks on stucco. Paint does not fill a joint, it bridges
  // it, and one stroke of that reads as texture UNDER the colour.
  if (W.lod < 2 || !W.wearCol) return;
  const { P, wx } = W;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const yy = y0 + (0.2 + i * 0.3 + hash01(sd * 9.7 + i * 6.1) * 0.12) * yh;
    const p = P(wx, yy, za), q = P(wx, yy, zb);
    if (!p || !q) continue;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  ctx.strokeStyle = W.wearCol;
  ctx.lineWidth = Math.max(0.5, W.u * 0.008);
  ctx.stroke();
}

// ---------------------------------------------------------------- throw-ups

// Fat abstract marker glyphs — enough shape variety to read as lettering at
// speed, used wherever a real word would be too small to mean anything.
const GLYPHS = [
  [[0, 0], [0, 1], [0.62, 0.92], [0.62, 0.5], [0.05, 0.46]],
  [[0, 0], [0, 1], [0.62, 0.7], [0.05, 0.44], [0.62, 0]],
  [[0.62, 0.95], [0.05, 0.82], [0.6, 0.5], [0.02, 0.16], [0.6, 0.05]],
  [[0, 0], [0.02, 1], [0.32, 0.42], [0.6, 1], [0.62, 0]],
  [[0.02, 0.28], [0, 0.74], [0.3, 1], [0.6, 0.72], [0.58, 0.26], [0.3, 0], [0.02, 0.28]],
  [[0, 1], [0.3, 0], [0.6, 1], [0.12, 0.5], [0.5, 0.5]],
];

/**
 * A throw-up.
 *
 * Real throw-ups are FAT — the letter body is most of the glyph, with a hard
 * keyline around it. `lw` is most of the difference between "spray can" and
 * "biro", so it stays generous even when the wall is far away.
 */
export function throwUp(W, zc, yc, w, h, col, sd) {
  if (tooClose(W)) return;
  const { ctx, u, lod } = W;
  // Letter count follows the box, not the LOD — pick it from the aspect ratio
  // or narrow boxes squash the glyphs into unreadable vertical bars.
  const n = Math.max(2, Math.min(lod === 2 ? 5 : 4, Math.round(w / (h * 0.8))));
  const gw = w / n;

  const polys = [];
  for (let i = 0; i < n; i++) {
    const g = GLYPHS[Math.floor(hash01(sd * 3.7 + i * 11.1) * GLYPHS.length)];
    const bz = zc + i * gw * 0.96;
    const skew = (hash01(sd + i * 2.3) - 0.5) * 0.16;
    const out = [];
    for (let k = 0; k < g.length; k++) {
      out.push([bz + g[k][0] * gw * 1.4, yc + (g[k][1] + skew * g[k][0]) * h]);
    }
    polys.push(out);
  }

  ctx.save();
  clipFace(W);
  paint(W, pathOf(W, polys), col, Math.max(1.2, u * h * 0.29), sd);
  if (lod === 2) drips(W, zc, yc, h, n, gw, col, sd);
  wearPaint(W, zc, zc + w * 1.1, yc, yc + h, sd);
  ctx.restore();
}

/** Runs of paint under the letters — the giveaway that it went up fast. */
function drips(W, zc, yc, h, n, gw, col, sd) {
  const { ctx, P, wx } = W;
  ctx.lineCap = 'round';
  ctx.strokeStyle = hexA(col, 0.7);
  for (let i = 0; i < n; i++) {
    const r = hash01(sd * 5.3 + i * 3.1);
    if (r > 0.45) continue;                      // only some letters run
    const bz = zc + i * gw * 0.96 + gw * (0.2 + hash01(sd + i) * 0.5);
    const top = P(wx, yc, bz);
    const bot = P(wx, yc - h * (0.14 + r * 0.44), bz);
    if (!top || !bot) continue;
    ctx.lineWidth = Math.max(0.6, top.scale * h * 0.05);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bot.x, bot.y);
    ctx.stroke();
    ctx.fillStyle = hexA(col, 0.75);
    ctx.beginPath();
    ctx.arc(bot.x, bot.y, Math.max(0.7, top.scale * h * 0.042), 0, TAU);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- word tags

/**
 * A readable wordmark sprayed across the wall.
 *
 * The box is honoured but not obeyed: letters get squeezed back toward a sane
 * aspect and the whole word is re-centred, because a wall panel's proportions
 * have nothing to do with a word's.
 */
export function wordTag(W, text, zc, yc, boxW, boxH, col, sd, opts) {
  if (tooClose(W)) return;
  const o = opts || {};
  const { ctx } = W;
  const { L, sx, h, wide } = metrics(text, boxW, boxH);
  const z0 = zc + (boxW - wide) * 0.5;

  // Hand-painted, not typeset: a slight rise across the word and a per-letter
  // wobble. Both stay tiny — at these sizes a little goes a very long way.
  const slant = (hash01(sd * 5.9) - 0.5) * 0.13;
  const polys = [];
  for (const poly of L.polys) {
    const jitter = (hash01(sd * 2.7 + poly[0][0] * 9.1) - 0.5) * 0.05;
    const out = [];
    for (const [x, y] of poly) {
      out.push([z0 + x * sx, yc + (y + jitter + x * slant / Math.max(0.5, L.w)) * h]);
    }
    polys.push(out);
  }

  ctx.save();
  if (!o.noClip) clipFace(W);
  // Stem weight rides the CAP HEIGHT, which is only safe because `metrics`
  // has already refused to condense the glyph past MIN_ASPECT. Skip that
  // clamp and this number silently welds the letters shut.
  const lw = Math.max(1.1, W.u * h * (o.weight || 0.17));
  paint(W, pathOf(W, polys), col, lw, sd, o);
  if (!o.clean) wearPaint(W, z0, z0 + wide, yc, yc + h, sd);
  ctx.restore();
}

/** A faded painted sign — flat, no keyline, no mist. Ghost-sign territory. */
export function ghostWord(W, text, zc, yc, boxW, boxH, col, sd, opts) {
  wordTag(W, text, zc, yc, boxW, boxH, col, sd,
    { flat: true, clean: true, weight: 0.14, noClip: opts && opts.noClip });
}

// -------------------------------------------------------------- the stencil
//
// The crew tag. `art/primos-logo.png` is white shapes on a black disc, which
// is already a two-value stencil; all that is needed is to separate those two
// values into masks ONCE at load and recolour them into a flat two-tone
// sticker. Per frame this is then a handful of drawImage calls.

const LOGO_PX = 256;      // it is line art — thin strokes need the resolution

// The crew paints in three colours and no more. That is partly character (a
// tag that changes colour every wall is not a crew tag) and partly the reason
// the cache below can never thrash: three baked canvases, both warm forever.
const STENCIL_COLS = ['#f2e9d6', '#ffc93c', '#28c3b8'];

let maskDisc = null;      // the whole silhouette, white on transparent
let maskFace = null;      // just the light shapes inside it
let scratch = null;
const baked = new Map();  // colour -> composited stencil canvas

export function logoReady() {
  return maskDisc !== null;
}

function newCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = LOGO_PX;
  return c;
}

/**
 * Split the logo into two flat masks.
 *
 * Alpha carries the disc; luminance carries the face. The luminance ramp is
 * deliberately narrow — a stencil has two values, and keeping the mid-greys
 * would give the paint a soft airbrushed edge it should never have.
 */
function bakeMasks(img) {
  const src = newCanvas();
  const sx = src.getContext('2d', { willReadFrequently: true });
  sx.drawImage(img, 0, 0, LOGO_PX, LOGO_PX);
  const data = sx.getImageData(0, 0, LOGO_PX, LOGO_PX);
  const p = data.data;

  const disc = newCanvas(), face = newCanvas();
  const dImg = sx.createImageData(LOGO_PX, LOGO_PX);
  const fImg = sx.createImageData(LOGO_PX, LOGO_PX);
  const d = dImg.data, f = fImg.data;

  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3];
    const lum = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) / 255;
    const k = lum <= 0.36 ? 0 : lum >= 0.62 ? 1 : (lum - 0.36) / 0.26;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = a;
    f[i] = f[i + 1] = f[i + 2] = 255;
    f[i + 3] = (a * k) | 0;
  }
  disc.getContext('2d').putImageData(dImg, 0, 0);
  face.getContext('2d').putImageData(fImg, 0, 0);
  maskDisc = disc;
  maskFace = face;
  scratch = newCanvas();
}

/** Recolour a mask into the shared scratch canvas. */
function tinted(mask, col) {
  const x = scratch.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, LOGO_PX, LOGO_PX);
  x.drawImage(mask, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = col;
  x.fillRect(0, 0, LOGO_PX, LOGO_PX);
  x.globalCompositeOperation = 'source-over';
  return scratch;
}

/** Composite the two-tone stencil for one paint colour. Cached forever. */
function bakedLogo(light) {
  if (!maskDisc) return null;
  let c = baked.get(light);
  if (c) return c;
  c = newCanvas();
  const x = c.getContext('2d');
  x.drawImage(tinted(maskDisc, '#150c1c'), 0, 0);
  x.drawImage(tinted(maskFace, light), 0, 0);
  baked.set(light, c);
  return c;
}

// Share logo.js's decode rather than fetching and decoding the same PNG twice.
// The two modules still bake DIFFERENT products from it — logo.js a knockout
// stencil for the HUD, this a two-tone wall stencil — but there is no reason for
// two copies of the source bitmap to exist. logo.js self-starts its load on
// import, and loadLogo() is idempotent, so this just waits on whichever call
// got there first.
if (typeof document !== 'undefined') {
  loadLogo().then((ok) => {
    if (!ok) { maskDisc = null; return; }
    try { bakeMasks(logoSource()); } catch (e) { maskDisc = null; }
  });
}

/**
 * Draw an image into a wall-plane rect, in perspective.
 *
 * A vertical wall projects to a trapezoid, which canvas' affine transform
 * cannot express, so the rect is sliced into strips and each strip gets its
 * own affine. Both top corners of a strip are exact; the vertical vector is
 * averaged across the strip, which puts the error on the bottom edge at well
 * under a pixel by six strips. Strips overlap slightly so antialiasing cannot
 * open a hairline seam between them, and the whole thing is clipped to the
 * true quad so the approximation can never escape the rect.
 */
function drawWallImage(W, img, za, zb, y0, y1, alpha, strips, op) {
  const { ctx, P, wx } = W;
  const sw = img.width / strips, sh = img.height;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (op) ctx.globalCompositeOperation = op;
  ctx.beginPath();
  if (addFace(W, za, zb, y0, y1)) ctx.clip();

  for (let i = 0; i < strips; i++) {
    const zA = za + (zb - za) * (i / strips);
    const zB = za + (zb - za) * ((i + 1) / strips);
    const A = P(wx, y1, zA), B = P(wx, y0, zA);
    const C = P(wx, y1, zB), D = P(wx, y0, zB);
    if (!A || !B || !C || !D) continue;
    const vx = ((B.x - A.x) + (D.x - C.x)) * 0.5;
    const vy = ((B.y - A.y) + (D.y - C.y)) * 0.5;
    const ov = i === strips - 1 ? 0 : sw * 0.03;
    ctx.save();
    ctx.transform((C.x - A.x) / sw, (C.y - A.y) / sw, vx / sh, vy / sh, A.x, A.y);
    ctx.drawImage(img, i * sw, 0, sw + ov, sh, 0, 0, sw + ov, sh);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The crew stencil, sprayed on. `size` is its height in world units.
 *
 * Degrades to nothing if the PNG never loaded — callers check `logoReady()`
 * first, and this checks again so a late failure cannot throw mid-frame.
 */
export function logoStencil(W, zc, yc, size, sd) {
  if (tooClose(W)) return;
  const ci = Math.floor(hash01(sd * 4.7) * STENCIL_COLS.length);
  const img = bakedLogo(STENCIL_COLS[ci] || STENCIL_COLS[0]);
  if (!img) return;
  const ctx = W.ctx;
  const za = zc - size * 0.5, zb = zc + size * 0.5;
  const y0 = yc, y1 = yc + size;
  const strips = W.lod === 2 ? 6 : 3;

  ctx.save();
  clipFace(W);
  // Overspray past the stencil edge: the same shape, larger, MULTIPLIED so it
  // can only ever dirty the wall.
  if (W.lod === 2) {
    const m = size * 0.05;
    drawWallImage(W, img, za - m, zb + m, y0 - m, y1 + m, 0.16, 3, 'multiply');
  }
  drawWallImage(W, img, za, zb, y0, y1, W.lit ? 0.9 : 0.84, strips);
  wearPaint(W, za, zb, y0, y1, sd);
  ctx.restore();
}

// ------------------------------------------------------------------ dispatch

/**
 * Put SOMETHING on this stretch of wall and let the wall decide what.
 *
 * Words only go up where they would still be legible, the stencil only where
 * it is big enough to be a face rather than a smudge, and everything else
 * falls through to a throw-up, which loses nothing as it recedes.
 */
export function autoTag(W, zc, yc, w, h, col, sd) {
  if (tooClose(W)) return;
  const r = hash01(sd * 1.77);

  if (r > 0.74 && W.lod === 2 && logoReady() && W.u * h > 22) {
    logoStencil(W, zc + w * 0.5, yc, Math.min(w * 0.62, h * 2.2), sd);
    return;
  }
  if (r > 0.34) {
    const text = pickWord(W, sd, w, h);
    if (text) { wordTag(W, text, zc, yc, w, h, col, sd); return; }
  }
  throwUp(W, zc, yc, w, h, col, sd);
}
