// Shared colours + tiny canvas helpers. Sunset-over-the-barrio palette.

export const PAL = {
  skyTop: '#2b1b52',
  skyMid: '#8d3b6b',
  skyLow: '#e8663c',
  skyHaze: '#ffb35c',
  sun: '#ffd98a',
  smog: '#f0a06a',

  asphalt: '#3a3540',
  asphaltFar: '#5b5260',
  seam: '#2c2833',
  curb: '#6d6472',
  paint: '#c9b98a',

  stuccoA: '#d8a373',
  stuccoB: '#c4794f',
  stuccoC: '#9fb08a',
  stuccoD: '#7c8fa8',
  brick: '#8f4a3c',
  garage: '#7d8a94',
  shadow: 'rgba(24,12,30,0.45)',

  gold: '#ffc93c',
  teal: '#28c3b8',
  hotPink: '#ff4d9d',
  lime: '#9ee34f',
  cop: '#1d3fb8',
  copRed: '#ff3b3b',
  rust: '#8a5a3b',
  steel: '#6a6f78',
};

/** Sample a hue for a graffiti tag / mural so each wall segment differs. */
export const TAG_COLORS = ['#ff4d9d', '#28c3b8', '#ffc93c', '#9ee34f', '#7b5cff', '#ff7a3d'];

/** Deterministic pseudo-random in [0,1) from an integer seed — stable scenery. */
export function hash01(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function pick(arr, seed) {
  return arr[Math.floor(hash01(seed) * arr.length) % arr.length];
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function quad(ctx, a, b, c, d, fill) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Haze factor 0..1 — 1 means fully swallowed by smog. */
export function fogAmount(dz, start, end) {
  if (dz <= start) return 0;
  return Math.min(1, (dz - start) / (end - start));
}

export function applyFog(ctx, dz, start, end) {
  const f = fogAmount(dz, start, end);
  ctx.globalAlpha *= 1 - f * 0.92;
  return f;
}
