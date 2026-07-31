#!/usr/bin/env node
// Builds data/primos-index.json — a map of Primo number -> IPFS image CID.
//
// We ship *CIDs*, never the artwork. The game loads a player's Primo straight
// from a public IPFS gateway at runtime, so no collection art lives in this
// repo. Magic Eden's API blocks browser CORS, which is why this runs offline.
//
//   node scripts/harvest-primos.mjs [--budget 3200] [--concurrency 8] [--force]
//
// Resumable: re-running merges into the existing index instead of starting over.
//
// ---------------------------------------------------------------------------
// WHY THIS NO LONGER SCRAPES MAGIC EDEN
//
// The old version paged /collections/primos/listings + /activities and then
// resolved each unseen mint through /tokens/{mint}. That can never finish:
// ME serves ~150 listings and caps `activities` at roughly a thousand records
// (offset 2000 already answers `[]`), and an activity only exists for a token
// that has actually traded. It plateaued at 520 of 3,069 — six of every seven
// holders would search for their Primo and not find it.
//
// The collection's on-chain metadata URI points at ONE pinned IPFS directory:
//
//   https://gateway.pinata.cloud/ipfs/<META_DIR>/<n>.json
//
// …which holds every token, 0.json through 3068.json, each carrying its own
// `name` ("Primo #4") and `image` (the pinned CID). So the whole collection is
// enumerable from IPFS alone, with no API key, no rate-limited index and no
// dependency on a marketplace. That is the source now.
//
// META_DIR is verified, not trusted: resolveMetaDir() reads it back off-chain
// from a mint already in the index and only falls back to the pinned constant
// if the RPC is unavailable. Every fetched record is accepted only if its own
// `name` parses to a number, so a swapped directory fails loudly.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'primos-index.json');

const SYMBOL = 'primos';
// 3,069 tokens, numbered 0..3068 — the collection's own description says 3,069
// and the directory holds exactly that many files. NOT 1..3069.
const SUPPLY = 3069;

// Pinned fallback for the metadata directory, read off the Metaplex metadata
// account of Primo #4 — SEED_MINT below is that token's mint.
const META_DIR = 'bafybeigvk5ok6styaswm5w5jqeonlxgqmu6eszraocx4yk5wi7e5c5j7du';
const SEED_MINT = '4mZDvkY9jNfnu9L5zn7Vp1YRPVfwRE1iVx5JhgsaYtzQ';

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const METAPLEX = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

// Public gateways, round-robined. A single gateway will start throttling a few
// hundred requests in; spreading the load across several keeps the run honest
// without hammering any one of them. Ordered fastest-first from a cold probe.
const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://w3s.link/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://ipfs.filebase.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

// ------------------------------------------------------------------- traits
//
// The metadata this script already downloads carries the token's full trait
// list, and the runner's back-of-head is built out of exactly these fields.
// They used to be thrown away, so every real Primo arrived in game as "messy
// hair + a cap in whatever colour the crown pixels happened to be" — a mariachi
// hat came out a baseball cap. Colours can be sampled from the art; STRUCTURE
// cannot, and the collection already states it.
//
// Only head traits are kept. Clothing is deliberately left out: its vocabulary
// is four times the size of any of these and the shirt colour already comes
// from sampling the art, which works.
const TRAIT_FIELDS = {
  hat: 'Hats',
  hair: 'Hair',
  bandana: 'Bandana',
  glasses: 'Glasses',
  earring: 'Earrings',
  base: 'Base',
};

// One character per token per field, so the whole trait table costs ~6 bytes a
// token instead of ~40 as JSON objects. Every player downloads this file on the
// menu's first paint, which is the same reason the mint addresses were dropped.
// `"` and `\` are excluded so the rows never need escaping inside JSON.
const CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^_`{|}~';
const NONE = 'None';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const BUDGET = flag('--budget', SUPPLY);
const CONCURRENCY = Math.max(1, Math.min(12, flag('--concurrency', 8)));
const FORCE = process.argv.includes('--force');   // re-fetch tokens we already have

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the index

function load() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    return { collection: SYMBOL, updated: null, count: 0, supply: SUPPLY, images: {} };
  }
}

/**
 * Encode the per-token trait map into the packed form described above.
 *
 * The vocabulary is rebuilt from scratch on every save rather than appended to,
 * so a re-harvest can never leave a stale index pointing at a value that has
 * moved. `None` is pinned at slot 0 of every field for the same reason a
 * missing token encodes as `None`: the reader then has exactly one "no trait"
 * case to handle instead of two.
 */
function packTraits(traits) {
  const fields = Object.keys(TRAIT_FIELDS);
  const vocab = {};
  const rows = {};

  for (const f of fields) {
    const seen = new Set();
    for (let n = 0; n < SUPPLY; n++) {
      const v = traits[n] && traits[n][f];
      if (v && v !== NONE) seen.add(v);
    }
    // Sorted so the packed file is stable between runs — an unsorted Set would
    // reshuffle every index whenever the fetch order changed and turn a no-op
    // re-harvest into a whole-file diff.
    const list = [NONE, ...[...seen].sort()];
    if (list.length > CHARS.length) {
      throw new Error(`trait "${f}" has ${list.length} values, over the ${CHARS.length}-char budget`);
    }
    vocab[f] = list;
    const slot = new Map(list.map((v, i) => [v, i]));
    let row = '';
    for (let n = 0; n < SUPPLY; n++) {
      const v = (traits[n] && traits[n][f]) || NONE;
      row += CHARS[slot.get(v) ?? 0];
    }
    rows[f] = row;
  }
  // A token that was never fetched and a token genuinely wearing nothing both
  // encode as slot 0 in every field, and nothing else can tell them apart. So
  // record which tokens we actually hold — otherwise a re-run re-downloads
  // every bare-headed Primo forever, and the game cannot tell "no hat" from
  // "no data" either.
  let have = '';
  for (let n = 0; n < SUPPLY; n++) have += traits[n] ? '1' : '0';
  return { fields, chars: CHARS, vocab, have, rows };
}

function save(index) {
  index.collection = SYMBOL;
  index.supply = SUPPLY;
  index.count = Object.keys(index.images).length;
  // Mint addresses were carried by the Magic Eden era of this script. Every
  // player downloads this file, and nothing in the game reads them, so they are
  // dropped: 520 of them was 27KB of dead weight on the menu's first paint.
  delete index.mints;
  index.updated = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // Keys written in numeric order so the file diffs sanely between runs.
  const images = {};
  for (const n of Object.keys(index.images).map(Number).sort((a, b) => a - b)) {
    images[n] = index.images[n];
  }
  index.images = images;
  // Packed last and never carried through unpacked: `raw` is scratch for this
  // process only, and shipping it would triple the file.
  const raw = index.rawTraits;
  delete index.rawTraits;
  if (raw && Object.keys(raw).length) index.traits = packTraits(raw);
  fs.writeFileSync(OUT, JSON.stringify(index));
  index.rawTraits = raw;
  return index.count;
}

/** How many tokens we hold head traits for. Reported, and drives `wanted`. */
function traitCount(index) {
  return index.rawTraits ? Object.keys(index.rawTraits).length : 0;
}

/**
 * Unpack an index's traits back into the raw per-token map, so a re-run keeps
 * what it already has instead of re-fetching all 3,069 records to add one.
 */
function unpackTraits(index) {
  const t = index.traits;
  const raw = {};
  if (!t || !t.rows || !t.vocab) return raw;
  const chars = t.chars || CHARS;
  const have = t.have || '';
  for (let n = 0; n < SUPPLY; n++) if (have[n] === '1') raw[n] = {};
  for (const f of Object.keys(TRAIT_FIELDS)) {
    const row = t.rows[f];
    const list = t.vocab[f];
    if (!row || !list) continue;
    for (let n = 0; n < SUPPLY && n < row.length; n++) {
      const v = list[chars.indexOf(row[n])];
      if (v && v !== NONE && raw[n]) raw[n][f] = v;
    }
  }
  return raw;
}

/** "Primo #1921" -> 1921 */
function numberOf(name) {
  const m = /#\s*(\d+)/.exec(name || '');
  return m ? Number(m[1]) : null;
}

/** ipfs.io/ipfs/<cid> -> cid. Storing bare CIDs keeps the index small. */
function cidOf(url) {
  const m = /\/ipfs\/([A-Za-z0-9]+)/.exec(url || '');
  return m ? m[1] : null;
}

/**
 * The head traits, out of the token's full attribute list.
 *
 * Returns `{}` — not null — for a record with no `attributes` at all (token #0
 * is one), because an empty object still says "this token was fetched", which
 * is what stops the next run downloading it again.
 */
function traitsOf(meta) {
  const out = {};
  const attrs = Array.isArray(meta?.attributes) ? meta.attributes : [];
  const by = new Map(attrs.map((a) => [a.trait_type, a.value]));
  for (const [key, traitType] of Object.entries(TRAIT_FIELDS)) {
    const v = by.get(traitType);
    if (typeof v === 'string' && v && v !== NONE) out[key] = v;
  }
  return out;
}

// ------------------------------------------------------------ metadata dir

/**
 * Read the metadata directory back off-chain rather than taking the constant on
 * faith. getProgramAccounts with a memcmp on the mint (offset 33 of a Metaplex
 * metadata account) returns exactly one account; the Borsh layout after the
 * 65-byte header is name(4+32) symbol(4+10) uri(4+200), which is the 254 bytes
 * we slice. If the public RPC declines — it rate-limits and sometimes refuses
 * this program outright — the pinned constant carries the run.
 */
async function resolveMetaDir() {
  const mint = SEED_MINT;
  try {
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getProgramAccounts',
        params: [METAPLEX, {
          encoding: 'base64',
          dataSlice: { offset: 65, length: 254 },
          filters: [{ memcmp: { offset: 33, bytes: mint } }],
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json();
    const acc = json?.result?.[0]?.account?.data?.[0];
    if (!acc) throw new Error('no metadata account');
    const buf = Buffer.from(acc, 'base64');
    // 0..36 name, 36..50 symbol, 50.. uri
    const uri = buf.subarray(54, 254).toString('utf8').replace(/\0+$/, '').trim();
    const dir = /\/ipfs\/([A-Za-z0-9]+)\//.exec(uri)?.[1];
    if (!dir) throw new Error(`unexpected metadata uri: ${uri}`);
    if (dir !== META_DIR) console.log(`  note: on-chain dir differs from the pinned one -> ${dir}`);
    return dir;
  } catch (e) {
    console.log(`  chain lookup unavailable (${e.message}); using the pinned directory`);
    return META_DIR;
  }
}

// ------------------------------------------------------------------ fetching

let gwCursor = 0;
const stats = { ok: 0, miss: 0, retry: 0 };

/**
 * One token's metadata. Tries a different gateway on each attempt — a 429 or a
 * timeout from one is usually just that one, and rotating beats sleeping.
 * @returns {{n: number, cid: string, traits: object} | null}
 */
async function fetchToken(n, tries = GATEWAYS.length + 2) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const gw = GATEWAYS[gwCursor++ % GATEWAYS.length];
    try {
      const res = await fetch(`${gw}${DIR}/${n}.json`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 404) return null;                 // past the end of the drop
      if (!res.ok) { stats.retry++; await sleep(400 * (attempt + 1)); continue; }
      const meta = await res.json();
      const num = numberOf(meta?.name);
      const cid = cidOf(meta?.image);
      // The record names itself. A directory that stopped being Primos, or a
      // gateway serving someone else's block, is dropped rather than indexed.
      if (num === null || !cid) return null;
      stats.ok++;
      return { n: num, cid, traits: traitsOf(meta) };
    } catch {
      stats.retry++;
      await sleep(400 * (attempt + 1));
    }
  }
  stats.miss++;
  return null;
}

/** Fixed-size worker pool over a list of token numbers. */
async function harvest(index, wanted) {
  let cursor = 0;
  let sinceSave = 0;
  const total = wanted.length;

  const worker = async () => {
    while (cursor < total) {
      const n = wanted[cursor++];
      const got = await fetchToken(n);
      if (got) {
        index.images[got.n] = got.cid;
        index.rawTraits[got.n] = got.traits;
      }
      if (++sinceSave >= 100) {
        sinceSave = 0;
        const have = save(index);
        process.stdout.write(
          `  ${stats.ok + stats.miss}/${total} fetched · ${have} indexed · ` +
          `${traitCount(index)} with traits · ${stats.retry} retries\n`
        );
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// ---------------------------------------------------------------------- run

const index = load();
if (!index.images) index.images = {};
index.rawTraits = unpackTraits(index);
console.log(
  `starting from ${Object.keys(index.images).length} indexed primos, ` +
  `${traitCount(index)} with head traits`
);

console.log('\nresolving the metadata directory…');
const DIR = await resolveMetaDir();
console.log(`  ${DIR}`);

// A token needs fetching if we lack its image OR its head traits. The second
// clause is what lets an index built before traits existed fill itself in.
const wanted = [];
for (let n = 0; n < SUPPLY; n++) {
  if (!FORCE && index.images[n] && index.rawTraits[n]) continue;
  wanted.push(n);
  if (wanted.length >= BUDGET) break;
}

if (!wanted.length) {
  console.log(`\nnothing to do — all ${SUPPLY} tokens are already indexed.`);
} else {
  console.log(`\nfetching ${wanted.length} tokens, ${CONCURRENCY} at a time…`);
  const t0 = Date.now();
  await harvest(index, wanted);
  const total = save(index);
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(
    `\ndone: ${total}/${SUPPLY} primos indexed in ${secs}s ` +
    `(${stats.ok} fetched, ${stats.miss} unreachable, ${stats.retry} retries) -> data/primos-index.json`
  );
  console.log(`     ${traitCount(index)}/${SUPPLY} with head traits`);
  const missing = [];
  for (let n = 0; n < SUPPLY; n++) if (!index.images[n]) missing.push(n);
  if (missing.length) {
    console.log(`still missing ${missing.length}: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`);
    console.log('re-run to pick them up — the index merges.');
  }
}
