#!/usr/bin/env node
// Prints the Primos collection mint — the one string the NFT gate checks every
// wallet against.
//
//   SOLANA_RPC_URL=<rpc> node scripts/resolve-collection.mjs
//
// WHY THIS EXISTS. supabase/functions/primos-gate needs PRIMOS_COLLECTION, and
// getting it wrong fails in the two worst possible directions: a wrong address
// refuses every genuine holder, and an attacker-chosen one admits everybody. It
// is not a value to paste from a marketplace page — it is read here from the
// chain, from a mint this repo already trusts.
//
// HOW. scripts/harvest-primos.mjs pins SEED_MINT, the mint of Primo #4, and used
// its Metaplex metadata account to find the pinned IPFS directory that built
// data/primos-index.json. The same account carries the token's `collection`
// field: the collection mint, plus the `verified` flag that says the collection
// authority actually signed for this token's membership.
//
// ⚠ CHECK THE OUTPUT AGAINST A BLOCK EXPLORER before setting the secret. This
// script trusts one hardcoded mint and whatever RPC you point it at; the gate
// trusts whatever you paste. Two minutes with explorer.solana.com closes that.

const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Primo #4's mint, and the Metaplex Token Metadata program. Both are copied
// from scripts/harvest-primos.mjs, which has used them successfully against the
// live chain to build the index.
const SEED_MINT = '4mZDvkY9jNfnu9L5zn7Vp1YRPVfwRE1iVx5JhgsaYtzQ';
const METAPLEX = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58encode(bytes) {
  if (!bytes.length) return '';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  while (digits.length && digits[digits.length - 1] === 0) digits.pop();
  let out = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method} → ${JSON.stringify(body.error)}`);
  return body.result;
}

/**
 * The metadata account for a mint, found the same way harvest-primos.mjs finds
 * it: getProgramAccounts with a memcmp on the mint at offset 33 of a Metaplex
 * Metadata record (key 1 byte + update authority 32).
 *
 * Deliberately not a PDA derivation — that would need a sha256 loop and the
 * curve check, and this runs once, by hand, on a developer's machine.
 */
async function metadataFor(mint) {
  const accounts = await rpc('getProgramAccounts', [
    METAPLEX,
    {
      encoding: 'base64',
      commitment: 'confirmed',
      filters: [{ memcmp: { offset: 33, bytes: mint } }],
    },
  ]);
  if (!accounts?.length) throw new Error(`no metadata account for ${mint}`);
  return Buffer.from(accounts[0].account.data[0], 'base64');
}

/**
 * Walk the Metaplex Metadata layout far enough to reach `collection`.
 *
 * Borsh, so every variable-length field has to be stepped over in order — there
 * is no seeking to a named offset. The layout:
 *   key(1) updateAuthority(32) mint(32)
 *   name(4+n) symbol(4+n) uri(4+n)
 *   sellerFeeBasisPoints(2)
 *   creators: Option(1) [ vec len(4) { address(32) verified(1) share(1) } ]
 *   primarySaleHappened(1) isMutable(1)
 *   editionNonce: Option(1) [ u8 ]
 *   tokenStandard: Option(1) [ u8 ]
 *   collection: Option(1) [ verified(1) key(32) ]     <- the target
 */
function readCollection(buf) {
  let o = 1 + 32 + 32;
  const skipStr = () => { const n = buf.readUInt32LE(o); o += 4 + n; };
  skipStr(); skipStr(); skipStr();          // name, symbol, uri
  o += 2;                                    // sellerFeeBasisPoints
  if (buf.readUInt8(o++) === 1) {            // creators?
    const n = buf.readUInt32LE(o); o += 4;
    o += n * 34;                             // 32 + 1 + 1 each
  }
  o += 2;                                    // primarySaleHappened, isMutable
  if (buf.readUInt8(o++) === 1) o += 1;      // editionNonce
  if (buf.readUInt8(o++) === 1) o += 1;      // tokenStandard
  if (buf.readUInt8(o++) !== 1) return null; // no collection at all
  const verified = buf.readUInt8(o) === 1;
  return { verified, mint: b58encode(buf.subarray(o + 1, o + 33)) };
}

const meta = await metadataFor(SEED_MINT);
const collection = readCollection(meta);

if (!collection) {
  console.error(
    `Primo #4 (${SEED_MINT}) declares no collection.\n` +
    'The gate cannot be configured from this seed — check the mint on an explorer.',
  );
  process.exit(1);
}

console.log(`PRIMOS_COLLECTION=${collection.mint}`);
console.log(`verified: ${collection.verified}`);

if (!collection.verified) {
  // An unverified grouping is exactly what a counterfeit looks like, and the
  // Edge Function refuses to count one. If the real collection is unverified,
  // the gate needs a different check — not a relaxed one.
  console.error(
    '\n⚠ That grouping is NOT verified. supabase/functions/primos-gate only counts\n' +
    '  verified groupings, on purpose: an unverified one can be minted by anyone.\n' +
    '  Do not relax the function — work out why the seed mint looks like this first.',
  );
  process.exit(2);
}
