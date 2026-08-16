#!/usr/bin/env node
// The NFT gate's chain-side logic, against synthetic assets. No network, no key.
//
//   node scripts/verify-gate.mjs
//
// Exits non-zero, so it can gate a deploy the same way scripts/verify-chunks.mjs
// does. Run it after touching tokenNumber() or primosIn() in
// scripts/probe-gate.mjs — or their twins in
// supabase/functions/primos-gate/index.ts, which is the copy that actually
// decides who gets into the game.
//
// WHAT IS WORTH PINNING HERE. The grouping filter is the one piece of this
// project where a wrong answer is a security bug rather than a cosmetic one:
// too strict and every genuine holder is refused, too loose and the gate opens
// for the price of a counterfeit mint. None of it can be exercised against the
// real chain without a key and a wallet, so it is exercised against fixtures.

import { tokenNumber, primosIn } from './probe-gate.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};

const named = (s) => ({ content: { metadata: { name: s } } });
const uri = (s) => ({ content: { json_uri: s } });

console.log('\ntoken numbers, off the metadata shapes the collection actually uses:');
ok('"Primo #4"', tokenNumber(named('Primo #4')) === 4);
ok('"Primo #2933"', tokenNumber(named('Primo #2933')) === 2933);
// ⚠ The collection is 0..3068. Token #0 exists and has bitten this repo before.
ok('"Primo #0" — token 0 EXISTS', tokenNumber(named('Primo #0')) === 0);
ok('"Primo #3068" — the last one', tokenNumber(named('Primo #3068')) === 3068);
ok('a space after the hash', tokenNumber(named('Primo # 12')) === 12);
ok('a name with no number is null', tokenNumber(named('Primo')) === null);
ok('falls back to the pinned metadata path', tokenNumber(uri('https://ipfs.io/ipfs/bafyDIR/2933.json')) === 2933);
ok('…with a query string', tokenNumber(uri('https://x/ipfs/bafyDIR/7.json?ext=1')) === 7);
ok('…for token 0', tokenNumber(uri('https://x/ipfs/bafyDIR/0.json')) === 0);
ok('the name wins over the uri',
  tokenNumber({ content: { metadata: { name: 'Primo #5' }, json_uri: 'x/9.json' } }) === 5);
// Documents a real property rather than asserting a guard that does not exist:
// tokenNumber() parses a number out of ANY name and does not know what a Primo
// is. That is safe ONLY because primosIn() calls it after the collection filter
// has already passed. Move the call ahead of that filter and this becomes a hole.
ok('it parses any "#n" name — the collection filter is what makes that safe',
  tokenNumber(named('Mad Lads #1234')) === 1234);

console.log('\nthe grouping filter — the part where a wrong answer is a security bug:');
const C = 'PRIMOSCOLLECTIONMINT';
const asset = (collection, o = {}) => ({
  content: { metadata: { name: `Primo #${o.n ?? 1}` } },
  grouping: [{
    group_key: 'collection',
    group_value: collection,
    ...(o.verified === undefined ? {} : { verified: o.verified }),
  }],
  ...(o.burnt ? { burnt: true } : {}),
});

ok('counts a verified Primo', primosIn([asset(C, { n: 4, verified: true })], C).total === 1);
// DAS omits `verified` when it is true, so absence must not read as false —
// getting this backwards refuses every holder in the collection.
ok('counts one with the flag absent (DAS omits it when true)',
  primosIn([asset(C, { n: 4 })], C).total === 1);
// ⚠ The counterfeit case. Anyone can mint an NFT that NAMES this collection;
// only the collection authority can make that grouping verified.
ok('REFUSES an explicitly unverified grouping',
  primosIn([asset(C, { n: 4, verified: false })], C).total === 0);
ok('refuses a different collection', primosIn([asset('SOMETHINGELSE', { n: 4 })], C).total === 0);
ok('refuses a burnt asset', primosIn([asset(C, { n: 4, burnt: true })], C).total === 0);
ok('refuses an asset with no grouping at all', primosIn([named('Primo #4')], C).total === 0);
ok('dedupes a repeated token', primosIn([asset(C, { n: 9 }), asset(C, { n: 9 })], C).tokens.length === 1);
ok('sorts the owned list numerically',
  JSON.stringify(primosIn([asset(C, { n: 50 }), asset(C, { n: 4 })], C).tokens) === '[4,50]');

const mixed = primosIn([asset(C, { n: 0 }), asset('OTHER', { n: 1 }), asset(C, { n: 3068 })], C);
ok('a mixed wallet yields only its Primos, including #0',
  mixed.total === 2 && JSON.stringify(mixed.tokens) === '[0,3068]', JSON.stringify(mixed));

// A Primo whose number cannot be read still COUNTS for entry — the player
// plainly holds one — it just cannot be offered as a skin. Refusing entry over
// a metadata quirk would be the worse failure.
const unreadable = primosIn([{ content: { metadata: { name: 'Primo' } }, grouping: [{ group_key: 'collection', group_value: C }] }], C);
ok('an unreadable Primo still opens the door but is not selectable',
  unreadable.total === 1 && unreadable.tokens.length === 0, JSON.stringify(unreadable));

ok('an empty wallet is refused', primosIn([], C).total === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
