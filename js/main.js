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
let customImg = null;      // source image for the HUD badge + menu tile
let customRig = null;      // baked head sprite + sampled outfit palette
let safe = { top: 0, bottom: 0 };
let primoIndex = null;     // { images: { "1921": "Qm…" } }

const roster = [...CREW, CUSTOM_TEMPLATE];
// Head sprites for the code-drawn crew, baked once at boot.
const crewRigs = new Map();

const game = new Game({
  onToast: (text, color) => pushToast(text, color),
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
  if (game.state === STATE.PLAYING || game.state === STATE.PAUSED) {
    drawHUD(ctx, game, window.innerWidth, window.innerHeight, dt, safe.top, safe.bottom);
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
  if (game.state !== STATE.PLAYING) { suppressTap = false; return; }
  const r = pauseRect;
  const inPause = e.clientX >= r.x - 6 && e.clientX <= r.x + r.w + 6 &&
                  e.clientY >= r.y - 6 && e.clientY <= r.y + r.h + 6;
  suppressTap = inPause;
  if (inPause) game.pause();
});

attachInput(canvas, {
  lane: (d) => game.moveLane(d),
  jump: () => {
    if (suppressTap) { suppressTap = false; return; }
    game.jump();
  },
  slide: () => game.slide(),
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

  $('over-reason').textContent = game.gameOverReason;
  $('over-score').textContent = Math.floor(game.score).toLocaleString();
  $('over-beers').textContent = game.beers;
  $('over-tacos').textContent = game.tacos;
  $('over-dist').textContent = Math.floor(game.distance);
  $('over-pb').classList.toggle('hidden', !isPB);
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
      c2.fillText('MI', 66, 62);
      c2.fillText('PRIMO', 66, 80);
      c2.font = '700 30px system-ui, sans-serif';
      c2.fillText('+', 66, 40);
    } else {
      drawPrimoPortrait(c2, 66, 84, 112, c, { img: isCustom ? customImg : null });
    }
    cv.classList.toggle('on', i === selectedIdx);
  });
}

function selectCrew(i) {
  selectedIdx = i;
  const c = roster[i];
  const custom = c.id === CUSTOM_ID;
  $('crew-name').textContent = custom && saved.primoNumber
    ? `PRIMO #${saved.primoNumber}` : c.name;
  $('crew-tag').textContent = custom && !customRig
    ? 'Load one from the collection below'
    : custom ? 'Straight from the barrio' : c.tagline;

  const rig = custom ? customRig : crewRigs.get(c.id);
  game.setCharacter(c, rig, custom ? customImg : null);
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
 * Bake a head sprite from an image source and switch to the custom slot.
 * @param {string} src   image URL or data URL
 * @param {string} label shown in the status line
 * @param {number|null} number Primo number, when we know it
 */
async function usePrimo(src, label, number) {
  status(`Loading ${label}…`);
  const result = await loadHead(src);
  if (!result) {
    status("Couldn't load that image. Use a direct .png/.jpg link, or pick a file.");
    return false;
  }
  customRig = { ...result.head, pants: '#2f3a52' };
  customImg = result.img;
  saved.customImage = src;
  saved.primoNumber = number || null;
  store.save(saved);
  status(`${label} is ready to run.`);
  selectCrew(roster.length - 1);
  return true;
}

/** Try each gateway in turn — public ones rate-limit and go down. */
async function usePrimoByNumber(n) {
  const idx = await getIndex();
  const cid = idx.images[String(n)];
  if (!cid) {
    const have = Object.keys(idx.images).length;
    status(`Primo #${n} isn't in the offline index (${have} of 3,069 are). ` +
           'Paste its image URL below and it will work.');
    return;
  }
  for (const gw of GATEWAYS) {
    if (await usePrimo(gw + cid, `Primo #${n}`, n)) return;
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
  if (!keys.length) { status('Index unavailable.'); return; }
  const n = keys[Math.floor(Math.random() * keys.length)];
  $('primo-num').value = n;
  usePrimoByNumber(Number(n));
});

$('primo-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => usePrimo(String(reader.result), file.name, null);
  reader.onerror = () => status("Couldn't read that file.");
  reader.readAsDataURL(file);
});

$('btn-url').addEventListener('click', () => {
  const url = $('primo-url').value.trim();
  if (!url) return;
  sfx.uiClick();
  usePrimo(url, 'Your Primo', null);
});

$('btn-clear-primo').addEventListener('click', () => {
  customImg = null;
  customRig = null;
  saved.customImage = null;
  saved.primoNumber = null;
  store.save(saved);
  status('Custom Primo cleared.');
  if (roster[selectedIdx].id === CUSTOM_ID) selectCrew(0);
  else paintCrew();
});

// ----------------------------------------------------------------- buttons

$('btn-play').addEventListener('click', () => {
  sfx.resume();
  sfx.uiClick();
  clearToasts();
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
  $('btn-mute').textContent = `SOUND: ${m ? 'OFF' : 'ON'}`;
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
  crewRigs.set(CUSTOM_ID, { ...headFromCharacter(CUSTOM_TEMPLATE), pants: CUSTOM_TEMPLATE.pants });

  buildCrew();

  sfx.setMuted(!!saved.muted);
  $('btn-mute').textContent = `SOUND: ${saved.muted ? 'OFF' : 'ON'}`;

  const idx = roster.findIndex((c) => c.id === saved.character);
  selectCrew(idx >= 0 ? idx : 0);

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
