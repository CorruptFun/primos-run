// La tiendita — Corrupt's corner store — and the offer he makes you the
// moment La Migra has you.
//
// ONE TABLE. Everything a shop item is lives in CATALOG below: what it costs,
// what it looks like, and what it does to the run. Nothing under it reads an
// id by name, so a new row on the shelf is a new row in that table and no
// layout code at all.
//
// Money lives in js/wallet.js and this file never touches storage. That split
// is the point: the cloud save being built in parallel wraps the wallet, and
// these screens never find out.
//
// VOICE. Corrupt is doing you a favour and would like you to know it. The
// shop's name, CHELA and the rest of the alley's vocabulary stay Spanish in
// both languages; the sentences around them follow the toggle. See the note
// at the top of js/i18n.js.

import { PAL, roundRect } from './art/palette.js';
import { PROP_DRAW } from './art/props.js';
import { PROP_EXTENT } from './tutorial.js';
import { drawTrainer, loadTrainer } from './art/trainer.js';
import { t, onLangChange } from './i18n.js';
import * as wallet from './wallet.js';
import * as sfx from './audio.js';
import { EVENTS, track } from './analytics.js';

// ---------------------------------------------------------------- the shelf

/**
 * What Corrupt keeps behind the counter, cheapest first — the order is load
 * bearing, because "the first thing you can afford" is what the shelf
 * highlights for a player standing there with their first thirty chelas.
 *
 * PRICES. A good run pays out on the order of twenty-five to forty-five
 * chelas, so the shelf is priced against ONE run: the cheap end is a run's
 * takings, the expensive end is a run and a bit. Nothing here is a grind, and
 * nothing here is pocket change either.
 *
 * @typedef {object} ShopItem
 * @property {string} id       stable key — also the shelf key in wallet.js
 * @property {number} price    in chelas
 * @property {string} icon     a PROP_DRAW key, or 'corrupt' for the man himself
 * @property {string} tone     accent colour for the row
 * @property {string} name     i18n key
 * @property {string} blurb    i18n key
 * @property {object} effect   {power?, fullTank?, life?} — read by loadoutFor()
 */
export const CATALOG = [
  {
    id: 'gasolina',
    price: 20,
    icon: 'taco',
    tone: PAL.lime,
    name: 'item.gasolina',
    blurb: 'item.gasolina.b',
    effect: { fullTank: true },
  },
  {
    id: 'magnet',
    price: 30,
    icon: 'magnet',
    tone: PAL.hotPink,
    name: 'item.magnet',
    blurb: 'item.magnet.b',
    effect: { power: 'magnet' },
  },
  {
    id: 'chancla',
    price: 35,
    icon: 'chancla',
    tone: PAL.gold,
    name: 'item.chancla',
    blurb: 'item.chancla.b',
    effect: { power: 'chancla' },
  },
  {
    id: 'vida',
    price: 45,
    icon: 'corrupt',
    tone: '#ff6b6b',
    name: 'item.vida',
    blurb: 'item.vida.b',
    effect: { life: 1 },
  },
  {
    id: 'lowrider',
    price: 55,
    icon: 'lowrider',
    tone: '#4dd8ff',
    name: 'item.lowrider',
    blurb: 'item.lowrider.b',
    effect: { power: 'lowrider' },
  },
];

const BY_ID = {};
for (const item of CATALOG) BY_ID[item.id] = item;

/**
 * What a continue costs, by how many you have already taken THIS RUN.
 *
 * It doubles, and it never stops doubling. A first continue is priced at a
 * fair run's takings so one good run funds one — the fourth is 200, which no
 * amount of good running funds on the spot. That curve is the whole safety
 * rail: death has to stay expensive or the run stops being a run. Buying your
 * way back also never buys SCORE, only more alley, so a wallet can extend a
 * run and can never inflate what it was worth.
 */
export const CONTINUE_BASE = 25;
export function continueCost(taken) {
  const n = Number.isFinite(taken) ? Math.max(0, Math.floor(taken)) : 0;
  return CONTINUE_BASE * Math.pow(2, n);
}

/**
 * Turn a list of shelf ids into the loadout Game.start() understands. Pure —
 * game.js never imports this file, it just gets a plain object.
 */
export function loadoutFor(ids) {
  const out = { powers: [], fullTank: false, lives: 0 };
  if (!ids) return out;
  for (let i = 0; i < ids.length; i++) {
    const item = BY_ID[ids[i]];
    if (!item) continue;
    const e = item.effect;
    if (e.power) out.powers.push(e.power);
    if (e.fullTank) out.fullTank = true;
    if (e.life) out.lives += e.life;
  }
  return out;
}

// ------------------------------------------------------------------- pieces

const $ = (id) => document.getElementById(id);

/** Hide every screen, including ours. main.js owns which one comes back. */
function hideScreens() {
  for (const el of document.querySelectorAll('#ui > .screen')) el.classList.add('hidden');
}

/** Every place the spendable balance is printed, in one call. */
export function paintWallet() {
  const n = wallet.balance().toLocaleString();
  for (const el of document.querySelectorAll('[data-wallet]')) el.textContent = n;
}

// Icon tiles. The props are drawn with the same code the alley uses, so a
// chancla on the shelf is the chancla you will pick up — no second art pass,
// and nothing to keep in sync.
const TOBJ = { seed: 0, x: 0, y: 0, w: 0, h: 0 };
const ICON_PX = 58;

function paintIcon(cv, item) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = ICON_PX;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(w * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, w);

  const bg = c.createLinearGradient(0, 0, 0, w);
  bg.addColorStop(0, 'rgba(255,255,255,0.10)');
  bg.addColorStop(1, 'rgba(0,0,0,0.30)');
  c.fillStyle = bg;
  roundRect(c, 0, 0, w, w, 13);
  c.fill();

  if (item.icon === 'corrupt') {
    // He IS the product on this row, so he gets to be the picture.
    drawTrainer(c, w / 2, w / 2, w * 0.84);
    return;
  }

  const ex = PROP_EXTENT[item.icon];
  const draw = PROP_DRAW[item.icon];
  if (!ex || !draw) return;
  c.save();
  roundRect(c, 0, 0, w, w, 13);
  c.clip();
  const span = ex.hi - ex.lo;
  const u = Math.min((w * 0.74) / span, (w * 0.66) / (ex.halfW * 2));
  TOBJ.seed = ex.seed;
  draw(c, w / 2, w / 2 + ((ex.hi + ex.lo) / 2) * u, u, TOBJ, 0);
  c.restore();
}

// Corrupt's badge is baked from a JPEG that may not have landed yet. When it
// does, the vida row is the one thing on the shelf still drawing nothing — so
// repaint the shelf once, if it is on screen.
loadTrainer().then((ok) => { if (ok && shopOpen()) renderShelf(); });

// ------------------------------------------------------------ la tiendita

let shopBack = null;      // where BACK goes — set by whoever opened the shop

function shopOpen() {
  const el = $('screen-shop');
  return !!el && !el.classList.contains('hidden');
}

/**
 * @param {() => void} back what to do when they are finished shopping. The
 *   shop is reachable from the menu, from the game over sheet and from the
 *   continue offer, and it owes each of them the screen it took.
 */
export function openShop(back) {
  shopBack = back || null;
  note('');
  // The balance they walked in with. Whether the shelf is priced right is
  // mostly a question about this number, not about what got bought.
  track(EVENTS.SHOP_OPEN, { balance: wallet.balance() });
  hideScreens();
  $('screen-shop').classList.remove('hidden');
  renderShelf();
}

function closeShop() {
  $('screen-shop').classList.add('hidden');
  const back = shopBack;
  shopBack = null;
  if (back) back();
}

const note = (msg) => { $('shop-note').textContent = msg; };

function renderShelf() {
  const list = $('shop-list');
  if (!list) return;
  const have = wallet.balance();
  paintWallet();

  list.innerHTML = '';
  let anyAffordable = false;

  for (const item of CATALOG) {
    const can = have >= item.price;
    if (can) anyAffordable = true;
    const held = wallet.stockOf(item.id);

    const row = document.createElement('div');
    row.className = 'shop-item' + (can ? '' : ' broke');
    row.style.setProperty('--tone', item.tone);

    const cv = document.createElement('canvas');
    cv.className = 'shop-icon';
    cv.setAttribute('aria-hidden', 'true');
    paintIcon(cv, item);
    row.appendChild(cv);

    const meta = document.createElement('div');
    meta.className = 'shop-meta';

    const name = document.createElement('p');
    name.className = 'shop-name';
    name.textContent = t(item.name);
    meta.appendChild(name);

    const blurb = document.createElement('p');
    blurb.className = 'shop-blurb-i';
    blurb.textContent = t(item.blurb);
    meta.appendChild(blurb);

    if (held) {
      const stock = document.createElement('p');
      stock.className = 'shop-stock';
      stock.textContent = t('shop.have').replace('%n', held);
      meta.appendChild(stock);
    }
    row.appendChild(meta);

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = can ? 'btn btn-small shop-buy' : 'btn btn-ghost btn-small shop-buy';
    buy.textContent = can ? String(item.price) : t('shop.short').replace('%n', item.price - have);
    buy.setAttribute('aria-label', `${t(item.name)} — ${item.price}`);
    buy.addEventListener('click', () => attemptBuy(item));
    row.appendChild(buy);

    list.appendChild(row);
  }

  // Never a wall of dead buttons with no way out of it: if nothing on the
  // shelf is reachable, say what the way out is — and the way out is running.
  if (!anyAffordable) note(t('shop.broke'));
}

function attemptBuy(item) {
  sfx.resume();
  // Pay first, grant second — and in ONE write, so the cloud can never be shown
  // the money gone with nothing bought. See wallet.buy().
  const bought = wallet.buy(item.id, item.price);
  if (bought === null) {
    sfx.uiClick();
    // A refusal is a price signal, not an error: `short` is exactly how far off
    // the shelf is for the people who wanted something and could not have it.
    track(EVENTS.SHOP_DENIED, {
      item: item.id,
      price: item.price,
      short: Math.max(0, item.price - wallet.balance()),
    });
    note(t('shop.denied'));
    renderShelf();
    return;
  }
  track(EVENTS.SHOP_BUY, { item: item.id, price: item.price, left: bought.left });
  sfx.powerUp();
  note(t('shop.bought').replace('%s', t(item.name)));
  renderShelf();
}

// -------------------------------------------------------- the continue offer

let contGame = null;
let contTake = null;
let contDecline = null;

/**
 * The offer, at the moment La Migra has you. Honest by construction: it says
 * what the run is currently worth, what getting it back costs, and what is in
 * your pocket, and the decline is a full-width button rather than a corner X.
 *
 * It is shown even when the player cannot afford it. There is no payment sheet
 * behind this — the only way to get chelas is to run — so an unaffordable
 * offer is not a taunt, it is the price list for the thing they just wanted.
 *
 * @param {import('./game.js').Game} game
 * @param {{onTake: () => void, onDecline: () => void}} handlers
 */
export function offerContinue(game, handlers) {
  const cost = continueCost(game.continues);
  const have = wallet.balance();
  const can = have >= cost;

  contGame = game;
  contTake = handlers.onTake;
  contDecline = handlers.onDecline;

  // What paying actually buys: the run as it stands. Nothing here is a
  // promise — it is the live scoreboard, which is the point.
  $('cont-keep').innerHTML = '';
  addStat($('cont-keep'), Math.floor(game.score).toLocaleString(), t('over.scoreLabel'));
  addStat($('cont-keep'), String(Math.floor(game.distance)), t('over.meters'));
  addStat($('cont-keep'), String(game.beers), t('over.chelas'));

  $('cont-price').innerHTML = '';
  addStat($('cont-price'), String(cost), t('cont.cost'), 'cost');
  addStat($('cont-price'), have.toLocaleString(), t('cont.have'), can ? '' : 'short');

  const take = $('btn-continue');
  take.textContent = `${t('cont.pay')} · ${cost}`;
  take.disabled = !can;
  take.classList.toggle('hidden', !can);

  const short = $('cont-short');
  short.textContent = can ? '' : t('cont.short').replace('%n', cost - have);
  short.classList.toggle('hidden', can);
  // The store is only worth offering when it is the answer to the sentence
  // above it. With money in hand the offer on screen already is the answer.
  $('btn-cont-shop').classList.toggle('hidden', can);

  hideScreens();
  $('screen-continue').classList.remove('hidden');
}

export function closeContinue() {
  $('screen-continue').classList.add('hidden');
}

function addStat(wrap, value, caption, cls) {
  const box = document.createElement('div');
  if (cls) box.className = cls;
  const b = document.createElement('b');
  b.textContent = value;
  const s = document.createElement('span');
  s.textContent = caption;
  box.appendChild(b);
  box.appendChild(s);
  wrap.appendChild(box);
}

// ------------------------------------------------------------------- wiring

$('btn-shop-back').addEventListener('click', () => { sfx.uiClick(); closeShop(); });

// Both answers clear the handlers first, so a double tap on a slow phone
// cannot both pay and give up.
$('btn-continue').addEventListener('click', () => {
  const fn = contTake;
  contGame = null;
  contTake = null;
  contDecline = null;
  if (fn) fn();
});

$('btn-cont-no').addEventListener('click', () => {
  const fn = contDecline;
  contGame = null;
  contTake = null;
  contDecline = null;
  sfx.uiClick();
  if (fn) fn();
});

// Shopping does not answer the offer — it comes back to it, re-priced against
// whatever they worked out at the counter.
$('btn-cont-shop').addEventListener('click', () => {
  sfx.uiClick();
  const game = contGame;
  const take = contTake;
  const decline = contDecline;
  openShop(() => {
    if (game && decline) offerContinue(game, { onTake: take, onDecline: decline });
  });
});

// The shelf is built from live state, so no data-i18n attribute can reach it.
// The note goes with it: it is feedback about something done in the OTHER
// language, and clearing it beats leaving a stale sentence in the wrong one.
onLangChange(() => {
  if (!shopOpen()) return;
  note('');
  renderShelf();
});
