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
};

export function shadow(ctx, sx, sy, u, w) {
  ctx.fillStyle = 'rgba(18,8,22,0.34)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, w * u * 0.6, w * u * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ------------------------------------------------------------------- pickups

export function drawBeer(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.beer;
  const bob = Math.sin(t * 3.2 + seed) * 0.06 * u;
  const spin = Math.abs(Math.cos(t * 2.6 + seed));
  const w = s.w * u * (0.42 + spin * 0.58);
  const h = s.h * u;
  const cy = sy - s.y * u + bob;

  ctx.save();
  ctx.translate(sx, cy);

  // glow so beers pop against the asphalt
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 1.1);
  g.addColorStop(0, 'rgba(255,201,60,0.42)');
  g.addColorStop(1, 'rgba(255,201,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-h * 1.1, -h * 1.1, h * 2.2, h * 2.2);

  // amber bottle
  ctx.fillStyle = '#a9631a';
  roundRect(ctx, -w / 2, -h * 0.5, w, h, w * 0.28);
  ctx.fill();
  ctx.fillStyle = '#d98b2a';
  roundRect(ctx, -w * 0.34, -h * 0.42, w * 0.3, h * 0.7, w * 0.16);
  ctx.fill();
  // neck + cap
  ctx.fillStyle = '#8d4f13';
  ctx.fillRect(-w * 0.16, -h * 0.72, w * 0.32, h * 0.26);
  ctx.fillStyle = PAL.gold;
  roundRect(ctx, -w * 0.2, -h * 0.82, w * 0.4, h * 0.14, w * 0.06);
  ctx.fill();
  // label
  ctx.fillStyle = '#f3e6cd';
  ctx.fillRect(-w * 0.5, -h * 0.12, w, h * 0.32);
  ctx.fillStyle = '#12782f';
  ctx.fillRect(-w * 0.5, -h * 0.06, w, h * 0.06);
  ctx.fillStyle = '#c1272d';
  ctx.fillRect(-w * 0.5, h * 0.1, w, h * 0.06);

  ctx.restore();
}

export function drawTaco(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.taco;
  const bob = Math.sin(t * 2.7 + seed) * 0.07 * u;
  const w = s.w * u, h = s.h * u;
  const cy = sy - s.y * u + bob;

  ctx.save();
  ctx.translate(sx, cy);
  ctx.rotate(Math.sin(t * 1.7 + seed) * 0.18);

  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
  g.addColorStop(0, 'rgba(158,227,79,0.38)');
  g.addColorStop(1, 'rgba(158,227,79,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-w, -w, w * 2, w * 2);

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
  ctx.fillStyle = '#f0b33d';
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.82, w * 0.5, -h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.2, -w * 0.5, -h * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d1932a';
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.82, w * 0.5, -h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.52, -w * 0.5, -h * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ------------------------------------------------------------------ powerups

export function drawPowerup(ctx, sx, sy, u, type, t, seed = 0) {
  const s = PROP_SPEC[type] || PROP_SPEC.magnet;
  const bob = Math.sin(t * 3 + seed) * 0.08 * u;
  const cy = sy - s.y * u + bob;
  const w = s.w * u, h = s.h * u;

  ctx.save();
  ctx.translate(sx, cy);

  // halo ring
  ctx.strokeStyle = type === 'magnet' ? PAL.hotPink : type === 'chancla' ? PAL.gold : '#4dd8ff';
  ctx.globalAlpha = 0.55 + Math.sin(t * 6 + seed) * 0.2;
  ctx.lineWidth = Math.max(1.5, u * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.rotate(Math.sin(t * 2 + seed) * 0.22);

  if (type === 'magnet') {
    // piñata donkey-ish star: layered frills
    const r = w * 0.5;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#ff4d9d', '#ffc93c', '#28c3b8'][i];
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const rr = k % 2 ? r * (0.55 - i * 0.13) : r * (1 - i * 0.2);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  } else if (type === 'chancla') {
    // la chancla
    ctx.fillStyle = '#5a3fd6';
    roundRect(ctx, -w * 0.5, -h * 0.22, w, h * 0.5, h * 0.22);
    ctx.fill();
    ctx.fillStyle = '#3a2894';
    roundRect(ctx, -w * 0.5, h * 0.14, w, h * 0.16, h * 0.07);
    ctx.fill();
    ctx.strokeStyle = '#ffd94d';
    ctx.lineWidth = Math.max(1.4, u * 0.05);
    ctx.beginPath();
    ctx.moveTo(-w * 0.28, -h * 0.16);
    ctx.quadraticCurveTo(0, -h * 0.42, w * 0.26, -h * 0.16);
    ctx.stroke();
  } else {
    // lowrider board with hydraulic glow
    ctx.fillStyle = '#8a1f3d';
    roundRect(ctx, -w * 0.5, -h * 0.18, w, h * 0.42, h * 0.18);
    ctx.fill();
    ctx.fillStyle = '#f4e6c8';
    ctx.fillRect(-w * 0.5, -h * 0.04, w, h * 0.07);
    ctx.fillStyle = PAL.gold;
    for (const wx of [-w * 0.28, w * 0.28]) {
      ctx.beginPath();
      ctx.arc(wx, h * 0.3, h * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(77,216,255,0.5)';
    ctx.fillRect(-w * 0.5, h * 0.4, w, h * 0.1);
  }
  ctx.restore();
}

// ----------------------------------------------------------------- obstacles

/** Police checkpoint: barricade, cones and a light bar you have to go around. */
export function drawCheckpoint(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.checkpoint;
  const w = s.w * u, h = s.h * u;
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);

  // legs
  ctx.fillStyle = '#4a4650';
  ctx.fillRect(-w * 0.42, -h * 0.62, w * 0.07, h * 0.62);
  ctx.fillRect(w * 0.35, -h * 0.62, w * 0.07, h * 0.62);

  // striped barricade plank
  const py = -h * 0.72, ph = h * 0.26;
  ctx.fillStyle = '#f0ece4';
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
  ctx.strokeStyle = '#2a2630';
  ctx.lineWidth = Math.max(1, u * 0.02);
  ctx.strokeRect(-w * 0.5, py, w, ph);

  // lower plank with lettering
  const qy = -h * 0.36, qh = h * 0.2;
  ctx.fillStyle = '#1d3fb8';
  ctx.fillRect(-w * 0.5, qy, w, qh);
  if (u > 34) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.floor(qh * 0.72)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RETÉN', 0, qy + qh * 0.54);
  }

  // flashing light bar
  const flash = Math.floor(t * 6 + seed) % 2 === 0;
  ctx.fillStyle = flash ? PAL.copRed : '#5b1414';
  roundRect(ctx, -w * 0.2, py - h * 0.16, w * 0.18, h * 0.13, u * 0.02);
  ctx.fill();
  ctx.fillStyle = flash ? '#2a49d8' : '#131a4a';
  roundRect(ctx, w * 0.02, py - h * 0.16, w * 0.18, h * 0.13, u * 0.02);
  ctx.fill();
  if (flash) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = PAL.copRed;
    ctx.beginPath();
    ctx.arc(-w * 0.11, py - h * 0.1, h * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // a cone for flavour
  ctx.fillStyle = '#e8622a';
  ctx.beginPath();
  ctx.moveTo(w * 0.52, 0);
  ctx.lineTo(w * 0.64, -h * 0.34);
  ctx.lineTo(w * 0.76, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f4f0e6';
  ctx.fillRect(w * 0.55, -h * 0.2, w * 0.18, h * 0.05);

  ctx.restore();
}

/** Border wall: rusted steel bollards, too tall to jump. Go around. */
export function drawBorderWall(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.border;
  const w = s.w * u, h = s.h * u;
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);

  const slats = 7;
  const gap = w / slats;
  for (let i = 0; i < slats; i++) {
    const x = -w * 0.5 + i * gap;
    const shade = 0.72 + hash01(seed * 31 + i) * 0.28;
    ctx.fillStyle = `rgb(${Math.floor(138 * shade)},${Math.floor(90 * shade)},${Math.floor(59 * shade)})`;
    ctx.fillRect(x, -h, gap * 0.72, h);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, -h, gap * 0.2, h);
    // rust bloom near the base
    ctx.fillStyle = 'rgba(60,28,16,0.4)';
    ctx.fillRect(x, -h * 0.22, gap * 0.72, h * 0.22);
  }

  // capping rail
  ctx.fillStyle = '#5c5a5f';
  ctx.fillRect(-w * 0.53, -h - u * 0.07, w * 1.06, u * 0.1);
  ctx.fillStyle = '#8f8d93';
  ctx.fillRect(-w * 0.53, -h - u * 0.07, w * 1.06, u * 0.03);

  // concrete footing
  ctx.fillStyle = '#6f6a72';
  ctx.fillRect(-w * 0.53, -h * 0.06, w * 1.06, h * 0.06);

  ctx.restore();
}

export function drawCopCar(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.copcar;
  const w = s.w * u, h = s.h * u;
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
  // light bar
  const flash = Math.floor(t * 7 + seed) % 2 === 0;
  ctx.fillStyle = flash ? PAL.copRed : '#4a1414';
  ctx.fillRect(-w * 0.3, -h * 1.04, w * 0.28, h * 0.1);
  ctx.fillStyle = flash ? '#3355ff' : '#141a44';
  ctx.fillRect(w * 0.02, -h * 1.04, w * 0.28, h * 0.1);
  // tail lights + tyres
  ctx.fillStyle = '#d83a2e';
  ctx.fillRect(-w * 0.46, -h * 0.3, w * 0.14, h * 0.08);
  ctx.fillRect(w * 0.32, -h * 0.3, w * 0.14, h * 0.08);
  ctx.fillStyle = '#1a1a1f';
  ctx.fillRect(-w * 0.52, -h * 0.16, w * 0.14, h * 0.16);
  ctx.fillRect(w * 0.38, -h * 0.16, w * 0.14, h * 0.16);

  ctx.restore();
}

export function drawDumpster(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.dumpster;
  const w = s.w * u, h = s.h * u;
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = '#2f6b46';
  roundRect(ctx, -w * 0.5, -h, w, h, w * 0.05);
  ctx.fill();
  ctx.fillStyle = '#3d8558';
  ctx.fillRect(-w * 0.5, -h, w, h * 0.16);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-w * 0.5, -h * 0.5, w, h * 0.04);
  // a lid propped open + a stray bag
  ctx.fillStyle = '#245038';
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h);
  ctx.lineTo(-w * 0.2, -h * 1.2);
  ctx.lineTo(w * 0.3, -h * 1.18);
  ctx.lineTo(w * 0.5, -h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4a4550';
  ctx.beginPath();
  ctx.ellipse(w * 0.42, -h * 0.14, w * 0.16, h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // wheels
  ctx.fillStyle = '#1a1a1f';
  ctx.fillRect(-w * 0.42, -h * 0.1, w * 0.1, h * 0.1);
  ctx.fillRect(w * 0.32, -h * 0.1, w * 0.1, h * 0.1);
  ctx.restore();
}

export function drawCrates(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.crates;
  const w = s.w * u, h = s.h * u;
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);
  // stacked produce crates outside a mercado
  const colors = ['#c9762f', '#b85a2c', '#d89a3f'];
  for (let i = 0; i < 3; i++) {
    const cw = w * (0.6 - i * 0.06);
    const ch = h * 0.36;
    const cx = (hash01(seed + i) - 0.5) * w * 0.22;
    const cy = -ch * (i + 1) * 0.92;
    ctx.fillStyle = colors[i % 3];
    roundRect(ctx, cx - cw / 2, cy, cw, ch, cw * 0.06);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(cx - cw / 2, cy + ch * 0.42, cw, ch * 0.1);
    ctx.fillStyle = '#e2ac4a';
    ctx.fillRect(cx - cw / 2, cy, cw, ch * 0.1);
  }
  ctx.restore();
}

export function drawCones(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.cones;
  const w = s.w * u, h = s.h * u;
  shadow(ctx, sx, sy, u, s.w);
  ctx.save();
  ctx.translate(sx, sy);
  for (let i = -1; i <= 1; i++) {
    const cx = i * w * 0.32;
    const ch = h * (0.8 + hash01(seed + i) * 0.3);
    ctx.fillStyle = '#e8622a';
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.14, 0);
    ctx.lineTo(cx, -ch);
    ctx.lineTo(cx + w * 0.14, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4f0e6';
    ctx.fillRect(cx - w * 0.09, -ch * 0.62, w * 0.18, ch * 0.16);
    ctx.fillStyle = '#c24d1e';
    ctx.fillRect(cx - w * 0.17, -h * 0.06, w * 0.34, h * 0.06);
  }
  ctx.restore();
}

/** Laundry strung across the alley — duck it. */
export function drawClothesline(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.clothesline;
  const w = s.w * u;
  const yTop = sy - (s.y + s.h) * u;
  const yBot = sy - s.y * u;
  ctx.save();
  ctx.translate(sx, 0);
  // the line itself
  ctx.strokeStyle = '#3a3038';
  ctx.lineWidth = Math.max(1, u * 0.025);
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, yTop + u * 0.06);
  ctx.quadraticCurveTo(0, yTop + u * 0.2, w * 0.55, yTop + u * 0.06);
  ctx.stroke();
  // hanging garments
  const shirts = ['#e35d8a', '#4fb3c9', '#f0c649', '#8fd06a', '#d9d3c6'];
  for (let i = 0; i < 4; i++) {
    const gx = -w * 0.38 + i * w * 0.25;
    const gw = w * 0.2;
    const sway = Math.sin(t * 1.6 + i + seed) * u * 0.03;
    ctx.fillStyle = shirts[(i + Math.floor(seed)) % shirts.length];
    ctx.beginPath();
    ctx.moveTo(gx - gw * 0.5 + sway, yTop + u * 0.12);
    ctx.lineTo(gx + gw * 0.5 + sway, yTop + u * 0.12);
    ctx.lineTo(gx + gw * 0.42 + sway * 2, yBot);
    ctx.lineTo(gx - gw * 0.42 + sway * 2, yBot);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(gx - gw * 0.5 + sway, yTop + u * 0.12, gw, u * 0.05);
  }
  ctx.restore();
}

/** Taqueria awning hanging low — duck it. */
export function drawAwning(ctx, sx, sy, u, t, seed = 0) {
  const s = PROP_SPEC.awning;
  const w = s.w * u;
  const yTop = sy - (s.y + s.h) * u;
  const yBot = sy - s.y * u;
  ctx.save();
  ctx.translate(sx, 0);
  const stripes = 6;
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#e04a3c' : '#f2ead8';
    ctx.beginPath();
    ctx.moveTo(-w * 0.5 + i * sw, yTop);
    ctx.lineTo(-w * 0.5 + (i + 1) * sw, yTop);
    ctx.lineTo(-w * 0.55 + (i + 1) * sw * 1.1, yBot);
    ctx.lineTo(-w * 0.55 + i * sw * 1.1, yBot);
    ctx.closePath();
    ctx.fill();
  }
  // scalloped hem
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(-w * 0.56, yBot - u * 0.05, w * 1.12, u * 0.06);
  if (u > 40) {
    ctx.fillStyle = '#2a2028';
    ctx.font = `700 ${Math.floor(u * 0.13)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('TAQUERIA', 0, yTop - u * 0.05);
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
};
