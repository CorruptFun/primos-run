// The PICK YOUR PRIMO screen: all 3,069, a page at a time, searchable by number.
//
// Before this existed the `+ MY PRIMO` tile on the menu selected an EMPTY slot,
// which fell back to the hand-drawn stand-in — so the plus promised a picker
// that was never built, and a player who tapped it ran as a cartoon and
// reasonably concluded the feature was broken.
//
// Nothing from the collection is bundled. Art is fetched from public IPFS
// gateways in the player's own browser, and only for the tiles on the page they
// are actually looking at.
//
// ⚠ WHY A PAGER AND NOT ONE LONG SCROLL, which is what this used to be.
//
// The first version built all 3,069 tiles up front and virtualised the loading
// with an IntersectionObserver. It measured at 3,069 DOM nodes, a 61,000px
// scroll height and just over a SECOND of layout before the sheet could be
// shown — on a desktop. On the phone it shipped to, the tiles collapsed on top
// of each other into unreadable stripes, because `aspect-ratio` on a <button>
// is not honoured in Safari's form-control layout and nothing else was giving
// the row a height. Both problems are the same problem: three thousand nodes is
// not a grid, it is a stress test.
//
// 24 at a time is a screenful, builds in under a millisecond, and makes the
// row height something the stylesheet can simply state.
//
// TWO THINGS THAT MAKE THIS SURVIVE CONTACT WITH IPFS
//
//   * Gateways STALL rather than fail. A dead gateway accepts the connection
//     and holds it, so a request that is never fenced hangs for the session.
//     js/primo-cache.js puts an AbortController on every fetch and the chain
//     rotates to the next gateway.
//   * Requests are CAPPED. Paging quickly through the collection would
//     otherwise open connections faster than any public gateway tolerates.
//
// And the third thing, which is new: every image the player has already seen is
// served from js/primo-cache.js without touching the network at all.

import {
  getIndex, cidFor, GATEWAYS, MAX_TOKEN, SUPPLY, loadPrimoArt, claimStatus,
} from './primo-picker.js';
import { fetchArt, release } from './primo-cache.js';
import { enabled as gateOn, owns as gateOwns, ownedTokens } from './gate.js';

const $ = (id) => document.getElementById(id);

// A screenful, and measured rather than picked: at 4 columns — what a 390px
// phone gives — 20 tiles is 5 rows of 68px plus gaps, which is 372px and fits
// inside the grid's 380px cap with nothing clipped. 24 was the first try and
// spilled a sixth row under the fold, so the page you were told you were on was
// not the page you could see. It also divides evenly by 4 and 5, the two column
// counts this grid actually produces on a phone.
export const PAGE_SIZE = 20;
export const PAGE_COUNT = Math.ceil(SUPPLY / PAGE_SIZE);

// Concurrent gateway fetches. Eight is comfortably under what ipfs.io tolerates
// and fills a page of 24 in three waves.
const MAX_INFLIGHT = 8;

let built = false;
let onPick = null;             // (result, url, number) => void, set by main.js
let t = (k) => k;              // translator, injected so this file owns no i18n
let index = null;
let selected = null;           // { n, result, url } once art has been baked
let page = 0;

// The 24 <button>s, rebuilt-in-place per page. Reused rather than recreated so
// paging does not churn the DOM.
let tiles = [];
// Object URLs currently held by this page's <img>s. Blob URLs leak until
// revoked, and a player flicking through the collection would otherwise pin
// every image they passed in memory for the life of the tab.
const held = new Map();        // slot -> object URL

// Bumped on every page change and on close. Every async art load checks it
// before touching the DOM, so a slow gateway answering after the player has
// moved on cannot paint a stale face into a tile that now means another token.
let renderGen = 0;
let inflight = 0;

// ---------------------------------------------------------------- loading

function releaseSlot(slot) {
  const url = held.get(slot);
  if (url) { release(url); held.delete(slot); }
  const img = tiles[slot]?.querySelector('img');
  if (img) { img.classList.remove('in'); img.removeAttribute('src'); }
}

/**
 * Fill one tile. Resolves rather than rejects on failure: a tile that cannot
 * load is a numbered grey square, which is a perfectly honest thing for the
 * grid to show and must never take the page down with it.
 */
async function loadSlot(slot, n, gen) {
  const cid = index && cidFor(index, n);
  if (!cid) return;
  const url = await fetchArt(cid, GATEWAYS);
  if (!url) return;
  // The page moved while this was in the air. Revoke immediately — the tile it
  // was for is showing a different token now.
  if (gen !== renderGen) { release(url); return; }
  const img = tiles[slot]?.querySelector('img');
  if (!img) { release(url); return; }
  releaseSlot(slot);
  held.set(slot, url);
  img.src = url;
  img.classList.add('in');
}

/** Load the page's 24 tiles, at most MAX_INFLIGHT at a time. */
async function loadPage(gen) {
  const first = page * PAGE_SIZE;
  const jobs = [];
  for (let slot = 0; slot < PAGE_SIZE; slot++) {
    const n = first + slot;
    if (n > MAX_TOKEN) break;
    jobs.push([slot, n]);
  }
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && gen === renderGen) {
      const [slot, n] = jobs[next++];
      inflight++;
      try { await loadSlot(slot, n, gen); } finally { inflight--; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_INFLIGHT, jobs.length) }, worker));
}

// ------------------------------------------------------------------- grid

/** Build the 24 reusable tiles. Runs once. */
function build() {
  const grid = $('browse-grid');
  grid.replaceChildren();
  tiles = [];

  const frag = document.createDocumentFragment();
  for (let slot = 0; slot < PAGE_SIZE; slot++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'primo-tile';
    b.dataset.slot = String(slot);
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    b.append(img);
    const tag = document.createElement('b');
    b.append(tag);
    tiles.push(b);
    frag.append(b);
  }
  grid.append(frag);

  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.primo-tile');
    if (!tile || tile.hidden) return;
    const n = Number(tile.dataset.n);
    if (!Number.isInteger(n)) return;
    // ⚠ Refused HERE as well as in pick(), because a locked tile must not even
    // start a gateway fetch — otherwise browsing the collection you do not own
    // costs the same bandwidth as browsing the one you do, for art the game is
    // about to refuse to let you wear.
    if (gateOn() && !gateOwns(n)) {
      $('browse-status').textContent = t('browse.notYours').replace('%n', String(n));
      return;
    }
    pick(n);
  });

  // The YOURS pills, delegated on their container for the same reason the grid
  // delegates: the row is rebuilt on every open, and per-pill listeners would
  // accumulate one set per visit.
  $('browse-yours-pills').addEventListener('click', (e) => {
    const pill = e.target.closest('.yours-pill');
    if (!pill) return;
    const n = Number(pill.dataset.n);
    if (!Number.isInteger(n)) return;
    // Page there first so the grid is showing the tile that is about to light
    // up; pick() then marks it and raises the preview card.
    goToPage(Math.floor(n / PAGE_SIZE));
    pick(n);
  });

  built = true;
}

/** Point the 24 tiles at `page`, repaint the pager, and start loading. */
function renderPage() {
  const gen = ++renderGen;
  const first = page * PAGE_SIZE;
  const last = Math.min(first + PAGE_SIZE - 1, MAX_TOKEN);

  for (let slot = 0; slot < PAGE_SIZE; slot++) {
    const n = first + slot;
    const tile = tiles[slot];
    releaseSlot(slot);
    // The final page is short — 3,069 is not a multiple of 24. Hidden rather
    // than removed, so the grid never reflows to a different column count on
    // the last page.
    if (n > MAX_TOKEN) { tile.hidden = true; tile.removeAttribute('data-n'); continue; }
    tile.hidden = false;
    tile.dataset.n = String(n);
    tile.querySelector('b').textContent = String(n);
    tile.classList.toggle('on', selected ? selected.n === n : false);
    // Locked rather than hidden, deliberately. Showing all 3,069 and marking
    // which are yours keeps the browser a shop window for the collection — the
    // same reasoning that leaves the leaderboard's read policy open. Hiding
    // them would turn a 3,069-piece collection into a private album.
    const locked = gateOn() && !gateOwns(n);
    tile.classList.toggle('locked', locked);
    tile.setAttribute('aria-disabled', locked ? 'true' : 'false');
  }

  $('browse-range').textContent = t('browse.range')
    .replace('%a', String(first))
    .replace('%b', String(last))
    .replace('%p', String(page + 1))
    .replace('%t', String(PAGE_COUNT));
  $('btn-browse-prev').disabled = page <= 0;
  $('btn-browse-next').disabled = page >= PAGE_COUNT - 1;

  void loadPage(gen);
}

function goToPage(p) {
  const next = Math.max(0, Math.min(PAGE_COUNT - 1, p));
  if (next === page && built) return;
  page = next;
  renderPage();
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
  for (const tile of tiles) tile.classList.toggle('on', Number(tile.dataset.n) === n);

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

  // Goes through the same cache the grid does, so picking a tile you can
  // already see costs nothing.
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

// -------------------------------------------------------------------- yours

/**
 * The row of Primos this wallet actually holds.
 *
 * ⚠ THE LIST COMES FROM ownedTokens(), which reads the SIGNED pass payload —
 * not the convenience copy in localStorage beside it. That matters more here
 * than anywhere else in this file: this row is the one surface that says "these
 * are yours", so a list a console could append to would be a list that offers
 * a Primo the player does not hold.
 *
 * Tapping a pill does BOTH things: pages the grid to that Primo and picks it.
 * Picking alone would put the preview card up while the grid still showed some
 * unrelated page, which reads as the wrong tile having been chosen.
 */
function paintYours() {
  const row = $('browse-yours');
  if (!row) return;

  // Off with the gate off. Every Primo is wearable then, so a row headed
  // "YOURS" listing all 3,069 would be both enormous and untrue.
  const mine = gateOn() ? ownedTokens() : [];
  if (!mine.length) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');

  $('browse-yours-label').textContent = t('browse.yours').replace('%c', String(mine.length));

  const pills = $('browse-yours-pills');
  pills.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const n of mine) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'yours-pill';
    b.dataset.n = String(n);
    b.textContent = `#${n}`;
    frag.append(b);
  }
  pills.append(frag);
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

  $('btn-browse-prev').addEventListener('click', () => goToPage(page - 1));
  $('btn-browse-next').addEventListener('click', () => goToPage(page + 1));

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
    goToPage(Math.floor(n / PAGE_SIZE));
    pick(n);
  };
  $('btn-browse-jump').addEventListener('click', jump);
  $('browse-num').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); jump(); }
  });
}

/** Called every time the screen is shown. Builds the 24 tiles once, lazily. */
export async function openPrimoBrowser(currentNumber) {
  $('browse-status').textContent = '';
  index = await getIndex();
  if (!index || !index.count) {
    $('browse-status').textContent = t('browse.noIndex');
    return;
  }
  if (!built) build();
  // After build() — the row's container must exist before it can be filled —
  // and on every open rather than once, because the pass can change between
  // visits (it expires, or the player disconnects and connects another wallet).
  paintYours();

  // Reset the pick card unless they are coming back to the one they are wearing.
  selected = null;
  $('btn-browse-use').disabled = true;
  $('browse-pick').classList.add('hidden');

  // Open on the page holding the Primo they are already wearing, so coming back
  // lands where they left rather than at #0.
  const n = Number.isInteger(currentNumber) && currentNumber >= 0 && currentNumber <= MAX_TOKEN
    ? currentNumber : null;
  page = n === null ? 0 : Math.floor(n / PAGE_SIZE);
  renderPage();
  if (n !== null) {
    const slot = n - page * PAGE_SIZE;
    tiles[slot]?.classList.add('on');
  }
}

/** Stop the queue when the screen closes — those fetches are no longer wanted. */
export function releasePrimoBrowser() {
  renderGen++;
  pickGen++;
  for (let slot = 0; slot < tiles.length; slot++) releaseSlot(slot);
}
