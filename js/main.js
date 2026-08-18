// Bootstrap: canvas, loop, menus, persistence.

import { Game, STATE } from './game.js';
import { renderScene } from './render.js';
import { resizeCamera } from './camera.js';
import { drawHUD, pauseRect, pushToast, clearToasts } from './hud.js';
import { attachInput } from './input.js';
import { CREW, CUSTOM_TEMPLATE, CUSTOM_ID, drawPrimoPortrait } from './art/runner.js';
import { headFromCharacter } from './art/primo-head.js';
import { loadSprites, loadProps } from './art/sprites.js';
import * as store from './store.js';
import * as sfx from './audio.js';
import { setHaptics } from './haptics.js';
import { sceneScale, sampleFrame, perfStats, resetPerf } from './perf.js';
import { MOBILE } from './config.js';
import { t as tBase, tRaw, initLang, setLang, getLang, onLangChange } from './i18n.js';
import {
  getIndex, indexReady, cidFor, drawTokens, loadPrimoArt, loadPrimoUrl,
  claimStatus, MAX_TOKEN, extraString, traitsFor,
} from './primo-picker.js';
import { applyTraits } from './art/primo-traits.js';
import {
  tutorialNeeded, startTutorial, updateTutorial, drawTutorial,
  tutorialActive, tutorialInput, tutorialTap, finishTutorial, resetTutorial,
} from './tutorial.js';
import * as wallet from './wallet.js';
import {
  openShop, offerContinue, closeContinue, continueCost, loadoutFor, paintWallet,
  onFitChange, gearStyleFor,
} from './tiendita.js';
import { settleRacha, rachaShown, rachaAtRisk, RACHA_TABLE } from './racha.js';
import { applyJalesRun, jalesStatus, JALE_SWEEP, JALE_REWARD } from './jales.js';
import { bootstrapCloud, cloudSession } from './cloud.js';
import { captureRefFromUrl } from './referrals.js';
// `track` here is the analytics one. js/hud.js exports a `track` too — a HUD
// drawing helper — and this module imports from both, so if that one is ever
// needed here it must come in aliased. See the header of js/analytics.js.
import { EVENTS, initAnalytics, track } from './analytics.js';
import {
  MAX_MESSAGE, isFeedbackConfigured, normalizeKind, sanitizeMessage, sendFeedback,
  validateFeedback,
} from './feedback.js';
// Corrupt's badge, already baked for the tutorial. The suggestion box borrows
// the same canvas rather than shipping a second crop of the same JPEG.
import { drawTrainer, loadTrainer } from './art/trainer.js';
// dayKey is the crew draw's rotation key — see crewDraw() — and with
// previousDayKey it is also la racha's clock (paintDaily). Same UTC day the
// boards and the save's `days` map use, so nothing in the game disagrees about
// when "today" starts.
import { dayKey, previousDayKey, pruneDays, recordDay } from './raceday.js';
import { initBoards, refreshBoards, relangBoards, showRunStanding } from './boards.js';
import { initAccount, refreshAccount, relangAccount, releaseAccount } from './account.js';
import * as gate from './gate.js';
import {
  initPrimoBrowser, openPrimoBrowser, releasePrimoBrowser,
} from './primo-browser.js';
import { initUiFeedback } from './ui-feedback.js';

/**
 * i18n for this module, with the picker's strings layered over the shared
 * table. They are in primo-picker.js only because js/i18n.js is being edited
 * by another session right now — see the note there. Anything not the picker's
 * falls through to i18n.js untouched, so every existing call site is unchanged.
 */
function t(key) {
  const extra = extraString(key, getLang());
  return extra !== undefined ? extra : tBase(key);
}

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false });

// The scene buffer. Everything expensive — sky, walls, road, props, the runner —
// is painted in here at a resolution the device can actually afford, then
// stretched onto the display canvas in one drawImage. The HUD and the tutorial
// are drawn AFTER that blit, straight onto the display canvas at its own full
// resolution, so the score and the stamina bar stay sharp however far the scene
// scale drops. See the header of js/perf.js for why the two are split.
const scene = document.createElement('canvas');
const sctx = scene.getContext('2d', { alpha: false });

const $ = (id) => document.getElementById(id);
const screens = {
  menu: $('screen-menu'),
  // The NFT gate. Listed here so a state change clears it like any other
  // screen; it is only ever raised at boot, by gateFirst().
  gate: $('screen-gate'),
  pause: $('screen-pause'),
  over: $('screen-over'),
  // Owned by js/tiendita.js, listed here so a state change can never leave one
  // of them up over the alley — continuing a run has to clear the offer.
  continue: $('screen-continue'),
  shop: $('screen-shop'),
  // Same reason: help is opened OVER pause or game over, so a state change
  // arriving while it is up has to take it down with everything else.
  help: $('screen-help'),
  // And feedback is opened over HELP, which is one level deeper again — so it
  // needs to be listed here for exactly the same reason help does.
  feedback: $('screen-feedback'),
};

let saved = store.load();
// Before anything paints. A save with no `lang` has never been asked, so the
// device decides; after that the saved choice wins forever.
initLang(saved.lang);

let customImg = null;      // source image for the HUD badge + menu tile
let customRig = null;      // baked head sprite + sampled outfit palette
let safe = { top: 0, bottom: 0 };

const roster = [...CREW, CUSTOM_TEMPLATE];
/**
 * The collection index, kept here so the synchronous rig builders can read a
 * token's traits. getIndex() memoises its own successes, so this is a
 * convenience handle rather than a second cache — null simply means the index
 * has not landed yet, and applyTraits() treats that as "no traits known" and
 * leaves the sampled rig alone.
 */
let primoIndex = null;
// Head sprites for the crew. Seeded at boot with the code-drawn approximations
// so the menu is never empty, then REPLACED with real collection art as it
// arrives from IPFS — see loadRealCrew().
const crewRigs = new Map();
const crewImgs = new Map();   // id -> the real PFP Image, once loaded
const crewNums = new Map();   // id -> token number, once loaded

const game = new Game({
  // game.js is read-only from the language work, so its handful of literals get
  // translated on the way to the screen rather than at the source.
  onToast: (text, color) => pushToast(tRaw(text), color),
  onStateChange: (s) => showScreen(s),
});

// ------------------------------------------------------------------ canvas

let viewW = 0;
let viewH = 0;

function resize() {
  // The display buffer keeps the full device ratio it always had: this is the
  // surface the HUD text lands on, and text is the one thing on screen that is
  // read rather than looked at. MOBILE.dprCap deliberately does NOT apply here —
  // it applies to the scene, which is where the fill rate actually goes.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  canvas.width = Math.floor(viewW * dpr);
  canvas.height = Math.floor(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // A stretched scene buffer wants a smooth stretch — a softer picture is the
  // whole bargain being struck, and nearest-neighbour would trade it for jaggies.
  ctx.imageSmoothingEnabled = true;
  // A rotation or a window drag changes the pixel count outright, so whatever
  // the scale had settled on was measured against a different screen.
  resetPerf();
  resizeScene();
  resizeCamera(viewW, viewH);
  safe = readSafeInsets();
}

/**
 * Size the scene buffer to `dprCap * sceneScale()`. Called on every resize and
 * again whenever perf.js moves the scale — which it does at most once every
 * MOBILE.settleMs, because reallocating a canvas backing store is itself a hitch.
 *
 * The transform means renderScene() still draws in CSS pixels and never learns
 * that it is being scaled at all.
 */
function resizeScene() {
  const sdpr = Math.min(MOBILE.dprCap, window.devicePixelRatio || 1) * sceneScale();
  const w = Math.max(1, Math.floor(viewW * sdpr));
  const h = Math.max(1, Math.floor(viewH * sdpr));
  if (scene.width === w && scene.height === h) return;
  scene.width = w;
  scene.height = h;
  // Resizing a canvas resets its context, so the transform goes back on after.
  sctx.setTransform(sdpr, 0, 0, sdpr, 0, 0);
}

// One probe, both insets. Notch at the top, home indicator at the bottom — the
// HUD has to clear each of them or the score sits under a sensor housing and
// the power pills sit under the gesture bar.
function readSafeInsets() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:1px;pointer-events:none;visibility:hidden;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  return { top, bottom };
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

// -------------------------------------------------------------------- loop

let last = performance.now();

/**
 * One frame, timed. The number handed to sampleFrame is OUR OWN WORK, measured
 * around update+render and nothing else — not the rAF delta, which is pinned to
 * the display refresh and reads a flat 16.7ms right up until the moment the
 * budget is already blown. See the header of js/perf.js.
 *
 * Wrapping rather than timing inline keeps the early returns below intact: a
 * tutorial frame is still a frame and still costs what it costs.
 */
function step(dt) {
  const t0 = performance.now();
  drawFrame(dt);
  const ms = performance.now() - t0;
  if (sampleFrame(ms, t0 + ms)) resizeScene();
}

function drawFrame(dt) {
  if (game.state !== STATE.PAUSED) game.update(dt);

  // Scene into the buffer, buffer onto the screen. The blit is opaque and
  // covers the viewport, so the display canvas needs no clear of its own.
  renderScene(sctx, game);
  ctx.drawImage(scene, 0, 0, viewW, viewH);

  const W = viewW;
  const H = viewH;

  // The course runs with the game parked in MENU, so the alley keeps scrolling
  // behind the cards instead of the lesson playing over a frozen frame.
  if (tutorialActive()) {
    if (updateTutorial(dt, game)) {
      drawTutorial(ctx, W, H, Math.min(W, H) / 420, safe.top, safe.bottom);
    } else {
      finishTutorial();
      startRun();
    }
    return;
  }

  if (game.state === STATE.PLAYING || game.state === STATE.PAUSED) {
    drawHUD(ctx, game, W, H, dt, safe.top, safe.bottom);
  }
}

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 1 / 20) dt = 1 / 20;      // a backgrounded tab must not teleport you
  step(dt);
  requestAnimationFrame(frame);
}

// Deterministic stepper for automated capture. An automated browser runs the
// page hidden, where requestAnimationFrame does not fire at all, so a screenshot
// otherwise catches whatever the last real frame happened to be. Fixed dt also
// makes captures reproducible between runs.
window.__step = (n = 1, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) step(dt);
  return { z: Math.round(game.player.z), state: game.state };
};
// The other half of the capture seam: paint what __step just computed. Without
// it a hidden page (rAF parked) can advance the world but never show it.
window.__draw = (dt = 1 / 60) => { drawFrame(dt); };
window.__game = game;
// Read-only: scene scale, the 80th-percentile work time it was decided on, and
// the buffer that scale currently implies.
window.__perf = () => {
  const s = perfStats();
  return { scale: s.scale, p80: s.p80, avg: s.avg, w: scene.width, h: scene.height };
};

// ------------------------------------------------------------------- input

let suppressTap = false;

canvas.addEventListener('pointerdown', (e) => {
  sfx.resume();
  // SKIP pill, same convention as the pause button: consume the tap so it does
  // not also fire a jump underneath.
  if (tutorialActive()) {
    suppressTap = tutorialTap(e.clientX, e.clientY);
    // And then start the run the pill was skipping TOWARD. The course ends two
    // ways: it runs out, which drawFrame() sees and follows with startRun(),
    // or the pill ends it from out here — and that branch is guarded by
    // tutorialActive(), which the pill has already turned off. So SKIP fell
    // through every sheet the course had hidden and left the player on an empty
    // scrolling alley with no UI and nothing to press.
    if (suppressTap && !tutorialActive()) startRun();
    return;
  }
  if (game.state !== STATE.PLAYING) { suppressTap = false; return; }
  const r = pauseRect;
  const inPause = e.clientX >= r.x - 6 && e.clientX <= r.x + r.w + 6 &&
                  e.clientY >= r.y - 6 && e.clientY <= r.y + r.h + 6;
  suppressTap = inPause;
  if (inPause) game.pause();
});

// Any input during the opening cuts straight to the run. A player who has seen
// the sequence once must never be made to sit through it again.
const skipIntroFirst = () => {
  if (game.state !== STATE.INTRO) return false;
  game.skipIntro();
  return true;
};

attachInput(canvas, {
  // During the course every verb is a lesson answer, never a move — the game is
  // parked in MENU underneath, so routing them on would do nothing anyway.
  lane: (d) => {
    if (tutorialActive()) { tutorialInput('lane', d); return; }
    if (!skipIntroFirst()) game.moveLane(d);
  },
  jump: () => {
    if (suppressTap) { suppressTap = false; return; }
    if (tutorialActive()) { tutorialInput('jump'); return; }
    if (!skipIntroFirst()) game.jump();
  },
  slide: () => {
    if (tutorialActive()) { tutorialInput('slide'); return; }
    if (!skipIntroFirst()) game.slide();
  },
  pause: () => (game.state === STATE.PAUSED ? game.resume() : game.pause()),
  mute: () => toggleMute(),
});

// ----------------------------------------------------------------- screens

// LA TABLA and CUENTA sit outside the game's state machine — they are opened
// from the menu and return to it. They are still `.screen`s, whose backgrounds
// are translucent so they can sit over the canvas; two visible at once would
// show through each other, so exactly one screen is ever un-hidden.
const overlays = {
  boards: $('screen-boards'),
  account: $('screen-account'),
  primos: $('screen-primos'),
};

/**
 * Pin or unpin the ? in the corner.
 *
 * It belongs to the MENU and to nothing else. Over a run it would sit on the
 * HUD; over pause, game over, the shop and the two cloud sheets it would be a
 * second way into a screen those already have their own button or their own
 * BACK for. So rather than being pushed a boolean from a dozen call sites it
 * reads the one thing that is actually true — whether the menu is up — and
 * every function that shows or hides a screen ends by calling it.
 */
function syncHelpFab() {
  $('btn-help-fab').classList.toggle('hidden', screens.menu.classList.contains('hidden'));
}

function showOverlay(name) {
  screens.menu.classList.add('hidden');
  overlays[name].classList.remove('hidden');
  syncHelpFab();
}

/** Dismiss every overlay. `backToMenu` restores the menu behind them. */
function hideOverlays(backToMenu) {
  for (const el of Object.values(overlays)) el.classList.add('hidden');
  releaseAccount();
  releasePrimoBrowser();
  if (backToMenu) screens.menu.classList.remove('hidden');
  syncHelpFab();
}

function showScreen(state) {
  for (const el of Object.values(screens)) el.classList.add('hidden');
  // A state change has to dismiss the overlays or they would linger over the run
  // that just started. `false`, because the branches below decide what shows.
  hideOverlays(false);
  if (state === STATE.MENU) {
    screens.menu.classList.remove('hidden');
    refreshStats();
  } else if (state === STATE.GATE) {
    // Deliberately paints nothing else: the gate is the only thing on screen
    // until it is passed, and refreshing stats behind it would be work for a
    // menu the player cannot see.
    screens.gate.classList.remove('hidden');
  } else if (state === STATE.PAUSED) {
    screens.pause.classList.remove('hidden');
  } else if (state === STATE.OVER) {
    // Tracked HERE and not inside offerContinue, which is also called on the
    // re-price path and on the way back from the shop — those are the same
    // offer being redrawn, and counting them again would inflate the
    // denominator of the one funnel this event exists for.
    track(EVENTS.CONTINUE_OFFER, {
      n: game.continues,
      cost: continueCost(game.continues),
      afford: wallet.balance() >= continueCost(game.continues),
    });
    // Corrupt gets to make his offer BEFORE the run is written down. That
    // ordering is the whole trick: a run you paid to continue is one run, not
    // two, and its chelas are banked once — see declineContinue().
    offerContinue(game, { onTake: takeContinue, onDecline: declineContinue });
  }
  syncHelpFab();
}

function refreshStats() {
  $('stat-best').textContent = saved.best.toLocaleString();
  $('stat-beers').textContent = saved.totalBeers.toLocaleString();
  $('stat-runs').textContent = saved.runs.toLocaleString();
  paintWallet();
  paintDaily();
}

// -------------------------------------------------------- coming back tomorrow

/**
 * The menu's daily card: la racha and the day's three jales. Read-only — the
 * run is what moves any of these numbers (see fillGameOver's settlement), so
 * this paints straight from disk and can be called as often as screens change.
 * Guarded per element: the card can ship to index.html independently of this
 * code and neither half breaks the other.
 */
function paintDaily() {
  const econ = store.load();
  const today = dayKey(new Date());
  const prev = previousDayKey(new Date());

  const chip = $('racha-chip');
  if (chip) {
    const len = rachaShown(econ.racha, today, prev);
    const risk = rachaAtRisk(econ.racha, today, prev);
    chip.classList.toggle('hidden', len === 0);
    chip.classList.toggle('risk', risk);
    if (len > 0) {
      $('racha-len').textContent = String(len);
      // At risk: say what running today PAYS — the next rung of the table —
      // because "don't lose it" lands harder with the number attached.
      const nextBonus = RACHA_TABLE[Math.min(risk ? len + 1 : len, RACHA_TABLE.length - 1)];
      $('racha-note').textContent = risk
        ? t('racha.risk').replace('%n', nextBonus)
        : t('racha.safe');
    }
  }

  const card = $('jales-card');
  if (card) {
    const st = jalesStatus(econ.jales, today);
    const rows = $('jales-rows');
    rows.innerHTML = '';
    for (const m of st.list) {
      const row = document.createElement('div');
      row.className = 'jale-row' + (m.done ? ' done' : '');
      const name = document.createElement('span');
      name.className = 'jale-name';
      name.textContent = t(`jale.${m.id}`).replace('%n', m.target.toLocaleString());
      row.appendChild(name);
      const prog = document.createElement('b');
      prog.className = 'jale-prog';
      prog.textContent = m.done ? '✓' : `${m.value.toLocaleString()}/${m.target.toLocaleString()}`;
      row.appendChild(prog);
      rows.appendChild(row);
    }
    const sweep = $('jales-sweep');
    if (sweep) {
      sweep.textContent = st.allDone ? t('jales.swept') : t('jales.sweep').replace('%n', JALE_SWEEP);
      sweep.classList.toggle('done', st.allDone);
    }
  }
}

/**
 * The game-over sheet's bonus lines — the moment the retention loop actually
 * pays, celebrated where the "one more run" decision is made. Empty container
 * when nothing landed: a sheet that says "+0" every run teaches the player to
 * stop reading it.
 */
function paintOverBonos(rachaRes, jalesRes, today) {
  const box = $('over-bonos');
  if (!box) return;
  box.innerHTML = '';
  const line = (cls, text, amount) => {
    const row = document.createElement('div');
    row.className = 'over-bono ' + cls;
    const s = document.createElement('span');
    s.textContent = text;
    row.appendChild(s);
    const b = document.createElement('b');
    b.textContent = `+${amount}`;
    row.appendChild(b);
    box.appendChild(row);
  };
  if (rachaRes?.counted && rachaRes.bonus > 0) {
    line('racha', t('racha.day').replace('%n', rachaRes.racha.len), rachaRes.bonus);
  }
  if (jalesRes) {
    const missions = jalesStatus(jalesRes.state, today).list;
    for (const id of jalesRes.completedNow || []) {
      const m = missions.find((x) => x.id === id);
      line('jale', t(`jale.${id}`).replace('%n', (m ? m.target : 0).toLocaleString()), JALE_REWARD);
    }
    if (jalesRes.sweepNow) line('sweep', t('jales.propina'), JALE_SWEEP);
  }
  box.classList.toggle('hidden', !box.children.length);
}

// ------------------------------------------------------------------ continue

function takeContinue() {
  const cost = continueCost(game.continues);
  if (wallet.spend(cost) === null) {
    // The balance moved under us — a purchase in another tab, or a shelf
    // bought between the offer being drawn and the button being pressed.
    // Re-price and ask again rather than hand out a free continue.
    offerContinue(game, { onTake: takeContinue, onDecline: declineContinue });
    return;
  }
  paintWallet();
  track(EVENTS.CONTINUE_TAKE, { n: game.continues, cost });
  closeContinue();
  clearToasts();
  sfx.resume();
  // Same run: score, distance and combo all stand. continueRun() puts the
  // screen back to PLAYING through onStateChange.
  game.continueRun();
}

function declineContinue() {
  track(EVENTS.CONTINUE_DECLINE, {
    n: game.continues,
    cost: continueCost(game.continues),
    afford: wallet.balance() >= continueCost(game.continues),
  });
  closeContinue();
  fillGameOver();
  screens.over.classList.remove('hidden');
}

function fillGameOver() {
  // Re-read rather than trusting the module-level copy: a cloud sync that landed
  // mid-run has already merged and persisted a newer save, and writing this
  // run's result on top of a stale object would throw that away. Cheap, and it
  // closes the one path in the game that can lose progress.
  saved = store.load();

  const isPB = game.score > saved.best;
  saved.best = Math.max(saved.best, game.score);
  saved.bestBeers = Math.max(saved.bestBeers, game.beers);
  saved.runs += 1;
  saved.totalBeers += game.beers;
  // Bank the takings BEFORE store.save(), which restores the wallet fields
  // from disk over whatever `saved` is holding — see ECON_KEYS in store.js.
  //
  // The settlement — takings, the racha bonus and the day's jales — happens in
  // ONE wallet.bankRun write, so every payout and the latch that says it was
  // paid land together or not at all. The callback runs against the blob on
  // DISK, not `saved`: racha/jales are ECON_KEYS for exactly this reason.
  const today = dayKey(new Date());
  const runStats = {
    beers: game.beers, tacos: game.tacos, slides: game.slides, jumps: game.jumps,
    powerups: game.powerups, smashes: game.smashes, drones: game.drones,
    score: Math.floor(game.score), distance: Math.floor(game.distance),
    bestMult: game.bestMult,
  };
  let rachaRes = null;
  let jalesRes = null;
  wallet.bankRun(game.beers, (b) => {
    rachaRes = settleRacha(b.racha, today);
    jalesRes = applyJalesRun(b.jales, today, runStats);
    b.racha = rachaRes.racha;
    b.jales = jalesRes.state;
    return rachaRes.bonus + jalesRes.payout;
  });
  for (const id of jalesRes?.completedNow || []) {
    track(EVENTS.MISSION_DONE, { id, day: today });
  }
  // Today's board takes the day's BEST, not the last run — recordDay keeps the
  // max. pruneDays stops the map growing forever, since it rides every cloud
  // push; days older than the cutoff are already immutable on the server.
  //
  // A run that bought a continue is still eligible, so the score submitted is
  // the score on screen — but it goes up MARKED. game.continues counts only the
  // ones paid for during this run, so this is exactly "did they pay to be here".
  recordDay(saved, game.score, new Date(), game.continues > 0);
  pruneDays(saved);
  store.save(saved);   // the store listener debounce-pushes this, boards included
  paintWallet();

  $('over-reason').textContent = tRaw(game.gameOverReason);
  $('over-score').textContent = Math.floor(game.score).toLocaleString();
  $('over-beers').textContent = game.beers;
  $('over-tacos').textContent = game.tacos;
  $('over-dist').textContent = Math.floor(game.distance);
  $('over-pb').classList.toggle('hidden', !isPB);
  paintOverBonos(rachaRes, jalesRes, today);

  // The run, written down once. This is the ONLY run_end in the game, and it
  // sits here rather than in game.end() on purpose: end() also fires for a bust
  // the player then pays their way out of, and that is one run, not two — the
  // same reasoning that decides where the chelas are banked, three lines up.
  //
  // The shape of a run is the whole point. "Where do players quit" for an
  // endless runner is a distribution, not a funnel step, so score/seconds/
  // distance all travel and the dashboard buckets them.
  track(EVENTS.RUN_END, {
    score: Math.floor(game.score),
    distance: Math.floor(game.distance),
    seconds: Math.floor(game.time),
    beers: game.beers,
    tacos: game.tacos,
    continues: game.continues,
    // The untranslated key, not the sentence on screen — a reason grouped by
    // language would split every row in two.
    reason: game.gameOverReason || 'unknown',
    pb: isPB,
    // The retention loop, riding the run it settled on: the streak as it now
    // stands, and how many of today's jales are done after this run. "Do
    // dailies keep people running" is answerable from run_end alone.
    racha: rachaRes?.racha?.len ?? 0,
    jalesDone: jalesRes ? Object.keys(jalesRes.state.done || {}).length : 0,
    // Air support, from the run's own counters: passes survived. Whether the
    // drone is fair is a question this pair answers (dodges vs runs that
    // ended right after startTime).
    drones: game.drones,
  });

  // Fire-and-forget: it reveals itself only once it has a real rank to show.
  void showRunStanding();
}

// ------------------------------------------------------------------ language

/**
 * Repaint every word the DOM owns. Cheap enough to run on every switch — the
 * menu is a few dozen nodes — and it means there is exactly one place that
 * knows how a screen gets its text, whichever screen happens to be up.
 *
 * The canvas needs nothing here: drawHUD and drawTutorial call t() as they
 * draw, so they pick the new language up on the very next frame by themselves.
 */
function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang;

  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) {
    el.placeholder = t(el.dataset.i18nPh);
  }
  // Labels nobody can see. The ? in the corner is a glyph and nothing else, so
  // its aria-label is the only name a screen reader has for it — and an
  // English one on a Spanish menu is the one bit of the page that never got
  // switched.
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  for (const btn of document.querySelectorAll('.lang button[data-lang]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
  }

  // The rest is text the DOM cannot carry an attribute for: it is composed
  // from live state rather than sat in the markup.
  $('btn-mute').textContent = t(sfx.isMuted() ? 'pause.soundOff' : 'pause.soundOn');
  labelCrew();
  // The empty custom tile draws "MY / PRIMO" into its own canvas, which no
  // data-i18n attribute can reach. It used to read "MI" in both languages, so
  // skipping this was invisible; it is not any more. Five 132px tiles.
  paintCrew();
  // The found card is state, not markup, so data-i18n cannot reach it — but it
  // is on screen mid-claim and must not be left half in the old language.
  if (found) {
    $('primo-found-num').textContent = t('crew.primoNum') + found.n;
    applyClaimState(found.n, found.claim);
  }
  // Transient feedback about an action taken in the OTHER language. Clearing
  // it beats leaving a stale sentence in the wrong one; the styling hides an
  // empty status line entirely.
  status('');
  // Same rule for the suggestion box's own line, and its counter is composed
  // from live state ("%n left") so no data-i18n attribute can reach it.
  fbStatus('');
  paintFbCount();
  // A run that ended in the other language must not keep its old headline.
  if (game.gameOverReason) $('over-reason').textContent = tRaw(game.gameOverReason);
  // Both overlays compose their text from live state — names, ranks, the board
  // key, the signed-in email — so the data-i18n sweep above cannot reach any of
  // it. Each is a no-op unless its screen is actually up.
  relangBoards();
  relangAccount();
}

onLangChange(() => {
  saved.lang = getLang();
  store.save(saved);
  applyLang();
});

for (const btn of document.querySelectorAll('.lang button[data-lang]')) {
  btn.addEventListener('click', () => {
    sfx.resume();
    sfx.uiClick();
    setLang(btn.dataset.lang);
  });
}

// -------------------------------------------------------------- crew picker

let selectedIdx = 0;

function buildCrew() {
  const wrap = $('crew');
  wrap.innerHTML = '';
  roster.forEach((c, i) => {
    const cv = document.createElement('canvas');
    cv.width = 132;
    cv.height = 132;
    cv.title = c.name;
    cv.addEventListener('click', () => {
      sfx.resume();
      sfx.uiClick();
      // An EMPTY custom slot is not a character, it is an invitation. Selecting
      // it used to hand you the hand-drawn stand-in and call that your Primo,
      // which is exactly what the `+` was promising not to do. Once a Primo has
      // been claimed the slot behaves like any other tile and simply selects.
      if (c.id === CUSTOM_ID && !customImg) { openPrimos(); return; }
      selectCrew(i);
    });
    wrap.appendChild(cv);
  });
  paintCrew();
}

function paintCrew() {
  const tiles = $('crew').querySelectorAll('canvas');
  roster.forEach((c, i) => {
    const cv = tiles[i];
    if (!cv) return;
    const c2 = cv.getContext('2d');
    c2.clearRect(0, 0, 132, 132);
    const grad = c2.createLinearGradient(0, 0, 0, 132);
    grad.addColorStop(0, '#4a2f58');
    grad.addColorStop(1, '#1d1229');
    c2.fillStyle = grad;
    c2.fillRect(0, 0, 132, 132);
    const isCustom = c.id === CUSTOM_ID;
    if (isCustom && !customImg) {
      c2.fillStyle = 'rgba(253,246,230,0.5)';
      c2.font = '800 15px ui-rounded, system-ui, sans-serif';
      c2.textAlign = 'center';
      c2.fillText(t('crew.tileMi'), 66, 62);
      c2.fillText(t('crew.tilePrimo'), 66, 80);
      c2.font = '700 30px system-ui, sans-serif';
      c2.fillText('+', 66, 40);
    } else {
      const art = isCustom ? customImg : crewImgs.get(c.id);
      if (!art && !isCustom && crewArtPending) {
        // ⚠ NOT the drawn stand-in, for this brief moment only.
        //
        // The cartoons used to be painted immediately and then swapped for real
        // collection art a moment later, which read as the game glitching on
        // every single launch — four faces visibly changing identity is a much
        // louder event than four faces arriving. The stand-ins are still the
        // fallback and still the reason the menu is never empty; they just stop
        // being shown during the window where they are about to be replaced.
        //
        // See crewArtPending: the window closes the instant the art lands, and
        // in any case after CREW_ART_GRACE, so a cold or offline device gets its
        // cartoons and never sits looking at placeholders.
        c2.fillStyle = 'rgba(253,246,230,0.10)';
        c2.beginPath();
        c2.arc(66, 60, 26, 0, Math.PI * 2);
        c2.fill();
        c2.beginPath();
        c2.ellipse(66, 116, 38, 26, 0, Math.PI, Math.PI * 2);
        c2.fill();
      } else {
        // Real collection art once it has landed; the drawn stand-in until then.
        drawPrimoPortrait(c2, 66, 84, 112, c, { img: art || null });
      }
    }
    cv.classList.toggle('on', i === selectedIdx);
  });
}

// The drawn crew's outfit blurbs. Keyed by character id rather than read off
// the roster, because runner.js owns the English original and this is the one
// place that decides which language it comes out in.
const CREW_TAG = {
  chuy: 'crew.tag.chuy',
  lupe: 'crew.tag.lupe',
  rosa: 'crew.tag.rosa',
  beto: 'crew.tag.beto',
};

/** Name + blurb under the tiles. Split out so a language switch can redo it. */
function labelCrew() {
  const c = roster[selectedIdx];
  if (!c) return;
  const custom = c.id === CUSTOM_ID;
  // Once a slot is showing real art it is that Primo, not the stand-in — so it
  // is named for its token rather than keeping the placeholder's name.
  const num = custom ? saved.primoNumber : crewNums.get(c.id);
  const tag = CREW_TAG[c.id];

  // The four drawn characters are people and keep their names in any language.
  // The empty custom slot is not a person, it is the words "my Primo", so that
  // one is translated — runner.js hardcodes the Spanish and is read-only here.
  const name = num ? t('crew.primoNum') + num
    : custom ? t('crew.customName')
      : c.name;

  $('crew-name').textContent = name;
  // Set here rather than in selectCrew so a language switch refreshes it too —
  // the intro titles the run with this, and it has to agree with the picker.
  game.displayName = name;
  $('crew-tag').textContent = custom && !customRig
    ? t('crew.tag.load')
    : custom ? t('crew.tag.barrio')
      : num ? t('crew.tag.collection')
        : tag ? t(tag) : c.tagline;   // an unknown id keeps runner.js's own line
}

function selectCrew(i) {
  selectedIdx = i;
  const c = roster[i];
  const custom = c.id === CUSTOM_ID;
  // labelCrew writes game.displayName as well, so the intro always agrees with
  // the picker — a slot showing real art is that Primo, not the stand-in whose
  // name it inherited.
  labelCrew();

  const rig = custom ? customRig : crewRigs.get(c.id);
  const art = custom ? customImg : crewImgs.get(c.id);
  game.setCharacter(c, rig, art || null);
  saved.character = c.id;
  store.save(saved);
  paintCrew();
}

// ------------------------------------------------------------ real primos

const status = (msg) => { $('primo-status').textContent = msg; };

/**
 * Swap the code-drawn crew for real collection art.
 *
 * The four built-in characters are hand-coded cartoons standing in for Primos,
 * and next to the actual art they read as exactly that. The whole pipeline for
 * using the real thing already existed for the "MI PRIMO" slot — this points
 * the default roster at it too, on a fresh random draw every launch so the
 * menu is four different faces each time you open it.
 *
 * Deliberately non-blocking and best-effort: the drawn heads are already in
 * place, so a slow gateway, a rate-limit or being offline costs nothing but the
 * upgrade, and there is never an empty menu or a wait. Nothing here is stored
 * in the repo — the index holds CIDs, and the pixels live in the browser.
 *
 * WHY THIS STOPPED WORKING. Three faults, all silent:
 *   · getIndex() memoised its own failures, so one flaky fetch at boot left an
 *     empty index for the whole session and this returned before doing
 *     anything (fixed in primo-picker.js — only successes are cached now);
 *   · loadHead() has no timeout, and a stalled gateway resolves neither load
 *     nor error, so the `for (const gw of GATEWAYS)` fallback below could
 *     never be reached while the first one hung (fenced in loadPrimoArt);
 *   · the second of the three gateways was cloudflare-ipfs.com, which has not
 *     resolved since Cloudflare retired it.
 * Each one leaves the cartoons on screen with nothing logged, which is exactly
 * how it looks when it "just doesn't work".
 */
// The crew draw, remembered for the UTC day.
//
// ⚠ THIS IS THE FIX FOR THE ART FLASH, and the draw is where the flash came
// from. drawTokens() picked four NEW tokens on every single launch, so the four
// images could never be anything but a cache miss — every launch re-fetched
// four PFPs from a public gateway, and the hand-drawn cartoons sat on screen
// until they landed. The cache in js/primo-cache.js could not help, because the
// game never asked for the same token twice.
//
// Rotating daily keeps what the randomness was for — the menu is four different
// faces, not four fixed strangers — while making every launch after the first
// one of the day an instant cache hit. One day's four images per device instead
// of four per launch.
const CREW_DRAW_KEY = 'primos-run:crew-draw';

/**
 * How long the crew tiles will hold a placeholder rather than show a stand-in
 * that is about to be replaced. See the branch in paintCrew().
 *
 * With a warm art cache the real faces land far inside this, so the swap the
 * player used to see simply does not happen. Cold or offline, it is the longest
 * anyone waits before the cartoons appear and stay — which is the old behaviour,
 * just under three quarters of a second of a quiet placeholder first.
 */
const CREW_ART_GRACE = 900;
let crewArtPending = true;

/** Close the window and repaint, whatever happened. Idempotent. */
function endCrewGrace() {
  if (!crewArtPending) return;
  crewArtPending = false;
  paintCrew();
}

function crewDraw(idx) {
  const today = dayKey();
  try {
    const saved = JSON.parse(localStorage.getItem(CREW_DRAW_KEY) || 'null');
    if (saved && saved.day === today && Array.isArray(saved.tokens)
        && saved.tokens.length === CREW.length
        // A token that has fallen out of the index (a re-harvest) would draw a
        // blank tile forever, so the remembered draw is only trusted while
        // every one of its members still resolves.
        && saved.tokens.every((n) => cidFor(idx, n))) {
      return saved.tokens;
    }
  } catch {
    /* unreadable — fall through and draw a fresh set */
  }
  const tokens = drawTokens(idx, CREW.length);
  try {
    localStorage.setItem(CREW_DRAW_KEY, JSON.stringify({ day: today, tokens }));
  } catch {
    /* blocked — the draw is simply per-launch again, as it used to be */
  }
  return tokens;
}

async function loadRealCrew() {
  const idx = await getIndex();
  primoIndex = idx;
  const tokens = crewDraw(idx);
  if (!tokens.length) return;

  await Promise.all(CREW.map(async (c, i) => {
    const num = tokens[i];
    const cid = cidFor(idx, num);
    if (!cid) return;
    const result = await loadPrimoArt(cid);
    if (!result) return;
    // Keep the character's own trousers; everything above comes from the art —
    // its colours by sampling, its STRUCTURE from the token's own traits.
    crewRigs.set(c.id, applyTraits({ ...result.head, pants: c.pants },
      traitsFor(idx, num)));
    crewImgs.set(c.id, result.img);
    crewNums.set(c.id, String(num));
    paintCrew();
    // If this one is already on screen, re-select so the rig and the badge
    // pick up the real art immediately rather than on the next tap.
    if (roster[selectedIdx].id === c.id) selectCrew(selectedIdx);
  }));
  // Every token has resolved one way or the other. Any tile still without art
  // is one whose gateway never answered, and it should show its stand-in now
  // rather than wait out the rest of the grace window.
  endCrewGrace();
}

/**
 * Put a loaded Primo on the runner and write the claim down.
 *
 * `customImage` + `primoNumber` are the whole persistence story and the seam
 * the cloud save hooks onto: the token number and the exact source URL it came
 * from, under the keys store.js already defines. Nothing else needs to travel.
 *
 * @param {'number'|'browse'} by which of the two doors this came through, for
 *   the event below. It is passed in rather than guessed from `src`: both doors
 *   now end at a real token whose art came off the same gateway walk, so there
 *   is nothing left in the arguments that tells them apart.
 */
function wearPrimo(result, src, number, by = 'number') {
  const traits = Number.isFinite(number) && primoIndex
    ? traitsFor(primoIndex, number) : null;
  customRig = applyTraits({ ...result.head, pants: '#2f3a52' }, traits);
  customImg = result.img;
  saved.customImage = src;
  saved.primoNumber = Number.isFinite(number) ? number : null;
  store.save(saved);
  // HOW they got there, never WHICH Primo or from what URL. A token number is a
  // wallet fingerprint on a public chain, and the gateway URL is a CID with the
  // same number behind it — neither belongs in an event log this game does not
  // need them in. `by` answers the only question worth asking: of the two ways
  // in, which one do people actually use.
  track(EVENTS.PRIMO_SET, { by });
  selectCrew(roster.length - 1);
  syncPrimoPanel();
}

/**
 * CLEAR only exists once there is something to clear.
 *
 * It is the one control in that panel that is about a Primo you already have,
 * and offering it to a player who has never claimed one reads as a button that
 * does nothing — which is exactly what it did.
 */
function syncPrimoPanel() {
  const has = saved.primoNumber != null || !!saved.customImage;
  $('btn-clear-primo').classList.toggle('hidden', !has);
}

// ----------------------------------------------------------- find & claim

// The Primo currently sitting in the found card, waiting to be claimed.
let found = null;   // { n, result, url, claim }

const foundCard = $('primo-found');

function hideFound() {
  found = null;
  foundCard.classList.add('hidden');
}

/** Paint the found card: the art, its number, and whether it can be taken. */
function showFound(n, result, url, claim) {
  found = { n, result, url, claim };
  foundCard.classList.remove('hidden');

  const cv = $('primo-preview');
  const c2 = cv.getContext('2d');
  c2.clearRect(0, 0, cv.width, cv.height);
  const grad = c2.createLinearGradient(0, 0, 0, cv.height);
  grad.addColorStop(0, '#4a2f58');
  grad.addColorStop(1, '#1d1229');
  c2.fillStyle = grad;
  c2.fillRect(0, 0, cv.width, cv.height);
  drawPrimoPortrait(c2, 66, 84, 112, CUSTOM_TEMPLATE, { img: result.img });

  $('primo-found-num').textContent = t('crew.primoNum') + n;
  applyClaimState(n, claim);
}

/** The verdict line + the button, for a claim state that may still be pending. */
function applyClaimState(n, claim) {
  const line = $('primo-found-state');
  const btn = $('btn-claim');
  const mine = saved.primoNumber === n;
  if (found && found.n === n) found.claim = claim;

  if (!claim) {                       // still asking
    line.textContent = t('claim.checking');
    line.className = 'found-state';
    btn.disabled = true;
    btn.textContent = t('primo.claim');
    return;
  }
  // The owner's correction outranks the local belief, deliberately: a player
  // who took someone else's Primo has it in their own save, and if "already
  // mine" were checked first they would be the one person the reassignment
  // never reached.
  if (claim.state === 'free' && mine) {
    line.textContent = t('claim.mine');
    line.className = 'found-state ok';
    btn.disabled = true;
    btn.textContent = t('primo.claimed');
    return;
  }
  if (claim.state === 'blocked') {
    line.textContent = t('claim.blocked');
    line.className = 'found-state no';
    btn.disabled = true;
  } else if (claim.state === 'assigned') {
    line.textContent = claim.holder
      ? t('claim.assignedTo').replace('%h', claim.holder)
      : t('claim.assigned');
    line.className = 'found-state no';
    btn.disabled = true;
  } else {
    line.textContent = t('claim.free');
    line.className = 'found-state ok';
    btn.disabled = false;
  }
  btn.textContent = t('primo.claim');
}

/**
 * Find one Primo by number and show it. Does NOT claim it — seeing your Primo
 * and taking it are two different taps, so a typo is a look, not a swap.
 *
 * Every branch says something out loud: searching, found, out of range, in
 * range but not indexed, indexed but no gateway would answer.
 */
async function findPrimo(n) {
  if (!Number.isFinite(n) || n < 0 || n > MAX_TOKEN) {
    hideFound();
    status(t('status.outOfRange'));
    return;
  }
  hideFound();
  status(t('status.searching').replace('%n', n));

  const idx = await getIndex();

  primoIndex = idx;
  if (!indexReady()) { status(t('status.noIndex')); return; }

  const cid = cidFor(idx, n);
  if (!cid) {
    status(t('status.notIndexed').replace('%n', n).replace('%h', idx.count || Object.keys(idx.images).length));
    return;
  }

  // The art and the claim check are independent — asked together so the card
  // is never waiting on the slower of two round trips in series.
  const [result, claim] = await Promise.all([loadPrimoArt(cid), claimStatus(n)]);
  if (!result) {
    status(t('status.gatewayOut').replace('%n', n));
    return;
  }
  showFound(n, result, result.url, claim);
  status(claim.state === 'free' ? t('status.found') : '');
}

$('btn-claim').addEventListener('click', async () => {
  if (!found) return;
  sfx.uiClick();
  const { n, result, url } = found;

  // Asked again at the moment of the claim rather than trusted from the
  // search: this is a network call in waiting, and the answer can move between
  // the two taps. The button is parked while it answers.
  $('btn-claim').disabled = true;
  applyClaimState(n, null);
  const claim = await claimStatus(n);
  applyClaimState(n, claim);
  if (claim.state !== 'free') {
    status('');
    return;
  }

  wearPrimo(result, url, n);
  status(t('status.claimedNum').replace('%n', n));
  applyClaimState(n, claim);
});

// The picker is a <details>, so "opened it" is the toggle going open — and only
// that direction, or closing it would count as a second visit.
$('primo-panel').addEventListener('toggle', () => {
  if ($('primo-panel').open) track(EVENTS.PRIMO_OPEN);
});

$('btn-num').addEventListener('click', () => {
  sfx.uiClick();
  findPrimo(parseInt($('primo-num').value, 10));
});

$('primo-num').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-num').click();
});

$('btn-random').addEventListener('click', async () => {
  sfx.uiClick();
  const idx = await getIndex();
  primoIndex = idx;
  if (!indexReady()) { status(t('status.noIndex')); return; }
  const [n] = drawTokens(idx, 1);
  if (n === undefined) { status(t('status.noIndex')); return; }
  $('primo-num').value = n;
  findPrimo(Number(n));
});

// The other door: don't know the number, go and look. Same screen the empty
// MY PRIMO tile opens, and it lands on whatever is already being worn.
$('btn-primo-browse').addEventListener('click', () => {
  sfx.uiClick();
  openPrimos();
});

$('btn-clear-primo').addEventListener('click', () => {
  customImg = null;
  customRig = null;
  saved.customImage = null;
  saved.primoNumber = null;
  store.save(saved);
  hideFound();
  status(t('status.cleared'));
  if (roster[selectedIdx].id === CUSTOM_ID) selectCrew(0);
  else paintCrew();
  syncPrimoPanel();
});

/**
 * Put the player's claimed Primo back on at launch.
 *
 * A claim is a token number first and a URL second. The saved URL names one
 * gateway and that gateway will eventually have a bad day, so a claim with a
 * number behind it is re-fetched through the whole gateway walk and only falls
 * back to the stored URL.
 *
 * The URL-only branch is now history, but it is LOAD BEARING history: a save
 * written before the paste-a-URL box and the file picker were removed can still
 * hold a plain image URL or a data URL with no number beside it, and that
 * player's Primo has to keep coming back. Nothing writes that shape any more.
 */
async function restoreClaim() {
  if (!saved.customImage && saved.primoNumber == null) return;

  let result = null;
  if (Number.isFinite(saved.primoNumber)) {
    // The correction has to actually reach the player holding the token, or
    // "I can always reassign it" reassigns nothing. Checked at launch, before
    // the art is worth fetching. Fails open — see claimStatus().
    const claim = await claimStatus(saved.primoNumber);
    if (claim.state !== 'free') {
      const n = saved.primoNumber;
      customImg = null;
      customRig = null;
      saved.customImage = null;
      saved.primoNumber = null;
      store.save(saved);
      if (roster[selectedIdx].id === CUSTOM_ID) selectCrew(0);
      else paintCrew();
      syncPrimoPanel();
      status(t('status.reassigned').replace('%n', n));
      return;
    }
    const idx = await getIndex();
    primoIndex = idx;
    const cid = cidFor(idx, saved.primoNumber);
    if (cid) result = await loadPrimoArt(cid);
  }
  if (!result && saved.customImage) result = await loadPrimoUrl(saved.customImage);
  if (!result) return;

  // Through applyTraits, exactly like wearPrimo(). This is the path a RETURNING
  // player takes — the common one — so building the rig raw here meant the
  // traits only ever showed on the run where the Primo was first picked, and
  // were gone the next time the game was opened.
  customRig = applyTraits({ ...result.head, pants: '#2f3a52' },
    primoIndex && Number.isFinite(saved.primoNumber)
      ? traitsFor(primoIndex, saved.primoNumber) : null);
  customImg = result.img;
  paintCrew();
  if (roster[selectedIdx].id === CUSTOM_ID) selectCrew(selectedIdx);
}

// ----------------------------------------------------------------- buttons

/**
 * Every road into a run comes through here, so the shelf is always cashed in
 * exactly once: whatever was bought at la tiendita is taken off the shelf and
 * handed to the run as a loadout.
 */
function startRun() {
  clearToasts();
  const stock = wallet.takeStock();
  // The shelf ids themselves, not just a count: "players who bring a skateboard
  // run twice as long" is the shape of question la tiendita's pricing needs.
  track(EVENTS.RUN_START, { loadout: stock.length, items: stock.join(',') || null });
  game.start(loadoutFor(stock));
  wearFit();
}

/**
 * Resolve what is WORN into the style blocks the renderer draws from, and hang
 * them on the live rig. Called after game.start() because reset() rebuilds
 * player.rig, and again whenever the shop changes the fit — so a mask bought
 * at the continue offer is on the runner's head for the very next run.
 * Resolved HERE so the art layer never learns the catalog exists.
 */
function wearFit() {
  const fit = wallet.fitOn();
  const styles = {
    mask: fit.mask ? gearStyleFor(fit.mask) : null,
    chain: fit.chain ? gearStyleFor(fit.chain) : null,
  };
  if (game.player.rig) game.player.rig.fit = styles;
  if (game.rig) game.rig.fit = styles;
}
onFitChange(wearFit);

$('btn-play').addEventListener('click', () => {
  sfx.resume();
  sfx.uiClick();
  clearToasts();
  // First run: teach before the first round. The game stays in MENU so the
  // alley scrolls behind the course; step() calls startRun() when it ends.
  if (tutorialNeeded()) {
    hideAllScreens();
    startTutorial();
    return;
  }
  startRun();
});

$('btn-shop').addEventListener('click', () => {
  sfx.resume();
  sfx.uiClick();
  openShop(() => showScreen(STATE.MENU));
  // The shop hides the sheets itself, from js/tiendita.js, which knows nothing
  // about the ?. Without this it would float over the counter.
  syncHelpFab();
});

// Straight back to the sheet it came from, NOT through showScreen(OVER) —
// that would re-open the continue offer and bank the run a second time.
$('btn-shop-over').addEventListener('click', () => {
  sfx.resume();
  sfx.uiClick();
  openShop(() => screens.over.classList.remove('hidden'));
});

$('btn-boards').addEventListener('click', () => {
  sfx.uiClick();
  track(EVENTS.BOARD_OPEN);
  showOverlay('boards');
  refreshBoards();
});
$('btn-boards-back').addEventListener('click', () => { sfx.uiClick(); hideOverlays(true); });

$('btn-account').addEventListener('click', () => {
  sfx.uiClick();
  showOverlay('account');
  refreshAccount();
});
$('btn-account-back').addEventListener('click', () => {
  sfx.uiClick();
  hideOverlays(true);
  saved = store.load();   // a restore may have replaced everything behind the screen
  refreshStats();
  syncPrimoPanel();
});

/** Open the collection browser, landing on the Primo already being worn. */
function openPrimos() {
  showOverlay('primos');
  void openPrimoBrowser(saved.primoNumber);
}

$('btn-resume').addEventListener('click', () => { sfx.uiClick(); game.resume(); });
$('btn-quit').addEventListener('click', () => {
  sfx.uiClick();
  sfx.stopMusic();
  game.state = STATE.MENU;
  game.reset();
  showScreen(STATE.MENU);
});

// -------------------------------------------------------------------- help
//
// One sheet, three doors: the ? pinned to the corner of the menu, the pause
// sheet, and the game over sheet. Those are the three places a player is
// standing when they want the rules — and the menu's old collapsed `how` list
// could only ever answer from one of them, while sitting under the stats where
// nobody looked. That list is gone; this is all of it now.
//
// Opening it touches NO game state: the run stays paused and the game over
// sheet keeps its numbers, so reading the rules can never cost a run. It goes
// straight back to the sheet it was opened from rather than through
// showScreen(), which for game over would re-open Corrupt's continue offer and
// bank the run a second time.

let helpBack = null;

function openHelp(back) {
  sfx.uiClick();
  helpBack = back;
  back.classList.add('hidden');
  screens.help.classList.remove('hidden');
  // RUN THE TRAINING AGAIN ends the run it is pressed from — the course plays
  // over a reset alley, and there is no way back into a run once it has. From
  // pause that is a live run being thrown away by a button the player pressed
  // expecting to read something, so the whole block goes. From the menu and
  // from game over there is nothing to lose.
  $('help-train').classList.toggle('hidden', back === screens.pause);
  syncHelpFab();
}

function closeHelp() {
  sfx.uiClick();
  screens.help.classList.add('hidden');
  (helpBack || screens.menu).classList.remove('hidden');
  helpBack = null;
  syncHelpFab();
}

/**
 * Take Corrupt's course again, from the menu or from the game over sheet.
 *
 * The course is taught over a LIVE alley with the game parked in MENU — that is
 * the only state it has ever run in (see the first-run branch of btn-play) and
 * the only one where the scenery behind it scrolls. So whatever screen this was
 * reached from, the run is ended and the game put back to MENU first, exactly
 * as QUIT TO MENU does, and only then is everything hidden for the overlay.
 *
 * When it finishes, drawFrame() calls startRun() — same as the first time.
 */
function startTraining() {
  sfx.uiClick();
  sfx.stopMusic();
  clearToasts();
  screens.help.classList.add('hidden');
  helpBack = null;
  game.state = STATE.MENU;
  game.reset();
  showScreen(STATE.MENU);
  resetTutorial();
  hideAllScreens();
  startTutorial();
}

/** Clear the deck for the tutorial overlay: no sheet, no ?, just the alley. */
function hideAllScreens() {
  for (const el of Object.values(screens)) el.classList.add('hidden');
  syncHelpFab();
}

$('btn-help-fab').addEventListener('click', () => openHelp(screens.menu));
$('btn-help-pause').addEventListener('click', () => openHelp(screens.pause));
$('btn-help-over').addEventListener('click', () => openHelp(screens.over));
$('btn-help-back').addEventListener('click', closeHelp);
$('btn-help-train').addEventListener('click', startTraining);

// ---------------------------------------------------------------- feedback
//
// Corrupt's face on the HELP sheet, and the sheet it opens. Same open-over /
// close-back-to-where-you-were shape as help itself, one level deeper: help is
// reached from pause or game over, and this is reached from help, so closing it
// returns to help and closing THAT returns to the sheet the player started on.
// No game state is touched at any point — a bug report cannot cost the run that
// produced it, which matters most for the reports that are worth having.

/**
 * Paint Corrupt into one of the badge canvases.
 *
 * The badge is baked once by js/art/trainer.js from a JPEG that may not have
 * landed yet, so this is called again when it does. Backing store is CSS size ×
 * dpr — the same rule the rest of the game's canvases follow — because a 72px
 * bitmap stretched over a 3× phone is exactly the soft, cheap look this face is
 * meant to avoid.
 */
function paintCorruptFace(id) {
  const c = $(id);
  if (!c) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const css = c.getBoundingClientRect().width || c.clientWidth || 72;
  const px = Math.round(css * dpr);
  if (px <= 0) return;
  if (c.width !== px) { c.width = px; c.height = px; }
  const x = c.getContext('2d');
  x.clearRect(0, 0, px, px);
  // Inset by a hair so the gold ring's own stroke is not clipped by the edge.
  drawTrainer(x, px / 2, px / 2, px * 0.96);
}

function paintCorruptFaces() {
  paintCorruptFace('corrupt-face-help');
  paintCorruptFace('corrupt-face-fb');
}

let fbKind = 'bug';
let fbSending = false;

function fbStatus(msg, bad = false) {
  const el = $('fb-status');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
}

/**
 * What was happening when they hit send.
 *
 * This is the difference between "the slide doesn't work" and a report someone
 * can act on, and the player will not type any of it. Deliberately small and
 * deliberately not personal: where they were, how the run was going, and which
 * Primo is on screen — the last one because half the art bugs in this game are
 * a specific token's traits.
 */
function feedbackContext() {
  try {
    return {
      screen: game.state,
      score: Math.round(game.score),
      best: saved.best,
      runs: saved.runs,
      beers: wallet.balance(),
      primo: saved.character === CUSTOM_ID ? (saved.primoNumber ?? 'custom') : saved.character,
      trained: !!saved.trainedAt,
      // Which build is already on the row; this is the shape of the DEVICE,
      // which is the other half of most "it only happens on my phone" reports.
      view: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      standalone: !!(window.matchMedia?.('(display-mode: standalone)').matches
        || window.navigator.standalone),
    };
  } catch {
    // Context is a nice-to-have on a message that is not. Losing it must never
    // lose the report.
    return {};
  }
}

function paintFbCount() {
  const left = MAX_MESSAGE - $('fb-message').value.length;
  const el = $('fb-count');
  // Only once it is worth knowing. A 1000-character budget shown against an
  // empty box reads as a demand for an essay, and this box wants one sentence.
  const show = left <= 200;
  el.textContent = show ? t('fb.count').replace('%n', String(left)) : '';
  el.classList.toggle('near', left <= 50);
}

function openFeedback() {
  sfx.uiClick();
  screens.help.classList.add('hidden');
  screens.feedback.classList.remove('hidden');
  fbStatus('');
  paintFbCount();
  // Painted on open as well as at boot: on the very first open the sheet was
  // display:none when boot ran, so the canvas measured 0 wide and nothing could
  // be drawn into it.
  paintCorruptFaces();
  track(EVENTS.FEEDBACK_OPEN, { kind: fbKind, screen: game.state });
}

function closeFeedback() {
  sfx.uiClick();
  screens.feedback.classList.add('hidden');
  screens.help.classList.remove('hidden');
}

function selectKind(kind) {
  fbKind = normalizeKind(kind);
  for (const b of document.querySelectorAll('#fb-kinds [data-kind]')) {
    b.classList.toggle('on', b.dataset.kind === fbKind);
    b.setAttribute('aria-pressed', String(b.dataset.kind === fbKind));
  }
}

function sendIt() {
  if (fbSending) return;
  const message = $('fb-message').value;
  const pre = validateFeedback({ message });
  if (!pre.ok) { fbStatus(t(`fb.${pre.reason}`), true); return; }

  fbSending = true;
  const btn = $('btn-feedback-send');
  btn.disabled = true;
  btn.textContent = t('fb.sending');
  fbStatus('');

  void sendFeedback({
    kind: fbKind,
    message,
    contact: $('fb-contact').value,
    context: feedbackContext(),
  }).then((res) => {
    fbSending = false;
    btn.disabled = false;
    btn.textContent = t('fb.send');
    if (res.ok) {
      // Cleared on success only. A failed send must keep what they wrote — they
      // are about to press the button again, and a box that empties itself on a
      // network blip loses the report AND the goodwill.
      $('fb-message').value = '';
      $('fb-contact').value = '';
      paintFbCount();
      fbStatus(t('fb.sent'));
      // The length, never the text. What they wrote lives in primos_feedback,
      // which has no select policy — copying it into the event log would
      // undo that split. See the note on FEEDBACK_SEND in js/analytics.js.
      track(EVENTS.FEEDBACK_SEND, { kind: fbKind, length: sanitizeMessage(message).length });
    } else {
      fbStatus(t(`fb.${res.reason}`), true);
    }
  });
}

$('btn-feedback-open').addEventListener('click', openFeedback);
$('btn-feedback-back').addEventListener('click', closeFeedback);
$('btn-feedback-send').addEventListener('click', sendIt);
$('fb-message').addEventListener('input', () => {
  paintFbCount();
  // "Write something first." must not still be on screen while they are writing
  // something. Only the refusals clear on typing — a "Sent." from the previous
  // message is a fact, and it stays until the next send replaces it.
  if ($('fb-status').classList.contains('bad')) fbStatus('');
});
for (const b of document.querySelectorAll('#fb-kinds [data-kind]')) {
  b.addEventListener('click', () => { sfx.uiClick(); selectKind(b.dataset.kind); });
}

$('btn-again').addEventListener('click', () => { sfx.uiClick(); startRun(); });
$('btn-menu').addEventListener('click', () => {
  sfx.uiClick();
  game.state = STATE.MENU;
  game.reset();
  showScreen(STATE.MENU);
});

/**
 * One switch, both channels. Vibration rides the sound toggle rather than
 * getting a control of its own: a player who has silenced the game is asking for
 * it to shut up, and a phone buzzing in a quiet room is louder than the audio
 * they just turned off.
 */
function toggleMute() {
  const m = !sfx.isMuted();
  sfx.setMuted(m);
  setHaptics(!m);
  saved.muted = m;
  store.save(saved);
  $('btn-mute').textContent = t(m ? 'pause.soundOff' : 'pause.soundOn');
}
$('btn-mute').addEventListener('click', () => { sfx.resume(); toggleMute(); });

// Losing focus mid-run should pause, not hand you a free death.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === STATE.PLAYING) game.pause();
});

// -------------------------------------------------------------------- boot

// ------------------------------------------------------------- the NFT gate
//
// Holders only, when js/gate-config.js says so. Everything here is a no-op on
// the dormant build — gate.enabled() is false, gate.open() answers true, and
// the menu comes up exactly as it always has.
//
// ⚠ THE GATE IS A DOOR HANDLE, NOT A LOCK, and js/gate.js says so at length.
// This game is static files on a public host: anyone can run it locally with
// this screen deleted. What the Edge Function behind it makes impossible is
// FORGING THE CLAIM — nobody convinces the backend they hold a Primo when they
// do not — so the leaderboard and everything else server-side enforce it for
// real. Do not add a check here and call the game protected.

/**
 * Is this a phone, as far as the gate is concerned?
 *
 * Deliberately a capability query and not a user-agent sniff, which is a list
 * that goes stale the week it is written. What it costs when it is wrong: a
 * touch laptop with no extension is offered a link that opens the wallet's own
 * website, which is a fair place for someone with no wallet to land. What it
 * would cost the other way is worse — a phone told to "install Phantom" while
 * Phantom sits on its home screen.
 */
const looksHandheld = () => matchMedia('(pointer: coarse)').matches;

/** Wire the wallet buttons for whatever this device can actually reach. */
function paintGate() {
  const wrap = $('gate-wallets');
  const found = gate.available();
  wrap.replaceChildren();
  $('btn-gate-cancel').classList.add('hidden');

  // ⚠ AN INJECTED PROVIDER WINS OUTRIGHT. Inside a wallet's own browser BOTH
  // routes look available, and offering the handoff there is a button that opens
  // the app you are already standing in.
  if (found.length) {
    $('gate-copy').textContent = t('gate.copy');
    $('gate-none').classList.add('hidden');
    for (const w of found) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = t('gate.connect').replace('%w', w.name.toUpperCase());
      b.addEventListener('click', () => { void runGate(w); });
      wrap.append(b);
    }
    return;
  }

  // Nothing injected. On a phone that is not a missing wallet — it is a wallet
  // living in another app, which is the ORDINARY case there and not an error.
  // Saying "no Solana wallet in this browser" to someone whose home screen has
  // Phantom on it is the sentence that made the gate look broken on mobile.
  const viaLink = gate.canHandoff() && looksHandheld();
  $('gate-none').classList.toggle('hidden', viaLink);
  $('gate-copy').textContent = t(viaLink ? 'gate.mobileCopy' : 'gate.copy');
  if (viaLink) void armHandoff();
}

/**
 * Get a challenge and turn it into links the player can tap.
 *
 * ⚠ THE CHALLENGE IS FETCHED BEFORE THE TAP, NOT AFTER IT, AND THE CONTROL IS A
 * REAL ANCHOR. iOS hands an https URL to an installed app only when the
 * navigation comes from a genuine link activation; a `location.href` assigned
 * after an await has lost the user gesture, and the OS falls back to opening the
 * WEBSITE instead — which drops the player on phantom.app rather than in
 * Phantom, with the game left behind. So the round trip happens while they are
 * reading, and what they press is a link with an href already in it.
 *
 * ⚠ AND IT IS A PLAIN TOP-LEVEL LINK — no target="_blank" — which is a trade
 * made with eyes open. `_blank` would keep the game's page alive, but it can
 * land the URL in an in-app browser sheet, and in-app browsers do not hand
 * universal links to apps: the player with Phantom installed would end up
 * looking at phantom.app's WEBSITE. That is a silent failure of the path that
 * matters. A top-level navigation triggers the app reliably; the cost is that a
 * player WITHOUT the wallet installed has the game replaced by phantom.app,
 * which is a fair place for them to land and is recoverable — the handoff was
 * written to storage before they left, so reopening the game picks it straight
 * back up.
 */
async function armHandoff() {
  gateStatus(t('gate.waitingBack'));
  const res = await gate.startHandoff(cloudSession()?.access_token);
  if (!res.ok) {
    gateStatus(t('gate.chainDown'), true);
    $('btn-gate-retry').classList.remove('hidden');
    track(EVENTS.GATE_FAIL, { why: res.error || 'handoff-start', how: 'link' });
    return;
  }
  gateStatus('');
  const wrap = $('gate-wallets');
  wrap.replaceChildren();
  for (const w of gate.handoffWallets()) {
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = gate.handoffUrl(w, res.handoff);
    a.rel = 'noopener';
    a.textContent = t('gate.openIn').replace('%w', w.name.toUpperCase());
    // The tap is the only proof we get that they actually left, and polling
    // before that would be a request every couple of seconds on behalf of a
    // player who is still deciding.
    a.addEventListener('click', () => {
      gateStatus(t('gate.waiting'));
      $('btn-gate-cancel').classList.remove('hidden');
      watchHandoff();
    });
    wrap.append(a);
  }
}

// How often to ask whether the wallet has answered. Slow enough to be polite to
// a phone radio, fast enough that coming back to the app does not feel like
// waiting — and the visibility poke below means the tick almost never decides it.
const HANDOFF_POLL_MS = 2500;

let handoffTimer = 0;
let collecting = false;

function stopWatching() {
  if (handoffTimer) clearInterval(handoffTimer);
  handoffTimer = 0;
}

async function collectNow() {
  const h = gate.pendingHandoff();
  if (!h) {
    // The handoff aged out on its own clock. ⚠ NOT phrased as a refusal:
    // nobody said no, we stopped listening — the same rule that keeps
    // gate.chainDown away from gate.noPrimo.
    stopWatching();
    if (!gate.open()) {
      gateStatus(t('gate.handoffTimeout'), true);
      $('btn-gate-retry').classList.remove('hidden');
      $('btn-gate-cancel').classList.add('hidden');
      track(EVENTS.GATE_FAIL, { why: 'handoff-timeout', how: 'link' });
    }
    return;
  }
  if (document.hidden || collecting) return;   // still in the wallet, or already asking

  collecting = true;
  const res = await gate.collect(h, cloudSession()?.access_token);
  collecting = false;

  if (res.pending) return;                     // keep asking
  stopWatching();
  $('btn-gate-cancel').classList.add('hidden');
  if (res.ok && res.holder) return gateEnter(res, 'link');

  $('btn-gate-retry').classList.remove('hidden');
  if (res.ok && !res.holder) {
    gateStatus(t('gate.noPrimo'), true);
    track(EVENTS.GATE_FAIL, { why: 'no-primo', how: 'link' });
    return;
  }
  gateStatus(t('gate.failed'), true);
  track(EVENTS.GATE_FAIL, { why: res.error || 'unknown', how: 'link' });
}

function watchHandoff() {
  stopWatching();
  handoffTimer = setInterval(() => { void collectNow(); }, HANDOFF_POLL_MS);
  void collectNow();
}

const gateStatus = (msg, bad = false) => {
  const el = $('gate-status');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
};

async function runGate(w) {
  sfx.resume();
  sfx.uiClick();
  $('btn-gate-retry').classList.add('hidden');
  gateStatus(t('gate.signing'));

  const res = await gate.verify(w, cloudSession()?.access_token);

  if (res.ok && res.holder) return gateEnter(res, 'injected');

  $('btn-gate-retry').classList.remove('hidden');
  if (res.ok && !res.holder) {
    gateStatus(t('gate.noPrimo'), true);
    track(EVENTS.GATE_FAIL, { why: 'no-primo' });
    return;
  }
  // ⚠ Each of these is a DIFFERENT sentence on purpose. "You cancelled",
  // "we could not reach the chain" and "you hold none" are three unrelated
  // events, and collapsing them into one message is how a holder ends up
  // believing they were refused.
  const say = {
    cancelled: ['gate.cancelled', false],
    'chain-unreachable': ['gate.chainDown', true],
    'no-challenge': ['gate.chainDown', true],
  }[res.error] || ['gate.failed', true];
  gateStatus(t(say[0]), say[1]);
  track(EVENTS.GATE_FAIL, { why: res.error || 'unknown', how: 'injected' });
}

/**
 * The one way in, whichever road got here.
 *
 * `how` rides on the event rather than becoming an event of its own: GATE_SHOWN
 * is the denominator for this funnel, and a second one per route would quietly
 * make every rate below it wrong.
 */
function gateEnter(res, how) {
  gateStatus(t('gate.welcome').replace('%n', String(res.count || 1)));
  track(EVENTS.GATE_PASS, { count: res.count || 0, how });
  // The pass decides which Primos are wearable, so the panel behind the gate is
  // out of date the instant one lands.
  syncPrimoPanel();
  // Straight into the game the player came for. The status line above is read
  // on the way past, not waited on.
  setTimeout(() => { showScreen(STATE.MENU); }, 700);
}

/**
 * The gate, answered without a wallet.
 *
 * ⚠ THIS IS WHAT KEEPS A PHONE FROM DOING THE WHOLE DANCE EVERY DAY. A pass
 * lasts 24h, and on iOS renewing it means the app-switch trip again — forever,
 * because an installed web app's storage jar is not the one the wallet hands
 * back to. A signed-in holder never has to: the session proves who they are and
 * the Edge Function re-asks the chain on their behalf.
 *
 * Runs after bootstrapCloud() because there is no session to offer before it.
 */
async function gateSilent() {
  if (!gate.enabled() || gate.open()) return;
  // Only while they are actually standing at the door, and never over a handoff
  // already in flight — two answers racing to open the same screen.
  if (screens.gate.classList.contains('hidden') || gate.pendingHandoff()) return;
  const token = cloudSession()?.access_token;
  if (!token) return;

  gateStatus(t('gate.checking'));
  const res = await gate.refresh(token);
  if (res.ok && res.holder) return gateEnter(res, 'refresh');
  // Anything else is not an outcome worth showing: they are simply at the gate,
  // which is where they already were. `not-linked` is the common one — a Google
  // player who has never connected a wallet.
  gateStatus('');
}

/**
 * Does the gate stand in front of the menu on this launch?
 * @returns {boolean} true when the gate took the screen.
 */
function gateFirst() {
  if (!gate.enabled() || gate.open()) return false;
  paintGate();
  gateStatus('');
  showScreen(STATE.GATE);
  track(EVENTS.GATE_SHOWN, {});

  // ⚠ A HANDOFF SURVIVES THE APP BEING KILLED, and picking it back up here is
  // the difference between a verdict collected and a player sent round again.
  // A phone is perfectly happy to reclaim a backgrounded PWA while its owner is
  // approving a signature in another app, and what they come back to is a cold
  // boot — with a perfectly good answer sitting uncollected on the server.
  if (gate.pendingHandoff()) {
    gateStatus(t('gate.waiting'));
    $('btn-gate-cancel').classList.remove('hidden');
    watchHandoff();
  }
  return true;
}

// TRY AGAIN had no listener at all from the day it shipped: it was shown after
// every refusal, on the one screen a turned-away player is looking at, and did
// nothing when pressed.
$('btn-gate-retry').addEventListener('click', () => {
  $('btn-gate-retry').classList.add('hidden');
  gateStatus('');
  paintGate();
});

$('btn-gate-cancel').addEventListener('click', () => {
  stopWatching();
  gate.clearHandoff();
  gateStatus('');
  paintGate();
});

// Coming back from the wallet is the moment the answer is most likely to be
// waiting, and a tick that happens to land just before it is two and a half
// seconds of somebody staring at a screen that already knows.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && handoffTimer) void collectNow();
});

function boot() {
  resize();

  // Stash a ?ref= invite FIRST, before any other boot step can navigate the URL
  // away — the OAuth return in particular rewrites it. Local-only, never
  // overwrites an earlier invite, and safe on the dormant build: the code simply
  // waits in storage until the player signs in, which may be days later.
  captureRefFromUrl();

  // Painted body parts and props. The rig falls back to procedural drawing
  // until (or unless) the parts land, so a slow network never blocks the menu.
  loadSprites();
  loadProps();

  // Bake head sprites for the drawn crew so the in-game head is always a
  // sprite, whether it came from code or from the collection.
  for (const c of CREW) crewRigs.set(c.id, { ...headFromCharacter(c), pants: c.pants });
  // Upgrade the roster to real collection art in the background. The grace
  // timer is the backstop: loadRealCrew() ends the window itself when it
  // finishes, but a gateway that stalls holds it open for its full fence, and
  // nobody should look at placeholders for nine seconds.
  loadRealCrew();
  setTimeout(endCrewGrace, CREW_ART_GRACE);
  crewRigs.set(CUSTOM_ID, { ...headFromCharacter(CUSTOM_TEMPLATE), pants: CUSTOM_TEMPLATE.pants });

  buildCrew();

  sfx.setMuted(!!saved.muted);
  setHaptics(!saved.muted);

  const idx = roster.findIndex((c) => c.id === saved.character);
  selectCrew(idx >= 0 ? idx : 0);

  // After selectCrew, so the crew labels it just wrote are the ones that get
  // localised — and it is what fills in the mute button too.
  applyLang();

  // Restore a previously claimed Primo in the background.
  restoreClaim();

  // Before the screens wire themselves, though it delegates at the document and
  // does not actually care: every button in the game gets its press, its click
  // and its buzz from here, including ones built later.
  initUiFeedback();

  // CLEAR is hidden until there is a Primo to clear, and at boot there usually
  // is not. restoreClaim() above may turn it back on when it lands.
  syncPrimoPanel();

  initBoards();
  initAccount();

  // The suggestion box. The entry point appears only on a build that can
  // actually deliver a message — on the dormant build there is nobody on the
  // other end, and an unanswered form is worse than no form at all.
  //
  // The face is painted when the JPEG lands rather than now: loadTrainer()
  // resolves false if the art is missing, in which case the CTA keeps its two
  // lines of text and simply has no portrait. It stays tappable either way.
  if (isFeedbackConfigured()) {
    $('btn-feedback-open').classList.remove('hidden');
    void loadTrainer().then((ok) => { if (ok) paintCorruptFaces(); });
  }
  selectKind(fbKind);
  // The browser hands the chosen Primo straight to wearPrimo(), which is the
  // same path the number search uses — so the claim is written down, the crew
  // tile repaints and the cloud push happens without primo-browser.js knowing
  // that any of that exists. 'browse' is the only thing it says about itself.
  initPrimoBrowser(
    (result, url, n) => { wearPrimo(result, url, n, 'browse'); },
    t,
    () => { sfx.uiClick(); hideOverlays(true); }
  );

  // The gate goes up INSTEAD of the menu, and only when it is switched on and
  // this device has no unexpired pass. Everything above has already been
  // built, so passing it reveals a finished menu rather than starting a load.
  if (!gateFirst()) showScreen(STATE.MENU);
  // Not named `t` — that is the translator in this module now.
  requestAnimationFrame((now) => { last = now; frame(now); });

  // Cloud reconciliation runs AFTER the menu is up, not before it.
  //
  // Awaiting it here would hold first paint for up to its timeout on a slow
  // network, to fix a case the game already handles: fillGameOver() re-reads the
  // save before writing, so a sync that lands mid-run cannot be clobbered. It
  // no-ops instantly when cloud-config.js is empty, which is how this ships.
  void bootstrapCloud().then(() => {
    saved = store.load();          // adopt whatever the merge decided
    refreshStats();
    syncPrimoPanel();              // the merge can bring a Primo in with it
    const i = roster.findIndex((c) => c.id === saved.character);
    if (i >= 0 && i !== selectedIdx) selectCrew(i);
    // AFTER the auth restore, so a returning signed-in player's very first
    // events carry their user id instead of a null that later events contradict.
    // It is inside the .then() and not after it for that reason alone; the call
    // itself is instant and no-ops entirely on the dormant build.
    initAnalytics();
    // A signed-in holder gets in without touching a wallet. It can only run once
    // the session exists, which is why it is here and not in gateFirst().
    void gateSilent();
  });
}

boot();
