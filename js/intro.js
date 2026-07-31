// The start sequence: a hero shot from IN FRONT, then a whip around to the chase.
//
// This exists for a specific reason. The whole game is played from behind the
// runner, so the Primo's face — the thing a holder actually owns and recognises
// — is never once on screen. Opening with the camera ahead of them buys that
// face two seconds of screen time before the alley swallows it, and it makes the
// hand-off into gameplay read as a camera move rather than as a loading screen.
//
// The pursuers behind are drawn as flat silhouettes on purpose. They are running
// TOWARD the camera in this shot, and the runner rig only knows how to draw a
// back view; a silhouette sidesteps that entirely and reads as more menacing
// than a fully lit figure would at this size.
//
// The alley underneath keeps scrolling throughout, so the sequence never feels
// like a still frame with animation pasted on top.

import { drawPrimoPortrait } from './art/runner.js';
import { drawIceAgent } from './art/ice.js';
import { PAL } from './art/palette.js';
// Aliased: this module already uses `t` for elapsed seconds, and importing
// the translator under that name is a hard redeclaration error that takes the
// whole game down at parse time.
import { t as tr } from './i18n.js';

const TAU = Math.PI * 2;

// Beat boundaries, seconds. HERO holds the face; WHIP swings the camera behind;
// SETTLE lands in the gameplay framing and hands over.
const HERO = 1.45;
const WHIP = 0.85;
const SETTLE = 0.45;
export const INTRO_TIME = HERO + WHIP + SETTLE;

let t = 0;
let active = false;
let character = null;
let customImg = null;
let displayName = '';

export function startIntro(game) {
  t = 0;
  active = true;
  character = game.character;
  customImg = game.customImage;
  // Set by main.js when a slot is showing real collection art.
  displayName = game.displayName || (game.character && game.character.name) || tr('intro.primo');
}

export function introActive() {
  return active;
}

/** 0 during the hero shot, ramping to 1 across the whip. Drives the hand-off. */
export function introTurn() {
  if (t <= HERO) return 0;
  return Math.min(1, (t - HERO) / WHIP);
}

/** True while the front-facing hero runner owns the screen. */
export function introOwnsRunner() {
  return active && introTurn() < 0.55;
}

export function updateIntro(dt) {
  if (!active) return false;
  t += dt;
  if (t >= INTRO_TIME) { active = false; return false; }
  return true;
}

export function stopIntro() {
  active = false;
}

// ------------------------------------------------------------------- drawing

export function drawIntro(ctx, W, H) {
  if (!active) return;
  const turn = introTurn();
  const heroK = Math.min(1, t / 0.35);              // fade the hero shot in

  ctx.save();

  // A vignette + warm push that lifts the whole frame out of gameplay grading.
  // It lifts away as the whip completes, so gameplay starts perfectly clean.
  const cinematic = 1 - turn;
  if (cinematic > 0.01) {
    const v = ctx.createRadialGradient(W / 2, H * 0.52, H * 0.16, W / 2, H * 0.52, H * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(8,4,14,${0.55 * cinematic})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  drawPursuers(ctx, W, H, turn);
  drawHero(ctx, W, H, turn, heroK);
  drawWhipLines(ctx, W, H, turn);
  drawTitle(ctx, W, H, heroK, turn);

  ctx.restore();
}

/**
 * The Primo, front on. drawPrimoPortrait is the same head-and-shoulders art the
 * menu tiles and the HUD badge use, which is exactly right here — it is the only
 * view of the character that faces the player, and this is its one moment.
 */
function drawHero(ctx, W, H, turn, heroK) {
  if (turn >= 0.55) return;                     // handed off to the game runner
  const fade = 1 - Math.max(0, (turn - 0.25) / 0.30);

  const bob = Math.sin(t * 13) * H * 0.006;     // running bounce
  // Bounded by WIDTH as well as height. A phone in portrait is tall and narrow,
  // and sizing the hero off H alone puts a head across two thirds of the screen.
  const size = Math.min(W * 0.56, H * 0.30) * (0.92 + heroK * 0.08);
  const cx = W * 0.5 + turn * W * 0.85;         // slides out as the camera swings
  const cy = H * 0.62 + bob;

  ctx.save();
  ctx.globalAlpha = heroK * fade;

  // Contact shadow so the hero is standing in the alley, not floating over it.
  ctx.fillStyle = 'rgba(10,5,16,0.42)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.52, size * 0.34, size * 0.08, 0, 0, TAU);
  ctx.fill();

  // Warm backlight behind the head — the sun is down the alley behind them.
  const halo = ctx.createRadialGradient(cx, cy - size * 0.1, 0, cx, cy - size * 0.1, size * 0.72);
  halo.addColorStop(0, 'rgba(255,190,120,0.34)');
  halo.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.1, size * 0.72, 0, TAU);
  ctx.fill();

  // Squash the portrait horizontally as the camera comes round, so the face
  // turns away rather than simply sliding off the edge.
  const squash = Math.max(0.12, 1 - turn * 1.9);
  ctx.translate(cx, cy);
  ctx.scale(squash, 1);

  if (customImg) {
    // The real Primo. Drawn straight rather than through drawPrimoPortrait,
    // which composites the drawn stand-in features over the top — this is the
    // one shot in the whole game that shows the actual artwork, so nothing is
    // painted on it.
    const r = size * 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    const sw = customImg.naturalWidth || customImg.width;
    const sh = customImg.naturalHeight || customImg.height;
    const side = Math.min(sw, sh);
    // Centre-weighted square crop, biased up to favour the face over the chest.
    ctx.drawImage(customImg, (sw - side) / 2, (sh - side) * 0.10, side, side,
      -r, -r, r * 2, r * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,201,60,0.9)';
    ctx.lineWidth = Math.max(2, size * 0.022);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
  } else {
    drawPrimoPortrait(ctx, 0, 0, size, character, { img: null });
  }
  ctx.restore();
}

/**
 * La Migra, closing in. These are the same pursuers the whole game is about —
 * the chase meter is labelled LA MIGRA, the run ends "CLARO. LA MIGRA.", and
 * the obstacles are checkpoints and border walls — so the opening shows who is
 * actually chasing you rather than an unrelated crew.
 *
 * They run AT the camera here, and the runner rig only knows how to draw a back
 * view — so they get their own front-facing rig in art/ice.js. Backlit by the
 * same low sun as the hero, which is what lets the view work without ever having
 * to render a face.
 */
function drawPursuers(ctx, W, H, turn) {
  const fade = 1 - Math.min(1, turn * 1.5);
  if (fade <= 0.01) return;

  ctx.save();
  ctx.globalAlpha = fade;

  const crew = [
    { x: 0.30, z: 0.00, tint: '#1a0f22' },
    { x: 0.66, z: 0.16, tint: '#150c1c' },
    { x: 0.47, z: 0.34, tint: '#120a18' },
  ];

  // Back to front. The crew is authored in increasing depth, so iterating it
  // forwards paints the furthest agent LAST and it cuts across the nearest one.
  // Three flat silhouettes of nearly the same colour hid that; three lit figures
  // would not.
  for (let i = crew.length - 1; i >= 0; i--) {
    const c = crew[i];
    // Closing in over the sequence — they start further back and gain on you.
    const depth = c.z + 0.30 - Math.min(0.28, t * 0.19);
    const scale = 1 / (1 + depth * 2.4);
    const h = Math.min(W * 0.34, H * 0.185) * scale;
    // Spread scaled off the narrower axis, or on a portrait screen the crew
    // walks straight out of frame and the chase is invisible.
    const spread = Math.min(W, H * 0.5) * (0.5 + depth * 1.1);
    const px = W * 0.5 + (c.x - 0.5) * spread + turn * W * 0.5 * (i + 1);
    const py = H * 0.545 - depth * H * 0.10;

    // Cadence, stride and roll are per-agent inside ice.js — they used to share
    // one formula offset by index, which is what made them move as one block.
    drawIceAgent(ctx, px, py, h, t, i, c.tint);
  }
  ctx.restore();
}

/** Radial streaks during the swing — sells it as a fast camera move. */
function drawWhipLines(ctx, W, H, turn) {
  if (turn <= 0 || turn >= 1) return;
  const k = Math.sin(turn * Math.PI);           // peaks mid-whip
  ctx.save();
  ctx.globalAlpha = k * 0.5;
  ctx.strokeStyle = 'rgba(255,225,190,0.7)';
  ctx.lineCap = 'round';
  const cy = H * 0.46;
  for (let i = 0; i < 16; i++) {
    const y = cy + (i - 8) * H * 0.055 + Math.sin(i * 2.3) * H * 0.01;
    const len = W * (0.24 + ((i * 37) % 11) / 22);
    const x0 = W * 0.5 - len * 0.5 - k * W * 0.3;
    ctx.lineWidth = Math.max(1, H * 0.004 * (0.5 + ((i * 13) % 7) / 7));
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + len, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTitle(ctx, W, H, heroK, turn) {
  const fade = heroK * (1 - Math.min(1, turn * 2.2));
  if (fade <= 0.01 || !character) return;

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  const s = Math.min(W, H) / 420;

  const name = displayName.toUpperCase();
  ctx.font = `900 ${Math.round(34 * s)}px ui-rounded, system-ui, sans-serif`;
  ctx.lineWidth = 6 * s;
  ctx.strokeStyle = 'rgba(9,5,16,0.75)';
  ctx.strokeText(name, W / 2, H * 0.235);
  ctx.fillStyle = PAL.gold;
  ctx.fillText(name, W / 2, H * 0.235);

  // Resolved once: this runs every frame of the opening, and the string is
  // stroked and filled from the same value.
  const kicker = tr('intro.tail');
  ctx.font = `800 ${Math.round(12.5 * s)}px ui-rounded, system-ui, sans-serif`;
  ctx.lineWidth = 4 * s;
  ctx.strokeText(kicker, W / 2, H * 0.275);
  ctx.fillStyle = 'rgba(253,246,230,0.82)';
  ctx.fillText(kicker, W / 2, H * 0.275);
  ctx.restore();
}
