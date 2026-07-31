// The alley itself: smoggy sunset sky, and the stucco/brick walls that box you in.
//
// Two rules run through this file. Everything is deterministic from `seed`, so a
// stretch of alley looks identical every time you run past it. And everything is
// LOD'd by real distance (derived from the projected scale ratio, so the cutoffs
// behave the same on a phone and a desktop) — the wall two metres away gets
// slats and mortar joints, the one at the fog line gets three fills.

import { PAL, TAG_COLORS, hash01, hexA, tintA, quad, roundRect } from './palette.js';
import {
  autoTag, throwUp, wordTag, ghostWord, logoStencil, logoReady, pickWord, pickSign,
} from './graffiti.js';
import { ALLEY_HALF, WALL_H } from '../config.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------- sky

export function drawSky(ctx, W, H, horizon, t, camX) {
  ctx.save();

  // Night still hanging on up top, furnace down at the deck.
  const g = ctx.createLinearGradient(0, 0, 0, horizon + H * 0.04);
  g.addColorStop(0.00, '#140a30');
  g.addColorStop(0.13, PAL.skyTop);
  g.addColorStop(0.34, '#5e2a68');
  g.addColorStop(0.54, PAL.skyMid);
  g.addColorStop(0.73, '#cf5145');
  g.addColorStop(0.88, PAL.skyLow);
  g.addColorStop(1.00, PAL.skyHaze);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, horizon + H * 0.08);

  drawStars(ctx, W, horizon, t, camX);
  drawMoon(ctx, W, H, horizon, camX);

  const sunX = W * 0.5 - camX * 26;
  const sunY = horizon - H * 0.045;

  // Crepuscular rays: one radial gradient supplies the falloff for the whole
  // fan, so eight wedges cost a single fill.
  const rayR = H * 1.2;
  const rg = ctx.createRadialGradient(sunX, sunY, H * 0.05, sunX, sunY, rayR);
  rg.addColorStop(0, 'rgba(255,224,168,0.20)');
  rg.addColorStop(0.4, 'rgba(255,186,112,0.09)');
  rg.addColorStop(1, 'rgba(255,150,90,0)');
  ctx.fillStyle = rg;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI * 0.5 + (i - 3.5) * 0.3 + Math.sin(t * 0.06 + i * 1.7) * 0.035;
    const w = 0.02 + hash01(i * 4.1) * 0.05;
    ctx.moveTo(sunX, sunY);
    ctx.lineTo(sunX + Math.cos(a - w) * rayR, sunY + Math.sin(a - w) * rayR);
    ctx.lineTo(sunX + Math.cos(a + w) * rayR, sunY + Math.sin(a + w) * rayR);
  }
  ctx.fill();

  // Bloom: broad haze, tight core, then an anamorphic smear along the smog.
  const b1 = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, H * 0.42);
  b1.addColorStop(0, 'rgba(255,216,152,0.55)');
  b1.addColorStop(0.3, 'rgba(255,166,92,0.26)');
  b1.addColorStop(1, 'rgba(255,120,70,0)');
  ctx.fillStyle = b1;
  ctx.fillRect(sunX - H * 0.45, sunY - H * 0.45, H * 0.9, H * 0.9);

  const b2 = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, H * 0.14);
  b2.addColorStop(0, 'rgba(255,248,218,0.95)');
  b2.addColorStop(0.5, 'rgba(255,214,138,0.5)');
  b2.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = b2;
  ctx.fillRect(sunX - H * 0.16, sunY - H * 0.16, H * 0.32, H * 0.32);

  ctx.save();
  ctx.translate(sunX, sunY);
  ctx.scale(1, 0.11);
  const b3 = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.44);
  b3.addColorStop(0, 'rgba(255,238,194,0.6)');
  b3.addColorStop(1, 'rgba(255,180,110,0)');
  ctx.fillStyle = b3;
  ctx.beginPath();
  ctx.arc(0, 0, W * 0.44, 0, TAU);
  ctx.fill();
  ctx.restore();

  // The disc itself, squashed the way a low sun refracts.
  ctx.fillStyle = PAL.sun;
  ctx.beginPath();
  ctx.ellipse(sunX, sunY, H * 0.05, H * 0.042, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,252,238,0.85)';
  ctx.beginPath();
  ctx.ellipse(sunX, sunY - H * 0.006, H * 0.031, H * 0.026, 0, 0, TAU);
  ctx.fill();

  // Cloud decks, thin and high first so the fat ones sit in front.
  for (let i = 0; i < 4; i++) {
    const h1 = hash01(i * 3.3);
    const cx = wrapX(h1 * 1.5 * W - camX * 8 - t * (2.5 + i), W);
    drawCirrus(ctx, cx, horizon * (0.14 + hash01(i * 9.1) * 0.34),
      W * (0.22 + h1 * 0.16), H * 0.012, i * 17 + 3, 0.28);
  }
  for (let i = 0; i < 6; i++) {
    const h1 = hash01(i * 4.7);
    const cx = wrapX(h1 * 1.5 * W - camX * 14 - t * (1.4 + h1 * 2.4), W);
    const cy = horizon * (0.42 + hash01(i * 6.1) * 0.42);
    drawCloud(ctx, cx, cy, W * (0.09 + hash01(i * 8.9) * 0.11),
      H * (0.02 + hash01(i * 2.7) * 0.026), i * 31 + 7,
      0.35 + (cy / horizon) * 0.75);
  }

  // Downtown in two parallax layers: hazy and far, then dark and near.
  skylineBand(ctx, W, H, horizon, -camX * 7, 'rgba(76,42,86,0.5)', 0.075, 24, 3.1, false);
  skylineBand(ctx, W, H, horizon, -camX * 13, 'rgba(36,19,44,0.85)', 0.105, 17, 7.3, true);
  horizonPalms(ctx, W, H, horizon, camX);

  // Smog band, then the hot line right on the deck under the sun.
  const hz = ctx.createLinearGradient(0, horizon - H * 0.13, 0, horizon + H * 0.02);
  hz.addColorStop(0, 'rgba(255,166,86,0)');
  hz.addColorStop(0.5, 'rgba(255,172,92,0.3)');
  hz.addColorStop(1, 'rgba(255,198,124,0.78)');
  ctx.fillStyle = hz;
  ctx.fillRect(0, horizon - H * 0.13, W, H * 0.16);

  const hl = ctx.createLinearGradient(sunX - W * 0.55, 0, sunX + W * 0.55, 0);
  hl.addColorStop(0, 'rgba(255,220,160,0)');
  hl.addColorStop(0.5, 'rgba(255,244,206,0.85)');
  hl.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, horizon - H * 0.005, W, H * 0.007);

  ctx.restore();
}

/** Wrap a parallaxed x into a band a little wider than the screen. */
function wrapX(x, W) {
  const span = W * 1.6;
  return ((x + W * 0.3) % span + span) % span - W * 0.3;
}

function drawStars(ctx, W, horizon, t, camX) {
  const top = horizon * 0.62;
  // Three brightness tiers instead of per-star alpha keeps this to three fills.
  for (let tier = 0; tier < 3; tier++) {
    ctx.beginPath();
    let any = false;
    for (let i = tier; i < 60; i += 3) {
      const sy = hash01(i * 7.3) * hash01(i * 7.3) * top;
      if (hash01(i * 5.5) < sy / top) continue;     // thin out toward the glow
      const sx = wrapX(hash01(i * 12.9) * 1.5 * W - camX * 5, W);
      const r = (0.55 + hash01(i * 3.1) * 0.9) * (tier === 2 ? 1.6 : 1);
      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, TAU);
      any = true;
    }
    if (!any) continue;
    const tw = 0.5 + 0.5 * Math.sin(t * (1.1 + tier * 0.8) + tier * 2.3);
    ctx.fillStyle = `rgba(238,230,255,${(0.14 + tier * 0.15) * (0.62 + tw * 0.38)})`;
    ctx.fill();
  }
}

function drawMoon(ctx, W, H, horizon, camX) {
  const mx = W * 0.78 - camX * 9;
  const my = horizon * 0.24;
  const r = H * 0.026;

  const glow = ctx.createRadialGradient(mx, my, 0, mx, my, r * 4);
  glow.addColorStop(0, 'rgba(226,222,255,0.22)');
  glow.addColorStop(1, 'rgba(200,190,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(mx - r * 4, my - r * 4, r * 8, r * 8);

  // Crescent as two arcs that share endpoints — no compositing tricks needed.
  ctx.fillStyle = 'rgba(244,238,255,0.62)';
  ctx.beginPath();
  ctx.arc(mx, my, r, Math.PI * 0.5, Math.PI * 1.5, false);
  ctx.arc(mx + r * 0.5, my, r * 1.118, -2.0344, 2.0344, true);
  ctx.fill();
}

function puffs(ctx, x, y, w, h, n, sd) {
  ctx.beginPath();
  ctx.ellipse(x, y, w, h * 0.5, 0, 0, TAU);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1) - 0.5;
    const ph = h * (0.5 + hash01(sd + i * 3.3) * 0.7) * (1 - Math.abs(k) * 0.6);
    ctx.ellipse(x + k * w * 1.5, y - ph * 0.45,
      w * (0.28 + hash01(sd + i * 7.1) * 0.24), ph, 0, 0, TAU);
  }
}

function drawCloud(ctx, x, y, w, h, sd, litK) {
  const k = Math.min(1, litK);
  const g = ctx.createLinearGradient(0, y - h * 1.5, 0, y + h * 0.7);
  g.addColorStop(0, 'rgba(62,32,72,0.88)');
  g.addColorStop(0.55, 'rgba(126,52,90,0.88)');
  g.addColorStop(1, `rgba(255,168,96,${0.9 * k})`);
  ctx.fillStyle = g;
  puffs(ctx, x, y, w, h, 4, sd);
  ctx.fill();

  // Hot underside — flat puffs riding the bottom edge, where the sun hits.
  ctx.beginPath();
  ctx.ellipse(x, y + h * 0.33, w * 0.9, h * 0.19, 0, 0, TAU);
  ctx.ellipse(x - w * 0.52, y + h * 0.26, w * 0.32, h * 0.13, 0, 0, TAU);
  ctx.ellipse(x + w * 0.55, y + h * 0.24, w * 0.3, h * 0.12, 0, 0, TAU);
  ctx.fillStyle = `rgba(255,208,136,${0.45 * k})`;
  ctx.fill();
}

function drawCirrus(ctx, x, y, w, h, sd, a) {
  const g = ctx.createLinearGradient(x - w, y, x + w, y);
  g.addColorStop(0, 'rgba(255,170,120,0)');
  g.addColorStop(0.35, `rgba(255,198,150,${a})`);
  g.addColorStop(0.72, `rgba(255,156,110,${a * 0.7})`);
  g.addColorStop(1, 'rgba(214,126,110,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const k = hash01(sd + i * 5.7);
    ctx.ellipse(x + (k - 0.5) * w * 0.9, y + (hash01(sd + i * 2.3) - 0.5) * h * 2.6,
      w * (0.34 + k * 0.42), h * (0.22 + k * 0.5), 0, 0, TAU);
  }
  ctx.fill();
}

function skylineBand(ctx, W, H, horizon, px, fill, hMax, n, sd, detail) {
  const step = W * 1.4 / n;
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const bw = step * (0.45 + hash01(i * sd) * 0.8);
    const bh = H * (0.018 + hash01(i * sd * 2.7) * hMax);
    const bx = wrapX(i * step + hash01(i * sd * 1.9) * step * 0.4 + px, W);
    ctx.rect(bx, horizon - bh, bw, bh);
    if (hash01(i * sd * 3.3) > 0.55) {                 // setback / rooftop box
      ctx.rect(bx + bw * 0.28, horizon - bh - H * 0.018, bw * 0.34, H * 0.02);
    }
  }
  ctx.fill();
  if (!detail) return;

  // Same deterministic buildings walked a second time for antennas + windows.
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(1, H * 0.0016);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (hash01(i * sd * 5.1) < 0.6) continue;
    const bw = step * (0.45 + hash01(i * sd) * 0.8);
    const bh = H * (0.018 + hash01(i * sd * 2.7) * hMax);
    const bx = wrapX(i * step + hash01(i * sd * 1.9) * step * 0.4 + px, W);
    ctx.moveTo(bx + bw * 0.7, horizon - bh);
    ctx.lineTo(bx + bw * 0.7, horizon - bh - H * 0.035);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,206,132,0.42)';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const bw = step * (0.45 + hash01(i * sd) * 0.8);
    const bh = H * (0.018 + hash01(i * sd * 2.7) * hMax);
    const bx = wrapX(i * step + hash01(i * sd * 1.9) * step * 0.4 + px, W);
    const cols = Math.max(1, Math.floor(bw / (W * 0.016)));
    const rows = Math.max(1, Math.floor(bh / (H * 0.016)));
    for (let c = 0; c < cols; c++) {
      for (let rr = 0; rr < rows; rr++) {
        if (hash01(i * 31.7 + c * 5.3 + rr * 2.9) < 0.78) continue;
        ctx.rect(bx + (c + 0.3) * (bw / cols), horizon - bh + (rr + 0.3) * (bh / rows),
          bw / cols * 0.4, bh / rows * 0.34);
      }
    }
  }
  ctx.fill();
}

function horizonPalms(ctx, W, H, horizon, camX) {
  const px = -camX * 20;
  ctx.strokeStyle = 'rgba(24,11,30,0.92)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const x = wrapX(i * W * 0.2 + hash01(i * 5.3) * W * 0.11 + px, W);
    const th = H * (0.07 + hash01(i * 7.9) * 0.08);
    const lean = (hash01(i * 3.7) - 0.5) * 0.55;
    const tx = x + th * lean, ty = horizon - th;
    ctx.lineWidth = Math.max(1, th * 0.05);
    ctx.beginPath();
    ctx.moveTo(x, horizon + H * 0.008);
    ctx.quadraticCurveTo(x + th * lean * 0.2, horizon - th * 0.5, tx, ty);
    for (let f = 0; f < 7; f++) {
      const a = -Math.PI * 0.5 + (f - 3) * 0.44;
      const r = th * (0.26 + hash01(i * 11 + f) * 0.18);
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + Math.cos(a) * r, ty + Math.sin(a) * r,
        tx + Math.cos(a) * r * 1.5, ty + Math.sin(a) * r * 1.5 + r * 0.6);
    }
    ctx.stroke();
  }
}

// ------------------------------------------------------- wall-plane drawing

// One scratch bundle reused by every wall helper. drawWallSegment runs ~50x a
// frame; rebuilding a dozen closures each time is pure garbage pressure.
const S = {
  ctx: null, P: null, wx: 0, side: 1, z0: 0, z1: 0, len: 0,
  u: 0, lod: 0, lit: false, seed: 0, dz: 0,
  // The wall's own shaded base colour, and the same colour at the alpha the
  // graffiti layer scrubs paint back with. Paint that gets eaten by anything
  // other than the wall it is on never looks worn, it looks smudged.
  base: '#000', wearCol: 'rgba(0,0,0,0.4)',
};

/** Add an axis-aligned wall-plane rect to the current path. */
function addFace(za, zb, y0, y1) {
  const ctx = S.ctx, P = S.P, wx = S.wx;
  const p1 = P(wx, y0, za), p2 = P(wx, y1, za), p3 = P(wx, y1, zb), p4 = P(wx, y0, zb);
  if (!p1 || !p2 || !p3 || !p4) return;
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.lineTo(p4.x, p4.y);
  ctx.closePath();
}

function face(za, zb, y0, y1, fill) {
  S.ctx.beginPath();
  addFace(za, zb, y0, y1);
  S.ctx.fillStyle = fill;
  S.ctx.fill();
}

/** Same rect, but shaded bottom->top so surfaces read as lit rather than flat. */
function faceGrad(za, zb, y0, y1, cBottom, cTop) {
  const ctx = S.ctx, P = S.P, wx = S.wx;
  const p1 = P(wx, y0, za), p2 = P(wx, y1, za), p3 = P(wx, y1, zb), p4 = P(wx, y0, zb);
  if (!p1 || !p2 || !p3 || !p4) return;
  const g = ctx.createLinearGradient((p1.x + p4.x) * 0.5, (p1.y + p4.y) * 0.5,
    (p2.x + p3.x) * 0.5, (p2.y + p3.y) * 0.5);
  g.addColorStop(0, cBottom);
  g.addColorStop(1, cTop);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.lineTo(p4.x, p4.y);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
}

/** Add one wall-plane line segment to the current path (batch, then stroke once). */
function edge(za, ya, zb, yb) {
  const p = S.P(S.wx, ya, za), q = S.P(S.wx, yb, zb);
  if (!p || !q) return;
  S.ctx.moveTo(p.x, p.y);
  S.ctx.lineTo(q.x, q.y);
}

function strokeNow(col, w) {
  S.ctx.strokeStyle = col;
  S.ctx.lineWidth = Math.max(0.55, w);
  S.ctx.stroke();
}

/** Elliptical arc laid flat on the wall plane, in wall (z,y) coords. */
function addArc(zc, yc, rz, ry, a0, a1, steps, move) {
  const ctx = S.ctx;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    const p = S.P(S.wx, yc + Math.sin(a) * ry, zc + Math.cos(a) * rz);
    if (!p) continue;
    if (i === 0 && move) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
}

// -------------------------------------------------------------------- walls

/**
 * One 4-unit slab of alley wall on one side, decorated deterministically from
 * `seed` so the same stretch always looks the same.
 *
 * @param {(x:number,y:number,z:number)=>{x:number,y:number,scale:number}} P projector
 * @param {number} side -1 for the left wall (sunlit), +1 for the right (shadow)
 */
export function drawWallSegment(ctx, P, side, z0, z1, seed, alpha) {
  const wx = side * ALLEY_HALF;
  const a = P(wx, 0, z0), b = P(wx, WALL_H, z0);
  const c = P(wx, WALL_H, z1), d = P(wx, 0, z1);
  if (!a || !b || !c || !d) return;

  const len = z1 - z0;
  // Distance straight out of the near/far scale ratio, so LOD cutoffs are
  // resolution independent instead of tied to pixels-per-unit.
  const ratio = a.scale / Math.max(1e-4, d.scale);
  const dz = len / Math.max(0.02, ratio - 1);
  const lod = dz < 15 ? 2 : dz < 40 ? 1 : 0;

  S.ctx = ctx; S.P = P; S.wx = wx; S.side = side;
  S.z0 = z0; S.z1 = z1; S.len = len; S.seed = seed; S.lod = lod;
  S.dz = dz;
  S.u = (a.scale + d.scale) * 0.5;
  S.lit = side < 0;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';

  const kind = Math.floor(hash01(seed * 1.31) * 6) % 6;
  const bases = [PAL.stuccoA, PAL.stuccoB, PAL.stuccoC, PAL.stuccoD, PAL.brick, PAL.stuccoB];
  // The left wall eats the low sun; the right one sits in its own shadow.
  const shade = (S.lit ? 1.03 : 0.56) * (0.88 + hash01(seed * 2.11) * 0.24);
  S.base = tint(bases[kind], shade);
  S.wearCol = tintA(bases[kind], shade, 0.46);
  quad(ctx, a, b, c, d, S.base);

  shadingBands();
  buildingSeam();

  // Kinds that carry a piece of their own set this, so a wall never ends up
  // with two full throw-ups fighting over four metres.
  S.tagged = false;

  switch (kind) {
    case 0: kindGarage(); break;
    case 1: kindWindows(); break;
    case 2: kindMural(); break;
    case 3: kindBrick(); break;
    case 4: kindStorefront(); break;
    default: kindCanvas(); break;
  }

  // Paint, THEN grime, THEN the hardware. Grime laid over the tags is half of
  // why they read as painted onto the wall rather than pasted onto it, and the
  // fire escape has to come last because it is the only thing here with depth.
  if (lod > 0 && !S.tagged && hash01(seed * 5.3) > 0.5) {
    const col = TAG_COLORS[Math.floor(hash01(seed * 2.9) * TAG_COLORS.length)];
    autoTag(S, z0 + len * (0.12 + hash01(seed * 6.7) * 0.3),
      WALL_H * (0.16 + hash01(seed * 8.1) * 0.16),
      len * 0.5, WALL_H * 0.2, col, seed * 3.3);
  }
  if (lod > 0) grimeStreaks();
  alleyFixtures();

  // One wash over the finished segment so paint, glass and graffiti all obey
  // the same light — without it the murals read equally bright on both walls.
  face(z0, z1, 0, WALL_H, S.lit ? 'rgba(255,166,92,0.1)' : 'rgba(40,24,64,0.38)');

  // Coping: dark cap, plus a hot edge where the sun clips the parapet.
  face(z0, z1, WALL_H * 0.93, WALL_H, 'rgba(26,13,30,0.55)');
  face(z0, z1, WALL_H * 0.985, WALL_H,
    S.lit ? 'rgba(255,206,142,0.75)' : 'rgba(178,150,200,0.3)');
  // Grime pooling where the wall meets the asphalt.
  face(z0, z1, 0, WALL_H * 0.045, 'rgba(14,7,18,0.6)');

  ctx.restore();
}

// Band overlays are pure functions of (count, lit) — cache the colour strings
// so a full frame of walls builds none of them.
const BAND_CACHE = {};
function bandColors(n, lit) {
  const key = n * 2 + (lit ? 1 : 0);
  let arr = BAND_CACHE[key];
  if (arr) return arr;
  arr = [];
  for (let r = 0; r < n; r++) {
    const tm = (r + 0.5) / n;
    if (tm < 0.55) {
      const k = (0.55 - tm) / 0.55;
      arr.push(`rgba(22,10,26,${(k * k * (lit ? 0.5 : 0.66)).toFixed(3)})`);
    } else {
      const k = (tm - 0.55) / 0.45;
      arr.push(lit
        ? `rgba(255,166,88,${(k * k * 0.36).toFixed(3)})`
        : `rgba(112,86,156,${(k * k * 0.22).toFixed(3)})`);
    }
  }
  BAND_CACHE[key] = arr;
  return arr;
}

/** Perspective-correct vertical shading: grime low, sunlight high. */
function shadingBands() {
  const n = S.lod === 2 ? 8 : S.lod === 1 ? 5 : 3;
  const cols = bandColors(n, S.lit);
  for (let r = 0; r < n; r++) {
    face(S.z0, S.z1, (r / n) * WALL_H, ((r + 1) / n) * WALL_H, cols[r]);
  }
}

/** A pilaster on the near edge so the run reads as buildings, not one wall. */
function buildingSeam() {
  const w = S.len * 0.035;
  if (S.lod > 0) {
    face(S.z0, S.z0 + w, 0, WALL_H,
      S.lit ? 'rgba(255,196,132,0.18)' : 'rgba(150,130,190,0.08)');
  }
  face(S.z0 + w, S.z0 + w * 2, 0, WALL_H, 'rgba(18,9,22,0.4)');
}

/** Water stains bleeding down off the parapet. */
function grimeStreaks() {
  const n = S.lod === 2 ? 8 : 4;
  const ctx = S.ctx;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const h1 = hash01(S.seed * 3.3 + i * 7.7);
    const zz = S.z0 + h1 * S.len * 0.95;
    const w = S.len * (0.005 + hash01(S.seed + i * 3.1) * 0.022);
    addFace(zz, zz + w, WALL_H * (0.08 + hash01(S.seed * 5 + i) * 0.48),
      WALL_H * (0.86 + h1 * 0.1));
  }
  ctx.fillStyle = 'rgba(30,16,34,0.22)';
  ctx.fill();
}

// ------------------------------------------------------------ wall features

function kindGarage() {
  const { z0, len, lod, seed } = S;
  const zA = z0 + len * 0.1, zB = z0 + len * 0.76;
  garageDoor(zA, zB, WALL_H * 0.6);
  if (lod > 0) {
    // A painted board over the bay is what turns a shutter into the back of a
    // business. It is also the biggest single block of value on the wall.
    signBoard(zA, zB, WALL_H * 0.67, WALL_H * 0.85,
      pickSign(S, seed * 4.3, (zB - zA) * 0.9, WALL_H * 0.11),
      TAG_COLORS[Math.floor(hash01(seed * 7.7) * TAG_COLORS.length)]);
    meterBox(z0 + len * 0.83, WALL_H * 0.3, len * 0.09, WALL_H * 0.14);
    downpipe(z0 + len * 0.95, WALL_H * 0.92);
    // Roll-up shutters get hit first and hardest — that is what they are for.
    if (hash01(seed * 9.7) > 0.46) {
      autoTag(S, zA + (zB - zA) * 0.08, WALL_H * 0.14, (zB - zA) * 0.8, WALL_H * 0.22,
        TAG_COLORS[Math.floor(hash01(seed * 5.1) * TAG_COLORS.length)], seed * 6.1);
      S.tagged = true;
    }
  }
  if (lod === 2) { bollard(zA - 0.16); bollard(zB + 0.16); }
}

function kindWindows() {
  const { z0, len, lod } = S;
  if (lod > 0) barWindow(z0 + len * 0.08, z0 + len * 0.34, WALL_H * 0.4, WALL_H * 0.68);
  barWindow(z0 + len * 0.42, z0 + len * 0.68, WALL_H * 0.4, WALL_H * 0.68);
  doorway(z0 + len * 0.76, z0 + len * 0.96, WALL_H * 0.5);
  if (lod > 0) {
    // One hard band across the heads of the openings. A single dark rectangle
    // does more for "this is a building" than any amount of moulding.
    face(z0, z0 + len, WALL_H * 0.7, WALL_H * 0.765, 'rgba(13,6,17,0.5)');
    face(z0, z0 + len, WALL_H * 0.755, WALL_H * 0.775,
      S.lit ? 'rgba(255,214,158,0.55)' : 'rgba(152,142,184,0.2)');
    conduit(z0 + len * 0.72, WALL_H * 0.28, WALL_H * 0.7);
  }
  if (lod === 2) {
    // through-wall AC dripping onto the stucco below it
    face(z0 + len * 0.44, z0 + len * 0.6, WALL_H * 0.22, WALL_H * 0.34, 'rgba(10,5,14,0.8)');
    face(z0 + len * 0.445, z0 + len * 0.595, WALL_H * 0.235, WALL_H * 0.335, '#4d5460');
    face(z0 + len * 0.445, z0 + len * 0.595, WALL_H * 0.315, WALL_H * 0.335, '#7d8593');
    face(z0 + len * 0.5, z0 + len * 0.53, 0, WALL_H * 0.235, 'rgba(26,16,32,0.32)');
  }
}

function kindMural() {
  const { z0, len } = S;
  mural(z0 + len * 0.07, z0 + len * 0.93, WALL_H * 0.18, WALL_H * 0.78, S.seed);
  S.tagged = true;
  if (S.lod > 0) downpipe(z0 + len * 0.985, WALL_H * 0.9);
}

function kindBrick() {
  const { z0, z1, len, u, lod, ctx } = S;
  const rows = lod === 2 ? 12 : 7;
  const rh = WALL_H / rows;

  ctx.beginPath();
  for (let r = 1; r < rows; r++) edge(z0, r * rh, z1, r * rh);
  strokeNow('rgba(228,206,188,0.28)', u * 0.011);

  if (lod === 2) {
    const bw = 0.78;
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      const y = r * rh, off = (r % 2) * bw * 0.5;
      for (let z = z0 + off; z < z1; z += bw) edge(z, y + rh * 0.1, z, y + rh * 0.9);
    }
    strokeNow('rgba(228,206,188,0.18)', u * 0.008);

    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const r = Math.floor(hash01(S.seed + i * 2.7) * rows);
      const z = z0 + hash01(S.seed * 4.3 + i * 9.7) * (len - bw);
      addFace(z, z + bw * 0.88, r * rh + rh * 0.12, r * rh + rh * 0.88);
    }
    ctx.fillStyle = 'rgba(58,24,26,0.26)';
    ctx.fill();
  }

  barWindow(z0 + len * 0.14, z0 + len * 0.4, WALL_H * 0.44, WALL_H * 0.72);
  if (lod > 0) {
    vent(z0 + len * 0.56, WALL_H * 0.56, len * 0.14, WALL_H * 0.12);
    downpipe(z0 + len * 0.88, WALL_H * 0.93);
    // An old painted ad still legible under fifty years of soot. Flat, no
    // keyline — the brick eats it rather than the other way round.
    const text = pickSign(S, S.seed * 9.1, len * 0.5, WALL_H * 0.14);
    if (text) {
      ghostWord(S, text, z0 + len * 0.24, WALL_H * 0.15, len * 0.52, WALL_H * 0.14,
        'rgba(238,224,202,0.32)', S.seed * 9.1);
      S.tagged = true;
    }
  }
}

function kindStorefront() {
  const { z0, len, lod, seed } = S;
  // boarded-up window: plywood over the opening
  face(z0 + len * 0.08, z0 + len * 0.56, WALL_H * 0.24, WALL_H * 0.66, 'rgba(10,5,14,0.9)');
  faceGrad(z0 + len * 0.1, z0 + len * 0.54, WALL_H * 0.26, WALL_H * 0.64,
    '#5a4530', '#8a6c46');
  if (lod > 0) {
    const ctx = S.ctx;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const z = z0 + len * (0.1 + (0.44 * i) / 4);
      edge(z, WALL_H * 0.26, z, WALL_H * 0.64);
    }
    strokeNow('rgba(30,18,12,0.5)', S.u * 0.012);
  }
  awning(z0 + len * 0.06, z0 + len * 0.6, WALL_H * 0.74, 0.5);
  doorway(z0 + len * 0.68, z0 + len * 0.88, WALL_H * 0.52);
  if (lod > 0) {
    signBoard(z0 + len * 0.05, z0 + len * 0.72, WALL_H * 0.77, WALL_H * 0.915,
      pickSign(S, seed * 2.9, len * 0.6, WALL_H * 0.09),
      TAG_COLORS[Math.floor(hash01(seed * 3.7) * TAG_COLORS.length)]);
  }
  if (lod === 2) {
    // flyers pasted next to the door
    face(z0 + len * 0.92, z0 + len * 0.97, WALL_H * 0.32, WALL_H * 0.44, 'rgba(242,232,210,0.75)');
    face(z0 + len * 0.93, z0 + len * 0.98, WALL_H * 0.2, WALL_H * 0.3, 'rgba(255,201,60,0.7)');
  }
}

function kindCanvas() {
  const { z0, len, lod, seed } = S;
  // A clean-ish stucco face that exists to carry one big piece. This is the
  // wall the crew stencil goes up on.
  const col = TAG_COLORS[Math.floor(hash01(seed * 4.9) * TAG_COLORS.length)];
  if (lod === 2 && logoReady() && hash01(seed * 8.3) > 0.52) {
    logoStencil(S, z0 + len * 0.4, WALL_H * 0.24, WALL_H * 0.44, seed * 2.1);
  } else {
    autoTag(S, z0 + len * 0.12, WALL_H * 0.28, len * 0.68, WALL_H * 0.26, col, seed * 2.1);
  }
  S.tagged = true;
  if (lod > 0) {
    vent(z0 + len * 0.08, WALL_H * 0.78, len * 0.12, WALL_H * 0.1);
    vent(z0 + len * 0.3, WALL_H * 0.78, len * 0.12, WALL_H * 0.1);
    downpipe(z0 + len * 0.72, WALL_H * 0.94);
    meterBox(z0 + len * 0.86, WALL_H * 0.34, len * 0.1, WALL_H * 0.16);
  }
}

function garageDoor(za, zb, hTop) {
  const { u, lod, lit, ctx } = S;
  // Painted surround, then a near-black reveal. The jump from the brightest
  // value on the wall to the darkest across one edge is what makes the bay
  // read as a hole rather than a panel.
  if (lod > 0) {
    face(za - 0.19, zb + 0.19, 0, hTop + 0.26,
      lit ? 'rgba(252,232,198,0.42)' : 'rgba(146,136,178,0.15)');
  }
  face(za - 0.1, zb + 0.1, 0, hTop + 0.16, 'rgba(6,3,10,0.88)');          // reveal
  faceGrad(za, zb, 0, hTop, tint(PAL.garage, lit ? 0.5 : 0.32),
    tint(PAL.garage, lit ? 1.1 : 0.68));

  const n = lod === 2 ? 9 : lod === 1 ? 6 : 4;
  ctx.beginPath();
  for (let i = 1; i < n; i++) edge(za, (i / n) * hTop, zb, (i / n) * hTop);
  strokeNow('rgba(8,4,12,0.5)', u * 0.014);
  if (lod === 2) {
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      const y = (i / n) * hTop + hTop * 0.022;
      edge(za, y, zb, y);
    }
    strokeNow(lit ? 'rgba(255,218,174,0.34)' : 'rgba(186,196,224,0.16)', u * 0.009);
  }

  if (lod > 0) {
    face(za, za + 0.05, 0, hTop, 'rgba(8,4,12,0.45)');                     // guide rails
    face(zb - 0.05, zb, 0, hTop, 'rgba(8,4,12,0.45)');
    // Heavy bottom rail + rubber seal. A roll-up door's silhouette is that
    // one thick dark bar sitting on the asphalt.
    face(za - 0.02, zb + 0.02, 0, 0.19, tint(PAL.garage, lit ? 0.44 : 0.26));
    face(za - 0.02, zb + 0.02, 0.16, 0.19, lit ? 'rgba(255,222,178,0.4)' : 'rgba(180,190,220,0.16)');
    face(za, zb, 0, 0.06, 'rgba(6,3,9,0.9)');
    face(za - 0.09, zb + 0.09, hTop - 0.05, hTop + 0.11, 'rgba(9,4,13,0.82)'); // lintel
    const mz = (za + zb) * 0.5;
    face(mz - 0.18, mz + 0.18, hTop * 0.15, hTop * 0.2, 'rgba(18,12,24,0.85)');
    face(mz - 0.18, mz + 0.18, hTop * 0.19, hTop * 0.2, 'rgba(200,196,210,0.25)');
  }
}

function barWindow(za, zb, y0, y1) {
  const { u, lod, lit, ctx } = S;
  if (lod > 0) {
    face(za - 0.08, zb + 0.08, y0 - 0.08, y1 + 0.1,
      lit ? 'rgba(248,230,208,0.42)' : 'rgba(150,140,178,0.16)');          // painted surround
  }
  face(za - 0.03, zb + 0.03, y0 - 0.03, y1 + 0.04, 'rgba(10,5,14,0.85)');  // reveal shadow
  // Glass takes the sky at the top and goes black toward the sill.
  faceGrad(za, zb, y0, y1, '#0d1120',
    lit ? 'rgba(255,186,116,0.8)' : 'rgba(118,138,190,0.5)');

  if (lod > 0) {
    // Fewer, fatter bars. Security grilles read by their rhythm, and a fine
    // one turns to grey mush two segments away where a coarse one still reads.
    const nb = lod === 2 ? 4 : 3;
    ctx.beginPath();
    for (let i = 1; i <= nb; i++) {
      const z = za + (zb - za) * (i / (nb + 1));
      edge(z, y0, z, y1);
    }
    edge(za, (y0 + y1) * 0.5, zb, (y0 + y1) * 0.5);
    strokeNow('rgba(5,2,9,0.88)', u * 0.03);
    if (lod === 2) {
      ctx.beginPath();
      for (let i = 1; i <= nb; i++) {
        const z = za + (zb - za) * (i / (nb + 1)) - 0.015;
        edge(z, y0, z, y1);
      }
      strokeNow('rgba(190,190,210,0.28)', u * 0.009);                      // round-bar rim
    }
    // Lintel: one hard shadow bar over the head of the opening.
    face(za - 0.12, zb + 0.12, y1 + 0.04, y1 + 0.13, 'rgba(9,4,13,0.62)');
    face(za - 0.1, zb + 0.1, y0 - 0.11, y0 - 0.03,
      lit ? 'rgba(255,208,152,0.8)' : 'rgba(86,78,110,0.65)');             // sill
  }
}

function doorway(za, zb, h) {
  const { P, wx, side, ctx, lod, lit } = S;
  if (lod > 0) {
    face(za - 0.08, zb + 0.08, 0, h + 0.12,
      lit ? 'rgba(250,232,206,0.32)' : 'rgba(140,132,170,0.14)');
  }
  face(za, zb, 0, h, 'rgba(8,4,12,0.92)');
  faceGrad(za + 0.05, zb - 0.05, 0, h - 0.07, '#241b24', lit ? '#5a4652' : '#3c3040');
  if (lod === 0) return;
  face(za + 0.16, zb - 0.16, h * 0.52, h * 0.86, 'rgba(0,0,0,0.28)');
  face(za + 0.16, zb - 0.16, h * 0.1, h * 0.44, 'rgba(0,0,0,0.28)');
  face(zb - 0.2, zb - 0.14, h * 0.44, h * 0.5, PAL.gold);
  // A real step out into the alley — the only bit of wall geometry with depth.
  const fx = wx - side * 0.26;
  const q1 = P(wx, 0.13, za), q2 = P(fx, 0.13, za), q3 = P(fx, 0.13, zb), q4 = P(wx, 0.13, zb);
  if (q1 && q2 && q3 && q4) quad(ctx, q1, q2, q3, q4, lit ? '#8d7d80' : '#4a4250');
  const r1 = P(fx, 0.13, za), r2 = P(fx, 0, za), r3 = P(fx, 0, zb), r4 = P(fx, 0.13, zb);
  if (r1 && r2 && r3 && r4) quad(ctx, r1, r2, r3, r4, '#2a222e');
}

function awning(za, zb, yTop, depth) {
  const { P, wx, side, ctx, lit } = S;
  const fx = wx - side * depth;
  const yFront = yTop - 0.4;
  const ci = Math.floor(hash01(S.seed * 6.3) * TAG_COLORS.length);
  const c1 = TAG_COLORS[ci];
  // Sloped top surface, striped; the sunlit wall gets the saturated version.
  // At distance the stripes are sub-pixel, so it collapses to one solid slab.
  const n = S.lod > 0 ? 6 : 1;
  for (let pass = 0; pass < Math.min(2, n); pass++) {
    ctx.beginPath();
    for (let i = pass; i < n; i += 2) {
      const zA = za + (zb - za) * (i / n), zB = za + (zb - za) * ((i + 1) / n);
      const p1 = P(wx, yTop, zA), p2 = P(fx, yFront, zA);
      const p3 = P(fx, yFront, zB), p4 = P(wx, yTop, zB);
      if (!p1 || !p2 || !p3 || !p4) continue;
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
    }
    ctx.fillStyle = pass === 0
      ? tintA(c1, lit ? 0.95 : 0.5, 0.95)
      : tintA('#f7edd8', lit ? 0.95 : 0.5, 0.95);
    ctx.fill();
  }
  // Valance hanging off the front edge, plus the shadow it throws on the wall.
  const v1 = P(fx, yFront, za), v2 = P(fx, yFront - 0.2, za);
  const v3 = P(fx, yFront - 0.2, zb), v4 = P(fx, yFront, zb);
  if (v1 && v2 && v3 && v4) quad(ctx, v1, v2, v3, v4, 'rgba(18,10,22,0.6)');
  face(za, zb, yFront - 0.75, yFront, 'rgba(16,8,20,0.28)');
}

function mural(za, zb, y0, y1, sd) {
  const { ctx, lod } = S;
  const ci = Math.floor(hash01(sd * 7.7) * TAG_COLORS.length);
  const c1 = TAG_COLORS[ci];
  const c2 = TAG_COLORS[(ci + 2) % TAG_COLORS.length];
  const c3 = TAG_COLORS[(ci + 4) % TAG_COLORS.length];

  // Everything here is painted ON stucco, so nothing goes fully opaque — the
  // wall's own colour and grime keep showing through.
  face(za - 0.06, zb + 0.06, y0 - 0.06, y1 + 0.06, 'rgba(14,7,18,0.35)');
  faceGrad(za, zb, y0, y1, tintA(c1, 0.24, 0.72), tintA(c1, 0.62, 0.72));

  // Clip so the sunburst can overrun the panel edges without escaping it.
  ctx.save();
  ctx.beginPath();
  addFace(za, zb, y0, y1);
  ctx.clip();

  const zc = (za + zb) * 0.5, yc = y0 + (y1 - y0) * 0.42;
  const rz = (zb - za) * 0.5, ry = (y1 - y0) * 0.5;
  // Six fat rays, not nine thin ones. A mural seen at 40kph is a silhouette;
  // count reads as noise, width reads as design.
  const nr = 6;
  const pc = S.P(S.wx, yc, zc);
  if (pc) {
    ctx.beginPath();
    for (let i = 0; i < nr; i++) {
      const a = (i / nr) * TAU + 0.2;
      const w = 0.115;
      const pa = S.P(S.wx, yc + Math.sin(a - w) * ry * 2, zc + Math.cos(a - w) * rz * 2);
      const pb = S.P(S.wx, yc + Math.sin(a + w) * ry * 2, zc + Math.cos(a + w) * rz * 2);
      if (!pa || !pb) continue;
      ctx.moveTo(pc.x, pc.y);
      ctx.lineTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.closePath();
    }
    ctx.fillStyle = tintA(c2, 0.85, 0.5);
    ctx.fill();
  }

  ctx.beginPath();
  addArc(zc, yc, rz * 0.26, ry * 0.26, 0, TAU, lod === 2 ? 14 : 8, true);
  ctx.fillStyle = 'rgba(255,201,60,0.6)';
  ctx.fill();
  ctx.beginPath();
  addArc(zc, yc, rz * 0.16, ry * 0.16, 0, TAU, lod === 2 ? 12 : 7, true);
  ctx.fillStyle = tintA(c3, 0.9, 0.6);
  ctx.fill();

  face(za, zb, y0, y0 + (y1 - y0) * 0.1, 'rgba(20,10,26,0.4)');
  face(za, zb, y0 + (y1 - y0) * 0.1, y0 + (y1 - y0) * 0.14, tintA(c3, 0.9, 0.55));
  ctx.restore();

  // A mural is a commissioned piece, so it gets a name across it rather than
  // an anonymous throw-up — and this is the wall the crew signs.
  if (lod > 0) {
    const bz = za + (zb - za) * 0.12, bw = (zb - za) * 0.76, bh = (y1 - y0) * 0.28;
    const by = y0 + (y1 - y0) * 0.16;
    const text = pickWord(S, sd * 5.7, bw, bh);
    if (text) wordTag(S, text, bz, by, bw, bh, '#f7edd8', sd * 5.7);
    else throwUp(S, bz, by, bw, bh, '#f7edd8', sd * 5.7);
    if (lod === 2 && logoReady() && hash01(sd * 6.9) > 0.5) {
      logoStencil(S, zb - (zb - za) * 0.12, y0 + (y1 - y0) * 0.6,
        (y1 - y0) * 0.28, sd * 8.3);
    }
  }
  // Painted border, brighter on the sunlit wall.
  ctx.beginPath();
  addFace(za, zb, y0, y1);
  strokeNow(S.lit ? 'rgba(255,224,178,0.5)' : 'rgba(160,150,190,0.28)', S.u * 0.012);
}

function downpipe(zz, hTop) {
  const w = 0.09;
  face(zz - 0.03, zz + w + 0.05, 0, hTop, 'rgba(10,5,14,0.35)');           // cast shadow
  face(zz, zz + w * 0.35, 0, hTop, '#2a2430');
  face(zz + w * 0.35, zz + w * 0.72, 0, hTop, S.lit ? '#6d6274' : '#41394c');
  face(zz + w * 0.72, zz + w, 0, hTop, S.lit ? '#9a8ba0' : '#544a60');
  if (S.lod === 2) {
    face(zz - 0.03, zz + w + 0.03, hTop * 0.36, hTop * 0.4, '#241d2a');     // brackets
    face(zz - 0.03, zz + w + 0.03, hTop * 0.74, hTop * 0.78, '#241d2a');
    face(zz - 0.05, zz + w + 0.05, 0, 0.16, '#241d2a');                    // shoe
  }
}

function vent(zc, yc, w, h) {
  const ctx = S.ctx;
  face(zc - 0.03, zc + w + 0.03, yc - 0.03, yc + h + 0.03, 'rgba(10,5,14,0.7)');
  face(zc, zc + w, yc, yc + h, '#14101a');
  if (S.lod === 2) {
    ctx.beginPath();
    for (let i = 1; i < 4; i++) edge(zc, yc + (h * i) / 4, zc + w, yc + (h * i) / 4);
    strokeNow('rgba(168,158,182,0.4)', S.u * 0.011);
  }
  face(zc - 0.04, zc + w + 0.04, yc + h, yc + h + 0.04,
    S.lit ? 'rgba(226,210,224,0.4)' : 'rgba(140,130,164,0.22)');
}

/** A run of surface conduit — three flat strips and two straps, no more. */
function conduit(zz, y0, y1) {
  face(zz - 0.02, zz + 0.07, y0, y1, 'rgba(10,5,14,0.35)');
  face(zz, zz + 0.05, y0, y1, S.lit ? '#7a7080' : '#443c50');
  face(zz, zz + 0.02, y0, y1, '#241d2a');
  face(zz - 0.03, zz + 0.08, y0 + (y1 - y0) * 0.3, y0 + (y1 - y0) * 0.34, '#241d2a');
  face(zz - 0.03, zz + 0.08, y0 + (y1 - y0) * 0.78, y0 + (y1 - y0) * 0.82, '#241d2a');
}

/** Steel pipe bollard guarding a loading bay. Real depth, so it silhouettes. */
function bollard(z) {
  const h = 0.85, out = 0.34;
  const shaft = S.lit ? '#c8a23c' : '#6d5a30';
  fixPoly([[0, 0, z - 0.09], [out, 0, z - 0.09], [out, 0, z + 0.09], [0, 0, z + 0.09]],
    'rgba(8,4,12,0.5)');                                                   // contact shadow
  fixPoly([[out, 0, z - 0.09], [out, h, z - 0.09], [out, h, z + 0.09], [out, 0, z + 0.09]], shaft);
  fixPoly([[out, 0, z + 0.04], [out, h, z + 0.04], [out, h, z + 0.09], [out, 0, z + 0.09]],
    'rgba(10,5,14,0.4)');                                                  // round-off
  fixPoly([[out, h - 0.14, z - 0.09], [out, h - 0.09, z - 0.09],
           [out, h - 0.09, z + 0.09], [out, h - 0.14, z + 0.09]], 'rgba(14,7,18,0.6)');
}

function meterBox(zc, yc, w, h) {
  face(zc - 0.04, zc + w + 0.04, yc - 0.04, yc + h, 'rgba(10,5,14,0.5)');
  faceGrad(zc, zc + w, yc, yc + h, '#2f3540', S.lit ? '#6a7280' : '#414855');
  face(zc, zc + w, yc + h - 0.04, yc + h, S.lit ? '#8b93a2' : '#525a68');
  if (S.lod === 2) {
    face(zc + w * 0.35, zc + w * 0.65, 0, yc, 'rgba(24,16,30,0.55)');       // conduit
    face(zc + w * 0.2, zc + w * 0.8, yc + h * 0.45, yc + h * 0.7, 'rgba(255,201,60,0.35)');
  }
}

/**
 * A flat painted sign board — the single strongest "back of a real building"
 * cue there is, and it costs three fills and a word. Deliberately blunt: a
 * dark plate, a bright field, a keyline, lettering. No gradients, no chrome.
 */
function signBoard(za, zb, y0, y1, text, col, ink) {
  // A sign on a wall segment level with the camera projects across most of the
  // screen as a flat slab — it lands over the score, reads as a UI panel rather
  // than as signage, and its lettering is far too large to parse. Signs are the
  // biggest thing on a wall, so they need a wider berth than the tags (3.5) or
  // the bolt-on fixtures (2.5).
  // Measured: the nearest segment the renderer draws sits at dz ~4.4, so a 4.0
  // gate lets the closest wall keep its sign — and a sign there lands square in
  // the top corner behind the score, reading as a UI panel rather than as
  // signage. 9 keeps them at a distance where the lettering is still legible
  // but the board no longer competes with the HUD.
  if (S.dz < 9.0) return;
  face(za - 0.05, zb + 0.05, y0 - 0.05, y1 + 0.05, 'rgba(10,5,14,0.7)');   // shadow/plate
  face(za, zb, y0, y1, tintA(col, S.lit ? 1 : 0.6, 0.95));
  face(za, zb, y1 - (y1 - y0) * 0.14, y1, 'rgba(255,255,255,0.14)');       // top light
  face(za, zb, y0, y0 + (y1 - y0) * 0.16, 'rgba(12,6,16,0.3)');            // bottom shade
  if (!text) return;
  const pad = (y1 - y0) * 0.2;
  // No clip: the lettering is laid out inside the board with padding, so it
  // cannot escape, and a wall-face clip per sign is not worth the layer.
  ghostWord(S, text, za + (zb - za) * 0.05, y0 + pad, (zb - za) * 0.9,
    (y1 - y0) - pad * 2, ink || 'rgba(16,8,20,0.9)', S.seed * 4.3, { noClip: true });
}

// ---------------------------------------------------------------- fixtures
//
// Hardware bolted to the walls: drainpipes, AC units, fire escapes, service
// lamps. This is most of what separates "an alley" from "a corridor with murals
// on it" — the silhouette of a fire escape against the sunset is the single
// most recognisable thing in the frame after the graffiti.
//
// Everything projects off the wall plane by offsetting x toward the middle of
// the alley, so these read as real objects with depth rather than as more paint.

/** Project a point that sits `out` units off the wall, into the alley. */
function offWall(out, y, z) {
  return S.P(S.wx - S.side * out, y, z);
}

function fixPoly(pts, fill) {
  const { ctx } = S;
  const p = pts.map(([o, y, z]) => offWall(o, y, z));
  if (p.some((q) => !q)) return false;
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  return true;
}

function fixLine(a, b, col, w) {
  const { ctx } = S;
  const p = offWall(a[0], a[1], a[2]);
  const q = offWall(b[0], b[1], b[2]);
  if (!p || !q) return;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(0.5, p.scale * w);
  ctx.stroke();
}

function alleyFixtures() {
  const { lod, seed, z0, len, lit } = S;
  if (lod === 0 || S.dz < 2.5) return;
  const r = hash01(seed * 4.41);

  if (r < 0.3) fireEscape(z0 + len * 0.15);
  else if (r < 0.52) acUnit(z0 + len * (0.25 + hash01(seed * 3.3) * 0.4));
  if (hash01(seed * 6.13) > 0.55) drainPipe(z0 + len * (0.1 + hash01(seed * 2.7) * 0.75));
  if (lod === 2 && hash01(seed * 8.9) > 0.72) wallLamp(z0 + len * 0.5);
}

/** Rusted steel landing with a rail and a stair run down to the next floor. */
function fireEscape(z) {
  const lit = S.lit;
  const steel = lit ? '#6d6a72' : '#4a4652';
  const dark = lit ? '#3d3a44' : '#2b2833';
  const rust = '#7a4a32';
  const w = 1.5;                     // how far along z the landing runs
  const out = 0.5;                   // how far it sticks into the alley

  for (const lvl of [2.35, 3.5]) {
    // underside first, so the deck reads as having thickness
    fixPoly([[0, lvl - 0.07, z], [out, lvl - 0.07, z], [out, lvl - 0.07, z + w], [0, lvl - 0.07, z + w]], dark);
    fixPoly([[0, lvl, z], [out, lvl, z], [out, lvl, z + w], [0, lvl, z + w]], steel);

    // Slatted deck — a few gaps so light shows through.
    for (let i = 1; i < 5; i++) {
      const zz = z + (w * i) / 5;
      fixLine([0, lvl + 0.002, zz], [out, lvl + 0.002, zz], 'rgba(18,12,24,0.5)', 0.012);
    }

    // rail: top bar, uprights, mid bar
    fixLine([out, lvl, z], [out, lvl + 0.52, z], steel, 0.022);
    fixLine([out, lvl, z + w], [out, lvl + 0.52, z + w], steel, 0.022);
    fixLine([out, lvl + 0.52, z], [out, lvl + 0.52, z + w], steel, 0.026);
    fixLine([out, lvl + 0.27, z], [out, lvl + 0.27, z + w], rust, 0.016);
    for (let i = 1; i < 4; i++) {
      const zz = z + (w * i) / 4;
      fixLine([out, lvl, zz], [out, lvl + 0.52, zz], dark, 0.012);
    }

    // brackets tying the landing back to the brick
    fixLine([0, lvl - 0.05, z + 0.1], [out * 0.9, lvl - 0.42, z + 0.1], rust, 0.02);
    fixLine([0, lvl - 0.05, z + w - 0.1], [out * 0.9, lvl - 0.42, z + w - 0.1], rust, 0.02);
  }

  // Stair run between the two landings, drawn as a filled ramp plus treads.
  fixPoly([[out * 0.15, 3.5, z + w], [out * 0.85, 3.5, z + w],
           [out * 0.85, 2.42, z + w + 0.95], [out * 0.15, 2.42, z + w + 0.95]], dark);
  for (let i = 0; i <= 7; i++) {
    const k = i / 7;
    const y = 3.5 - k * 1.08;
    const zz = z + w + k * 0.95;
    fixLine([out * 0.15, y, zz], [out * 0.85, y, zz], steel, 0.016);
  }
}

/** Window-mounted air conditioner, dripping onto the asphalt below. */
function acUnit(z) {
  const body = S.lit ? '#8b8894' : '#5d5a68';
  const shade = S.lit ? '#6a6773' : '#43404b';
  const y = 2.1 + hash01(z * 3.1) * 0.8;
  const w = 0.52, out = 0.26;

  fixPoly([[0, y, z], [out, y, z], [out, y, z + w], [0, y, z + w]], shade);        // underside
  fixPoly([[out, y, z], [out, y + 0.42, z], [out, y + 0.42, z + w], [out, y, z + w]], body);
  fixPoly([[0, y + 0.42, z], [out, y + 0.42, z], [out, y + 0.42, z + w], [0, y + 0.42, z + w]],
    'rgba(255,255,255,0.1)');
  // grille
  for (let i = 1; i < 5; i++) {
    const yy = y + 0.08 + i * 0.07;
    fixLine([out + 0.004, yy, z + 0.05], [out + 0.004, yy, z + w - 0.05], 'rgba(20,14,26,0.45)', 0.012);
  }
  // the stain it has left down the wall
  face(z + 0.1, z + w - 0.1, 0, y, 'rgba(40,52,60,0.12)');
}

/** Cast-iron downpipe with joint collars. */
function drainPipe(z) {
  const col = S.lit ? '#5a5560' : '#403c48';
  const hi = S.lit ? 'rgba(255,220,180,0.3)' : 'rgba(190,180,220,0.14)';
  fixLine([0.09, 0, z], [0.09, WALL_H * 0.96, z], col, 0.052);
  fixLine([0.065, 0, z], [0.065, WALL_H * 0.96, z], hi, 0.016);
  for (let i = 1; i < 6; i++) {
    const y = (WALL_H * 0.96 * i) / 6;
    fixLine([0.11, y, z - 0.03], [0.11, y, z + 0.03], '#2e2a36', 0.07);
  }
  // Wet patch where it has been discharging onto the wall for years.
  face(z - 0.12, z + 0.12, 0, WALL_H * 0.3, 'rgba(30,44,40,0.16)');
}

/** Bare service lamp in a cage — the only warm light down here. */
function wallLamp(z) {
  const { ctx } = S;
  const y = 2.9;
  const p = offWall(0.2, y, z);
  if (!p) return;
  const u = p.scale;

  fixLine([0, y + 0.16, z], [0.2, y + 0.06, z], '#3a3640', 0.026);

  // glow first, so the fixture sits inside its own halo
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, u * 0.75);
  g.addColorStop(0, 'rgba(255,214,140,0.5)');
  g.addColorStop(0.45, 'rgba(255,180,100,0.16)');
  g.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, u * 0.75, 0, TAU);
  ctx.fill();

  ctx.fillStyle = '#ffe9b0';
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(0.8, u * 0.055), 0, TAU);
  ctx.fill();

  // cage
  ctx.strokeStyle = 'rgba(30,24,34,0.75)';
  ctx.lineWidth = Math.max(0.5, u * 0.012);
  ctx.beginPath();
  ctx.arc(p.x, p.y, u * 0.09, 0, TAU);
  ctx.stroke();
}

// ------------------------------------------------------------------ skyline

/** Rooftop clutter poking above the wall line — silhouetted against the sun. */
export function drawSkyline(ctx, P, side, z0, seed, alpha) {
  const r = hash01(seed * 11.3);
  if (r > 0.72) return;
  const wx = side * (ALLEY_HALF + 0.1);
  const base = P(wx, WALL_H, z0 + 1.2 + hash01(seed * 2.3) * 1.8);
  if (!base) return;
  const u = base.scale;
  if (u < 1.6) return;

  ctx.save();
  ctx.globalAlpha = alpha * 0.94;
  ctx.translate(base.x, base.y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const near = u > 11;
  // Backlit: dark at the base, picking up sky glow toward the top.
  const sil = ctx.createLinearGradient(0, -u * 3.4, 0, u * 0.1);
  sil.addColorStop(0, '#553060');
  sil.addColorStop(0.45, '#2d1934');
  sil.addColorStop(1, '#160b1a');
  const rim = 'rgba(255,184,112,0.45)';
  const rimW = Math.max(0.5, u * 0.02);
  const solid = (fill) => {
    ctx.fillStyle = fill || sil;
    ctx.fill();
    if (near) { ctx.strokeStyle = rim; ctx.lineWidth = rimW; ctx.stroke(); }
  };

  if (r < 0.14) skyPalm(ctx, u, side, seed, sil, rim, near);
  else if (r < 0.23) skyPole(ctx, u, side, seed, sil, solid, near);
  else if (r < 0.31) skyTank(ctx, u, seed, sil, solid, near);
  else if (r < 0.39) skyAC(ctx, u, seed, solid, near);
  else if (r < 0.46) skyDish(ctx, u, side, seed, sil, solid);
  else if (r < 0.55) skyBillboard(ctx, u, side, seed, sil, solid, near);
  else if (r < 0.63) skyFence(ctx, u, seed, sil);
  else skyLaundry(ctx, u, seed, sil);

  ctx.restore();
}

function skyPalm(ctx, u, side, seed, sil, rim, near) {
  const th = u * (2.1 + hash01(seed * 5.1) * 1.5);
  const bend = (0.16 + hash01(seed * 8.3) * 0.3) * side;
  const tx = th * bend, ty = -th;

  ctx.strokeStyle = sil;
  ctx.lineWidth = Math.max(1.2, u * 0.085);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(tx * 0.15, -th * 0.55, tx, ty);
  ctx.stroke();

  const nf = near ? 9 : 6;
  ctx.beginPath();
  for (let f = 0; f < nf; f++) {
    const a = -Math.PI * 0.5 + (f - (nf - 1) / 2) * (1.5 / nf) * Math.PI * 0.62;
    const rr = u * (0.75 + hash01(seed * 3 + f) * 0.6);
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + Math.cos(a) * rr, ty + Math.sin(a) * rr,
      tx + Math.cos(a) * rr * 1.5, ty + Math.sin(a) * rr * 1.5 + rr * 0.5);
  }
  ctx.lineWidth = Math.max(1, u * 0.095);
  ctx.strokeStyle = sil;
  ctx.stroke();
  if (near) {
    ctx.lineWidth = Math.max(0.5, u * 0.025);
    ctx.strokeStyle = rim;
    ctx.stroke();
    ctx.fillStyle = '#2a1830';
    ctx.beginPath();
    ctx.arc(tx + u * 0.1, ty + u * 0.16, u * 0.09, 0, TAU);
    ctx.arc(tx - u * 0.11, ty + u * 0.2, u * 0.08, 0, TAU);
    ctx.fill();
  }
}

function skyPole(ctx, u, side, seed, sil, solid, near) {
  const h = u * (2.8 + hash01(seed * 4.4) * 1.1);
  ctx.beginPath();
  ctx.rect(-u * 0.055, -h, u * 0.11, h);
  ctx.rect(-u * 0.45, -h * 0.94, u * 0.9, u * 0.07);
  ctx.rect(-u * 0.36, -h * 0.78, u * 0.72, u * 0.06);
  solid();
  if (!near) return;
  ctx.fillStyle = sil;
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {                                          // insulators
    ctx.rect(i * u * 0.19 - u * 0.03, -h * 0.94 - u * 0.09, u * 0.06, u * 0.09);
  }
  ctx.fill();
  ctx.beginPath();                                                         // transformer can
  roundRect(ctx, u * 0.12, -h * 0.6, u * 0.26, u * 0.42, u * 0.06);
  solid();
  ctx.strokeStyle = sil;
  ctx.lineWidth = Math.max(0.6, u * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.9);
  ctx.lineTo(side * u * 0.9, 0);
  ctx.stroke();
}

function skyTank(ctx, u, seed, sil, solid, near) {
  const h = u * (1.5 + hash01(seed * 6.6) * 0.5);
  const w = u * 0.72;
  ctx.strokeStyle = sil;
  ctx.lineWidth = Math.max(1, u * 0.045);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const x = -w * 0.5 + (w * i) / 2;
    ctx.moveTo(x, 0);
    ctx.lineTo(x * 0.8, -h * 0.45);
  }
  ctx.moveTo(-w * 0.5, -h * 0.22);
  ctx.lineTo(w * 0.5, -h * 0.22);
  ctx.stroke();

  ctx.beginPath();
  ctx.rect(-w * 0.5, -h, w, h * 0.55);
  ctx.moveTo(-w * 0.56, -h);
  ctx.lineTo(0, -h * 1.3);
  ctx.lineTo(w * 0.56, -h);
  ctx.closePath();
  solid();
  if (near) {
    ctx.strokeStyle = sil;
    ctx.lineWidth = Math.max(0.6, u * 0.022);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      ctx.moveTo(w * 0.56, -h * 0.1 - i * h * 0.16);
      ctx.lineTo(w * 0.78, -h * 0.16 - i * h * 0.16);
    }
    ctx.moveTo(w * 0.56, 0);
    ctx.lineTo(w * 0.78, -h * 0.66);
    ctx.stroke();
  }
}

function skyAC(ctx, u, seed, solid, near) {
  const n = hash01(seed * 3.9) > 0.5 ? 2 : 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const w = u * (0.5 + hash01(seed + i * 4.2) * 0.28);
    const h = u * (0.42 + hash01(seed + i * 8.4) * 0.26);
    const x = -u * 0.55 + i * u * 0.75;
    roundRect(ctx, x, -h, w, h, u * 0.04);
  }
  solid();
  if (!near) return;
  ctx.strokeStyle = 'rgba(255,184,112,0.35)';
  ctx.lineWidth = Math.max(0.6, u * 0.018);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const w = u * (0.5 + hash01(seed + i * 4.2) * 0.28);
    const h = u * (0.42 + hash01(seed + i * 8.4) * 0.26);
    const x = -u * 0.55 + i * u * 0.75;
    ctx.moveTo(x + w * 0.78, -h * 0.5);
    ctx.arc(x + w * 0.5, -h * 0.5, w * 0.28, 0, TAU);
    for (let k = 1; k < 4; k++) {
      ctx.moveTo(x, -h + (h * k) / 4);
      ctx.lineTo(x + w * 0.16, -h + (h * k) / 4);
    }
  }
  ctx.stroke();
}

function skyDish(ctx, u, side, seed, sil, solid) {
  const h = u * (0.9 + hash01(seed * 7.2) * 0.5);
  ctx.beginPath();
  ctx.rect(-u * 0.04, -h, u * 0.08, h);
  solid();
  ctx.save();
  ctx.translate(0, -h);
  ctx.rotate(side * 0.45);
  ctx.beginPath();
  ctx.ellipse(0, 0, u * 0.16, u * 0.42, 0, 0, TAU);
  solid();
  ctx.strokeStyle = sil;
  ctx.lineWidth = Math.max(0.7, u * 0.03);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(u * 0.34, 0);
  ctx.stroke();
  ctx.restore();
}

function skyBillboard(ctx, u, side, seed, sil, solid, near) {
  const w = u * (1.5 + hash01(seed * 2.6) * 0.9);
  const h = u * (0.85 + hash01(seed * 9.4) * 0.35);
  const top = -u * 2.3;
  ctx.strokeStyle = sil;
  ctx.lineWidth = Math.max(1.1, u * 0.055);
  ctx.beginPath();
  ctx.moveTo(-w * 0.3, 0); ctx.lineTo(-w * 0.28, top + h);
  ctx.moveTo(w * 0.3, 0); ctx.lineTo(w * 0.28, top + h);
  ctx.stroke();

  // Painted, not silhouetted — a lit sign is what makes a roofline pop.
  const ci = Math.floor(hash01(seed * 5.8) * TAG_COLORS.length);
  const g = ctx.createLinearGradient(0, top, 0, top + h);
  g.addColorStop(0, tintA(TAG_COLORS[ci], 0.72, 0.9));
  g.addColorStop(1, tintA(TAG_COLORS[ci], 0.32, 0.9));
  ctx.beginPath();
  ctx.rect(-w * 0.5, top, w, h);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#1c1020';
  ctx.lineWidth = Math.max(0.8, u * 0.03);
  ctx.stroke();
  if (near) {
    ctx.fillStyle = 'rgba(247,237,216,0.85)';
    ctx.fillRect(-w * 0.36, top + h * 0.3, w * 0.5, h * 0.16);
    ctx.fillRect(-w * 0.36, top + h * 0.56, w * 0.32, h * 0.12);
    ctx.strokeStyle = sil;
    ctx.lineWidth = Math.max(0.6, u * 0.025);
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      ctx.moveTo(i * w * 0.3, top);
      ctx.lineTo(i * w * 0.3 - side * u * 0.12, top - u * 0.16);
    }
    ctx.stroke();
  }
}

function skyFence(ctx, u, seed, sil) {
  const h = u * (0.8 + hash01(seed * 4.6) * 0.4);
  const w = u * 1.6;
  ctx.strokeStyle = sil;
  ctx.lineWidth = Math.max(0.5, u * 0.016);
  ctx.beginPath();
  for (let i = -3; i <= 3; i++) {                                          // mesh
    ctx.moveTo(-w * 0.5 + i * u * 0.26, 0);
    ctx.lineTo(-w * 0.5 + i * u * 0.26 + h, -h);
    ctx.moveTo(-w * 0.5 + i * u * 0.26, -h);
    ctx.lineTo(-w * 0.5 + i * u * 0.26 + h, 0);
  }
  ctx.stroke();
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h); ctx.lineTo(w * 0.5, -h);
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(i * w * 0.5, 0);
    ctx.lineTo(i * w * 0.5, -h - u * 0.22);
  }
  ctx.stroke();
  ctx.lineWidth = Math.max(0.5, u * 0.02);
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {                                            // barbed strands
    ctx.moveTo(-w * 0.5, -h - u * 0.08 - k * u * 0.07);
    ctx.lineTo(w * 0.5, -h - u * 0.08 - k * u * 0.07);
  }
  ctx.stroke();
}

function skyLaundry(ctx, u, seed, sil) {
  const w = u * 1.9;
  const h = u * 0.95;
  ctx.strokeStyle = sil;
  ctx.lineWidth = Math.max(1, u * 0.045);
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, 0); ctx.lineTo(-w * 0.5, -h);
  ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, -h);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.6, u * 0.016);
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h);
  ctx.quadraticCurveTo(0, -h + u * 0.3, w * 0.5, -h);
  ctx.stroke();

  const n = 5;
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    const x = -w * 0.5 + w * k;
    const y = -h + u * 0.3 * (2 * k * (1 - k)) * 2;
    const gw = u * (0.16 + hash01(seed + i * 3.1) * 0.12);
    const gh = u * (0.3 + hash01(seed + i * 7.7) * 0.26);
    ctx.fillStyle = tintA(TAG_COLORS[Math.floor(hash01(seed * 2 + i * 5.5) * TAG_COLORS.length)],
      0.85, 0.9);
    ctx.beginPath();
    ctx.moveTo(x - gw, y);
    ctx.lineTo(x + gw, y);
    ctx.lineTo(x + gw * 0.8, y + gh);
    ctx.lineTo(x - gw * 0.8, y + gh);
    ctx.closePath();
    ctx.fill();
  }
}

// -------------------------------------------------------------------- wires

/** Overhead wires strung between poles — pure vibe, no collision. */
export function drawWires(ctx, P, z0, z1, seed, alpha) {
  const yl = WALL_H * (0.88 + hash01(seed * 1.7) * 0.1);
  const yr = WALL_H * (0.8 + hash01(seed * 2.9) * 0.12);
  const L = P(-ALLEY_HALF, yl, z0), R = P(ALLEY_HALF, yr, z0);
  if (!L || !R) return;
  const u = (L.scale + R.scale) * 0.5;

  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  ctx.lineCap = 'round';

  // A second bundle further down the alley doubles the depth cue for free.
  const L2 = P(-ALLEY_HALF, yl - 0.45, z1), R2 = P(ALLEY_HALF, yr - 0.35, z1);
  if (L2 && R2 && hash01(seed * 8.8) > 0.68) {
    bundle(ctx, L2, R2, u * 0.55, seed * 3.7, 2);
    strokePair(ctx, u * 0.55);
  }

  const n = 2 + Math.floor(hash01(seed * 6.2) * 2);
  const mid = bundle(ctx, L, R, u, seed, n);
  strokePair(ctx, u);

  // Wall hardware where the bundle lands.
  ctx.fillStyle = '#1c1420';
  ctx.fillRect(L.x - u * 0.05, L.y - u * 0.06, u * 0.11, u * 0.16);
  ctx.fillRect(R.x - u * 0.06, R.y - u * 0.06, u * 0.11, u * 0.16);

  // Both of these are fine detail — below a certain size they just smear.
  if (u > 16 && hash01(seed * 4.1) > 0.62) hangingShoes(ctx, mid.x, mid.y, u);
  else if (u > 10 && hash01(seed * 9.3) > 0.66) papelPicado(ctx, L, R, mid, u, seed);

  ctx.restore();
}

/** Lay n sagging spans into one path; returns the midpoint of the fattest one. */
function bundle(ctx, L, R, u, seed, n) {
  ctx.beginPath();
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    const drop = i * u * 0.11;
    const ay = L.y + drop, by = R.y + drop;
    const sag = u * (0.14 + hash01(seed * 1.3 + i * 5.9) * 0.26);
    const cx = (L.x + R.x) * 0.5, cy = (ay + by) * 0.5 + sag * 2;
    ctx.moveTo(L.x, ay);
    ctx.quadraticCurveTo(cx, cy, R.x, by);
    if (i === 1 || n === 1) {
      mx = 0.25 * L.x + 0.5 * cx + 0.25 * R.x;
      my = 0.25 * ay + 0.5 * cy + 0.25 * by;
    }
  }
  return { x: mx, y: my };
}

/** Fat dark pass, then a thin warm core so the wires catch the low sun. */
function strokePair(ctx, u) {
  ctx.strokeStyle = '#1d1420';
  ctx.lineWidth = Math.max(0.9, u * 0.019);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,190,122,0.4)';
  ctx.lineWidth = Math.max(0.4, u * 0.007);
  ctx.stroke();
}

function hangingShoes(ctx, mx, my, u) {
  const s = u * 0.075;
  ctx.strokeStyle = '#cdc6bb';
  ctx.lineWidth = Math.max(0.6, s * 0.14);
  ctx.beginPath();                                                         // knotted laces
  ctx.moveTo(mx - s * 0.75, my + s * 0.2);
  ctx.quadraticCurveTo(mx, my - s * 0.4, mx + s * 0.95, my + s * 0.35);
  ctx.stroke();

  // Backlit against a bright sky, so: dark body, warm rim, sole picked out.
  for (let i = 0; i < 2; i++) {
    const x = mx + (i ? s * 0.35 : -s * 1.25);
    const y = my + (i ? s * 0.35 : s * 0.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + s * 0.9, y + s * 0.15);
    ctx.lineTo(x + s * 0.95, y + s * 1.25);
    ctx.quadraticCurveTo(x + s * 1.15, y + s * 1.75, x + s * 0.5, y + s * 1.8);
    ctx.quadraticCurveTo(x - s * 0.12, y + s * 1.7, x - s * 0.05, y + s * 1.1);
    ctx.closePath();
    ctx.fillStyle = i ? '#6d6472' : '#7d7382';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,196,132,0.5)';
    ctx.lineWidth = Math.max(0.5, s * 0.09);
    ctx.stroke();
    ctx.fillStyle = 'rgba(22,12,26,0.6)';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.02, y + s * 1.35);
    ctx.lineTo(x + s * 0.97, y + s * 1.3);
    ctx.quadraticCurveTo(x + s * 1.15, y + s * 1.75, x + s * 0.5, y + s * 1.8);
    ctx.quadraticCurveTo(x - s * 0.12, y + s * 1.7, x - s * 0.02, y + s * 1.35);
    ctx.fill();
  }
}

/** Papel picado strung across the alley — three fills for the whole string. */
function papelPicado(ctx, L, R, mid, u, seed) {
  const cx = (L.x + R.x) * 0.5;
  const cy = mid.y * 2 - (L.y + R.y) * 0.5;   // control point that produced mid
  const n = 11;
  const size = u * 0.075;
  for (let pass = 0; pass < 3; pass++) {
    ctx.beginPath();
    for (let i = pass; i < n; i += 3) {
      const t = (i + 0.5) / n;
      const it = 1 - t;
      const x = it * it * L.x + 2 * it * t * cx + t * t * R.x;
      const y = it * it * L.y + 2 * it * t * cy + t * t * R.y;
      ctx.moveTo(x - size * 0.55, y);
      ctx.lineTo(x + size * 0.55, y);
      ctx.lineTo(x, y + size * 1.5);
      ctx.closePath();
    }
    ctx.fillStyle = hexA(TAG_COLORS[(Math.floor(hash01(seed * 7.1) * 6) + pass * 2) % 6], 0.85);
    ctx.fill();
  }
}

// ------------------------------------------------------------------ helpers

function tint(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.floor(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.floor(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.floor((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}

