// The Primo, rigged — the crew, the run cycle, and the front-facing portrait.
//
// This file OWNS THE POSE, not the drawing. The old version rotated limbs in the
// image plane, which reads as doing the splits: running seen from BEHIND swings
// almost entirely in depth. So poseRunner solves the skeleton in local 3D
// (x lateral, y up, z forward) with real knee and elbow joints, and hands it to
// primo-runner.js, which projects it with a camera-down-the-alley tilt and paints
// the body. The head is drawn from the Primo's traits by head-back.js, facing
// forward down the alley — that file explains why a PFP crop cannot be used
// there.
//
// The pose solver below is good and is deliberately left alone. When the body was
// rebuilt the problem was rendering, not posing, so all the projection and limb
// shading that used to live here went with it and is not coming back.

import { roundRect } from './palette.js';
import { drawPrimoBody } from './primo-runner.js';

// ---------------------------------------------------------------- the crew

export const CREW = [
  {
    id: 'chuy',
    name: 'CHUY',
    tagline: 'Blue Pendleton · Gold Blues',
    skin: '#b9784e', skinDark: '#96593a', skinLight: '#d0946a',
    hair: '#20161a', hairStyle: 'messy',
    // The collection's own black Primos cap. head-back.js lights it apart from
    // the hair rather than trusting the two colours to differ.
    cap: '#1b1b24',
    shirt: '#3c5f9e', shirtDark: '#28406d', tee: '#f2efe6',
    pants: '#2f3a52',
    shades: '#ffc93c', shadeLens: '#3f8f86',
    bandana: null,
    brow: '#17110f',
    sticker: '#e33b3b',
  },
  {
    id: 'lupe',
    name: 'LUPE',
    tagline: 'Rojo Base · Black Bandana',
    skin: '#e2645e', skinDark: '#b94a4a', skinLight: '#f28a80',
    hair: '#7d1f2b', hairStyle: 'long',
    shirt: '#8e99ad', shirtDark: '#5f6a7d', tee: '#ffffff',
    pants: '#20242e',
    shades: null, shadeLens: null,
    bandana: '#16161a',
    brow: '#1b1013',
    sticker: '#ffc93c',
  },
  {
    id: 'rosa',
    name: 'ROSA',
    tagline: 'Ponytail · Hoops · Rosa Flannel',
    skin: '#a86a45', skinDark: '#87502f', skinLight: '#c58a62',
    hair: '#1a1216', hairStyle: 'pony',
    shirt: '#c8467e', shirtDark: '#932f5c', tee: '#fdf3ec',
    pants: '#39304a',
    shades: null, shadeLens: null,
    bandana: '#f2e3c8',
    brow: '#150f0e',
    hoops: '#ffc93c',
    sticker: '#9ee34f',
  },
  {
    id: 'beto',
    name: 'TÍO BETO',
    tagline: 'Bigote · Beanie · Charcoal Plaid',
    skin: '#9c6742', skinDark: '#7b4c2d', skinLight: '#b98559',
    hair: '#2a2320', hairStyle: 'beanie',
    shirt: '#4a4f58', shirtDark: '#32363d', tee: '#e8e2d6',
    pants: '#2b2b33',
    shades: '#2a2a2f', shadeLens: '#14202a',
    bandana: null,
    beanie: '#7a2f3a',
    mustache: '#2a2320',
    brow: '#1d1512',
    sticker: '#28c3b8',
  },
];

export const CUSTOM_ID = 'mi-primo';

export const CUSTOM_TEMPLATE = {
  id: CUSTOM_ID,
  name: 'MI PRIMO',
  tagline: 'Load one from the collection',
  skin: '#b9784e', skinDark: '#96593a', skinLight: '#d0946a',
  hair: '#20161a', hairStyle: 'messy',
  cap: '#1b1b24',
  shirt: '#2f6f6a', shirtDark: '#1e4b48', tee: '#f2efe6',
  pants: '#2f3a52',
  shades: null, shadeLens: null,
  bandana: null,
  brow: '#17110f',
  sticker: '#ff4d9d',
};

// -------------------------------------------------------------- animation

/** Piecewise track with smoothstep easing, wrapping at phase 1. */
function track(keys, p) {
  const n = keys.length;
  p = ((p % 1) + 1) % 1;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (keys[k][0] <= p) i = k; else break;
  }
  const [p0, v0] = keys[i];
  const [p1, v1] = keys[(i + 1) % n];
  let span = p1 - p0;
  if (span <= 0) span += 1;
  let t = (p - p0) / span;
  if (t < 0) t += 1 / span;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return v0 + (v1 - v0) * (t * t * (3 - 2 * t));
}

// Angles are radians from straight-down; + swings forward (away from camera).
const THIGH = [[0, 0.58], [0.14, 0.22], [0.30, -0.12], [0.48, -0.62], [0.62, -0.22], [0.76, 0.34], [0.88, 0.60]];
// Knee flex — the shin folds backward. 1.7 rad at 0.62 is heel-to-backside.
const KNEE  = [[0, 0.20], [0.14, 0.42], [0.30, 0.16], [0.48, 0.62], [0.62, 1.74], [0.76, 1.16], [0.88, 0.42]];
const ANKLE = [[0, -0.12], [0.30, 0.06], [0.48, 0.58], [0.62, 0.34], [0.88, -0.12]];
// Arms run counter-phase to the leg on the same side.
const SHOULDER = [[0, -0.54], [0.25, -0.12], [0.50, 0.62], [0.75, 0.10]];
const ELBOW    = [[0, 1.18], [0.25, 1.52], [0.50, 1.92], [0.75, 1.44]];

/**
 * @param {object} o { phase, airborne, vy, sliding, slideK, lean, speedK }
 * @returns pose in normalised body units (multiply by H)
 */
export function poseRunner(o) {
  const p = o.phase || 0;
  const speedK = o.speedK == null ? 0.5 : o.speedK;

  if (o.sliding) return poseSlide(o);
  if (o.airborne) return poseAir(o);

  // Hip rises twice per stride: lowest at each foot strike.
  const bob = 0.048 * (0.5 - 0.5 * Math.cos(4 * Math.PI * p));
  const sway = 0.020 * Math.sin(2 * Math.PI * p);
  const twist = 0.055 * Math.sin(2 * Math.PI * p);

  return {
    hipY: 0.345 + bob,
    hipX: sway,
    lean: 0.17 + speedK * 0.10,
    twist,
    headTilt: -twist * 0.5,
    legs: [
      { side: -1, thigh: track(THIGH, p), knee: track(KNEE, p), ankle: track(ANKLE, p) },
      { side: 1, thigh: track(THIGH, p + 0.5), knee: track(KNEE, p + 0.5), ankle: track(ANKLE, p + 0.5) },
    ],
    arms: [
      // Opposite arm to opposite leg.
      { side: -1, shoulder: track(SHOULDER, p), elbow: track(ELBOW, p) },
      { side: 1, shoulder: track(SHOULDER, p + 0.5), elbow: track(ELBOW, p + 0.5) },
    ],
    airK: 0,
  };
}

function poseAir(o) {
  // Tuck on the way up, reach for the ground on the way down.
  const rising = Math.max(0, Math.min(1, (o.vy || 0) / 12));
  const falling = Math.max(0, Math.min(1, -(o.vy || 0) / 12));
  const tuck = rising;
  const flutter = Math.sin((o.phase || 0) * Math.PI * 4) * 0.12;

  return {
    hipY: 0.355,
    hipX: 0,
    lean: 0.20 + rising * 0.12,
    twist: 0,
    headTilt: -0.04,
    legs: [
      { side: -1, thigh: 0.30 + tuck * 0.55 + flutter, knee: 0.45 + tuck * 0.95, ankle: 0.30 },
      { side: 1, thigh: 0.10 + tuck * 0.35 - flutter - falling * 0.35, knee: 0.30 + tuck * 0.70, ankle: 0.20 },
    ],
    arms: [
      { side: -1, shoulder: 0.55 + rising * 0.45, elbow: 1.15 },
      { side: 1, shoulder: 0.35 + rising * 0.55, elbow: 1.35 },
    ],
    airK: 1,
  };
}

function poseSlide(o) {
  const k = o.slideK == null ? 1 : o.slideK;   // 1 at the start of the slide
  return {
    hipY: 0.115,
    hipX: 0,
    lean: -0.62,
    twist: 0.08,
    headTilt: 0.30,
    legs: [
      { side: -1, thigh: 1.05, knee: 0.18, ankle: -0.25 },     // lead leg out front
      { side: 1, thigh: 0.10, knee: 1.55, ankle: 0.35 },       // trail leg tucked
    ],
    arms: [
      { side: -1, shoulder: -0.75 - k * 0.15, elbow: 0.85 },
      { side: 1, shoulder: -0.60, elbow: 1.05 },
    ],
    airK: 0,
    slide: true,
  };
}

// ------------------------------------------------- portrait support
//
// Everything that used to live here — the projection, the sphere/capsule limb
// shading, the depth-sorted skeleton — moved to primo-runner.js and head-back.js
// when the runner was rebuilt. What is left is the pose solver above, which is
// good and is deliberately untouched, and the front-facing portrait below, which
// hud.js, main.js, intro.js and primo-head.js all import.

function plaid(ctx, x, y, w, h, base, dark, coarse) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const step = Math.max(2, w / (coarse ? 2.6 : 3.6));
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.5;
  for (let i = step * 0.35; i < w; i += step) ctx.fillRect(x + i, y, step * 0.36, h);
  for (let j = step * 0.25; j < h; j += step) ctx.fillRect(x, y + j, w, step * 0.32);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (let i = step * 0.92; i < w; i += step) ctx.fillRect(x + i, y, Math.max(1, step * 0.1), h);
}

/**
 * Draw the runner.
 *
 * @param {number} sx screen x of the ground contact point
 * @param {number} sy screen y of the ground contact point
 * @param {number} u  pixels per world unit
 * @param {object} rig { head: HTMLCanvasElement|null, shirt, shirtDark, skin, skinDark, pants }
 * @param {object} o   pose inputs (see poseRunner)
 */
export function drawRunner(ctx, sx, sy, u, rig, o = {}) {
  const pose = poseRunner(o);
  const laneLean = o.laneLean || 0;

  ctx.save();
  // Body-check into the lane change. Rotating about the runner's ground point
  // keeps the feet planted while the torso leans.
  if (laneLean) {
    ctx.translate(sx, sy);
    ctx.rotate(laneLean * 0.10);
    ctx.translate(-sx, -sy);
  }
  drawPrimoBody(ctx, sx, sy, u, rig, pose, laneLean);
  ctx.restore();
}

export function drawPrimoPortrait(ctx, cx, cy, size, c, opts = {}) {
  const img = opts.img;
  ctx.save();
  ctx.translate(cx, cy);

  const hw = size * 0.62;
  const hh = size * 0.66;

  const sw = size * 0.94;
  const sh = size * 0.36;
  const sy = hh * 0.34;
  ctx.save();
  roundRect(ctx, -sw / 2, sy, sw, sh, sw * 0.1);
  ctx.clip();
  plaid(ctx, -sw / 2, sy, sw, sh, c.shirt, c.shirtDark, false);
  ctx.restore();
  ctx.fillStyle = c.tee;
  ctx.beginPath();
  ctx.moveTo(-sw * 0.16, sy);
  ctx.lineTo(sw * 0.16, sy);
  ctx.lineTo(0, sy + sh * 0.7);
  ctx.closePath();
  ctx.fill();

  if (img && img.complete && img.naturalWidth) {
    ctx.save();
    roundRect(ctx, -hw * 0.86, -hh * 0.92, hw * 1.72, hh * 1.62, size * 0.12);
    ctx.clip();
    const s = Math.max(hw * 1.72, hh * 1.62);
    ctx.drawImage(img, -s / 2, -hh * 0.92, s, s);
    ctx.restore();
    ctx.restore();
    return;
  }

  ctx.fillStyle = c.skinDark;
  ctx.fillRect(-hw * 0.16, hh * 0.1, hw * 0.32, hh * 0.34);

  ctx.fillStyle = c.hair;
  if (c.hairStyle === 'long') {
    roundRect(ctx, -hw * 0.72, -hh * 0.82, hw * 1.44, hh * 1.66, hw * 0.42);
    ctx.fill();
  } else {
    roundRect(ctx, -hw * 0.66, -hh * 0.8, hw * 1.32, hh * 1.2, hw * 0.44);
    ctx.fill();
  }

  ctx.fillStyle = c.skin;
  roundRect(ctx, -hw * 0.56, -hh * 0.56, hw * 1.12, hh * 1.2, hw * 0.4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, -hw * 0.46, -hh * 0.46, hw * 0.44, hh * 0.4, hw * 0.2);
  ctx.fill();

  ctx.fillStyle = c.hair;
  if (c.hairStyle === 'beanie') {
    ctx.fillStyle = c.beanie || c.hair;
    roundRect(ctx, -hw * 0.68, -hh * 0.9, hw * 1.36, hh * 0.66, hw * 0.3);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(-hw * 0.68, -hh * 0.36, hw * 1.36, hh * 0.14);
  } else {
    ctx.beginPath();
    ctx.moveTo(-hw * 0.6, -hh * 0.24);
    ctx.quadraticCurveTo(-hw * 0.5, -hh * 0.78, 0, -hh * 0.72);
    ctx.quadraticCurveTo(hw * 0.52, -hh * 0.78, hw * 0.6, -hh * 0.2);
    ctx.quadraticCurveTo(hw * 0.3, -hh * 0.46, -hw * 0.1, -hh * 0.42);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = c.brow;
  const bw = hw * 0.36, bh = hh * 0.09;
  roundRect(ctx, -hw * 0.46, -hh * 0.2, bw, bh, bh * 0.3);
  ctx.fill();
  roundRect(ctx, hw * 0.1, -hh * 0.22, bw, bh, bh * 0.3);
  ctx.fill();

  if (c.shades) {
    ctx.strokeStyle = c.shades;
    ctx.lineWidth = Math.max(1.2, size * 0.022);
    ctx.fillStyle = c.shadeLens;
    ctx.beginPath();
    ctx.ellipse(-hw * 0.27, hh * 0.02, hw * 0.26, hh * 0.2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(hw * 0.27, hh * 0.02, hw * 0.26, hh * 0.2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-hw * 0.02, 0);
    ctx.lineTo(hw * 0.02, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    roundRect(ctx, -hw * 0.4, -hh * 0.06, hw * 0.14, hh * 0.08, hh * 0.03);
    ctx.fill();
    roundRect(ctx, hw * 0.14, -hh * 0.06, hw * 0.14, hh * 0.08, hh * 0.03);
    ctx.fill();
  } else {
    for (const ex of [-hw * 0.26, hw * 0.26]) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, hh * 0.02, hw * 0.17, hh * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a2318';
      ctx.beginPath();
      ctx.ellipse(ex, hh * 0.04, hw * 0.1, hh * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex - hw * 0.04, 0, hw * 0.035, hh * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = '#241318';
  roundRect(ctx, -hw * 0.14, hh * 0.36, hw * 0.28, hh * 0.07, hh * 0.02);
  ctx.fill();

  if (c.mustache) {
    ctx.fillStyle = c.mustache;
    roundRect(ctx, -hw * 0.26, hh * 0.26, hw * 0.52, hh * 0.1, hh * 0.05);
    ctx.fill();
  }

  if (c.bandana) {
    ctx.fillStyle = c.bandana;
    roundRect(ctx, -hw * 0.68, -hh * 0.42, hw * 1.36, hh * 0.18, hh * 0.04);
    ctx.fill();
  }

  if (c.hoops) {
    ctx.strokeStyle = c.hoops;
    ctx.lineWidth = Math.max(1, size * 0.018);
    for (const ex of [-hw * 0.6, hw * 0.6]) {
      ctx.beginPath();
      ctx.ellipse(ex, hh * 0.24, hw * 0.09, hh * 0.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (c.sticker && size > 54) {
    const r = size * 0.13;
    const px = hw * 0.72, py = hh * 0.72;
    ctx.fillStyle = '#f3e2c0';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.sticker;
    ctx.lineWidth = Math.max(1, size * 0.02);
    ctx.stroke();
    ctx.fillStyle = c.sticker;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
