// Bootstrap: canvas, loop, menus, persistence.

import { Game, STATE } from './game.js';
import { renderScene } from './render.js';
import { resizeCamera } from './camera.js';
import { drawHUD, pauseRect, pushToast, clearToasts } from './hud.js';
import { attachInput } from './input.js';
import { CREW, CUSTOM_TEMPLATE, CUSTOM_ID, drawPrimoPortrait } from './art/runner.js';
import { headFromCharacter, loadHead } from './art/primo-head.js';
import { loadSprites, loadProps } from './art/sprites.js';
import * as store from './store.js';
import * as sfx from './audio.js';
import { t, tRaw, initLang, setLang, getLang, onLangChange } from './i18n.js';
import {
  tutorialNeeded, startTutorial, updateTutorial, drawTutorial,
  tutorialActive, tutorialInput, tutorialTap, finishTutorial,
} from './tutorial.js';

// Public gateways, tried in order. The first that answers wins.
const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
];

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false });

const $ = (id) => document.getElementById(id);
const screens = {
  menu: $('screen-menu'),
  pause: $('screen-pause'),
  over: $('screen-over'),
};

let saved = store.load();
// Before anything paints. A save with no `lang` has never been asked, so the
// device decides; after that the saved choice wins forever.
initLang(saved.lang);

let customImg = null;      // source image for the HUD badge + menu tile
let customRig = null;      // baked head sprite + sampled outfit palette
let safe = { top: 0, bottom: 0 };
let primoIndex = null;     // { images: { "1921": "Qm…" } }

const roster = [...CREW, CUSTOM_TEMPLATE];
// Head sprites for the crew. Seeded at boot with the code-drawn approximations
// so the menu is never empty, then REPLACED with real collection art as it
// arrives from IPFS — see loadRealCrew().
const crewRigs = new Map();
const crewImgs = new Map();   // id -> the real PFP Image, once loaded
const crewNums = new Map();   // id -> token number, once loaded

// The four the crew slots become. Fixed rather than random so a player's roster
// is the same every launch, and so the picker doesn't reshuffle under them.
const CREW_TOKENS = [4, 34, 56, 96];

const game = new Game({
  // game.js is read-only from the language work, so its handful of literals get
  // translated on the way to the screen rather than at the source.
  onToast: (text, color) => pushToast(tRaw(text), color),
  onStateChange: (s) => showScreen(s),
});

// ------------------------------------------------------------------ canvas

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  resizeCamera(w, h);
  safe = readSafeInsets();
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

function step(dt) {
  if (game.state !== STATE.PAUSED) game.update(dt);
  renderScene(ctx, game);

  const W = window.innerWidth;
  const H = window.innerHeight;

  // The course runs with the game parked in MENU, so the alley keeps scrolling
  // behind the cards instead of the lesson playing over a frozen frame.
  if (tutorialActive()) {
    if (updateTutorial(dt, game)) {
      drawTutorial(ctx, W, H, Math.min(W, H) / 420, safe.top, safe.bottom);
    } else {
      finishTutorial();
      game.start();
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

function showScreen(state) {
  for (const el of Object.values(screens)) el.classList.add('hidden');
  if (state === STATE.MENU) {
    screens.menu.classList.remove('hidden');
    refreshStats();
  } else if (state === STATE.PAUSED) {
    screens.pause.classList.remove('hidden');
  } else if (state === STATE.OVER) {
    fillGameOver();
    screens.over.classList.remove('hidden');
  }
}

function refreshStats() {
  $('stat-best').textContent = saved.best.toLocaleString();
  $('stat-beers').textContent = saved.totalBeers.toLocaleString();
  $('stat-runs').textContent = saved.runs.toLocaleString();
}

function fillGameOver() {
  const isPB = game.score > saved.best;
  saved.best = Math.max(saved.best, game.score);
  saved.bestBeers = Math.max(saved.bestBeers, game.beers);
  saved.runs += 1;
  saved.totalBeers += game.beers;
  store.save(saved);

  $('over-reason').textContent = tRaw(game.gameOverReason);
  $('over-score').textContent = Math.floor(game.score).toLocaleString();
  $('over-beers').textContent = game.beers;
  $('over-tacos').textContent = game.tacos;
  $('over-dist').textContent = Math.floor(game.distance);
  $('over-pb').classList.toggle('hidden', !isPB);
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
  // A run that ended in the other language must not keep its old headline.
  if (game.gameOverReason) $('over-reason').textContent = tRaw(game.gameOverReason);
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

  $('crew-name').textContent = num ? t('crew.primoNum') + num : c.name;
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
  const num = custom ? saved.primoNumber : crewNums.get(c.id);
  labelCrew();

  const rig = custom ? customRig : crewRigs.get(c.id);
  const art = custom ? customImg : crewImgs.get(c.id);
  game.setCharacter(c, rig, art || null);
  // The intro titles the run, and it must agree with the picker — a slot
  // showing real art is that Primo, not the stand-in whose name it inherited.
  game.displayName = num ? t('crew.primoNum') + num : c.name;
  saved.character = c.id;
  store.save(saved);
  paintCrew();
}

// ------------------------------------------------------------ real primos

async function getIndex() {
  if (primoIndex) return primoIndex;
  try {
    const res = await fetch('data/primos-index.json');
    primoIndex = await res.json();
  } catch {
    primoIndex = { images: {} };
  }
  return primoIndex;
}

const status = (msg) => { $('primo-status').textContent = msg; };

/**
 * Swap the code-drawn crew for real collection art.
 *
 * The four built-in characters were hand-coded cartoons standing in for Primos,
 * and next to the actual art they read as exactly that. The whole pipeline for
 * using the real thing already existed for the "MI PRIMO" slot — this just
 * points the default roster at it too.
 *
 * Deliberately non-blocking and best-effort: the drawn heads are already in
 * place, so a slow gateway, a rate-limit or being offline costs nothing but the
 * upgrade. Nothing here is stored in the repo — the index holds CIDs, and the
 * pixels live in the player's browser.
 */
async function loadRealCrew() {
  const idx = await getIndex();
  const nums = Object.keys(idx.images);
  if (!nums.length) return;

  await Promise.all(CREW.map(async (c, i) => {
    // Fall back to any indexed token if a chosen one is missing.
    const want = String(CREW_TOKENS[i]);
    const num = idx.images[want] ? want : nums[(i * 97) % nums.length];
    const cid = idx.images[num];
    if (!cid) return;

    for (const gw of GATEWAYS) {
      const result = await loadHead(gw + cid);
      if (!result) continue;
      // Keep the character's own trousers; everything above comes from the art.
      crewRigs.set(c.id, { ...result.head, pants: c.pants });
      crewImgs.set(c.id, result.img);
      crewNums.set(c.id, num);
      paintCrew();
      // If this one is already on screen, re-select so the rig and the badge
      // pick up the real art immediately rather than on the next tap.
      if (roster[selectedIdx].id === c.id) selectCrew(selectedIdx);
      return;
    }
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
  const result = await loadHead(src);
  if (!result) {
    status(t('status.badImage'));
    return false;
  }
  customRig = { ...result.head, pants: '#2f3a52' };
  customImg = result.img;
  saved.customImage = src;
  saved.primoNumber = number || null;
  store.save(saved);
  status(t('status.ready').replace('%s', label));
  selectCrew(roster.length - 1);
  return true;
}

/** Try each gateway in turn — public ones rate-limit and go down. */
async function usePrimoByNumber(n) {
  const idx = await getIndex();
  const cid = idx.images[String(n)];
  if (!cid) {
    const have = Object.keys(idx.images).length;
    status(t('status.notIndexed').replace('%n', n).replace('%h', have));
    return;
  }
  for (const gw of GATEWAYS) {
    if (await usePrimo(gw + cid, t('label.primoNum') + n, n)) return;
  }
}

$('btn-num').addEventListener('click', () => {
  const n = parseInt($('primo-num').value, 10);
  if (!Number.isFinite(n)) return;
  sfx.uiClick();
  usePrimoByNumber(n);
});

$('primo-num').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-num').click();
});

$('btn-random').addEventListener('click', async () => {
  sfx.uiClick();
  const idx = await getIndex();
  const keys = Object.keys(idx.images);
  if (!keys.length) { status(t('status.noIndex')); return; }
  const n = keys[Math.floor(Math.random() * keys.length)];
  $('primo-num').value = n;
  usePrimoByNumber(Number(n));
});

$('primo-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => usePrimo(String(reader.result), file.name, null);
  reader.onerror = () => status(t('status.badFile'));
  reader.readAsDataURL(file);
});

$('btn-url').addEventListener('click', () => {
  const url = $('primo-url').value.trim();
  if (!url) return;
  sfx.uiClick();
  usePrimo(url, t('label.yourPrimo'), null);
});

$('btn-clear-primo').addEventListener('click', () => {
  customImg = null;
  customRig = null;
  saved.customImage = null;
  saved.primoNumber = null;
  store.save(saved);
  status(t('status.cleared'));
  if (roster[selectedIdx].id === CUSTOM_ID) selectCrew(0);
  else paintCrew();
});

// ----------------------------------------------------------------- buttons

$('btn-play').addEventListener('click', () => {
  sfx.resume();
  sfx.uiClick();
  clearToasts();
  // First run: teach before the first round. The game stays in MENU so the
  // alley scrolls behind the course; step() calls game.start() when it ends.
  if (tutorialNeeded()) {
    for (const el of Object.values(screens)) el.classList.add('hidden');
    startTutorial();
    return;
  }
  game.start();
});

$('btn-resume').addEventListener('click', () => { sfx.uiClick(); game.resume(); });
$('btn-quit').addEventListener('click', () => {
  sfx.uiClick();
  sfx.stopMusic();
  game.state = STATE.MENU;
  game.reset();
  showScreen(STATE.MENU);
});
$('btn-again').addEventListener('click', () => { sfx.uiClick(); clearToasts(); game.start(); });
$('btn-menu').addEventListener('click', () => {
  sfx.uiClick();
  game.state = STATE.MENU;
  game.reset();
  showScreen(STATE.MENU);
});

function toggleMute() {
  const m = !sfx.isMuted();
  sfx.setMuted(m);
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

  const idx = roster.findIndex((c) => c.id === saved.character);
  selectCrew(idx >= 0 ? idx : 0);

  // After selectCrew, so the crew labels it just wrote are the ones that get
  // localised — and it is what fills in the mute button too.
  applyLang();

  // Restore a previously chosen Primo in the background.
  if (saved.customImage) {
    loadHead(saved.customImage).then((result) => {
      if (!result) return;
      customRig = { ...result.head, pants: '#2f3a52' };
      customImg = result.img;
      paintCrew();
      if (roster[selectedIdx].id === CUSTOM_ID) selectCrew(selectedIdx);
    });
  }

  showScreen(STATE.MENU);
  requestAnimationFrame((t) => { last = t; frame(t); });
}

boot();
