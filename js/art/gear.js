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

const TAU = Math.PI * 2;

// The head's own edge treatment, byte-for-byte (js/art/head-back.js): a warm
// catch nudged up, a dark hold-off under it. The mask replaces the hair
// silhouette, so it has to bring the silhouette's edge language with it.
const RIM = 'rgba(255,178,98,0.60)';
const KEY = 'rgba(30,17,42,0.60)';

/**
 * Cel tones derived from a mask colourway once and stashed on the entry —
 * this draw runs every frame and tintA builds strings. Dark colourways need
 * the light tone pushed harder: 1.9× of near-black is still near-black.
 * (Chains don't come through here — their deep/gleam tones are authored.)
 */
function tones(st) {
  if (!st._t) {
    st._t = {
      dark: tintA(st.base, 0.68, 1),
      light: tintA(st.base, 1.9 + (st.sheen || 0) * 1.5, 1),
    };
  }
  return st._t;
}

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
 * The back of a masked head: a smooth knit dome swallowing skull and ears,
 * a rolled hem hugging the nape, one crown sheen. That is the whole drawing.
 *
 * The first version textured the dome with full-ellipse "knit courses" and
 * lit it with a radial gradient — at 75px the courses were scribbled loops on
 * a shiny balloon. Same lesson as every hat in head-back.js: the interior of
 * the shape carries nothing; the hem and the sheen carry everything. So the
 * dome is now cel-filled exactly the way the body's materials are (shadow
 * tone, then the same shape offset toward the light), the sheen is the proven
 * tapered band riding the crown, and the only knit left is a run of short
 * ribs on the hem roll — dark and radial, so they can never pair into a face.
 *
 * @param {CanvasRenderingContext2D} c
 * @param {number} x skull centre, screen px
 * @param {number} y skull centre, screen px
 * @param {number} r skull radius, screen px (head-back's 0.345 · size)
 * @param {object} st a mask entry from GEAR_STYLE
 */
export function drawMaskBack(c, x, y, r, st) {
  if (!st) return;
  const T = tones(st);
  // Knit sits proud of the scalp and widest LOW — a pasamontañas covers the
  // ears outright, so the dome must reach past where head-back puts them.
  const rx = r * 1.10, ry = r * 1.14;
  const cy = y + r * 0.03;

  c.save();

  // Edge: the head's own two-fill treatment, warm catch then dark hold-off,
  // because this dome IS the head silhouette while it is worn.
  c.fillStyle = RIM;
  c.beginPath();
  c.ellipse(x, cy - r * 0.06, rx * 1.045, ry * 1.045, 0, 0, TAU);
  c.fill();
  c.fillStyle = KEY;
  c.beginPath();
  c.ellipse(x, cy, rx * 1.03, ry * 1.03, 0, 0, TAU);
  c.fill();

  // Dome, two-tone cel: offset copy, never inset, never a gradient.
  c.beginPath();
  c.ellipse(x, cy, rx, ry, 0, 0, TAU);
  c.fillStyle = T.dark;
  c.fill();
  c.save();
  c.clip();
  c.translate(-r * 0.09, -r * 0.11);
  c.beginPath();
  c.ellipse(x, cy, rx, ry, 0, 0, TAU);
  c.fillStyle = st.base;
  c.fill();
  c.restore();

  // Crown sheen — head-back's band-that-follows-the-crown, in the knit's
  // light tone. Two unequal tapered arcs, broken off-centre; the break is
  // what keeps the pair from pairing up. st.sheen is the material's gloss:
  // gold catches harder than wool.
  c.save();
  c.globalAlpha = Math.min(0.85, 0.42 + st.sheen * 1.1);
  c.fillStyle = T.light;
  const OUT = 0.90, FAT = 0.20, N = 10;
  for (const [a0, a1, k] of [[Math.PI * 1.08, Math.PI * 1.40, 1],
    [Math.PI * 1.52, Math.PI * 1.68, 0.72]]) {
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = a0 + (a1 - a0) * (i / N);
      const px = x + Math.cos(a) * rx * OUT, py = cy + Math.sin(a) * ry * OUT;
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    for (let i = N; i >= 0; i--) {
      const t = i / N;
      const a = a0 + (a1 - a0) * t;
      const rr = OUT - FAT * k * Math.pow(Math.sin(t * Math.PI), 0.7);
      c.lineTo(x + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr);
    }
    c.closePath();
    c.fill();
  }
  c.restore();

  // The fold crease the roll casts on the dome, just above where the hem
  // lands. Dark, clipped inside the dome — the value break that stops hem
  // and dome reading as one blob (the cap's hard-shadow trick).
  c.save();
  c.beginPath();
  c.ellipse(x, cy, rx, ry, 0, 0, TAU);
  c.clip();
  c.fillStyle = hexA('#000000', 0.20);
  c.beginPath();
  hemEdge(c, x, cy, rx, ry, 0.84, -0.03, true);
  hemEdge(c, x, cy, rx, ry, 0.72, 0.05, false);
  c.closePath();
  c.fill();
  c.restore();

  // Rolled hem: a crescent hugging the lower contour, sticking a little proud
  // — a roll is fatter than the knit above it. Never a full ellipse; the old
  // hem's upper arc crossed the skull as one more scribble.
  c.beginPath();
  hemEdge(c, x, cy, rx, ry, 1.055, -0.045, true);
  hemEdge(c, x, cy, rx, ry, 0.855, 0.09, false);
  c.closePath();
  c.fillStyle = st.hem;
  c.fill();

  // Rib ticks across the roll. Radial and dark: nothing running up and down
  // can be read as a face, which is why the cap's seams are vertical too.
  c.strokeStyle = hexA('#000000', 0.26);
  c.lineWidth = Math.max(0.8, r * 0.045);
  c.lineCap = 'round';
  c.beginPath();
  for (let i = -3; i <= 3; i++) {
    const a = Math.PI * 0.5 + i * 0.155;
    const wob = 0.02 * ((i & 1) ? 1 : -1);
    c.moveTo(x + Math.cos(a) * rx * (0.88 + wob), cy + Math.sin(a) * ry * (0.88 + wob) + r * 0.045);
    c.lineTo(x + Math.cos(a) * rx * (1.03 + wob), cy + Math.sin(a) * ry * (1.03 + wob));
  }
  c.stroke();

  c.restore();
}

/**
 * One edge of the hem crescent: an arc across the bottom of the dome at
 * radius factor `f`, thickness varied by `taper` so the band is fattest at
 * the nape and thins as it climbs. `fwd` traces left-to-right, else back.
 */
function hemEdge(c, x, cy, rx, ry, f, taper, fwd) {
  const A0 = Math.PI * 0.20, A1 = Math.PI * 0.80, HN = 12;
  for (let i = 0; i <= HN; i++) {
    const t = fwd ? i / HN : 1 - i / HN;
    const a = A0 + (A1 - A0) * t;
    const ff = f + taper * Math.abs(2 * t - 1);
    const px = x + Math.cos(a) * rx * ff;
    const py = cy + Math.sin(a) * ry * ff;
    if (!fwd || i) c.lineTo(px, py); else c.moveTo(px, py);
  }
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
 * The back of a worn chain. `x, y` is the SKULL CENTRE and `r` the head
 * radius — the same anchor the mask takes — because the strand is drawn as
 * the visible arc of a loop AROUND that ball: snug under it, ends climbing
 * steeply until they tuck in at the silhouette just below the ears,
 * foreshortening and darkening as they turn away toward the front. The eye
 * completes the loop behind the head, which is what "worn" looks like.
 *
 * The first version hung a garland ACROSS the back — wide span, deep middle
 * sag, ends afloat on the shirt — and a strand lying on the back surface is
 * exactly what a necklace that has slid off the shoulders does.
 *
 * Links are batched: one understrand stroke, one shadow fill, one lit fill
 * offset toward the light, one gleam fill. The old per-link radial gradients
 * were both off-language and ~10 allocations a frame.
 */
export function drawChainBack(c, x, y, r, st) {
  if (!st) return;
  const fat = !!st.fat;
  const N = fat ? 15 : 21;
  // Strand ellipse, centred LOW on the skull so the visible arc hangs just
  // clear of the mask hem / hairline, with its ends bending back inside the
  // head's contour. TUCK is how far past the visible sweep the end links
  // carry on — the couple that overlap the silhouette and sell the wrap.
  const ox = x, oy = y + r * 0.41;
  const ax = r * 0.88, ay = r * 0.93;
  const TM = 1.26;
  const lr0 = r * (fat ? 0.115 : 0.075);

  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // Pass 0: the understrand — a continuous line through every link centre.
  // This is what makes separated circles read as ONE chain, and it is the
  // dark edge that holds the gold against the white tee.
  c.strokeStyle = st.deep;
  c.lineWidth = Math.max(1, lr0 * 1.1);
  c.beginPath();
  for (let i = 0; i < N; i++) {
    const th = -TM + (2 * TM * i) / (N - 1);
    const px = ox + Math.sin(th) * ax;
    const py = oy + Math.cos(th) * ay;
    if (i) c.lineTo(px, py); else c.moveTo(px, py);
  }
  c.stroke();

  // Passes 1–3 share the same link geometry.
  for (let pass = 1; pass <= 3; pass++) {
    c.beginPath();
    for (let i = 0; i < N; i++) {
      const th = -TM + (2 * TM * i) / (N - 1);
      const turn = Math.abs(th) / TM;
      // Foreshorten toward the ends: the strand is turning away from us.
      const k = 1 - 0.34 * Math.pow(turn, 2.2);
      const px = ox + Math.sin(th) * ax;
      const py = oy + Math.cos(th) * ay;
      const lr = lr0 * k;
      if (pass === 1) {
        // Shadow body of every link.
        if (fat) {
          const rot = Math.atan2(ay * Math.sin(th), ax * Math.cos(th));
          c.moveTo(px + lr * 1.3, py);
          c.ellipse(px, py, lr * 1.3, lr * 0.92, rot, 0, TAU);
        } else {
          c.moveTo(px + lr, py);
          c.arc(px, py, lr, 0, TAU);
        }
      } else if (pass === 2) {
        // Lit copy, offset toward the light — skipped on the end links,
        // which stay in shadow because they face away.
        if (turn > 0.86) continue;
        const lx = px - r * 0.030, ly = py - r * 0.038;
        if (fat) {
          const rot = Math.atan2(ay * Math.sin(th), ax * Math.cos(th));
          c.moveTo(lx + lr, ly);
          c.ellipse(lx, ly, lr, lr * 0.68, rot, 0, TAU);
        } else {
          c.moveTo(lx + lr * 0.74, ly);
          c.arc(lx, ly, lr * 0.74, 0, TAU);
        }
      } else {
        // Gleam: every fat link is a pearl with one hot point; on the fine
        // chain a few catches along the top are plenty.
        if (turn > 0.8 || (!fat && i % 3)) continue;
        c.moveTo(px - r * 0.040 + lr * 0.3, py - r * 0.050);
        c.arc(px - r * 0.040, py - r * 0.050, lr * 0.3, 0, TAU);
      }
    }
    c.fillStyle = pass === 1 ? st.deep : pass === 2 ? st.link : st.gleam;
    if (pass === 3) c.globalAlpha = 0.9;
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
