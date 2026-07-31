// The PICK YOUR PRIMO screen: all 3,069, scrollable, searchable by number.
//
// Before this existed the `+ MY PRIMO` tile on the menu selected an EMPTY slot,
// which fell back to the hand-drawn stand-in — so the plus promised a picker
// that was never built, and a player who tapped it ran as a cartoon and
// reasonably concluded the feature was broken.
//
// Nothing from the collection is bundled. The grid is 3,069 empty tiles; art is
// fetched from public IPFS gateways in the player's own browser, and only for
// the tiles they actually scroll past.
//
// THREE THINGS THAT MAKE THIS SURVIVE CONTACT WITH IPFS
//
//   * Gateways STALL rather than fail. A dead gateway accepts the connection
//     and holds it, so an <img> fires neither load nor error. Every tile gets
//     its own timeout and rotates to the next gateway; without that a single
//     bad gateway leaves a screen of permanently blank tiles.
//   * Requests are CAPPED. Flinging the scrollbar over three thousand tiles
//     would otherwise open three thousand connections at once, and a public
//     gateway answers that with 429s for the next few minutes.
//   * Only what is near the viewport is ever requested, and tiles that scroll
//     far away have their src dropped so the decoded images are reclaimed.

import {
  getIndex, cidFor, GATEWAYS, MAX_TOKEN, SUPPLY, loadPrimoArt, claimStatus,
} from './primo-picker.js';

const $ = (id) => document.getElementById(id);

// How far outside the viewport a tile still counts as "coming up", in pixels.
// Generous, because a gateway can take a second or two and a tile that starts
// loading only as it crosses the edge arrives grey.
const PRELOAD_PX = 500;
// Concurrent gateway fetches. Eight is comfortably under what ipfs.io tolerates
// and still fills a screen in one go.
const MAX_INFLIGHT = 8;
const TILE_TIMEOUT = 8000;

let built = false;
let onPick = null;             // (result, url, number) => void, set by main.js
let t = (k) => k;              // translator, injected so this file owns no i18n
let tiles = [];                // index === token number
let index = null;
let selected = null;           // { n, result, url } once art has been baked
let observer = null;
let inflight = 0;
const queue = [];              // token numbers waiting for a slot
const state = new Map();       // n -> 'queued' | 'loading' | 'done' | 'failed'

// ---------------------------------------------------------------- loading

/**
 * Point one tile's <img> at the first gateway that answers.
 *
 * Resolves rather than rejects on failure: a tile that cannot load is a grey
 * square with its number on it, which is a perfectly honest thing for the grid
 * to show and must never take the queue down with it.
 */
function loadTile(n) {
  const tile = tiles[n];
  const cid = index && cidFor(index, n);
  if (!tile || !cid) { state.set(n, 'failed'); return Promise.resolve(); }

  const img = tile.querySelector('img');
  return new Promise((resolve) => {
    let gw = 0;
    let timer = 0;
    const done = (ok) => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      state.set(n, ok ? 'done' : 'failed');
      if (ok) img.classList.add('in');
      resolve();
    };
    const attempt = () => {
      if (gw >= GATEWAYS.length) { done(false); return; }
      const url = GATEWAYS[gw++] + cid;
      clearTimeout(timer);
      // The stall guard. Not a nicety — see the header.
      timer = setTimeout(() => { img.src = ''; attempt(); }, TILE_TIMEOUT);
      img.onload = () => done(true);
      img.onerror = () => attempt();
      img.src = url;
    };
    attempt();
  });
}

function pump() {
  while (inflight < MAX_INFLIGHT && queue.length) {
    const n = queue.shift();
    // It may have scrolled away, or another pass may have already taken it.
    if (state.get(n) !== 'queued') continue;
    state.set(n, 'loading');
    inflight++;
    loadTile(n).finally(() => { inflight--; pump(); });
  }
}

function want(n) {
  const s = state.get(n);
  if (s === 'loading' || s === 'done') return;
  // A previous failure is worth one more try when the tile comes back around —
  // most failures here are a gateway having a bad minute, not a missing CID.
  state.set(n, 'queued');
  queue.push(n);
  pump();
}

/** Drop a tile's decoded image. Three thousand of them will not fit in memory. */
function release(n) {
  const s = state.get(n);
  if (s === 'loading') return;              // let it finish; it is nearly free
  const tile = tiles[n];
  if (!tile) return;
  const img = tile.querySelector('img');
  if (!img.src) return;
  img.classList.remove('in');
  img.removeAttribute('src');
  state.delete(n);
}

// ------------------------------------------------------------------- grid

function build() {
  const grid = $('browse-grid');
  grid.replaceChildren();
  tiles = new Array(SUPPLY);

  // One fragment, one reflow. Appending 3,069 nodes one at a time is about a
  // second of layout on a phone.
  const frag = document.createDocumentFragment();
  for (let n = 0; n < SUPPLY; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'primo-tile';
    b.dataset.n = String(n);
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    b.append(img);
    const tag = document.createElement('b');
    tag.textContent = String(n);
    b.append(tag);
    tiles[n] = b;
    frag.append(b);
  }
  grid.append(frag);

  // One observer for the lot. Per-tile scroll maths would be 3,069 rect reads
  // per frame; the observer does it off the main thread.
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const n = Number(e.target.dataset.n);
      if (e.isIntersecting) want(n);
      else release(n);
    }
  }, { root: grid, rootMargin: `${PRELOAD_PX}px 0px` });
  for (const tile of tiles) observer.observe(tile);

  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.primo-tile');
    if (tile) pick(Number(tile.dataset.n));
  });

  built = true;
}

// ---------------------------------------------------------------- picking

let pickGen = 0;

/**
 * Choose a Primo: bake its head, ask whether it is free, and offer the button
 * that actually applies it. Selecting and CLAIMING stay two taps, the same way
 * the number search already worked — a mis-tap on a 62px tile should cost you a
 * look, not your Primo.
 */
async function pick(n) {
  const gen = ++pickGen;
  for (const tile of tiles) tile.classList.remove('on');
  tiles[n]?.classList.add('on');

  selected = null;
  $('browse-pick').classList.remove('hidden');
  $('browse-num-label').textContent = `PRIMO #${n}`;
  $('browse-state').textContent = t('status.searching').replace('%n', String(n));
  const use = $('btn-browse-use');
  use.disabled = true;

  const preview = $('browse-preview');
  preview.getContext('2d').clearRect(0, 0, preview.width, preview.height);

  const cid = index && cidFor(index, n);
  if (!cid) {
    if (gen === pickGen) $('browse-state').textContent = t('status.outOfRange');
    return;
  }

  const result = await loadPrimoArt(cid);
  if (gen !== pickGen) return;               // they tapped another one meanwhile
  if (!result) {
    $('browse-state').textContent = t('status.gatewayOut').replace('%n', String(n));
    return;
  }

  const px = preview.getContext('2d');
  px.clearRect(0, 0, preview.width, preview.height);
  px.drawImage(result.img, 0, 0, preview.width, preview.height);

  const claim = await claimStatus(n);
  if (gen !== pickGen) return;
  if (claim.state === 'assigned') {
    $('browse-state').textContent = claim.holder
      ? t('claim.assignedTo').replace('%h', claim.holder)
      : t('claim.assigned');
    return;
  }
  if (claim.state === 'blocked') {
    $('browse-state').textContent = t('claim.blocked');
    return;
  }

  selected = { n, result, url: result.url };
  $('browse-state').textContent = t('claim.free');
  use.disabled = false;
}

// -------------------------------------------------------------------- api

/**
 * @param {(result: object, url: string, n: number) => void} pickHandler
 *        applies the chosen Primo — main.js hands over its own wearPrimo().
 * @param {(key: string) => string} translate
 * @param {() => void} close
 */
export function initPrimoBrowser(pickHandler, translate, close) {
  onPick = pickHandler;
  t = translate;

  $('btn-browse-back').addEventListener('click', close);

  $('btn-browse-use').addEventListener('click', () => {
    if (!selected) return;
    onPick?.(selected.result, selected.url, selected.n);
    close();
  });

  const jump = () => {
    const raw = $('browse-num').value.trim();
    if (raw === '') return;
    const n = Number(raw);
    // 0 is a real Primo — `!n` would reject it, and #0 exists.
    if (!Number.isInteger(n) || n < 0 || n > MAX_TOKEN) {
      $('browse-status').textContent = t('status.outOfRange');
      return;
    }
    $('browse-status').textContent = '';
    tiles[n]?.scrollIntoView({ block: 'center' });
    pick(n);
  };
  $('btn-browse-jump').addEventListener('click', jump);
  $('browse-num').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); jump(); }
  });
}

/** Called every time the screen is shown. Builds the grid once, lazily. */
export async function openPrimoBrowser(currentNumber) {
  $('browse-status').textContent = '';
  index = await getIndex();
  if (!index || !index.count) {
    $('browse-status').textContent = t('browse.noIndex');
    return;
  }
  if (!built) build();

  // Reset the pick card unless they are coming back to the one they are wearing.
  selected = null;
  $('btn-browse-use').disabled = true;
  $('browse-pick').classList.add('hidden');
  for (const tile of tiles) tile.classList.remove('on');

  if (Number.isInteger(currentNumber) && currentNumber >= 0 && currentNumber <= MAX_TOKEN) {
    tiles[currentNumber]?.classList.add('on');
    // `instant`, not smooth: the grid was just un-hidden, and animating a jump
    // of up to three thousand rows means the tiles the observer is asked about
    // are the ones flying past rather than the ones being landed on.
    tiles[currentNumber]?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}

/** Stop the queue when the screen closes — those fetches are no longer wanted. */
export function releasePrimoBrowser() {
  queue.length = 0;
  for (const [n, s] of state) if (s === 'queued') state.delete(n);
  pickGen++;
}
