// World-space particles — projected like everything else so they sit in the alley.

const pool = [];
const MAX = 220;

export function resetParticles() {
  pool.length = 0;
}

export function burst(x, y, z, count, color, opts = {}) {
  const spread = opts.spread || 2.6;
  const life = opts.life || 0.5;
  const size = opts.size || 0.09;
  const rise = opts.rise || 3.2;
  for (let i = 0; i < count && pool.length < MAX; i++) {
    pool.push({
      x, y, z,
      vx: (Math.random() * 2 - 1) * spread,
      vy: Math.random() * rise + 0.6,
      vz: (Math.random() * 2 - 1) * spread * 0.5,
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
    const r = Math.max(0.6, p.size * s.scale * (0.5 + k * 0.5));
    ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
}

export function particleCount() {
  return pool.length;
}
