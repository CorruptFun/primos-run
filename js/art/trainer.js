// Corrupt — the Primo who runs the tutorial.
//
// He is a real PFP from the collection rather than a drawn mascot, so he arrives
// with an arcade photograph behind him. That backdrop cannot be keyed out: it is
// a genuine photo of lit arcade cabinets, not a flat colour, so a flood fill or
// a chroma threshold has nothing to grab. What works instead is framing — crop
// hard to a circle around his head and shoulders, then push the surviving
// backdrop back with a vignette and a desaturating wash so he reads as the
// subject and the arcade reads as depth behind him.
//
// Baked ONCE at load into a finished badge canvas. The tutorial draws it every
// frame, so nothing here may run per-frame.

const BASE = new URL('../../art/', import.meta.url).href;
const FILE = 'corrupt.jpg';
const SIZE = 256;

// Where he sits in the source, as fractions. Tuned to hold the horns and the
// shoulders without dragging in the slot machines at the edges.
const CROP = { cx: 0.50, cy: 0.44, r: 0.42 };

let badge = null;
let state = 'idle';     // idle | loading | ready | missing
let pending = null;

export function trainerReady() {
  return state === 'ready';
}

export const TRAINER_NAME = 'CORRUPT';

/** Idempotent. Resolves false (never rejects) if the art is missing. */
export function loadTrainer() {
  if (pending) return pending;
  state = 'loading';
  pending = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try { bake(img); state = 'ready'; } catch (e) { state = 'missing'; }
      resolve(state === 'ready');
    };
    img.onerror = () => { state = 'missing'; resolve(false); };
    img.src = BASE + FILE;
  });
  return pending;
}

function bake(img) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const x = c.getContext('2d');

  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const side = Math.min(sw, sh) * CROP.r * 2;
  const sx = CROP.cx * sw - side / 2;
  const sy = CROP.cy * sh - side / 2;

  x.save();
  x.beginPath();
  x.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  x.clip();
  x.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);

  // Knock the arcade back: a cool wash everywhere, heavier at the rim, so the
  // eye lands on his face rather than on a lit cabinet over his shoulder.
  const v = x.createRadialGradient(
    SIZE / 2, SIZE * 0.44, SIZE * 0.20, SIZE / 2, SIZE / 2, SIZE / 2);
  v.addColorStop(0, 'rgba(24,14,36,0)');
  v.addColorStop(0.62, 'rgba(24,14,36,0.28)');
  v.addColorStop(1, 'rgba(16,9,26,0.82)');
  x.fillStyle = v;
  x.fillRect(0, 0, SIZE, SIZE);
  x.restore();

  badge = c;
}

/**
 * Draw Corrupt as a circular badge, centred, with the game's gold ring.
 * Silently draws nothing until the art has landed.
 */
export function drawTrainer(ctx, cx, cy, size) {
  if (!badge) return false;
  const r = size * 0.5;

  // Soft drop so he sits above the card rather than printed on it.
  ctx.save();
  ctx.shadowColor = 'rgba(5,2,10,0.55)';
  ctx.shadowBlur = size * 0.16;
  ctx.shadowOffsetY = size * 0.04;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#12081c';
  ctx.fill();
  ctx.restore();

  ctx.drawImage(badge, cx - r, cy - r, r * 2, r * 2);

  ctx.strokeStyle = 'rgba(255,201,60,0.92)';
  ctx.lineWidth = Math.max(2, size * 0.035);
  ctx.beginPath();
  ctx.arc(cx, cy, r - ctx.lineWidth * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  return true;
}

loadTrainer();
