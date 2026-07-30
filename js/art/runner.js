// The Primo, rigged.
//
// The old version rotated limbs in the image plane, which reads as doing the
// splits — running seen from BEHIND swings almost entirely in depth. So the
// skeleton is posed in local 3D (x lateral, y up, z forward) with real knee and
// elbow joints, then projected with a camera-down-the-alley tilt. The head is a
// sprite so a real Primo PFP can wear the body.

import { roundRect } from './palette.js';
import { spritesReady, drawPart } from './sprites.js';

// ---------------------------------------------------------------- the crew

export const CREW = [
  {
    id: 'chuy',
    name: 'CHUY',
    tagline: 'Blue Pendleton · Gold Blues',
    skin: '#b9784e', skinDark: '#96593a', skinLight: '#d0946a',
    hair: '#20161a', hairStyle: 'messy',
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

// ----------------------------------------------------------------- drawing

// A high camera looking down the alley: vertical position dominates, depth
// contributes a little. Push TILT much past this and the heel kick cancels
// itself out — the foot rises in world space exactly as depth pushes it back
// down the screen, and the legs go dead.
const TILT = 0.15;
const YAW = 0.34;       // off-axis view, so limb swing also reads laterally
const ZSHRINK = 0.13;   // limbs thin out as they swing away

// The runner heads into a low sun, so they are BACKLIT: warm rim around the
// silhouette, cool sky bounce filling the shadow that faces us.
const RIM = [255, 196, 132];
const AMBIENT = [126, 108, 158];
const SHOE = [244, 240, 230];

/**
 * The alley is a dark sunset, but the runner has to read against it at ~130px
 * tall. Subway Surfers keeps its characters bright and saturated for exactly
 * this reason, so every body colour gets lifted before it is shaded.
 */
function lift(c) {
  const boosted = scale(c, 1.22);
  // A little away from grey as well as up. Push this much past 1.1 and brown
  // skin turns traffic-cone orange.
  const avg = (boosted[0] + boosted[1] + boosted[2]) / 3;
  return [
    Math.min(255, avg + (boosted[0] - avg) * 1.06),
    Math.min(255, avg + (boosted[1] - avg) * 1.06),
    Math.min(255, avg + (boosted[2] - avg) * 1.06),
  ];
}

/** Project a local 3D body point (in px) to screen offsets. */
function proj(x, y, z, H) {
  const zn = z / H;
  return {
    x: x + z * YAW,
    y: -y - z * TILT,
    k: 1 - zn * ZSHRINK,
  };
}

// --------------------------------------------------------------- colour math

function toRGB(col) {
  if (col.startsWith('rgb')) return col.match(/\d+/g).map(Number);
  const n = parseInt(col.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (c, a) =>
  a == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
            : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const scale = (c, k) => [
  Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k),
];

/** Capsule between two joints, as a reusable path. */
function capsule(a, b, ra, rb) {
  const p = new Path2D();
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  p.arc(a.x, a.y, Math.max(0.4, ra), ang + Math.PI / 2, ang - Math.PI / 2);
  p.arc(b.x, b.y, Math.max(0.4, rb), ang - Math.PI / 2, ang + Math.PI / 2);
  p.closePath();
  return p;
}

/** Point a fraction of the way from a to b. */
function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, k: a.k + (b.k - a.k) * t };
}

/** Shade a prepared path as a limb lit from behind. */
function shadeLimb(ctx, path, a, b, ra, rb, base, out, dim = 1) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let px = -dy / len, py = dx / len;
  if ((px < 0) !== (out < 0)) { px = -px; py = -py; }

  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const r = Math.max(ra, rb);
  const g = ctx.createLinearGradient(mx - px * r, my - py * r, mx + px * r, my + py * r);
  const core = scale(mix(base, AMBIENT, 0.30), 0.56 * dim);
  const body = scale(base, 0.88 * dim);
  const lit = scale(base, 1.04 * dim);
  g.addColorStop(0.00, css(mix(core, AMBIENT, 0.30)));
  g.addColorStop(0.34, css(core));
  g.addColorStop(0.66, css(body));
  g.addColorStop(0.90, css(lit));
  g.addColorStop(1.00, css(mix(lit, RIM, 0.72 * dim)));
  ctx.fillStyle = g;
  ctx.fill(path);
}

/** Soft dark blob where two segments meet, so joints read as joints. */
function occlude(ctx, p, r) {
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  g.addColorStop(0, 'rgba(18,8,26,0.30)');
  g.addColorStop(1, 'rgba(18,8,26,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

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
 * Plaid wrapped around a torso. Same weave, but the cross-stripes sag toward
 * the middle so the cloth reads as going around a body instead of lying flat
 * on a board — the single cheapest thing that stops the shirt looking like
 * cardboard.
 */
function plaidCurved(ctx, x, y, w, h, base, dark, coarse) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const step = Math.max(2, w / (coarse ? 2.6 : 3.6));
  const sag = Math.min(h * 0.06, step * 0.55);

  // warp threads follow the barrel, so they bow outward at the edges
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = dark;
  for (let i = step * 0.35; i < w; i += step) {
    const t = (i / w) * 2 - 1;                    // -1..1 across the body
    const lean = t * step * 0.22;
    ctx.beginPath();
    ctx.moveTo(x + i + lean, y);
    ctx.lineTo(x + i + step * 0.36 + lean, y);
    ctx.lineTo(x + i + step * 0.36 - lean, y + h);
    ctx.lineTo(x + i - lean, y + h);
    ctx.closePath();
    ctx.fill();
  }
  // weft threads sag: the cloth's near side hangs lower than its edges
  for (let j = step * 0.25; j < h; j += step) {
    ctx.beginPath();
    ctx.moveTo(x, y + j);
    ctx.quadraticCurveTo(x + w / 2, y + j + sag * 2, x + w, y + j);
    ctx.lineTo(x + w, y + j + step * 0.32);
    ctx.quadraticCurveTo(x + w / 2, y + j + step * 0.32 + sag * 2, x, y + j + step * 0.32);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (let i = step * 0.92; i < w; i += step) {
    const t = (i / w) * 2 - 1;
    const lean = t * step * 0.22;
    ctx.beginPath();
    ctx.moveTo(x + i + lean, y);
    ctx.lineTo(x + i + Math.max(1, step * 0.1) + lean, y);
    ctx.lineTo(x + i + Math.max(1, step * 0.1) - lean, y + h);
    ctx.lineTo(x + i - lean, y + h);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Rounded cap over a limb root. Without one, an arm or thigh butts into the
 * body as a flat-ended cylinder and the whole figure reads as loose parts.
 */
function jointCap(ctx, p, r, base, out) {
  const g = ctx.createRadialGradient(
    p.x - out * r * 0.35, p.y - r * 0.4, r * 0.08, p.x, p.y, r);
  g.addColorStop(0, css(scale(base, 1.02)));
  g.addColorStop(0.72, css(scale(base, 0.78)));
  g.addColorStop(1, css(scale(mix(base, AMBIENT, 0.3), 0.5)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r, r * 0.94, 0, 0, Math.PI * 2);
  ctx.fill();
  // warm catch on the outward edge
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = css(RIM);
  ctx.beginPath();
  ctx.ellipse(p.x + out * r * 0.62, p.y, r * 0.34, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Body plan, as fractions of full standing height.
// Athletic-chibi: head is ~0.30 of height. The collection's art is big-headed,
// so going smaller than this stops looking like a Primo — but 0.45 (where this
// started) reads as a bobblehead.
const DIM = {
  thigh: 0.210, shin: 0.210,      // hip lands at 0.47
  torso: 0.230,                   // shoulders land at 0.70
  // Arms reach 0.30 of height. Shorter than this and a bent running arm folds
  // into a stub at the shoulder.
  upperArm: 0.156, foreArm: 0.146,
  hipHalf: 0.062,                 // narrow, or the stance goes bow-legged
  shoulderHalf: 0.100,            // torso half-width at the shoulders
  armHalf: 0.116,                 // arms hang OUTSIDE the torso, or they vanish
  headSize: 0.343,                // sprite box; the head fills ~0.875 of it
  rThigh: 0.052, rKnee: 0.038, rAnkle: 0.026,
  rArm: 0.036, rElbow: 0.028, rWrist: 0.024,
};

/** Solve joint positions for a pose. Local 3D, px, +y up, +z forward. */
function skeleton(pose, H, laneLean) {
  const hipY = pose.hipY * H;
  const hipX = pose.hipX * H + laneLean * H * 0.045;
  const lean = pose.lean;
  const shoulderY = hipY + DIM.torso * H * Math.cos(lean);
  const shoulderZ = DIM.torso * H * Math.sin(lean);

  const legs = pose.legs.map((L) => {
    const hx = L.side * DIM.hipHalf * H + hipX;
    const hp = { x: hx, y: hipY, z: 0 };
    const t = L.thigh;
    const kn = {
      x: hx - L.side * 0.010 * H,
      y: hipY - DIM.thigh * H * Math.cos(t),
      z: DIM.thigh * H * Math.sin(t),
    };
    const s = t - L.knee;                      // the knee only folds backward
    const an = {
      x: kn.x - L.side * 0.012 * H,
      y: kn.y - DIM.shin * H * Math.cos(s),
      z: kn.z + DIM.shin * H * Math.sin(s),
    };
    return { side: L.side, hp, kn, an, footAng: s + L.ankle };
  });

  const arms = pose.arms.map((A) => {
    const sx = A.side * DIM.armHalf * H + hipX * 0.6;
    const sh = { x: sx, y: shoulderY, z: shoulderZ + A.side * pose.twist * H * 0.4 };
    const a = A.shoulder;
    const el = {
      x: sx + A.side * 0.016 * H,
      y: sh.y - DIM.upperArm * H * Math.cos(a),
      z: sh.z + DIM.upperArm * H * Math.sin(a),
    };
    const f = a + A.elbow;
    const wr = {
      x: el.x + A.side * 0.010 * H,
      y: el.y - DIM.foreArm * H * Math.cos(f),
      z: el.z + DIM.foreArm * H * Math.sin(f),
    };
    return { side: A.side, sh, el, wr };
  });

  return { hipX, hipY, shoulderY, shoulderZ, legs, arms, twist: pose.twist };
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
  const H = 1.62 * u;
  const laneLean = o.laneLean || 0;
  const pose = poseRunner(o);
  const S = skeleton(pose, H, laneLean);

  const pants = toRGB(rig.pants || '#2f3a52');
  const skin = toRGB(rig.skin || '#b9784e');
  const shirt = toRGB(rig.shirt || '#3c5f9e');

  // Screen-space joints, and the paths built from them.
  const legParts = S.legs.map((leg) => {
    const hp = proj(leg.hp.x, leg.hp.y, leg.hp.z, H);
    const kn = proj(leg.kn.x, leg.kn.y, leg.kn.z, H);
    const an = proj(leg.an.x, leg.an.y, leg.an.z, H);
    return {
      leg, hp, kn, an,
      thigh: capsule(hp, kn, DIM.rThigh * H * hp.k, DIM.rKnee * H * kn.k),
      shin: capsule(kn, an, DIM.rKnee * H * kn.k, DIM.rAnkle * H * an.k),
    };
  });

  const armParts = S.arms.map((arm) => {
    const sh = proj(arm.sh.x, arm.sh.y, arm.sh.z, H);
    const el = proj(arm.el.x, arm.el.y, arm.el.z, H);
    const wr = proj(arm.wr.x, arm.wr.y, arm.wr.z, H);
    // The collection wears SHORT-SLEEVE flannel: the sleeve is part of the
    // shirt and the bare arm starts partway down the bicep. Building it that
    // way means there is no shoulder seam to hide.
    const sleeveEnd = lerpPt(sh, el, 0.62);
    const bareStart = lerpPt(sh, el, 0.46);
    return {
      arm, sh, el, wr, sleeveEnd,
      sleeve: capsule(sh, sleeveEnd, DIM.rArm * H * sh.k * 1.16, DIM.rElbow * H * 1.06),
      upper: capsule(bareStart, el, DIM.rElbow * H * el.k * 1.02, DIM.rElbow * H * el.k),
      fore: capsule(el, wr, DIM.rElbow * H * el.k * 0.92, DIM.rWrist * H * wr.k),
    };
  });

  const shirtPath = torsoPath(S, H, armParts);
  const painted = spritesReady();

  ctx.save();
  ctx.translate(sx, sy);
  if (laneLean) ctx.rotate(laneLean * 0.10);

  // Trailing ghosts of the swinging shin — reads as speed, not as a bug.
  if (!o.sliding && !o.airborne && (o.speedK || 0) > 0.15) {
    const smear = 0.09 + (o.speedK || 0) * 0.12;
    for (const back of [0.030, 0.058]) {
      const ghost = skeleton(poseRunner({ ...o, phase: (o.phase || 0) - back }), H, laneLean);
      ctx.globalAlpha = smear * (back > 0.04 ? 0.5 : 1);
      ctx.fillStyle = css(scale(pants, 0.7));
      for (const leg of ghost.legs) {
        const kn = proj(leg.kn.x, leg.kn.y, leg.kn.z, H);
        const an = proj(leg.an.x, leg.an.y, leg.an.z, H);
        ctx.fill(capsule(kn, an, DIM.rKnee * H * kn.k, DIM.rAnkle * H * an.k));
      }
      ctx.globalAlpha = 1;
    }
  }

  // Warm halo around the whole figure — the sun is down the alley ahead of the
  // runner, so the silhouette is what catches the light. Only for the
  // procedural body: the painted parts have their own baked rim, and the
  // capsule silhouette does not match the art closely enough to hide behind it.
  if (!painted) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,168,96,0.85)';
    ctx.shadowBlur = Math.max(3, H * 0.045);
    ctx.fillStyle = 'rgba(26,14,34,1)';
    const all = new Path2D();
    for (const p of legParts) { all.addPath(p.thigh); all.addPath(p.shin); }
    for (const p of armParts) { all.addPath(p.upper); all.addPath(p.fore); }
    all.addPath(shirtPath);
    ctx.fill(all);
    ctx.restore();
  }

  // Limbs swinging forward are farther from us, so they paint first.
  const legOrder = [...legParts].sort((a, b) => b.an.z - a.an.z);
  const armOrder = [...armParts].sort((a, b) => b.wr.z - a.wr.z);

  drawBody3D(ctx, S, H, { skin, shirt, pants });
  drawHead(ctx, pose, S, H, rig, skin);

  ctx.restore();
}

// ----------------------------------------------------------------- toon 3D
//
// Subway Surfers characters are a single skinned 3D mesh, which is why their
// limbs never come apart. 2D cut-outs cannot reproduce that — parts either
// abut or overlap, and both read as loose pieces.
//
// So the body IS 3D here: every bone is a chain of overlapping spheres in the
// skeleton's own 3D space, depth-sorted and drawn back-to-front. Joints share
// spheres, so the surface is continuous by construction. Each bone fills its
// spheres from ONE shared screen-space gradient, so consecutive circles blend
// into a smooth shaded tube instead of reading as a string of beads.

/** Push a sphere chain along a bone. `squash` flattens it into a slab. */
function limbSpheres(out, a, b, ra, rb, colour, squash = 1) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(3, Math.round(dist / (Math.min(ra, rb) * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      r: ra + (rb - ra) * t,
      squash,
      colour,
      bone: out.boneId,
    });
  }
}

function drawBody3D(ctx, S, H, col) {
  const spheres = [];
  const bones = [];
  const push = (a, b, ra, rb, colour, squash) => {
    spheres.boneId = bones.length;
    bones.push({ a, b, colour, r: Math.max(ra, rb) });
    limbSpheres(spheres, a, b, ra, rb, colour, squash);
  };

  const hipC = { x: S.hipX, y: S.hipY, z: 0 };
  const shC = { x: S.hipX * 0.6, y: S.shoulderY, z: S.shoulderZ };

  // Torso as a squashed chain: a slab, not a tube. Kept narrow enough that the
  // arms stay separate blobs — merge them and the whole upper body becomes one
  // shapeless mass.
  push(hipC, shC, DIM.hipHalf * H * 1.12, DIM.shoulderHalf * H * 1.16, col.shirt, 0.66);

  for (const leg of S.legs) {
    push(leg.hp, leg.kn, DIM.rThigh * H * 1.10, DIM.rKnee * H * 1.04, col.pants, 1);
    push(leg.kn, leg.an, DIM.rKnee * H * 1.04, DIM.rAnkle * H * 1.10, col.pants, 1);
    // Shoe: a flattened chain running forward from the ankle, so it is part of
    // the same depth-sorted surface instead of a slab pasted on afterwards.
    const fr = -leg.footAng * 0.62;
    const toe = {
      x: leg.an.x + leg.side * 0.006 * H,
      y: leg.an.y - Math.cos(fr) * H * 0.030,
      z: leg.an.z - Math.sin(fr) * H * 0.085,
    };
    push(leg.an, toe, DIM.rAnkle * H * 1.20, DIM.rAnkle * H * 1.34, SHOE, 0.62);
  }
  for (const arm of S.arms) {
    // The sleeve is the top of the upper arm, so the shoulder end wears the
    // shirt colour and the transition happens mid-bone.
    const mid = {
      x: arm.sh.x + (arm.el.x - arm.sh.x) * 0.42,
      y: arm.sh.y + (arm.el.y - arm.sh.y) * 0.42,
      z: arm.sh.z + (arm.el.z - arm.sh.z) * 0.42,
    };
    push(arm.sh, mid, DIM.rArm * H * 1.22, DIM.rArm * H * 1.08, col.shirt, 1);
    push(mid, arm.el, DIM.rArm * H * 0.98, DIM.rElbow * H * 1.02, col.skin, 1);
    push(arm.el, arm.wr, DIM.rElbow * H * 1.02, DIM.rWrist * H * 1.28, col.skin, 1);
  }

  // Painter's algorithm: farthest (largest +z) first.
  spheres.sort((p, q) => q.z - p.z);

  // One gradient per bone, reused by all of its spheres.
  const grads = bones.map((bn) => {
    const A = proj(bn.a.x, bn.a.y, bn.a.z, H);
    const B = proj(bn.b.x, bn.b.y, bn.b.z, H);
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular to the bone, pointing to screen-right.
    let px = -dy / len, py = dx / len;
    if (px < 0) { px = -px; py = -py; }
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const r = bn.r * 1.35;
    const g = ctx.createLinearGradient(mx - px * r, my - py * r, mx + px * r, my + py * r);
    const base = lift(bn.colour);
    g.addColorStop(0.00, css(scale(mix(base, AMBIENT, 0.30), 0.72)));
    g.addColorStop(0.32, css(scale(base, 0.88)));
    g.addColorStop(0.70, css(base));
    g.addColorStop(0.93, css(scale(base, 1.12)));
    g.addColorStop(1.00, css(mix(scale(base, 1.12), RIM, 0.58)));
    return g;
  });

  ctx.save();
  for (const s of spheres) {
    const p = proj(s.x, s.y, s.z, H);
    const r = s.r * p.k;
    if (r < 0.4) continue;
    ctx.fillStyle = grads[s.bone];
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * (s.squash < 1 ? 1 : 1), r * s.squash, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------ painted (cut-out) rig

function paintedLeg(ctx, part, H, dim) {
  const { hp, kn, an, leg } = part;
  const flip = leg.side < 0 ? -1 : 1;
  drawPart(ctx, 'thigh', hp, kn, H, (hp.k + kn.k) / 2, flip, dim);
  drawPart(ctx, 'shin', kn, an, H, (kn.k + an.k) / 2, flip, dim);

  // The shoe art is a side profile, so it is placed on the foot's own axis
  // rather than between two joints.
  const footRot = -leg.footAng * 0.62;
  const toe = {
    x: an.x + Math.cos(footRot) * H * 0.078 * flip,
    y: an.y + Math.sin(footRot) * H * 0.078,
  };
  drawPart(ctx, 'shoe', an, toe, H, an.k, flip, dim);
}

function paintedUpperArm(ctx, part, H, dim) {
  const { sh, el, arm } = part;
  const flip = arm.side < 0 ? -1 : 1;
  // Start the bone above the shoulder joint so its cap is well inside the
  // torso rather than butting against the sleeve edge.
  const root = { x: sh.x + (sh.x - el.x) * 0.10, y: sh.y + (sh.y - el.y) * 0.10, k: sh.k };
  drawPart(ctx, 'upperarm', root, el, H, (sh.k + el.k) / 2, flip, dim);
}

function paintedForearm(ctx, part, H, dim) {
  const { el, wr, arm } = part;
  const flip = arm.side < 0 ? -1 : 1;
  drawPart(ctx, 'forearm', el, wr, H, (el.k + wr.k) / 2, flip, dim);
}

/** Neck column, drawn before the shirt so the collar swallows its base. */
function paintedNeck(ctx, pose, S, H, skin) {
  const twist = S.twist * H * 0.4;
  const base = proj(S.hipX * 0.6, S.shoulderY - H * 0.03, S.shoulderZ + twist * 0.2, H);
  const top = proj(S.hipX * 0.6, S.shoulderY + H * 0.085, S.shoulderZ + twist * 0.2, H);
  const w = H * 0.052;
  const g = ctx.createLinearGradient(base.x - w, 0, base.x + w, 0);
  g.addColorStop(0, css(scale(mix(skin, AMBIENT, 0.4), 0.5)));
  g.addColorStop(0.5, css(scale(skin, 0.62)));
  g.addColorStop(1, css(scale(mix(skin, AMBIENT, 0.4), 0.5)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(base.x - w, base.y);
  ctx.lineTo(top.x - w * 0.86, top.y);
  ctx.lineTo(top.x + w * 0.86, top.y);
  ctx.lineTo(base.x + w, base.y);
  ctx.closePath();
  ctx.fill();
}

function paintedTorso(ctx, S, H) {
  const twist = S.twist * H * 0.4;
  const neck = proj(S.hipX * 0.6, S.shoulderY, S.shoulderZ + twist * 0.2, H);
  const waist = proj(S.hipX, S.hipY, 0, H);
  drawPart(ctx, 'torso', neck, waist, H, 1, 1, 1);

  // Occlusion where the head sits on the collar. Without it the head reads as
  // hovering above the shoulders rather than resting on them.
  ctx.save();
  ctx.globalAlpha = 0.45;
  if (typeof ctx.filter === 'string') ctx.filter = `blur(${Math.max(1, H * 0.018)}px)`;
  ctx.fillStyle = '#160c22';
  ctx.beginPath();
  ctx.ellipse(neck.x, neck.y + H * 0.012, H * 0.088, H * 0.030, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLeg(ctx, part, H, pants, dim) {
  const { hp, kn, an, leg } = part;
  const out = leg.side;

  shadeLimb(ctx, part.thigh, hp, kn,
    DIM.rThigh * H * hp.k, DIM.rKnee * H * kn.k, pants, out, dim);
  occlude(ctx, kn, DIM.rKnee * H * 1.5);
  shadeLimb(ctx, part.shin, kn, an,
    DIM.rKnee * H * kn.k, DIM.rAnkle * H * an.k, pants, out, dim);

  // Denim outseam.
  ctx.save();
  ctx.globalAlpha = 0.24 * dim;
  ctx.strokeStyle = css(scale(pants, 1.5));
  ctx.lineWidth = Math.max(0.6, H * 0.006);
  ctx.beginPath();
  ctx.moveTo(hp.x + out * DIM.rThigh * H * 0.55, hp.y);
  ctx.lineTo(kn.x + out * DIM.rKnee * H * 0.55, kn.y);
  ctx.lineTo(an.x + out * DIM.rAnkle * H * 0.5, an.y);
  ctx.stroke();
  ctx.restore();

  drawShoe(ctx, an, leg.footAng, H, dim, out);
}

function drawShoe(ctx, an, footAng, H, dim, out) {
  ctx.save();
  ctx.translate(an.x, an.y);
  ctx.rotate(-footAng * 0.62);
  const fw = 0.112 * H * an.k;
  const fh = 0.058 * H * an.k;

  // The upper starts ABOVE the ankle joint so the shin never separates from
  // the shoe as the foot pitches.
  const g = ctx.createLinearGradient(0, -fh * 0.55, 0, fh * 0.6);
  g.addColorStop(0, css(scale([246, 243, 234], dim)));
  g.addColorStop(0.62, css(scale([210, 204, 190], dim)));
  g.addColorStop(1, css(scale([146, 138, 128], dim)));
  ctx.fillStyle = g;
  roundRect(ctx, -fw * 0.46, -fh * 0.58, fw * 0.92, fh * 1.06, fh * 0.34);
  ctx.fill();
  // toe box, pushed forward of the ankle
  ctx.beginPath();
  ctx.ellipse(fw * 0.10, fh * 0.10, fw * 0.42, fh * 0.40, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = css(scale([206, 56, 56], dim));   // swoosh
  roundRect(ctx, -fw * 0.40, -fh * 0.06, fw * 0.72, fh * 0.16, fh * 0.06);
  ctx.fill();
  ctx.fillStyle = css(scale([238, 228, 208], dim)); // midsole
  roundRect(ctx, -fw * 0.48, fh * 0.30, fw * 1.00, fh * 0.24, fh * 0.10);
  ctx.fill();
  ctx.fillStyle = 'rgba(20,10,26,0.34)';            // gum outsole
  roundRect(ctx, -fw * 0.48, fh * 0.48, fw * 1.00, fh * 0.10, fh * 0.05);
  ctx.fill();

  ctx.globalAlpha = 0.55 * dim;
  ctx.fillStyle = css(RIM);
  ctx.fillRect(out > 0 ? fw * 0.36 : -fw * 0.48, -fh * 0.5, fw * 0.1, fh * 0.9);
  ctx.restore();
}

function drawArm(ctx, part, H, skin, dim) {
  const { sh, el, wr, arm } = part;
  const out = arm.side;
  const bareStart = lerpPt(sh, el, 0.46);

  // Only the bare arm is drawn here — the sleeve belongs to the shirt.
  shadeLimb(ctx, part.upper, bareStart, el,
    DIM.rElbow * H * el.k * 1.02, DIM.rElbow * H * el.k, skin, out, dim);
  occlude(ctx, el, DIM.rElbow * H * 1.25);
  shadeLimb(ctx, part.fore, el, wr,
    DIM.rElbow * H * el.k * 0.92, DIM.rWrist * H * wr.k, skin, out, dim);

  // fist
  const r = DIM.rWrist * H * wr.k * 1.26;
  const g = ctx.createRadialGradient(
    wr.x - out * r * 0.4, wr.y - r * 0.4, r * 0.1, wr.x, wr.y, r);
  g.addColorStop(0, css(scale(skin, 1.0 * dim)));
  g.addColorStop(0.74, css(scale(skin, 0.8 * dim)));
  g.addColorStop(1, css(scale(mix(skin, AMBIENT, 0.3), 0.6 * dim)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(wr.x, wr.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.4 * dim;
  ctx.fillStyle = css(RIM);
  ctx.beginPath();
  ctx.arc(wr.x + out * r * 0.5, wr.y, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Torso + short flannel sleeves, unioned into one silhouette. */
function torsoPath(S, H, armParts) {
  const twist = S.twist * H * 0.4;
  const hipHalf = DIM.hipHalf * H;
  const shHalf = DIM.shoulderHalf * H;

  const hl = proj(S.hipX - hipHalf, S.hipY, 0, H);
  const hr = proj(S.hipX + hipHalf, S.hipY, 0, H);
  const sl = proj(S.hipX * 0.6 - shHalf, S.shoulderY, S.shoulderZ - twist, H);
  const sr = proj(S.hipX * 0.6 + shHalf, S.shoulderY, S.shoulderZ + twist, H);
  const cx = (sl.x + sr.x) / 2;

  const body = new Path2D();
  body.moveTo(hl.x - H * 0.012, hl.y);
  body.bezierCurveTo(
    hl.x - H * 0.030, hl.y - (hl.y - sl.y) * 0.42,
    sl.x - H * 0.012, sl.y + (hl.y - sl.y) * 0.30,
    sl.x, sl.y);
  body.quadraticCurveTo(cx, sl.y - H * 0.026, sr.x, sr.y);
  body.bezierCurveTo(
    sr.x + H * 0.012, sr.y + (hr.y - sr.y) * 0.30,
    hr.x + H * 0.030, hr.y - (hr.y - sr.y) * 0.42,
    hr.x + H * 0.012, hr.y);
  body.quadraticCurveTo(cx, hr.y + H * 0.026, hl.x - H * 0.012, hl.y);
  body.closePath();

  const shirt = new Path2D();
  shirt.addPath(body);
  for (const a of armParts) shirt.addPath(a.sleeve);
  shirt.bounds = { hl, hr, sl, sr, cx };
  return shirt;
}

function drawTorso(ctx, S, H, shirtPath, shirt, u) {
  const { hl, hr, sl, sr, cx } = shirtPath.bounds;

  const sleeveOut = DIM.armHalf * H + DIM.rArm * H * 1.2;
  const bx = Math.min(sl.x, hl.x, cx - sleeveOut) - H * 0.06;
  const by = Math.min(sl.y, sr.y) - H * 0.09;
  const bw = Math.max(sr.x, hr.x, cx + sleeveOut) - bx + H * 0.12;
  const bh = Math.max(hl.y, hr.y) - by + H * 0.12;

  ctx.save();
  ctx.save();
  ctx.clip(shirtPath);
  plaidCurved(ctx, bx, by, bw, bh, css(shirt), css(scale(shirt, 0.55)), u < 22);

  // Backlit shading across the back: rim at both edges, shadow through the
  // core. Anchored to the SILHOUETTE, not the padded fill box — anchor it to
  // the box and the rim stops land off the body, leaving a flat slab.
  const lx = Math.min(sl.x, hl.x, cx - sleeveOut);
  const rx = Math.max(sr.x, hr.x, cx + sleeveOut);
  const across = ctx.createLinearGradient(lx, 0, rx, 0);
  across.addColorStop(0.00, css(RIM, 0.70));
  across.addColorStop(0.20, css(RIM, 0));
  across.addColorStop(0.50, css(AMBIENT, 0.44));
  across.addColorStop(0.80, css(RIM, 0));
  across.addColorStop(1.00, css(RIM, 0.70));
  ctx.fillStyle = across;
  ctx.fillRect(bx, by, bw, bh);

  // shoulder yoke catching the sky, shadow gathering at the hem
  const down = ctx.createLinearGradient(0, by, 0, by + bh);
  down.addColorStop(0.00, 'rgba(255,214,164,0.26)');
  down.addColorStop(0.34, 'rgba(0,0,0,0)');
  down.addColorStop(1.00, 'rgba(20,10,30,0.44)');
  ctx.fillStyle = down;
  ctx.fillRect(bx, by, bw, bh);

  // spine crease
  ctx.fillStyle = 'rgba(16,8,24,0.26)';
  ctx.fillRect(cx - H * 0.007, by, H * 0.014, bh);
  ctx.restore();

  // Collar: the flannel's stand, plus the white tee showing under it. Without
  // this the head reads as sitting straight on a slab.
  const cy = (sl.y + sr.y) / 2;
  ctx.fillStyle = css(scale(shirt, 1.28));
  ctx.beginPath();
  ctx.moveTo(cx - H * 0.052, cy + H * 0.012);
  ctx.quadraticCurveTo(cx, cy - H * 0.030, cx + H * 0.052, cy + H * 0.012);
  ctx.quadraticCurveTo(cx, cy + H * 0.004, cx - H * 0.052, cy + H * 0.012);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(244,240,230,0.72)';
  ctx.beginPath();
  ctx.moveTo(cx - H * 0.036, cy + H * 0.010);
  ctx.quadraticCurveTo(cx, cy - H * 0.014, cx + H * 0.036, cy + H * 0.010);
  ctx.quadraticCurveTo(cx, cy + H * 0.001, cx - H * 0.036, cy + H * 0.010);
  ctx.closePath();
  ctx.fill();

  // hem shadow, so the shirt sits over the jeans rather than merging with them
  ctx.fillStyle = 'rgba(14,7,22,0.34)';
  ctx.beginPath();
  ctx.moveTo(hl.x - H * 0.012, hl.y);
  ctx.quadraticCurveTo(cx, hr.y + H * 0.030, hr.x + H * 0.012, hr.y);
  ctx.quadraticCurveTo(cx, hr.y + H * 0.008, hl.x - H * 0.012, hl.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHead(ctx, pose, S, H, rig, skin) {
  const neck = proj(S.hipX * 0.6, S.shoulderY + H * 0.010, S.shoulderZ, H);
  const size = DIM.headSize * H;

  ctx.save();
  ctx.translate(neck.x, neck.y);
  ctx.rotate(pose.headTilt * 0.55);

  if (rig.head) {
    // The sprite's head fills ~0.875 of the box, sitting low in it — line the
    // chin up with the collar.
    // The chin is pushed DOWN into the collar. A head that merely sits on top
    // of the shoulders always reads as a ball balanced on a body.
    ctx.drawImage(rig.head, -size / 2, -size * 0.700, size, size);
  } else {
    const g = ctx.createRadialGradient(
      -size * 0.12, -size * 0.55, size * 0.04, 0, -size * 0.42, size * 0.42);
    g.addColorStop(0, css(scale(skin, 1.05)));
    g.addColorStop(1, css(scale(mix(skin, AMBIENT, 0.35), 0.62)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.42, size * 0.35, size * 0.39, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------- portrait (menus)

/**
 * Front-facing portrait for the menu tiles and the HUD badge. Also used to
 * bake head sprites for the code-drawn crew.
 */
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
