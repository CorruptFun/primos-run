// In-run HUD, drawn on the canvas so it scales with the device and never
// fights the DOM overlay used for menus.

import { PAL, roundRect } from './art/palette.js';
import { drawPrimoPortrait } from './art/runner.js';
import { drawLogo } from './art/logo.js';
import { POWER, STAMINA, CHASE, SCORE } from './config.js';
// Aliased for the same reason tutorial.js and intro.js do it: `t` is the
// animation clock in this codebase's drawing layer (see fx.t and drawToasts),
// and one future local named `t` would silently shadow the translator.
import { t as tr } from './i18n.js';

// Power pill captions come from here rather than POWER[key].label, so they can
// switch language. Baked as a lookup because drawPowerPills runs every frame
// and `'power.' + key` would allocate a string per pill per frame.
const POWER_LABEL = {
  magnet: 'power.magnet',
  chancla: 'power.chancla',
  lowrider: 'power.lowrider',
};

// Exported so the tutorial overlay draws in the same voice as the HUD by
// construction rather than by copy-paste — see js/tutorial.js.
export const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
export const INK = '#fdf6e6';

const toasts = [];

export function pushToast(text, color) {
  toasts.push({ text, color, age: 0, life: 1.5 });
  if (toasts.length > 3) toasts.shift();
}

export function clearToasts() {
  toasts.length = 0;
}

/** Screen rect of the pause button, so main.js can hit-test taps. */
export let pauseRect = { x: 0, y: 0, w: 0, h: 0 };

// Frame-to-frame juice. Lives in the module so the HUD stays a read-only view
// of the Game — nothing here is ever written back to `g`.
const fx = {
  t: 0,
  score: 0,          // eased score, so points roll up instead of snapping
  beers: 0, beerPop: 0,
  tacos: 0, tacoPop: 0,
  mult: 1, multPop: 0,
  chase: 0,          // eased chase fill — a +46 hit should sweep, not teleport
  stam: 1,
  alarm: 0,          // 0..1 how loudly the chase meter is screaming
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const decay = (v, dt, rate) => (v > 0 ? Math.max(0, v - dt * rate) : 0);

function tick(g, dt) {
  fx.t += dt;

  // A lower target means a fresh run: snap rather than counting backwards.
  if (g.score < fx.score - 1) fx.score = g.score;
  else {
    const diff = g.score - fx.score;
    // Floor rate outruns the passive distance score, so the roll-up only ever
    // lags behind pickups and then catches up.
    fx.score += Math.min(diff, Math.max(diff * dt * 7, dt * 44));
  }

  fx.beerPop = decay(fx.beerPop, dt, 3.6);
  if (g.beers > fx.beers) fx.beerPop = 1;
  fx.beers = g.beers;

  fx.tacoPop = decay(fx.tacoPop, dt, 2.6);
  if (g.tacos > fx.tacos) fx.tacoPop = 1;
  fx.tacos = g.tacos;

  fx.multPop = decay(fx.multPop, dt, 1.7);
  if (g.multiplier > fx.mult) fx.multPop = 1;
  fx.mult = g.multiplier;

  const chase = clamp01(g.chase / CHASE.max);
  fx.chase += (chase - fx.chase) * Math.min(1, dt * 9);
  const heat = chase > 0.72 ? (chase - 0.72) / 0.28 : 0;
  fx.alarm += (heat - fx.alarm) * Math.min(1, dt * 7);

  const stam = clamp01(g.stamina / STAMINA.max);
  fx.stam += (stam - fx.stam) * Math.min(1, dt * 11);
}

export function drawHUD(ctx, g, W, H, dt, safeTop = 0, safeBottom = 0) {
  const s = Math.min(W, H) / 420;           // one scale knob for the whole HUD
  const pad = 14 * s;
  const top = safeTop + pad;

  tick(g, dt);

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  drawPauseButton(ctx, pad, top, 46 * s, s);
  drawChaseMeter(ctx, g, W, top, s);
  drawScore(ctx, g, W, top, s);
  // 72 not 58: the taco pip sits 13px above the bar and would otherwise clip
  // the bottom of the pause button.
  drawStamina(ctx, g, pad, top + 72 * s, s, H);
  drawPortrait(ctx, g, W - pad, top + 92 * s, s);
  // Both clear the home indicator / gesture bar. Anchored to H alone they sit
  // under it on any phone with a soft bottom bar.
  drawPowerPills(ctx, g, pad, H - pad - safeBottom, s);
  drawWatermark(ctx, W, H - safeBottom, pad, s);
  drawToasts(ctx, W, H, s, dt);
  ctx.restore();
}

// ------------------------------------------------------------------ helpers

/**
 * Light text over a bright sunset needs a dark halo *and* a soft shadow,
 * otherwise it dissolves into the smog gradient.
 */
export function label(ctx, str, x, y, size, fill, o = {}) {
  const px = Math.max(7, Math.round(size));
  ctx.font = `${o.weight || 800} ${px}px ${FONT}`;
  if (o.spacing) ctx.letterSpacing = `${o.spacing}px`;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (o.halo !== 0) {
    ctx.lineWidth = o.halo || Math.max(2, px * 0.24);
    ctx.strokeStyle = o.haloColor || 'rgba(9,5,16,0.68)';
    ctx.strokeText(str, x, y);
  }
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = o.glowSize || px * 0.7;
  } else {
    ctx.shadowColor = 'rgba(6,3,12,0.5)';
    ctx.shadowBlur = px * 0.34;
    ctx.shadowOffsetY = px * 0.1;
  }
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
  ctx.restore();
  if (o.spacing) ctx.letterSpacing = '0px';
}

/** Dark glass plate: drop shadow, vertical gradient, bevelled rim. */
export function panel(ctx, x, y, w, h, r, s) {
  const body = ctx.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, 'rgba(58,37,78,0.80)');
  body.addColorStop(0.55, 'rgba(24,14,36,0.82)');
  body.addColorStop(1, 'rgba(12,7,20,0.86)');

  ctx.save();
  ctx.shadowColor = 'rgba(5,2,10,0.55)';
  ctx.shadowBlur = 12 * s;
  ctx.shadowOffsetY = 4 * s;
  ctx.fillStyle = body;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  bevel(ctx, x, y, w, h, r, s);
}

/** Rim that reads as lit from above: bright top edge fading to a dark base. */
export function bevel(ctx, x, y, w, h, r, s, tint) {
  const rim = ctx.createLinearGradient(0, y, 0, y + h);
  rim.addColorStop(0, tint || 'rgba(255,255,255,0.42)');
  rim.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  rim.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.save();
  ctx.strokeStyle = rim;
  ctx.lineWidth = Math.max(1, 1.2 * s);
  roundRect(ctx, x + 0.5 * s, y + 0.5 * s, w - s, h - s, r);
  ctx.stroke();
  ctx.restore();
}

/** Recessed track for the meters — dark well with a shadow under the top lip. */
export function track(ctx, x, y, w, h, r, s) {
  const well = ctx.createLinearGradient(0, y, 0, y + h);
  well.addColorStop(0, 'rgba(6,3,12,0.78)');
  well.addColorStop(1, 'rgba(30,20,44,0.62)');
  ctx.fillStyle = well;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, 1.4 * s);
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.restore();
}

/** Animated barber-pole inside a filled meter — cheap sense of motion. */
function stripes(ctx, x, y, w, h, s, alpha, dir) {
  if (w <= 1) return;
  const gap = 15 * s;
  const off = ((fx.t * 42 * s) % gap) * (dir || 1);
  ctx.save();
  roundRect(ctx, x, y, w, h, Math.min(h, w) / 2);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  for (let sx = x - h - gap; sx < x + w + h; sx += gap) {
    const p = sx + off;
    ctx.beginPath();
    ctx.moveTo(p, y + h);
    ctx.lineTo(p + h * 0.6, y);
    ctx.lineTo(p + h * 0.6 + gap * 0.32, y);
    ctx.lineTo(p + gap * 0.32, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Glass highlight along the top half of a filled bar. */
export function gloss(ctx, x, y, w, h, r) {
  if (w <= 1) return;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.38)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

// ------------------------------------------------------------------- pieces

function drawPauseButton(ctx, x, y, size, s) {
  pauseRect = { x, y, w: size, h: size };
  ctx.save();
  panel(ctx, x, y, size, size, size * 0.3, s);

  // bars get their own bevel so they read as raised keys, not flat slabs
  const bw = size * 0.13, bh = size * 0.42;
  const by = y + size * 0.29;
  const key = ctx.createLinearGradient(0, by, 0, by + bh);
  key.addColorStop(0, '#fffaf0');
  key.addColorStop(1, '#c9bda4');
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 3 * s;
  ctx.shadowOffsetY = 1.5 * s;
  ctx.fillStyle = key;
  roundRect(ctx, x + size * 0.31, by, bw, bh, bw * 0.42);
  ctx.fill();
  roundRect(ctx, x + size * 0.56, by, bw, bh, bw * 0.42);
  ctx.fill();
  ctx.restore();
}

function drawChaseMeter(ctx, g, W, y, s) {
  const w = W * 0.34, h = 11 * s;
  const x = (W - w) / 2;
  const by = y + 14 * s;
  const k = clamp01(fx.chase);
  const a = fx.alarm;

  ctx.save();
  // the whole cluster judders once La Migra is breathing down your neck
  if (a > 0.01) {
    ctx.translate(Math.sin(fx.t * 47) * 2.6 * s * a, Math.cos(fx.t * 39) * 1.7 * s * a);
  }

  // danger bloom behind the track
  if (a > 0.01) {
    ctx.save();
    ctx.globalAlpha = a * (0.35 + 0.25 * Math.sin(fx.t * 11));
    ctx.shadowColor = '#ff2b2b';
    ctx.shadowBlur = 22 * s;
    ctx.fillStyle = '#ff2b2b';
    roundRect(ctx, x, by, w, h, h / 2);
    ctx.fill();
    ctx.restore();
  }

  track(ctx, x, by, w, h, h / 2, s);

  if (k > 0.004) {
    const fw = Math.max(h, w * k);
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, '#3f60ff');
    grad.addColorStop(0.55, '#b03bd8');
    grad.addColorStop(1, '#ff3b3b');
    ctx.save();
    ctx.shadowColor = k > 0.6 ? 'rgba(255,59,59,0.75)' : 'rgba(120,80,255,0.5)';
    ctx.shadowBlur = (6 + 10 * a) * s;
    ctx.fillStyle = grad;
    roundRect(ctx, x, by, fw, h, h / 2);
    ctx.fill();
    ctx.restore();
    stripes(ctx, x, by, fw, h, s, 0.14 + 0.16 * a);
    gloss(ctx, x, by, fw, h, h / 2);

    // white blowout on the beat when the meter is nearly full
    if (a > 0.01) {
      ctx.save();
      ctx.globalAlpha = a * 0.5 * (0.5 + 0.5 * Math.sin(fx.t * 15));
      ctx.fillStyle = '#fff';
      roundRect(ctx, x, by, fw, h, h / 2);
      ctx.fill();
      ctx.restore();
    }

    // cruiser light chasing the head of the fill
    const blue = Math.floor(fx.t * 7) % 2 === 0;
    ctx.save();
    ctx.shadowColor = blue ? '#5b83ff' : '#ff3b3b';
    ctx.shadowBlur = 9 * s;
    ctx.fillStyle = blue ? '#c3d4ff' : '#ffc9c9';
    ctx.beginPath();
    ctx.arc(x + fw - h * 0.5, by + h * 0.5, h * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  bevel(ctx, x, by, w, h, h / 2, s);

  // notches at the thirds give the bar a readable scale
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = Math.max(1, s);
  for (let i = 1; i < 3; i++) {
    const nx = x + (w * i) / 3;
    ctx.beginPath();
    ctx.moveTo(nx, by + h * 0.22);
    ctx.lineTo(nx, by + h * 0.78);
    ctx.stroke();
  }
  ctx.restore();

  ctx.textAlign = 'center';
  const hot = a > 0.02;
  const flash = hot && Math.floor(fx.t * 6) % 2 === 0;
  label(ctx, tr('hud.migra'), W / 2, y + 10 * s, 10 * s,
    flash ? '#ffe3e3' : hot ? '#ff9a9a' : 'rgba(244,236,224,0.82)',
    { spacing: 1.4 * s, weight: 900, glow: hot ? '#ff2b2b' : null, glowSize: 10 * s });
  ctx.restore();
}

function drawScore(ctx, g, W, y, s) {
  const right = W - 14 * s;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';

  // ---- score. Leading zeros stay dim so the live digits read first.
  const size = 31 * s;
  const str = String(Math.floor(fx.score)).padStart(6, '0');
  let lead = 0;
  while (lead < str.length - 1 && str[lead] === '0') lead++;
  const head = str.slice(0, lead);
  const tail = str.slice(lead);

  ctx.font = `900 ${Math.round(size)}px ${FONT}`;
  const tailW = ctx.measureText(tail).width;

  const shine = ctx.createLinearGradient(0, y, 0, y + size);
  shine.addColorStop(0, '#fffdf3');
  shine.addColorStop(0.62, '#ffeec2');
  shine.addColorStop(1, '#f8c463');
  label(ctx, tail, right, y, size, shine, { weight: 900, halo: 4.5 * s });
  if (head) {
    label(ctx, head, right - tailW, y, size, 'rgba(253,246,230,0.22)',
      { weight: 900, halo: 3 * s, haloColor: 'rgba(9,5,16,0.4)' });
  }

  // ---- chela tally + multiplier + distance, one step down the hierarchy
  const rowY = y + 39 * s;
  const pop = fx.beerPop;
  const count = String(g.beers);
  const fs = 19 * s;
  ctx.font = `900 ${Math.round(fs)}px ${FONT}`;
  const cwid = ctx.measureText(count).width;

  // The chip rides beside the chelas that earned it — up beside the score it
  // would collide with the chase meter once the score reaches six digits.
  if (g.multiplier > 1) {
    const mpop = fx.multPop;
    const text = `x${g.multiplier}`;
    const mfs = 17 * s;
    ctx.font = `900 ${Math.round(mfs)}px ${FONT}`;
    const tw = ctx.measureText(text).width;
    const cw = tw + 15 * s, ch = 24 * s;
    const cx = right - cwid - 29 * s - cw;
    const cy = rowY - 2 * s;

    ctx.save();
    const scale = 1 + 0.34 * mpop * mpop;
    ctx.translate(cx + cw / 2, cy + ch / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(cx + cw / 2), -(cy + ch / 2));

    // pulse ring blows outward on every bump
    if (mpop > 0.01) {
      ctx.save();
      ctx.globalAlpha = mpop * 0.6;
      ctx.strokeStyle = '#fff3c4';
      ctx.lineWidth = 2.4 * s;
      const gr = (1 - mpop) * 11 * s;
      roundRect(ctx, cx - gr, cy - gr, cw + gr * 2, ch + gr * 2, 8 * s + gr);
      ctx.stroke();
      ctx.restore();
    }

    const chip = ctx.createLinearGradient(0, cy, 0, cy + ch);
    chip.addColorStop(0, '#ffe89a');
    chip.addColorStop(0.55, PAL.gold);
    chip.addColorStop(1, '#e08c10');
    ctx.save();
    ctx.shadowColor = `rgba(255,180,40,${0.45 + 0.4 * mpop})`;
    ctx.shadowBlur = (8 + 14 * mpop) * s;
    ctx.shadowOffsetY = 2 * s;
    ctx.fillStyle = chip;
    roundRect(ctx, cx, cy, cw, ch, 8 * s);
    ctx.fill();
    ctx.restore();
    bevel(ctx, cx, cy, cw, ch, 8 * s, s, 'rgba(255,255,255,0.7)');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    label(ctx, text, cx + cw / 2, cy + ch * 0.55, mfs, '#3a2205',
      { weight: 900, halo: 0 });
    ctx.restore();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
  }

  ctx.save();
  const bs = 1 + 0.42 * pop * pop;
  ctx.translate(right, rowY + 9 * s);
  ctx.scale(bs, bs);
  ctx.translate(-right, -(rowY + 9 * s));
  label(ctx, count, right, rowY, fs, pop > 0.55 ? '#fffdf0' : '#ffd86b',
    { weight: 900, halo: 3.4 * s, glow: pop > 0.1 ? '#ffcf3d' : null, glowSize: 14 * s });
  beerIcon(ctx, right - cwid - 22 * s, rowY + 2 * s, 15 * s, pop);
  ctx.restore();

  ctx.textAlign = 'right';
  label(ctx, `${Math.floor(g.distance)} M`, right, rowY + 22 * s, 10.5 * s,
    'rgba(253,246,230,0.6)', { spacing: 1.1 * s, weight: 800, halo: 2.6 * s });

  ctx.restore();
}

function beerIcon(ctx, x, y, size, pop = 0) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4 * size * 0.2;
  ctx.shadowOffsetY = size * 0.12;

  const glass = ctx.createLinearGradient(x, 0, x + size * 0.62, 0);
  glass.addColorStop(0, '#d08a30');
  glass.addColorStop(0.4, '#f0a93c');
  glass.addColorStop(1, '#96581a');
  ctx.fillStyle = glass;
  roundRect(ctx, x, y + size * 0.25, size * 0.62, size * 0.8, size * 0.16);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.fillStyle = '#f7ecd6';                       // label band
  ctx.fillRect(x, y + size * 0.6, size * 0.62, size * 0.22);
  ctx.fillStyle = pop > 0.5 ? '#fff6d0' : PAL.gold; // foamy cap
  roundRect(ctx, x + size * 0.14, y, size * 0.34, size * 0.32, size * 0.1);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';        // highlight down the glass
  ctx.fillRect(x + size * 0.1, y + size * 0.34, size * 0.1, size * 0.6);
  ctx.restore();
}

function drawStamina(ctx, g, x, y, s, H) {
  const w = 15 * s;
  const h = Math.min(160 * s, H * 0.3);
  const k = clamp01(fx.stam);
  const low = g.stamina < STAMINA.lowWarn;
  const empty = g.stamina <= 0;
  // one shared heartbeat so the bar, the pip and the glow breathe together
  const beat = low ? 0.5 + 0.5 * Math.sin(fx.t * 9) : 0;

  ctx.save();
  if (low) {
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.3 * beat;
    ctx.shadowColor = '#ff4d2a';
    ctx.shadowBlur = 16 * s;
    ctx.fillStyle = '#ff4d2a';
    roundRect(ctx, x, y, w, h, w / 2);
    ctx.fill();
    ctx.restore();
  }

  track(ctx, x, y, w, h, w / 2, s);

  const fh = h * k;
  if (fh > 1) {
    const fy = y + h - fh;
    const grad = ctx.createLinearGradient(0, fy, 0, y + h);
    grad.addColorStop(0, low ? '#ffb03d' : '#c8f56b');
    grad.addColorStop(0.45, low ? '#ff6b3d' : '#9ee34f');
    grad.addColorStop(1, low ? '#b81b16' : '#2fae4e');
    ctx.save();
    ctx.shadowColor = low ? 'rgba(255,80,40,0.7)' : 'rgba(120,220,80,0.45)';
    ctx.shadowBlur = (5 + 8 * beat) * s;
    ctx.fillStyle = grad;
    roundRect(ctx, x, fy, w, fh, w / 2);
    ctx.fill();
    ctx.restore();

    // vertical glass highlight, plus a bright lip at the top of the juice
    const sheen = ctx.createLinearGradient(x, 0, x + w, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0.34)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = sheen;
    roundRect(ctx, x, fy, w, fh, w / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    roundRect(ctx, x + w * 0.18, fy + w * 0.1, w * 0.64, 2 * s, s);
    ctx.fill();
  }

  bevel(ctx, x, y, w, h, w / 2, s);

  // quarter notches so you can read the level at a glance
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = Math.max(1, s);
  for (let i = 1; i < 4; i++) {
    const ny = y + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.22, ny);
    ctx.lineTo(x + w * 0.78, ny);
    ctx.stroke();
  }
  ctx.restore();

  // taco pip on top of the bar — pops when you eat one, blinks when starving
  const cx = x + w / 2;
  const py = y - 13 * s;
  ctx.save();
  const tp = 1 + 0.5 * fx.tacoPop * fx.tacoPop;
  ctx.translate(cx, py);
  ctx.scale(tp, tp);
  ctx.globalAlpha = low ? 0.45 + 0.55 * beat : 1;
  if (fx.tacoPop > 0.02) {
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 16 * s * fx.tacoPop;
  }
  tacoIcon(ctx, 0, 0, 20 * s);
  ctx.restore();

  if (empty) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    label(ctx, tr('hud.sinGas'), x + w + 7 * s, y + h * 0.5, 11 * s, '#ff8080',
      { weight: 900, spacing: 0.8 * s, glow: '#ff2b2b', glowSize: 12 * s });
  }
  ctx.restore();
}

function tacoIcon(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#7a3f1e';
  roundRect(ctx, -size * 0.3, -size * 0.16, size * 0.6, size * 0.3, size * 0.1);
  ctx.fill();
  ctx.fillStyle = PAL.lime;
  ctx.fillRect(-size * 0.28, -size * 0.2, size * 0.56, size * 0.12);
  const shell = ctx.createLinearGradient(0, -size * 0.2, 0, size * 0.3);
  shell.addColorStop(0, '#ffd479');
  shell.addColorStop(1, '#e08f22');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.moveTo(-size * 0.36, -size * 0.18);
  ctx.quadraticCurveTo(0, size * 0.5, size * 0.36, -size * 0.18);
  ctx.quadraticCurveTo(0, size * 0.16, -size * 0.36, -size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPortrait(ctx, g, right, y, s) {
  const size = 54 * s;
  const x = right - size;
  const r = size * 0.2;
  const hot = g.multiplier > 1;

  ctx.save();
  if (hot) {                                   // gold halo while a combo is up
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(fx.t * 4) + 0.4 * fx.multPop;
    ctx.shadowColor = PAL.gold;
    ctx.shadowBlur = 18 * s;
    ctx.fillStyle = PAL.gold;
    roundRect(ctx, x, y, size, size, r);
    ctx.fill();
    ctx.restore();
  }

  panel(ctx, x, y, size, size, r, s);

  ctx.save();
  roundRect(ctx, x + 3 * s, y + 3 * s, size - 6 * s, size - 6 * s, r * 0.78);
  ctx.clip();
  const back = ctx.createLinearGradient(0, y, 0, y + size);
  back.addColorStop(0, '#3b2750');
  back.addColorStop(1, '#1c1328');
  ctx.fillStyle = back;
  ctx.fillRect(x, y, size, size);
  // Crew seal behind the head, oversized so the frame crops it. Sized to the
  // frame instead, the mark's outer ring is all that clears the head and it
  // reads as a stray circle; cropped at 1.75x it reads as branding on the ID
  // card. It flushes gold while a combo is live and flares on every bump,
  // which gives the multiplier a second, quieter tell than the chip alone.
  drawLogo(ctx, x + size * 0.34, y + size * 0.3, size * 1.75,
    hot ? PAL.gold : INK, (hot ? 0.24 : 0.15) + 0.22 * fx.multPop);
  drawPrimoPortrait(ctx, x + size / 2, y + size * 0.62, size * 0.86, g.character, {
    img: g.customImage,
  });
  // inner vignette keeps the art from touching the frame
  const vig = ctx.createLinearGradient(0, y + size * 0.45, 0, y + size);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(6,3,12,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(x, y, size, size);
  ctx.restore();

  bevel(ctx, x, y, size, size, r, s, hot ? 'rgba(255,220,140,0.85)' : null);

  // combo progress to the next multiplier, tucked under the portrait
  const bw = size, bh = 5 * s, by = y + size + 5 * s;
  const maxed = g.multiplier >= SCORE.comboMax;
  const cp = maxed ? 1 : (g.combo % SCORE.comboStep) / SCORE.comboStep;
  track(ctx, x, by, bw, bh, bh / 2, s);
  if (cp > 0.001) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,201,60,0.7)';
    ctx.shadowBlur = (4 + 8 * fx.beerPop) * s;
    const cg = ctx.createLinearGradient(x, 0, x + bw, 0);
    cg.addColorStop(0, '#ffdf7d');
    cg.addColorStop(1, maxed ? '#ff7ad1' : PAL.gold);
    ctx.fillStyle = cg;
    roundRect(ctx, x, by, Math.max(bh, bw * cp), bh, bh / 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawPowerPills(ctx, g, x, bottom, s) {
  const entries = Object.entries(g.power).filter(([, v]) => v > 0);
  if (!entries.length) return;
  const h = 34 * s;
  const w = 132 * s;
  let y = bottom - h;

  ctx.save();
  for (const [key, remaining] of entries) {
    const def = POWER[key];
    const k = clamp01(remaining / def.time);
    const dying = remaining < 2.5;
    const blink = dying ? 0.55 + 0.45 * Math.sin(fx.t * 16) : 1;

    ctx.save();
    ctx.globalAlpha = blink;

    // shell
    ctx.save();
    ctx.shadowColor = 'rgba(4,2,9,0.6)';
    ctx.shadowBlur = 10 * s;
    ctx.shadowOffsetY = 3 * s;
    const shell = ctx.createLinearGradient(0, y, 0, y + h);
    shell.addColorStop(0, 'rgba(40,26,56,0.86)');
    shell.addColorStop(1, 'rgba(10,6,18,0.9)');
    ctx.fillStyle = shell;
    roundRect(ctx, x, y, w, h, h * 0.3);
    ctx.fill();
    ctx.restore();

    // time remaining drains right-to-left through a tinted wash
    const fw = Math.max(0, w * k);
    if (fw > 1) {
      ctx.save();
      roundRect(ctx, x, y, w, h, h * 0.3);
      ctx.clip();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = def.color;
      ctx.fillRect(x, y, fw, h);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = def.color;                 // bright leading edge
      ctx.fillRect(x + fw - 2 * s, y, 2 * s, h);
      ctx.restore();
      stripes(ctx, x, y + h * 0.06, fw, h * 0.88, s, 0.07);
    }

    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 8 * s * blink;
    ctx.strokeStyle = def.color;
    ctx.lineWidth = Math.max(1, 1.5 * s);
    roundRect(ctx, x + s, y + s, w - 2 * s, h - 2 * s, h * 0.29);
    ctx.stroke();
    ctx.restore();
    bevel(ctx, x, y, w, h, h * 0.3, s);

    powerGlyph(ctx, key, x + 16 * s, y + h * 0.5, 15 * s, def.color);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const timer = remaining.toFixed(1);
    ctx.font = `900 ${Math.round(12 * s)}px ${FONT}`;
    const tw = ctx.measureText(timer).width;
    label(ctx, timer, x + w - 10 * s, y + h * 0.5, 12 * s,
      dying ? '#ffd7d7' : INK, { weight: 900, halo: 2.6 * s });

    // shrink the label rather than let a long power name run into the timer
    ctx.textAlign = 'left';
    const name = tr(POWER_LABEL[key]);
    const avail = w - 26 * s - tw - 16 * s;
    let fs = 10.5 * s;
    ctx.font = `900 ${Math.round(fs)}px ${FONT}`;
    const lw = ctx.measureText(name).width;
    if (lw > avail) fs *= avail / lw;
    // No tracking here — measureText above ignores letterSpacing, and the
    // extra width would push IMÁN PIÑATA into the timer.
    label(ctx, name, x + 27 * s, y + h * 0.5, fs, def.color,
      { weight: 900, halo: Math.max(2, fs * 0.3) });

    ctx.restore();
    y -= h + 8 * s;
  }
  ctx.restore();
}

/** Tiny 15px pictogram per power-up so the pills read at a glance. */
function powerGlyph(ctx, key, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.22;
  ctx.lineCap = 'round';
  if (key === 'magnet') {
    ctx.beginPath();
    ctx.arc(0, size * 0.06, size * 0.32, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 0.32, size * 0.06);
    ctx.lineTo(-size * 0.32, size * 0.34);
    ctx.moveTo(size * 0.32, size * 0.06);
    ctx.lineTo(size * 0.32, size * 0.34);
    ctx.stroke();
  } else if (key === 'chancla') {
    roundRect(ctx, -size * 0.24, -size * 0.36, size * 0.48, size * 0.72, size * 0.22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = size * 0.12;
    ctx.beginPath();
    ctx.moveTo(-size * 0.16, -size * 0.1);
    ctx.lineTo(size * 0.16, -size * 0.1);
    ctx.stroke();
  } else {
    roundRect(ctx, -size * 0.4, -size * 0.24, size * 0.8, size * 0.34, size * 0.12);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-size * 0.22, size * 0.2, size * 0.14, 0, Math.PI * 2);
    ctx.arc(size * 0.22, size * 0.2, size * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Corner brand mark, bottom-right — the one bit of HUD that is pure identity.
 *
 * Cornered rather than centred: the near field of the right lane sweeps
 * through here, and a mark anywhere nearer the middle would read as something
 * to dodge. The knockout variant is what makes it safe — the full disc would
 * punch a black hole in the road. Power pills live bottom-LEFT, so the two
 * never meet.
 *
 * 64px is a floor, not a preference. Below ~56 the shades and bandana collapse
 * into the outer ring and the mark reads as a smudge, so shrinking this is not
 * a way to make it subtler — dropping the alpha is.
 */
function drawWatermark(ctx, W, H, pad, s) {
  const size = 64 * s;
  drawLogo(ctx, W - pad - size * 0.5, H - pad - size * 0.5, size, INK, 0.26);
}

function drawToasts(ctx, W, H, s, dt) {
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i];
    t.age += dt;
    if (t.age >= t.life) { toasts.splice(i, 1); continue; }
    const k = t.age / t.life;
    const rise = k * 38 * s;
    const y = H * 0.34 - rise - i * 32 * s;
    // punchy entrance, gentle exit
    const inK = Math.min(1, t.age / 0.14);
    const scale = 1 + 0.35 * (1 - inK) * (1 - inK) + 0.06 * Math.sin(inK * Math.PI);

    ctx.save();
    ctx.globalAlpha = (k < 0.12 ? k / 0.12 : 1) * Math.min(1, (1 - k) / 0.32);
    ctx.translate(W / 2, y);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    label(ctx, t.text, 0, 0, 23 * s, t.color, {
      weight: 900, halo: 5.5 * s, haloColor: 'rgba(8,4,14,0.8)',
    });
    // second pass adds the coloured bloom the halo would otherwise eat
    ctx.globalAlpha *= 0.55;
    label(ctx, t.text, 0, 0, 23 * s, t.color, {
      weight: 900, halo: 0, glow: t.color, glowSize: 16 * s,
    });
    ctx.restore();
  }
}
