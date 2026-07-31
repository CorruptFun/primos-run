// The chela wallet, and the shelf of things bought and not yet used.
//
// This is deliberately a SEAM. La tiendita and the continue offer talk to this
// module and never to storage, so a cloud save can wrap these eight functions
// later without a single screen learning that the money moved house. Nothing
// here knows what an item does or what it costs — that is js/tiendita.js.
//
// Two invariants, both cheap and both load-bearing:
//   · a balance is a non-negative integer, always. Every value that goes in or
//     comes out passes through int(), so a hand-edited localStorage entry of
//     "-9" or NaN is repaired on sight instead of poisoning the save. It is
//     localStorage, so a determined player can still write themselves a
//     fortune — that is expected, and is not the same as letting the game
//     corrupt its own numbers.
//   · totalBeers is a LIFETIME stat and never goes down. The wallet is a
//     different number in a different field. See the migration below.

import { readEcon, writeEcon } from './store.js';

/** Most of any one item you can stack on the shelf. Stops silly numbers. */
export const MAX_STOCK = 9;

const int = (n) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** A shelf we can trust: plain object, integer counts, nothing at zero. */
function cleanShelf(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k in raw) {
    const n = Math.min(MAX_STOCK, int(raw[k]));
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Did cleanShelf actually have to change anything? */
function shelfMatches(raw, clean) {
  if (!raw || typeof raw !== 'object') return Object.keys(clean).length === 0;
  for (const k in raw) if (raw[k] !== clean[k]) return false;
  for (const k in clean) if (raw[k] !== clean[k]) return false;
  return true;
}

/**
 * The wallet as it should be, repairing and MIGRATING on first sight.
 *
 * THE MIGRATION HAPPENS ONCE, EVER. A returning player has hundreds of chelas
 * banked in `totalBeers` and would otherwise walk into la tiendita with zero,
 * having earned every one of them — so the first time this runs on a save the
 * wallet is seeded from that lifetime total and `walletSeeded` is written.
 * After that the two numbers are unrelated: one counts what you have ever
 * collected, the other is what you have left to spend.
 */
function state() {
  const raw = readEcon();
  const chelas = raw.walletSeeded ? int(raw.chelas) : int(raw.totalBeers);
  const shelf = cleanShelf(raw.shelf);
  // Write back only when something actually needed fixing — the seed, or a
  // junk value. `raw.chelas !== chelas` is also what catches NaN, since NaN
  // is not equal to itself.
  if (!raw.walletSeeded || raw.chelas !== chelas || !shelfMatches(raw.shelf, shelf)) {
    writeEcon((b) => {
      b.chelas = chelas;
      b.shelf = shelf;
      b.walletSeeded = true;
    });
  }
  return { chelas, shelf };
}

// ------------------------------------------------------------------- balance

export function balance() {
  return state().chelas;
}

export function canAfford(price) {
  return state().chelas >= int(price);
}

/**
 * Bank a run's takings. Called once, when a run is really over — not when the
 * player is still deciding whether to buy their way out of it.
 * @returns {number} the new balance
 */
export function deposit(n) {
  const add = int(n);
  if (!add) return balance();
  const before = state().chelas;          // also runs the migration, if it is due
  const after = before + add;
  writeEcon((b) => { b.chelas = after; });
  return after;
}

/**
 * Take money out. Atomic against storage: the balance is re-read inside the
 * write, so two screens can never spend the same chela.
 * @returns {number|null} the new balance, or null when they are short — in
 *   which case nothing was taken.
 */
export function spend(price) {
  const cost = int(price);
  state();                                 // migrate/repair before we do sums
  let out = null;
  writeEcon((b) => {
    const have = int(b.chelas);
    if (have < cost) return;
    out = have - cost;
    b.chelas = out;
  });
  return out;
}

// --------------------------------------------------------------------- shelf

/** @returns {Record<string, number>} a copy — mutating it buys nothing. */
export function stock() {
  return state().shelf;
}

export function stockOf(id) {
  return state().shelf[id] || 0;
}

/**
 * Put something on the shelf. Kept separate from spend() on purpose: the
 * caller pays first and only grants once the money is actually gone, so a
 * failed spend can never hand out goods.
 */
export function addStock(id, n = 1) {
  const add = int(n);
  if (!id || !add) return 0;
  state();
  let out = 0;
  writeEcon((b) => {
    const shelf = cleanShelf(b.shelf);
    out = Math.min(MAX_STOCK, (shelf[id] || 0) + add);
    shelf[id] = out;
    b.shelf = shelf;
  });
  return out;
}

/**
 * Consume ONE of each thing on the shelf and hand back the ids. Surplus stays
 * banked — buying three chanclas gets you a chancla on each of the next three
 * runs, not one thirty-second chancla.
 * @returns {string[]} item ids to apply to the run about to start
 */
export function takeStock() {
  state();
  const taken = [];
  writeEcon((b) => {
    const shelf = cleanShelf(b.shelf);
    for (const id in shelf) {
      taken.push(id);
      if (shelf[id] > 1) shelf[id] -= 1;
      else delete shelf[id];
    }
    b.shelf = shelf;
  });
  return taken;
}
