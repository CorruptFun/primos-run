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

/**
 * Shelf ids that have been renamed, old -> new.
 *
 * A shelf is `{ itemId: count }` in the player's save and NOTHING validates it
 * against the catalog — cleanShelf keeps any key with a count, takeStock hands
 * every key to loadoutFor(), and loadoutFor silently ignores an id it does not
 * know. So a rename without this row does not error anywhere: it just deletes a
 * 55-chela item off the shelf of everyone who bought one before the rename and
 * gives them nothing for it.
 */
const RENAMED = { lowrider: 'skateboard' };

/**
 * A shelf we can trust: plain object, integer counts, nothing at zero, and
 * renamed ids carried over onto their new name.
 */
function cleanShelf(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k in raw) {
    const n = Math.min(MAX_STOCK, int(raw[k]));
    if (!n) continue;
    const id = RENAMED[k] || k;
    // Summed, not assigned: a save can hold both names at once if the player
    // bought one on each side of the rename.
    out[id] = Math.min(MAX_STOCK, (out[id] || 0) + n);
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
 * Buy one of something: check the funds, take the money and put the goods on
 * the shelf in a SINGLE storage write.
 *
 * Pay-first-grant-second still holds — the funds check and the debit happen
 * before the shelf is touched, inside the same blob, so being short hands out
 * nothing. What this adds is that the pair cannot TEAR, which started to matter
 * the moment economy writes began mirroring to the cloud: a push landing
 * between a separate spend() and addStock() publishes "money gone, nothing
 * bought", and that is the version a new device would then restore.
 *
 * spend() stays for the caller that genuinely is one-sided — paying for a
 * continue buys no goods. addStock() stays as the other half of the seam, for
 * granting something that was not paid for here.
 *
 * @returns {{left: number, held: number}|null} null when short — nothing taken.
 */
export function buy(id, price) {
  const cost = int(price);
  if (!id) return null;
  state();                                 // migrate/repair before we do sums
  let out = null;
  writeEcon((b) => {
    const have = int(b.chelas);
    if (have < cost) return;               // short — no debit, no goods
    const shelf = cleanShelf(b.shelf);
    const held = Math.min(MAX_STOCK, (shelf[id] || 0) + 1);
    shelf[id] = held;
    b.chelas = have - cost;
    b.shelf = shelf;
    out = { left: have - cost, held };
  });
  return out;
}

// ---------------------------------------------------------------------- gear
// El fit: bought once, owned forever, worn by slot. Same seam discipline as
// the shelf — la tiendita calls these and never touches storage, and the
// catalog (what exists, what it costs, which slot it fills) stays in
// js/tiendita.js where a price and the thing it buys are one row of one table.

const GEAR_SLOTS = ['mask', 'chain'];

/** Gear we can trust: { itemId: true } and nothing else. */
function cleanGear(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k in raw) {
    if (typeof k === 'string' && k && raw[k] === true) out[k] = true;
  }
  return out;
}

/** A fit we can trust: known slots only, string ids or null. */
function cleanFit(raw) {
  const out = {};
  for (const s of GEAR_SLOTS) {
    const v = raw && typeof raw === 'object' ? raw[s] : null;
    out[s] = typeof v === 'string' && v ? v : null;
  }
  return out;
}

/** @returns {Record<string, true>} a copy — mutating it owns nothing. */
export function gearOwned() {
  return cleanGear(readEcon().gear);
}

export function ownsGear(id) {
  return !!gearOwned()[id];
}

/**
 * What is worn, validated against what is OWNED — a hand-edited save can claim
 * to wear anything, and the renderer must never draw gear that was not paid
 * for, or the whole point of the price is gone.
 */
export function fitOn() {
  const raw = readEcon();
  const owned = cleanGear(raw.gear);
  const fit = cleanFit(raw.fit);
  for (const s of GEAR_SLOTS) {
    if (fit[s] && !owned[fit[s]]) fit[s] = null;
  }
  return fit;
}

/**
 * Buy a piece of gear: funds check, ALREADY-OWNED check, debit and grant in a
 * SINGLE storage write. Owning it already refuses without charging — there is
 * nothing a second copy of a mask could be, so the money must not move.
 * @returns {{left: number}|null} null when short or already owned — nothing taken.
 */
export function buyGear(id, price) {
  const cost = int(price);
  if (!id) return null;
  state();                                 // migrate/repair before we do sums
  let out = null;
  writeEcon((b) => {
    const gear = cleanGear(b.gear);
    if (gear[id]) return;                  // owned — no debit, nothing changes
    const have = int(b.chelas);
    if (have < cost) return;               // short — no debit, no goods
    gear[id] = true;
    b.chelas = have - cost;
    b.gear = gear;
    out = { left: have - cost };
  });
  return out;
}

/**
 * Wear something (or take it off with null). Only owned gear can be worn, and
 * only known slots exist. Stamps fitSetAt so the cross-device merge knows
 * which device dressed the player last (js/merge.js pickFit).
 * @returns {boolean} whether anything changed
 */
export function equipGear(slot, id) {
  if (!GEAR_SLOTS.includes(slot)) return false;
  let changed = false;
  writeEcon((b) => {
    const gear = cleanGear(b.gear);
    const want = typeof id === 'string' && id ? id : null;
    if (want && !gear[want]) return;       // not owned — nothing to wear
    const fit = cleanFit(b.fit);
    if (fit[slot] === want) return;        // already exactly this — no write
    fit[slot] = want;
    b.fit = fit;
    b.gear = gear;                          // write the repair back while here
    b.fitSetAt = Date.now();
    changed = true;
  });
  return changed;
}

// ------------------------------------------------------------------- banking

/**
 * Bank a finished run — takings PLUS whatever the settle callback prices — in
 * ONE storage write. The callback gets the raw blob and may stamp the latches
 * that gate its bonuses (racha, jales); returning the bonus total. Because the
 * stamp and the deposit share the write, a payout and the latch that says it
 * was paid can never tear apart — not across a crash, not across the cloud
 * push that mirrors every economy write.
 *
 * deposit() stays for the caller with no settlement; this is game over's door.
 *
 * @param {number} takings chelas collected in the run
 * @param {(blob: object) => number} [settle] stamps latches, returns bonus
 * @returns {{balance: number, extra: number}}
 */
export function bankRun(takings, settle) {
  state();                                 // migrate/seed before we do sums
  let out = { balance: balance(), extra: 0 };
  writeEcon((b) => {
    const extra = int(settle ? settle(b) : 0);
    const next = int(b.chelas) + int(takings) + extra;
    b.chelas = next;
    out = { balance: next, extra };
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
