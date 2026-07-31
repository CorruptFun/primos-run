// First-run training: the escuela del callejón.
//
// The alley is fair but it is not obvious. Three of its obstacles cannot be
// jumped at ALL — their heights are set above the jump apex on purpose (see
// PROP_SPEC in art/props.js) — and a player who discovers that by dying learns
// it as "the game cheated me". So the first time anyone presses CORRE they get
// taught by doing, and only then does the first real run start.
//
// This module owns nothing but its own step state. It never writes to the Game.
// It gates on the same four verbs the input layer already produces, AND watches
// the player for a lane change / jump / slide of its own accord, so it works
// whether the caller freezes the world behind the overlay or lets it run live.
//
// Nothing here allocates per frame: the step copy, the prop extents and the
// dash pattern are all baked at module scope, and the word wrap is cached until
// the step or the panel width actually changes.

import { PAL, roundRect } from './art/palette.js';
import { PROP_SPEC, PROP_DRAW } from './art/props.js';
import { RUN, HITBOX, STAMINA } from './config.js';
import { FONT, INK, label, panel, bevel, track, gloss } from './hud.js';
import * as store from './store.js';
// Aliased: `t` is already the animation clock throughout this file, and every
// draw helper takes it as a parameter. Importing the translator under that
// name would shadow it inside exactly the functions that need to translate.
import { t as tr, onLangChange } from './i18n.js';
import { drawTrainer } from './art/trainer.js';

// Feet clearance at the top of a standing jump: v²/2g. Computed rather than
// typed so the diagram cannot drift away from the physics it is teaching.
const APEX = (RUN.jumpV * RUN.jumpV) / (2 * Math.abs(RUN.gravity));

const RED = '#ff5a5a';

// Baked because drawTutorial runs every frame and this is the one caption that
// would otherwise build a string from a config number on each one.
const TACO_TEXT = `TACO +${STAMINA.taco}`;

// Seconds in a step before we start offering a way past it, and before we give
// up and move on by ourselves. A tutorial that can deadlock is worse than no
// tutorial, and there are two ways to strand someone here: a gesture their
// device will not produce, and a caller that never routes tutorialInput at all
// while the world behind the overlay is frozen (so the passive sniffer sees
// nothing either). Every step therefore has an unconditional exit.
const NUDGE_AT = 6.0;
const BAIL_AT = 15.0;
const CARD_BAIL = 20.0;   // reading steps get longer: nobody likes being rushed
const GO_TIME = 1.7;

// ------------------------------------------------------------------- content

/**
 * What each prop is and what it does to you. `no` marks the three that are
 * taller than the jump apex by design — the single rule this whole screen
 * exists to teach.
 *
 * `name` and `note` are i18n keys, not strings — every string this file draws
 * comes from js/i18n.js. These particular rows read the same in both
 * languages: they are the alley's own vocabulary, which the game speaks
 * whichever language the menu is in.
 */
const TILE = {
  beer:        { name: 'tut.tile.beer',        note: 'tut.tile.beer.n',     color: PAL.gold },
  taco:        { name: 'tut.tile.taco',        note: 'tut.tile.taco.n',     color: PAL.lime },
  magnet:      { name: 'tut.tile.magnet',      note: 'tut.tile.magnet.n',   color: PAL.hotPink },
  chancla:     { name: 'tut.tile.chancla',     note: 'tut.tile.chancla.n',  color: PAL.gold },
  lowrider:    { name: 'tut.tile.lowrider',    note: 'tut.tile.lowrider.n', color: '#4dd8ff' },
  dumpster:    { name: 'tut.tile.dumpster',    note: 'tut.tile.jump.n',     color: PAL.gold },
  crates:      { name: 'tut.tile.crates',      note: 'tut.tile.jump.n',     color: PAL.gold },
  cones:       { name: 'tut.tile.cones',       note: 'tut.tile.jump.n',     color: PAL.gold },
  clothesline: { name: 'tut.tile.clothesline', note: 'tut.tile.duck.n',     color: PAL.teal },
  awning:      { name: 'tut.tile.awning',      note: 'tut.tile.duck.n',     color: PAL.teal },
  checkpoint:  { name: 'tut.tile.checkpoint',  note: 'tut.tile.no.n',       color: RED, no: true },
  border:      { name: 'tut.tile.border',      note: 'tut.tile.no.n',       color: RED, no: true },
  copcar:      { name: 'tut.tile.copcar',      note: 'tut.tile.no.n',       color: RED, no: true },
};

/**
 * Drawn extent of each prop in world units, plus a stable seed so a tile looks
 * the same every frame. `lo`/`hi` are the lowest and highest painted points —
 * NOT the collision box, which is what the faint band inside a tile shows.
 * Hand-measured against the draw calls in art/props.js.
 */
const ICON = {
  beer:        { lo: 0.50, hi: 1.24, halfW: 0.30, seed: 2 },
  taco:        { lo: 0.50, hi: 1.00, halfW: 0.31, seed: 5 },
  magnet:      { lo: 0.34, hi: 1.50, halfW: 0.58, seed: 1 },
  chancla:     { lo: 0.34, hi: 1.50, halfW: 0.58, seed: 4 },
  lowrider:    { lo: 0.18, hi: 1.54, halfW: 0.69, seed: 7 },
  dumpster:    { lo: 0.00, hi: 1.02, halfW: 0.46, seed: 3 },
  crates:      { lo: 0.00, hi: 0.64, halfW: 0.42, seed: 6 },
  cones:       { lo: 0.00, hi: 0.58, halfW: 0.44, seed: 8 },
  clothesline: { lo: 0.00, hi: 2.50, halfW: 0.59, seed: 9 },
  awning:      { lo: 0.00, hi: 2.32, halfW: 0.57, seed: 11 },
  checkpoint:  { lo: 0.00, hi: 1.52, halfW: 0.78, seed: 12 },
  border:      { lo: 0.00, hi: 2.70, halfW: 0.54, seed: 13 },
  copcar:      { lo: 0.00, hi: 1.80, halfW: 0.53, seed: 14 },
};

/**
 * The course. `drill` steps do not advance until the player performs the verb;
 * `card` steps turn on any input. Boards are rows of prop types, and a step
 * with `guides` shares one scale and one ground line across its row so the
 * dashed measurement lines mean something.
 *
 * `tag`, `title`, `body`, `cue`, `keys` and a guide's `text` are all i18n keys
 * — the copy itself lives in js/i18n.js so both languages sit side by side.
 */
const STEPS = [
  {
    id: 'welcome',
    kind: 'card',
    tag: 'tut.welcome.tag',
    title: 'tut.welcome.title',
    body: 'tut.welcome.body',
    accent: PAL.gold,
    cue: 'tut.welcome.cue',
  },
  {
    id: 'lane',
    kind: 'drill',
    tag: 'tut.lane.tag',
    title: 'tut.lane.title',
    body: 'tut.lane.body',
    verb: 'lane',
    dirs: [-1, 1],
    keys: 'tut.lane.keys',
    accent: PAL.teal,
  },
  {
    id: 'jump',
    kind: 'drill',
    tag: 'tut.jump.tag',
    title: 'tut.jump.title',
    body: 'tut.jump.body',
    verb: 'jump',
    need: 1,
    keys: 'tut.jump.keys',
    board: [['dumpster', 'crates', 'cones']],
    guides: [{ y: APEX, color: PAL.gold, text: 'tut.guide.jump' }],
    accent: PAL.gold,
  },
  {
    id: 'slide',
    kind: 'drill',
    tag: 'tut.slide.tag',
    title: 'tut.slide.title',
    body: 'tut.slide.body',
    verb: 'slide',
    need: 1,
    keys: 'tut.slide.keys',
    board: [['clothesline', 'awning']],
    guides: [
      { y: HITBOX.standH, color: RED, text: 'tut.guide.stand' },
      { y: HITBOX.slideH, color: PAL.teal, text: 'tut.guide.crouch' },
    ],
    accent: PAL.teal,
  },
  {
    id: 'wall',
    kind: 'drill',
    tag: 'tut.wall.tag',
    title: 'tut.wall.title',
    body: 'tut.wall.body',
    verb: 'lane',
    dirs: [0],
    need: 1,
    keys: 'tut.lane.keys',
    board: [['checkpoint', 'border', 'copcar']],
    guides: [{ y: APEX, color: PAL.gold, text: 'tut.guide.jump' }],
    danger: true,
    accent: RED,
  },
  {
    id: 'loot',
    kind: 'card',
    tag: 'tut.loot.tag',
    title: 'tut.loot.title',
    body: 'tut.loot.body',
    board: [['beer', 'taco'], ['magnet', 'chancla', 'lowrider']],
    accent: PAL.gold,
    cue: 'tut.cue.next',
  },
  {
    id: 'migra',
    kind: 'card',
    tag: 'tut.migra.tag',
    title: 'tut.migra.title',
    body: 'tut.migra.body',
    meters: true,
    accent: RED,
    cue: 'tut.cue.next',
  },
  {
    id: 'go',
    kind: 'go',
    title: 'tut.go.title',
    body: 'tut.go.body',
    accent: PAL.gold,
  },
];

// --------------------------------------------------------------------- state

const T = {
  active: false,
  step: 0,
  t: 0,          // seconds inside the current step
  total: 0,      // seconds since startTutorial — animation clock
  hits: 0,       // gated reps banked in this step
  intro: 0,      // 0..1 step entrance
  pass: 0,       // 0..1 flash on a correct input
  nudge: 0,      // 0..1 flash on a wrong one
  lock: 0,       // input debounce, seconds
  cleared: false,
  clearedAt: 0,
  got: [],       // lane directions already banked in this step
  // Edge detectors for the passive sniffer.
  seen: false,
  lane: 0,
  air: false,
  slid: false,
};

// Set by resetTutorial() so a dev reset takes effect without a reload, even
// though main.js is still holding its own copy of the save.
let forced = false;

/** Screen rect of the SKIP pill, so main.js can hit-test taps like pauseRect. */
export const skipRect = { x: 0, y: 0, w: 0, h: 0 };

// ----------------------------------------------------------------- lifecycle

export function tutorialNeeded() {
  if (forced) return true;
  return !store.isTrained();
}

export function startTutorial() {
  T.active = true;
  T.step = 0;
  T.t = 0;
  T.total = 0;
  T.hits = 0;
  T.intro = 0;
  T.pass = 0;
  T.nudge = 0;
  T.lock = 0.25;
  T.cleared = false;
  T.seen = false;
  T.got.length = 0;
  wrapStep = -1;
}

export function tutorialActive() {
  return T.active;
}

/**
 * Persists unconditionally, even if the tutorial was never started — a caller
 * that decides to skip training outright should get the same "never again"
 * guarantee as one that ran it to the end.
 */
export function finishTutorial() {
  T.active = false;
  forced = false;
  skipRect.w = 0;
  skipRect.h = 0;
  store.markTrained();
}

/** Dev/testing: clear the persisted flag and arm the tutorial again. */
export function resetTutorial() {
  store.clearTrained();
  forced = true;
  T.active = false;
}

// --------------------------------------------------------------------- input

/**
 * @param {'lane'|'jump'|'slide'|'tap'} verb
 * @param {number} [dir] -1 / +1 for a lane change, when the caller knows it.
 *   Omitted is fine — a directionless lane change still counts.
 */
export function tutorialInput(verb, dir) {
  feed(verb, dir);
}

function feed(verb, dir) {
  if (!T.active || T.lock > 0 || T.cleared) return;
  const step = STEPS[T.step];
  if (!step || step.kind === 'go') return;

  if (step.kind !== 'drill') {
    // Any input turns the page, after a beat so one flick cannot blow through
    // two steps before the player has read either.
    if (T.t > 0.5) {
      T.lock = 0.3;
      advance();
    }
    return;
  }

  // Escape hatch, armed once the step has outstayed its welcome.
  if (verb === 'tap') {
    if (T.t > NUDGE_AT) {
      T.lock = 0.3;
      advance();
    }
    return;
  }

  if (verb !== step.verb) {
    T.nudge = 1;
    T.lock = 0.2;
    return;
  }

  // `dirs` is a set of directions to cover, not a script to obey. Swiping the
  // other way first still changed a lane, which is the whole lesson — so bank
  // it and ask for the one they have not done yet. Rejecting a correct gesture
  // for pointing the wrong way teaches nothing and reads as a broken control.
  if (step.dirs) {
    if (dir && step.dirs.indexOf(dir) >= 0 && T.got.indexOf(dir) < 0) T.got.push(dir);
    else T.got.push(nextDir(step));
  }

  T.hits++;
  T.pass = 1;
  T.lock = 0.22;                       // also dedupes verb + sniffer double-fire
  if (T.hits >= repsFor(step)) {
    T.cleared = true;
    T.clearedAt = T.t;
  }
}

/**
 * Consume a tap on the SKIP pill.
 * @returns {boolean} true when the tap was the skip button and nothing else
 *   should act on it.
 */
export function tutorialTap(x, y) {
  if (!T.active || skipRect.w <= 0) return false;
  const r = skipRect;
  const pad = 8;
  if (x < r.x - pad || x > r.x + r.w + pad) return false;
  if (y < r.y - pad || y > r.y + r.h + pad) return false;
  finishTutorial();
  return true;
}

function repsFor(step) {
  return step.dirs ? step.dirs.length : (step.need || 1);
}

/** The direction still owed, or 0 when either way will do. */
function nextDir(step) {
  if (!step.dirs) return 0;
  for (let i = 0; i < step.dirs.length; i++) {
    if (T.got.indexOf(step.dirs[i]) < 0) return step.dirs[i];
  }
  return 0;
}

/**
 * Notice what the player actually did, in case the caller never routes
 * tutorialInput. Read-only: three rising edges off the Game, no writes.
 */
function sniff(g) {
  const p = g && g.player;
  if (!p) return;
  if (T.seen) {
    if (p.lane !== T.lane) feed('lane', p.lane > T.lane ? 1 : -1);
    if (p.airborne && !T.air) feed('jump');
    if (p.sliding && !T.slid) feed('slide');
  }
  T.seen = true;
  T.lane = p.lane;
  T.air = p.airborne;
  T.slid = p.sliding;
}

// -------------------------------------------------------------------- update

export function updateTutorial(dt, game) {
  if (!T.active) return false;

  T.total += dt;
  T.t += dt;
  T.intro = T.intro < 1 ? Math.min(1, T.intro + dt * 5.5) : 1;
  T.pass = T.pass > 0 ? Math.max(0, T.pass - dt * 1.7) : 0;
  T.nudge = T.nudge > 0 ? Math.max(0, T.nudge - dt * 2.4) : 0;
  if (T.lock > 0) T.lock -= dt;

  // A run that ended underneath us wins the screen. Compared as a string on
  // purpose: importing game.js for one enum would drag the whole simulation in.
  if (game && game.state === 'over') {
    finishTutorial();
    return false;
  }

  sniff(game);

  const step = STEPS[T.step];
  if (!step) {
    finishTutorial();
    return false;
  }

  if (step.kind === 'go') {
    if (T.t >= GO_TIME) {
      finishTutorial();
      return false;
    }
    return true;
  }

  if (T.cleared) {
    if (T.t - T.clearedAt > 0.45) advance();
  } else if (T.t > (step.kind === 'drill' ? BAIL_AT : CARD_BAIL)) {
    advance();                        // nothing traps anyone on this screen
  }

  return T.active;
}

function advance() {
  T.step++;
  T.t = 0;
  T.hits = 0;
  T.intro = 0;
  T.pass = 0;
  T.nudge = 0;
  T.cleared = false;
  T.got.length = 0;
  wrapStep = -1;
  if (T.step >= STEPS.length) finishTutorial();
}

// ---------------------------------------------------------------- text utils

const wrapLines = [];
let wrapStep = -1;
let wrapW = 0;
let wrapSize = 0;

// The cache is keyed on step + geometry, neither of which changes when the
// language does — so drop it by hand, or a switch mid-course would keep
// drawing the previous language's line breaks.
onLangChange(() => { wrapStep = -1; });

/** Word wrap, cached until the step or the panel geometry changes. */
function wrapBody(ctx, text, size, maxW, stepIdx) {
  if (wrapStep === stepIdx && wrapW === maxW && wrapSize === size) return wrapLines;
  wrapStep = stepIdx;
  wrapW = maxW;
  wrapSize = size;
  wrapLines.length = 0;
  ctx.font = `700 ${Math.round(size)}px ${FONT}`;
  const words = text.split(' ');
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (line && ctx.measureText(test).width > maxW) {
      wrapLines.push(line);
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) wrapLines.push(line);
  return wrapLines;
}

/** Shrink a size until the string fits — same trick drawPowerPills uses. */
function fit(ctx, str, size, maxW, weight) {
  ctx.font = `${weight || 900} ${Math.round(size)}px ${FONT}`;
  const w = ctx.measureText(str).width;
  return w > maxW ? size * (maxW / w) : size;
}

// ---------------------------------------------------------------------- draw

// Mutated in place rather than rebuilt: this file runs every frame.
const TOBJ = { seed: 0, x: 0, y: 0, w: 0, h: 0 };
const DASH = [0, 0];
const NODASH = [];
const ease = (k) => 1 - (1 - k) * (1 - k) * (1 - k);

export function drawTutorial(ctx, W, H, s, safeTop = 0, safeBottom = 0) {
  if (!T.active) return;
  const step = STEPS[T.step];
  if (!step) return;

  const t = T.total;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // Scrim. The alley stays visible underneath — this is a lesson about that
  // alley, not a modal that replaces it.
  ctx.globalAlpha = step.kind === 'go'
    ? 0.62 * Math.max(0, 1 - T.t / GO_TIME)
    : 0.62 * (0.35 + 0.65 * T.intro);
  ctx.fillStyle = '#0a0512';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  if (step.kind === 'go') {
    skipRect.w = 0;
    drawGo(ctx, step, W, H, s);
    ctx.restore();
    return;
  }

  // ---- geometry
  const pw = Math.min(W - 32 * s, 408 * s);
  const px = (W - pw) / 2;
  const inner = 15 * s;
  const cw = pw - inner * 2;

  // Resolved once per frame rather than at each use — t() is cheap, but the
  // title is measured and then drawn, and the two must agree.
  const title = tr(step.title);

  const tagS = 11 * s;
  const titleS = fit(ctx, title, 26 * s, cw, 900);
  const bodyS = 13.5 * s;
  const lineH = bodyS * 1.36;
  const lines = wrapBody(ctx, tr(step.body), bodyS, cw, T.step);

  const rows = step.board ? step.board.length : 0;
  const boardH = rows ? 12 * s + rows * tileH(s) + (rows - 1) * 9 * s : 0;
  const metersH = step.meters ? 12 * s + 96 * s : 0;
  const cueH = step.kind === 'drill' ? 12 * s + 94 * s : 26 * s;

  const ph = 15 * s + tagS + 9 * s + titleS + 11 * s +
    lines.length * lineH + boardH + metersH + cueH + 15 * s;

  const skipH = 34 * s;
  const topLimit = safeTop + 10 * s;
  const botLimit = H - safeBottom - skipH - 22 * s;
  let py = (H - ph) / 2 - 6 * s;
  if (py + ph > botLimit) py = botLimit - ph;
  if (py < topLimit) py = topLimit;

  // ---- panel, with an entrance pop and a shake when you get it wrong
  ctx.save();
  ctx.globalAlpha = 0.15 + 0.85 * T.intro;
  const pop = 0.962 + 0.038 * ease(T.intro);
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  ctx.translate(cx + Math.sin(t * 46) * 3.4 * s * T.nudge, cy);
  ctx.scale(pop, pop);
  ctx.translate(-cx, -cy);

  panel(ctx, px, py, pw, ph, 20 * s, s);
  // Accent rail down the left edge — the one bit of colour that says which
  // lesson this is before you have read a word of it.
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 20 * s);
  ctx.clip();
  const a0 = ctx.globalAlpha;             // the panel's entrance fade
  ctx.fillStyle = step.accent;
  ctx.globalAlpha = a0 * 0.85;
  ctx.fillRect(px, py, 4 * s, ph);
  ctx.globalAlpha = a0 * (0.09 + 0.06 * T.nudge);
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();
  bevel(ctx, px, py, pw, ph, 20 * s, s,
    step.danger ? 'rgba(255,140,140,0.62)' : null);

  // ---- Corrupt, running the class.
  //
  // Straddling the panel's top-right corner rather than sitting inside it: the
  // layout above is already solved to fit the viewport, and giving him a row of
  // his own would push the boards off small screens. Overlapping the edge costs
  // no height at all, and it reads as him leaning into the frame to talk to you.
  const badgeD = 62 * s;
  const badgeX = px + pw - badgeD * 0.42;
  const badgeY = py + badgeD * 0.08;
  // No name caption under him: it landed on top of the title, and the kicker
  // already carries his name on every card.
  drawTrainer(ctx, badgeX, badgeY, badgeD);

  let y = py + 15 * s + tagS;

  // ---- kicker
  ctx.textAlign = 'left';
  label(ctx, tr(step.tag), px + inner, y, tagS, step.accent,
    { weight: 900, spacing: 1.6 * s, halo: 2.6 * s });
  drawProgress(ctx, px + pw - inner, y - tagS * 0.34, s);
  y += 9 * s + titleS;

  // ---- title
  label(ctx, title, px + inner, y, titleS, '#fffdf3',
    { weight: 900, halo: 4 * s });
  y += 11 * s;

  // ---- body
  for (let i = 0; i < lines.length; i++) {
    y += lineH;
    label(ctx, lines[i], px + inner, y - lineH * 0.26, bodyS, 'rgba(253,246,230,0.82)',
      { weight: 700, halo: 2.4 * s });
  }

  // ---- item breakdown
  if (rows) {
    y += 12 * s;
    for (let r = 0; r < rows; r++) {
      drawRow(ctx, step, step.board[r], px + inner, y, cw, s, t);
      y += tileH(s) + 9 * s;
    }
    y -= 9 * s;
  }

  if (step.meters) {
    y += 12 * s;
    drawMeters(ctx, px + inner, y, cw, 96 * s, s, t);
    y += 96 * s;
  }

  // ---- what to do about it
  if (step.kind === 'drill') {
    drawCue(ctx, step, px + inner, y + 12 * s, cw, 94 * s, s, t);
  } else {
    ctx.textAlign = 'center';
    const hint = tr(step.cue || 'tut.cue.next');
    const pulse = 0.55 + 0.45 * Math.sin(t * 4.2);
    label(ctx, hint, px + pw / 2, y + 20 * s, 11.5 * s,
      T.t > 0.5 ? '#fffdf3' : 'rgba(253,246,230,0.45)',
      { weight: 900, spacing: 1.5 * s, halo: 3 * s, glow: step.accent, glowSize: 12 * s * pulse });
  }

  ctx.restore();

  // ---- skip, always reachable
  drawSkip(ctx, W, H - safeBottom - 14 * s, skipH, s);

  ctx.restore();
}

// ------------------------------------------------------------- panel pieces

/** Dots for the course, so the player can see this ends. */
function drawProgress(ctx, right, cy, s) {
  const r = 3.1 * s;
  const gap = 10 * s;
  const n = STEPS.length - 1;                 // the GO card is a payoff, not a step
  ctx.save();
  const a0 = ctx.globalAlpha;                 // set per dot, never compounded
  for (let i = 0; i < n; i++) {
    const x = right - (n - 1 - i) * gap;
    const on = i === T.step;
    ctx.globalAlpha = a0 * (on ? 1 : i < T.step ? 0.62 : 0.22);
    ctx.fillStyle = on ? '#fffdf3' : INK;
    ctx.beginPath();
    ctx.arc(x, cy, on ? r * 1.35 : r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const TILE_ART = 74;
const TILE_FOOT = 32;
const tileH = (s) => (TILE_ART + TILE_FOOT) * s;

/**
 * One row of the item breakdown.
 *
 * A row with `guides` shares ONE scale and ONE ground line across every tile,
 * because the whole point of those rows is the comparison: the dashed jump-apex
 * line has to cut the same height through all three or it teaches nothing.
 * Rows without guides fit each icon to its own box instead, so a chela is not
 * drawn tiny just because it floats.
 */
function drawRow(ctx, step, row, x, y, w, s, t) {
  const n = row.length;
  const gap = 9 * s;
  const tw = (w - gap * (n - 1)) / n;
  const artH = TILE_ART * s;
  const shared = !!step.guides;

  let u = Infinity;
  let hiRow = 0;
  if (shared) {
    for (let i = 0; i < n; i++) {
      const ic = ICON[row[i]];
      if (!ic) continue;
      if (ic.hi > hiRow) hiRow = ic.hi;
      const cap = (tw * 0.80) / (ic.halfW * 2);
      if (cap < u) u = cap;
    }
    if (!hiRow) return;                  // board names a prop we have no art for
    for (let i = 0; i < step.guides.length; i++) {
      const need = step.guides[i].y + 0.24;
      if (need > hiRow) hiRow = need;
    }
    const hCap = artH / hiRow;
    if (hCap < u) u = hCap;
  }

  for (let i = 0; i < n; i++) {
    const type = row[i];
    const tx = x + i * (tw + gap);
    drawTile(ctx, type, tx, y, tw, artH, shared ? u : 0, s, t);
  }

  // Guides last, straight across the whole row — they read as a measurement
  // laid over the picture, which is exactly what they are.
  if (shared) {
    for (let i = 0; i < step.guides.length; i++) {
      drawGuide(ctx, step.guides[i], x, y + artH, w, u, s);
    }
  }
}

function drawTile(ctx, type, x, y, w, artH, sharedU, s, t) {
  const ic = ICON[type];
  const info = TILE[type];
  if (!ic || !info) return;              // an unknown type must not kill the frame
  const spec = PROP_SPEC[type];
  const r = 11 * s;

  track(ctx, x, y, w, artH, r, s);

  ctx.save();
  roundRect(ctx, x, y, w, artH, r);
  ctx.clip();

  let u = sharedU;
  let ground;
  if (u) {
    ground = y + artH;                              // shared row: real ground
  } else {
    const span = ic.hi - ic.lo;
    u = Math.min(artH / span, (w * 0.78) / (ic.halfW * 2));
    ground = y + artH / 2 + ((ic.hi + ic.lo) / 2) * u;
  }

  // Collision extent, so "why did that hit me" has a picture. Ground props get
  // a column from the asphalt up; hanging ones get the band they occupy.
  if (sharedU && spec) {
    const lo = spec.kind === 'slide' ? spec.y : 0;
    const hi = spec.kind === 'slide' ? spec.y + spec.h : spec.h;
    ctx.save();
    ctx.globalAlpha *= 0.16;
    ctx.fillStyle = info.color;
    ctx.fillRect(x + w * 0.5 - spec.w * u * 0.5, ground - hi * u, spec.w * u, (hi - lo) * u);
    ctx.restore();
  }

  const draw = PROP_DRAW[type];
  if (draw) {
    TOBJ.seed = ic.seed;
    draw(ctx, x + w * 0.5, ground, u, TOBJ, t);
  }
  ctx.restore();

  bevel(ctx, x, y, w, artH, r, s, info.no ? 'rgba(255,150,150,0.55)' : null);

  // Circle-slash on the three that cannot be jumped.
  if (info.no) {
    const br = 9 * s;
    const bx = x + w - br - 6 * s;
    const by = y + br + 6 * s;
    ctx.save();
    ctx.globalAlpha *= 0.85 + 0.15 * Math.sin(t * 5);
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2.4 * s;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.moveTo(bx - br * 0.62, by + br * 0.62);
    ctx.lineTo(bx + br * 0.62, by - br * 0.62);
    ctx.stroke();
    ctx.restore();
  }

  // Name, then the verdict chip. Both shrink rather than run over the tile.
  ctx.textAlign = 'center';
  const cxp = x + w * 0.5;
  const name = tr(info.name);
  const note = tr(info.note);
  const nameS = fit(ctx, name, 9.5 * s, w - 8 * s, 900);
  label(ctx, name, cxp, y + artH + 13 * s, nameS, 'rgba(253,246,230,0.72)',
    { weight: 900, spacing: 0.6 * s, halo: 2.4 * s });

  const chipH = 15 * s;
  const chipY = y + artH + 17 * s;
  const noteS = fit(ctx, note, 8.6 * s, w - 14 * s, 900);
  ctx.font = `900 ${Math.round(noteS)}px ${FONT}`;
  const chipW = Math.min(w, ctx.measureText(note).width + 14 * s);
  ctx.save();
  ctx.globalAlpha *= 0.9;
  ctx.fillStyle = info.color;
  roundRect(ctx, cxp - chipW / 2, chipY, chipW, chipH, chipH / 2);
  ctx.fill();
  ctx.restore();
  ctx.textBaseline = 'middle';
  label(ctx, note, cxp, chipY + chipH * 0.54, noteS, '#25140b',
    { weight: 900, halo: 0 });
  ctx.textBaseline = 'alphabetic';
}

function drawGuide(ctx, g, x, ground, w, u, s) {
  const gy = ground - g.y * u;
  ctx.save();
  const a0 = ctx.globalAlpha;
  DASH[0] = 5 * s;
  DASH[1] = 4.5 * s;
  ctx.setLineDash(DASH);
  ctx.strokeStyle = g.color;
  ctx.globalAlpha = a0 * 0.9;
  ctx.lineWidth = Math.max(1, 1.6 * s);
  ctx.beginPath();
  ctx.moveTo(x, gy);
  ctx.lineTo(x + w, gy);
  ctx.stroke();
  ctx.setLineDash(NODASH);

  ctx.font = `900 ${Math.round(8 * s)}px ${FONT}`;
  const tw = ctx.measureText(g.text).width + 10 * s;
  const th = 12 * s;
  ctx.globalAlpha = a0;
  ctx.fillStyle = 'rgba(10,5,18,0.9)';
  roundRect(ctx, x + w - tw, gy - th / 2, tw, th, th / 2);
  ctx.fill();
  ctx.strokeStyle = g.color;
  ctx.lineWidth = Math.max(1, s);
  roundRect(ctx, x + w - tw, gy - th / 2, tw, th, th / 2);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  label(ctx, g.text, x + w - tw / 2, gy + 0.5 * s, 8 * s, g.color, { weight: 900, halo: 0 });
  ctx.textBaseline = 'alphabetic';
}

/**
 * The two meters, drawn here rather than pointed at on the HUD: the HUD is only
 * on screen while the game is PLAYING, and the caller may well be holding the
 * run until training is over.
 */
function drawMeters(ctx, x, y, w, h, s, t) {
  const leftW = w * 0.62;

  // ---- La Migra: horizontal, blue through purple to red, same as the HUD.
  ctx.textAlign = 'left';
  label(ctx, 'LA MIGRA', x, y + 10 * s, 9.5 * s, '#ff9a9a',
    { weight: 900, spacing: 1.3 * s, halo: 2.4 * s });

  const bh = 11 * s;
  const by = y + 18 * s;
  track(ctx, x, by, leftW, bh, bh / 2, s);
  const k = 0.52 + 0.16 * Math.sin(t * 1.6);
  const fw = leftW * k;
  const grad = ctx.createLinearGradient(x, 0, x + leftW, 0);
  grad.addColorStop(0, '#3f60ff');
  grad.addColorStop(0.55, '#b03bd8');
  grad.addColorStop(1, '#ff3b3b');
  ctx.save();
  ctx.shadowColor = 'rgba(120,80,255,0.5)';
  ctx.shadowBlur = 7 * s;
  ctx.fillStyle = grad;
  roundRect(ctx, x, by, fw, bh, bh / 2);
  ctx.fill();
  ctx.restore();
  gloss(ctx, x, by, fw, bh, bh / 2);
  bevel(ctx, x, by, leftW, bh, bh / 2, s);

  label(ctx, 'CADA GOLPE LA SUBE.', x, by + bh + 15 * s, 10 * s, 'rgba(253,246,230,0.8)',
    { weight: 800, halo: 2.4 * s });
  label(ctx, 'LLENA = TE AGARRARON', x, by + bh + 29 * s, 10 * s, 'rgba(253,246,230,0.55)',
    { weight: 800, halo: 2.4 * s });

  // ---- gasolina: vertical, exactly where it lives on the real HUD.
  const gw = 15 * s;
  const gx = x + leftW + (w - leftW) * 0.34;
  const gy = y + 16 * s;
  const gh = h - 30 * s;
  track(ctx, gx, gy, gw, gh, gw / 2, s);
  const gk = 0.42;
  const fh = gh * gk;
  const fy = gy + gh - fh;
  const gg = ctx.createLinearGradient(0, fy, 0, gy + gh);
  gg.addColorStop(0, '#c8f56b');
  gg.addColorStop(0.45, '#9ee34f');
  gg.addColorStop(1, '#2fae4e');
  ctx.save();
  ctx.shadowColor = 'rgba(120,220,80,0.45)';
  ctx.shadowBlur = 6 * s;
  ctx.fillStyle = gg;
  roundRect(ctx, gx, fy, gw, fh, gw / 2);
  ctx.fill();
  ctx.restore();
  bevel(ctx, gx, gy, gw, gh, gw / 2, s);

  // Draining arrow, so the bar reads as something that runs out on its own.
  ctx.save();
  ctx.globalAlpha *= 0.35 + 0.35 * Math.sin(t * 3);
  ctx.strokeStyle = PAL.lime;
  ctx.lineWidth = 2 * s;
  ctx.lineCap = 'round';
  const ax = gx + gw + 9 * s;
  ctx.beginPath();
  ctx.moveTo(ax, fy + 2 * s);
  ctx.lineTo(ax, fy + 15 * s);
  ctx.moveTo(ax - 3.4 * s, fy + 10 * s);
  ctx.lineTo(ax, fy + 15 * s);
  ctx.lineTo(ax + 3.4 * s, fy + 10 * s);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  label(ctx, 'GAS', gx + gw / 2, gy - 4 * s, 9.5 * s, PAL.lime,
    { weight: 900, spacing: 1.1 * s, halo: 2.4 * s });
  label(ctx, TACO_TEXT, gx + gw / 2, gy + gh + 13 * s, 9 * s,
    'rgba(253,246,230,0.62)', { weight: 900, halo: 2.4 * s });
}

// ------------------------------------------------------------- the gesture

/** Big animated swipe glyph plus the reps still owed. */
function drawCue(ctx, step, x, y, w, h, s, t) {
  const verb = step.verb;
  const want = nextDir(step);
  const both = verb === 'lane' && !want;
  const dirX = verb === 'lane' ? (want || (Math.floor(t / 1.3) % 2 ? 1 : -1)) : 0;
  const dirY = verb === 'jump' ? -1 : verb === 'slide' ? 1 : 0;

  const cxp = x + w / 2;
  const padH = 54 * s;
  const padY = y;
  const good = T.pass;
  const bad = T.nudge;
  const tone = bad > 0.02 ? RED : good > 0.02 || T.cleared ? PAL.lime : step.accent;

  // ---- the arrow lane
  ctx.save();
  ctx.globalAlpha *= 0.9;
  const laneW = Math.min(w, 210 * s);
  const lx = cxp - laneW / 2;
  ctx.fillStyle = 'rgba(8,4,16,0.45)';
  roundRect(ctx, lx, padY, laneW, padH, padH * 0.34);
  ctx.fill();
  ctx.restore();
  bevel(ctx, lx, padY, laneW, padH, padH * 0.34, s, 'rgba(255,255,255,0.28)');

  ctx.save();
  const aCue = ctx.globalAlpha;          // the panel's entrance fade, inherited
  roundRect(ctx, lx, padY, laneW, padH, padH * 0.34);
  ctx.clip();

  const loop = (t % 1.25) / 1.25;
  const travel = Math.min(1, loop / 0.72);
  const ccx = cxp;
  const ccy = padY + padH / 2;
  const reachX = laneW * 0.30;
  const reachY = padH * 0.30;

  if (T.cleared || good > 0.02) {
    // A tick, not an arrow — the gesture is banked.
    ctx.strokeStyle = PAL.lime;
    ctx.lineWidth = 4.4 * s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = PAL.lime;
    ctx.shadowBlur = 14 * s;
    ctx.beginPath();
    ctx.moveTo(ccx - 15 * s, ccy);
    ctx.lineTo(ccx - 4 * s, ccy + 10 * s);
    ctx.lineTo(ccx + 16 * s, ccy - 11 * s);
    ctx.stroke();
  } else {
    // Chevrons pointing where the finger is going, then the finger.
    const px0 = both ? 0 : dirX;
    for (let side = 0; side < (both ? 2 : 1); side++) {
      const sx = both ? (side ? 1 : -1) : px0;
      for (let i = 0; i < 3; i++) {
        const k = (i + 1) / 3;
        ctx.save();
        ctx.globalAlpha *= (0.16 + 0.26 * i) * (0.6 + 0.4 * Math.sin(t * 6 - i * 0.9));
        ctx.strokeStyle = tone;
        ctx.lineWidth = 3.2 * s;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const gx = ccx + sx * reachX * (0.55 + k * 0.75);
        const gy = ccy + dirY * reachY * (0.55 + k * 0.9);
        const a = 7 * s;
        ctx.beginPath();
        if (dirY) {
          ctx.moveTo(gx - a, gy + dirY * a);
          ctx.lineTo(gx, gy);
          ctx.lineTo(gx + a, gy + dirY * a);
        } else {
          ctx.moveTo(gx - sx * a, gy - a);
          ctx.lineTo(gx, gy);
          ctx.lineTo(gx - sx * a, gy + a);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // Finger: a dot that runs the gesture on a loop, with a fading trail. When
    // either direction will do, dirX alternates and the finger demonstrates
    // both in turn rather than sitting still in the middle.
    const e = ease(travel);
    const fx0 = ccx - dirX * reachX * 0.55;
    const fy0 = ccy - dirY * reachY * 0.55;
    const fx1 = ccx + dirX * reachX * 0.9;
    const fy1 = ccy + dirY * reachY;
    const fx = fx0 + (fx1 - fx0) * e;
    const fy = fy0 + (fy1 - fy0) * e;
    const fade = loop > 0.72 ? Math.max(0, 1 - (loop - 0.72) / 0.28) : 1;

    ctx.globalAlpha = aCue * 0.22 * fade;
    ctx.strokeStyle = tone;
    ctx.lineWidth = 9 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx0, fy0);
    ctx.lineTo(fx, fy);
    ctx.stroke();

    ctx.globalAlpha = aCue * fade;
    ctx.shadowColor = tone;
    ctx.shadowBlur = 12 * s;
    ctx.fillStyle = '#fffdf3';
    ctx.beginPath();
    ctx.arc(fx, fy, 8 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ---- caption + keyboard fallback
  ctx.textAlign = 'center';
  const cue = verb === 'jump' ? 'SWIPE  ↑'
    : verb === 'slide' ? 'SWIPE  ↓'
      : both ? 'SWIPE  ←   O   →'
        : want < 0 ? 'SWIPE  ←' : 'SWIPE  →';
  label(ctx, T.cleared ? '¡ESO!' : cue, cxp, padY + padH + 17 * s, 13 * s,
    T.cleared ? PAL.lime : '#fffdf3',
    { weight: 900, spacing: 1.6 * s, halo: 3.4 * s, glow: tone, glowSize: 12 * s });

  if (step.keys) {
    label(ctx, step.keys, cxp, padY + padH + 31 * s, 8.6 * s, 'rgba(253,246,230,0.42)',
      { weight: 800, spacing: 1 * s, halo: 2.2 * s });
  }

  // ---- reps, when more than one is owed
  const reps = repsFor(step);
  if (reps > 1) {
    const r = 4 * s;
    const gap = 15 * s;
    const y0 = padY + padH + 42 * s;
    for (let i = 0; i < reps; i++) {
      const dx = cxp + (i - (reps - 1) / 2) * gap;
      ctx.save();
      ctx.globalAlpha *= i < T.hits ? 1 : 0.28;
      ctx.fillStyle = i < T.hits ? PAL.lime : INK;
      ctx.beginPath();
      ctx.arc(dx, y0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---- last resort, once the step has clearly stopped working for them
  if (!T.cleared && T.t > NUDGE_AT) {
    ctx.save();
    ctx.globalAlpha *= Math.min(1, (T.t - NUDGE_AT) / 0.8);
    label(ctx, 'TAP PARA SALTAR ESTE PASO', cxp, padY + padH + 56 * s, 8.6 * s,
      'rgba(253,246,230,0.5)', { weight: 800, spacing: 1 * s, halo: 2.2 * s });
    ctx.restore();
  }
}

// ---------------------------------------------------------------- furniture

function drawSkip(ctx, W, bottom, h, s) {
  ctx.font = `900 ${Math.round(10.5 * s)}px ${FONT}`;
  const text = 'SALTAR ENTRENAMIENTO';
  const w = ctx.measureText(text).width + 34 * s;
  const x = (W - w) / 2;
  const y = bottom - h;

  skipRect.x = x;
  skipRect.y = y;
  skipRect.w = w;
  skipRect.h = h;

  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = 'rgba(12,6,20,0.82)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.restore();
  bevel(ctx, x, y, w, h, h / 2, s, 'rgba(255,255,255,0.24)');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  label(ctx, text, x + w / 2, y + h * 0.54, 10.5 * s, 'rgba(253,246,230,0.6)',
    { weight: 900, spacing: 1.2 * s, halo: 2.6 * s });
  ctx.textBaseline = 'alphabetic';
}

/** The handoff. No panel — just the shout, then the run. */
function drawGo(ctx, step, W, H, s) {
  const k = Math.min(1, T.t / 0.34);
  const out = Math.max(0, 1 - Math.max(0, T.t - (GO_TIME - 0.4)) / 0.4);
  const cxp = W / 2;
  const cy = H * 0.44;

  ctx.save();
  ctx.globalAlpha = out;
  ctx.translate(cxp, cy);
  const sc = 0.7 + 0.3 * ease(k) + 0.05 * Math.sin(T.t * 9);
  ctx.scale(sc, sc);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  label(ctx, step.title, 0, 0, 46 * s, '#fffdf3',
    { weight: 900, halo: 7 * s, glow: PAL.gold, glowSize: 26 * s });
  label(ctx, step.body, 0, 34 * s, 14 * s, PAL.gold,
    { weight: 900, spacing: 2.4 * s, halo: 3.4 * s });
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

// Dev convenience, in the same spirit as main.js's window.__game.
if (typeof window !== 'undefined') window.__resetTutorial = resetTutorial;
