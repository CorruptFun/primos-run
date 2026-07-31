// The back of a Primo's head.
//
// You are chasing this character down an alley, so what you should see is the
// back of their skull — hair, a cap, a bandana knot, the nape of the neck. The
// old rig pasted the front-facing PFP crop onto the head instead, which put a
// face on the back of someone's head: uncanny, and it flattened the whole figure
// because a photographic crop cannot take the scene's light.
//
// THE PROBLEM THIS FILE HAD, AND THE FIX
// The head rendered as a dark featureless blob. Two causes, both structural:
// dark hair sat against a dark cap with nothing between them, and the only
// lighting was one radial gradient that muddied everything it touched. So:
//
//   * Every hair colour is VALUE-NORMALISED first (normHair). Whatever a Primo's
//     sampled crown gives back — pitch black, cyan, lavender — it comes out in a
//     lightness band where a shadow and a highlight can both still be seen. A
//     colour is kept; a value is not negotiable.
//   * The hair carries an anime SHEEN BAND, the broken highlight arc real
//     collection art has. It is the single cheapest thing that says "anime hair"
//     rather than "dark shape", and it guarantees a light value on the head.
//   * A cap, when the Primo has one, is lit from above with its own two tones
//     and drops a hard shadow onto the hair beneath it. That hard edge is the
//     value separation the head was missing.
//
// THE PROBLEM IT HAD AFTER THAT, AND THIS FIX
// Once the traits were real (js/art/primo-traits.js) the head had eleven hats
// and six cuts to draw instead of one, and a batch of them did not read as
// anything. dev/head-test.html is where that became obvious — every trait side
// by side at the size a player sees, which is a thing rig-test.html cannot show
// because it renders one Primo at a time. What it caught:
//
//   * ONE MASS, ONE PATH. Hair was a skull shape with separate blobs painted on
//     top in `hair.base`. Under the cel light pass the crown goes lighter and
//     those blobs stay flat, so three dark ovals sat high on an egg — the exact
//     face-on-the-back-of-the-head this file exists to avoid. Every cut is now a
//     SINGLE path (skull plus whatever that cut adds to the outline, unioned by
//     nonzero winding) filled once. A tuft can only break the silhouette now; it
//     can never become a feature inside it. Same rule the body already follows.
//   * SILHOUETTE, NOT SURFACE. Detail drawn inside a 75px-wide shape is noise:
//     the cap's script mark read as a scribble, the beanie's knit ribbing turned
//     a do-rag into a barrel, and the mullet's cut lines made it a wooden keg.
//     All three are gone. What separates the hats now is their outline — a notch,
//     a crease, a hem, a brim — because that is the only thing that survives.
//   * SYMMETRY READS AS A FACE. Three evenly spaced anything, centred, becomes
//     two eyes and a nose. The sheen is two wedges, off-centre, unequal.
//
// Everything is drawn from the same trait fields the collection art uses (hair,
// cap, hairStyle, bandana, beanie, shades, hoops, earringKind), so a Primo still
// reads as *their* Primo from behind. For a custom PFP those fields are sampled
// off the image by primo-head.js.
//
// The front-facing portrait is still correct for the menu tiles and the HUD
// badge — those look at you. This is only for the runner.

const TAU = Math.PI * 2;

// Same light and same edge treatment as the body, or the head reads as a
// different drawing sitting on top of it.
const LX = 0.030, LY = 0.038;      // fractions of head size
const RIM = 'rgba(255,178,98,0.60)';
const KEY = 'rgba(30,17,42,0.60)';
const AMB = [96, 78, 126];
const SKY = [255, 198, 150];

const CACHE = new Map();

/**
 * @param {CanvasRenderingContext2D} ctx  translated to the neck, already rotated
 * @param {number} size   head box size in px (D.head * H)
 * @param {object} rig    { hair, cap, hairStyle, bandana, beanie, hoops, shades }
 * @param {object} pose   { phase, airborne, laneLean }
 * @param {string} skinCol already value-compressed by primo-runner's bodySkin
 */
export function drawBackHead(ctx, size, rig, pose, skinCol) {
  const style = rig.hairStyle || 'messy';
  const hair = normHair(rig.hair || '#221a1e');
  const skin = tone(skinCol || rig.skin || '#b9784e');
  // A do-rag is the one piece of headwear that comes down over the ears, and
  // `beanie` is the field that has always carried it.
  const hat = rig.beanie ? normHat(rig.beanie, hair) : null;

  // What is actually on this Primo's head.
  //
  // `hatKind` comes from the collection's own metadata by way of
  // js/art/primo-traits.js, and it is the reason this is no longer a guess.
  // Before it existed there was nothing to read a hat off — colours can be
  // sampled from a PFP, a mariachi brim cannot — so the rule was "anyone whose
  // hair is not long gets a cap", which put a baseball cap on every charro in
  // the collection. When the traits are unknown (a player's own uploaded image,
  // or a token that failed to harvest) that old rule is still the best
  // available guess and is kept as the fallback.
  const kind = rig.hatKind
    || (style !== 'long' && style !== 'pony' ? 'cap' : 'none');
  const worn = hat ? 'durag' : kind;
  // A cap and a do-rag are skull-shaped, so a dark one on dark hair fuses into
  // one blob and normHat's collision rule has to pull them apart by value. The
  // other four are not: a brim, a helmet, a visor and a pair of horns each own a
  // silhouette the hair does not have, so they separate by SHAPE and are passed
  // no hair to collide with.
  //
  // That distinction is not cosmetic. #2664's Mariachi Hat is #171219 over
  // Mullet Brown hair, and the collision rule lifted it to a mid lavender — the
  // largest shape in the figure taking a colour the hat does not have, to solve
  // a legibility problem the brim had already solved.
  const shaped = worn === 'brim' || worn === 'helmet'
    || worn === 'visor' || worn === 'horns';
  const capCol = worn === 'none' || hat
    ? null
    : normHat(rig.cap || rig.hair || '#1b1b24', shaped ? null : hair);

  // Skull centre in the head box. Sits high — the neck occupies the bottom.
  const cx = 0;
  const cy = -size * 0.42;
  const rx = size * 0.340;
  const ry = size * 0.355;

  // Hair swings a beat behind the stride. Small: at running speed the head is
  // the most stable part of the body, and overdoing this reads as a wobble.
  const swing = Math.sin((pose.phase || 0) * TAU) * 0.05 + (pose.laneLean || 0) * 0.10;

  // Anything that covers the crown means the CUT's crown is not drawn: the hair
  // falls back to the plain skull and the hat provides the top of the
  // silhouette. Spikes standing above a baseball cap and a bushy fringe under a
  // hard hat are the same mistake — hair cannot be outside a hat it is inside.
  // What hangs BELOW the hatline (a mullet, long hair) still shows, because that
  // is where those cuts live.
  //
  // A visor and a pair of horns leave the crown open, which is the whole point
  // of both, so they are not on this list.
  const capped = worn === 'cap' || worn === 'brim'
    || worn === 'helmet' || worn === 'durag';
  // The helmet and the do-rag are the two that come down far enough to cover the
  // nape as well.
  const sealed = worn === 'helmet' || worn === 'durag';

  // ------------------------------------------------------- edge, then neck
  // Warm copy nudged up, dark copy on top of it: after the head itself lands,
  // the only warm left is a catch along the crown. Same two-fill trick the body
  // uses, so the two share one silhouette treatment.
  ctx.fillStyle = RIM;
  ctx.beginPath();
  ctx.ellipse(cx, cy - size * 0.022, rx * 1.05, ry * 1.05, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = KEY;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 1.035, ry * 1.035, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = skin.dark;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.86, rx * 0.40, ry * 0.40, 0, 0, TAU);
  ctx.fill();

  // ---------------------------------------------------------------- ears
  // Seen from behind, ears read as two small notches at the silhouette edge.
  // They sit LOW: any higher and the cap covers them, or worse, they line up
  // with the brim and the head reads as having four ears.
  //
  // Drawn UNDER the hair, so all that clears the outline is the outer rim of
  // each — which is what an ear does under hair. Cuts with real volume at the
  // sides bury them completely and that is correct.
  const earY = cy + ry * 0.44;
  for (const s of [-1, 1]) {
    ctx.fillStyle = s < 0 ? skin.base : skin.dark;
    ctx.beginPath();
    ctx.ellipse(cx + s * rx * 0.92, earY, rx * 0.13, ry * 0.19, 0, 0, TAU);
    ctx.fill();
  }

  // ------------------------------------------------------------ hair mass
  const skull = skullPath(cx, cy, rx, ry);
  if (!sealed) {
    cel(ctx, capped ? skull : crownPath(style, cx, cy, rx, ry), hair, size);
    nape(ctx, cx, cy, rx, ry, hair, skull);
  }

  // The long shapes hang below the hatline, so they survive a helmet.
  if (style === 'long') longFall(ctx, cx, cy, rx, ry, hair, swing, size);
  else if (style === 'pony') ponytail(ctx, cx, cy, rx, ry, hair, swing, size);
  // A mullet is the one cut whose whole point is at the BACK, so it is the one
  // the camera angle flatters — and the one that most obviously used to be
  // missing, since every mullet in the collection arrived as "messy".
  else if (style === 'mullet') mullet(ctx, cx, cy, rx, ry, hair, swing, size);

  // The sheen. It has to ride HIGH on the crown: sat anywhere near the middle of
  // the skull, pale marks on an egg read as eyes and a mouth — a face on the
  // back of the head, which is the exact thing this file exists to avoid. Under
  // a hat it is skipped outright rather than moved to the nape, where it read as
  // a chin.
  if (!hat && !capCol) sheen(ctx, cx, cy, rx, ry, hair, style);

  // ------------------------------------------------------------------ hat
  // A cap comes a long way DOWN the skull from behind — most of what you see of
  // someone's head is the cap. Sat higher it perches like a bowler and leaves a
  // big blank oval of hair under it, which is exactly the featureless area that
  // invites the eye to read a face into it.
  if (worn === 'durag') {
    durag(ctx, cx, cy, rx, ry, hat || capCol, size, swing, skull);
  } else if (worn === 'brim') {
    wideBrim(ctx, cx, cy, rx, ry, capCol, size, skull, hair);
  } else if (worn === 'helmet') {
    helmet(ctx, cx, cy, rx, ry, capCol, size);
  } else if (worn === 'visor') {
    visor(ctx, cx, cy, rx, ry, capCol, size, skull);
  } else if (worn === 'horns') {
    horns(ctx, cx, cy, rx, ry, capCol, size);
  } else if (capCol) {
    cap(ctx, cx, cy, rx, ry, capCol, size, skull, hair);
  }

  // -------------------------------------------------------------- bandana
  if (rig.bandana) bandana(ctx, cx, cy, rx, ry, rig.bandana, swing, size);

  // ------------------------------------------------------------- jewellery
  // LAST, and deliberately so. Drawn before the hair these came out as rings
  // floating clear of the silhouette with nothing joining them to the head —
  // the hair covered the half that would have said "this hangs off an ear".
  if (rig.hoops) earring(ctx, cx + rx * 0.90, earY + ry * 0.14, rx, ry,
    rig.hoops, rig.earringKind || 'hoop');
  if (rig.shades) temples(ctx, cx, cy, rx, ry, rig.shades, size);
}

// ------------------------------------------------------------------ pieces

/**
 * Two-tone cel fill, matching the body's: the shape in its shadow tone, then
 * the same shape clipped to itself and offset toward the light in its base
 * tone. Offset only, never inset — insetting leaves a dark line all the way
 * round and the head reads as an outline drawing.
 */
function cel(ctx, build, t, size) {
  ctx.beginPath();
  build(ctx, 0);
  ctx.fillStyle = t.dark;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.translate(-size * LX, -size * LY);
  ctx.beginPath();
  build(ctx, 0);
  ctx.fillStyle = t.base;
  ctx.fill();
  ctx.restore();
}

/**
 * Quadratic smoothing through a point list: each point becomes a control point
 * and the curve passes through the midpoints. Turns a dozen jittered points
 * into a soft scalloped edge, which is what a hem of hair is and what a
 * polyline of lineTo's very much is not.
 *
 * Assumes a current point — call it after a moveTo/lineTo.
 */
function smooth(p, pts) {
  if (pts.length < 2) return;
  p.lineTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    p.quadraticCurveTo(pts[i][0], pts[i][1],
      (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  }
  p.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}

/** Deterministic 0..1 jitter. No Math.random — the head must not shimmer. */
const jit = (i, seed) => (((i * 1103515245 + seed * 12345) >>> 8) % 1000) / 1000;

/**
 * An egg, not a circle: wide round cranium tapering to a narrower base. A plain
 * ellipse at this size reads as a potato on a stick, and the taper is the only
 * bit of the collection's small pointed chin that survives from behind.
 */
function skullPath(cx, cy, rx, ry) {
  return (p, g) => {
    p.moveTo(cx - rx - g, cy);
    p.bezierCurveTo(cx - rx - g, cy - ry * 1.34 - g,
      cx + rx + g, cy - ry * 1.34 - g, cx + rx + g, cy);
    p.bezierCurveTo(cx + rx * 0.90 + g, cy + ry * 1.06 + g,
      cx - rx * 0.90 - g, cy + ry * 1.06 + g, cx - rx - g, cy);
    p.closePath();
  };
}

/**
 * The hair's whole silhouette for a given cut, as ONE path.
 *
 * Everything a cut adds is a subpath wound the same way as the skull, so a
 * nonzero fill unions them into a single mass. That is the difference between a
 * tuft and a blob: a tuft can only ever change the OUTLINE, where a shape
 * painted separately on top stays flat under the cel pass and reads as a
 * feature — three of them in a row read as a face.
 *
 * The six cuts have to separate at 75px across, so each one owns a different
 * outline rather than a different surface:
 *
 *   short   clean, tight to the skull, nothing breaking the edge
 *   casual  a soft off-centre cluster and a fringe tip past one side
 *   messy   sharp spikes all round the crown, unequal, biggest off-centre
 *   bushy   one wavy mass grown well past the skull on every side
 *   mullet  tight crown (the curtain is drawn separately, below)
 *   long    tight crown (the fall is drawn separately, below)
 */
function crownPath(style, cx, cy, rx, ry) {
  const skull = skullPath(cx, cy, rx, ry);

  if (style === 'bushy') {
    // A continuous wavy edge rather than a ring of circles. Drawn as separate
    // lobes it came out as a blackberry: nine hard-edged discs, each reading as
    // its own object because each one owned an outline.
    return (p, g) => {
      const RX = rx * 1.16 + g, RY = ry * 1.20 + g;
      const pts = [];
      const N = 15;
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const a = Math.PI + k * Math.PI;
        // Two frequencies, neither a multiple of the other, so the bumps never
        // fall into a pattern the eye can lock onto and count.
        const w = 1 + 0.070 * Math.sin(k * 19.3) + 0.050 * Math.sin(k * 7.1 + 1.4);
        pts.push([cx + Math.cos(a) * RX * w, cy + Math.sin(a) * RY * w]);
      }
      p.moveTo(pts[0][0], pts[0][1]);
      smooth(p, pts);
      p.bezierCurveTo(cx + rx * 1.00 + g, cy + ry * 1.04 + g,
        cx - rx * 1.00 - g, cy + ry * 1.04 + g, pts[0][0], pts[0][1]);
      p.closePath();
    };
  }

  if (style === 'short' || style === 'mullet' || style === 'long'
      || style === 'pony') {
    return skull;
  }

  if (style === 'casual') {
    // One soft cluster, off to one side, plus a fringe tip clearing the left
    // edge. Asymmetry is the whole trait: a symmetrical soft crown is just the
    // short cut with a bump on it.
    return (p, g) => {
      skull(p, g);
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI * 0.78 + i * 0.30;
        const r = rx * (0.15 + 0.05 * Math.sin(i * 2.3)) + g;
        p.moveTo(cx + Math.cos(a) * rx * 0.86 + r, cy + Math.sin(a) * ry * 0.86);
        p.arc(cx + Math.cos(a) * rx * 0.86, cy + Math.sin(a) * ry * 0.86,
          r, 0, TAU);
      }
      // The fringe, swept forward past the temple.
      p.moveTo(cx - rx * 0.86 - g, cy - ry * 0.30);
      p.quadraticCurveTo(cx - rx * 1.24 - g, cy - ry * 0.10,
        cx - rx * 1.10 - g, cy + ry * 0.34);
      p.quadraticCurveTo(cx - rx * 0.94 - g, cy + ry * 0.06,
        cx - rx * 0.72, cy - ry * 0.20);
      p.closePath();
    };
  }

  // messy — spikes, and they have to be SPIKES. Round lobes at the ends of the
  // arc sit exactly where ears would be and the head reads as wearing two buns;
  // a triangle pointing away from the skull cannot be read as anything but hair.
  return (p, g) => {
    skull(p, g);
    const N = 9;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      // Jittered SPACING as well as length. Evenly spaced teeth of similar size
      // stop being hair and become a machined edge — at 40px a coloured head
      // ringed in regular triangles is a bottle cap.
      const a = -Math.PI * 0.94 + k * Math.PI * 0.88 + (jit(i, 3) - 0.5) * 0.16;
      // Longest just off-centre, shortest at the extremes: a spike at the side
      // of the head at full length is a horn.
      //
      // SHORT. These clear the skull by about a fifth of its width and no more.
      // Run out to half a head-radius — which is what "a spike" suggests on
      // paper — and the Primo is a hedgehog, and every hat in the collection
      // gets a ring of black thorns standing up behind it.
      const len = (0.16 + 0.20 * Math.sin(k * Math.PI)) * (0.25 + jit(i, 7) * 1.3);
      const halfW = 0.10 + jit(i, 23) * 0.07;
      const bx = cx + Math.cos(a) * rx * 0.92;
      const by = cy + Math.sin(a) * ry * 0.92;
      // Swept back and to one side, so the spikes lean rather than radiate —
      // radiating spikes read as a sun, or as a crown.
      const tipA = a - 0.34 + jit(i, 41) * 0.3;
      const tip = 0.13 + len * 0.42;
      p.moveTo(bx + Math.cos(a + Math.PI / 2) * rx * halfW,
        by + Math.sin(a + Math.PI / 2) * ry * halfW);
      p.lineTo(bx + Math.cos(tipA) * rx * tip, by + Math.sin(tipA) * ry * tip);
      p.lineTo(bx + Math.cos(a - Math.PI / 2) * rx * halfW,
        by + Math.sin(a - Math.PI / 2) * ry * halfW);
      p.closePath();
    }
  };
}

/**
 * The nape. Hair tapers to a point at the top of the neck, and that little dark
 * wedge is doing more work than its size suggests: without it the area under a
 * cap is a big smooth oval, and a big smooth oval on top of a body is where a
 * viewer starts looking for a face.
 */
function nape(ctx, cx, cy, rx, ry, hair, skull) {
  ctx.save();
  ctx.beginPath();
  skull(ctx, 0);
  ctx.clip();
  ctx.fillStyle = hair.dark;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.46, cy + ry * 0.40);
  ctx.quadraticCurveTo(cx - rx * 0.22, cy + ry * 0.92, cx, cy + ry * 1.16);
  ctx.quadraticCurveTo(cx + rx * 0.22, cy + ry * 0.92, cx + rx * 0.46, cy + ry * 0.40);
  ctx.quadraticCurveTo(cx, cy + ry * 0.66, cx - rx * 0.46, cy + ry * 0.40);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * The broken highlight arc anime hair always has.
 *
 * A BAND THAT FOLLOWS THE CROWN, not marks sitting on it. This is the third
 * attempt and the first that is not a face: three evenly spaced ovals were two
 * eyes and a nose, and cutting them to two unequal ovals was worse, because two
 * pale marks at that height on an egg are unambiguously eyes — a long-haired
 * Primo came out as a cartoon ghost.
 *
 * Nothing about a blob says which way a surface turns. A band curving around the
 * skull at a constant depth under its edge can only be read one way: as light
 * lying along something round. It is broken once, off-centre, and the two arcs
 * are different lengths — that break is the anime part, and the asymmetry is
 * what stops the pair of them pairing up.
 */
function sheen(ctx, cx, cy, rx, ry, hair, style) {
  // A spiky crown carries its own light story in the silhouette; a smooth one
  // needs this more.
  ctx.save();
  ctx.globalAlpha = style === 'messy' ? 0.55 : 0.72;
  ctx.fillStyle = hair.light;
  // Each arc TAPERS TO NOTHING at both ends. A constant-thickness band with a
  // gap in it is a hairband — the shape has to be a lens, fattest in the middle,
  // because that is what a specular on a curved surface is and the eye knows it.
  const OUT = 0.91, FAT = 0.19;
  for (const [a0, a1, k] of [[Math.PI * 1.08, Math.PI * 1.42, 1],
    [Math.PI * 1.53, Math.PI * 1.69, 0.72]]) {
    ctx.beginPath();
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const a = a0 + (a1 - a0) * (i / N);
      const x = cx + Math.cos(a) * rx * OUT, y = cy + Math.sin(a) * ry * OUT;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    for (let i = N; i >= 0; i--) {
      const t = i / N;
      const a = a0 + (a1 - a0) * t;
      const r = OUT - FAT * k * Math.pow(Math.sin(t * Math.PI), 0.7);
      ctx.lineTo(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A baseball cap from behind: a dome over the crown, a hard shadow where it
 * meets the hair, the two panel seams, the ADJUSTER NOTCH at the centre back,
 * and the corners of the brim just breaking the silhouette at the sides.
 *
 * The notch is the whole read. A cap's band is open at the back and a wedge of
 * hair shows through it — it is the one feature that says "cap" and not "swim
 * hat", and being hair-coloured it cannot turn into a mouth the way a pale
 * strap did.
 *
 * What used to be here instead was the collection's script mark laid across the
 * crown. At the size this renders it is not a mark, it is a scribble: a pale
 * squiggle on the largest dark shape in the figure, and every cap in the
 * collection wore the same one.
 */
function cap(ctx, cx, cy, rx, ry, hat, size, skull, hair) {
  const edge = cy + ry * 0.30;
  const notch = ry * 0.17;

  // Hard shadow cast onto the hair just under the hat's edge. This is the value
  // break that stops a dark cap on dark hair reading as one blob.
  ctx.save();
  ctx.beginPath();
  skull(ctx, 0);
  ctx.clip();
  ctx.fillStyle = 'rgba(20,11,30,0.34)';
  ctx.beginPath();
  ctx.moveTo(cx - rx * 1.1, edge);
  ctx.quadraticCurveTo(cx, edge + notch * 1.4, cx + rx * 1.1, edge);
  ctx.lineTo(cx + rx * 1.1, edge + ry * 0.28);
  ctx.quadraticCurveTo(cx, edge + ry * 0.28 + notch, cx - rx * 1.1, edge + ry * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Brim, seen from directly behind: it points away from us, so all that clears
  // the skull is a thin crescent at each side. Kept TIGHT to the dome and swept
  // back along it — the old version was a fat ellipse standing off the head at
  // each side, which at this size is a pair of wings.
  ctx.fillStyle = hat.dark;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * rx * 0.72, edge - ry * 0.44);
    ctx.quadraticCurveTo(cx + s * rx * 1.20, edge - ry * 0.36,
      cx + s * rx * 1.16, edge - ry * 0.06);
    ctx.quadraticCurveTo(cx + s * rx * 1.00, edge - ry * 0.22,
      cx + s * rx * 0.72, edge - ry * 0.30);
    ctx.closePath();
    ctx.fill();
  }

  // The dome, with the adjuster notch cut into its lower edge. One path: the
  // notch is part of the outline, so it survives the cel pass instead of being
  // a mark painted over it.
  const dome = (p, g) => {
    p.moveTo(cx - rx * 1.04 - g, edge);
    p.bezierCurveTo(cx - rx * 1.08 - g, cy - ry * 1.30 - g,
      cx + rx * 1.08 + g, cy - ry * 1.30 - g, cx + rx * 1.04 + g, edge);
    // down the right of the notch, up its left side
    p.lineTo(cx + rx * 0.22, edge + ry * 0.05);
    p.quadraticCurveTo(cx + rx * 0.16, edge - notch * 0.55,
      cx + rx * 0.09, edge - notch);
    p.lineTo(cx - rx * 0.09, edge - notch);
    p.quadraticCurveTo(cx - rx * 0.16, edge - notch * 0.55,
      cx - rx * 0.22, edge + ry * 0.05);
    p.closePath();
  };
  cel(ctx, dome, hat, size);

  // Panel seams. VERTICAL on purpose: a horizontal mark across a dark oval at
  // this size is a mouth, and the two brim crescents beside it promptly become
  // eyes. Nothing running up and down can be read as a face.
  ctx.save();
  ctx.beginPath();
  dome(ctx, 0);
  ctx.clip();
  ctx.strokeStyle = withA(hat.dark, 0.55);
  ctx.lineWidth = Math.max(0.8, size * 0.013);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * rx * 0.10, cy - ry * 1.02);
    ctx.quadraticCurveTo(cx + s * rx * 0.52, cy - ry * 0.30,
      cx + s * rx * 0.60, edge);
    ctx.stroke();
  }
  ctx.restore();

  // The crown button, and a catch of sky on the top of the dome.
  ctx.fillStyle = withA(hat.light, 0.75);
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 1.02, rx * 0.055, ry * 0.045, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = withA(hat.light, 0.34);
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.34, cy - ry * 0.86, rx * 0.34, ry * 0.11, 0.22, 0, TAU);
  ctx.fill();

  // Hair breaking out under the cap's edge at the sides. Two small tufts, and
  // they matter out of all proportion to their size: without them the cap is a
  // clean arc laid over a clean egg and the join reads as moulded plastic.
  if (hair) {
    ctx.fillStyle = hair.base;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * rx * 0.58, edge + ry * 0.04);
      ctx.quadraticCurveTo(cx + s * rx * 0.98, edge + ry * 0.06,
        cx + s * rx * 0.90, edge + ry * 0.28);
      ctx.quadraticCurveTo(cx + s * rx * 0.80, edge + ry * 0.10,
        cx + s * rx * 0.58, edge + ry * 0.04);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/**
 * A do-rag: smooth cloth pulled over the whole crown, one seam down the middle,
 * and the long tails hanging down the back of the neck.
 *
 * The tails are the trait. Without them this is a swim cap — and what was here
 * before was worse than that, because it went through the beanie path: knit
 * ribbing and a rolled brim, which turned every Black Bandana in the collection
 * into a woolly hat with vertical staves. At 75px across that is a barrel.
 */
function durag(ctx, cx, cy, rx, ry, hat, size, swing, skull) {
  const edge = cy + ry * 0.50;
  const sway = swing * size;

  // Tails first, so the cap sits over the point where they are tied.
  ctx.fillStyle = hat.dark;
  for (const [k, len] of [[-1, 1.55], [0.55, 1.24]]) {
    ctx.beginPath();
    ctx.moveTo(cx + rx * 0.06, cy + ry * 0.10);
    ctx.quadraticCurveTo(cx + k * rx * 0.46 + sway * 1.6, cy + ry * 0.86,
      cx + k * rx * 0.40 + sway * 2.4, cy + ry * len);
    ctx.lineTo(cx + k * rx * 0.10 + sway * 2.4, cy + ry * (len - 0.10));
    ctx.quadraticCurveTo(cx + k * rx * 0.16 + sway * 1.6, cy + ry * 0.82,
      cx - rx * 0.10, cy + ry * 0.12);
    ctx.closePath();
    ctx.fill();
  }

  // The cloth. Comes further down the skull than a cap — that is what a do-rag
  // does — and its lower edge is a clean arc, no notch: this one is tied, not
  // buckled.
  const dome = (p, g) => {
    p.moveTo(cx - rx * 1.05 - g, edge - ry * 0.22);
    p.bezierCurveTo(cx - rx * 1.09 - g, cy - ry * 1.30 - g,
      cx + rx * 1.09 + g, cy - ry * 1.30 - g, cx + rx * 1.05 + g, edge - ry * 0.22);
    p.quadraticCurveTo(cx, edge + ry * 0.10 + g, cx - rx * 1.05 - g, edge - ry * 0.22);
    p.closePath();
  };
  cel(ctx, dome, hat, size);

  // The seam, and the knot it runs into. One vertical line and one small lump:
  // the two marks that say "cloth tied round a head" rather than "moulded shell".
  ctx.save();
  ctx.beginPath();
  dome(ctx, 0);
  ctx.clip();
  ctx.strokeStyle = withA(hat.light, 0.30);
  ctx.lineWidth = Math.max(0.8, size * 0.012);
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry * 1.22);
  ctx.quadraticCurveTo(cx + rx * 0.04, cy - ry * 0.2, cx, edge);
  ctx.stroke();
  // Sky on the top of the cloth, which is smooth and therefore catches a lot.
  ctx.fillStyle = withA(hat.light, 0.30);
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.30, cy - ry * 0.82, rx * 0.42, ry * 0.15, 0.20, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = hat.base;
  ctx.beginPath();
  ctx.ellipse(cx + rx * 0.02, cy + ry * 0.10, rx * 0.19, ry * 0.15, 0.3, 0, TAU);
  ctx.fill();
}

/**
 * The long fall — to the shoulder blades, not the waist.
 *
 * The hem is THREE LOCKS of unequal length, not a frill. Closed with one smooth
 * arc this was a rounded slab the width of the head, which is a hood; closed
 * with seven small even scallops it was the frilly bottom of a cartoon ghost,
 * which — with two highlights sitting where eyes go — is exactly what it looked
 * like. Few and uneven is hair. Many and even is a costume.
 *
 * It also TAPERS IN toward the hem rather than flaring. Hair falling straight
 * down is a curtain; hair narrowing as it falls is hair that has weight.
 */
function longFall(ctx, cx, cy, rx, ry, hair, swing, size) {
  const sway = swing * size;
  const hemY = cy + ry * 1.42;
  const build = (p, g) => {
    p.moveTo(cx - rx * 0.98 - g, cy - ry * 0.20);
    p.bezierCurveTo(cx - rx * 1.12 - g + sway * 0.4, cy + ry * 0.52,
      cx - rx * 0.92 - g + sway, cy + ry * 1.00,
      cx - rx * 0.74 - g + sway, hemY - ry * 0.06);
    smooth(p, [
      [cx - rx * 0.74 + sway, hemY - ry * 0.06],
      [cx - rx * 0.38 + sway, hemY + ry * 0.20],
      [cx - rx * 0.08 + sway, hemY - ry * 0.14],
      [cx + rx * 0.26 + sway, hemY + ry * 0.24],
      [cx + rx * 0.52 + sway, hemY - ry * 0.08],
      [cx + rx * 0.74 + sway, hemY + ry * 0.04],
    ]);
    p.bezierCurveTo(cx + rx * 0.92 + g + sway, cy + ry * 1.00,
      cx + rx * 1.12 + g + sway * 0.4, cy + ry * 0.52,
      cx + rx * 0.98 + g, cy - ry * 0.20);
    p.quadraticCurveTo(cx, cy + ry * 0.30, cx - rx * 0.98 - g, cy - ry * 0.20);
    p.closePath();
  };
  cel(ctx, build, hair, size);

  // Two strand breaks, unequal and off-centre, clipped into the fall.
  ctx.save();
  ctx.beginPath();
  build(ctx, 0);
  ctx.clip();
  ctx.fillStyle = withA(hair.dark, 0.75);
  for (const [x0, w, d] of [[-0.30, 0.10, 1.30], [0.42, 0.07, 1.16]]) {
    ctx.beginPath();
    ctx.moveTo(cx + rx * x0, cy + ry * 0.30);
    ctx.quadraticCurveTo(cx + rx * (x0 + 0.06) + sway * 0.6, cy + ry * 0.90,
      cx + rx * (x0 + 0.04) + sway, cy + ry * d);
    ctx.lineTo(cx + rx * (x0 + 0.04 + w) + sway, cy + ry * d);
    ctx.quadraticCurveTo(cx + rx * (x0 + 0.06 + w) + sway * 0.6, cy + ry * 0.90,
      cx + rx * (x0 + w), cy + ry * 0.30);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function ponytail(ctx, cx, cy, rx, ry, hair, swing, size) {
  // The tail is the one piece of the character with real secondary motion, so
  // it carries most of the sense of speed.
  const build = (p) => {
    p.moveTo(cx - rx * 0.26, cy + ry * 0.34);
    p.quadraticCurveTo(cx - rx * 0.5 + swing * size * 2.2, cy + ry * 1.25,
      cx - rx * 0.16 + swing * size * 3.0, cy + ry * 1.92);
    p.lineTo(cx + rx * 0.30 + swing * size * 3.0, cy + ry * 1.86);
    p.quadraticCurveTo(cx + rx * 0.44 + swing * size * 2.2, cy + ry * 1.1,
      cx + rx * 0.26, cy + ry * 0.34);
    p.closePath();
  };
  cel(ctx, build, hair, size);
  ctx.fillStyle = hair.dark;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.34, rx * 0.30, ry * 0.19, 0, 0, TAU);
  ctx.fill();
}

/**
 * 'mullet' — short and tight over the crown, then a curtain down the nape.
 * Business in front, and the front is the half nobody playing this game will
 * ever see, so the whole trait lives or dies on the curtain.
 *
 * Two things separate it from long hair, and both are outline: it is NARROWER
 * than the skull where it starts, so the sides of the head stay visible above
 * it, and it stops well short of where longFall ends. It used to be wider than
 * the skull with three cut lines ruled down it, which under a wide brim came
 * out as a wooden keg.
 */
function mullet(ctx, cx, cy, rx, ry, hair, swing, size) {
  const sway = swing * size * 0.5;
  const hemY = cy + ry * 1.16;
  const build = (p, g) => {
    p.moveTo(cx - rx * 0.80 - g, cy + ry * 0.26);
    p.bezierCurveTo(cx - rx * 0.90 - g, cy + ry * 0.74,
      cx - rx * 0.74 - g + sway, cy + ry * 1.00,
      cx - rx * 0.62 + sway, hemY - ry * 0.08);
    const pts = [];
    const N = 6;
    for (let i = 0; i <= N; i++) {
      const k = i / N;
      pts.push([cx + (k - 0.5) * rx * 1.24 + sway,
        hemY + ry * (i % 2 ? 0.13 : -0.05) * (0.5 + jit(i, 11))]);
    }
    smooth(p, pts);
    p.bezierCurveTo(cx + rx * 0.74 + g + sway, cy + ry * 1.00,
      cx + rx * 0.90 + g, cy + ry * 0.74,
      cx + rx * 0.80 + g, cy + ry * 0.26);
    p.quadraticCurveTo(cx, cy + ry * 0.52, cx - rx * 0.80 - g, cy + ry * 0.26);
    p.closePath();
  };
  cel(ctx, build, hair, size);

  // One strand break, off-centre. Not three ruled lines — those were staves.
  ctx.save();
  ctx.beginPath();
  build(ctx, 0);
  ctx.clip();
  ctx.fillStyle = withA(hair.dark, 0.7);
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.22, cy + ry * 0.40);
  ctx.quadraticCurveTo(cx - rx * 0.16 + sway * 0.6, cy + ry * 0.82,
    cx - rx * 0.18 + sway, hemY);
  ctx.lineTo(cx - rx * 0.08 + sway, hemY);
  ctx.quadraticCurveTo(cx - rx * 0.06 + sway * 0.6, cy + ry * 0.82,
    cx - rx * 0.12, cy + ry * 0.40);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * A wide brim — the mariachi and cowboy hats.
 *
 * This is the silhouette the whole trait pass was for. From behind, a brim that
 * clears the skull on both sides is the single most distinctive thing a head can
 * be wearing, and it is unmistakably NOT a baseball cap, which is what every one
 * of these used to render as.
 *
 * Order matters: brim first so the crown sits on top of it. Two things stop it
 * reading as a flying saucer, which is what a flat ellipse under a smooth dome
 * gives you: the brim TURNS UP at the tips, and the crown is CREASED.
 */
function wideBrim(ctx, cx, cy, rx, ry, hat, size, skull, hair) {
  // Sat high enough that whatever hair the Primo has still shows below it. A
  // brim at the ear line hides a mullet completely, and #2664 is a Mariachi Hat
  // over a Mullet Brown — losing one of the two traits to the other is only
  // half a fix.
  const brimY = cy + ry * 0.20;
  const HW = rx * 1.46, HH = ry * 0.30;

  // Hair escaping under the brim, drawn before it so the brim overlaps.
  if (hair) {
    ctx.fillStyle = hair.base;
    ctx.beginPath();
    ctx.ellipse(cx, brimY + ry * 0.16, rx * 0.90, ry * 0.42, 0, 0, TAU);
    ctx.fill();
  }

  // The brim, as a path rather than an ellipse so the tips can lift. 1.46, not
  // 1.72: a brim only has to CLEAR the skull to read as a brim, and past about
  // one and a half head-widths it stops looking like a hat and starts looking
  // like a lampshade — the runner is 0.52u wide and the hat was ending up wider
  // than their shoulders.
  const brim = (p, g) => {
    p.moveTo(cx - HW - g, brimY - ry * 0.10);
    p.bezierCurveTo(cx - HW * 0.86 - g, brimY + HH + g,
      cx + HW * 0.86 + g, brimY + HH + g, cx + HW + g, brimY - ry * 0.10);
    p.bezierCurveTo(cx + HW * 0.72 + g, brimY - HH * 0.78 - g,
      cx - HW * 0.72 - g, brimY - HH * 0.78 - g, cx - HW - g, brimY - ry * 0.10);
    p.closePath();
  };
  cel(ctx, brim, hat, size);

  // Sun catching the top surface of the brim. Kept WEAK: `hat.light` is mixed
  // toward the sky colour, and laid across the whole brim at half alpha it
  // turned a black charro hat lavender — the biggest shape in the silhouette
  // taking the sky's hue reads as the hat being that colour, not as light on it.
  ctx.save();
  ctx.beginPath();
  brim(ctx, 0);
  ctx.clip();
  ctx.fillStyle = withA(hat.light, 0.22);
  ctx.beginPath();
  ctx.ellipse(cx, brimY - ry * 0.13, HW * 0.92, HH * 0.52, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Crown: taller and narrower than the brim, with the crease down the centre
  // that every hat of this shape has. Both are silhouette, so both survive.
  const crown = (p, g) => {
    p.moveTo(cx - rx * 0.80 - g, brimY - ry * 0.04);
    p.bezierCurveTo(cx - rx * 0.90 - g, cy - ry * 1.12 - g,
      cx - rx * 0.30 - g, cy - ry * 1.30 - g, cx - rx * 0.20 - g, cy - ry * 1.12);
    p.quadraticCurveTo(cx, cy - ry * 0.86, cx + rx * 0.20 + g, cy - ry * 1.12);
    p.bezierCurveTo(cx + rx * 0.30 + g, cy - ry * 1.30 - g,
      cx + rx * 0.90 + g, cy - ry * 1.12 - g, cx + rx * 0.80 + g, brimY - ry * 0.04);
    p.closePath();
  };
  cel(ctx, crown, hat, size);

  // Band where the crown meets the brim. One dark stripe, and it is what keeps
  // the crown and the brim from fusing into a single lump at 40px.
  ctx.save();
  ctx.beginPath();
  crown(ctx, 0);
  ctx.clip();
  ctx.fillStyle = withA(hat.dark, 0.85);
  ctx.fillRect(cx - rx * 1.1, brimY - ry * 0.36, rx * 2.2, ry * 0.28);
  ctx.restore();
}

/**
 * Construction helmet: a smooth dome, the centre ridge, and the short back brim
 * that flares off the bottom of it. The brim is what separates a hard hat from
 * a bowl, and the ridge on its own was doing that job with a hard white bar
 * that read as a lamp.
 */
function helmet(ctx, cx, cy, rx, ry, hat, size) {
  const edge = cy + ry * 0.20;

  // The back brim, and it has to be WIDER than the shell or it is not visible
  // at all — a hard hat's brim runs the whole way round and stands proud of it,
  // and without that this is a smooth yellow egg.
  ctx.fillStyle = hat.dark;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 1.22, edge - ry * 0.16);
  ctx.quadraticCurveTo(cx, edge + ry * 0.42, cx + rx * 1.22, edge - ry * 0.16);
  ctx.quadraticCurveTo(cx, edge + ry * 0.06, cx - rx * 1.22, edge - ry * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hat.base;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 1.18, edge - ry * 0.19);
  ctx.quadraticCurveTo(cx, edge + ry * 0.34, cx + rx * 1.18, edge - ry * 0.19);
  ctx.quadraticCurveTo(cx, edge + ry * 0.02, cx - rx * 1.18, edge - ry * 0.19);
  ctx.closePath();
  ctx.fill();

  const dome = (p, g) => {
    p.moveTo(cx - rx * 1.00 - g, edge - ry * 0.06);
    p.bezierCurveTo(cx - rx * 1.04 - g, cy - ry * 1.36 - g,
      cx + rx * 1.04 + g, cy - ry * 1.36 - g, cx + rx * 1.00 + g, edge - ry * 0.06);
    p.quadraticCurveTo(cx, edge + ry * 0.12 + g, cx - rx * 1.00 - g, edge - ry * 0.06);
    p.closePath();
  };
  cel(ctx, dome, hat, size);

  // The ridge: a soft crest with a shadow down one side only. Two hard parallel
  // lines with a bright bar between them made the shell read as a book spine,
  // and one bright ellipse on its own read as a light fitting.
  ctx.save();
  ctx.beginPath();
  dome(ctx, 0);
  ctx.clip();
  ctx.fillStyle = withA(hat.dark, 0.42);
  ctx.beginPath();
  ctx.ellipse(cx + rx * 0.13, cy - ry * 0.46, rx * 0.10, ry * 0.86, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = withA(hat.light, 0.34);
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.05, cy - ry * 0.56, rx * 0.11, ry * 0.74, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * Poker visor: a band round the head, an OPEN crown with the hair showing
 * through it, and the brim clearing the sides.
 *
 * The open crown is the entire trait. The old one filled the top of the skull
 * with a solid half-ellipse of green and put a wide plate under it, so a blonde
 * Primo in a visor came out as a sandwich.
 */
function visor(ctx, cx, cy, rx, ry, hat, size, skull) {
  const y = cy - ry * 0.04;

  // The brim. It has to CLEAR THE HEAD on both sides and clear it obviously,
  // because it is the only part of this that is not a strap: a band on its own,
  // however well drawn, is a headband — and a coloured band across the middle of
  // a dark oval reads as a sleep mask, which is what this was.
  //
  // Swept forward and down, because the brim points away from the camera and
  // droops. Drawn under the band so it tucks in.
  // A crescent hugging each side of the skull and sweeping DOWN and forward,
  // which is what the top surface of the brim does from a camera sat behind and
  // slightly above. The first attempt was a pair of big symmetrical spurs
  // standing straight out from the band, and two pointed green shapes either
  // side of a green band is a sandwich garnish.
  const brim = (s, o, len) => {
    ctx.beginPath();
    ctx.moveTo(cx + s * rx * 0.56, y - ry * 0.02 + o);
    ctx.bezierCurveTo(cx + s * rx * 1.06, y - ry * 0.06 + o,
      cx + s * rx * len, y + ry * 0.14 + o,
      cx + s * rx * len, y + ry * 0.42 + o);
    ctx.quadraticCurveTo(cx + s * rx * 0.94, y + ry * 0.20 + o,
      cx + s * rx * 0.56, y + ry * 0.16 + o);
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = hat.dark;
  for (const s of [-1, 1]) brim(s, 0, 1.30);
  // Translucent, because a poker visor is a sheet of green plastic and letting
  // the sunset through it is the cheapest thing that says so.
  ctx.fillStyle = withA(hat.light, 0.55);
  for (const s of [-1, 1]) brim(s, -ry * 0.03, 1.22);

  // The band. A strap across the back of the skull, following its curve, and
  // nothing above it — the open crown is the whole trait.
  const band = (p, g) => {
    p.moveTo(cx - rx * 1.04 - g, y - ry * 0.14);
    p.quadraticCurveTo(cx, y - ry * 0.46 - g, cx + rx * 1.04 + g, y - ry * 0.14);
    p.quadraticCurveTo(cx, y + ry * 0.22 + g, cx - rx * 1.04 - g, y - ry * 0.14);
    p.closePath();
  };
  cel(ctx, band, hat, size);
  ctx.save();
  ctx.beginPath();
  band(ctx, 0);
  ctx.clip();
  ctx.fillStyle = withA(hat.light, 0.34);
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.20, y - ry * 0.30, rx * 0.52, ry * 0.06, 0.06, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * Horns. Two of them, off the crown, curving out and back.
 *
 * Thick at the base and short. Long thin ones read as insect antennae — which
 * is what they were: two slivers a few pixels wide standing well clear of the
 * head with no visible join to it.
 */
function horns(ctx, cx, cy, rx, ry, hat, size) {
  for (const s of [-1, 1]) {
    const bx = cx + s * rx * 0.56, by = cy - ry * 0.80;
    // Base, tucked into the hair so the join never shows as a seam.
    const build = (p, g) => {
      p.moveTo(bx - s * rx * 0.26 - s * g, by + ry * 0.24);
      // outer edge, out and up
      p.bezierCurveTo(bx + s * rx * 0.36 + s * g, by - ry * 0.10,
        bx + s * rx * 0.50 + s * g, by - ry * 0.54,
        bx + s * rx * 0.34 + s * g, by - ry * 0.92 - g);
      // the tip
      p.quadraticCurveTo(bx + s * rx * 0.22, by - ry * 0.96 - g,
        bx + s * rx * 0.16, by - ry * 0.84);
      // inner edge, back down
      p.bezierCurveTo(bx + s * rx * 0.24, by - ry * 0.50,
        bx + s * rx * 0.10, by - ry * 0.16,
        bx - s * rx * 0.26 - s * g, by + ry * 0.24);
      p.closePath();
    };
    // A keyline of sky along the outer curve, laid down BEFORE the horn and
    // slightly outside it. These are usually dark red on dark hair and the two
    // silhouettes fuse — the horn stops being an object and becomes a bump on
    // the head. A rim of the alley's own backlight is what separates them, and
    // it is the same treatment the head itself gets from RIM.
    ctx.save();
    ctx.globalAlpha = 0.85;
    cel(ctx, (p) => build(p, Math.max(1, size * 0.016)), {
      base: withA(hat.light, 0.95), dark: RIM,
    }, size);
    ctx.restore();
    cel(ctx, build, hat, size);
    // Two growth rings near the base — the one bit of surface that survives,
    // because it runs across the horn and reads as texture on a solid form.
    ctx.save();
    ctx.beginPath();
    build(ctx, 0);
    ctx.clip();
    ctx.strokeStyle = withA(hat.dark, 0.75);
    ctx.lineWidth = Math.max(0.8, size * 0.012);
    for (const k of [0.06, 0.26]) {
      ctx.beginPath();
      ctx.moveTo(bx - s * rx * 0.24, by + ry * (0.20 - k));
      ctx.quadraticCurveTo(bx + s * rx * 0.06, by + ry * (0.10 - k),
        bx + s * rx * 0.16, by - ry * (0.06 + k));
      ctx.stroke();
    }
    ctx.restore();
  }
}

function bandana(ctx, cx, cy, rx, ry, col, swing, size) {
  const t = normHat(col, null);
  // A BAND, not a skullcap. At 0.42 ry half-height it swallowed the top half of
  // the head and read as a second hat.
  ctx.fillStyle = t.base;
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.46, rx * 1.01, ry * 0.24, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = withA(t.dark, 0.65);
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.36, rx * 0.98, ry * 0.10, 0, 0, TAU);
  ctx.fill();

  // Knot at the back of the head, with two tails trailing in the slipstream.
  ctx.fillStyle = t.base;
  ctx.beginPath();
  ctx.ellipse(cx + rx * 0.12, cy - ry * 0.34, rx * 0.17, ry * 0.14, 0, 0, TAU);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + rx * 0.08, cy - ry * 0.32);
    ctx.quadraticCurveTo(
      cx + s * rx * 0.40 + swing * size * 1.4, cy + ry * 0.04,
      cx + s * rx * 0.30 + swing * size * 2.0, cy + ry * 0.42);
    ctx.lineTo(cx + s * rx * 0.06 + swing * size * 2.0, cy + ry * 0.36);
    ctx.quadraticCurveTo(
      cx + s * rx * 0.20 + swing * size * 1.4, cy + ry * 0.02,
      cx + rx * 0.14, cy - ry * 0.28);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * An earring, on the near ear only.
 *
 * ONE ear, not both. A matched pair sitting symmetrically at the two edges of a
 * dark oval is a pair of eyes, and the collection's own art hangs these off one
 * side anyway. It also has to OVERLAP the head: drawn clear of the silhouette
 * with a gap between it and the skull — which is what happened when these went
 * down before the hair and the hair then covered the inner half — it reads as a
 * ring floating in the air beside someone's head.
 */
function earring(ctx, x, y, rx, ry, col, kind) {
  ctx.save();
  const r = rx * 0.14;
  if (kind === 'stud') {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x, y - ry * 0.10, r * 0.52, r * 0.52, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,246,224,0.75)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.16, y - ry * 0.10 - r * 0.16, r * 0.20, r * 0.20, 0, 0, TAU);
    ctx.fill();
  } else if (kind === 'drop') {
    // A short post with a shape on the end of it, which is what a cross, a
    // heart and a diamond drop all reduce to at this size.
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, rx * 0.045);
    ctx.beginPath();
    ctx.moveTo(x, y - ry * 0.16);
    ctx.lineTo(x, y + ry * 0.06);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y + ry * 0.02);
    ctx.lineTo(x + r * 0.62, y + ry * 0.16);
    ctx.lineTo(x, y + ry * 0.32);
    ctx.lineTo(x - r * 0.62, y + ry * 0.16);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, rx * 0.062);
    ctx.beginPath();
    ctx.ellipse(x, y + ry * 0.06, r, r * 1.12, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The temple arms of a pair of glasses, hooking over the ears — the only part
 * of a pair of glasses visible from behind.
 *
 * They run FORWARD along the side of the head rather than sitting as a stub at
 * its edge, and they are drawn last. Two 4px marks under the hair was the same
 * as drawing nothing.
 */
function temples(ctx, cx, cy, rx, ry, col, size) {
  ctx.save();
  ctx.lineCap = 'round';
  const arm = (s) => {
    ctx.beginPath();
    // from just behind the ear, forward and slightly up over the temple
    ctx.moveTo(cx + s * rx * 0.86, cy + ry * 0.50);
    ctx.quadraticCurveTo(cx + s * rx * 1.04, cy + ry * 0.30,
      cx + s * rx * 1.02, cy + ry * 0.02);
    ctx.stroke();
  };
  // Backlight under the arm first. Most of the collection's glasses are black
  // plastic and most of its hair is near-black, so without this the trait was
  // drawn and then perfectly invisible — the two same-value shapes simply
  // merged. The rim is the alley's own, so it costs nothing in style.
  // Narrow. At half again the arm's width it is a keyline; at twice it, the two
  // strokes fuse into one fat mark and a pair of gold blues turn into a pair of
  // headphones.
  ctx.strokeStyle = RIM;
  ctx.lineWidth = Math.max(1.6, size * 0.036);
  for (const s of [-1, 1]) arm(s);
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, size * 0.024);
  for (const s of [-1, 1]) arm(s);
  // The lens rims, catching the sun where they clear the head at each temple.
  ctx.lineWidth = Math.max(1, size * 0.020);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * rx * 1.02, cy + ry * 0.02);
    ctx.lineTo(cx + s * rx * 1.04, cy - ry * 0.10);
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ colour

/**
 * Value-normalise a hair colour.
 *
 * The sampled crown of a Primo can come back as anything from #101010 to a
 * saturated cyan. Hue and saturation are the Primo's and are kept; lightness is
 * pinned into a band where a shadow tone and a sheen are both still visible.
 * Pitch black hair has nowhere to put a highlight, which is exactly how the head
 * ended up a featureless blob.
 */
function normHair(col) {
  const key = 'h' + col;
  const hit = CACHE.get(key);
  if (hit) return hit;

  const [h, s0, l0] = rgb2hsl(parse(col));
  // Saturation gets a ceiling too, and only a ceiling. Fully saturated hair on
  // a head this size is a boiled sweet — it is the one shape big enough that a
  // pure hue on it stops reading as a material.
  const s = Math.min(s0, 0.74);
  // The lightness ceiling RISES as saturation falls. A flat 0.54 turned the
  // collection's White hair into beige: a saturated colour needs the headroom
  // because its own hue is already carrying the shape, but a near-grey has
  // nothing but value to say "white" with, and 0.54 says "light brown".
  const l = Math.max(0.21, Math.min(0.54 + (1 - s) * 0.24, l0));
  const base = hsl2rgb(h, s, l);
  const out = {
    base: str(base),
    dark: str(scale(mix(base, AMB, 0.14), 0.62)),
    // Clamped up rather than scaled: near-black hair scaled by 1.5 is still
    // near-black and the sheen would never show. Warmed toward the sky, because
    // that is what it is catching.
    light: str(mix(hsl2rgb(h, s * 0.82, Math.min(0.86, l + 0.26)), SKY, 0.30)),
  };
  CACHE.set(key, out);
  return out;
}

/**
 * A hat sits ON the hair, so its job is to differ from it. Same value pinning,
 * then pushed away from the hair's lightness if the two landed on top of each
 * other — a black cap on black hair is two shapes with one value, which is no
 * shapes at all.
 */
function normHat(col, hair) {
  const key = 'c' + col + (hair ? hair.base : '');
  const hit = CACHE.get(key);
  if (hit) return hit;

  let [h, s, l0] = rgb2hsl(parse(col));
  let l = Math.max(0.13, Math.min(0.62, l0));
  if (hair) {
    const hl = rgb2hsl(parse(hair.base))[2];
    // Collision goes DARK, not light. The collection's own cap is black, and a
    // dark cap over lighter hair is the read everyone already has; the other way
    // round the cap looks like a bald patch.
    if (Math.abs(l - hl) < 0.15) {
      l = hl > 0.30 ? Math.max(0.11, hl - 0.19) : hl + 0.20;
      s = Math.min(s, 0.42);
    }
  }
  const base = hsl2rgb(h, s, l);
  const out = {
    base: str(base),
    dark: str(scale(mix(base, AMB, 0.14), 0.60)),
    light: str(mix(hsl2rgb(h, s * 0.8, Math.min(0.90, l + 0.30)), SKY, 0.34)),
  };
  CACHE.set(key, out);
  return out;
}

function tone(col) {
  const key = 't' + col;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const c = parse(col);
  const out = { base: str(c), dark: str(scale(mix(c, AMB, 0.16), 0.70)) };
  CACHE.set(key, out);
  return out;
}

const str = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (c, k) => [
  Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

function withA(col, a) {
  const [r, g, b] = parse(col);
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

function parse(col) {
  if (!col) return [34, 26, 30];
  if (col[0] === '#') {
    const n = parseInt(col.slice(1), 16);
    return col.length === 4
      ? [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
      : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = col.match(/(\d+(?:\.\d+)?)/g);
  return m ? [+m[0], +m[1], +m[2]] : [34, 26, 30];
}

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
