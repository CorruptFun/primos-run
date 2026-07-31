// The Primo, rebuilt from scratch against the collection's own art style.
//
// WHAT THE REFERENCE ACTUALLY LOOKS LIKE
// Pulled four Primos off IPFS to check rather than guess. The collection is
// anime chibi: a very large head, small pointed chin, big expressive eyes,
// bright saturated hair (black, cyan, lavender), soft two-tone cel shading, and
// caps or graphic tees. It is NOT the brand logo's stark black-and-white — that
// mark is a separate thing. So: big head, simple bright shapes, flat shading,
// no heavy outline.
//
// HOW THE BODY IS BUILT, AND WHY THIS ISN'T THE OLD MISTAKE
// CLAUDE.md warns that "procedural 2D capsules" were tried and read as loose
// parts. That is true of the obvious implementation — one capsule per bone, each
// filled and shaded separately, so every joint shows a seam and every limb reads
// as its own object.
//
// This does something different. All bones of a given MATERIAL (skin, shirt,
// pants) go into ONE path as multiple subpaths — a circle at each joint plus the
// tangent quad spanning each bone — and that path is filled ONCE with nonzero
// winding. The result is a true union: there is no interior edge anywhere,
// because no interior edge is ever drawn. Shading then happens clipped to that
// same union, so the light is continuous across the whole limb group too.
//
// That gets the sphere-chain's "continuous by construction" guarantee at a
// fraction of the cost, and it suits a flat cel style far better than depth
// sorted shaded spheres, which always read as tubes.
//
// Limbs still swing in DEPTH, not across the image plane — see TILT/YAW below.

import { drawBackHead } from './head-back.js';

// Local 3D -> screen. Matches the tuning the old rig arrived at: a high camera
// looking down the alley, where vertical dominates and depth contributes a
// little. Raising TILT cancels the heel kick (the foot's rise is undone by depth
// pushing it back down the screen) and the legs go visually dead.
const TILT = 0.15;
const YAW = 0.34;        // off-axis, so swing also reads laterally
const ZSHRINK = 0.13;    // limbs thin as they swing away

// Chibi proportions. The head is the whole silhouette here — the collection's
// art is dominated by it, and a realistic head on this body stops reading as a
// Primo entirely.
const D = {
  head: 0.46,            // head box, as a fraction of body height
  torso: 0.235,
  hipHalf: 0.058,
  shoulderHalf: 0.104,
  armHalf: 0.118,
  upperArm: 0.140, foreArm: 0.130,
  thigh: 0.185, shin: 0.180,
  // Limb thicknesses. Chunky and tapering only slightly — thin tapered limbs
  // read as spindly against a head this size.
  rShoulder: 0.050, rElbow: 0.040, rWrist: 0.033,
  rHip: 0.066, rKnee: 0.052, rAnkle: 0.036,
};

const TAU = Math.PI * 2;

function proj(x, y, z, H) {
  return { x: x + z * YAW, y: -y - z * TILT, k: 1 - (z / H) * ZSHRINK };
}

// ------------------------------------------------------------------ skeleton

/** Solve joints in local 3D: x lateral, y up, z forward. */
function solve(pose, H, laneLean) {
  const hipY = pose.hipY * H;
  const hipX = pose.hipX * H + laneLean * H * 0.045;
  const lean = pose.lean;

  const shoulderY = hipY + D.torso * H * Math.cos(lean);
  const shoulderZ = D.torso * H * Math.sin(lean);
  const twist = pose.twist || 0;

  const legs = pose.legs.map((L) => {
    const ox = hipX + L.side * D.hipHalf * H;
    const hz = 0;
    // Angles are measured from straight down, swinging forward in +z.
    const t = L.thigh, k = t - L.knee, a = k + L.ankle;
    const kneeY = hipY - Math.cos(t) * D.thigh * H;
    const kneeZ = hz + Math.sin(t) * D.thigh * H;
    const ankY = kneeY - Math.cos(k) * D.shin * H;
    const ankZ = kneeZ + Math.sin(k) * D.shin * H;
    const toeY = ankY - Math.cos(a) * H * 0.055;
    const toeZ = ankZ + Math.sin(a) * H * 0.075;
    return { side: L.side, ox, hipY, hz, kneeY, kneeZ, ankY, ankZ, toeY, toeZ };
  });

  const arms = pose.arms.map((A) => {
    const ox = hipX + A.side * D.armHalf * H + twist * A.side * H * 0.02;
    const s = A.shoulder, e = s - A.elbow;
    const elbY = shoulderY - Math.cos(s) * D.upperArm * H;
    const elbZ = shoulderZ + Math.sin(s) * D.upperArm * H;
    const wrY = elbY - Math.cos(e) * D.foreArm * H;
    const wrZ = elbZ + Math.sin(e) * D.foreArm * H;
    return { side: A.side, ox, shoulderY, shoulderZ, elbY, elbZ, wrY, wrZ };
  });

  return { hipX, hipY, shoulderY, shoulderZ, legs, arms, twist, lean };
}

// -------------------------------------------------------------- union paths

/**
 * Add one bone to the current path as a joint circle plus the tangent quad to
 * the next joint. Called repeatedly between beginPath and a single fill, so
 * every bone unions into one seamless silhouette.
 */
function bone(ctx, ax, ay, ar0, bx, by, br0, grow = 0) {
  const ar = ar0 + grow, br = br0 + grow;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);

  ctx.moveTo(ax + ar, ay);
  ctx.arc(ax, ay, ar, 0, TAU);
  ctx.moveTo(bx + br, by);
  ctx.arc(bx, by, br, 0, TAU);

  // One circle swallowing the other leaves no tangent to draw.
  if (len <= Math.abs(ar - br) + 0.01) return;

  const ang = Math.atan2(dy, dx);
  const off = Math.acos(Math.max(-1, Math.min(1, (ar - br) / len)));
  const a1 = ang + off, a2 = ang - off;
  ctx.moveTo(ax + Math.cos(a1) * ar, ay + Math.sin(a1) * ar);
  ctx.lineTo(bx + Math.cos(a1) * br, by + Math.sin(a1) * br);
  ctx.lineTo(bx + Math.cos(a2) * br, by + Math.sin(a2) * br);
  ctx.lineTo(ax + Math.cos(a2) * ar, ay + Math.sin(a2) * ar);
  ctx.closePath();
}

/**
 * Fill a union path, then cel-shade it: one flat base, one shadow tone through
 * the lower half, and a warm rim along the silhouette because the runner is
 * heading into a low sun and is backlit.
 */
function paint(ctx, build, base, dark, H, rim) {
  // The rim is an INFLATED copy of the union drawn underneath, not a stroke.
  // Stroking is the trap here: the union deliberately contains a circle at every
  // joint plus a quad per bone, and stroke() outlines every one of those
  // subpaths — the figure comes out as a tangle of rings instead of a
  // silhouette. Filling a grown copy behind only ever shows the outer boundary.
  if (rim) {
    ctx.beginPath();
    build(H * 0.013);
    ctx.fillStyle = rim;
    ctx.fill();
  }

  ctx.beginPath();
  build(0);
  ctx.fillStyle = base;
  ctx.fill();

  ctx.save();
  ctx.clip();
  // Cel shadow: a hard-ish band rather than a gradient. Two tones is what makes
  // it read as cel rather than as airbrush.
  const g = ctx.createLinearGradient(0, -H * 0.55, 0, H * 0.1);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.52, 'rgba(0,0,0,0)');
  g.addColorStop(0.56, dark);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(-H, -H * 1.2, H * 2, H * 1.6);
  ctx.restore();
}

// -------------------------------------------------------------------- draw

/**
 * @param {number} sx,sy  ground point under the runner, screen px
 * @param {number} u      world-unit scale in px
 * @param {object} rig    colours + traits
 * @param {object} pose   from poseRunner()
 * @param {number} laneLean
 */
export function drawPrimoBody(ctx, sx, sy, u, rig, pose, laneLean) {
  const H = 1.62 * u;
  const S = solve(pose, H, laneLean);

  const skin = rig.skin || '#b9784e';
  const shirt = rig.shirt || '#3c5f9e';
  const pants = rig.pants || '#2f3a52';
  const shoe = rig.shoe || '#f4f1e8';

  // Shadow tones as translucent black keep every material in the same light,
  // which is what stops a flat style looking like stickers.
  const SH = 'rgba(28,14,42,0.34)';
  const RIM = 'rgba(255,186,120,0.5)';

  ctx.save();
  ctx.translate(sx, sy);

  // Which side is nearer the camera decides draw order. The arm and leg that
  // swing toward the viewer must land on top of the torso.
  const near = S.legs[0].ankZ < S.legs[1].ankZ ? 0 : 1;
  const far = 1 - near;

  const P = (x, y, z) => proj(x, y, z, H);

  // --- backlight rim, ONCE, around the whole figure.
  //
  // Rimming each material separately looks wrong for a reason worth recording:
  // the rim then also traces the boundaries BETWEEN materials — shirt against
  // skin, skin against shoe — and the figure reads as a chalk outline drawing
  // rather than as a lit solid. One union of every bone, filled inflated behind
  // everything, produces the single silhouette edge a backlight actually makes.
  ctx.beginPath();
  const grow = H * 0.014;
  for (const L of S.legs) {
    const h = P(L.ox, L.hipY, L.hz), k = P(L.ox, L.kneeY, L.kneeZ);
    const a = P(L.ox, L.ankY, L.ankZ), t = P(L.ox, L.toeY, L.toeZ);
    bone(ctx, h.x, h.y, D.rHip * H * h.k, k.x, k.y, D.rKnee * H * k.k, grow);
    bone(ctx, k.x, k.y, D.rKnee * H * k.k, a.x, a.y, D.rAnkle * H * a.k, grow);
    bone(ctx, a.x, a.y, D.rAnkle * H * a.k * 1.05, t.x, t.y, D.rAnkle * H * t.k * 0.92, grow);
  }
  for (const A of S.arms) {
    const s = P(A.ox, A.shoulderY, A.shoulderZ);
    const e = P(A.ox, A.elbY, A.elbZ), w = P(A.ox, A.wrY, A.wrZ);
    bone(ctx, s.x, s.y, D.rShoulder * H * s.k, e.x, e.y, D.rElbow * H * e.k, grow);
    bone(ctx, e.x, e.y, D.rElbow * H * e.k * 0.88, w.x, w.y, D.rWrist * H * w.k, grow);
  }
  {
    const hipL = P(S.hipX - D.hipHalf * H, S.hipY, 0);
    const hipR = P(S.hipX + D.hipHalf * H, S.hipY, 0);
    const shL = P(S.hipX - D.shoulderHalf * H, S.shoulderY, S.shoulderZ);
    const shR = P(S.hipX + D.shoulderHalf * H, S.shoulderY, S.shoulderZ);
    const sr = D.shoulderHalf * H * 0.62, hr = D.hipHalf * H * 0.86;
    bone(ctx, shL.x, shL.y, sr, hipL.x, hipL.y, hr, grow);
    bone(ctx, shR.x, shR.y, sr, hipR.x, hipR.y, hr, grow);
    bone(ctx, shL.x, shL.y, sr, shR.x, shR.y, sr, grow);
    bone(ctx, hipL.x, hipL.y, hr, hipR.x, hipR.y, hr, grow);
  }
  ctx.fillStyle = RIM;
  ctx.fill();

  // --- far leg + far arm, behind the torso
  limb(ctx, S.legs[far], P, H, pants, SH, null, shoe, skin);
  arm(ctx, S.arms[far], P, H, shirt, SH, null, skin);

  // --- torso
  torso(ctx, S, P, H, shirt, SH, null);

  // --- head. Sits on the shoulders, facing forward down the alley.
  const nk = P(S.hipX * 0.6, S.shoulderY + H * 0.012, S.shoulderZ);
  ctx.save();
  ctx.translate(nk.x, nk.y);
  ctx.rotate((pose.headTilt || 0) * 0.5);
  drawBackHead(ctx, D.head * H, rig, pose);
  ctx.restore();

  // --- near leg + near arm, over the torso
  limb(ctx, S.legs[near], P, H, pants, SH, null, shoe, skin);
  arm(ctx, S.arms[near], P, H, shirt, SH, null, skin);

  ctx.restore();
}

function torso(ctx, S, P, H, shirt, SH, RIM) {
  const hipL = P(S.hipX - D.hipHalf * H, S.hipY, 0);
  const hipR = P(S.hipX + D.hipHalf * H, S.hipY, 0);
  const shL = P(S.hipX - D.shoulderHalf * H, S.shoulderY, S.shoulderZ);
  const shR = P(S.hipX + D.shoulderHalf * H, S.shoulderY, S.shoulderZ);

  const sr = D.shoulderHalf * H * 0.62;
  const hr = D.hipHalf * H * 0.86;
  // The two CROSS bones are thinner than the verticals. Filling all four at the
  // same radius bulges the union out past the shoulder and hip circles, and the
  // torso comes out lumpy — a barrel with four corners rather than a chest. The
  // cross bones only need to close the gap between the sides, not add mass.
  const csr = sr * 0.72;
  const chr = hr * 0.72;
  paint(ctx, (g) => {
    // Four bones round the torso quad, so shoulders and hips union into one
    // block with a naturally narrowed waist between them.
    bone(ctx, shL.x, shL.y, sr, hipL.x, hipL.y, hr, g);
    bone(ctx, shR.x, shR.y, sr, hipR.x, hipR.y, hr, g);
    bone(ctx, shL.x, shL.y, csr, shR.x, shR.y, csr, g);
    bone(ctx, hipL.x, hipL.y, chr, hipR.x, hipR.y, chr, g);
  }, shirt, SH, H, RIM);
}

function arm(ctx, A, P, H, shirt, SH, RIM, skin) {
  const s = P(A.ox, A.shoulderY, A.shoulderZ);
  const e = P(A.ox, A.elbY, A.elbZ);
  const w = P(A.ox, A.wrY, A.wrZ);

  // Sleeve to the elbow, bare forearm past it — the collection runs to tees and
  // tanks, so the skin break at the elbow is part of the look.
  paint(ctx, (g) => {
    bone(ctx, s.x, s.y, D.rShoulder * H * s.k, e.x, e.y, D.rElbow * H * e.k, g);
  }, shirt, SH, H, RIM);

  paint(ctx, (g) => {
    bone(ctx, e.x, e.y, D.rElbow * H * e.k * 0.88, w.x, w.y, D.rWrist * H * w.k, g);
    // Fist. Chunky on purpose — at 1.18 the hand was a pale dot on the end of a
    // stick, which is what made the arms read as unfinished. A fist roughly as
    // wide as the forearm is both correct for the chibi proportions and the
    // thing that gives the arm swing something to read against.
    const fr = D.rWrist * H * w.k * 1.55 + g;
    ctx.moveTo(w.x + fr, w.y);
    ctx.arc(w.x, w.y, fr, 0, TAU);
  }, skin, SH, H, RIM);
}

function limb(ctx, L, P, H, pants, SH, RIM, shoe, skin) {
  const h = P(L.ox, L.hipY, L.hz);
  const k = P(L.ox, L.kneeY, L.kneeZ);
  const a = P(L.ox, L.ankY, L.ankZ);
  const t = P(L.ox, L.toeY, L.toeZ);

  paint(ctx, (g) => {
    bone(ctx, h.x, h.y, D.rHip * H * h.k, k.x, k.y, D.rKnee * H * k.k, g);
    bone(ctx, k.x, k.y, D.rKnee * H * k.k, a.x, a.y, D.rAnkle * H * a.k, g);
  }, pants, SH, H, RIM);

  // Shoe: chunky, and the one bright value down there. Reads as the contact
  // point, which is what sells the stride.
  paint(ctx, (g) => {
    bone(ctx, a.x, a.y, D.rAnkle * H * a.k * 1.05, t.x, t.y, D.rAnkle * H * t.k * 0.92, g);
  }, shoe, 'rgba(28,14,42,0.26)', H, RIM);
}
