// El fit — the gear a player buys at la tiendita and wears on the run.
// Draw code only: what gear EXISTS and costs lives in js/tiendita.js
// (GEAR_CATALOG), what a player OWNS and WEARS lives in js/wallet.js.
//
// Two draw surfaces per piece, and they are different pictures on purpose:
//   · the shop icon looks AT you — a mask shows its eye opening, a chain its
//     clasp — because a shop sells the idea of the thing;
//   · the in-run draw is seen FROM BEHIND, like everything on the runner, and
//     composes with the sphere-chain rig in js/art/runner.js: a mask is a knit
//     dome fitted over the head sphere, a chain is links across the nape.
//
// The mask deliberately REPLACES the hair/hat silhouette (js/art/head-back.js
// skips itself when one is worn): a pasamontañas over a fitted cap is two hats.
// Outfit colours stay sampled from the player's PFP, so the runner is still
// recognisably theirs — that trade is documented in docs/GAME_DESIGN.md.

import { hexA, tintA } from './palette.js';

/**
 * Colourways, keyed by the catalog's `style` field — NOT by item id, so a
 * future "Pasamontañas Azul" is one catalog row plus one entry here and no
 * drawing code at all.
 * base: the knit; hem: the ribbed band; sheen: highlight tint strength.
 */
export const GEAR_STYLE = {
  maskNegro: { base: '#23252d', hem: '#3a3d49', sheen: 0.10 },
  maskRosa:  { base: '#ff4d9d', hem: '#c22e73', sheen: 0.16 },
  maskOro:   { base: '#ffc93c', hem: '#c98f1a', sheen: 0.30 },
  chainOro:  { link: '#ffc93c', deep: '#c98f1a', gleam: '#fff3c4', fat: false },
  chainCubana: { link: '#ffd75e', deep: '#b07b10', gleam: '#fff7d6', fat: true },
};

// ------------------------------------------------------------------ the mask

/**
 * The back of a masked head: knit dome over the head sphere, ribbed hem at the
 * nape, a few knit courses so it reads as fabric rather than paint.
 *
 * Drawn OVER the head sphere the rig already painted, in the same lighting
 * language the body uses (top-lit, depth-shaded). `r` is the head sphere's
 * screen radius; x/y its centre.
 *
 * @param {CanvasRenderingContext2D} c
 * @param {number} x head centre, screen px
 * @param {number} y head centre, screen px
 * @param {number} r head radius, screen px
 * @param {object} st a mask entry from GEAR_STYLE
 */
export function drawMaskBack(c, x, y, r, st) {
  if (!st) return;
  const R = r * 1.06;                     // knit sits proud of the scalp
  c.save();

  // Dome. One path, one fill — the union-fill rule the whole body obeys.
  c.beginPath();
  c.arc(x, y, R, 0, Math.PI * 2);
  const g = c.createRadialGradient(x - R * 0.35, y - R * 0.45, R * 0.15, x, y, R * 1.05);
  g.addColorStop(0, tintA(st.base, 1 + st.sheen * 1.6, 1));
  g.addColorStop(0.62, st.base);
  g.addColorStop(1, tintA(st.base, 0.62, 1));
  c.fillStyle = g;
  c.fill();

  // Knit courses — horizontal rows that follow the dome. Kept faint: texture,
  // not stripes.
  c.clip();
  c.strokeStyle = hexA('#000000', 0.14);
  c.lineWidth = Math.max(1, R * 0.045);
  for (let i = -2; i <= 3; i++) {
    const yy = y + i * R * 0.30;
    const squash = Math.max(0.2, 1 - Math.abs(i) * 0.18);
    c.beginPath();
    c.ellipse(x, yy, R * 0.98, R * 0.34 * squash, 0, 0, Math.PI * 2);
    c.stroke();
  }

  // Ribbed hem at the nape — the fold that says "this rolls down".
  const hemY = y + R * 0.62;
  c.fillStyle = st.hem;
  c.beginPath();
  c.ellipse(x, hemY, R * 0.99, R * 0.34, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = hexA('#000000', 0.22);
  c.lineWidth = Math.max(1, R * 0.05);
  for (let i = -3; i <= 3; i++) {
    const xx = x + i * R * 0.26;
    c.beginPath();
    c.moveTo(xx, hemY - R * 0.30);
    c.lineTo(xx, hemY + R * 0.30);
    c.stroke();
  }
  c.restore();
}

/**
 * Shop icon: the mask facing you, eye opening and all — the thing being sold.
 * `w` is the tile size; the icon centres itself.
 */
export function drawMaskIcon(c, w, st) {
  if (!st) return;
  const x = w / 2, y = w * 0.52, R = w * 0.32;
  // Head-shaped dome, slightly tall.
  c.beginPath();
  c.ellipse(x, y, R * 0.92, R * 1.08, 0, 0, Math.PI * 2);
  const g = c.createLinearGradient(0, y - R, 0, y + R);
  g.addColorStop(0, tintA(st.base, 1 + st.sheen * 1.6, 1));
  g.addColorStop(1, tintA(st.base, 0.7, 1));
  c.fillStyle = g;
  c.fill();
  // Eye opening — one rounded band, the pasamontañas signature.
  c.fillStyle = '#12131a';
  const ew = R * 1.16, eh = R * 0.42, ey = y - R * 0.28;
  c.beginPath();
  if (c.roundRect) c.roundRect(x - ew / 2, ey - eh / 2, ew, eh, eh / 2);
  else c.rect(x - ew / 2, ey - eh / 2, ew, eh);
  c.fill();
  // Eyes in the dark, so the icon has a face and a little menace.
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.ellipse(x - R * 0.34, ey, R * 0.10, R * 0.13, 0, 0, Math.PI * 2);
  c.ellipse(x + R * 0.34, ey, R * 0.10, R * 0.13, 0, 0, Math.PI * 2);
  c.fill();
  // Ribbed hem.
  c.fillStyle = st.hem;
  c.beginPath();
  c.ellipse(x, y + R * 0.92, R * 0.86, R * 0.24, 0, 0, Math.PI * 2);
  c.fill();
}

// ----------------------------------------------------------------- the chain

/**
 * The back of a worn chain: a run of round links across the nape, hanging
 * between the head and the shoulder line. `x, y` is the neck point (base of
 * the head sphere), `r` the head radius for scale.
 */
export function drawChainBack(c, x, y, r, st) {
  if (!st) return;
  const links = st.fat ? 7 : 9;
  const span = r * 1.7;
  const sag = r * (st.fat ? 0.34 : 0.26);
  const lr = r * (st.fat ? 0.16 : 0.10);
  c.save();
  for (let i = 0; i < links; i++) {
    const t = i / (links - 1);
    const lx = x - span / 2 + span * t;
    // Catenary-ish sag — parabola is plenty at this size.
    const ly = y + sag * (1 - Math.pow(2 * t - 1, 2) * 0.9);
    const g = c.createRadialGradient(lx - lr * 0.4, ly - lr * 0.4, lr * 0.2, lx, ly, lr * 1.1);
    g.addColorStop(0, st.gleam);
    g.addColorStop(0.5, st.link);
    g.addColorStop(1, st.deep);
    c.fillStyle = g;
    c.beginPath();
    c.arc(lx, ly, lr, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** Shop icon: the chain in full, clasp to clasp, with its pendant of a hoop. */
export function drawChainIcon(c, w, st) {
  if (!st) return;
  const x = w / 2, top = w * 0.30, R = w * 0.26;
  const links = st.fat ? 9 : 13;
  const lr = w * (st.fat ? 0.055 : 0.038);
  for (let i = 0; i < links; i++) {
    const a = Math.PI * (0.08 + 0.84 * (i / (links - 1)));
    const lx = x + Math.cos(a) * R * 1.25;
    const ly = top + Math.sin(a) * R * 1.35;
    const g = c.createRadialGradient(lx - lr * 0.4, ly - lr * 0.4, lr * 0.2, lx, ly, lr * 1.1);
    g.addColorStop(0, st.gleam);
    g.addColorStop(0.5, st.link);
    g.addColorStop(1, st.deep);
    c.fillStyle = g;
    c.beginPath();
    c.arc(lx, ly, lr, 0, Math.PI * 2);
    c.fill();
  }
}
