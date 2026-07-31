// The local art cache — fetch a Primo's pixels once per device, ever.
//
// WHY THIS EXISTS. Before it, every launch drew four fresh crew tokens and
// pulled them from a public IPFS gateway, and opening the browser re-pulled
// every tile you scrolled past, every time. Nothing was kept. So the cost of a
// returning player was identical to a brand new one, and the visible symptom
// was the menu showing hand-drawn cartoons for a second on every single launch
// while four images crossed the network again.
//
// ⚠ NONE OF THIS TOUCHES SUPABASE. Worth stating plainly because it is the
// natural assumption: the art comes from public IPFS gateways, and the token →
// CID map (`data/primos-index.json`) is a static file on this game's own host,
// already precached by sw.js. Supabase serves saves, boards, analytics and
// feedback — no image has ever come from it. The bandwidth this saves is the
// gateways' and the static host's.
//
// WHAT IS STORED. The bytes of images the player asked to see, in the Cache
// Storage API under a key of our own. No collection artwork ships in this repo
// and none is uploaded anywhere — this is the same "fetched in the player's own
// browser, at the player's own request" story, with the browser now allowed to
// remember what it already fetched.
//
// ⚠ THE CACHE NAME MUST SURVIVE A DEPLOY, and sw.js is what makes that true.
// Its activate handler used to delete EVERY cache whose key was not the current
// shell — which would have wiped this one on every single deploy and quietly
// turned a permanent cache into a per-release one. It now sweeps only its own
// `primos-run-` prefix. If that ever regresses, this file still works and stops
// saving anyone anything, with no error to notice.

const CACHE_NAME = 'primos-art-v1';

// Roughly a 500-image ceiling. A Primo PFP is ~30-60KB, so this is on the order
// of 20MB — comfortable against a browser's origin quota, and far more than a
// player who is picking one Primo will ever touch.
const MAX_ENTRIES = 500;
const INDEX_KEY = 'primos-run:art-cache';

// Fetch fence. Gateways STALL rather than fail — the connection is accepted and
// then held while the block is chased around the DHT — so every call needs its
// own timeout or the fallback chain is never reached. Same reasoning, and the
// same number, as LOAD_TIMEOUT in js/primo-picker.js.
const FETCH_TIMEOUT = 9000;

const supported = typeof caches !== 'undefined' && typeof Request !== 'undefined';

async function open() {
  if (!supported) return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Safari private mode, storage disabled, quota gone. Everything below
    // degrades to "fetch it again", which is exactly the old behaviour.
    return null;
  }
}

/**
 * The cache key: a synthetic SAME-ORIGIN URL built from the CID.
 *
 * Deliberately not the gateway URL. A CID is the content's identity — the same
 * bytes whichever gateway served them — so keying on the gateway would store
 * the same image up to four times and miss whenever the fallback chain landed
 * somewhere new. Nothing ever fetches this path; it exists only to be a key.
 */
function keyFor(cid) {
  return new Request(`__primo-art/${encodeURIComponent(cid)}`);
}

// ------------------------------------------------------------------- the LRU

/**
 * Insertion order, oldest first. Cache Storage exposes no size and no ordering,
 * so the bookkeeping lives here — a plain list of CIDs in localStorage.
 *
 * If it desyncs from the cache (cleared storage, a failed put) nothing breaks:
 * an entry in the list that is not in the cache is a miss, and an entry in the
 * cache that is not in the list is simply never evicted by us.
 */
function readIndex() {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(list) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    /* blocked — the cache still works, it just stops being bounded by us */
  }
}

async function remember(cache, cid) {
  const list = readIndex().filter((c) => c !== cid);
  list.push(cid);
  const overflow = list.splice(0, Math.max(0, list.length - MAX_ENTRIES));
  writeIndex(list);
  for (const old of overflow) {
    try { await cache.delete(keyFor(old)); } catch { /* best effort */ }
  }
}

// -------------------------------------------------------------------- fetch

async function timedFetch(url, ms) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { try { ctrl?.abort(); } catch { /* */ } }, ms);
  try {
    // CORS mode, not no-cors, and that is not optional: an opaque response
    // cannot be read, cannot be drawn from without tainting a canvas — which
    // would break the outfit-colour sampling in js/art/primo-head.js — and
    // counts against quota at a padded size. A gateway without CORS headers
    // fails here and the chain moves to the next one, which is correct.
    const res = await fetch(url, { mode: 'cors', cache: 'default', signal: ctrl?.signal });
    return res && res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------- api

/**
 * A cached image as an object URL, WITHOUT touching the network.
 *
 * This is the one that removes the flash: a hit resolves in a few milliseconds
 * off disk, so a returning player's menu can paint real faces before the first
 * frame instead of a second later.
 *
 * @returns {Promise<string|null>} an object URL the caller must eventually pass
 *   to release(), or null on a miss.
 */
export async function cachedArt(cid) {
  if (!cid) return null;
  const cache = await open();
  if (!cache) return null;
  try {
    const hit = await cache.match(keyFor(cid));
    if (!hit) return null;
    return URL.createObjectURL(await hit.blob());
  } catch {
    return null;
  }
}

/** True when this CID is already on disk. Cheaper than materialising a blob. */
export async function isCached(cid) {
  if (!cid) return false;
  const cache = await open();
  if (!cache) return false;
  try {
    return !!(await cache.match(keyFor(cid)));
  } catch {
    return false;
  }
}

/**
 * The cached bytes, or the first gateway that answers — and remember it.
 *
 * @param {string} cid
 * @param {string[]} gateways tried in order, first answer wins
 * @returns {Promise<string|null>} an object URL for release(), or null when the
 *   whole chain failed. Never rejects.
 */
export async function fetchArt(cid, gateways) {
  if (!cid) return null;

  const hit = await cachedArt(cid);
  if (hit) return hit;

  const cache = await open();
  for (const gw of gateways) {
    const res = await timedFetch(gw + cid, FETCH_TIMEOUT);
    if (!res) continue;
    if (cache) {
      try {
        // clone() BEFORE reading the body — a Response body can only be
        // consumed once, and putting a drained one stores an empty entry that
        // then answers every future match with zero bytes.
        await cache.put(keyFor(cid), res.clone());
        await remember(cache, cid);
      } catch {
        /* quota, private mode — serve it anyway, just do not remember it */
      }
    }
    try {
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  }
  return null;
}

/** Hand back an object URL. Not optional — these leak until revoked. */
export function release(url) {
  try {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  } catch {
    /* never throws */
  }
}

/** How many images this device is holding. For the ACCOUNT screen's copy. */
export function cachedCount() {
  return readIndex().length;
}

/** Forget every cached image. Offered in ACCOUNT next to the other storage. */
export async function clearArtCache() {
  try {
    writeIndex([]);
    if (supported) await caches.delete(CACHE_NAME);
    return true;
  } catch {
    return false;
  }
}
