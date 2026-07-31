// Everything you collect, jump, slide under or eat pavement on.
// All draw calls take (ctx, sx, sy, u, obj, t): sy is the ground line at the
// prop's depth, u is pixels-per-world-unit there.

import { PAL, roundRect, hash01 } from './palette.js';

/** World-space size + how you're meant to survive each one. */
export const PROP_SPEC = {
  beer:       { w: 0.34, h: 0.50, y: 0.78, kind: 'pickup' },
  taco:       { w: 0.48, h: 0.34, y: 0.82, kind: 'pickup' },
  magnet:     { w: 0.56, h: 0.66, y: 0.92, kind: 'power' },
  chancla:    { w: 0.56, h: 0.44, y: 0.92, kind: 'power' },
  lowrider:   { w: 0.66, h: 0.40, y: 0.86, kind: 'power' },

  // Dodge props are deliberately taller than the jump apex (1.43u) so lane
  // changes are the only honest answer to them.
  checkpoint: { w: 0.96, h: 1.62, y: 0, kind: 'dodge' },
  border:     { w: 0.99, h: 2.60, y: 0, kind: 'dodge' },
  copcar:     { w: 0.98, h: 1.70, y: 0, kind: 'dodge' },

  dumpster:   { w: 0.88, h: 0.84, y: 0, kind: 'jump' },
  crates:     { w: 0.80, h: 0.62, y: 0, kind: 'jump' },
  cones:      { w: 0.86, h: 0.52, y: 0, kind: 'jump' },

  clothesline:{ w: 0.99, h: 1.30, y: 1.15, kind: 'slide' },
  awning:     { w: 0.99, h: 1.10, y: 1.12, kind: 'slide' },

  // ---- set dressing -------------------------------------------------------
  // Scenery, not gameplay. world.js pins every one of these to the gutters
  // outside the lanes (see DECOR_X_MIN there), so the hit test in game.collide
  // can never reach them. Two rules make that safe and they are load bearing:
  //
  //   * `w` stays at DECOR_HIT_W. It is ONLY a collision number, and the test
  //     is |o.x - p.x| > (o.w + HITBOX.w) * 0.5. Keeping it tiny keeps the
  //     required clearance tiny, which is what lets the ART be much wider than
  //     the lane gutter without ever widening the hitbox.
  //   * `y` stays 0. render.js mirrors PROP_SPEC.y in a local DEFAULT_Y table
  //     and returns 0 for anything it does not know about — a decor prop with
  //     a non-zero y would get lifted twice and float.
  //
  // `aw`/`ah` are the drawn footprint in world units. Nothing outside this
  // file reads them.
  junker:     { w: 0.20, h: 0.86, y: 0, kind: 'decor', aw: 0.88, ah: 0.86 },
  stall:      { w: 0.20, h: 1.55, y: 0, kind: 'decor', aw: 0.82, ah: 1.55 },
  pallets:    { w: 0.20, h: 0.72, y: 0, kind: 'decor', aw: 0.60, ah: 0.72 },
  bags:       { w: 0.20, h: 0.50, y: 0, kind: 'decor', aw: 0.62, ah: 0.50 },
  cart:       { w: 0.20, h: 0.72, y: 0, kind: 'decor', aw: 0.50, ah: 0.72 },
  drums:      { w: 0.20, h: 0.82, y: 0, kind: 'decor', aw: 0.62, ah: 0.82 },
  pigeons:    { w: 0.20, h: 0.24, y: 0, kind: 'decor', aw: 0.55, ah: 0.24 },
  cardboard:  { w: 0.20, h: 0.14, y: 0, kind: 'decor', aw: 0.75, ah: 0.14 },
  tyres:      { w: 0.20, h: 0.50, y: 0, kind: 'decor', aw: 0.52, ah: 0.50 },
  hydrant:    { w: 0.20, h: 0.62, y: 0, kind: 'decor', aw: 0.30, ah: 0.62 },
  plants:     { w: 0.20, h: 0.80, y: 0, kind: 'decor', aw: 0.50, ah: 0.80 },
  sign:       { w: 0.20, h: 1.25, y: 0, kind: 'decor', aw: 0.46, ah: 1.25 },
  mattress:   { w: 0.20, h: 0.95, y: 0, kind: 'decor', aw: 0.52, ah: 0.95 },
};

/** Collision width shared by every decor spec. Read by world.js. */
export const DECOR_HIT_W = 0.20;

/**
 * Contact shadow. Two ellipses, not one: a wide soft pool for the ambient
 * occlusion and a tight near-black core right under the base. The core is what
 * stops a prop reading as pasted on — a single soft ellipse leaves the silhouette
 * hovering a few pixels above its own shadow at every distance.
 */
export function shadow(ctx, sx, sy, u, w) {
  const rx = w * u * 0.62;
  ctx.fillStyle = 'rgba(18,8,22,0.26)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, rx * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(9,3,13,0.5)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx * 0.6, rx * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
}

// --------------------------------------------------------- affordance language
//
// A player has to read what a prop DEMANDS of them before they can read what it
// IS, so every gameplay prop obeys one lighting rule keyed off `kind`:
//
//   'jump'   THE LIGHT IS ON TOP. The highest plane of the prop is the
//            brightest thing on it (`litTop`) and the body ramps down to
//            near-black where it meets the asphalt. The silhouette ends in a
//            wide flat lit plane. Reads: the bright edge is the edge you clear.
//
//   'slide'  THE LIGHT IS ON THE BOTTOM. The same sentence inverted — a dark
//            band with a lit hem under it (`litHem`), sitting exactly on the
//            bottom of the hitbox, and nothing at all below it. Reads: the
//            bright edge is the edge you duck under.
//
//   'dodge'  NO WARM LIGHT, AND NOWHERE TO LAND. Highlights are cold, the
//            asphalt underneath carries a cold flasher spill (`coldSpill`) and
//            a footing wider than the prop (`plinth`), and the silhouette
//            terminates in lamps, masts and points — never in a flat plane.
//            Warm rim = your body gets past this. Cold rim = it does not.
//            These are the three props that kill a player who guesses.
//
//   pickup / power
//            Bright core, halo and a dark keyline — a pure glow-and-colour read
//            dissolves the instant the background goes from asphalt to sunlit
//            stucco — plus a warm pool of spill on the asphalt directly below.
//            At distance that pool is the only thing that says which LANE the
//            item is in, and lane is the decision the player actually makes.
//
// It is a lighting rule rather than a badge or an arrow on purpose. The runner
// is heading into a low sun, so a warm rim is only what the sun does and a cold
// rim is only what a flasher does; this has to survive being looked at, not
// just parsed. Set dressing sits deliberately outside the language — its
// highlight (`SUN`, further down) is dimmer and less saturated than anything
// here, which is what keeps the gutters from competing with the lane.

const TAU = Math.PI * 2;

const WARM_CAP = 'rgba(255,238,196,0.95)';  // sun landing flat on a top plane
const WARM_LIP = 'rgba(255,172,84,0.92)';   // the round-over just under it
const COLD_RIM = 'rgba(176,214,255,0.85)';  // flasher light, never the sun
const HEM_LIT = 'rgba(255,226,168,0.92)';
const HEM_DARK = 'rgba(11,4,18,0.66)';

/**
 * Jump rule. (x, y) is the top-left of the prop's highest plane, `w` its width,
 * `th` how thick to paint it. Two bands and not one: the cream cap is the plane
 * catching the sun and the amber lip under it is the round-over. Without that
 * second band the cap reads as a sticker laid on top of the prop.
 */
export function litTop(ctx, x, y, w, th) {
  ctx.fillStyle = WARM_CAP;
  ctx.fillRect(x, y, w, th);
  ctx.fillStyle = WARM_LIP;
  ctx.fillRect(x, y + th, w, th * 0.8);
}

/**
 * Slide rule. `y` is the BOTTOM of the hitbox — the exact line the player has
 * to get under — so the dark band stacks above it and the lit hem sits on it.
 */
export function litHem(ctx, x, y, w, th) {
  ctx.fillStyle = HEM_DARK;
  ctx.fillRect(x, y - th * 3, w, th * 3);
  ctx.fillStyle = HEM_LIT;
  ctx.fillRect(x, y - th, w, th);
}

// Flasher spill on the asphalt, pre-baked: red beat, blue beat, and a steady
// cold bounce for the one dodge prop with no lights of its own.
const SPILL = ['rgba(255,72,72,0.22)', 'rgba(88,124,255,0.22)', 'rgba(126,166,224,0.15)'];

/** Dodge rule, light half. Screen space, so call it before shadow(). */
export function coldSpill(ctx, sx, sy, w, tone) {
  ctx.fillStyle = SPILL[tone];
  ctx.beginPath();
  ctx.ellipse(sx, sy, w * 1.2, w * 0.34, 0, 0, TAU);
  ctx.fill();
}

/**
 * Dodge rule, mass half. A footing wider than the prop with a cold lip on it —
 * the thing is bolted down and the base has to say so. Called in the prop's own
 * translated space, so (0,0) is where it meets the road.
 */
export function plinth(ctx, u, w) {
  const th = Math.max(2, u * 0.085);
  ctx.fillStyle = '#17141f';
  ctx.fillRect(-w * 0.62, -th, w * 1.24, th);
  ctx.fillStyle = 'rgba(150,192,244,0.34)';
  ctx.fillRect(-w * 0.62, -th, w * 1.24, th * 0.26);
}

/**
 * Three flat discs instead of a createRadialGradient per pickup per frame. At
 * the size a pickup is drawn the banding is invisible, and it costs three fills
 * and no allocation at all.
 */
function halo(ctx, r, cols) {
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = cols[i];
    ctx.beginPath();
    ctx.arc(0, 0, r * (1 - i * 0.27), 0, TAU);
    ctx.fill();
  }
}

/**
 * Four-point glint behind a pickup. One path, and it is what still says
 * "collect me" at the distance where the shape itself has stopped being legible.
 */
function glint(ctx, r, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * (Math.PI / 4);
    const q = i % 2 ? r * 0.13 : r;
    ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q);
  }
  ctx.closePath();
  ctx.fill();
}

/** Warm spill on the asphalt under a floating pickup: which lane is it in? */
function pool(ctx, sx, sy, r, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.3, 0, 0, TAU);
  ctx.fill();
}

const HALO_BEER = ['rgba(255,178,40,0.14)', 'rgba(255,206,84,0.17)', 'rgba(255,238,176,0.24)'];
const HALO_TACO = ['rgba(150,220,70,0.14)', 'rgba(198,238,98,0.17)', 'rgba(242,255,186,0.24)'];
const POOL_BEER = 'rgba(255,196,86,0.20)';
const POOL_TACO = 'rgba(176,232,96,0.20)';
const GLINT_COL = 'rgba(255,244,210,0.5)';

// ------------------------------------------------------------------- pickups

export function drawBeer(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.beer;
  const bob = Math.sin(t * 3.2 + seed) * 0.06 * u;
  const spin = Math.abs(Math.cos(t * 2.6 + seed));
  // Squash floored at 0.66: below that the bottle turns into a stick, and it
  // does it at exactly the moment the silhouette is all the player has.
  const w = s.w * u * (0.66 + spin * 0.34);
  const h = s.h * u;
  const cy = sy - s.y * u + bob;

  pool(ctx, sx, sy, s.w * u * 0.8, POOL_BEER);

  ctx.save();
  ctx.translate(sx, cy);
  halo(ctx, h * 1.05, HALO_BEER);
  ctx.save();
  ctx.rotate(t * 0.45 + seed);
  ctx.globalAlpha *= 0.55 + Math.sin(t * 4 + seed) * 0.25;
  glint(ctx, h * 1.2, GLINT_COL);
  ctx.restore();

  // Dark keyline under everything, as one squared-off path so it costs a single
  // fill. Only a pixel or two of it survives around the rounded shapes on top,
  // which is the point: the bottle has to hold its edge against a SUNLIT wall
  // as well as against asphalt, and glow alone only does the second one.
  ctx.fillStyle = '#180a04';
  ctx.beginPath();
  ctx.rect(-w * 0.56, -h * 0.56, w * 1.12, h * 1.12);
  ctx.rect(-w * 0.22, -h * 0.78, w * 0.44, h * 0.3);
  ctx.rect(-w * 0.26, -h * 0.88, w * 0.52, h * 0.2);
  ctx.fill();

  // amber bottle
  ctx.fillStyle = '#a9631a';
  roundRect(ctx, -w / 2, -h * 0.5, w, h, w * 0.28);
  ctx.fill();
  ctx.fillStyle = '#e59a34';
  roundRect(ctx, -w * 0.36, -h * 0.42, w * 0.3, h * 0.7, w * 0.16);
  ctx.fill();
  // neck + cap
  ctx.fillStyle = '#8d4f13';
  ctx.fillRect(-w * 0.16, -h * 0.72, w * 0.32, h * 0.26);
  ctx.fillStyle = PAL.gold;
  roundRect(ctx, -w * 0.2, -h * 0.84, w * 0.4, h * 0.16, w * 0.06);
  ctx.fill();
  // Label: the brightest value on the prop and a full-width horizontal bar, so
  // a distant beer is a pale dash on a dark stick rather than an amber smudge.
  ctx.fillStyle = '#fbf3e2';
  ctx.fillRect(-w * 0.5, -h * 0.16, w, h * 0.38);
  ctx.fillStyle = '#12782f';
  ctx.fillRect(-w * 0.5, -h * 0.08, w, h * 0.07);
  ctx.fillStyle = '#c1272d';
  ctx.fillRect(-w * 0.5, h * 0.1, w, h * 0.07);
  // sun catching the shoulder of the glass
  ctx.fillStyle = WARM_CAP;
  ctx.fillRect(-w * 0.5, -h * 0.5, w, h * 0.05);

  ctx.restore();
}

export function drawTaco(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.taco;
  const bob = Math.sin(t * 2.7 + seed) * 0.07 * u;
  const w = s.w * u, h = s.h * u;
  const cy = sy - s.y * u + bob;

  pool(ctx, sx, sy, s.w * u * 0.6, POOL_TACO);

  ctx.save();
  ctx.translate(sx, cy);
  halo(ctx, w * 1.0, HALO_TACO);
  ctx.save();
  ctx.rotate(-t * 0.4 + seed);
  ctx.globalAlpha *= 0.55 + Math.sin(t * 4.4 + seed) * 0.25;
  glint(ctx, w * 1.15, GLINT_COL);
  ctx.restore();
  ctx.rotate(Math.sin(t * 1.7 + seed) * 0.18);

  // Keyline: an inflated copy of the shell wedge, drawn first. The shell is the
  // whole silhouette, so one dark outline is the entire separation budget.
  ctx.fillStyle = '#25110a';
  ctx.beginPath();
  ctx.moveTo(-w * 0.56, -h * 0.38);
  ctx.quadraticCurveTo(0, h * 0.96, w * 0.56, -h * 0.38);
  ctx.quadraticCurveTo(0, h * 0.1, -w * 0.56, -h * 0.38);
  ctx.closePath();
  ctx.fill();

  // filling first so it pokes out of the shell
  ctx.fillStyle = '#7a3f1e';
  roundRect(ctx, -w * 0.42, -h * 0.28, w * 0.84, h * 0.5, h * 0.18);
  ctx.fill();
  ctx.fillStyle = PAL.lime;
  roundRect(ctx, -w * 0.4, -h * 0.36, w * 0.8, h * 0.2, h * 0.08);
  ctx.fill();
  ctx.fillStyle = '#e0483c';
  ctx.fillRect(-w * 0.24, -h * 0.3, w * 0.12, h * 0.24);
  ctx.fillRect(w * 0.08, -h * 0.26, w * 0.1, h * 0.2);

  // folded shell
  ctx.fillStyle = '#f7bf49';
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.82, w * 0.5, -h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.2, -w * 0.5, -h * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#b9741f';
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.82, w * 0.5, -h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.52, -w * 0.5, -h * 0.3);
  ctx.closePath();
  ctx.fill();
  // sun on the top fold — a bright rail across the widest part of the shape
  ctx.fillStyle = WARM_CAP;
  ctx.fillRect(-w * 0.46, -h * 0.36, w * 0.92, h * 0.07);

  ctx.restore();
}

// ------------------------------------------------------------------ powerups

export function drawPowerup(ctx, sx, sy, u, type, t, seed = 0) {
  const s = PROP_SPEC[type] || PROP_SPEC.magnet;
  const bob = Math.sin(t * 3 + seed) * 0.08 * u;
  const cy = sy - s.y * u + bob;
  const w = s.w * u, h = s.h * u;
  const tint = type === 'magnet' ? PAL.hotPink : type === 'chancla' ? PAL.gold : '#4dd8ff';
  const spill = type === 'magnet' ? 'rgba(255,77,157,0.20)'
    : type === 'chancla' ? 'rgba(255,201,60,0.20)' : 'rgba(77,216,255,0.20)';

  pool(ctx, sx, sy, w * 0.95, spill);

  ctx.save();
  ctx.translate(sx, cy);

  // Dark plate first. A powerup is the one thing on screen that has to read
  // against BOTH the asphalt and a sunlit stucco wall, and a coloured disc only
  // wins the first of those — the keyline behind it wins the second.
  ctx.fillStyle = 'rgba(16,7,24,0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, w * 1.06, 0, TAU);
  ctx.fill();

  // Flat disc of colour behind the icon. A ring alone leaves the shape fighting
  // the alley for contrast; a solid plate wins that fight at any distance.
  ctx.globalAlpha = 0.3 + Math.sin(t * 6 + seed) * 0.08;
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(0, 0, w * 1.02, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.8 + Math.sin(t * 6 + seed) * 0.2;
  ctx.strokeStyle = tint;
  ctx.lineWidth = Math.max(1.8, u * 0.055);
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.9, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.rotate(Math.sin(t * 2 + seed) * 0.22);

  if (type === 'magnet') {
    // piñata star: dark keyline, then two frills. Three was mush at small sizes.
    const r = w * 0.54;
    const star = (rr, ri) => {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const q = k % 2 ? ri : rr;
        ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q);
      }
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = '#2a0f22';
    star(r * 1.1, r * 0.62);
    ctx.fillStyle = '#ff4d9d';
    star(r, r * 0.55);
    ctx.fillStyle = '#ffc93c';
    star(r * 0.62, r * 0.3);
    ctx.fillStyle = '#28c3b8';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'chancla') {
    // la chancla, keylined so the sole reads against the asphalt
    ctx.fillStyle = '#1a1024';
    roundRect(ctx, -w * 0.55, -h * 0.28, w * 1.1, h * 0.66, h * 0.26);
    ctx.fill();
    ctx.fillStyle = '#6a4bf0';
    roundRect(ctx, -w * 0.5, -h * 0.22, w, h * 0.44, h * 0.2);
    ctx.fill();
    ctx.fillStyle = '#3a2894';
    roundRect(ctx, -w * 0.5, h * 0.1, w, h * 0.2, h * 0.09);
    ctx.fill();
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -h * 0.12);
    ctx.quadraticCurveTo(0, -h * 0.44, w * 0.28, -h * 0.12);
    ctx.quadraticCurveTo(0, -h * 0.28, -w * 0.3, -h * 0.12);
    ctx.closePath();
    ctx.fill();
  } else {
    // lowrider board, hopping on its hydraulics
    ctx.fillStyle = '#12081c';
    roundRect(ctx, -w * 0.54, -h * 0.24, w * 1.08, h * 0.56, h * 0.2);
    ctx.fill();
    ctx.fillStyle = '#a82547';
    roundRect(ctx, -w * 0.5, -h * 0.2, w, h * 0.46, h * 0.18);
    ctx.fill();
    ctx.fillStyle = '#f4e6c8';
    ctx.fillRect(-w * 0.5, -h * 0.06, w, h * 0.08);
    ctx.fillStyle = PAL.gold;
    for (const wx of [-w * 0.28, w * 0.28]) {
      ctx.beginPath();
      ctx.arc(wx, h * 0.3, h * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(77,216,255,0.55)';
    ctx.fillRect(-w * 0.44, h * 0.42, w * 0.88, h * 0.09);
  }
  ctx.restore();
}

// ----------------------------------------------------------------- obstacles

/**
 * Police checkpoint. A `dodge` prop, so: cold light only, a solid skirt instead
 * of an open frame, a plinth, and a silhouette that ends in a flashing light
 * bar rather than a flat plank.
 *
 * The old art topped out at 0.88h, which is 1.43u — the jump apex, almost to
 * the pixel. It looked exactly as tall as the thing a player can clear while
 * actually being taller, which is the single worst thing this prop could do.
 * The sign now carries the silhouette to the full height of the hitbox.
 */
export function drawCheckpoint(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.checkpoint;
  const w = s.w * u, h = s.h * u;
  const flash = Math.floor(t * 6 + seed) % 2 === 0;
  coldSpill(ctx, sx, sy, w, flash ? 0 : 1);
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);

  // Solid dark skirt behind the frame. An open A-frame reads as light and
  // liftable; filling the lower body with mass is most of what turns this from
  // "hop it" into "go around it".
  ctx.fillStyle = '#221d2c';
  ctx.fillRect(-w * 0.46, -h * 0.62, w * 0.92, h * 0.62);
  ctx.fillStyle = COLD_RIM;
  ctx.fillRect(-w * 0.46, -h * 0.62, w * 0.035, h * 0.62);

  // legs in front of the skirt, then the footing they are bolted to
  ctx.fillStyle = '#4a4650';
  ctx.fillRect(-w * 0.44, -h * 0.7, w * 0.08, h * 0.7);
  ctx.fillRect(w * 0.36, -h * 0.7, w * 0.08, h * 0.7);
  plinth(ctx, u, w);

  // striped barricade plank
  const py = -h * 0.62, ph = h * 0.22;
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(-w * 0.5, py, w, ph);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w * 0.5, py, w, ph);
  ctx.clip();
  ctx.fillStyle = '#e03a2f';
  const step = w * 0.2;
  for (let x = -w * 0.7; x < w * 0.7; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, py + ph);
    ctx.lineTo(x + step * 0.5, py + ph);
    ctx.lineTo(x + step * 0.5 + ph * 0.8, py);
    ctx.lineTo(x + ph * 0.8, py);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#1a1722';
  ctx.lineWidth = Math.max(1, u * 0.025);
  ctx.strokeRect(-w * 0.5, py, w, ph);

  // masts up to the sign — the vertical run is what stops the plank reading as
  // the top of the object
  ctx.fillStyle = '#3a3644';
  ctx.fillRect(-w * 0.3, -h * 0.72, w * 0.07, h * 0.16);
  ctx.fillRect(w * 0.23, -h * 0.72, w * 0.07, h * 0.16);

  // sign board, carried up to the full hitbox height
  const qy = -h * 0.98, qh = h * 0.26;
  ctx.fillStyle = '#0c1233';
  ctx.fillRect(-w * 0.54, qy - h * 0.02, w * 1.08, qh + h * 0.04);
  ctx.fillStyle = '#1d3fb8';
  ctx.fillRect(-w * 0.5, qy, w, qh);
  ctx.fillStyle = COLD_RIM;
  ctx.fillRect(-w * 0.5, qy, w, qh * 0.09);
  if (u > 30) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.floor(qh * 0.62)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RETÉN', 0, qy + qh * 0.56);
  }

  // Light bar riding the top. Both lamps are always present and they trade
  // brightness — a bar that only exists on the bright beat flickers out of the
  // silhouette half the time, which is the half you needed it.
  const ly = -h * 1.1, lh = h * 0.1;
  ctx.fillStyle = '#241f2e';
  ctx.fillRect(-w * 0.28, ly - h * 0.015, w * 0.56, lh + h * 0.03);
  ctx.fillStyle = flash ? PAL.copRed : '#4d1218';
  ctx.fillRect(-w * 0.26, ly, w * 0.26, lh);
  ctx.fillStyle = flash ? '#141a4a' : '#3f60ff';
  ctx.fillRect(0, ly, w * 0.26, lh);
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = flash ? PAL.copRed : '#3f60ff';
  ctx.beginPath();
  ctx.arc(flash ? -w * 0.13 : w * 0.13, ly + lh * 0.5, h * 0.26, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  // a cone for flavour, with a collar bright enough to see
  ctx.fillStyle = '#e8622a';
  ctx.beginPath();
  ctx.moveTo(w * 0.52, 0);
  ctx.lineTo(w * 0.64, -h * 0.34);
  ctx.lineTo(w * 0.76, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fbf7ec';
  ctx.fillRect(w * 0.555, -h * 0.21, w * 0.17, h * 0.06);

  ctx.restore();
}

/**
 * Border wall: rusted steel bollards, too tall to jump. Go around.
 *
 * A `dodge` prop, so the highlight down each bollard is cold and the tops are
 * cut to points. A flat capping rail is a ledge, and a ledge is an invitation —
 * the whole job of this silhouette is to have nowhere to land on it.
 */
export function drawBorderWall(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.border;
  const w = s.w * u, h = s.h * u;
  coldSpill(ctx, sx, sy, w, 2);
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);

  const slats = 7;
  const gap = w / slats;
  const tip = h * 0.05;
  // Dark backing panel: the gaps between bollards are where the alley shows
  // through, and a lit wall behind them dissolves the whole silhouette.
  ctx.fillStyle = 'rgba(14,8,20,0.6)';
  ctx.fillRect(-w * 0.5, -h, w, h);
  for (let i = 0; i < slats; i++) {
    const x = -w * 0.5 + i * gap;
    const shade = 0.72 + hash01(seed * 31 + i) * 0.28;
    ctx.fillStyle = `rgb(${Math.floor(138 * shade)},${Math.floor(90 * shade)},${Math.floor(59 * shade)})`;
    ctx.fillRect(x, -h, gap * 0.72, h);
    // rust bloom near the base
    ctx.fillStyle = 'rgba(60,28,16,0.4)';
    ctx.fillRect(x, -h * 0.22, gap * 0.72, h * 0.22);
  }
  // Cold edge down every bollard, batched into one path. This is the rim that
  // separates a dark rusted fence from a dark alley, and it is deliberately the
  // colour of a flasher rather than of the sunset behind the runner.
  ctx.fillStyle = COLD_RIM;
  ctx.beginPath();
  for (let i = 0; i < slats; i++) {
    ctx.rect(-w * 0.5 + i * gap, -h, gap * 0.16, h);
  }
  ctx.fill();

  // Pointed tips, one path. Nothing to stand on.
  ctx.fillStyle = '#726b74';
  ctx.beginPath();
  for (let i = 0; i < slats; i++) {
    const x = -w * 0.5 + i * gap;
    ctx.moveTo(x, -h);
    ctx.lineTo(x + gap * 0.36, -h - tip);
    ctx.lineTo(x + gap * 0.72, -h);
    ctx.closePath();
  }
  ctx.fill();

  // capping rail, tucked under the tips
  ctx.fillStyle = '#4c4a51';
  ctx.fillRect(-w * 0.53, -h, w * 1.06, u * 0.08);
  ctx.fillStyle = 'rgba(150,192,244,0.4)';
  ctx.fillRect(-w * 0.53, -h, w * 1.06, u * 0.022);

  // concrete footing, and the plinth it is cast into
  ctx.fillStyle = '#6f6a72';
  ctx.fillRect(-w * 0.53, -h * 0.08, w * 1.06, h * 0.08);
  plinth(ctx, u, w);

  ctx.restore();
}

/**
 * Parked cruiser. A `dodge` prop, and the hardest of the three to sell: at
 * 1.70u it is only a quarter of a unit over the jump apex, so the roof is the
 * one plane in this game that genuinely looks landable and is not. The light
 * bar and the whip antenna above it exist to break that plane.
 */
export function drawCopCar(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.copcar;
  const w = s.w * u, h = s.h * u;
  const flash = Math.floor(t * 7 + seed) % 2 === 0;
  coldSpill(ctx, sx, sy, w, flash ? 0 : 1);
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);

  // body (rear three-quarter, we're coming up behind it)
  ctx.fillStyle = '#e8e6e2';
  roundRect(ctx, -w * 0.5, -h * 0.62, w, h * 0.62, w * 0.1);
  ctx.fill();
  ctx.fillStyle = PAL.cop;
  ctx.fillRect(-w * 0.5, -h * 0.42, w, h * 0.2);
  // cabin
  ctx.fillStyle = '#cfd4da';
  roundRect(ctx, -w * 0.36, -h * 0.94, w * 0.72, h * 0.36, w * 0.08);
  ctx.fill();
  ctx.fillStyle = '#22303f';
  roundRect(ctx, -w * 0.3, -h * 0.88, w * 0.6, h * 0.24, w * 0.05);
  ctx.fill();
  // cold rim along the roof and the shoulder line
  ctx.fillStyle = COLD_RIM;
  ctx.fillRect(-w * 0.36, -h * 0.94, w * 0.72, h * 0.03);
  ctx.fillRect(-w * 0.5, -h * 0.62, w, h * 0.025);

  // whip antenna, then the light bar: the silhouette must not end flat
  ctx.fillStyle = '#141119';
  ctx.fillRect(w * 0.3, -h * 1.24, Math.max(1, u * 0.018), h * 0.3);
  const ly = -h * 1.06, lh = h * 0.12;
  ctx.fillStyle = '#1d1a24';
  ctx.fillRect(-w * 0.33, ly - h * 0.015, w * 0.66, lh + h * 0.03);
  ctx.fillStyle = flash ? PAL.copRed : '#4a1418';
  ctx.fillRect(-w * 0.31, ly, w * 0.3, lh);
  ctx.fillStyle = flash ? '#141a44' : '#3f60ff';
  ctx.fillRect(w * 0.01, ly, w * 0.3, lh);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = flash ? PAL.copRed : '#3f60ff';
  ctx.beginPath();
  ctx.arc(flash ? -w * 0.16 : w * 0.16, ly + lh * 0.5, h * 0.3, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  // tail lights + tyres
  ctx.fillStyle = '#ff5a3c';
  ctx.fillRect(-w * 0.46, -h * 0.3, w * 0.14, h * 0.08);
  ctx.fillRect(w * 0.32, -h * 0.3, w * 0.14, h * 0.08);
  // dark well under the sills, then the tyres sitting down in it
  ctx.fillStyle = 'rgba(8,3,14,0.6)';
  ctx.fillRect(-w * 0.5, -h * 0.16, w, h * 0.16);
  ctx.fillStyle = '#1a1a1f';
  ctx.fillRect(-w * 0.52, -h * 0.18, w * 0.16, h * 0.18);
  ctx.fillRect(w * 0.36, -h * 0.18, w * 0.16, h * 0.18);

  ctx.restore();
}

/**
 * Dumpster. A `jump` prop, so it is built as a value ramp: near-black where it
 * touches the asphalt, mid green through the body, and the lid on top is the
 * brightest thing on the object. The lid was propped up at 1.2h before, which
 * put the top of the silhouette on a diagonal — a wide flat lit plane is what
 * says "clear this", so it is barely cracked open now.
 */
export function drawDumpster(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.dumpster;
  const w = s.w * u, h = s.h * u;
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = '#1c4530';
  roundRect(ctx, -w * 0.5, -h, w, h, w * 0.05);
  ctx.fill();
  ctx.fillStyle = '#2f6b46';
  ctx.fillRect(-w * 0.5, -h, w, h * 0.62);
  ctx.fillStyle = '#3d8558';
  ctx.fillRect(-w * 0.5, -h, w, h * 0.22);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-w * 0.5, -h * 0.5, w, h * 0.04);

  // Lid, barely cracked, running the full width. Its top edge is dead level so
  // the lit cap can sit flat on it — a sloped top edge leaves the bright bar
  // floating off the art at one end.
  ctx.fillStyle = '#245038';
  ctx.beginPath();
  ctx.moveTo(-w * 0.54, -h);
  ctx.lineTo(-w * 0.3, -h * 1.09);
  ctx.lineTo(w * 0.54, -h * 1.09);
  ctx.lineTo(w * 0.54, -h);
  ctx.closePath();
  ctx.fill();
  // the plane you clear
  litTop(ctx, -w * 0.3, -h * 1.09, w * 0.84, Math.max(1.5, h * 0.045));

  ctx.fillStyle = '#4a4550';
  ctx.beginPath();
  ctx.ellipse(w * 0.42, -h * 0.14, w * 0.16, h * 0.16, 0, 0, TAU);
  ctx.fill();
  // dark contact band, then the wheels standing in it
  ctx.fillStyle = 'rgba(6,2,10,0.55)';
  ctx.fillRect(-w * 0.5, -h * 0.11, w, h * 0.11);
  ctx.fillStyle = '#1a1a1f';
  ctx.fillRect(-w * 0.42, -h * 0.12, w * 0.11, h * 0.12);
  ctx.fillRect(w * 0.31, -h * 0.12, w * 0.11, h * 0.12);
  ctx.restore();
}

/**
 * Mercado crates: a pallet base and a squat pyramid, not a wobbling tower.
 * The stack is authored so the silhouette is a wide flat-topped block — that
 * shape says "jump me" at fifty metres, where a thin tower reads as a post.
 */
export function drawCrates(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.crates;
  const w = s.w * u, h = s.h * u;
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);

  // pallet the whole stack sits on — kills any hint of floating
  ctx.fillStyle = '#4a3320';
  ctx.fillRect(-w * 0.5, -h * 0.16, w, h * 0.16);
  ctx.fillStyle = '#7a5330';
  ctx.fillRect(-w * 0.5, -h * 0.16, w, h * 0.05);

  const crate = (cx, cy, cw, ch, hue) => {
    ctx.fillStyle = hue;
    ctx.fillRect(cx - cw * 0.5, cy - ch, cw, ch);
    // top face: the bright plane that separates one crate from the next
    ctx.fillStyle = 'rgba(255,214,150,0.55)';
    ctx.fillRect(cx - cw * 0.5, cy - ch, cw, ch * 0.16);
    // shadowed underside
    ctx.fillStyle = 'rgba(24,12,8,0.45)';
    ctx.fillRect(cx - cw * 0.5, cy - ch * 0.16, cw, ch * 0.16);
    if (u > 26) {
      // two slat gaps, nothing more — the read is the block, not the joinery
      ctx.fillStyle = 'rgba(40,20,10,0.34)';
      ctx.fillRect(cx - cw * 0.5, cy - ch * 0.66, cw, ch * 0.08);
      ctx.fillRect(cx - cw * 0.5, cy - ch * 0.40, cw, ch * 0.08);
    }
  };

  const jitter = (hash01(seed * 3.1) - 0.5) * w * 0.1;
  const lo = h * 0.42;
  // Lower crates knocked back so the stack ramps dark-at-the-road to bright-on-
  // top rather than sitting at one value.
  crate(-w * 0.24 + jitter, -h * 0.14, w * 0.5, lo, '#8a4520');
  crate(w * 0.25 + jitter, -h * 0.14, w * 0.48, lo * 0.86, '#a1682a');
  crate(jitter * 0.4, -h * 0.14 - lo, w * 0.46, lo * 0.9, '#c9762f');
  // The plane you clear, spanning the whole top of the silhouette.
  litTop(ctx, jitter * 0.4 - w * 0.23, -h * 0.14 - lo * 1.9, w * 0.46,
    Math.max(1.5, h * 0.05));

  // a couple of chiles spilling over the lip, at close range only
  if (u > 34) {
    ctx.fillStyle = '#d8402f';
    ctx.beginPath();
    ctx.ellipse(jitter * 0.4 - w * 0.1, -h * 0.14 - lo * 1.9, w * 0.07, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e2a52f';
    ctx.beginPath();
    ctx.ellipse(jitter * 0.4 + w * 0.09, -h * 0.14 - lo * 1.88, w * 0.06, h * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawCones(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.cones;
  const w = s.w * u, h = s.h * u;
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);

  // One low bar tying the three cones together. Three loose triangles read as
  // three separate things; a taped-off run reads as one obstacle.
  //
  // The bar is also where the jump rule lands on this prop: a cone ends in a
  // point, so there is no top plane to light, and the tape is the only
  // horizontal in the shape. Lighting it gives the run the flat bright edge
  // that every other jumpable gets from its own lid.
  ctx.fillStyle = '#221c28';
  ctx.fillRect(-w * 0.48, -h * 0.5, w * 0.96, h * 0.11);
  ctx.fillStyle = '#f2c53a';
  ctx.fillRect(-w * 0.48, -h * 0.47, w * 0.96, h * 0.06);

  // Batched by colour: one path per layer of the three cones rather than five
  // fills each. Same picture, a third of the paint calls, and this prop is
  // drawn three-wide in a lot of chunks.
  const cx0 = -w * 0.32, cx1 = 0, cx2 = w * 0.32;
  const h0 = h * (0.82 + hash01(seed - 1) * 0.26);
  const h1 = h * (0.82 + hash01(seed) * 0.26);
  const h2 = h * (0.82 + hash01(seed + 1) * 0.26);

  // square base slabs first — a bare triangle has no footprint
  ctx.fillStyle = '#8f3413';
  ctx.beginPath();
  for (const cx of [cx0, cx1, cx2]) ctx.rect(cx - w * 0.2, -h * 0.1, w * 0.4, h * 0.1);
  ctx.fill();
  ctx.fillStyle = '#c24d1e';
  ctx.beginPath();
  for (const cx of [cx0, cx1, cx2]) ctx.rect(cx - w * 0.2, -h * 0.13, w * 0.4, h * 0.05);
  ctx.fill();

  // baseLeft, apexRight, baseRight — apexLeft is always -0.03.
  const body = (cx, ch, xa, xb, xc) => {
    ctx.moveTo(cx + xa * w, -h * 0.09);
    ctx.lineTo(cx - w * 0.03, -ch);
    ctx.lineTo(cx + xb * w, -ch);
    ctx.lineTo(cx + xc * w, -h * 0.09);
    ctx.closePath();
  };
  ctx.fillStyle = '#ef6a26';
  ctx.beginPath();
  body(cx0, h0, -0.16, 0.03, 0.16);
  body(cx1, h1, -0.16, 0.03, 0.16);
  body(cx2, h2, -0.16, 0.03, 0.16);
  ctx.fill();
  // sun-side edge
  ctx.fillStyle = 'rgba(255,214,150,0.5)';
  ctx.beginPath();
  body(cx0, h0, -0.16, 0.005, -0.1);
  body(cx1, h1, -0.16, 0.005, -0.1);
  body(cx2, h2, -0.16, 0.005, -0.1);
  ctx.fill();
  // reflective collars
  ctx.fillStyle = '#fbf7ec';
  ctx.beginPath();
  ctx.rect(cx0 - w * 0.11, -h0 * 0.66, w * 0.22, h0 * 0.17);
  ctx.rect(cx1 - w * 0.11, -h1 * 0.66, w * 0.22, h1 * 0.17);
  ctx.rect(cx2 - w * 0.11, -h2 * 0.66, w * 0.22, h2 * 0.17);
  ctx.fill();

  // Tape strung across the FRONT of the run, drawn last. This is where the jump
  // rule lands on this prop: a cone ends in a point, so there is no top plane to
  // catch the sun, and the tape is the only horizontal in the shape. Lighting it
  // gives the run the one flat bright edge every other jumpable gets from a lid.
  litTop(ctx, -w * 0.48, -h * 0.5, w * 0.96, Math.max(1.4, h * 0.05));
  ctx.restore();
}

/**
 * Laundry strung across the alley — duck it.
 *
 * The garments are drawn as one continuous curtain of flat shapes, and the hem
 * running the full width is the whole point: it is a single hard horizontal
 * edge at the bottom of the hitbox, which is the line the player actually reads
 * when deciding to slide. It used to be a dark bar alone, which is a mid-dark
 * line on a mid-dark alley — `litHem` makes it dark-over-bright, so it holds
 * whichever way the background goes.
 */
export function drawClothesline(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.clothesline;
  const w = s.w * u;
  const yTop = sy - (s.y + s.h) * u;
  const yBot = sy - s.y * u;
  const span = yBot - yTop;
  ctx.save();
  ctx.translate(sx, 0);

  // the line itself
  ctx.strokeStyle = '#241c28';
  ctx.lineWidth = Math.max(1.4, u * 0.03);
  ctx.beginPath();
  ctx.moveTo(-w * 0.58, yTop + u * 0.04);
  ctx.quadraticCurveTo(0, yTop + u * 0.18, w * 0.58, yTop + u * 0.04);
  ctx.stroke();

  const cloth = ['#e8547f', '#3fa8c4', '#f0c649', '#7fc85c', '#e6dfd0', '#7b5cff'];
  for (let i = 0; i < 4; i++) {
    const gx = -w * 0.375 + i * w * 0.25;
    const gw = w * 0.23;
    const sway = Math.sin(t * 1.5 + i * 1.7 + seed) * u * 0.035;
    // Hems land in the bottom 6% of the span so the lit bar below always has
    // cloth touching it. A garment stopping short leaves that bar hanging in
    // mid-air, and a bright line with nothing attached reads as an overlay.
    const drop = span * (0.94 + hash01(seed * 5 + i) * 0.06);
    const col = cloth[(i + Math.floor(seed * 3)) % cloth.length];

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(gx - gw * 0.5 + sway, yTop + u * 0.1);
    ctx.lineTo(gx + gw * 0.5 + sway, yTop + u * 0.1);
    ctx.lineTo(gx + gw * 0.46 + sway * 2.2, yTop + drop);
    ctx.lineTo(gx - gw * 0.46 + sway * 2.2, yTop + drop);
    ctx.closePath();
    ctx.fill();
    // fold shadow down one side so each garment has volume without detail
    ctx.fillStyle = 'rgba(24,10,32,0.3)';
    ctx.beginPath();
    ctx.moveTo(gx + gw * 0.16 + sway, yTop + u * 0.1);
    ctx.lineTo(gx + gw * 0.5 + sway, yTop + u * 0.1);
    ctx.lineTo(gx + gw * 0.46 + sway * 2.2, yTop + drop);
    ctx.lineTo(gx + gw * 0.14 + sway * 2.2, yTop + drop);
    ctx.closePath();
    ctx.fill();
    // shoulder shadow under the line
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(gx - gw * 0.5 + sway, yTop + u * 0.1, gw, u * 0.05);
  }

  // The one hard edge, on the bottom of the hitbox: dark band, lit hem under it.
  litHem(ctx, -w * 0.52, yBot, w * 1.04, Math.max(1.4, u * 0.045));
  ctx.restore();
}

/** Taqueria awning hanging low — duck it. */
export function drawAwning(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.awning;
  const w = s.w * u;
  const yTop = sy - (s.y + s.h) * u;
  const yBot = sy - s.y * u;
  const span = yBot - yTop;
  ctx.save();
  ctx.translate(sx, 0);

  // Valance box along the top so the canvas has something to hang off.
  ctx.fillStyle = '#3a2b34';
  ctx.fillRect(-w * 0.54, yTop - u * 0.07, w * 1.08, u * 0.08);

  const stripes = 5;
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#d8402f' : '#f2ead8';
    ctx.beginPath();
    ctx.moveTo(-w * 0.5 + i * sw, yTop);
    ctx.lineTo(-w * 0.5 + (i + 1) * sw, yTop);
    ctx.lineTo(-w * 0.55 + (i + 1) * sw * 1.1, yBot - span * 0.14);
    ctx.lineTo(-w * 0.55 + i * sw * 1.1, yBot - span * 0.14);
    ctx.closePath();
    ctx.fill();
  }

  // Underside in shadow — the awning is above you and you are looking up into
  // it, so the plane you actually see most of is the dark one.
  ctx.fillStyle = 'rgba(30,14,34,0.42)';
  ctx.fillRect(-w * 0.55, yTop, w * 1.1, span * 0.22);

  // Scalloped hem: the silhouette that says "duck", cut as flat triangles.
  //
  // The teeth are pale rather than dark red, which is the slide rule — the sun
  // rakes in under an awning, so the fringe is the one part of it lit from
  // below, and that is exactly the edge the player has to get under. A dark
  // scallop on a dark alley is a shape nobody can find in time.
  const teeth = 6;
  const tw = (w * 1.1) / teeth;
  ctx.fillStyle = 'rgba(16,6,22,0.55)';
  ctx.fillRect(-w * 0.55, yBot - span * 0.22, w * 1.1, span * 0.08);
  ctx.fillStyle = '#ffe0a4';
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const x0 = -w * 0.55 + i * tw;
    ctx.moveTo(x0, yBot - span * 0.16);
    ctx.lineTo(x0 + tw, yBot - span * 0.16);
    ctx.lineTo(x0 + tw * 0.5, yBot);
    ctx.closePath();
  }
  ctx.fill();
  // the flat run the teeth hang off, so the hem still reads as one hard line
  ctx.fillStyle = '#c8501f';
  ctx.fillRect(-w * 0.55, yBot - span * 0.16, w * 1.1, span * 0.04);

  if (u > 40) {
    ctx.fillStyle = '#f7ecd6';
    ctx.font = `700 ${Math.floor(u * 0.12)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('TAQUERIA', 0, yTop - u * 0.005);
  }
  ctx.restore();
}

// ------------------------------------------------------------- set dressing
//
// Streamed past the runner by world.js, always in the gutters, never in a lane.
// Rules for everything below:
//
//   * Flat fills only. No gradients, no strokes where a rect will do — these
//     run 25-30 deep every frame on top of the walls.
//   * A contact shadow and a base that sits ON the asphalt. A floating crate
//     is worse than no crate.
//   * Fine detail lives behind a `u > n` gate, so distant dressing costs three
//     or four fills and near dressing earns its extra ones.
//
// Colours are pre-baked per wall: index 0 is the sunlit left wall, index 1 the
// shadowed right one. Building tints per frame would allocate a string per
// prop per frame, which is exactly the kind of churn this renderer cannot pay.
const DEC = {
  rust:   ['#8f4d2f', '#5b3222'],
  rustHi: ['#c07a45', '#7d4a30'],
  steel:  ['#7a7684', '#4c4855'],
  steelHi:['#a8a3b2', '#6a6575'],
  wood:   ['#a06b38', '#6b4526'],
  woodHi: ['#c99154', '#8a5e34'],
  sack:   ['#332e3d', '#211d2a'],
  sackHi: ['#4e4759', '#332e3d'],
  card:   ['#a37a4a', '#6d5133'],
  canvasA:['#d8402f', '#93281f'],
  canvasB:['#f2ead8', '#a79c8c'],
  leaf:   ['#5aa04e', '#3a6b36'],
  cool:   ['#5a6f92', '#3c4b64'],
};
const SUN = 'rgba(255,206,142,0.5)';
const DARK = 'rgba(14,6,20,0.45)';

/** Rusted beater parked nose-in against the wall. */
export function drawJunker(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.junker, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.92);
  ctx.save();
  ctx.translate(sx, sy);
  if (o.x > 0) ctx.scale(-1, 1);

  const beat = hash01(o.seed * 7.3) > 0.5;
  ctx.fillStyle = beat ? DEC.rust[k] : DEC.cool[k];
  roundRect(ctx, -w * 0.5, -h * 0.66, w, h * 0.58, w * 0.09);
  ctx.fill();
  ctx.fillStyle = beat ? DEC.rustHi[k] : DEC.steel[k];
  roundRect(ctx, -w * 0.34, -h, w * 0.68, h * 0.42, w * 0.08);
  ctx.fill();
  ctx.fillStyle = '#141822';
  roundRect(ctx, -w * 0.28, -h * 0.95, w * 0.56, h * 0.3, w * 0.05);
  ctx.fill();

  // sun catching the roof and the shoulder line — the read at distance
  ctx.fillStyle = SUN;
  ctx.fillRect(-w * 0.34, -h, w * 0.68, h * 0.05);
  ctx.fillRect(-w * 0.5, -h * 0.66, w, h * 0.045);
  // rocker shadow, then wheels sitting in it
  ctx.fillStyle = DARK;
  ctx.fillRect(-w * 0.5, -h * 0.14, w, h * 0.1);
  ctx.fillStyle = '#15121a';
  ctx.fillRect(-w * 0.46, -h * 0.17, w * 0.17, h * 0.17);
  ctx.fillRect(w * 0.29, -h * 0.17, w * 0.17, h * 0.17);

  if (u > 20) {
    // one mismatched door and a dead tail light: the whole "beater" story
    ctx.fillStyle = 'rgba(22,12,28,0.4)';
    ctx.fillRect(-w * 0.1, -h * 0.62, w * 0.24, h * 0.44);
    ctx.fillStyle = '#c2412f';
    ctx.fillRect(w * 0.3, -h * 0.46, w * 0.14, h * 0.09);
  }
  ctx.restore();
}

/** Puesto: trestle table under a striped canopy. */
export function drawStall(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.stall, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.8);
  ctx.save();
  ctx.translate(sx, sy);

  // poles first, so the canopy paints over their tops
  ctx.fillStyle = '#2b2430';
  ctx.fillRect(-w * 0.42, -h * 0.96, w * 0.055, h * 0.96);
  ctx.fillRect(w * 0.36, -h * 0.96, w * 0.055, h * 0.96);
  // table: dark well underneath, bright slab on top
  ctx.fillStyle = 'rgba(10,4,16,0.6)';
  ctx.fillRect(-w * 0.46, -h * 0.4, w * 0.92, h * 0.4);
  ctx.fillStyle = DEC.canvasB[k];
  ctx.fillRect(-w * 0.5, -h * 0.46, w, h * 0.07);
  ctx.fillStyle = DARK;
  ctx.fillRect(-w * 0.5, -h * 0.39, w, h * 0.035);

  // canopy: flat trapezoid, three stripes, scalloped hem
  const cy = -h;
  ctx.fillStyle = DEC.canvasA[k];
  ctx.beginPath();
  ctx.moveTo(-w * 0.4, cy);
  ctx.lineTo(w * 0.4, cy);
  ctx.lineTo(w * 0.52, cy + h * 0.16);
  ctx.lineTo(-w * 0.52, cy + h * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = DEC.canvasB[k];
  ctx.fillRect(-w * 0.5, cy + h * 0.055, w, h * 0.045);
  ctx.fillStyle = 'rgba(18,8,24,0.4)';
  ctx.fillRect(-w * 0.52, cy + h * 0.14, w * 1.04, h * 0.025);

  if (u > 18) {
    // crates of produce on the table — the reason anyone stops here
    ctx.fillStyle = DEC.wood[k];
    ctx.fillRect(-w * 0.4, -h * 0.62, w * 0.3, h * 0.17);
    ctx.fillRect(w * 0.06, -h * 0.6, w * 0.3, h * 0.15);
    ctx.fillStyle = DEC.leaf[k];
    ctx.fillRect(-w * 0.4, -h * 0.64, w * 0.3, h * 0.035);
    ctx.fillStyle = '#d8402f';
    ctx.fillRect(w * 0.06, -h * 0.62, w * 0.3, h * 0.032);
  }
  ctx.restore();
}

/** Pallets stacked in the gutter with one leaning off the pile. */
export function drawPallets(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.pallets, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.9);
  ctx.save();
  ctx.translate(sx, sy);
  if (o.x > 0) ctx.scale(-1, 1);

  const layers = 3 + Math.floor(hash01(o.seed * 2.7) * 2);
  const lh = h * 0.16;
  const ox = (i) => -w * 0.42 + (hash01(o.seed * 3 + i) - 0.5) * w * 0.14;
  // Bottom pallet's underside lands exactly on y=0 — offsetting the stack even
  // a fraction of a unit is what makes a prop read as hovering.
  const oy = (i) => -lh - lh * i * 1.06;
  for (let i = 0; i < layers; i++) {
    ctx.fillStyle = i % 2 ? DEC.wood[k] : DEC.woodHi[k];
    ctx.fillRect(ox(i), oy(i), w * 0.84, lh);
  }
  // The two overlays are one colour each, so they go down as one path apiece.
  ctx.fillStyle = DARK;
  ctx.beginPath();
  for (let i = 0; i < layers; i++) ctx.rect(ox(i), oy(i) + lh * 0.62, w * 0.84, lh * 0.38);
  ctx.fill();
  ctx.fillStyle = SUN;
  ctx.beginPath();
  for (let i = 0; i < layers; i++) ctx.rect(ox(i), oy(i), w * 0.84, lh * 0.16);
  ctx.fill();
  // one leaning against the stack, the shape that breaks the brick silhouette
  ctx.fillStyle = DEC.wood[k];
  ctx.beginPath();
  ctx.moveTo(w * 0.2, 0);
  ctx.lineTo(w * 0.5, 0);
  ctx.lineTo(w * 0.5, -h * 0.9);
  ctx.lineTo(w * 0.26, -h * 0.86);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(18,8,24,0.35)';
  ctx.fillRect(w * 0.2, -h * 0.06, w * 0.3, h * 0.06);
  ctx.restore();
}

/** Bin bags heaped where somebody gave up carrying them. */
export function drawBags(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.bags, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.9);
  ctx.save();
  ctx.translate(sx, sy);
  // Three bags, three colours, three paths — not nine fills. `moveTo` before
  // each ellipse or canvas joins the subpaths with a straight line and the
  // whole heap fills as one blob.
  const bx = (i) => (i - 1) * w * 0.26 + (hash01(o.seed * 4 + i) - 0.5) * w * 0.12;
  const br = (i) => h * (0.5 + hash01(o.seed * 6 + i) * 0.32);

  ctx.fillStyle = DEC.sack[k];
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const x = bx(i), r = br(i);
    ctx.moveTo(x + r * 0.72, -r * 0.82);
    ctx.ellipse(x, -r * 0.82, r * 0.72, r * 0.86, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  // knots
  ctx.fillStyle = DEC.sackHi[k];
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const x = bx(i), r = br(i);
    ctx.moveTo(x - r * 0.2, -r * 1.56);
    ctx.lineTo(x + r * 0.2, -r * 1.56);
    ctx.lineTo(x, -r * 1.92);
    ctx.closePath();
  }
  ctx.fill();
  // sheen streaks: plastic, not stone
  ctx.fillStyle = SUN;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const x = bx(i), r = br(i);
    ctx.moveTo(x - r * 0.28 + r * 0.2, -r * 1.14);
    ctx.ellipse(x - r * 0.28, -r * 1.14, r * 0.2, r * 0.3, 0.5, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

/** Abandoned shopping cart. */
export function drawCart(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.cart, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.9);
  ctx.save();
  ctx.translate(sx, sy);
  if (o.x > 0) ctx.scale(-1, 1);

  ctx.fillStyle = '#1a1620';
  ctx.fillRect(-w * 0.34, -h * 0.2, w * 0.09, h * 0.2);
  ctx.fillRect(w * 0.22, -h * 0.2, w * 0.09, h * 0.2);
  // basket: a wide flat wedge, wider at the top
  ctx.fillStyle = DEC.steel[k];
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.86);
  ctx.lineTo(w * 0.44, -h * 0.86);
  ctx.lineTo(w * 0.3, -h * 0.24);
  ctx.lineTo(-w * 0.34, -h * 0.24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(12,6,18,0.5)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.62);
  ctx.lineTo(w * 0.44, -h * 0.62);
  ctx.lineTo(w * 0.3, -h * 0.24);
  ctx.lineTo(-w * 0.34, -h * 0.24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = DEC.steelHi[k];
  ctx.fillRect(-w * 0.5, -h * 0.9, w * 0.94, h * 0.06);
  // handle
  ctx.fillStyle = '#c2412f';
  ctx.fillRect(-w * 0.5, -h, w * 0.06, h * 0.14);
  ctx.fillRect(-w * 0.5, -h, w * 0.3, h * 0.05);
  if (u > 26) {
    ctx.fillStyle = 'rgba(200,196,210,0.28)';
    for (let i = 1; i < 4; i++) {
      const gx = -w * 0.5 + (w * 0.94 * i) / 4;
      ctx.fillRect(gx, -h * 0.86, w * 0.025, h * 0.62);
    }
  }
  ctx.restore();
}

/** Oil drums — one standing, one on its side. */
export function drawDrums(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.drums, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.9);
  ctx.save();
  ctx.translate(sx, sy);
  if (o.x > 0) ctx.scale(-1, 1);

  // the one on its side, behind — resting ON the asphalt, not above it
  ctx.fillStyle = DEC.rust[k];
  roundRect(ctx, w * 0.02, -h * 0.32, w * 0.48, h * 0.32, h * 0.06);
  ctx.fill();
  ctx.fillStyle = DEC.rustHi[k];
  ctx.beginPath();
  ctx.ellipse(w * 0.06, -h * 0.16, w * 0.06, h * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  // the standing one
  const dw = w * 0.44, dh = h * 0.86;
  ctx.fillStyle = hash01(o.seed * 5.5) > 0.5 ? DEC.rust[k] : DEC.cool[k];
  ctx.fillRect(-w * 0.46, -dh, dw, dh);
  ctx.fillStyle = SUN;
  ctx.fillRect(-w * 0.46, -dh, dw * 0.22, dh);
  ctx.fillStyle = DEC.rustHi[k];
  ctx.beginPath();
  ctx.ellipse(-w * 0.46 + dw * 0.5, -dh, dw * 0.5, dh * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(16,7,22,0.42)';
  ctx.fillRect(-w * 0.46, -dh * 0.68, dw, dh * 0.06);
  ctx.fillRect(-w * 0.46, -dh * 0.34, dw, dh * 0.06);
  ctx.restore();
}

/** Pigeons working the gutter. One always looks up as you pass. */
export function drawPigeons(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.pigeons, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  ctx.save();
  ctx.translate(sx, sy);
  // One path per colour across all three birds: five fills for the flock
  // instead of five per bird. The middle one bobs.
  const bx = (i) => (i - 1) * w * 0.3 + (hash01(o.seed * 8 + i) - 0.5) * w * 0.16;
  const by = (i) => -h * 0.44 - (i === 1 ? Math.abs(Math.sin(t * 2.4 + o.seed)) * h * 0.28 : 0);

  ctx.fillStyle = 'rgba(10,4,14,0.4)';
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const x = bx(i);
    ctx.moveTo(x + w * 0.11, 0);
    ctx.ellipse(x, 0, w * 0.11, w * 0.035, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // body + tail wedge share a colour, so they share a path
  ctx.fillStyle = DEC.steel[k];
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const x = bx(i), y = by(i);
    ctx.moveTo(x + w * 0.13, y);
    ctx.ellipse(x, y, w * 0.13, h * 0.42, 0, 0, Math.PI * 2);
    ctx.moveTo(x + w * 0.06, y - h * 0.1);
    ctx.lineTo(x + w * 0.24, y + h * 0.16);
    ctx.lineTo(x + w * 0.06, y + h * 0.2);
    ctx.closePath();
  }
  ctx.fill();

  ctx.fillStyle = DEC.steelHi[k];
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const x = bx(i) - w * 0.11, y = by(i) - h * 0.44;
    ctx.moveTo(x + w * 0.075, y);
    ctx.arc(x, y, w * 0.075, 0, Math.PI * 2);
  }
  ctx.fill();

  if (u > 20) {
    ctx.fillStyle = PAL.gold;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const x = bx(i), y = by(i);
      ctx.moveTo(x - w * 0.17, y - h * 0.46);
      ctx.lineTo(x - w * 0.26, y - h * 0.38);
      ctx.lineTo(x - w * 0.16, y - h * 0.34);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.restore();
}

/** Flattened boxes gone soft in a puddle. Reads as a dark hole in the gutter. */
export function drawCardboard(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.cardboard, w = s.aw * u;
  const k = o.x < 0 ? 0 : 1;
  const d = w * 0.16;
  ctx.save();
  ctx.translate(sx, sy);
  // the wet patch the cardboard is soaking in
  ctx.fillStyle = 'rgba(12,6,20,0.5)';
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.55, d * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,168,110,0.16)';
  ctx.beginPath();
  ctx.ellipse(w * 0.1, -d * 0.1, w * 0.3, d * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // two sheets lying flat, drawn as squashed parallelograms
  ctx.fillStyle = DEC.card[k];
  ctx.beginPath();
  ctx.moveTo(-w * 0.46, -d * 0.1);
  ctx.lineTo(-w * 0.02, -d * 0.5);
  ctx.lineTo(w * 0.2, -d * 0.05);
  ctx.lineTo(-w * 0.24, d * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(18,9,24,0.4)';
  ctx.beginPath();
  ctx.moveTo(w * 0.02, -d * 0.12);
  ctx.lineTo(w * 0.44, -d * 0.42);
  ctx.lineTo(w * 0.5, d * 0.02);
  ctx.lineTo(w * 0.08, d * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Stack of bald tyres. */
export function drawTyres(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.tyres, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.9);
  ctx.save();
  ctx.translate(sx, sy);
  const n = 3;
  const th = h / n;
  const ty = (i) => -th * (i + 0.5) * 1.02;
  const tx = (i) => (hash01(o.seed * 9 + i) - 0.5) * w * 0.2;
  ctx.fillStyle = '#1d1a24';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    ctx.moveTo(tx(i) + w * 0.5, ty(i));
    ctx.ellipse(tx(i), ty(i), w * 0.5, th * 0.62, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = '#332e3c';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    ctx.moveTo(tx(i) + w * 0.46, ty(i) - th * 0.16);
    ctx.ellipse(tx(i), ty(i) - th * 0.16, w * 0.46, th * 0.5, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  // hollow top so the stack reads as rings, not a black lump
  ctx.fillStyle = '#0d0a12';
  ctx.beginPath();
  ctx.ellipse(0, -h * 1.0, w * 0.22, h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Fire hydrant. Tiny, but the strongest single value note in the gutter. */
export function drawHydrant(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.hydrant, w = s.aw * u, h = s.ah * u;
  shadow(ctx, sx, sy, u, s.aw * 1.3);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = '#5e1b16';
  ctx.fillRect(-w * 0.5, -h * 0.12, w, h * 0.12);
  ctx.fillStyle = '#c8392a';
  roundRect(ctx, -w * 0.34, -h * 0.86, w * 0.68, h * 0.76, w * 0.2);
  ctx.fill();
  // side nozzles + bonnet: the silhouette everyone recognises
  ctx.fillRect(-w * 0.5, -h * 0.62, w * 0.2, h * 0.16);
  ctx.fillRect(w * 0.3, -h * 0.62, w * 0.2, h * 0.16);
  ctx.beginPath();
  ctx.arc(0, -h * 0.86, w * 0.28, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = PAL.gold;
  ctx.fillRect(-w * 0.34, -h * 0.94, w * 0.68, h * 0.07);
  ctx.fillStyle = SUN;
  ctx.fillRect(-w * 0.3, -h * 0.8, w * 0.12, h * 0.62);
  ctx.restore();
}

/** Buckets of agave outside somebody's back door. */
export function drawPlants(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.plants, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.9);
  ctx.save();
  ctx.translate(sx, sy);
  // blades first so the pot rim cuts them off cleanly — one path, one fill
  ctx.fillStyle = DEC.leaf[k];
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.5 + (i - 2) * 0.34;
    const len = h * (0.5 + hash01(o.seed * 11 + i) * 0.34);
    const sw2 = Math.sin(t * 0.9 + o.seed + i) * w * 0.03;
    ctx.moveTo(-w * 0.1, -h * 0.34);
    ctx.lineTo(w * 0.1, -h * 0.34);
    ctx.lineTo(Math.cos(a) * len + sw2, -h * 0.34 + Math.sin(a) * len);
    ctx.closePath();
  }
  ctx.fill();
  // pot
  ctx.fillStyle = hash01(o.seed * 13) > 0.5 ? DEC.canvasB[k] : DEC.cool[k];
  ctx.beginPath();
  ctx.moveTo(-w * 0.34, -h * 0.42);
  ctx.lineTo(w * 0.34, -h * 0.42);
  ctx.lineTo(w * 0.24, 0);
  ctx.lineTo(-w * 0.24, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = DARK;
  ctx.fillRect(-w * 0.34, -h * 0.42, w * 0.68, h * 0.06);
  ctx.fillStyle = SUN;
  ctx.fillRect(-w * 0.32, -h * 0.36, w * 0.09, h * 0.34);
  ctx.restore();
}

/** Hand-painted signboard leaning where the shop stopped bothering. */
export function drawSign(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.sign, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.8);
  ctx.save();
  ctx.translate(sx, sy);
  if (o.x > 0) ctx.scale(-1, 1);
  ctx.rotate((hash01(o.seed * 17) - 0.5) * 0.14);

  ctx.fillStyle = '#2b2430';
  ctx.fillRect(-w * 0.07, -h, w * 0.14, h);
  const by = -h * 0.98, bh = h * 0.5;
  ctx.fillStyle = '#1a1220';
  ctx.fillRect(-w * 0.5, by, w, bh);
  ctx.fillStyle = hash01(o.seed * 19) > 0.5 ? DEC.canvasA[k] : DEC.cool[k];
  ctx.fillRect(-w * 0.44, by + bh * 0.08, w * 0.88, bh * 0.84);
  // two bars of "lettering" — flat blocks, no type, reads at any size
  ctx.fillStyle = DEC.canvasB[k];
  ctx.fillRect(-w * 0.34, by + bh * 0.24, w * 0.68, bh * 0.16);
  ctx.fillRect(-w * 0.34, by + bh * 0.52, w * 0.46, bh * 0.14);
  ctx.fillStyle = SUN;
  ctx.fillRect(-w * 0.5, by, w, bh * 0.06);
  ctx.restore();
}

/** Dumped mattress folded against the wall. */
export function drawMattress(ctx, sx, sy, u, o, t) {
  const s = PROP_SPEC.mattress, w = s.aw * u, h = s.ah * u;
  const k = o.x < 0 ? 0 : 1;
  shadow(ctx, sx, sy, u, s.aw * 0.95);
  ctx.save();
  ctx.translate(sx, sy);
  if (o.x > 0) ctx.scale(-1, 1);

  ctx.fillStyle = DEC.canvasB[k];
  ctx.beginPath();
  ctx.moveTo(-w * 0.44, 0);
  ctx.lineTo(w * 0.1, 0);
  ctx.lineTo(w * 0.5, -h);
  ctx.lineTo(-w * 0.06, -h * 0.94);
  ctx.closePath();
  ctx.fill();
  // shaded long edge gives the slab thickness
  ctx.fillStyle = 'rgba(20,10,28,0.4)';
  ctx.beginPath();
  ctx.moveTo(w * 0.1, 0);
  ctx.lineTo(w * 0.22, 0);
  ctx.lineTo(w * 0.5, -h);
  ctx.lineTo(w * 0.36, -h);
  ctx.closePath();
  ctx.fill();
  // two stripes and a stain: enough story, no noise
  ctx.fillStyle = 'rgba(58,42,80,0.5)';
  ctx.fillRect(-w * 0.34, -h * 0.66, w * 0.6, h * 0.045);
  ctx.fillRect(-w * 0.28, -h * 0.4, w * 0.6, h * 0.045);
  if (u > 24) {
    ctx.fillStyle = 'rgba(120,86,52,0.35)';
    ctx.beginPath();
    ctx.ellipse(w * 0.02, -h * 0.24, w * 0.16, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The cruiser bearing down on you from behind — drawn head-on, since we're
 * looking back down the alley at its grille.
 *
 * @param {number} closeness 0 (far) .. 1 (about to grab you)
 */
export function drawChaser(ctx, sx, sy, u, t, closeness) {
  const w = 1.5 * u, h = 1.25 * u;
  ctx.save();
  ctx.translate(sx, sy);

  // headlight wash on the asphalt
  const beam = ctx.createRadialGradient(0, -h * 0.3, 0, 0, -h * 0.3, w * 1.3);
  beam.addColorStop(0, `rgba(255,240,200,${0.16 + closeness * 0.3})`);
  beam.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = beam;
  ctx.fillRect(-w * 1.3, -h * 1.6, w * 2.6, h * 2.6);

  shadow(ctx, 0, 0, u, 1.5);

  // body
  ctx.fillStyle = '#eceae5';
  roundRect(ctx, -w * 0.5, -h * 0.7, w, h * 0.7, w * 0.08);
  ctx.fill();
  ctx.fillStyle = PAL.cop;
  ctx.fillRect(-w * 0.5, -h * 0.46, w, h * 0.22);
  // windshield
  ctx.fillStyle = '#cfd6de';
  roundRect(ctx, -w * 0.38, -h * 1.02, w * 0.76, h * 0.36, w * 0.06);
  ctx.fill();
  ctx.fillStyle = '#1e2b3a';
  roundRect(ctx, -w * 0.33, -h * 0.97, w * 0.66, h * 0.26, w * 0.04);
  ctx.fill();
  // grille + bumper
  ctx.fillStyle = '#2c2f36';
  ctx.fillRect(-w * 0.2, -h * 0.34, w * 0.4, h * 0.16);
  ctx.fillStyle = '#9aa0a8';
  ctx.fillRect(-w * 0.5, -h * 0.16, w, h * 0.1);
  // headlights
  const glow = 0.6 + Math.sin(t * 9) * 0.15;
  for (const hx of [-w * 0.36, w * 0.24]) {
    ctx.fillStyle = `rgba(255,246,214,${glow})`;
    roundRect(ctx, hx, -h * 0.38, w * 0.12, h * 0.12, w * 0.03);
    ctx.fill();
  }
  // light bar
  const flash = Math.floor(t * 8) % 2 === 0;
  ctx.fillStyle = flash ? PAL.copRed : '#4a1414';
  ctx.fillRect(-w * 0.3, -h * 1.14, w * 0.28, h * 0.11);
  ctx.fillStyle = flash ? '#3f60ff' : '#141a44';
  ctx.fillRect(w * 0.02, -h * 1.14, w * 0.28, h * 0.11);
  // siren halo grows as it closes
  ctx.globalAlpha = 0.18 + closeness * 0.3;
  ctx.fillStyle = flash ? PAL.copRed : '#3f60ff';
  ctx.beginPath();
  ctx.arc(flash ? -w * 0.16 : w * 0.16, -h * 1.1, h * (0.5 + closeness * 0.5), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (u > 40) {
    ctx.fillStyle = '#12224e';
    ctx.font = `700 ${Math.floor(h * 0.14)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('POLICÍA', 0, -h * 0.3);
  }
  ctx.restore();
}

export const PROP_DRAW = {
  beer: (c, x, y, u, o, t) => drawBeer(c, x, y, u, t, o.seed),
  taco: (c, x, y, u, o, t) => drawTaco(c, x, y, u, t, o.seed),
  magnet: (c, x, y, u, o, t) => drawPowerup(c, x, y, u, 'magnet', t, o.seed),
  chancla: (c, x, y, u, o, t) => drawPowerup(c, x, y, u, 'chancla', t, o.seed),
  lowrider: (c, x, y, u, o, t) => drawPowerup(c, x, y, u, 'lowrider', t, o.seed),
  checkpoint: (c, x, y, u, o, t) => drawCheckpoint(c, x, y, u, t, o.seed),
  border: (c, x, y, u, o, t) => drawBorderWall(c, x, y, u, t, o.seed),
  copcar: (c, x, y, u, o, t) => drawCopCar(c, x, y, u, t, o.seed),
  dumpster: (c, x, y, u, o, t) => drawDumpster(c, x, y, u, t, o.seed),
  crates: (c, x, y, u, o, t) => drawCrates(c, x, y, u, t, o.seed),
  cones: (c, x, y, u, o, t) => drawCones(c, x, y, u, t, o.seed),
  clothesline: (c, x, y, u, o, t) => drawClothesline(c, x, y, u, t, o.seed),
  awning: (c, x, y, u, o, t) => drawAwning(c, x, y, u, t, o.seed),

  // Set dressing already takes the (ctx, sx, sy, u, o, t) call shape, so it
  // goes in unwrapped.
  junker: drawJunker,
  stall: drawStall,
  pallets: drawPallets,
  bags: drawBags,
  cart: drawCart,
  drums: drawDrums,
  pigeons: drawPigeons,
  cardboard: drawCardboard,
  tyres: drawTyres,
  hydrant: drawHydrant,
  plants: drawPlants,
  sign: drawSign,
  mattress: drawMattress,
};

/** Every decor type, in one place so world.js does not have to guess. */
export const DECOR_TYPES = [
  'junker', 'stall', 'pallets', 'bags', 'cart', 'drums', 'pigeons',
  'cardboard', 'tyres', 'hydrant', 'plants', 'sign', 'mattress',
];
