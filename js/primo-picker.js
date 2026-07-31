// The collection layer: which Primos exist, how their art is fetched, and
// whether a given one is free to claim.
//
// Nothing from the collection is stored in this repo. `data/primos-index.json`
// holds token number -> IPFS CID and nothing else; the pixels are fetched from
// a public gateway in the player's own browser, at the player's own request.

import { loadHead } from './art/primo-head.js';
import { fetchArt, release } from './primo-cache.js';

// Public gateways, tried in order, first answer wins.
//
// cloudflare-ipfs.com used to sit second in this list and has not resolved
// since Cloudflare retired its public gateway — it answers ENOTFOUND, so a
// third of the fallback chain was a guaranteed miss. These four are live.
export const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://w3s.link/ipfs/',
  'https://nftstorage.link/ipfs/',
];

// The collection is numbered 0..3068 — 3,069 tokens, and NOT 1..3069.
export const SUPPLY = 3069;
export const MAX_TOKEN = SUPPLY - 1;

const EMPTY = { images: {}, count: 0, supply: SUPPLY };

// A gateway that has gone quiet does not fail, it stalls: the connection is
// accepted and then simply held while the block is chased around the DHT, so
// an <img> fires neither load nor error and a bare `await loadHead(url)` waits
// for the rest of the session. Every gateway call here is fenced with this.
const LOAD_TIMEOUT = 9000;

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); }
    );
  });
}

// ------------------------------------------------------------------- index

let index = null;        // only ever holds a SUCCESSFUL fetch
let indexInflight = null;

/**
 * The token -> CID map.
 *
 * Failures are deliberately not remembered. The previous version cached
 * `{ images: {} }` on any error, so a single flaky fetch at boot — a cold
 * service worker, a tab opened offline — disabled both the crew art and the
 * number search for the whole page life, and every later search reported the
 * player's Primo as missing from a collection it is plainly in. Now a failed
 * attempt just returns empty and the next caller tries again.
 */
export async function getIndex() {
  if (index) return index;
  if (indexInflight) return indexInflight;

  indexInflight = (async () => {
    try {
      const res = await fetch('data/primos-index.json', { cache: 'default' });
      // fetch only rejects on network failure — a 404 from a bad deploy is a
      // perfectly good Response, and its body is an HTML error page.
      if (!res.ok) throw new Error(`index HTTP ${res.status}`);
      const json = await res.json();
      if (!json || typeof json.images !== 'object') throw new Error('index malformed');
      return json;
    } catch {
      return null;
    } finally {
      indexInflight = null;
    }
  })();

  const got = await indexInflight;
  if (got) index = got;
  return got || EMPTY;
}

/** Did the index actually load? Lets a caller tell "missing" from "no index". */
export const indexReady = () => index !== null;

/** @returns {string|null} the CID for a token, or null */
export function cidFor(idx, n) {
  const cid = idx.images[String(n)];
  return typeof cid === 'string' && cid ? cid : null;
}

/**
 * A token's head traits, out of the packed table scripts/harvest-primos.mjs
 * writes: one character per token per field, indexing that field's vocabulary.
 *
 * Colours can be sampled off the art, but STRUCTURE cannot — you cannot tell a
 * mariachi hat from a baseball cap by reading the crown pixels, and the old
 * code did not try: it hard-coded `hairStyle: 'messy'` and set the cap colour to
 * the hair colour, so every one of the 3,069 arrived in game as the same messy
 * head. The collection states all of it, so this reads it instead of guessing.
 *
 * @returns {object|null} null when the token's traits were never harvested —
 *          which a caller must treat as "unknown", not as "wearing nothing".
 */
export function traitsFor(idx, n) {
  const t = idx && idx.traits;
  if (!t || !t.rows || !t.vocab || !t.have) return null;
  if (t.have[n] !== '1') return null;
  const chars = t.chars || '';
  const out = {};
  for (const f of (t.fields || [])) {
    const row = t.rows[f];
    const list = t.vocab[f];
    if (!row || !list) continue;
    const v = list[chars.indexOf(row[n])];
    if (v && v !== 'None') out[f] = v;
  }
  return out;
}

/**
 * A fresh handful of token numbers, no repeats.
 *
 * Random per session on purpose: the crew row is scenery, and four fixed
 * tokens meant every player who ever opened the game met the same four
 * strangers. What persists across launches is the Primo the player CLAIMED,
 * which lives in its own slot.
 */
export function drawTokens(idx, count) {
  const pool = Object.keys(idx.images);
  if (!pool.length) return [];
  const picked = [];
  const seen = new Set();
  // Bounded: with 3,069 in the pool and four wanted, collisions are rare, and
  // a tiny pool (a partial index) still terminates and just repeats less.
  for (let guard = 0; picked.length < count && guard < count * 40; guard++) {
    const n = pool[(Math.random() * pool.length) | 0];
    if (seen.has(n)) continue;
    seen.add(n);
    picked.push(n);
  }
  while (picked.length < count) picked.push(pool[(Math.random() * pool.length) | 0]);
  return picked;
}

// ------------------------------------------------------------------- art

/**
 * Fetch a Primo's art and bake it into a head sprite.
 *
 * Goes through js/primo-cache.js first, so a token this device has already
 * downloaded — the crew from an earlier launch, a tile the player scrolled past
 * in the browser — is baked straight off disk with no gateway involved. A miss
 * falls back to the gateway walk, and the bytes are remembered on the way past.
 *
 * ⚠ `url` IS ALWAYS A DURABLE GATEWAY URL, never the `blob:` one the cache hands
 * out. wearPrimo() writes it straight into the save, and an object URL is only
 * valid for the life of the document that created it — storing one would put a
 * dead reference in localStorage that fails silently on the next launch and
 * looks exactly like the art having gone missing.
 *
 * @returns {{head: object, img: HTMLImageElement, url: string} | null}
 */
export async function loadPrimoArt(cid) {
  // The durable identity of this art, independent of which gateway answered and
  // independent of any object URL. Restoring a save re-resolves it through this
  // same function, which will usually be a cache hit anyway.
  const canonical = GATEWAYS[0] + cid;

  // ONE request. fetchArt checks the cache, walks the gateways on a miss, and
  // stores whatever answered — so the bytes cross the network at most once ever.
  //
  // ⚠ It is deliberately not "bake from the gateway, then cache it in the
  // background". That was the first version and it FETCHED EVERY IMAGE TWICE on
  // a cold cache: once through the <img>, once again to fill the cache. It
  // measured at 32 gateway requests for a 24-tile page — a caching layer that
  // doubled first-visit bandwidth to halve the second visit's.
  const blob = await fetchArt(cid, GATEWAYS);
  if (blob) {
    const result = await withTimeout(loadHead(blob), LOAD_TIMEOUT);
    // The Image has decoded the bytes by now, so the object URL has done its
    // job — holding it would leak one blob per Primo ever looked at.
    release(blob);
    if (result) return { ...result, url: canonical };
  }

  // Fallback for the cases fetch() cannot serve: a gateway that answers images
  // but sends no CORS headers, or storage being unavailable entirely. An <img>
  // needs neither, so this path still renders the Primo — it just cannot cache
  // it or sample its colours. Losing the caching is much better than losing the
  // art, which is what returning null here would mean.
  for (const gw of GATEWAYS) {
    const url = gw + cid;
    const result = await withTimeout(loadHead(url), LOAD_TIMEOUT);
    if (result) return { ...result, url };
  }
  return null;
}

/** Same fence for a URL the player supplied themselves. */
export async function loadPrimoUrl(url) {
  return withTimeout(loadHead(url), LOAD_TIMEOUT);
}

// ------------------------------------------------------------ claim status

/*
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * `data/primo-claims.json` is an editorial correction the owner pushes in a
 * commit: anyone can claim any Primo, and if someone takes one that is not
 * theirs, the owner assigns it back. It is NOT enforcement and must never be
 * described as such — it is a JSON file on a static host, and anyone with a
 * console can ignore it in about four seconds.
 *
 * The real guarantee is going to live server-side at WRITE time: a Supabase
 * row-level-security policy that rejects an insert taking a token somebody
 * else already holds. That is what actually decides who owns what. Everything
 * below is UX — it stops a player spending a tap, a gateway fetch and a moment
 * of ownership on a Primo that is already spoken for.
 *
 * So `claimStatus()` is shaped like the network call it is about to become:
 * async, latency-tolerant, and fail-open. When the backend lands, the body of
 * this one function becomes a query and no caller changes. A backend that is
 * down, slow or missing must never lock anybody out of the game — every error
 * path here returns `free`.
 */

/** @typedef {{ state: 'free'|'assigned'|'blocked', holder: string|null }} ClaimStatus */

const FREE = Object.freeze({ state: 'free', holder: null });

let claims = null;
let claimsInflight = null;
let claimsTried = false;

async function getClaims() {
  if (claims) return claims;
  // The file is optional. One failed look is enough — unlike the index, an
  // absent claims file is the expected steady state, not a fault to retry.
  if (claimsTried) return null;
  if (claimsInflight) return claimsInflight;

  claimsInflight = (async () => {
    try {
      const res = await fetch('data/primo-claims.json', { cache: 'default' });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || typeof json !== 'object') return null;
      const assigned = (json.assigned && typeof json.assigned === 'object') ? json.assigned : {};
      const blocked = Array.isArray(json.blocked) ? json.blocked.map(String) : [];
      return { assigned, blocked: new Set(blocked) };
    } catch {
      return null;
    } finally {
      claimsInflight = null;
      claimsTried = true;
    }
  })();

  const got = await claimsInflight;
  if (got) claims = got;
  return got;
}

/**
 * Who this browser thinks it is. Read tolerantly and never written: accounts
 * are another session's job, and this is only here so that the moment a handle
 * does exist, an assignment to that handle stops being a refusal.
 *
 * With no handle — the state of every player today — an assigned token reads
 * as taken, which is the correct default: nobody can show they are the owner.
 */
function localHandle() {
  try {
    const blob = JSON.parse(localStorage.getItem('primos-run.v1') || '{}');
    const h = blob.handle || blob.playerName || blob.wallet || null;
    return typeof h === 'string' && h ? h.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Is this token free for this player to claim?
 *
 * ALWAYS await it, even while it is answering out of a cached JSON blob — the
 * body becomes a Supabase query and callers must already tolerate the latency.
 *
 * @param {number|string} token
 * @returns {Promise<ClaimStatus>} never rejects
 */
export async function claimStatus(token) {
  try {
    const table = await getClaims();
    if (!table) return FREE;                       // no file, bad file: open
    const key = String(token);
    if (table.blocked.has(key)) return { state: 'blocked', holder: null };
    const holder = table.assigned[key];
    if (typeof holder === 'string' && holder) {
      const me = localHandle();
      if (!me || me !== holder.toLowerCase()) return { state: 'assigned', holder };
      return { state: 'free', holder };            // already yours
    }
    return FREE;
  } catch {
    return FREE;
  }
}

// -------------------------------------------------------------------- i18n
//
// These belong in js/i18n.js next to the other keys and should be folded in
// once the concurrent language work settles — they live here only so this
// feature does not collide with another session inside that one shared table.
//
// SAME CONTRACT AS i18n.js, INCLUDING ITS VOICE RULE — go read the block at the
// top of that file before touching a value here. The short version: `es` is
// entirely Spanish, `en` is entirely ENGLISH, and the only Spanish left in `en`
// is a proper noun (Primos, Corrupt, a Primo's name or number). There is no
// protected-vocabulary list any more; an older comment here claimed there was
// one and it was wrong. The tone stays deadpan and sarcastic on both sides —
// full English does not mean neutral English.

const EXTRA = {
  'primo.hintFind':   { en: 'Holder? Look up your number. The art loads live from IPFS — nothing is kept here.',
                        es: '¿Eres holder? Busca tu número. El arte se carga en vivo desde IPFS — aquí no se guarda nada.' },
  'primo.find':       { en: 'FIND', es: 'BUSCAR' },
  'primo.claim':      { en: 'CLAIM IT', es: 'RECLÁMALO' },
  'primo.claimed':    { en: "IT'S YOURS", es: 'YA ES TUYO' },
  'primo.previewAlt': { en: 'The Primo you looked up', es: 'El Primo que buscaste' },

  'status.searching': { en: 'Looking for #%n…', es: 'Buscando el #%n…' },
  'status.found':     { en: 'There it is. Claim it and it runs with you.',
                        es: 'Ahí está. Reclámalo y corre contigo.' },
  'status.claimedNum':{ en: 'Primo #%n is yours. Nobody is arguing.',
                        es: 'El Primo #%n es tuyo. Nadie está discutiendo.' },
  'status.outOfRange':{ en: 'The collection runs 0 to 3,068. That one does not exist.',
                        es: 'La colección va del 0 al 3,068. Ese no existe.' },
  'status.gatewayOut':{ en: '#%n exists, but no gateway answered. Try again in a moment.',
                        es: 'El #%n existe, pero ningún gateway contestó. Inténtalo en un momento.' },

  // The claim verdict, under the found card.
  'claim.checking':   { en: 'Asking around…', es: 'Preguntando por ahí…' },
  'claim.free':       { en: 'Free. Nobody has asked for it.', es: 'Libre. Nadie lo ha pedido.' },
  // Capital P: in `en` this is the collection's name, not the Spanish noun.
  'claim.assigned':   { en: 'That Primo already has an owner. Pick another.',
                        es: 'Ese primo ya tiene dueño. Escoge otro.' },
  'claim.assignedTo': { en: 'That Primo already has an owner: %h. Pick another.',
                        es: 'Ese primo ya tiene dueño: %h. Escoge otro.' },
  // "Barrio business" was the last of the protected vocabulary. The alley is
  // the thing the whole game is set in, so it carries the same shrug.
  'claim.blocked':    { en: 'That one is not up for claiming. Alley business.',
                        es: 'Ese no se reclama. Cosas del barrio.' },
  'claim.mine':       { en: 'Already yours. Go run.', es: 'Ya es tuyo. Corre.' },

  // The owner reassigned a Primo out from under whoever was wearing it.
  'status.reassigned':{ en: '#%n already had an owner. We gave it back. Find another.',
                        es: 'El #%n ya tenía dueño. Se lo devolvimos. Busca otro.' },

  // --- the browser (js/primo-browser.js) ---
  'browse.title':     { en: 'PICK YOUR PRIMO', es: 'ESCOGE TU PRIMO' },
  // "Nothing is kept here" was true of the SERVER and is still true — no
  // collection artwork is in this repo and none is uploaded anywhere. It read
  // as "nothing is kept anywhere", which stopped being true when
  // js/primo-cache.js started remembering what the player already downloaded.
  // The distinction is the honest one and it is worth the extra clause: the
  // pixels live on their device, not on ours.
  'browse.copy':      { en: 'All 3,069 of them, 20 at a time. Jump straight to your number if you know it. The art loads from public IPFS and is kept on your device, never on ours.',
                        es: 'Los 3,069, de 20 en 20. Salta directo a tu número si lo sabes. El arte se carga desde IPFS público y se guarda en tu dispositivo, nunca en el nuestro.' },
  // %a first token, %b last, %p page, %t total pages.
  'browse.range':     { en: '#%a–%b · %p/%t', es: '#%a–%b · %p/%t' },
  'browse.jump':      { en: 'GO', es: 'IR' },
  'browse.jumpPh':    { en: 'Jump to #', es: 'Ir al #' },
  'browse.use':       { en: 'RUN AS THIS ONE', es: 'CORRE CON ESTE' },
  'browse.back':      { en: 'BACK', es: 'ATRÁS' },
  'browse.noIndex':   { en: 'Could not load the collection list. Check your connection and try again.',
                        es: 'No se pudo cargar la lista de la colección. Revisa tu conexión e inténtalo otra vez.' },
  'crew.tileBrowse':  { en: 'BROWSE', es: 'VER' },
};

const PACKS = { en: Object.create(null), es: Object.create(null) };
for (const key in EXTRA) {
  PACKS.en[key] = EXTRA[key].en;
  PACKS.es[key] = EXTRA[key].es;
}

/** @returns {string|undefined} undefined when the key is not ours */
export function extraString(key, lang) {
  const pack = PACKS[lang] || PACKS.en;
  const v = pack[key];
  return v !== undefined ? v : PACKS.en[key];
}
