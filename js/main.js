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
  claimStatus, MAX_TOKEN, extraString,
} from './primo-picker.js';
import {
  tutorialNeeded, startTutorial, updateTutorial, drawTutorial,
  tutorialActive, tutorialInput, tutorialTap, finishTutorial,
} from './tutorial.js';
import * as wallet from './wallet.js';
import {
  openShop, offerContinue, closeContinue, continueCost, loadoutFor, paintWallet,
} from './tiendita.js';
import { bootstrapCloud } from './cloud.js';
import { captureRefFromUrl } from './referrals.js';
import { pruneDays, recordDay } from './raceday.js';
import { initBoards, refreshBoards, relangBoards, showRunStanding } from './boards.js';
import { initAccount, refreshAccount, relangAccount, releaseAccount } from './account.js';

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
  pause: $('screen-pause'),
  over: $('screen-over'),
  // Owned by js/tiendita.js, listed here so a state change can never leave one
  // of them up over the alley — continuing a run has to clear the offer.
  continue: $('screen-continue'),
  shop: $('screen-shop'),
  // Same reason: help is opened OVER pause or game over, so a state change
  // arriving while it is up has to take it down with everything else.
  help: $('screen-help'),
};

let saved = store.load();
// Before anything paints. A save with no `lang` has never been asked, so the
// device decides; after that the saved choice wins forever.
initLang(saved.lang);

let customImg = null;      // source image for the HUD badge + menu tile
let customRig = null;      // baked head sprite + sampled outfit palette
let safe = { top: 0, bottom: 0 };

const roster = [...CREW, CUSTOM_TEMPLATE];
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
};

function showOverlay(name) {
  screens.menu.classList.add('hidden');
  overlays[name].classList.remove('hidden');
}

/** Dismiss both overlays. `backToMenu` restores the menu behind them. */
function hideOverlays(backToMenu) {
  for (const el of Object.values(overlays)) el.classList.add('hidden');
  releaseAccount();
  if (backToMenu) screens.menu.classList.remove('hidden');
}

function showScreen(state) {
  for (const el of Object.values(screens)) el.classList.add('hidden');
  // A state change has to dismiss the overlays or they would linger over the run
  // that just started. `false`, because the branches below decide what shows.
  hideOverlays(false);
  if (state === STATE.MENU) {
    screens.menu.classList.remove('hidden');
    refreshStats();
  } else if (state === STATE.PAUSED) {
    screens.pause.classList.remove('hidden');
  } else if (state === STATE.OVER) {
    // Corrupt gets to make his offer BEFORE the run is written down. That
    // ordering is the whole trick: a run you paid to continue is one run, not
    // two, and its chelas are banked once — see declineContinue().
    offerContinue(game, { onTake: takeContinue, onDecline: declineContinue });
  }
}

function refreshStats() {
  $('stat-best').textContent = saved.best.toLocaleString();
  $('stat-beers').textContent = saved.totalBeers.toLocaleString();
  $('stat-runs').textContent = saved.runs.toLocaleString();
  paintWallet();
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
  closeContinue();
  clearToasts();
  sfx.resume();
  // Same run: score, distance and combo all stand. continueRun() puts the
  // screen back to PLAYING through onStateChange.
  game.continueRun();
}

function declineContinue() {
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
  wallet.deposit(game.beers);
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
      // Real collection art once it has landed; the drawn stand-in until then.
      const art = isCustom ? customImg : crewImgs.get(c.id);
      drawPrimoPortrait(c2, 66, 84, 112, c, { img: art || null });
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
async function loadRealCrew() {
  const idx = await getIndex();
  const tokens = drawTokens(idx, CREW.length);
  if (!tokens.length) return;

  await Promise.all(CREW.map(async (c, i) => {
    const num = tokens[i];
    const cid = cidFor(idx, num);
    if (!cid) return;
    const result = await loadPrimoArt(cid);
    if (!result) return;
    // Keep the character's own trousers; everything above comes from the art.
    crewRigs.set(c.id, { ...result.head, pants: c.pants });
    crewImgs.set(c.id, result.img);
    crewNums.set(c.id, String(num));
    paintCrew();
    // If this one is already on screen, re-select so the rig and the badge
    // pick up the real art immediately rather than on the next tap.
    if (roster[selectedIdx].id === c.id) selectCrew(selectedIdx);
  }));
}

/**
 * Bake a head sprite from an image source and switch to the custom slot.
 * @param {string} src   image URL or data URL
 * @param {string} label shown in the status line
 * @param {number|null} number Primo number, when we know it
 */
async function usePrimo(src, label, number) {
  status(t('status.loading').replace('%s', label));
  const result = await loadPrimoUrl(src);
  if (!result) {
    status(t('status.badImage'));
    return false;
  }
  wearPrimo(result, src, number);
  status(t('status.ready').replace('%s', label));
  return true;
}

/**
 * Put a loaded Primo on the runner and write the claim down.
 *
 * `customImage` + `primoNumber` are the whole persistence story and the seam
 * the cloud save hooks onto: the token number and the exact source URL it came
 * from, under the keys store.js already defines. Nothing else needs to travel.
 */
function wearPrimo(result, src, number) {
  customRig = { ...result.head, pants: '#2f3a52' };
  customImg = result.img;
  saved.customImage = src;
  saved.primoNumber = Number.isFinite(number) ? number : null;
  store.save(saved);
  selectCrew(roster.length - 1);
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
  if (!indexReady()) { status(t('status.noIndex')); return; }
  const [n] = drawTokens(idx, 1);
  if (n === undefined) { status(t('status.noIndex')); return; }
  $('primo-num').value = n;
  findPrimo(Number(n));
});

$('primo-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  hideFound();
  const reader = new FileReader();
  reader.onload = () => usePrimo(String(reader.result), file.name, null);
  reader.onerror = () => status(t('status.badFile'));
  reader.readAsDataURL(file);
});

$('btn-url').addEventListener('click', () => {
  const url = $('primo-url').value.trim();
  if (!url) return;
  sfx.uiClick();
  hideFound();
  usePrimo(url, t('label.yourPrimo'), null);
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
});

/**
 * Put the player's claimed Primo back on at launch.
 *
 * A claim is a token number first and a URL second. The saved URL names one
 * gateway and that gateway will eventually have a bad day, so a claim with a
 * number behind it is re-fetched through the whole gateway walk and only falls
 * back to the stored URL — which for an uploaded file is a data URL, and is
 * then the only thing there is.
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
      status(t('status.reassigned').replace('%n', n));
      return;
    }
    const idx = await getIndex();
    const cid = cidFor(idx, saved.primoNumber);
    if (cid) result = await loadPrimoArt(cid);
  }
  if (!result && saved.customImage) result = await loadPrimoUrl(saved.customImage);
  if (!result) return;

  customRig = { ...result.head, pants: '#2f3a52' };
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
  game.start(loadoutFor(wallet.takeStock()));
}

$('btn-play').addEventListener('click', () => {
  sfx.resume();
  sfx.uiClick();
  clearToasts();
  // First run: teach before the first round. The game stays in MENU so the
  // alley scrolls behind the course; step() calls startRun() when it ends.
  if (tutorialNeeded()) {
    for (const el of Object.values(screens)) el.classList.add('hidden');
    startTutorial();
    return;
  }
  startRun();
});

$('btn-shop').addEventListener('click', () => {
  sfx.resume();
  sfx.uiClick();
  openShop(() => showScreen(STATE.MENU));
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
});

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
// The controls have always been on the menu, inside a collapsed `how` list —
// which is behind the menu, which is exactly where a player who is mid-run or
// freshly busted cannot get to. So the same material is reachable from both
// places they actually are when the question comes up.
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
}

function closeHelp() {
  sfx.uiClick();
  screens.help.classList.add('hidden');
  (helpBack || screens.menu).classList.remove('hidden');
  helpBack = null;
}

$('btn-help-pause').addEventListener('click', () => openHelp(screens.pause));
$('btn-help-over').addEventListener('click', () => openHelp(screens.over));
$('btn-help-back').addEventListener('click', closeHelp);

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
  // Upgrade the roster to real collection art in the background.
  loadRealCrew();
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

  initBoards();
  initAccount();

  showScreen(STATE.MENU);
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
    const i = roster.findIndex((c) => c.id === saved.character);
    if (i >= 0 && i !== selectedIdx) selectCrew(i);
  });
}

boot();
