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
  // Riding loses to both of those on purpose: you can still duck a clothesline
  // and still jump on the board, and the board goes with you either way — it is
  // drawn at the player's projected position, so it leaves the ground when you
  // do. Only the GROUNDED cycle is replaced.
  if (o.riding) return poseRide(o);

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

/**
 * Riding the skateboard.
 *
 * The board has been under the runner's feet for two versions and the runner
 * kept SPRINTING on top of it, which reads as a bug rather than a power-up —
 * the one thing a board is for is that you stop running.
 *
 * FEET STAGGERED, NOT SIDEWAYS. A real skater stands across the deck, and
 * turning this character ninety degrees is not an option: the whole rig solves
 * for a camera behind them, the head is a back-of-the-skull drawing, and in
 * profile there is no character left. So the read is carried the way every
 * behind-camera runner carries it — one foot forward over the nose, one back
 * over the tail, knees deeply bent, arms trailing. Nobody stands like that
 * except on a board.
 *
 * The angles are SOLVED, not eyeballed. Both ankles have to land on the deck —
 * y = 0.02, which is where drawBoard() in render.js puts the plate — and a foot
 * hovering over it or sunk through it is the first thing anyone sees. So each
 * leg is inverse-kinematics against a target: front ankle at z = +0.14, back at
 * z = −0.12, both at y = 0.02, from a hip at 0.325. Changing hipY means
 * re-solving all four angles; it is not a number to nudge.
 *
 * That 0.26 of depth between the feet is the whole stagger, and it has to be
 * paid for in z rather than in x: the projection turns 0.26H of depth into only
 * ~0.09H across the screen, so a stance that looks generous in the solver reads
 * as a modest offset on the alley — and anything less than this read as two feet
 * side by side, which is standing on a plank, not riding it.
 */
function poseRide(o) {
  const p = o.phase || 0;
  const speedK = o.speedK == null ? 0.5 : o.speedK;
  const lean = o.laneLean || 0;
  // Pumping, not striding: one slow weight shift per cycle, an order of
  // magnitude smaller than the run's bob. Left out entirely the figure is a
  // mannequin bolted to a plank.
  const bob = 0.012 * Math.sin(2 * Math.PI * p);
  const shift = 0.010 * Math.sin(2 * Math.PI * p + 1.1);

  return {
    hipY: 0.325 + bob,
    hipX: shift + lean * 0.02,
    // Crouched further forward than the run, and it stiffens with speed.
    lean: 0.30 + speedK * 0.10,
    twist: lean * 0.08,
    headTilt: -lean * 0.12,
    legs: [
      // Front foot, out over the nose. Ankle solves to (z +0.140, y 0.020).
      { side: -1, thigh: 0.78, knee: 0.71, ankle: 1.03 },
      // Back foot, over the tail, and the deeper bend of the two. It also ends
      // up NEARER the camera, so it draws over the front leg — which is the
      // right occlusion and comes free from the ankZ sort in primo-runner.
      { side: 1, thigh: 0.03, knee: 0.83, ankle: 1.90 },
    ],
    arms: [
      // Trailing, near-straight, and they counter the lane lean — which is the
      // only place the pose gets to say the rider is balancing rather than
      // posing. The forward swing is all the rig has (the shoulder solves in
      // the sagittal plane only), so "out to the sides" is not available and
      // "back, at slightly different angles" is what stands in for it.
      { side: -1, shoulder: -0.62 - lean * 0.26, elbow: 0.42 },
      { side: 1, shoulder: -0.46 + lean * 0.26, elbow: 0.30 },
    ],
    airK: 0,
    riding: true,
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
