// World-space particles — projected like everything else so they sit in the alley.

const pool = [];
const MAX = 220;

// ⚠ EVERY BURST IN THIS GAME GOES OFF AT THE PLAYER'S OWN PLANE. A pickup is
// collected where the player is standing, a smash happens against their chest,
// the landing puff is under their feet, and the drone detonates on top of them
// — grep game.js and every one of the eight burst() sites, plus the dust behind
// the feet, is within a unit of `player.z`. That is the LARGEST scale anything
// in the alley ever gets: the camera sits CAM.back = 4.25u behind and the focal
// length is most of the frame's width, so a 0.13u spark projects to sixty-odd
// pixels. drawProps() guards the same hazard with a near cull and calls it "a
// meaningless slab of colour"; here it is not the edge case, it is the ONLY
// case, and it was unguarded.
//
// The two numbers below are that guard. Both are needed and each fixes half of
// it: without SIZE_NEAR the sparks are individually the size of the runner's
// head, and without LEAD they are all in the same place on the frame they are
// born, which is one opaque square rather than eighteen.

// Sizes are computed as if a spark were never nearer than this, in world
// units. NOT a cull and NOT a clamp on the drawn radius: it scales the whole
// burst by one factor, so the size variation inside a burst and the shrink as
// a spark ages both survive it — a hard pixel ceiling would flatten eighteen
// different sparks into eighteen identical squares, which is the slab again in
// a smaller size. At 12u a point-blank burst draws at ~35% of its perspective
// size, which puts the biggest spark at about a quarter of the runner's head.
// It binds on every burst the game currently fires and is inert past 12u, so a
// burst that ever happens down the alley is still drawn in true perspective.
const SIZE_NEAR = 12;

// Seconds of head start a spark may be given when it is born. The instant a
// burst fires does not land on a frame boundary, so by the time it is first
// drawn the sparks have already flown — and by DIFFERENT amounts. Spawning
// them all on one point is what stacked N opaque squares into ONE, and that is
// the flat slab of powerup colour that has been landing on the runner's neck
// on the frame a powerup is collected for as long as powerups have existed.
const LEAD = 0.055;

export function resetParticles() {
  pool.length = 0;
}

export function burst(x, y, z, count, color, opts = {}) {
  const spread = opts.spread || 2.6;
  const life = opts.life || 0.5;
  const size = opts.size || 0.09;
  const rise = opts.rise || 3.2;
  for (let i = 0; i < count && pool.length < MAX; i++) {
    const vx = (Math.random() * 2 - 1) * spread;
    const vy = Math.random() * rise + 0.6;
    const vz = (Math.random() * 2 - 1) * spread * 0.5;
    // Each spark down its own path by its own amount. Position only — over
    // LEAD gravity moves a spark by a hundredth of a unit, so carrying it
    // through would be arithmetic nobody can see.
    const lead = Math.random() * LEAD;
    pool.push({
      x: x + vx * lead,
      y: y + vy * lead,
      z: z + vz * lead,
      vx,
      vy,
      vz,
      life: life * (0.6 + Math.random() * 0.6),
      age: 0,
      color,
      size: size * (0.6 + Math.random() * 0.8),
      gravity: opts.gravity == null ? -9 : opts.gravity,
    });
  }
}

/** Dust kicked up behind the runner's feet. */
export function dust(x, z, speed) {
  if (pool.length > MAX - 6) return;
  pool.push({
    x: x + (Math.random() * 2 - 1) * 0.22,
    y: 0.04,
    z: z - 0.3,
    vx: (Math.random() * 2 - 1) * 0.5,
    vy: Math.random() * 0.9 + 0.2,
    vz: -speed * 0.22,
    life: 0.42,
    age: 0,
    color: 'rgba(210,190,175,0.5)',
    size: 0.14,
    gravity: -1.2,
  });
}

export function updateParticles(dt) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const p = pool[i];
    p.age += dt;
    if (p.age >= p.life) { pool.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.vy += p.gravity * dt;
    if (p.y < 0) { p.y = 0; p.vy *= -0.3; }
  }
}

export function drawParticles(ctx, project) {
  for (const p of pool) {
    const s = project(p.x, p.y, p.z);
    if (!s) continue;
    const k = 1 - p.age / p.life;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = p.color;
    // project() hands back the depth it used, so the size clamp costs one
    // divide and needs nothing from the camera — POSITION stays in true
    // perspective, only the SIZE stops growing. Squares, not arcs: at 220
    // particles this is a fillRect budget, and path count is the frame budget
    // in this renderer.
    const r = Math.max(0.6,
      p.size * s.scale * Math.min(1, s.dz / SIZE_NEAR) * (0.5 + k * 0.5));
    ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
}

export function particleCount() {
  return pool.length;
}
