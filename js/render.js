// Painter's-algorithm renderer: sky, alley, props, runner, chaser, effects.

import { cam, project, projectClamped, viewport } from './camera.js';
import { ALLEY_HALF, DRAW_DIST, FOG_START, LANE_W, HITBOX } from './config.js';
import { PAL, quad, fogAmount, hash01 } from './art/palette.js';
import { drawSky, drawWallSegment, drawSkyline, drawWires } from './art/scenery.js';
import { PROP_DRAW, drawChaser } from './art/props.js';
import { drawRunner } from './art/runner.js';
import { drawParticles } from './particles.js';
import { propSprite, drawPropSprite } from './art/sprites.js';
import { drawWetReflection, drawPuddles } from './art/wet.js';

const SEG = 4;

export function renderScene(ctx, g) {
  const { W, H, horizon } = viewport();
  const t = g.time;

  ctx.clearRect(0, 0, W, H);

  // Camera roll. Applied to the whole scene rather than to individual pieces —
  // it is the CAMERA that banks into a lane change, so sky, walls and road all
  // have to tilt together. Pivoting on the vanishing point keeps the far end of
  // the alley pinned while the near edges swing, which is what a real bank does.
  // The HUD is drawn later in main.js on an untransformed context, so it stays
  // level; a tilting score readout reads as a bug.
  const rolled = Math.abs(cam.roll) > 0.0005;
  if (rolled) {
    ctx.save();
    ctx.translate(W * 0.5, horizon);
    ctx.rotate(cam.roll);
    // Rotating a rectangle that exactly fills the viewport swings its corners
    // inside the frame and leaves bare wedges at the edges. Scaling up by a
    // little more than the rotation needs keeps the frame covered; the pivot is
    // the horizon rather than the centre, so this is deliberately generous.
    const cover = 1 + Math.abs(cam.roll) * 3.2;
    ctx.scale(cover, cover);
    ctx.translate(-W * 0.5, -horizon);
  }

  drawSky(ctx, W, H, horizon, t, cam.x);

  const zNear = cam.z + 0.6;
  const zFar = cam.z + DRAW_DIST;

  drawGroundBase(ctx, W, H, horizon, zNear, zFar);

  // Far -> near so nearer geometry paints over distant geometry.
  const firstSeg = Math.floor(zNear / SEG) * SEG;
  const lastSeg = Math.ceil(zFar / SEG) * SEG;
  for (let z = lastSeg; z >= firstSeg; z -= SEG) {
    const dz = z - cam.z;
    if (dz < 0.4) continue;
    const alpha = 1 - fogAmount(dz, FOG_START, DRAW_DIST) * 0.95;
    if (alpha <= 0.02) continue;
    const idx = Math.round(z / SEG);

    drawGroundSegment(ctx, z, z + SEG, alpha, idx);
    drawWallSegment(ctx, projectClamped, -1, z, z + SEG, idx * 1.7 + 3, alpha);
    drawWallSegment(ctx, projectClamped, 1, z, z + SEG, idx * 2.3 + 11, alpha);
    drawSkyline(ctx, project, -1, z, idx * 3.1 + 5, alpha);
    drawSkyline(ctx, project, 1, z, idx * 4.7 + 17, alpha);
    if (idx % 3 === 0) drawWires(ctx, project, z, z + SEG, idx * 1.9, alpha);
  }

  // The road is wet. Reflect the alley into it before anything stands on it,
  // so props and the runner sit ON the sheen rather than under it.
  drawWetReflection(ctx, projectClamped, cam.z, W, H, horizon, t);
  drawPuddles(ctx, projectClamped, cam.z, t);

  drawProps(ctx, g, t);
  drawPlayer(ctx, g, t);
  drawTheChaser(ctx, g, t);
  drawParticles(ctx, project);

  // Everything past here is screen space — flashes, siren wash, vignette — so
  // it must not inherit the roll.
  if (rolled) ctx.restore();

  drawPostFX(ctx, g, W, H, horizon);
}

// -------------------------------------------------------------------- ground

function drawGroundBase(ctx, W, H, horizon, zNear, zFar) {
  // Everything under the horizon starts as deep shadow so no gap ever shows.
  ctx.fillStyle = '#241d2a';
  ctx.fillRect(0, horizon - 1, W, H - horizon + 1);

  const a = projectClamped(-ALLEY_HALF, 0, zFar);
  const b = projectClamped(ALLEY_HALF, 0, zFar);
  const c = projectClamped(ALLEY_HALF, 0, zNear);
  const d = projectClamped(-ALLEY_HALF, 0, zNear);
  quad(ctx, a, b, c, d, PAL.asphalt);

  // depth gradient: hazy up by the horizon, dark under your feet
  const gr = ctx.createLinearGradient(0, horizon, 0, H);
  gr.addColorStop(0, 'rgba(255,179,92,0.55)');
  gr.addColorStop(0.22, 'rgba(120,90,110,0.25)');
  gr.addColorStop(1, 'rgba(10,6,14,0.35)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, horizon, W, H - horizon);
}

function drawGroundSegment(ctx, z0, z1, alpha, idx) {
  ctx.save();
  ctx.globalAlpha = alpha;

  const strip = (x0, x1, za, zb, fill) => {
    const p1 = projectClamped(x0, 0, za), p2 = projectClamped(x1, 0, za);
    const p3 = projectClamped(x1, 0, zb), p4 = projectClamped(x0, 0, zb);
    quad(ctx, p1, p2, p3, p4, fill);
  };

  // expansion seam across the alley
  strip(-ALLEY_HALF, ALLEY_HALF, z0, z0 + 0.16, PAL.seam);

  // dashed lane guides
  const dash = 2.2;
  for (const lx of [-LANE_W * 0.5, LANE_W * 0.5]) {
    strip(lx - 0.045, lx + 0.045, z0 + 0.5, z0 + 0.5 + dash, 'rgba(201,185,138,0.42)');
  }

  // gutters + curbs hugging the walls
  strip(-ALLEY_HALF, -ALLEY_HALF + 0.28, z0, z1, 'rgba(20,12,24,0.4)');
  strip(ALLEY_HALF - 0.28, ALLEY_HALF, z0, z1, 'rgba(20,12,24,0.4)');

  // occasional manhole / patch so the asphalt isn't uniform
  if (idx % 5 === 2) {
    strip(-0.35, 0.35, z0 + 1.4, z0 + 2.3, 'rgba(60,52,66,0.8)');
  }
  if (idx % 7 === 3) {
    strip(-ALLEY_HALF + 0.3, -ALLEY_HALF + 0.9, z0 + 0.6, z0 + 3.2, 'rgba(50,44,58,0.55)');
  }

  // Near-field detail. Segments close to the camera cover a third of the screen
  // each, and with only the features above they read as a blank slab — the road
  // ahead looks resurfaced while the road underfoot looks unpainted. These are
  // cheap because they only ever run on the handful of segments in front.
  const dzSeg = z0 - cam.z;
  if (dzSeg < 22) {
    // tar seams snaking across the lanes
    const s = hash01(idx * 3.7);
    strip(-ALLEY_HALF + s * 0.6, ALLEY_HALF - s * 0.4,
      z0 + 1.1 + s * 1.6, z0 + 1.22 + s * 1.6, 'rgba(22,16,28,0.5)');
    // pale repair patch, offset per segment so it never lines up with the lanes
    if (idx % 3 === 1) {
      const px = (hash01(idx * 5.1) * 2 - 1) * 1.1;
      strip(px - 0.42, px + 0.42, z0 + 2.4, z0 + 3.5, 'rgba(74,66,80,0.42)');
    }
    // drain grate hugging a gutter
    if (idx % 4 === 0) {
      const side = hash01(idx * 9.3) > 0.5 ? 1 : -1;
      const gx = side * (ALLEY_HALF - 0.5);
      strip(gx - 0.22, gx + 0.22, z0 + 0.8, z0 + 1.5, 'rgba(28,22,34,0.85)');
      for (let i = 0; i < 3; i++) {
        strip(gx - 0.18, gx + 0.18,
          z0 + 0.9 + i * 0.2, z0 + 0.96 + i * 0.2, 'rgba(96,88,104,0.55)');
      }
    }
    // faded stencil paint, the kind that survives one repaving
    if (idx % 6 === 4) {
      strip(-0.12, 0.12, z0 + 3.0, z0 + 4.4, 'rgba(190,176,132,0.16)');
    }
  }

  ctx.restore();
}

// --------------------------------------------------------------------- props

function drawProps(ctx, g, t) {
  const objs = g.world.objects;
  // Collect what's visible, then paint far -> near.
  const vis = [];
  for (const o of objs) {
    if (o.dead) continue;
    const dz = o.z - cam.z;
    // Anything nearer than this fills the screen with a meaningless slab of
    // colour as it whips past the camera — cut it instead.
    if (dz < 2.6 || dz > DRAW_DIST) continue;
    vis.push(o);
  }
  vis.sort((a, b) => b.z - a.z);

  for (const o of vis) {
    const ground = project(o.x, 0, o.z);
    if (!ground) continue;
    const alpha = 1 - fogAmount(ground.dz, FOG_START, DRAW_DIST) * 0.95;
    if (alpha <= 0.02) continue;
    const painted = propSprite(o.type);
    const draw = PROP_DRAW[o.type];
    if (!painted && !draw) continue;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (painted) {
      // Painted props stand on their own hitbox height, so the lift is just
      // the pickup's hover offset.
      drawPropSprite(ctx, painted, ground.x, ground.y - o.y * ground.scale,
        ground.scale, o, t);
    } else {
      // Pickups can be lifted off their default height (arcs over obstacles),
      // so shift the "ground" line the art draws from.
      const lift = (o.y - defaultY(o.type)) * ground.scale;
      draw(ctx, ground.x, ground.y - lift, ground.scale, o, t);
    }
    ctx.restore();
  }
}

function defaultY(type) {
  // Mirrors PROP_SPEC[type].y — kept local so props.js stays the single source
  // for art and this file only needs the offset.
  return DEFAULT_Y[type] != null ? DEFAULT_Y[type] : 0;
}
const DEFAULT_Y = {
  beer: 0.78, taco: 0.82, magnet: 0.92, chancla: 0.92, lowrider: 0.86,
  clothesline: 1.15, awning: 1.12,
};

// -------------------------------------------------------------------- runner

function drawPlayer(ctx, g, t) {
  const p = g.player;
  const ground = project(p.x, 0, p.z);
  const at = project(p.x, p.y, p.z);
  if (!at) return;
  const u = at.scale;

  // contact shadow shrinks as you climb
  if (ground) {
    const lift = Math.max(0, p.y);
    const k = Math.max(0.25, 1 - lift * 0.4);
    ctx.globalAlpha = 0.4 * k;
    ctx.fillStyle = '#150a1a';
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, HITBOX.w * ground.scale * 0.95 * k,
      HITBOX.w * ground.scale * 0.3 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // lowrider board under the feet
  if (g.power.lowrider > 0) {
    drawBoard(ctx, at.x, at.y, u, t);
  }

  const pose = {
    phase: p.phase,
    airborne: p.airborne,
    vy: p.vy,
    sliding: p.sliding,
    slideK: p.slideT > 0 ? p.slideT / 0.62 : 0,
    laneLean: p.lean,
    speedK: g.speedK(),
  };

  // chancla rush trail
  if (g.power.chancla > 0) {
    for (let i = 1; i <= 3; i++) {
      const trail = project(p.x, p.y, p.z - i * 0.55);
      if (!trail) continue;
      ctx.globalAlpha = 0.24 / i;
      drawRunner(ctx, trail.x, trail.y, trail.scale, p.rig,
        { ...pose, phase: p.phase - i * 0.07 });
    }
    ctx.globalAlpha = 1;
  }

  if (g.invuln > 0 && Math.floor(t * 18) % 2 === 0) {
    ctx.globalAlpha = 0.45;
  }
  drawRunner(ctx, at.x, at.y, u, p.rig, pose);
  ctx.globalAlpha = 1;

  // magnet aura
  if (g.power.magnet > 0) {
    ctx.strokeStyle = PAL.hotPink;
    ctx.globalAlpha = 0.35 + Math.sin(t * 8) * 0.15;
    ctx.lineWidth = Math.max(1.5, u * 0.04);
    ctx.beginPath();
    ctx.ellipse(at.x, at.y - u * 0.7, u * 1.5, u * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawBoard(ctx, sx, sy, u, t) {
  ctx.save();
  ctx.translate(sx, sy + u * 0.04);
  ctx.fillStyle = 'rgba(77,216,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, u * 0.06, u * 0.6, u * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a1f3d';
  ctx.beginPath();
  ctx.ellipse(0, 0, u * 0.46, u * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4e6c8';
  ctx.fillRect(-u * 0.46, -u * 0.02, u * 0.92, u * 0.03);
  ctx.fillStyle = PAL.gold;
  for (const wx of [-u * 0.3, u * 0.3]) {
    ctx.beginPath();
    ctx.arc(wx, u * 0.09, u * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTheChaser(ctx, g, t) {
  if (g.chaser.z >= g.player.z - 0.4) return;
  const s = project(0 + g.chaser.x, 0, g.chaser.z);
  if (!s) return;
  const closeness = Math.max(0, Math.min(1, g.chase / 100));
  ctx.save();
  ctx.globalAlpha = Math.min(1, closeness * 1.6 + 0.15);
  drawChaser(ctx, s.x, s.y, s.scale, t, closeness);
  ctx.restore();
}

// ------------------------------------------------------------------- post fx

function drawPostFX(ctx, g, W, H, horizon) {
  // speed lines during a chancla rush
  if (g.power.chancla > 0) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = PAL.gold;
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + g.time * 3;
      const r0 = W * 0.32, r1 = W * (0.5 + (i % 3) * 0.12);
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(a) * r0, horizon + Math.sin(a) * r0 * 0.8);
      ctx.lineTo(W / 2 + Math.cos(a) * r1, horizon + Math.sin(a) * r1 * 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  // running on empty: the alley drains of colour and the sirens bleed in
  if (g.stamina <= 0) {
    const pulse = 0.16 + Math.sin(g.time * 5) * 0.08;
    ctx.fillStyle = `rgba(120,20,40,${pulse})`;
    ctx.fillRect(0, 0, W, H);
  } else if (g.stamina < 30) {
    ctx.fillStyle = `rgba(140,60,30,${(1 - g.stamina / 30) * 0.1})`;
    ctx.fillRect(0, 0, W, H);
  }

  // hit flash
  if (g.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,80,80,${Math.min(0.5, g.hitFlash)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // siren wash when the cruiser is right behind you
  if (g.chase > 55) {
    const k = (g.chase - 55) / 45;
    const flash = Math.floor(g.time * 7) % 2 === 0;
    ctx.fillStyle = flash
      ? `rgba(255,50,50,${0.05 + k * 0.14})`
      : `rgba(60,90,255,${0.05 + k * 0.14})`;
    ctx.fillRect(0, 0, W, H);
  }

  // vignette
  const v = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.2, W / 2, H * 0.55, H * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(8,4,12,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}
