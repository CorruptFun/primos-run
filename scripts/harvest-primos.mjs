#!/usr/bin/env node
// Builds data/primos-index.json — a map of Primo number -> IPFS image URL.
//
// We ship *URLs*, never the artwork. The game loads a player's Primo straight
// from the public IPFS gateway at runtime, so no collection art lives in this
// repo. Magic Eden's API blocks browser CORS, which is why this runs offline.
//
//   node scripts/harvest-primos.mjs [--budget 2500]
//
// Resumable: re-running merges into the existing index instead of starting over.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'primos-index.json');
const API = 'https://api-mainnet.magiceden.dev/v2';
const SYMBOL = 'primos';

const budgetArg = process.argv.indexOf('--budget');
const NAME_BUDGET = budgetArg > -1 ? Number(process.argv[budgetArg + 1]) : 3200;

// Magic Eden's free tier is ~120 req/min; stay well under it.
const GAP_MS = 620;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let calls = 0;
async function api(pathname, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt++) {
    await sleep(GAP_MS);
    calls++;
    try {
      const res = await fetch(`${API}${pathname}`, {
        headers: { accept: 'application/json' },
      });
      if (res.status === 429) {
        process.stderr.write(' [429, backing off] ');
        await sleep(8000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    return { collection: SYMBOL, updated: null, count: 0, images: {}, mints: {} };
  }
}

function save(index) {
  index.count = Object.keys(index.images).length;
  index.updated = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(index));
  return index.count;
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

const index = load();
const known = new Set(Object.values(index.mints || {}));

console.log(`starting from ${Object.keys(index.images).length} indexed primos`);

// ---- 1. listings: these carry the token name, so they resolve immediately
console.log('\npaging listings…');
for (let offset = 0; offset < 600; offset += 100) {
  const page = await api(`/collections/${SYMBOL}/listings?offset=${offset}&limit=100`);
  if (!page || !page.length) break;
  for (const l of page) {
    const n = numberOf(l.token?.name);
    const cid = cidOf(l.token?.image || l.extra?.img);
    if (n && cid) {
      index.images[n] = cid;
      index.mints[n] = l.tokenMint;
      known.add(l.tokenMint);
    }
  }
  process.stdout.write(`  offset ${offset}: ${Object.keys(index.images).length} known\n`);
  if (page.length < 100) break;
}
save(index);

// ---- 2. activities: mint + image, but no name — collect them for step 3
console.log('\npaging activities for unseen mints…');
const pending = new Map();   // mint -> cid
for (let offset = 0; offset < 12000; offset += 500) {
  const page = await api(`/collections/${SYMBOL}/activities?offset=${offset}&limit=500`);
  if (!page || !page.length) break;
  for (const a of page) {
    const cid = cidOf(a.image);
    if (!a.tokenMint || !cid) continue;
    if (known.has(a.tokenMint)) continue;
    pending.set(a.tokenMint, cid);
  }
  process.stdout.write(`  offset ${offset}: ${pending.size} unresolved mints\n`);
  if (page.length < 500) break;
}

// ---- 3. resolve names one mint at a time, within budget
console.log(`\nresolving ${Math.min(pending.size, NAME_BUDGET)} names (budget ${NAME_BUDGET})…`);
let done = 0;
for (const [mint, cid] of pending) {
  if (done >= NAME_BUDGET) break;
  const tok = await api(`/tokens/${mint}`, 2);
  done++;
  const n = numberOf(tok?.name);
  if (n) {
    index.images[n] = cidOf(tok.image) || cid;
    index.mints[n] = mint;
  }
  if (done % 25 === 0) {
    const total = save(index);
    process.stdout.write(`  ${done}/${Math.min(pending.size, NAME_BUDGET)} resolved · ${total} indexed\n`);
  }
}

const total = save(index);
console.log(`\ndone: ${total} primos indexed in ${calls} API calls -> data/primos-index.json`);
