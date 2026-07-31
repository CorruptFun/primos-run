// La Migra, front on — the three agents closing on you in the opening shot.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE RUNNER RIG
// The whole game is played from behind the player, and primo-runner.js only
// knows how to draw a back view. The intro's hero shot puts the camera IN FRONT,
// so the pursuers run AT it — a view that rig cannot produce. This is the
// front-facing counterpart: the same 3D-skeleton-into-union-paths approach, the
// opposite camera, and a completely different set of problems.
//
// THE ONE IDEA THAT MAKES A FRONT VIEW WORK
// Seen from behind, a run reads through limbs swinging in DEPTH (CLAUDE.md).
// Seen from the FRONT that same swing points straight down the lens and mostly
// cancels: raise a knee toward the camera and perspective drops it back down the
// screen by nearly as much. Three other things carry the motion, and they are
// why the projection is tuned the way it is:
//
//   SCALE   PERSP is deliberately strong. A fist driven forward comes out about
//           a quarter bigger than the same fist driven back. That size beat is
//           the most legible thing about the figure at 60px.
//   OVERLAP The near arm and near leg are drawn OVER the vest with a dark
//           keyline behind them, the far ones under it. Depth with edges.
//   ELBOW   The arm is read at the FIST, not the shoulder. Forward drive folds
//           the elbow and brings the glove to shoulder height; back drive opens
//           it and drops the glove past the hip — about 0.30h of vertical
//           travel, the loudest signal in the whole figure.
//   DROP is correspondingly LOW. Raise it and the knee lift dies exactly the way
//   TILT kills the back view's heel kick.
//
// PROPORTION IS WHAT SEPARATES THIS FROM A BLOB, AND IT IS NOT THE RUNNER'S
// The player is chibi — head wider than the shoulders, which is the measurement
// that makes a Primo a Primo. Copying that here produced a bobblehead in armour
// with two sticks under it. These are adults: head about a third of the shoulder
// span and a seventh of the height, legs a shade under half the total. The vest
// hem lands at the WAIST, not mid-chest — hung low it swallows the thighs and
// the figure turns back into a lump on legs.
//
// THE LIGHT
// The sun is low, straight down the alley, BEHIND them — the hero shot's halo is
// built on the same assumption. So they are rim-lit along their top contours and
// everything facing the camera is filled only by cold sky bounce. That is not a
// mood choice, it is what makes a front view drawable at all: no face has to be
// rendered, only implied. Warm rim, cool fill, and the one bright accent left in
// the figure is a pair of hot eyes under a cap.
//
// TWO THINGS WERE TRIED HERE AND CUT, SO THEY DO NOT COME BACK
//   A TORCH pointed at the camera. It is a glare, not a beam — a pale disc
//   landing on the chest, eating the ICE stencil, and taking the eye off the
//   eyes. There is room for exactly one bright accent on a figure this size.
//   A CHIN STRAP. It curves across the lower face and reads as a mouth under the
//   two eyes, which is the same trap that cost an earlier pass a cap button and
//   a lit brim. THE RULE: ON THE HEAD, NOTHING IS BRIGHT OR CURVED EXCEPT THE
//   EYES. Every other highlight lives below the collar, where a horizontal
//   cannot pair with them into a face.
//
// SIZE
// intro.js draws these at min(W*0.34, H*0.185) * depthScale — about 125px for
// the nearest on a phone, down to ~50px for the one furthest back. Detail that
// dies below 60px is wasted paint, so the stencil, the vest trim, the boot soles
// and the radio LED sit behind size gates the way props.js gates its close-range
// trim.

import { roundRect } from './palette.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- projection
//
// Local body space: x lateral, y UP, z TOWARD THE CAMERA. Every length is a
// fraction of `h`, the body scale intro.js passes in, so one solve serves all
// three agents at whatever size they happen to be.
const DROP = 0.055;    // screen-y gained per unit z — the camera sits a little high
const PERSP = 0.72;    // radius gained per unit z — this is what carries the swing
const SPLAY = 0.40;    // lateral spread per unit z, so forward limbs open outward
const KMIN = 0.66;     // a trailing foot is genuinely far, but not a dot

// --------------------------------------------------------------- proportions
//
// Measured against the total height, which is about 1.32h from cap to sole:
// shoulders a third of it, head a seventh, legs a shade under half. The two that
// were got wrong first time and matter most:
//
//   THE ARMOUR IS NARROWER THAN THE SHOULDERS. A plate carrier sits BETWEEN the
//   deltoids. Made as wide as the figure it swallows both arms, and the whole
//   upper body collapses into one slab with a glove floating beside it.
//   THE HEM SITS AT THE WAIST. Hung to the hip it eats the belt and the top of
//   the thighs, and the figure turns back into a lump on legs.
const D = {
  shoulderY: 0.445,
  hipHalf: 0.088,
  vestHalf: 0.170,       // the carrier — deliberately inside the deltoids
  vestWaist: 0.134,
  armX: 0.168,           // the shoulder joint, just outside the carrier's edge
  upper: 0.200, fore: 0.188,
  thigh: 0.300, shin: 0.280,
  rSh: 0.064, rElb: 0.050, rWr: 0.041,
  rHip: 0.078, rKnee: 0.062, rAnk: 0.054,
  headY: 0.625, headRX: 0.076, headRY: 0.090,
  lean: 0.060,           // charging: the shoulders lead the hips toward the lens
};

// ------------------------------------------------------------------ run cycle
//
// Angles are radians from straight-down; + swings TOWARD the camera. The leg
// tables are the same shape as the player's proven cycle in runner.js (strike,
// toe-off, heel tuck at 0.62, knee drive) because a run is a run — what changed
// is the camera, not the gait.
//
// The ARM tables are authored here rather than borrowed. A back view's arms only
// ever have to hang and angle backward; a front view has to show the fist
// climbing to the chest and dropping behind the hip, so the elbow flexes the
// forearm FORWARD (e = shoulder + elbow) instead of folding it back.
const THIGH = [[0, 0.58], [0.14, 0.22], [0.30, -0.12], [0.48, -0.62], [0.62, -0.22], [0.76, 0.34], [0.88, 0.60]];
const KNEE = [[0, 0.20], [0.14, 0.42], [0.30, 0.16], [0.48, 0.62], [0.62, 1.74], [0.76, 1.16], [0.88, 0.42]];
const ANKLE = [[0, -0.12], [0.30, 0.06], [0.48, 0.58], [0.62, 0.34], [0.88, -0.12]];
// Counter-phase to the leg on the SAME side, baked into the tables: at p = 0 the
// leg is forward and the arm on that side is back.
const SHOULD = [[0, -0.66], [0.26, 0.06], [0.50, 0.72], [0.76, 0.20]];
const ELBOW = [[0, 0.86], [0.26, 1.28], [0.50, 1.62], [0.76, 1.25]];

/** Piecewise track with smoothstep easing, wrapping at phase 1. */
function track(keys, p) {
  const n = keys.length;
  p = ((p % 1) + 1) % 1;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (keys[k][0] <= p) i = k; else break;
  }
  const a = keys[i], b = keys[(i + 1) % n];
  let span = b[0] - a[0];
  if (span <= 0) span += 1;
  let f = (p - a[0]) / span;
  if (f < 0) f += 1 / span;
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  return a[1] + (b[1] - a[1]) * (f * f * (3 - 2 * f));
}

/**
 * Per-agent gait. They used to share one formula offset by index, which is
 * exactly what made them read as one animated object stamped three times. Each
 * now has its own cadence, stride length, arm drive, shoulder roll and bounce,
 * and the rates are deliberately NON-HARMONIC — 1.58 / 1.76 / 1.44 never come
 * back into step, so the crew keeps drifting apart for as long as the shot runs.
 *
 * The rates are also fast: about 190 steps a minute, which is a sprint rather
 * than the jog the old shared formula ran at. They are closing on you.
 */
const AGENTS = [
  { rate: 1.58, ph: 0.00, stride: 1.16, arm: 1.02, roll: 0.030, bob: 1.00 },
  { rate: 1.76, ph: 0.41, stride: 1.02, arm: 1.14, roll: 0.048, bob: 1.18 },
  { rate: 1.44, ph: 0.73, stride: 1.24, arm: 0.90, roll: 0.020, bob: 0.86 },
];

// -------------------------------------------------------------------- colour
//
// Layered dark tones, never one flat black — but the interior of a backlit
// figure is read against a bright sky, and a value plan that is merely subtle
// disappears entirely out there. So the spread is wider than it looks like it
// should be on paper, and it is spent on THREE things and no more:
//
//   MASS    the vest, the cap bill, the gloves, the boots, the face. The darkest
//           tones, and the centre of the figure is the darkest thing in it.
//   UNIFORM sleeves and trousers, a clear step up from the armour so the limbs
//           separate from the mass they are swinging around.
//   CATCH   the cap crown, the shoulder yoke, the belt lip. What the sun and the
//           sky actually land on, plus the ICE stencil, the one true light.
//
// Everything is mixed toward a COOL slate rather than a warm one. props.js sets
// the rule for the whole alley: a warm rim is the sun and means your body gets
// past this, a cold one is a flasher and means it does not. These are the three
// things in the opening you cannot get past.

const SLATE = [80, 90, 120];

const PAL_CACHE = new Map();

function parseHex(c) {
  if (c.charCodeAt(0) !== 35) return [22, 14, 30];
  const n = parseInt(c.slice(1), 16);
  return c.length === 4
    ? [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
    : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixed(c, t) {
  return `rgb(${(c[0] + (SLATE[0] - c[0]) * t) | 0},${(c[1] + (SLATE[1] - c[1]) * t) | 0},${(c[2] + (SLATE[2] - c[2]) * t) | 0})`;
}

/**
 * The uniform, derived once per tint and cached. intro.js hands each crew member
 * a slightly different base so the ones further back sit deeper in the haze;
 * deriving from it keeps that depth cue rather than overriding it.
 */
function icePal(tint) {
  const hit = PAL_CACHE.get(tint);
  if (hit) return hit;
  const c = parseHex(tint);
  const out = {
    deep: `rgb(${(c[0] * 0.35) | 0},${(c[1] * 0.35) | 0},${(c[2] * 0.35) | 0})`,
    gearD: mixed(c, 0.02),
    gear: mixed(c, 0.20),
    vestD: mixed(c, 0.03),
    vest: mixed(c, 0.12),
    dutyD: mixed(c, 0.20),
    duty: mixed(c, 0.44),
    panel: mixed(c, 0.60),
  };
  PAL_CACHE.set(tint, out);
  return out;
}

const RIM_SOFT = 'rgba(255,176,104,0.13)';   // the sun spilling round the edge
const RIM_HARD = 'rgba(255,198,132,0.60)';   // where it actually catches
const KEY = 'rgba(7,3,12,0.80)';             // what holds them off a busy alley
const EYE = 'rgba(255,102,68,0.96)';
const EYE_GLOW = 'rgba(255,72,44,0.20)';
const YOKE_LIT = 'rgba(255,206,150,0.22)';
const LETTER = 'rgba(242,238,228,0.88)';
const TRIM_LIP = 'rgba(255,206,152,0.20)';
const BILL_SHADE = 'rgba(4,2,8,0.62)';
const SOLE = 'rgba(255,210,158,0.28)';

// Font strings are the only thing here that would allocate per frame. One slot
// is enough — the cache only has to survive a single fillText.
let fontPx = -1;
let fontStr = '';
function iceFont(px) {
  if (px !== fontPx) {
    fontPx = px;
    fontStr = `900 ${px}px ui-rounded, system-ui, sans-serif`;
  }
  return fontStr;
}

// ---------------------------------------------------------------- union paths
//
// Lifted from primo-runner.js, and the winding comment there is load bearing —
// wound the other way the tangent quad CANCELS against the joint circles under
// nonzero fill and every joint gets a half-disc punched through it. Never
// stroke() one of these paths: it holds a subpath per joint and a stroke
// outlines all of them. For an edge, fill an inflated copy behind it.
function bone(p, ax, ay, ar0, bx, by, br0, grow) {
  const ar = Math.max(0.2, ar0 + grow), br = Math.max(0.2, br0 + grow);
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);

  p.moveTo(ax + ar, ay);
  p.arc(ax, ay, ar, 0, TAU);
  p.moveTo(bx + br, by);
  p.arc(bx, by, br, 0, TAU);
  if (len <= Math.abs(ar - br) + 0.01) return;

  const ang = Math.atan2(dy, dx);
  const off = Math.acos(Math.max(-1, Math.min(1, (ar - br) / len)));
  const a1 = ang + off, a2 = ang - off;
  p.moveTo(ax + Math.cos(a2) * ar, ay + Math.sin(a2) * ar);
  p.lineTo(bx + Math.cos(a2) * br, by + Math.sin(a2) * br);
  p.lineTo(bx + Math.cos(a1) * br, by + Math.sin(a1) * br);
  p.lineTo(ax + Math.cos(a1) * ar, ay + Math.sin(a1) * ar);
  p.closePath();
}

function blob(p, x, y, r, grow) {
  const rr = Math.max(0.2, r + grow);
  p.moveTo(x + rr, y);
  p.arc(x, y, rr, 0, TAU);
}

/**
 * Fill a form, then darken its lower half inside itself.
 *
 * The inverse of the runner's cel pass, because the light is behind rather than
 * above-left: the base tone goes down, then a darker copy offset DOWN is clipped
 * to the same shape. What survives is a band of the lighter tone along the TOP
 * contour of every form and shadow everywhere below it, which is what a low sun
 * behind a figure actually does. Offsetting rather than insetting matters for
 * the same reason it does in primo-runner — an inset copy leaves a dark rim all
 * the way round every part and the figure reads as a chalk outline.
 */
function shade(ctx, build, base, dark, h) {
  ctx.beginPath();
  build(ctx, 0);
  ctx.fillStyle = base;
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.translate(h * 0.008, h * 0.030);
  ctx.beginPath();
  build(ctx, 0);
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.restore();
}

/** An inflated dark copy behind a limb that crosses the body. Contact, not outline. */
function keyline(ctx, build, h) {
  ctx.beginPath();
  build(ctx, h * 0.013);
  ctx.fillStyle = KEY;
  ctx.fill();
}

// Every path builder handed to shade() or keyline() is a MODULE-LEVEL function
// reading whichever limb `_A` / `_L` currently points at, rather than a closure
// over one. Written the obvious way, a dozen closures are allocated per figure
// per frame — nothing that matters for a 2.5s shot, but nothing this file needs
// to be doing either, and it costs one variable to avoid.
let _A = null;
let _L = null;

function armSil(q, g) {
  const A = _A;
  bone(q, A.s.x, A.s.y, A.rS, A.e.x, A.e.y, A.rE, g);
  bone(q, A.e.x, A.e.y, A.rE * 0.94, A.w.x, A.w.y, A.rW, g);
  blob(q, A.w.x, A.w.y, A.rW * 1.24, g);
}

function armSleeve(q, g) {
  const A = _A;
  bone(q, A.s.x, A.s.y, A.rS, A.e.x, A.e.y, A.rE, g);
  bone(q, A.e.x, A.e.y, A.rE * 0.94, A.w.x, A.w.y, A.rW * 1.04, g);
}

function legTrouser(q, g) {
  const L = _L;
  bone(q, L.h.x, L.h.y, L.rH, L.k.x, L.k.y, L.rK, g);
  bone(q, L.k.x, L.k.y, L.rK, L.cf.x, L.cf.y, L.rC * 1.12, g);
}

function legBoot(q, g) {
  const L = _L;
  bone(q, L.cf.x, L.cf.y, L.rC * 0.94, L.a.x, L.a.y, L.rA * 1.30, g);
  bone(q, L.a.x, L.a.y, L.rA * 1.30, L.t.x, L.t.y, L.rA * 1.06, g);
}

function seatUnion(q, g) {
  bone(q, S.legs[0].h.x, S.legs[0].h.y, S.legs[0].rH * 1.02,
    S.legs[1].h.x, S.legs[1].h.y, S.legs[1].rH * 1.02, g);
}

// --------------------------------------------------------------- the skeleton
//
// Solved into ONE preallocated scratch structure and reused. This runs three
// times a frame for the ~2.5s of the opening; it is not the hot path, but there
// is no reason for it to churn objects either.

const pt = () => ({ x: 0, y: 0, k: 1 });
const S = {
  legs: [
    { h: pt(), k: pt(), a: pt(), t: pt(), z: 0, rH: 0, rK: 0, rA: 0, cf: pt(), rC: 0 },
    { h: pt(), k: pt(), a: pt(), t: pt(), z: 0, rH: 0, rK: 0, rA: 0, cf: pt(), rC: 0 },
  ],
  arms: [
    { s: pt(), e: pt(), w: pt(), z: 0, rS: 0, rE: 0, rW: 0 },
    { s: pt(), e: pt(), w: pt(), z: 0, rS: 0, rE: 0, rW: 0 },
  ],
  shL: pt(), shR: pt(), hipL: pt(), hipR: pt(),
  midS: pt(), midH: pt(), head: pt(),
  sr: 0, hr: 0,
};

function proj(out, x, y, z, h) {
  const k = Math.max(KMIN, 1 + z * PERSP);
  out.x = x * (1 + z * SPLAY) * h;
  out.y = (-y + z * DROP) * h;
  out.k = k;
  return out;
}

/** Point a fraction along a bone, radius interpolated to match. */
function along(out, a, b, ra, rb, f) {
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  return ra + (rb - ra) * f;
}

function solve(h, p, a) {
  const bob = 0.028 * a.bob * (0.5 - 0.5 * Math.cos(4 * Math.PI * p));
  const sway = 0.016 * Math.sin(TAU * p);
  // Shoulders rock, pelvis counter-rocks half as far, head stays level. A level
  // head over a rolling body is most of what separates a person running from a
  // sprite being wobbled.
  const roll = a.roll * Math.sin(TAU * p);
  const hipY = bob;
  const hipX = sway;
  const shY = hipY + D.shoulderY;
  const shZ = D.lean;

  for (let i = 0; i < 2; i++) {
    const L = S.legs[i];
    const side = i ? 1 : -1;
    const lp = p + i * 0.5;
    const th = track(THIGH, lp) * a.stride;
    const kn = track(KNEE, lp);
    const an = track(ANKLE, lp);
    const kA = th - kn;                        // the knee folds the shin BACK
    const aA = kA + an;

    const ox = hipX + side * D.hipHalf;
    const hy = hipY - side * roll * 0.45;
    const kneeY = hy - Math.cos(th) * D.thigh;
    const kneeZ = Math.sin(th) * D.thigh;
    const ankY = kneeY - Math.cos(kA) * D.shin;
    const ankZ = kneeZ + Math.sin(kA) * D.shin;

    proj(L.h, ox, hy, 0, h);
    proj(L.k, ox, kneeY, kneeZ, h);
    proj(L.a, ox, ankY, ankZ, h);
    proj(L.t, ox, ankY - Math.cos(aA) * 0.044, ankZ + Math.sin(aA) * 0.098, h);
    L.z = ankZ;
    L.rH = D.rHip * h * L.h.k;
    L.rK = D.rKnee * h * L.k.k;
    L.rA = D.rAnk * h * L.a.k;
    // Where the trouser blouses over the boot. BDUs are bloused, and the cuff is
    // what stops the leg reading as one tapering tube from hip to toe.
    L.rC = along(L.cf, L.k, L.a, L.rK, L.rA, 0.80);
  }

  for (let i = 0; i < 2; i++) {
    const A = S.arms[i];
    const side = i ? 1 : -1;
    const ap = p + i * 0.5;
    const sh = track(SHOULD, ap) * a.arm;
    const el = track(ELBOW, ap);
    const eA = sh + el;                        // the elbow folds the forearm FORWARD

    const ox = hipX + side * D.armX;
    const sy = shY + side * roll;
    const elbY = sy - Math.cos(sh) * D.upper;
    const elbZ = shZ + Math.sin(sh) * D.upper;
    const wrY = elbY - Math.cos(eA) * D.fore;
    const wrZ = elbZ + Math.sin(eA) * D.fore;
    // Elbows flare out, fists cross in as the arm drives forward. Without this
    // the arms swing on rails inside the shoulder line and there is nothing
    // lateral for the eye to catch.
    const fwd = Math.max(0, Math.sin(sh));

    proj(A.s, ox, sy, shZ, h);
    proj(A.e, ox + side * 0.042, elbY, elbZ, h);
    proj(A.w, ox - side * (0.004 + 0.052 * fwd), wrY, wrZ, h);
    A.z = wrZ;
    A.rS = D.rSh * h * A.s.k;
    A.rE = D.rElb * h * A.e.k;
    A.rW = D.rWr * h * A.w.k;
  }

  // The undershirt has to end up NARROWER than the carrier or it spills out
  // past the armour on both sides as a pale mass and fuses with the arms.
  proj(S.shL, hipX - D.vestHalf * 0.58, shY + roll, shZ, h);
  proj(S.shR, hipX + D.vestHalf * 0.58, shY - roll, shZ, h);
  proj(S.hipL, hipX - D.hipHalf, hipY - roll * 0.45, 0, h);
  proj(S.hipR, hipX + D.hipHalf, hipY + roll * 0.45, 0, h);
  proj(S.head, hipX, shY + (D.headY - D.shoulderY), shZ + 0.030, h);

  S.midS.x = (S.shL.x + S.shR.x) * 0.5;
  S.midS.y = (S.shL.y + S.shR.y) * 0.5;
  S.midH.x = (S.hipL.x + S.hipR.x) * 0.5;
  S.midH.y = (S.hipL.y + S.hipR.y) * 0.5;
  S.sr = D.vestHalf * h * 0.34;
  S.hr = D.hipHalf * h * 1.05;
}

/** The torso as bones round a quad plus one down the middle — see primo-runner. */
function torsoBones(p, g) {
  bone(p, S.shL.x, S.shL.y, S.sr, S.hipL.x, S.hipL.y, S.hr, g);
  bone(p, S.shR.x, S.shR.y, S.sr, S.hipR.x, S.hipR.y, S.hr, g);
  bone(p, S.midS.x, S.midS.y, S.sr * 1.04, S.midH.x, S.midH.y, S.hr * 1.04, g);
  bone(p, S.shL.x, S.shL.y, S.sr * 0.94, S.shR.x, S.shR.y, S.sr * 0.94, g);
  bone(p, S.hipL.x, S.hipL.y, S.hr * 0.92, S.hipR.x, S.hipR.y, S.hr * 0.92, g);
}

/**
 * Every part of the figure, for the one-and-only rim/key pass.
 *
 * The vest is included as a flat wide bone across the shoulders rather than as
 * its real outline: a bezier cannot be inflated by a scalar the way a bone can,
 * and the armour is drawn over the top of this anyway. The cap is the same deal
 * — a blob for the crown, a flat bone for the bill.
 */
function silhouette(p, h, g) {
  for (let i = 0; i < 2; i++) {
    const L = S.legs[i];
    bone(p, L.h.x, L.h.y, L.rH, L.k.x, L.k.y, L.rK, g);
    bone(p, L.k.x, L.k.y, L.rK, L.cf.x, L.cf.y, L.rC * 1.12, g);
    bone(p, L.a.x, L.a.y, L.rA * 1.30, L.t.x, L.t.y, L.rA * 1.06, g);
  }
  for (let i = 0; i < 2; i++) {
    const A = S.arms[i];
    bone(p, A.s.x, A.s.y, A.rS, A.e.x, A.e.y, A.rE, g);
    bone(p, A.e.x, A.e.y, A.rE * 0.94, A.w.x, A.w.y, A.rW, g);
    blob(p, A.w.x, A.w.y, A.rW * 1.24, g);
  }
  torsoBones(p, g);
  // The armour: a wide flat slab across the shoulders and a shorter one at the
  // waist, which between them are the whole outline of a vest.
  const vy = S.midS.y + h * 0.052;
  bone(p, S.midS.x - h * (D.vestHalf - 0.052), vy, h * 0.052,
    S.midS.x + h * (D.vestHalf - 0.052), vy, h * 0.052, g);
  bone(p, S.midS.x - h * (D.vestWaist - 0.040), S.midH.y - h * 0.100, h * 0.040,
    S.midS.x + h * (D.vestWaist - 0.040), S.midH.y - h * 0.100, h * 0.040, g);

  const hd = S.head;
  const rx = D.headRX * h * hd.k;
  const ry = D.headRY * h * hd.k;
  blob(p, hd.x, hd.y - ry * 0.30, rx * 1.24, g);
  bone(p, hd.x - rx * 1.34, hd.y - ry * 0.30, ry * 0.20,
    hd.x + rx * 1.34, hd.y - ry * 0.30, ry * 0.20, g);
}

// ---------------------------------------------------------------------- draw

/**
 * One agent.
 *
 * @param {number} cx,cy  the HIP, screen px — the same anchor the old flat
 *                        silhouette used, so the crew keeps its staging
 * @param {number} h      body scale in px; the figure spans about -0.74h to
 *                        +0.55h around cy
 * @param {number} time   seconds since the intro started
 * @param {number} index  which of the three
 * @param {string} tint   base darkness from intro.js — carries the depth cue
 */
export function drawIceAgent(ctx, cx, cy, h, time, index, tint) {
  const a = AGENTS[index % AGENTS.length];
  const p = time * a.rate + a.ph;
  const C = icePal(tint);
  const big = h > 60;           // stencil, boot soles, belt buckle
  const huge = h > 86;          // pouches, radio LED, knee pads

  solve(h, p, a);

  ctx.save();
  ctx.translate(cx, cy);

  // Contact shadow under the planted boot. Two ellipses for the same reason
  // props.js uses two — a single soft pool leaves the figure hovering a few
  // pixels above its own shadow, and these are the only thing putting the crew
  // on the same asphalt the player is running down.
  const gy = Math.max(S.legs[0].a.y, S.legs[1].a.y) + h * 0.070;
  ctx.fillStyle = 'rgba(14,6,20,0.26)';
  ctx.beginPath();
  ctx.ellipse(0, gy, h * 0.26, h * 0.058, 0, 0, TAU);
  ctx.fill();
  const low = S.legs[0].a.y > S.legs[1].a.y ? S.legs[0] : S.legs[1];
  ctx.fillStyle = 'rgba(7,2,12,0.42)';
  ctx.beginPath();
  ctx.ellipse(low.t.x, gy, h * 0.085, h * 0.026, 0, 0, TAU);
  ctx.fill();

  // --- rim, then key, ONCE around the whole figure -------------------------
  // Two warm passes, not one. The wide soft copy is the sun spilling round the
  // whole edge; the tight copy nudged UP is where it actually catches, and it
  // is the one that reads as a direction. A single uniform inflate gives a
  // chalk outline, and warm on every side at full strength looks furry.
  ctx.save();
  ctx.translate(0, -h * 0.006);
  ctx.beginPath();
  silhouette(ctx, h, h * 0.020);
  ctx.fillStyle = RIM_SOFT;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(0, -h * 0.015);
  ctx.beginPath();
  silhouette(ctx, h, h * 0.007);
  ctx.fillStyle = RIM_HARD;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  silhouette(ctx, h, h * 0.004);
  ctx.fillStyle = KEY;
  ctx.fill();

  const nearLeg = S.legs[0].z > S.legs[1].z ? 0 : 1;
  const nearArm = S.arms[0].z > S.arms[1].z ? 0 : 1;

  leg(ctx, S.legs[1 - nearLeg], h, C, big, huge, false);
  arm(ctx, S.arms[1 - nearArm], h, C, false);

  // Seat: the one short bone tying the two hips together, so the middle of the
  // figure is a mass rather than a gap between two tubes.
  shade(ctx, seatUnion, C.duty, C.dutyD, h);

  leg(ctx, S.legs[nearLeg], h, C, big, huge, true);

  // The uniform under the armour. Only the collar, the sleeves and a sliver at
  // the waist ever show of it, but without it the vest is a floating slab.
  shade(ctx, torsoBones, C.duty, C.dutyD, h);

  vest(ctx, h, C, big, huge);
  head(ctx, h, C);
  arm(ctx, S.arms[nearArm], h, C, true);

  ctx.restore();
}

/**
 * The armour, and the reason these do not read as stacked quads.
 *
 * It is ONE path — flat across the top with a hard round-over at each shoulder,
 * straight sides tapering to the waist, a hem that dips at the centre and a
 * notch cut out for the collar — drawn on the LIVE shoulder line so it rolls
 * with the body. Everything laid on afterwards is a plane of the same object,
 * not a rectangle stuck to the front of it.
 */
function vest(ctx, h, C, big, huge) {
  const L = S.shL, R = S.shR;
  const midX = S.midS.x;
  const topL = L.y - h * 0.048;
  const topR = R.y - h * 0.048;
  const hemY = S.midH.y - h * 0.132;
  const hw = h * D.vestHalf;
  const ww = h * D.vestWaist;
  const r = h * 0.034;

  const midT = (topL + topR) * 0.5;
  ctx.beginPath();
  ctx.moveTo(midX - hw + r, topL);
  ctx.quadraticCurveTo(midX - hw, topL, midX - hw, topL + r);
  ctx.lineTo(midX - ww, hemY - h * 0.026);
  ctx.quadraticCurveTo(midX - ww, hemY, midX - ww + h * 0.026, hemY);
  ctx.lineTo(midX - h * 0.045, hemY + h * 0.014);
  ctx.lineTo(midX + h * 0.045, hemY + h * 0.014);
  ctx.lineTo(midX + ww - h * 0.026, hemY);
  ctx.quadraticCurveTo(midX + ww, hemY, midX + ww, hemY - h * 0.026);
  ctx.lineTo(midX + hw, topR + r);
  ctx.quadraticCurveTo(midX + hw, topR, midX + hw - r, topR);
  // Collar notch, cut back into the yoke.
  ctx.lineTo(midX + h * 0.058, midT + h * 0.004);
  ctx.quadraticCurveTo(midX, midT + h * 0.042, midX - h * 0.058, midT + h * 0.004);
  ctx.closePath();
  ctx.fillStyle = C.vest;
  ctx.fill();

  // Everything below is clipped inside the shell, so no trim can escape as an
  // outline round the outside of it.
  ctx.save();
  ctx.clip();

  // The form. Two flat fills rather than a gradient — the banding is invisible
  // at this size and it allocates nothing: the low centre-front turns away from
  // the sky and the hem is nearly black.
  ctx.fillStyle = C.vestD;
  ctx.fillRect(midX - hw, S.midS.y + h * 0.075, hw * 2, h * 0.26);
  ctx.fillStyle = C.gearD;
  ctx.fillRect(midX - hw, hemY - h * 0.028, hw * 2, h * 0.08);

  // Side panels — the sides of the carrier turning out of the light. These are
  // what stop the armour reading as one flat card.
  ctx.fillStyle = C.gearD;
  ctx.fillRect(midX - hw, topL, h * 0.034, h * 0.40);
  ctx.fillRect(midX + hw - h * 0.034, topR, h * 0.034, h * 0.40);

  // The two carrier straps running over the shoulders onto the plate. More than
  // any surface detail, a pair of verticals under a flat yoke is what says
  // "plate carrier" rather than "dark rectangle".
  ctx.fillStyle = C.vestD;
  ctx.fillRect(midX - h * 0.104, topL, h * 0.040, h * 0.13);
  ctx.fillRect(midX + h * 0.064, topR, h * 0.040, h * 0.13);

  // Shoulder yoke: the lit horizontal along the top of the armour, following the
  // roll. Safe from the face trap — it spans the full width well outside the
  // head, so it cannot pair with the eyes into a mouth.
  ctx.beginPath();
  ctx.moveTo(midX - hw, topL);
  ctx.lineTo(midX + hw, topR);
  ctx.lineTo(midX + hw, topR + h * 0.032);
  ctx.lineTo(midX - hw, topL + h * 0.032);
  ctx.closePath();
  ctx.fillStyle = YOKE_LIT;
  ctx.fill();

  // Chest plate + ICE. The plate is drawn at every size — at distance it is the
  // one hard rectangle on the torso and reads as a patch. The letters are gated:
  // under ~60px they fall below 7px tall and turn to mush, and mush on a chest
  // is worse than a clean blank panel.
  const py = S.midS.y + h * 0.150;
  const pw = h * 0.116, ph2 = h * 0.052;
  ctx.fillStyle = C.gearD;
  roundRect(ctx, midX - pw, py - ph2, pw * 2, ph2 * 2, h * 0.010);
  ctx.fill();
  ctx.fillStyle = TRIM_LIP;
  ctx.fillRect(midX - pw, py - ph2, pw * 2, Math.max(0.8, h * 0.007));

  if (big) {
    ctx.font = iceFont(Math.max(7, Math.round(h * 0.084)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = LETTER;
    ctx.fillText('ICE', midX, py + h * 0.004);
  }

  // Close-range trim: two mag pouches on the hem and a lit lip on each. Real
  // vest furniture, and it is the difference between a slab and a garment at the
  // size the nearest agent actually gets to.
  if (huge) {
    const pyy = hemY - h * 0.074;
    ctx.fillStyle = C.gearD;
    roundRect(ctx, midX - h * 0.118, pyy, h * 0.100, h * 0.060, h * 0.009);
    ctx.fill();
    roundRect(ctx, midX + h * 0.018, pyy, h * 0.100, h * 0.060, h * 0.009);
    ctx.fill();
    ctx.fillStyle = TRIM_LIP;
    ctx.fillRect(midX - h * 0.118, pyy, h * 0.100, Math.max(0.8, h * 0.006));
    ctx.fillRect(midX + h * 0.018, pyy, h * 0.100, Math.max(0.8, h * 0.006));
  }
  ctx.restore();

  // Duty belt, on the hip below the vest hem. Drawn OUTSIDE the clip so it can
  // be wider than the armour, which is the point — it is the hard horizontal
  // that gives the waist a bottom after the carrier has tapered in.
  const by = S.midH.y - h * 0.064;
  ctx.fillStyle = C.gearD;
  ctx.fillRect(midX - h * 0.146, by, h * 0.292, h * 0.050);
  ctx.fillStyle = C.gear;
  ctx.fillRect(midX - h * 0.146, by, h * 0.292, Math.max(0.9, h * 0.010));
  if (big) {
    ctx.fillStyle = C.panel;
    ctx.fillRect(midX - h * 0.022, by + h * 0.008, h * 0.044, h * 0.032);
  }

  // Shoulder radio, on the left carrier strap, and the antenna is the point of
  // it: one thin asymmetric spike is worth more to the silhouette than any
  // amount of surface detail, and it is the mark that says "equipped" at any
  // size at all.
  const rx = midX - h * 0.084;
  const ry = topL + h * 0.012;
  ctx.strokeStyle = C.gearD;
  ctx.lineWidth = Math.max(1, h * 0.013);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(rx, ry);
  ctx.lineTo(rx - h * 0.030, ry - h * 0.150);
  ctx.stroke();
  ctx.fillStyle = C.gearD;
  roundRect(ctx, rx - h * 0.024, ry, h * 0.048, h * 0.068, h * 0.009);
  ctx.fill();
  ctx.fillStyle = TRIM_LIP;
  ctx.fillRect(rx - h * 0.024, ry, h * 0.048, Math.max(0.9, h * 0.009));
  if (huge) {
    ctx.fillStyle = 'rgba(255,146,68,0.9)';
    ctx.fillRect(rx - h * 0.006, ry + h * 0.026, h * 0.012, h * 0.011);
  }
}

/**
 * Head, cap and eyes.
 *
 * The bill is drawn as a real curve — wider than the crown, dipping at the
 * centre, which is how a cap bill foreshortens when it is pointed at you. It
 * buys two things: the most recognisable outline in the whole silhouette, and a
 * legitimate reason for the face to be a black void with nothing in it but two
 * hot eyes. Nothing else on the head is bright, and nothing else on it curves.
 */
function head(ctx, h, C) {
  const hd = S.head;
  const rx = D.headRX * h * hd.k;
  const ry = D.headRY * h * hd.k;

  // Neck, short and thick and set back toward the shoulders so the head does not
  // float above the collar.
  ctx.beginPath();
  bone(ctx, S.midS.x, S.midS.y + h * 0.006, h * 0.050, hd.x, hd.y + ry * 0.60, h * 0.042, 0);
  ctx.fillStyle = C.gearD;
  ctx.fill();

  // Head, squared toward the jaw. A pure ellipse reads young; a flatter jaw
  // reads as an adult in a cap, which is the whole job of this shape.
  ctx.fillStyle = C.deep;
  roundRect(ctx, hd.x - rx, hd.y - ry, rx * 2, ry * 2, rx * 0.62);
  ctx.fill();

  const brow = hd.y - ry * 0.40;

  // Cap crown, one clear step lighter than the face so the cap reads as its own
  // volume sitting on a dark head instead of merging into it.
  ctx.beginPath();
  ctx.moveTo(hd.x - rx * 1.08, brow);
  ctx.bezierCurveTo(hd.x - rx * 1.16, hd.y - ry * 1.62,
    hd.x + rx * 1.16, hd.y - ry * 1.62, hd.x + rx * 1.08, brow);
  ctx.closePath();
  ctx.fillStyle = C.duty;
  ctx.fill();

  // The bill, head on: wider than the crown, its near edge dipping toward the
  // camera. The darkest shape in the figure, and the most recognisable line in
  // the silhouette — more than the head itself.
  ctx.beginPath();
  ctx.moveTo(hd.x - rx * 1.46, brow - ry * 0.10);
  ctx.quadraticCurveTo(hd.x, brow + ry * 0.72, hd.x + rx * 1.46, brow - ry * 0.10);
  ctx.quadraticCurveTo(hd.x, brow - ry * 0.44, hd.x - rx * 1.46, brow - ry * 0.10);
  ctx.closePath();
  ctx.fillStyle = C.deep;
  ctx.fill();

  // The shadow the bill throws down the face, so the eyes glow OUT of the dark
  // rather than sitting on top of it.
  ctx.save();
  roundRect(ctx, hd.x - rx, hd.y - ry, rx * 2, ry * 2, rx * 0.62);
  ctx.clip();
  ctx.fillStyle = BILL_SHADE;
  ctx.fillRect(hd.x - rx, brow, rx * 2, ry * 0.95);
  ctx.restore();

  // Hot eyes. The one bright accent in the figure, and the reason the crew reads
  // as looking AT you rather than merely running toward you.
  const ey = hd.y + ry * 0.14;
  const er = Math.max(1.0, rx * 0.185);
  const ex = Math.max(rx * 0.50, er * 1.6);
  ctx.fillStyle = EYE_GLOW;
  ctx.beginPath();
  ctx.arc(hd.x - ex, ey, er * 3.0, 0, TAU);
  ctx.arc(hd.x + ex, ey, er * 3.0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = EYE;
  ctx.beginPath();
  ctx.ellipse(hd.x - ex, ey, er * 1.15, er * 0.70, 0, 0, TAU);
  ctx.ellipse(hd.x + ex, ey, er * 1.15, er * 0.70, 0, 0, TAU);
  ctx.fill();
}

/**
 * The whole arm as ONE sleeve in the uniform tone, and a dark gloved fist.
 *
 * It was built three-tone first — sleeve, bare forearm, glove, the way the
 * player's arm is — and at 60px against a dark carrier the light stub vanished
 * and what was left read as a black lump beside the chest. A long sleeve makes
 * the arm the LIGHTEST thing on the upper body, which is the only way a limb
 * swinging across a dark torso is ever going to be legible at this size. The
 * glove is then the one dark accent on the end of it, and the size of it is what
 * the swing is actually read from.
 */
function arm(ctx, A, h, C, near) {
  _A = A;
  if (near) keyline(ctx, armSil, h);
  shade(ctx, armSleeve, C.duty, C.dutyD, h);

  ctx.beginPath();
  blob(ctx, A.w.x, A.w.y, A.rW * 1.24, 0);
  ctx.fillStyle = C.deep;
  ctx.fill();
}

/** Bloused trouser hip-to-cuff, and a boot with a lit sole. */
function leg(ctx, L, h, C, big, huge, near) {
  _L = L;
  const build = legTrouser;
  if (near) keyline(ctx, build, h);
  shade(ctx, build, C.duty, C.dutyD, h);

  // Knee pad — one hard horizontal on the leg, and the only thing that says
  // there is a knee in there once the trouser has bloused over everything else.
  if (huge) {
    ctx.save();
    ctx.beginPath();
    build(ctx, 0);
    ctx.clip();
    ctx.fillStyle = C.gearD;
    ctx.beginPath();
    ctx.ellipse(L.k.x, L.k.y, L.rK * 1.02, L.rK * 0.66, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // Boot. Wider than the ankle and blunt at the toe — a tapered foot reads as
  // barefoot at anything under about 80px. The trouser blouses over the top of
  // it, which is why the shaft starts BACK at the cuff rather than at the ankle:
  // one hard break part-way down the shin is what stops the whole leg reading as
  // a single tapering tube from hip to toe.
  shade(ctx, legBoot, C.gear, C.gearD, h);

  // The blousing itself: the trouser cuff bunched over the boot top. One band,
  // and it is the only thing on the leg that says there are two garments there.
  if (big) {
    ctx.save();
    ctx.beginPath();
    build(ctx, 0);
    ctx.clip();
    ctx.fillStyle = C.dutyD;
    ctx.beginPath();
    ctx.ellipse(L.cf.x, L.cf.y, L.rC * 1.16, L.rC * 0.52, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // Sole. A pale mark as low on the figure as it gets, so it can never be
  // mistaken for anything on a face, and it is what says these boots are landing
  // on a surface rather than treading air.
  if (big) {
    const dx = L.t.x - L.a.x, dy = L.t.y - L.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    ctx.strokeStyle = SOLE;
    ctx.lineWidth = Math.max(1, L.rA * 0.50);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(L.a.x + nx * L.rA * 1.02, L.a.y + ny * L.rA * 1.02);
    ctx.lineTo(L.t.x + nx * L.rA * 0.86, L.t.y + ny * L.rA * 0.86);
    ctx.stroke();
  }
}
