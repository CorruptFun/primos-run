#!/usr/bin/env node
// Does the NFT gate's chain lookup actually work? Answers it in one command,
// with nothing deployed.
//
//   SOLANA_RPC_URL='https://mainnet.helius-rpc.com/?api-key=…' \
//     node scripts/probe-gate.mjs <wallet-address> [collection-mint]
//
// WHY THIS EXISTS. The gate's verdict depends on three things being right: the
// RPC speaks DAS, the collection mint is the real one, and a Primo's token
// number can be read back out of its metadata. Getting any of them wrong fails
// in the two worst directions — refusing every genuine holder, or admitting
// everybody — and none of it is visible until a real wallet meets a deployed
// Edge Function. This runs the same three checks against a wallet you control,
// before any of that exists.
//
// ⚠ THE LOGIC BELOW IS A DELIBERATE TWIN of countPrimos() and tokenNumber() in
// supabase/functions/primos-gate/index.ts, and the two must not drift. They
// cannot be shared: that one is Deno on Supabase's runtime and this is Node with
// no build step between them. Same situation as js/raceday.js and its copy
// inside 0001_primos_cloud.sql. Change one, change the other, and re-run this.
//
// ⚠ NEVER PASS THE KEY AS AN ARGUMENT. Use the environment variable. Arguments
// are visible in `ps` to every process on the machine and land in shell history;
// the environment is merely bad rather than broadcast.

// Read at module scope so rpc() can close over it. Harmless on import — this
// file is imported for its pure exports by the offline suite, which never
// calls rpc().
const RPC = process.env.SOLANA_RPC_URL;
const SUPPLY = 3069;
const say = (ok, msg) => console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'probe', method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`not JSON: ${text.slice(0, 200)}`); }
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

// --- the twin. Keep byte-compatible with the Edge Function. ------------------
export function tokenNumber(asset) {
  const name = asset?.content?.metadata?.name ?? '';
  let m = /#\s*(\d{1,4})\b/.exec(name);
  if (m) return Number(m[1]);
  m = /\/(\d{1,4})\.json(?:$|\?)/.exec(asset?.content?.json_uri ?? '');
  return m ? Number(m[1]) : null;
}

export function primosIn(items, collection) {
  const tokens = [];
  let total = 0;
  for (const asset of items) {
    const grouped = (asset?.grouping ?? []).some((g) =>
      g?.group_key === 'collection' && g?.group_value === collection && g?.verified !== false);
    if (grouped && asset?.burnt !== true) {
      total++;
      const n = tokenNumber(asset);
      if (n !== null && n >= 0 && n < SUPPLY && !tokens.includes(n)) tokens.push(n);
    }
  }
  tokens.sort((a, b) => a - b);
  return { total, tokens };
}
// ----------------------------------------------------------------------------

// ⚠ EVERYTHING ABOVE IS PURE AND EXPORTED; everything below touches the network.
// The split is what lets dev/gate-test.html and the offline suite exercise the
// filter that decides who gets in — importing this file used to run the probe
// and exit, which meant the security-critical part had no test at all.
const isMain = process.argv[1]
  && (await import('node:url')).fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1]);
if (!isMain) { /* imported for its functions */ }
else await main();

async function main() {
const [wallet, collectionArg] = process.argv.slice(2);
if (!RPC || !wallet) {
  console.error(`usage: SOLANA_RPC_URL='<rpc>' node scripts/probe-gate.mjs <wallet> [collection]

  <wallet>      a Solana address you control that holds at least one Primo
  [collection]  the collection mint; omit to resolve it from the chain first
                (scripts/resolve-collection.mjs does the same thing on its own)`);
  process.exit(64);
}

console.log(`\nprobing ${wallet}\n`);

// 1. Does this endpoint speak DAS at all? The public RPC does not, and that is
//    the single most likely reason for a gate that refuses everyone.
let items;
try {
  const page = await rpc('getAssetsByOwner', {
    ownerAddress: wallet, page: 1, limit: 1000,
  });
  items = page?.items ?? [];
  say(true, `endpoint speaks DAS — ${items.length} asset(s) in this wallet`);
} catch (e) {
  say(false, `getAssetsByOwner failed: ${e.message}`);
  console.error(`
  If this says "Method not found", the endpoint is not DAS-capable — the public
  api.mainnet-beta.solana.com never is. Use Helius, Triton or QuickNode.
  If it says 401/403, the key is wrong or out of credits.`);
  process.exit(1);
}

// 2. Which collections is this wallet actually holding? Printed whether or not
//    a collection was supplied, because "I passed the wrong mint" and "this
//    wallet holds no Primos" look identical from the verdict alone.
const seen = new Map();
for (const a of items) {
  for (const g of a?.grouping ?? []) {
    if (g?.group_key !== 'collection') continue;
    const k = g.group_value;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
}
console.log('\n  collections held:');
if (!seen.size) console.log('    (none — this wallet holds no collection-grouped NFTs)');
for (const [mint, n] of [...seen].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`    ${String(n).padStart(4)}  ${mint}`);
}

const collection = collectionArg
  || [...seen].sort((a, b) => b[1] - a[1])[0]?.[0];
if (!collection) {
  say(false, 'no collection to test against');
  process.exit(1);
}
console.log(`\n  testing against: ${collection}${collectionArg ? '' : '  (guessed: the most-held)'}`);
if (!collectionArg) {
  console.log('  ⚠ GUESSED. Confirm with scripts/resolve-collection.mjs before setting the secret —\n'
    + '    the wrong mint here refuses every holder, or admits everybody.');
}

// 3. The actual gate verdict, computed by the same code the function runs.
const { total, tokens } = primosIn(items, collection);
say(total > 0, `verdict: ${total} Primo(s) — the gate would ${total > 0 ? 'LET THIS WALLET IN' : 'REFUSE this wallet'}`);

if (total > 0) {
  console.log(`\n  owned tokens (this is what becomes "yours and yours only"):`);
  console.log(`    ${tokens.length ? tokens.join(', ') : '(none readable)'}`);
  if (tokens.length !== total) {
    // Not fatal — the gate counts these, they just cannot be offered as a skin.
    say(false, `${total - tokens.length} Primo(s) held but their token number could not be read`);
    const bad = items.find((a) => (a?.grouping ?? []).some((g) =>
      g?.group_key === 'collection' && g?.group_value === collection) && tokenNumber(a) === null);
    if (bad) {
      console.log('    example name:', JSON.stringify(bad?.content?.metadata?.name));
      console.log('    example uri :', JSON.stringify(bad?.content?.json_uri));
      console.log('    → tokenNumber() needs to learn this shape, in BOTH twins.');
    }
  } else {
    say(true, 'every held Primo yielded a token number');
  }
}

console.log('');
}
