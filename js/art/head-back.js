// The back of a Primo's head.
//
// You are chasing this character down an alley, so what you should see is the
// back of their skull — hair, a beanie, a bandana knot, the nape of the neck.
// The old rig pasted the front-facing PFP crop onto the head instead, which put
// a face on the back of someone's head: uncanny, and it flattened the whole
// figure because a photographic crop cannot take the scene's light.
//
// Everything here is drawn from the same trait fields the collection art uses
// (hair, hairStyle, bandana, beanie, shades, hoops), so a Primo still reads as
// *their* Primo from behind. For a custom PFP those fields are sampled off the
// image by primo-head.js.
//
// The front-facing portrait is still correct for the menu tiles and the HUD
// badge — those look at you. This is only for the runner.

const TAU = Math.PI * 2;

/**
 * @param {CanvasRenderingContext2D} ctx  translated to the neck, already rotated
 * @param {number} size   head box size in px (DIM.headSize * H)
 * @param {object} rig    { hair, hairDark, hairStyle, skin, skinDark, bandana, beanie, hoops, shades }
 * @param {object} pose   { phase, airborne, laneLean }
 * @param {number} t      seconds, for hair swing
 */
export function drawBackHead(ctx, size, rig, pose) {
  const hair = rig.hair || '#221a1e';
  const hairDark = rig.hairDark || shade(hair, 0.62);
  const hairLight = rig.hairLight || shade(hair, 1.45);
  const skin = rig.skin || '#b9784e';
  const skinDark = rig.skinDark || shade(skin, 0.76);
  const style = rig.hairStyle || 'messy';

  // Skull centre, in the head box. Sits high — the neck occupies the bottom.
  const cx = 0;
  const cy = -size * 0.40;
  const rx = size * 0.335;
  const ry = size * 0.365;

  // Hair swings a beat behind the stride. Small: at running speed the head is
  // the most stable part of the body, and overdoing this reads as a wobble.
  const swing = Math.sin((pose.phase || 0) * TAU) * 0.05 + (pose.laneLean || 0) * 0.10;

  // ---------------------------------------------------------------- neck
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.82, rx * 0.42, ry * 0.42, 0, 0, TAU);
  ctx.fill();

  // ---------------------------------------------------------------- ears
  // Seen from behind, ears read as two small notches at the silhouette edge.
  for (const s of [-1, 1]) {
    ctx.fillStyle = s < 0 ? skin : skinDark;
    ctx.beginPath();
    ctx.ellipse(cx + s * rx * 0.94, cy + ry * 0.12, rx * 0.15, ry * 0.22, 0, 0, TAU);
    ctx.fill();
  }
  if (rig.hoops) drawHoops(ctx, cx, cy, rx, ry, rig.hoops);

  // ------------------------------------------------------------ hair mass
  if (style === 'beanie' && rig.beanie) {
    drawBeanie(ctx, cx, cy, rx, ry, rig.beanie, hair, hairDark, size);
  } else {
    drawHairMass(ctx, cx, cy, rx, ry, hair, hairDark, hairLight, style, swing, size);
  }

  // -------------------------------------------------------------- bandana
  if (rig.bandana) drawBandana(ctx, cx, cy, rx, ry, rig.bandana, swing, size);

  // Temple arms of a pair of shades, hooking over the ears.
  if (rig.shades) {
    ctx.strokeStyle = rig.shades;
    ctx.lineWidth = Math.max(1, size * 0.028);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * rx * 0.86, cy + ry * 0.02);
      ctx.lineTo(cx + s * rx * 1.0, cy + ry * 0.16);
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------ back light
  // The sun is down the alley ahead, so the figure is backlit: a warm rim runs
  // round the silhouette and the middle of the skull stays cool. This is what
  // ties the head to the scene, and it is exactly what a baked photo crop
  // could never do.
  const rim = ctx.createRadialGradient(cx, cy - ry * 0.1, rx * 0.2, cx, cy, rx * 1.16);
  rim.addColorStop(0, 'rgba(24,12,34,0.30)');
  rim.addColorStop(0.62, 'rgba(24,12,34,0.05)');
  rim.addColorStop(0.9, 'rgba(255,186,120,0.34)');
  rim.addColorStop(1, 'rgba(255,206,150,0.05)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 1.2, ry * 1.2, 0, 0, TAU);
  ctx.fill();
}

// ------------------------------------------------------------------ pieces

function drawHairMass(ctx, cx, cy, rx, ry, hair, hairDark, hairLight, style, swing, size) {
  // Base skull in hair colour, slightly wider than the skin beneath so no bare
  // scalp shows at the edge.
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();

  // A cool underside so the mass has volume rather than reading as a decal.
  ctx.fillStyle = hairDark;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.34, rx * 0.96, ry * 0.62, 0, 0, TAU);
  ctx.fill();

  if (style === 'long') {
    // Falls behind the shoulders, swinging with the stride.
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.98, cy);
    ctx.quadraticCurveTo(cx - rx * 1.16 + swing * size, cy + ry * 1.5,
      cx - rx * 0.52 + swing * size, cy + ry * 2.05);
    ctx.lineTo(cx + rx * 0.52 + swing * size, cy + ry * 2.05);
    ctx.quadraticCurveTo(cx + rx * 1.16 + swing * size, cy + ry * 1.5,
      cx + rx * 0.98, cy);
    ctx.closePath();
    ctx.fill();
    // Parting down the middle of the fall.
    ctx.strokeStyle = hairDark;
    ctx.lineWidth = Math.max(1, size * 0.022);
    ctx.beginPath();
    ctx.moveTo(cx, cy + ry * 0.5);
    ctx.lineTo(cx + swing * size * 0.8, cy + ry * 1.9);
    ctx.stroke();
  } else if (style === 'pony') {
    // Gathered tie, then the tail. The tail is the one piece of the character
    // with real secondary motion, so it carries most of the sense of speed.
    ctx.fillStyle = hairDark;
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.30, rx * 0.30, ry * 0.20, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.26, cy + ry * 0.34);
    ctx.quadraticCurveTo(cx - rx * 0.5 + swing * size * 2.2, cy + ry * 1.25,
      cx - rx * 0.16 + swing * size * 3.0, cy + ry * 1.92);
    ctx.lineTo(cx + rx * 0.30 + swing * size * 3.0, cy + ry * 1.86);
    ctx.quadraticCurveTo(cx + rx * 0.44 + swing * size * 2.2, cy + ry * 1.1,
      cx + rx * 0.26, cy + ry * 0.34);
    ctx.closePath();
    ctx.fill();
  } else {
    // 'messy' — a tufted silhouette. Lobes ride the crown to break the outline
    // up, but they have to TAPER toward the sides: equal-sized lobes at the
    // ends of the arc sit exactly where ears would be and the head reads as
    // wearing two buns. Small, many, and smallest at the extremes.
    ctx.fillStyle = hair;
    const N = 11;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);                       // 0..1 across the crown
      const a = -Math.PI * 0.88 + k * Math.PI * 0.76;
      // taper: full size over the top, shrinking to nothing at either side
      const taper = Math.sin(k * Math.PI);
      const r = rx * (0.07 + 0.11 * taper) * (0.75 + ((i * 37) % 7) / 12);
      const px = cx + Math.cos(a) * rx * 0.9;
      const py = cy + Math.sin(a) * ry * 0.9;
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 0.9, a, 0, TAU);
      ctx.fill();
    }
    // A couple of loose strands lifting off the crown in the slipstream.
    ctx.strokeStyle = hair;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, rx * 0.055);
    for (let i = 0; i < 3; i++) {
      const bx = cx + (i - 1) * rx * 0.34;
      ctx.beginPath();
      ctx.moveTo(bx, cy - ry * 0.86);
      ctx.quadraticCurveTo(
        bx - swing * size * 1.4 - rx * 0.1, cy - ry * 1.12,
        bx - swing * size * 2.4 - rx * 0.24, cy - ry * 1.05);
      ctx.stroke();
    }
  }

  // Sheen across the crown, where the sky catches it.
  const g = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry * 0.2);
  g.addColorStop(0, withA(hairLight, 0.42));
  g.addColorStop(1, withA(hairLight, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.16, rx * 0.82, ry * 0.66, 0, 0, TAU);
  ctx.fill();
}

function drawBeanie(ctx, cx, cy, rx, ry, beanie, hair, hairDark, size) {
  // Hair showing under the back of the cap.
  ctx.fillStyle = hairDark;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.30, rx * 1.0, ry * 0.72, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = beanie;
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.06, rx * 1.04, ry * 0.98, 0, 0, TAU);
  ctx.fill();

  // Knit ribbing — vertical, following the curve of the skull.
  ctx.strokeStyle = withA(shade(beanie, 0.78), 0.55);
  ctx.lineWidth = Math.max(0.8, size * 0.016);
  for (let i = -3; i <= 3; i++) {
    const x = cx + i * rx * 0.26;
    ctx.beginPath();
    ctx.moveTo(x, cy - ry * 0.9);
    ctx.quadraticCurveTo(x + i * rx * 0.03, cy, x, cy + ry * 0.5);
    ctx.stroke();
  }

  // Rolled brim.
  ctx.fillStyle = shade(beanie, 1.18);
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.42, rx * 1.06, ry * 0.28, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = withA(shade(beanie, 0.6), 0.5);
  ctx.lineWidth = Math.max(0.7, size * 0.012);
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.42, rx * 1.06, ry * 0.28, 0, 0, TAU);
  ctx.stroke();
}

function drawBandana(ctx, cx, cy, rx, ry, col, swing, size) {
  // Band around the crown.
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.30, rx * 1.02, ry * 0.42, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = withA('#000000', 0.18);
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.16, rx * 1.0, ry * 0.2, 0, 0, TAU);
  ctx.fill();

  // Knot at the back of the head, with two tails trailing in the slipstream.
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(cx + rx * 0.1, cy - ry * 0.12, rx * 0.22, ry * 0.2, 0, 0, TAU);
  ctx.fill();

  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + rx * 0.06, cy - ry * 0.1);
    ctx.quadraticCurveTo(
      cx + s * rx * 0.5 + swing * size * 1.6, cy + ry * 0.42,
      cx + s * rx * 0.34 + swing * size * 2.4, cy + ry * 0.96);
    ctx.lineTo(cx + s * rx * 0.06 + swing * size * 2.4, cy + ry * 0.86);
    ctx.quadraticCurveTo(
      cx + s * rx * 0.24 + swing * size * 1.6, cy + ry * 0.4,
      cx + rx * 0.14, cy - ry * 0.06);
    ctx.closePath();
    ctx.fill();
  }
}

function drawHoops(ctx, cx, cy, rx, ry, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, rx * 0.075);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * rx * 0.97, cy + ry * 0.34, rx * 0.15, ry * 0.19, 0, 0, TAU);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ colour

function shade(col, k) {
  const [r, g, b] = parse(col);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function withA(col, a) {
  const [r, g, b] = parse(col);
  return `rgba(${r},${g},${b},${a})`;
}

function parse(col) {
  if (col[0] === '#') {
    const n = parseInt(col.slice(1), 16);
    return col.length === 4
      ? [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
      : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = col.match(/(\d+(?:\.\d+)?)/g);
  return m ? [+m[0], +m[1], +m[2]] : [34, 26, 30];
}
