// Rain-slicked asphalt: planar reflections, puddles and specular sheen.
//
// The reflection is a mirror of the frame about the horizon, drawn back into
// the road. That works because the alley floor IS a plane and the camera is
// essentially level, so reflecting the image vertically about the vanishing
// line is the correct projection, not an approximation of one. One drawImage
// buys reflections of every wall, mural, awning and neon sign at once — far
// cheaper than reflecting each piece of scenery individually, and it can never
// disagree with the thing it is reflecting.
//
// Everything else here exists to stop that mirror looking like a mirror:
// puddles mask it into patches, a depth fade kills it toward the horizon, and
// a little horizontal jitter stands in for surface ripple.

import { ALLEY_HALF, DRAW_DIST, FX } from '../config.js';
import { hash01 } from './palette.js';

// Reflection colours, as raw "r,g,b" so they can be dropped into rgba() with a
// computed alpha. These track the mural and neon palette on the walls.
const STREAK = [
  '255,77,157', '40,195,184', '255,201,60', '158,227,79',
  '123,92,255', '255,122,61', '255,220,180',
];

// Puddle field. Fixed in world space and scrolled past, so puddles hold still
// on the road instead of swimming with the camera.
const PUDDLES = [];
for (let i = 0; i < 46; i++) {
  const s = i * 7.3;
  PUDDLES.push({
    z: i * 5.4 + hash01(s) * 4.2,
    x: (hash01(s + 1) * 2 - 1) * (ALLEY_HALF - 0.5),
    w: 0.5 + hash01(s + 2) * 1.5,
    d: 1.4 + hash01(s + 3) * 3.4,
  });
}

/**
 * Reflect the alley's lights into the road as vertical streaks.
 *
 * Note on what this deliberately does NOT do: mirroring the whole frame about
 * the horizon is only correct for a *vertical* mirror. On a ground plane the
 * axis is the ground line at that depth, y = horizon + camY * scale(z), which
 * slides down the screen as z shortens — so a single flip reflects the sky into
 * the near road and leaves the walls beside you unreflected. Reflecting light
 * sources as streaks instead is both cheaper and closer to what a wet street
 * actually looks like: long smeared columns of colour under every lit thing,
 * because the ripple scatters each highlight along the view direction.
 *
 * Call AFTER the walls are on the canvas and BEFORE props and the runner.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Function} project world -> screen
 * @param {number} camZ
 * @param {number} W  css width
 * @param {number} H  css height
 * @param {number} horizon  y of the vanishing line, in css px
 * @param {number} t  game time, for shimmer
 */
export function drawWetReflection(ctx, project, camZ, W, H, horizon, t) {
  if (FX.wetness <= 0 || horizon <= 2) return;

  ctx.save();
  // Clip to the ROAD, not to "everything below the horizon". A full-width rect
  // also covers the walls, and any wash drawn into it lands across the whole
  // lower half of the frame as a hard horizontal band.
  if (!clipToRoad(ctx, project, camZ, W, H, horizon)) { ctx.restore(); return; }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const SEG = 4;
  const first = Math.floor((camZ + 2) / SEG) * SEG;

  for (let z = first; z < camZ + FX.puddleFade; z += SEG) {
    const dz = z - camZ;
    if (dz < 1.5) continue;
    const idx = Math.round(z / SEG);

    for (const side of [-1, 1]) {
      // Where this wall meets the road — the foot of the reflection.
      const base = project(side * ALLEY_HALF, 0, z);
      if (!base) continue;

      const seed = idx * (side < 0 ? 1.7 : 2.3) + (side < 0 ? 3 : 11);
      // Only some segments carry something bright enough to reflect.
      if (hash01(seed) > 0.55) continue;

      const col = STREAK[Math.floor(hash01(seed + 5) * STREAK.length) % STREAK.length];
      const near = 1 - dz / FX.puddleFade;
      const shimmer = 0.72 + Math.sin(t * 3 + idx) * 0.28;
      const len = (H - horizon) * (0.1 + near * 0.42) * (0.7 + hash01(seed + 2) * 0.6);
      const wdt = Math.max(2, base.scale * (0.18 + hash01(seed + 3) * 0.3));

      const g = ctx.createLinearGradient(0, base.y, 0, base.y + len);
      g.addColorStop(0, `rgba(${col},${0.3 * near * shimmer * FX.wetness})`);
      g.addColorStop(0.35, `rgba(${col},${0.14 * near * shimmer * FX.wetness})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      // Streaks lean toward the middle of the road, following the view ray.
      ctx.beginPath();
      ctx.moveTo(base.x - wdt * 0.5, base.y);
      ctx.lineTo(base.x + wdt * 0.5, base.y);
      ctx.lineTo(base.x + wdt * 1.4 - side * wdt * 1.2, base.y + len);
      ctx.lineTo(base.x - wdt * 1.4 - side * wdt * 1.2, base.y + len);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();          // drop 'lighter', keep the road clip

  fadeWithDepth(ctx, W, H, horizon);
  rippleBand(ctx, W, H, horizon, t);

  ctx.restore();          // drop the road clip
}

/**
 * Clip to the alley floor quad. Returns false when the road is off screen.
 * Uses a generous far edge so the clip always reaches the horizon exactly.
 */
function clipToRoad(ctx, project, camZ, W, H, horizon) {
  const far = camZ + DRAW_DIST;
  const nearZ = camZ + 1.0;
  const a = project(-ALLEY_HALF, 0, far);
  const b = project(ALLEY_HALF, 0, far);
  const c = project(ALLEY_HALF, 0, nearZ);
  const d = project(-ALLEY_HALF, 0, nearZ);
  if (!a || !b || !c || !d) return false;

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  // Run the near edge well past the bottom of the screen — the near corners
  // project below H, and stopping at them would leave a seam.
  ctx.lineTo(c.x, Math.max(c.y, H + 40));
  ctx.lineTo(d.x, Math.max(d.y, H + 40));
  ctx.closePath();
  ctx.clip();
  return true;
}

/**
 * Knock the reflection back toward the horizon and brighten the near field.
 * Reflections weaken with grazing angle and with haze, and without this the
 * mirrored image reads as a second, upside-down alley.
 */
function fadeWithDepth(ctx, W, H, horizon) {
  // Subtle. This only has to suggest the road darkening under your feet; the
  // scenery pass has already established the depth grade, and stacking a strong
  // second one on top just flattens the asphalt into a slab.
  const g = ctx.createLinearGradient(0, horizon, 0, H);
  g.addColorStop(0.00, 'rgba(30,20,38,0.30)');
  g.addColorStop(0.25, 'rgba(24,16,30,0.14)');
  g.addColorStop(0.65, 'rgba(16,10,22,0.05)');
  g.addColorStop(1.00, 'rgba(10,6,16,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(0, horizon, W, H - horizon);
}

/** A soft horizontal smear so the mirror never looks perfectly still. */
function rippleBand(ctx, W, H, horizon, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.16;
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const k = i / bands;
    const y = horizon + (H - horizon) * (0.25 + k * 0.75);
    const h = (H - horizon) * 0.035;
    const shimmer = 0.5 + Math.sin(t * 1.6 + i * 1.7) * 0.5;
    ctx.fillStyle = `rgba(180,200,230,${0.05 + shimmer * 0.07})`;
    ctx.fillRect(0, y, W, h);
  }
  ctx.restore();
}

/**
 * Puddles: brighter, glossier patches that catch the sky.
 *
 * Drawn as projected quads so they sit in the road in perspective and scroll
 * with it. These go down BEFORE the reflection so the mirror lands inside them.
 *
 * @param {Function} project world -> screen
 * @param {number} camZ
 */
export function drawPuddles(ctx, project, camZ, t) {
  if (FX.wetness <= 0) return;
  ctx.save();

  for (const p of PUDDLES) {
    // Repeat the field forward forever.
    const span = PUDDLES.length * 5.4;
    let z = p.z + Math.floor((camZ - p.z) / span + 1) * span;
    const dz = z - camZ;
    if (dz < 1.0 || dz > FX.puddleFade) continue;

    const a = project(p.x - p.w * 0.5, 0, z);
    const b = project(p.x + p.w * 0.5, 0, z);
    const c = project(p.x + p.w * 0.5, 0, z + p.d);
    const d = project(p.x - p.w * 0.5, 0, z + p.d);
    if (!a || !b || !c || !d) continue;

    // Fade in with proximity — a puddle 25 units away is a couple of pixels.
    const near = 1 - dz / FX.puddleFade;
    ctx.globalAlpha = Math.min(0.5, near * near * 0.55);

    const g = ctx.createLinearGradient(0, c.y, 0, a.y);
    g.addColorStop(0, 'rgba(120,150,190,0.55)');
    g.addColorStop(0.5, 'rgba(70,80,120,0.3)');
    g.addColorStop(1, 'rgba(30,26,44,0.1)');
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();

    // A moving highlight along the near lip reads as water rather than paint.
    ctx.globalAlpha = Math.min(0.4, near * 0.5) * (0.6 + Math.sin(t * 2 + p.z) * 0.4);
    ctx.strokeStyle = 'rgba(200,225,255,0.5)';
    ctx.lineWidth = Math.max(0.6, (a.y - c.y) * 0.04);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.restore();
}
