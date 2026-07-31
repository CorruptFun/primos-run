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
// Everything is drawn from the same trait fields the collection art uses (hair,
// cap, hairStyle, bandana, beanie, shades, hoops), so a Primo still reads as
// *their* Primo from behind. For a custom PFP those fields are sampled off the
// image by primo-head.js.
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
  // A beanie is just a cap that comes down further, so it goes through the same
  // path with a lower brim rather than duplicating all of it.
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
  for (const s of [-1, 1]) {
    ctx.fillStyle = s < 0 ? skin.base : skin.dark;
    ctx.beginPath();
    ctx.ellipse(cx + s * rx * 0.92, cy + ry * 0.44, rx * 0.13, ry * 0.19, 0, 0, TAU);
    ctx.fill();
  }
  if (rig.hoops) hoops(ctx, cx, cy, rx, ry, rig.hoops);

  // ------------------------------------------------------------ hair mass
  // An egg, not a circle: wide round cranium tapering to a narrower base. A
  // plain ellipse at this size reads as a potato on a stick, and the taper is
  // the only bit of the collection's small pointed chin that survives from
  // behind.
  const skull = (p, g) => {
    p.moveTo(cx - rx - g, cy);
    p.bezierCurveTo(cx - rx - g, cy - ry * 1.34 - g,
      cx + rx + g, cy - ry * 1.34 - g, cx + rx + g, cy);
    p.bezierCurveTo(cx + rx * 0.90 + g, cy + ry * 1.06 + g,
      cx - rx * 0.90 - g, cy + ry * 1.06 + g, cx - rx - g, cy);
    p.closePath();
  };
  cel(ctx, skull, hair, size);

  // Nape. The hair tapers to a point at the top of the neck, and that little
  // dark wedge is doing more work than its size suggests: without it the area
  // under a cap is a big smooth oval, and a big smooth oval on top of a body is
  // where a viewer starts looking for a face.
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

  if (style === 'long') longFall(ctx, cx, cy, rx, ry, hair, swing, size);
  else if (style === 'pony') ponytail(ctx, cx, cy, rx, ry, hair, swing, size);
  // A mullet is the one cut whose whole point is at the BACK, so it is the one
  // the camera angle flatters — and the one that most obviously used to be
  // missing, since every mullet in the collection arrived as "messy".
  else if (style === 'mullet') mullet(ctx, cx, cy, rx, ry, hair, swing, size);
  else if (style === 'bushy') bushy(ctx, cx, cy, rx, ry, hair, swing, size);
  else if (!hat && !capCol) tufts(ctx, cx, cy, rx, ry, hair, swing, size);

  // The sheen. It has to ride HIGH on the crown: sat anywhere near the middle of
  // the skull, three pale ovals on an egg read as eyes and a mouth — a face on
  // the back of the head, which is the exact thing this file exists to avoid.
  // Under a hat it is skipped outright rather than moved to the nape, where it
  // read as a chin.
  if (!hat && !capCol) sheen(ctx, cx, cy - ry * 0.56, rx, ry, hair, 0.85);

  // ------------------------------------------------------------------ hat
  // A cap comes a long way DOWN the skull from behind — most of what you see of
  // someone's head is the cap. Sat higher it perches like a bowler and leaves a
  // big blank oval of hair under it, which is exactly the featureless area that
  // invites the eye to read a face into it.
  if (worn === 'durag') {
    drawHat(ctx, cx, cy, rx, ry, hat || capCol, size, 0.42, true, skull, hair);
  } else if (worn === 'brim') {
    wideBrim(ctx, cx, cy, rx, ry, capCol, size, skull, hair);
  } else if (worn === 'helmet') {
    helmet(ctx, cx, cy, rx, ry, capCol, size, skull);
  } else if (worn === 'visor') {
    visor(ctx, cx, cy, rx, ry, capCol, size, skull);
  } else if (worn === 'horns') {
    horns(ctx, cx, cy, rx, ry, capCol, size);
  } else if (capCol) {
    drawHat(ctx, cx, cy, rx, ry, capCol, size, 0.26, false, skull, hair);
  }

  // -------------------------------------------------------------- bandana
  if (rig.bandana) bandana(ctx, cx, cy, rx, ry, rig.bandana, swing, size);

  // Temple arms of a pair of shades, hooking over the ears.
  if (rig.shades) {
    ctx.strokeStyle = rig.shades;
    ctx.lineWidth = Math.max(1, size * 0.026);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * rx * 0.84, cy + ry * 0.06);
      ctx.lineTo(cx + s * rx * 0.99, cy + ry * 0.22);
      ctx.stroke();
    }
  }
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
 * The broken highlight arc anime hair always has. Three wedges with gaps rather
 * than one continuous band — a solid band reads as a plastic wig, and the gaps
 * are what make it look like separated strands catching the sky.
 */
function sheen(ctx, cx, cy, rx, ry, hair, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hair.light;
  const w = rx * 0.30, h = ry * 0.13;
  for (const [ox, k] of [[-0.46, 0.72], [0.02, 1], [0.50, 0.62]]) {
    ctx.beginPath();
    ctx.ellipse(cx + rx * ox, cy + Math.abs(ox) * ry * 0.16,
      w * k, h * k, -ox * 0.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A cap or a beanie, from behind: a dome over the crown, a hard shadow where it
 * meets the hair, the closure arch at the centre back, and the two corners of
 * the brim just breaking the silhouette at the sides.
 *
 * `drop` is how far down the skull the hat comes (0 = mid-skull, like a cap;
 * 0.46 = over the ears, like a beanie).
 */
function drawHat(ctx, cx, cy, rx, ry, hat, size, drop, isBeanie, skull, hair) {
  const edge = cy + ry * drop;
  const dip = ry * 0.07;
  // The lower edge DIPS in the middle. A flat cut across the skull reads as a
  // bowl or a bike helmet; the dip is where a cap's closure sits, and it is the
  // whole difference between "cap" and "haircut" at this size.
  const dome = (p, g) => {
    p.moveTo(cx - rx * 1.04 - g, edge - dip);
    p.bezierCurveTo(cx - rx * 1.08 - g, cy - ry * 1.30 - g,
      cx + rx * 1.08 + g, cy - ry * 1.30 - g, cx + rx * 1.04 + g, edge - dip);
    p.quadraticCurveTo(cx, edge + dip * 1.5 + g, cx - rx * 1.04 - g, edge - dip);
    p.closePath();
  };

  // Hard shadow cast onto the hair just under the hat's edge. This is the value
  // break that stops a dark cap on dark hair reading as one blob.
  if (skull) {
    ctx.save();
    ctx.beginPath();
    skull(ctx, 0);
    ctx.clip();
    ctx.fillStyle = 'rgba(20,11,30,0.32)';
    ctx.beginPath();
    ctx.moveTo(cx - rx * 1.1, edge - dip);
    ctx.quadraticCurveTo(cx, edge + dip * 1.5, cx + rx * 1.1, edge - dip);
    ctx.lineTo(cx + rx * 1.1, edge + ry * 0.26);
    ctx.quadraticCurveTo(cx, edge + ry * 0.26 + dip * 1.5, cx - rx * 1.1, edge + ry * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Brim, seen from directly behind: it points away from us, so all that clears
  // the skull is a flat sliver at each side. Drawn BEFORE the dome so it tucks
  // under, and kept flat and high — round and low it sits exactly where an ear
  // would be, and the head grows Mickey Mouse ears.
  if (!isBeanie) {
    ctx.fillStyle = hat.dark;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * rx * 1.02, edge - ry * 0.20, rx * 0.34, ry * 0.085,
        s * 0.20, 0, TAU);
      ctx.fill();
    }
  }

  cel(ctx, dome, hat, size);

  // Hair breaking out under the cap's edge at the sides. Two small tufts, and
  // they matter out of all proportion to their size: without them the cap is a
  // clean arc laid over a clean egg and the join reads as moulded plastic.
  if (!isBeanie && hair) {
    ctx.fillStyle = hair.base;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * rx * 0.58, edge + ry * 0.02);
      ctx.quadraticCurveTo(cx + s * rx * 0.98, edge + ry * 0.04,
        cx + s * rx * 0.90, edge + ry * 0.26);
      ctx.quadraticCurveTo(cx + s * rx * 0.80, edge + ry * 0.08,
        cx + s * rx * 0.58, edge + ry * 0.02);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (isBeanie) {
    // Knit ribbing, following the curve of the skull.
    ctx.save();
    ctx.beginPath();
    dome(ctx, 0);
    ctx.clip();
    ctx.strokeStyle = withA(hat.dark, 0.5);
    ctx.lineWidth = Math.max(0.7, size * 0.014);
    for (let i = -3; i <= 3; i++) {
      const x = cx + i * rx * 0.27;
      ctx.beginPath();
      ctx.moveTo(x, cy - ry * 1.0);
      ctx.quadraticCurveTo(x + i * rx * 0.03, cy, x, edge);
      ctx.stroke();
    }
    ctx.restore();
    // Rolled brim: a BAND at the beanie's edge, not a disc. Filled with
    // hat.light at ry*0.20 it came out as a pale ellipse covering the entire
    // lower head — a giant lip across the face side of the skull. It only needs
    // to be a thicker rim of the same wool, with one light catch on top of it.
    ctx.fillStyle = hat.base;
    ctx.beginPath();
    ctx.ellipse(cx, edge - ry * 0.06, rx * 1.07, ry * 0.11, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = withA(hat.light, 0.55);
    ctx.beginPath();
    ctx.ellipse(cx, edge - ry * 0.10, rx * 1.02, ry * 0.045, 0, 0, TAU);
    ctx.fill();
    return;
  }

  // The collection's script mark across the crown. Not legible at any size the
  // game runs at, and not meant to be — it is one light stroke on the largest
  // dark shape in the figure, which is what stops the cap reading as a helmet.
  // Kept HIGH on the dome: the same mark lower down becomes a mouth.
  if (size > 60) {
    ctx.strokeStyle = withA(hat.light, 0.85);
    ctx.lineWidth = Math.max(1, size * 0.018);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const my = cy - ry * 0.44;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.40, my + ry * 0.06);
    ctx.bezierCurveTo(cx - rx * 0.30, my - ry * 0.20, cx - rx * 0.06, my - ry * 0.14,
      cx - rx * 0.10, my + ry * 0.08);
    ctx.bezierCurveTo(cx - rx * 0.02, my - ry * 0.10, cx + rx * 0.20, my - ry * 0.08,
      cx + rx * 0.16, my + ry * 0.07);
    ctx.bezierCurveTo(cx + rx * 0.26, my - ry * 0.04, cx + rx * 0.38, my - ry * 0.02,
      cx + rx * 0.44, my + ry * 0.02);
    ctx.stroke();
  }

  // Nothing else goes on the cap.
  //
  // A closure arch, a strap and a crown button were all tried. Every one of them
  // lands under 4px on a phone, and at that size a pale horizontal mark across
  // the middle of a dark oval does not read as a strap — it reads as a MOUTH,
  // and the two brim blobs beside it become eyes. The back of the head grew a
  // face, which is the one failure this whole file exists to avoid. Dome, edge
  // shadow, brim slivers. Three shapes, and it reads.
}

function longFall(ctx, cx, cy, rx, ry, hair, swing, size) {
  // Reaches the shoulder blades, not the waist. Scaled off the skull it used to
  // run to 2.0 ry, which on the chibi head is most of the torso — the figure
  // came out as a coloured slab with feet.
  const build = (p) => {
    p.moveTo(cx - rx * 0.97, cy);
    p.quadraticCurveTo(cx - rx * 1.06 + swing * size, cy + ry * 0.95,
      cx - rx * 0.62 + swing * size, cy + ry * 1.34);
    p.quadraticCurveTo(cx, cy + ry * 1.50, cx + rx * 0.62 + swing * size, cy + ry * 1.34);
    p.quadraticCurveTo(cx + rx * 1.06 + swing * size, cy + ry * 0.95,
      cx + rx * 0.97, cy);
    p.closePath();
  };
  cel(ctx, build, hair, size);
  ctx.strokeStyle = hair.dark;
  ctx.lineWidth = Math.max(1, size * 0.018);
  ctx.beginPath();
  ctx.moveTo(cx, cy + ry * 0.55);
  ctx.lineTo(cx + swing * size * 0.6, cy + ry * 1.30);
  ctx.stroke();
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
 * 'messy' — a tufted silhouette. Lobes ride the crown to break the outline up,
 * but they have to TAPER toward the sides: equal-sized lobes at the ends of the
 * arc sit exactly where ears would be and the head reads as wearing two buns.
 * Small, many, and smallest at the extremes.
 */
function tufts(ctx, cx, cy, rx, ry, hair, swing, size) {
  ctx.fillStyle = hair.base;
  const N = 11;
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const a = -Math.PI * 0.88 + k * Math.PI * 0.76;
    const taper = Math.sin(k * Math.PI);
    const r = rx * (0.07 + 0.11 * taper) * (0.75 + ((i * 37) % 7) / 12);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * rx * 0.9, cy + Math.sin(a) * ry * 0.9,
      r, r * 0.9, a, 0, TAU);
    ctx.fill();
  }
  // A couple of loose strands lifting off the crown in the slipstream.
  ctx.strokeStyle = hair.base;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.8, rx * 0.055);
  for (let i = 0; i < 3; i++) {
    const bx = cx + (i - 1) * rx * 0.34;
    ctx.beginPath();
    ctx.moveTo(bx, cy - ry * 0.86);
    ctx.quadraticCurveTo(
      bx - swing * size * 1.4 - rx * 0.1, cy - ry * 1.12,
      bx - swing * size * 2.4 - rx * 0.24, cy - ry * 1.05);
    ctx.stroke();
  }
}

/**
 * 'mullet' — short and tight over the crown, then a curtain down the nape that
 * flares past the jaw. Business in front, and the front is the half nobody
 * playing this game will ever see, so the whole trait lives or dies on the
 * curtain.
 *
 * It stops well above where longFall() ends. That gap is the read: a mullet
 * that reaches the shoulders is just long hair, and the collection has both.
 */
function mullet(ctx, cx, cy, rx, ry, hair, swing, size) {
  const sway = swing * size * 0.5;
  const build = (p, g) => {
    p.moveTo(cx - rx * 0.88 - g, cy + ry * 0.10);
    // out and DOWN past the jaw, wider than the skull at its widest
    p.bezierCurveTo(cx - rx * 1.10 - g, cy + ry * 0.72,
      cx - rx * 0.86 - g + sway, cy + ry * 1.28 + g,
      cx - rx * 0.30 + sway, cy + ry * 1.44 + g);
    p.quadraticCurveTo(cx + sway, cy + ry * 1.52 + g,
      cx + rx * 0.30 + sway, cy + ry * 1.44 + g);
    p.bezierCurveTo(cx + rx * 0.86 + g + sway, cy + ry * 1.28 + g,
      cx + rx * 1.10 + g, cy + ry * 0.72,
      cx + rx * 0.88 + g, cy + ry * 0.10);
    p.quadraticCurveTo(cx, cy + ry * 0.40, cx - rx * 0.88 - g, cy + ry * 0.10);
    p.closePath();
  };
  cel(ctx, build, hair, size);

  // Three cut lines down the curtain. Without them it is one flat shape the
  // width of the head and reads as a hood.
  ctx.save();
  ctx.beginPath();
  build(ctx, 0);
  ctx.clip();
  ctx.strokeStyle = withA(hair.dark, 0.55);
  ctx.lineWidth = Math.max(0.8, size * 0.014);
  for (let i = -1; i <= 1; i++) {
    const x = cx + i * rx * 0.42;
    ctx.beginPath();
    ctx.moveTo(x, cy + ry * 0.24);
    ctx.quadraticCurveTo(x + sway * 0.6, cy + ry * 0.9, x + sway, cy + ry * 1.44);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 'bushy' — the same crown as messy but grown OUT, so the silhouette is bigger
 * than the skull all the way round rather than tufted along the top.
 */
function bushy(ctx, cx, cy, rx, ry, hair, swing, size) {
  const build = (p, g) => {
    p.moveTo(cx - rx * 1.18 - g, cy + ry * 0.18);
    p.bezierCurveTo(cx - rx * 1.30 - g, cy - ry * 1.34 - g,
      cx + rx * 1.30 + g, cy - ry * 1.34 - g, cx + rx * 1.18 + g, cy + ry * 0.18);
    p.quadraticCurveTo(cx, cy + ry * 0.62 + g, cx - rx * 1.18 - g, cy + ry * 0.18);
    p.closePath();
  };
  cel(ctx, build, hair, size);
  // Lobes around the outside so the edge is not one clean arc.
  ctx.fillStyle = hair.base;
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = -Math.PI * 0.95 + (i / (N - 1)) * Math.PI * 0.9;
    const r = rx * (0.14 + 0.05 * Math.sin(i * 2.1));
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * rx * 1.14, cy + Math.sin(a) * ry * 1.14,
      r, r * 0.92, a, 0, TAU);
    ctx.fill();
  }
  sheen(ctx, cx, cy - ry * 0.72, rx * 1.1, ry, hair, 0.7);
}

/**
 * A wide brim — the mariachi and cowboy hats.
 *
 * This is the silhouette the whole trait pass was for. From behind, a brim
 * that clears the skull on both sides is the single most distinctive thing a
 * head can be wearing, and it is unmistakably NOT a baseball cap, which is what
 * every one of these used to render as.
 *
 * Order matters: brim first so the crown sits on top of it, and the brim is an
 * ellipse seen nearly edge-on rather than a circle — the camera is behind and
 * slightly above, so a full disc reads as a halo.
 */
function wideBrim(ctx, cx, cy, rx, ry, hat, size, skull, hair) {
  // Sat high enough that whatever hair the Primo has still shows below it. A
  // brim at the ear line hides a mullet completely, and #2664 is a Mariachi Hat
  // over a Mullet Brown — losing one of the two traits to the other is only
  // half a fix.
  const brimY = cy + ry * 0.20;

  // Hair escaping under the brim, drawn before it so the brim overlaps.
  if (hair) {
    ctx.fillStyle = hair.base;
    ctx.beginPath();
    ctx.ellipse(cx, brimY + ry * 0.16, rx * 0.90, ry * 0.42, 0, 0, TAU);
    ctx.fill();
  }

  // The brim. Keylined by drawing a larger dark copy under a smaller body copy,
  // the same two-fill trick the rest of the file uses instead of stroking.
  // 1.48, not 1.72. A brim only has to CLEAR the skull to read as a brim, and
  // past about one and a half head-widths it stops looking like a hat and starts
  // looking like a lampshade — the runner is 0.52u wide and the hat was ending
  // up wider than their shoulders.
  const g = Math.max(1, size * 0.012);
  ctx.fillStyle = hat.dark;
  ctx.beginPath();
  ctx.ellipse(cx, brimY, rx * 1.48 + g, ry * 0.34 + g, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = hat.base;
  ctx.beginPath();
  ctx.ellipse(cx, brimY, rx * 1.48, ry * 0.34, 0, 0, TAU);
  ctx.fill();
  // Sun catching the top surface of the brim. Kept WEAK: `hat.light` is mixed
  // toward the sky colour, and laid across the whole brim at half alpha it
  // turned a black charro hat lavender — the biggest shape in the silhouette
  // taking the sky's hue reads as the hat being that colour, not as light on it.
  ctx.fillStyle = withA(hat.light, 0.26);
  ctx.beginPath();
  ctx.ellipse(cx, brimY - ry * 0.09, rx * 1.30, ry * 0.17, 0, 0, TAU);
  ctx.fill();

  // Crown: shorter and rounder than a cap's dome, sitting ON the brim.
  const crown = (p, gg) => {
    p.moveTo(cx - rx * 0.84 - gg, brimY - ry * 0.06);
    p.bezierCurveTo(cx - rx * 0.92 - gg, cy - ry * 1.10 - gg,
      cx + rx * 0.92 + gg, cy - ry * 1.10 - gg, cx + rx * 0.84 + gg, brimY - ry * 0.06);
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
  ctx.fillRect(cx - rx * 1.1, brimY - ry * 0.34, rx * 2.2, ry * 0.26);
  ctx.restore();
}

/** Construction helmet: a smooth dome with a ridge and no brim behind. */
function helmet(ctx, cx, cy, rx, ry, hat, size, skull) {
  const edge = cy + ry * 0.22;
  const dome = (p, g) => {
    p.moveTo(cx - rx * 1.08 - g, edge);
    p.bezierCurveTo(cx - rx * 1.10 - g, cy - ry * 1.36 - g,
      cx + rx * 1.10 + g, cy - ry * 1.36 - g, cx + rx * 1.08 + g, edge);
    p.quadraticCurveTo(cx, edge + ry * 0.16 + g, cx - rx * 1.08 - g, edge);
    p.closePath();
  };
  cel(ctx, dome, hat, size);
  // The centre ridge, which is the only thing separating this from a bowl.
  ctx.save();
  ctx.beginPath();
  dome(ctx, 0);
  ctx.clip();
  ctx.fillStyle = withA(hat.light, 0.7);
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.5, rx * 0.13, ry * 1.0, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Poker visor: a band and a brim, and an open crown with the hair showing. */
function visor(ctx, cx, cy, rx, ry, hat, size, skull) {
  const y = cy - ry * 0.08;
  const g = Math.max(1, size * 0.012);
  ctx.fillStyle = hat.dark;
  ctx.beginPath();
  ctx.ellipse(cx, y + ry * 0.2, rx * 1.24 + g, ry * 0.22 + g, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = hat.base;
  ctx.beginPath();
  ctx.ellipse(cx, y + ry * 0.2, rx * 1.24, ry * 0.22, 0, 0, TAU);
  ctx.fill();
  // The band across the back of the skull, which is all a visor has up there.
  ctx.fillStyle = hat.base;
  ctx.beginPath();
  ctx.ellipse(cx, y, rx * 1.02, ry * 0.30, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = withA(hat.light, 0.5);
  ctx.fillRect(cx - rx * 0.9, y - ry * 0.12, rx * 1.8, ry * 0.07);
}

/** Horns. Two of them, off the crown, curving out and back. */
function horns(ctx, cx, cy, rx, ry, hat, size) {
  for (const s of [-1, 1]) {
    const bx = cx + s * rx * 0.62, by = cy - ry * 0.74;
    ctx.fillStyle = hat.dark;
    ctx.beginPath();
    ctx.moveTo(bx - s * rx * 0.16, by + ry * 0.10);
    ctx.quadraticCurveTo(bx + s * rx * 0.44, by - ry * 0.52,
      bx + s * rx * 0.30, by - ry * 0.96);
    ctx.quadraticCurveTo(bx + s * rx * 0.10, by - ry * 0.48, bx + s * rx * 0.14, by + ry * 0.10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = hat.base;
    ctx.beginPath();
    ctx.moveTo(bx - s * rx * 0.10, by + ry * 0.06);
    ctx.quadraticCurveTo(bx + s * rx * 0.36, by - ry * 0.50,
      bx + s * rx * 0.26, by - ry * 0.88);
    ctx.quadraticCurveTo(bx + s * rx * 0.08, by - ry * 0.44, bx + s * rx * 0.10, by + ry * 0.06);
    ctx.closePath();
    ctx.fill();
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

function hoops(ctx, cx, cy, rx, ry, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, rx * 0.075);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * rx * 0.97, cy + ry * 0.40, rx * 0.15, ry * 0.19, 0, 0, TAU);
    ctx.stroke();
  }
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

  const [h, s, l0] = rgb2hsl(parse(col));
  const l = Math.max(0.21, Math.min(0.54, l0));
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
