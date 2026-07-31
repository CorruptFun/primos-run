// The Primo, seen from behind, at ~200px tall on a phone.
//
// WHAT THE REFERENCE ACTUALLY LOOKS LIKE
// Pulled real Primos off IPFS to check rather than guess. The collection is
// anime chibi: a very large head, small pointed chin, big expressive eyes,
// bright saturated hair, soft two-tone cel shading, caps and graphic tees. It is
// NOT the brand logo's stark black-and-white — that mark is a separate thing.
//
// HOW THE BODY IS BUILT, AND WHY THIS ISN'T THE OLD MISTAKE
// CLAUDE.md warns that "procedural 2D capsules" were tried and read as loose
// parts. That is true of the obvious implementation — one capsule per bone, each
// filled and shaded separately, so every joint shows a seam and every limb reads
// as its own object.
//
// This does something different. All bones of a given MATERIAL go into ONE path
// as multiple subpaths — a circle at each joint plus the tangent quad spanning
// each bone — and that path is filled ONCE with nonzero winding. The result is a
// true union: there is no interior edge anywhere, because no interior edge is
// ever drawn. Two traps live here, both already paid for:
//
//   1. NEVER stroke() a union path. It contains a subpath per joint, so a stroke
//      outlines every one of them and the figure renders as a tangle of rings.
//      For an edge, fill an INFLATED copy behind it — bone() takes a `grow`.
//   2. Rim the whole body ONCE, not per material. A per-material rim traces the
//      boundaries BETWEEN materials too, and the figure reads as a chalk outline
//      drawing rather than as a lit solid.
//
// THE VALUE PLAN — the thing this file is really about
// At 200px a runner can carry about THREE values, and this figure used to carry
// six: white tee, red skin, black shorts, red skin, white sock, white shoe. It
// read as a barber pole. Now:
//
//   LIGHT   the tee, including both sleeves, drawn as ONE union with the torso
//           so the whole upper body is a single bright shape; socks a step down
//           from it so they group with it without matching it.
//   MID     skin — forearms, fists, and one short band around the knee. Sampled
//           from the player's own Primo but compressed (see bodySkin) because a
//           genuinely red Primo at full saturation reads as an injury.
//   DARK    shorts, Cortez uppers, hair. The shorts and the pelvis are one union
//           so the middle of the figure is a single dark block.
//
// Limbs still swing in DEPTH, not across the image plane — see TILT/YAW.

import { drawBackHead } from './head-back.js';
import { drawMaskBack, drawChainBack } from './gear.js';

// Local 3D -> screen. Matches the tuning the old rig arrived at: a high camera
// looking down the alley, where vertical dominates and depth contributes a
// little. Raising TILT cancels the heel kick (the foot's rise is undone by depth
// pushing it back down the screen) and the legs go visually dead.
const TILT = 0.15;
const YAW = 0.34;        // off-axis, so swing also reads laterally
const ZSHRINK = 0.13;    // limbs thin as they swing away

const TAU = Math.PI * 2;

// Chibi proportions. The head is the whole silhouette here — the collection's
// art is dominated by it, and a realistic head on this body stops reading as a
// Primo entirely. Head width lands a shade WIDER than the shoulders, which is
// the single measurement that separates chibi from "small adult".
const D = {
  head: 0.55,            // head box, as a fraction of body height
  torso: 0.215,
  hipHalf: 0.074,
  shoulderHalf: 0.098,
  // Arms hang well outside the torso on purpose. When armHalf + shoulder radius
  // only matched the torso's own half-width the sleeve never broke the
  // silhouette, and the whole upper body fused into one featureless pill.
  armHalf: 0.150,
  upperArm: 0.134, foreArm: 0.126,
  thigh: 0.182, shin: 0.176,
  // Limb thicknesses. Chunky and tapering only slightly — thin tapered limbs
  // read as spindly against a head this size.
  rShoulder: 0.058, rElbow: 0.046, rWrist: 0.038,
  rHip: 0.083, rKnee: 0.056, rAnkle: 0.040,
};

// The uniform: white tee with the sleeve to the elbow, black shorts, knee-high
// white socks, blue Nike Cortez.
//
// The Cortez is BLUE-uppered rather than the classic white leather for a
// reason that is about value, not fashion: a white shoe under a white sock put
// two light blocks at the bottom of the leg with a skin gap between them, and
// the leg read as striped. A dark shoe ends the leg the way a dark shorts block
// starts it, and the sock becomes the one light shape between them.
const FIT = {
  tee: '#efece1',
  sock: '#dedbcd',          // a step below the tee: groups with it, doesn't match
  shorts: '#24232e',
  shoe: '#2e4ea6',          // Cortez upper
  sole: '#e8e5da',
  swoosh: '#f2efe4',
  // Fractions along each bone where one material hands over to the next. The
  // shorts run LOW and the sock top sits just under the knee, so the bare skin
  // between them is a short band that reads as a knee rather than as a stripe.
  shortsEnd: 0.66,
  sockTop: 0.07,
  // A tee sleeve stops just short of the elbow. Running it all the way to the
  // joint left the bare arm as a stub, and the swing — which is most of what
  // reads as running from behind — had nothing to show it with.
  sleeveEnd: 0.74,
};

// Screen-space light direction. The sky is up and behind-left of the runner, so
// every material's lit copy is nudged that way and the darker base beneath shows
// through as a core shadow down its lower-right. Shading that follows each form
// is what makes it read as cel; the old vertical gradient banded straight across
// the whole figure regardless of what was under it.
const LX = 0.019, LY = 0.024;

// Backlight, and the plum the alley's shadows sit in.
const RIM = 'rgba(255,178,98,0.60)';
const KEY = 'rgba(30,17,42,0.60)';
const AMB = [96, 78, 126];

function proj(x, y, z, H) {
  return { x: x + z * YAW, y: -y - z * TILT, k: 1 - (z / H) * ZSHRINK };
}

// ------------------------------------------------------------------- colour

const CACHE = new Map();

function parseCol(c) {
  if (!c) return [185, 120, 78];
  if (c[0] === '#') {
    const n = parseInt(c.slice(1), 16);
    return c.length === 4
      ? [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
      : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/(\d+(?:\.\d+)?)/g);
  return m ? [+m[0], +m[1], +m[2]] : [185, 120, 78];
}

const str = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (c, k) => [
  Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hsl2rgb(h, s, l) {
  if (s <= 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/**
 * Skin, sampled from the player's own Primo and kept as close to it as the
 * rendering allows.
 *
 * The rule: HUE IS THE IDENTITY, LIGHTNESS IS THE CONSTRAINT.
 *
 * An earlier version dragged every hue 62% toward a warm "skin band", which is
 * precisely what made every Primo run in the same orange — a red Primo, a green
 * one and a lavender one all arrived at roughly the same forearm. Hue is now
 * kept exactly. If the collection says this Primo is red, the runner is red.
 *
 * What still has to be bounded is lightness, and only lightness, for a reason
 * that is about drawing rather than taste: the body is cel-shaded with one
 * shadow tone derived from the base, so a near-black sample has no room below it
 * for a shadow and a near-white one has nothing to separate it from the tee.
 * Either end collapses the figure into a silhouette. Squeezing into 0.36-0.78
 * guarantees a readable shadow at both extremes while barely moving anything
 * already in a normal range.
 *
 * Saturation is only ceilinged, never pulled up — enough to stop a neon sample
 * vibrating against the alley, and high enough that a genuinely saturated Primo
 * still reads as saturated.
 */
function bodySkin(col) {
  const key = 'k' + col;
  const hit = CACHE.get(key);
  if (hit) return hit;

  const [h0, s0, l0] = rgb2hsl(parseCol(col));
  const h = h0;                                    // identity, untouched
  const s = Math.min(s0, 0.62);                    // ceiling only
  const l = 0.36 + Math.max(0, Math.min(1, l0)) * 0.42;

  const base = hsl2rgb(h, s, l);
  const out = { base: str(base), dark: str(celDark(base)) };
  CACHE.set(key, out);
  return out;
}

/** The one cel shadow tone for a material: darker, and a touch toward the alley. */
function celDark(c) {
  return scale(mix(c, AMB, 0.16), 0.70);
}

function tone(col) {
  const key = 't' + col;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const c = parseCol(col);
  const out = { base: str(c), dark: str(celDark(c)) };
  CACHE.set(key, out);
  return out;
}

// -------------------------------------------------------------- skeleton

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
    const toeY = ankY - Math.cos(a) * H * 0.050;
    const toeZ = ankZ + Math.sin(a) * H * 0.082;
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

// ------------------------------------------------------------ union paths

/**
 * Add one bone to the current path as a joint circle plus the tangent quad to
 * the next joint. Called repeatedly between beginPath and a single fill, so
 * every bone unions into one seamless silhouette.
 *
 * `p` is anything with the Path2D drawing methods — the live context, or a
 * Path2D when the same shape is needed more than once.
 */
function bone(p, ax, ay, ar0, bx, by, br0, grow = 0) {
  const ar = Math.max(0.2, ar0 + grow), br = Math.max(0.2, br0 + grow);
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);

  p.moveTo(ax + ar, ay);
  p.arc(ax, ay, ar, 0, TAU);
  p.moveTo(bx + br, by);
  p.arc(bx, by, br, 0, TAU);

  // One circle swallowing the other leaves no tangent to draw.
  if (len <= Math.abs(ar - br) + 0.01) return;

  const ang = Math.atan2(dy, dx);
  const off = Math.acos(Math.max(-1, Math.min(1, (ar - br) / len)));
  const a1 = ang + off, a2 = ang - off;
  // WINDING MATTERS, and getting it wrong is invisible in the code and obvious
  // on screen. arc(0, TAU) with the default anticlockwise=false runs clockwise
  // once y points down; the tangent quad has to run clockwise too. Wound the
  // other way it CANCELS against the joint circles under nonzero fill, and every
  // joint gets a half-disc hole punched through it — which is what made the
  // figure read as a heap of separate parts no matter what colours it wore.
  p.moveTo(ax + Math.cos(a2) * ar, ay + Math.sin(a2) * ar);
  p.lineTo(bx + Math.cos(a2) * br, by + Math.sin(a2) * br);
  p.lineTo(bx + Math.cos(a1) * br, by + Math.sin(a1) * br);
  p.lineTo(ax + Math.cos(a1) * ar, ay + Math.sin(a1) * ar);
  p.closePath();
}

function blob(p, x, y, r, grow = 0) {
  const rr = Math.max(0.2, r + grow);
  p.moveTo(x + rr, y);
  p.arc(x, y, rr, 0, TAU);
}

/**
 * Fill a material's union, cel-shaded in two tones.
 *
 * The union is filled once in the SHADOW tone, then clipped to itself and filled
 * again in the base tone, offset toward the light. The base copy is not inset —
 * only offset — so the lit edge runs right to the silhouette and the shadow only
 * ever appears as a crescent on the far side. Insetting it instead leaves a dark
 * line all the way round every material, which is the chalk-outline failure the
 * header warns about, arrived at from the other direction.
 */
function paint(ctx, build, t, H) {
  ctx.beginPath();
  build(ctx, 0);
  ctx.fillStyle = t.dark;
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.translate(-H * LX, -H * LY);
  ctx.beginPath();
  build(ctx, 0);
  ctx.fillStyle = t.base;
  ctx.fill();
  ctx.restore();
}

/** Point a fraction of the way along a bone, radius interpolated to match. */
function along(a, b, ra, rb, f) {
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, r: ra + (rb - ra) * f };
}

// --------------------------------------------------------------------- draw

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

  const skin = bodySkin(rig.skin);
  const tee = tone(FIT.tee);
  const shorts = tone(FIT.shorts);
  const sock = tone(FIT.sock);
  const shoe = tone(FIT.shoe);

  ctx.save();
  ctx.translate(sx, sy);

  const P = (x, y, z) => proj(x, y, z, H);

  // Joint positions, projected once and shared by every pass below.
  const legs = S.legs.map((L) => {
    const h = P(L.ox, L.hipY, L.hz);
    const k = P(L.ox, L.kneeY, L.kneeZ);
    const a = P(L.ox, L.ankY, L.ankZ);
    const t = P(L.ox, L.toeY, L.toeZ);
    return {
      h, k, a, t, z: L.ankZ,
      rH: D.rHip * H * h.k, rK: D.rKnee * H * k.k, rA: D.rAnkle * H * a.k,
    };
  });
  const arms = S.arms.map((A) => {
    const s = P(A.ox, A.shoulderY, A.shoulderZ);
    const e = P(A.ox, A.elbY, A.elbZ);
    const w = P(A.ox, A.wrY, A.wrZ);
    return {
      s, e, w, z: A.wrZ,
      rS: D.rShoulder * H * s.k, rE: D.rElbow * H * e.k, rW: D.rWrist * H * w.k,
    };
  });
  const T = {
    hipL: P(S.hipX - D.hipHalf * H, S.hipY, 0),
    hipR: P(S.hipX + D.hipHalf * H, S.hipY, 0),
    shL: P(S.hipX - D.shoulderHalf * H, S.shoulderY, S.shoulderZ),
    shR: P(S.hipX + D.shoulderHalf * H, S.shoulderY, S.shoulderZ),
    // Shoulder span comes out a shade NARROWER than the head is wide. That one
    // measurement is most of what separates chibi from "small adult".
    sr: D.shoulderHalf * H * 0.72,
    hr: D.hipHalf * H * 0.98,
  };
  T.midS = { x: (T.shL.x + T.shR.x) / 2, y: (T.shL.y + T.shR.y) / 2 };
  T.midH = { x: (T.hipL.x + T.hipR.x) / 2, y: (T.hipL.y + T.hipR.y) / 2 };

  // Which side is nearer the camera decides draw order: the arm and leg that
  // swing toward the viewer land on top of the torso.
  const near = legs[0].z < legs[1].z ? 0 : 1;
  const far = 1 - near;
  const nearArm = arms[0].z < arms[1].z ? 0 : 1;

  // --- edge, ONCE, around the whole figure ------------------------------
  //
  // Two inflated copies of the same union, no strokes anywhere. The warm one is
  // grown further and nudged UP, so once the dark one and then the body itself
  // land on top of it, the only warm left showing is a thin catch along the top
  // contours — a directional backlight for the price of one extra fill. The dark
  // copy is what actually holds the figure together against a busy alley; a
  // bright halo on every side just made it look furry.
  const sil = (target, g) => silhouette(target, legs, arms, T, g);
  ctx.save();
  ctx.translate(0, -H * 0.010);
  ctx.beginPath();
  sil(ctx, H * 0.016);
  ctx.fillStyle = RIM;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  sil(ctx, H * 0.007);
  ctx.fillStyle = KEY;
  ctx.fill();

  // --- far leg, behind everything
  legParts(ctx, legs[far], H, skin, sock, shoe);
  // --- far arm's bare forearm, behind the tee
  forearm(ctx, arms[1 - nearArm], H, skin);

  // --- shorts: both legs and the pelvis as ONE dark block, so the middle of
  //     the figure is a single shape rather than two separate tubes.
  paint(ctx, (p, g) => {
    for (const L of legs) {
      const hem = along(L.h, L.k, L.rH, L.rK, FIT.shortsEnd);
      bone(p, L.h.x, L.h.y, L.rH, hem.x, hem.y, hem.r * 1.06, g);
    }
    bone(p, legs[0].h.x, legs[0].h.y, legs[0].rH * 0.96,
      legs[1].h.x, legs[1].h.y, legs[1].rH * 0.96, g);
  }, shorts, H);

  // --- tee: torso AND both sleeves in one union, so the upper body is a single
  //     bright shape instead of a pill with two pale sausages beside it.
  const sleeves = (p, g) => {
    for (const A of arms) {
      const end = along(A.s, A.e, A.rS, A.rE, FIT.sleeveEnd);
      bone(p, A.s.x, A.s.y, A.rS, end.x, end.y, end.r * 1.08, g);
    }
  };
  paint(ctx, (p, g) => { torsoBones(p, T, g); sleeves(p, g); }, tee, H);

  // The sleeve is the same white as the tee, which is the point — the upper body
  // has to be ONE shape. But without something separating them the arm vanishes
  // into the chest, so the sleeve drops a soft shadow onto the torso: contact,
  // not an outline. Clipped to the tee, so it can never escape the silhouette.
  ctx.save();
  ctx.beginPath();
  torsoBones(ctx, T, 0);
  ctx.clip();
  ctx.beginPath();
  sleeves(ctx, H * 0.006);
  ctx.fillStyle = 'rgba(52,38,72,0.26)';
  ctx.fill();
  ctx.restore();

  // Collar. Two marks, both clipped inside the tee so neither can escape as an
  // outline: the shadow the head drops into the neck hole, and the ribbed band
  // under it. A plain white block with nothing at the neck reads as a bib — the
  // collar is the one detail that makes it a garment someone is wearing.
  const cx = T.midS.x, cy = T.midS.y;
  ctx.save();
  ctx.beginPath();
  torsoBones(ctx, T, 0);
  ctx.clip();
  ctx.fillStyle = 'rgba(58,44,78,0.34)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - T.sr * 0.34, T.sr * 0.92, T.sr * 0.50, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,244,226,0.30)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - T.sr * 0.10, T.sr * 0.92, T.sr * 0.34, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // --- head. Sits on the shoulders, facing forward down the alley.
  ctx.save();
  ctx.translate(cx, cy - T.sr * 0.26);
  ctx.rotate((pose.headTilt || 0) * 0.5);
  const fit = rig && rig.fit;
  const hs = D.head * H;
  if (fit && fit.mask) {
    // A pasamontañas covers hair and hat OUTRIGHT — a knit dome over a fitted
    // cap is two hats, and long hair spilling out the back un-sells the mask.
    // So the head draws with its silhouettes neutralised (shortest cut, no
    // hat) and the dome goes over the skull; hair colour becomes the mask's
    // base so any sliver surviving at the hem reads as knit, not a peek of
    // mullet. Identity survives in the outfit colours, which stay the PFP's —
    // that trade is the player's, documented in docs/GAME_DESIGN.md.
    drawBackHead(ctx, hs,
      { ...rig, hairStyle: 'short', beanie: null, hatKind: 'none', cap: null, hair: fit.mask.base },
      pose, skin.base);
    // Skull centre/radius per head-back.js: (0, -0.42·size), r ≈ 0.35·size.
    drawMaskBack(ctx, 0, -hs * 0.42, hs * 0.345, fit.mask);
  } else {
    drawBackHead(ctx, hs, rig, pose, skin.base);
  }
  // The chain drapes at the nape, over the collar, under nothing — it is the
  // one piece of gear that must read at 40px or it is not worth 250 chelas.
  if (fit && fit.chain) drawChainBack(ctx, 0, -hs * 0.02, hs * 0.34, fit.chain);
  ctx.restore();

  // --- near arm and near leg, over everything
  forearm(ctx, arms[nearArm], H, skin);
  legParts(ctx, legs[near], H, skin, sock, shoe);

  ctx.restore();
}

/**
 * The torso as four bones round a quad plus one down the middle.
 *
 * The middle one is not decoration. Without it the left and right verticals
 * taper apart between the shoulder and hip circles and leave a slit down the
 * centre of the chest, which shows whatever is behind the figure as a dark bar
 * on the shirt. The cross bones are thinner than the verticals: at equal radius
 * the union bulges past the shoulder and hip circles and the torso comes out
 * lumpy — a barrel with four corners rather than a chest.
 */
function torsoBones(p, T, g) {
  bone(p, T.shL.x, T.shL.y, T.sr, T.hipL.x, T.hipL.y, T.hr, g);
  bone(p, T.shR.x, T.shR.y, T.sr, T.hipR.x, T.hipR.y, T.hr, g);
  bone(p, T.midS.x, T.midS.y, T.sr * 1.02, T.midH.x, T.midH.y, T.hr * 1.02, g);
  bone(p, T.shL.x, T.shL.y, T.sr * 0.92, T.shR.x, T.shR.y, T.sr * 0.92, g);
  bone(p, T.hipL.x, T.hipL.y, T.hr * 0.92, T.hipR.x, T.hipR.y, T.hr * 0.92, g);
}

/** Every bone of the figure, for the one-and-only silhouette pass. */
function silhouette(p, legs, arms, T, g) {
  for (const L of legs) {
    bone(p, L.h.x, L.h.y, L.rH, L.k.x, L.k.y, L.rK, g);
    bone(p, L.k.x, L.k.y, L.rK, L.a.x, L.a.y, L.rA, g);
    bone(p, L.a.x, L.a.y, L.rA * 1.12, L.t.x, L.t.y, L.rA * 0.90, g);
  }
  for (const A of arms) {
    bone(p, A.s.x, A.s.y, A.rS, A.e.x, A.e.y, A.rE, g);
    bone(p, A.e.x, A.e.y, A.rE * 0.90, A.w.x, A.w.y, A.rW, g);
    blob(p, A.w.x, A.w.y, A.rW * 1.5, g);
  }
  torsoBones(p, T, g);
}

/** Bare arm and fist — the mid value, and the part that sells the arm swing. */
function forearm(ctx, A, H, skin) {
  const cuff = along(A.s, A.e, A.rS, A.rE, FIT.sleeveEnd);
  paint(ctx, (p, g) => {
    // Sleeve cuff through the elbow to the wrist, one union so the elbow has no
    // seam across it.
    bone(p, cuff.x, cuff.y, cuff.r * 0.94, A.e.x, A.e.y, A.rE, g);
    bone(p, A.e.x, A.e.y, A.rE * 0.94, A.w.x, A.w.y, A.rW, g);
    // Fist. Chunky on purpose: a pale dot on the end of a stick is what made
    // the arms read as unfinished, and a fist about as wide as the forearm is
    // both correct for chibi proportions and something for the swing to read
    // against.
    blob(p, A.w.x, A.w.y, A.rW * 1.5, g);
  }, skin, H);
}

/**
 * Everything on the leg below the shorts: the knee's skin band, the knee-high
 * sock, and the Cortez. The shorts themselves are drawn with the other leg's, as
 * one pelvis-wide block.
 */
function legParts(ctx, L, H, skin, sock, shoe) {
  const hem = along(L.h, L.k, L.rH, L.rK, FIT.shortsEnd);
  const cuff = along(L.k, L.a, L.rK, L.rA, FIT.sockTop);

  // Bare leg — hem through the knee to the sock cuff, one union so the knee has
  // no seam across it.
  paint(ctx, (p, g) => {
    bone(p, hem.x, hem.y, hem.r * 0.94, L.k.x, L.k.y, L.rK, g);
    bone(p, L.k.x, L.k.y, L.rK, cuff.x, cuff.y, cuff.r, g);
  }, skin, H);

  // Knee-high sock.
  paint(ctx, (p, g) => {
    bone(p, cuff.x, cuff.y, cuff.r * 1.07, L.a.x, L.a.y, L.rA * 1.06, g);
  }, sock, H);

  // Two stripes round the cuff, in the shoe's blue. They tie the bottom of the
  // figure together and stop the sock reading as a bare white shin — and being
  // blue rather than grey, they cost no extra value.
  if (H > 130) {
    ctx.strokeStyle = 'rgba(46,78,166,0.55)';
    ctx.lineWidth = Math.max(0.7, H * 0.009);
    for (const f of [0.10, 0.20]) {
      const q = along(cuff, L.a, cuff.r * 1.07, L.rA * 1.06, f);
      ctx.beginPath();
      ctx.moveTo(q.x - q.r * 0.82, q.y);
      ctx.lineTo(q.x + q.r * 0.82, q.y);
      ctx.stroke();
    }
  }

  // Cortez.
  paint(ctx, (p, g) => {
    bone(p, L.a.x, L.a.y, L.rA * 1.12, L.t.x, L.t.y, L.rA * 0.90, g);
  }, shoe, H);
  cortez(ctx, L.a, L.t, L.rA);
}

/**
 * The Cortez read at ~16px: a pale sole wedge under the whole foot and one
 * swoosh across the flank. Anything more is invisible at this size and only
 * costs paint.
 */
function cortez(ctx, a, t, rA) {
  const dx = t.x - a.x, dy = t.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;           // along the foot
  const nx = -uy, ny = ux;                      // across it

  ctx.lineCap = 'round';
  ctx.strokeStyle = FIT.sole;
  ctx.lineWidth = Math.max(1, rA * 0.62);
  ctx.beginPath();
  ctx.moveTo(a.x + nx * rA * 0.78, a.y + ny * rA * 0.78);
  ctx.lineTo(t.x + nx * rA * 0.60, t.y + ny * rA * 0.60);
  ctx.stroke();

  ctx.strokeStyle = FIT.swoosh;
  ctx.lineWidth = Math.max(0.7, rA * 0.26);
  ctx.beginPath();
  ctx.moveTo(a.x + ux * len * 0.06 - nx * rA * 0.30, a.y + uy * len * 0.06 - ny * rA * 0.30);
  ctx.quadraticCurveTo(
    a.x + ux * len * 0.50 + nx * rA * 0.16, a.y + uy * len * 0.50 + ny * rA * 0.16,
    a.x + ux * len * 0.88 - nx * rA * 0.12, a.y + uy * len * 0.88 - ny * rA * 0.12);
  ctx.stroke();
}
