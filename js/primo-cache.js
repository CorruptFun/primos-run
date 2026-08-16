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

// --------------------------------------------------------- gateway health
//
// ⚠ THE FALLBACK CHAIN USED TO HAVE NO MEMORY, AND THAT IS WHAT TURNS ONE BAD
// GATEWAY INTO "THE NFT PICTURES DO NOT SHOW".
//
// Every image started at GATEWAYS[0] and walked the list from the top. That is
// free when the first gateway answers and ruinous when it does not, because a
// gateway that is rate-limiting or chasing a block DOES NOT FAIL FAST — it
// holds the connection until FETCH_TIMEOUT fires. So a 20-tile page of the
// browser paid the full 9s fence on the dead gateway TWENTY TIMES, then again
// on the next dead one, before any tile reached a live gateway. Four gateways
// deep that is 36s per tile, at 8 concurrent, for art the player is watching an
// empty grid waiting for. The crew tiles gave up even earlier: CREW_ART_GRACE
// is 900ms, so the hand-drawn stand-ins were on screen long before the first
// gateway had finished not answering, and they simply stayed.
//
// The symptom is total ("it's just showing the stock characters") rather than
// partial, which is why this reads as art being broken rather than as one
// gateway being slow. Nothing logs, because every layer below is a correct
// graceful degradation — see the note on the console warning in fetchArt.
//
// So: remember. A gateway that fails goes on a cooldown and is tried LAST while
// it lasts, and the gateway that last answered is tried FIRST. The discovery
// cost is paid once per session by one image instead of once per image.
const health = new Map();     // gateway -> ms timestamp it may be tried again
let preferred = null;         // the gateway that last served us bytes

// A gateway that refused us (429) or fell over (5xx) is up and saying no, and
// it will keep saying no for a while — the whole point of a rate limit. One
// that timed out or could not be reached might just have been chasing a cold
// block, so it comes back into rotation sooner.
const COOL_REFUSED = 5 * 60 * 1000;
const COOL_FAILED = 60 * 1000;

const now = () => Date.now();

/**
 * The gateways to try, best bet first. Never drops one — a cooling gateway is
 * merely demoted, so a chain where every gateway is cooling still tries them
 * all rather than failing instantly. Exported because the `<img>` fallback walk
 * in js/primo-picker.js has to make the same decision.
 */
export function orderGateways(gateways) {
  const t = now();
  const ready = [], cooling = [];
  for (const gw of gateways) ((health.get(gw) || 0) > t ? cooling : ready).push(gw);
  const i = preferred ? ready.indexOf(preferred) : -1;
  if (i > 0) ready.splice(0, 0, ready.splice(i, 1)[0]);
  // Least-recently-cooled first, so the one closest to recovering is the one
  // the chain reaches for if it gets that far.
  cooling.sort((a, b) => (health.get(a) || 0) - (health.get(b) || 0));
  return ready.concat(cooling);
}

function noteOk(gw) {
  health.delete(gw);
  preferred = gw;
}

function noteFail(gw, cool) {
  health.set(gw, now() + cool);
  // Do not keep steering everything at a gateway that just stopped answering.
  if (preferred === gw) preferred = null;
}

/** What the chain currently thinks. For the console when art will not load. */
export function gatewayHealth() {
  const t = now();
  const out = { preferred, cooling: {} };
  for (const [gw, until] of health) {
    if (until > t) out.cooling[gw] = Math.round((until - t) / 1000) + 's';
  }
  return out;
}

// -------------------------------------------------------------------- fetch

/**
 * @param {AbortController|null} ctrl the caller's, so a losing attempt in the
 *   hedged walk below can be cancelled without touching the winner's body.
 * @returns {{res: Response|null, cool: number}} `cool` is how long to bench this
 *   gateway for when `res` is null.
 */
async function timedFetch(url, ms, ctrl) {
  const timer = setTimeout(() => { try { ctrl?.abort(); } catch { /* */ } }, ms);
  try {
    // CORS mode, not no-cors, and that is not optional: an opaque response
    // cannot be read, cannot be drawn from without tainting a canvas — which
    // would break the outfit-colour sampling in js/art/primo-head.js — and
    // counts against quota at a padded size. A gateway without CORS headers
    // fails here and the chain moves to the next one, which is correct.
    const res = await fetch(url, { mode: 'cors', cache: 'default', signal: ctrl?.signal });
    if (!res) return { res: null, cool: COOL_FAILED };
    if (!res.ok) {
      const refused = res.status === 429 || res.status >= 500;
      // A 404 is cooled too, on the short timer. On IPFS it usually means THIS
      // gateway could not find the block rather than that the CID is wrong, and
      // a gateway that does not carry this collection 404s every token — which
      // is a gateway worth skipping, not one worth asking 3,069 times. The short
      // cooldown is what keeps a genuinely bad CID from benching a good gateway.
      return { res: null, cool: refused ? COOL_REFUSED : COOL_FAILED };
    }
    // ⚠ A 200 IS NOT PROOF OF AN IMAGE. Gateways serve HTML — a block-not-found
    // page, a captcha, a "your request has been queued" interstitial — with a
    // 200 and a text/html content type. Baking that fails, which is recoverable;
    // CACHING it is not, because the cache is keyed on the CID and answers every
    // future request on this device with the same bad bytes. That is a permanent
    // per-device "the art stopped working" with a full cache behind it.
    //
    // Rejected by DOCUMENT type rather than accepted by `image/*`, and that way
    // round on purpose: a gateway is entitled to serve a raw block as
    // application/octet-stream, or with no content-type at all, and both decode
    // perfectly well. An allowlist would throw away working art from a working
    // gateway — trading the bug for a quieter one. Only the shapes that are
    // definitely a page and definitely not a picture are turned away.
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (/^(?:text\/|application\/(?:json|xhtml))/.test(type)) {
      return { res: null, cool: COOL_FAILED };
    }
    return { res, cool: 0 };
  } catch {
    // Aborted by the fence, DNS failure, connection refused, CORS rejection.
    return { res: null, cool: COOL_FAILED };
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------- the hedged walk
//
// ⚠ A SEQUENTIAL WALK IS HOSTAGE TO ITS SLOWEST MEMBER, and widening GATEWAYS
// from four to six made that worse, not better: six gateways at a 9s fence is
// 54 SECONDS before an image gives up, and the crew tiles have been showing
// hand-drawn stand-ins since CREW_ART_GRACE expired at 900ms. Trading "no art
// ever" for "art in a minute" is not a fix — nobody is looking at the menu that
// long, so it reads exactly the same.
//
// The killer is that the dominant failure is a STALL, not an error. A gateway
// that is throttling or chasing a cold block accepts the connection and holds
// it; only the fence ends it. So one slow gateway spends the whole budget while
// five live ones sit untried behind it.
//
// So the walk hedges: start a gateway, and if it has not answered within
// HEDGE_MS, start the NEXT ONE ALONGSIDE it rather than waiting it out. Losers
// are cancelled the moment anyone wins. A slow gateway now costs HEDGE_MS of
// latency instead of FETCH_TIMEOUT, and a gateway that is merely slow rather
// than dead can still win the race it started.
//
// This is the standard hedged-request trade: a little more load on the gateways
// when the first one is slow, in exchange for a tail that a player will wait
// through. It only ever fires on slowness — a gateway that answers promptly is
// never hedged against.
const HEDGE_MS = 2500;

/**
 * First gateway to answer wins.
 *
 * @returns {Promise<{gw: string, res: Response}|null>} never rejects. Resolves
 *   null only once EVERY attempt has finished without an answer.
 */
function walkGateways(cid, chain) {
  return new Promise((resolve) => {
    const running = [];        // { gw, ctrl } for everything started so far
    let next = 0;              // index of the next gateway to bring in
    let live = 0;              // attempts still in the air
    let done = false;
    let hedge = null;

    const finish = (value) => {
      if (done) return;
      done = true;
      if (hedge) clearTimeout(hedge);
      // ⚠ Abort the LOSERS ONLY. The winner's Response is headers-only at this
      // point — its body has not been read yet — so aborting a shared signal
      // here would cancel the very bytes we are about to bake and cache. That
      // is why each attempt carries its own controller instead of sharing one.
      for (const a of running) {
        if (!value || a.gw !== value.gw) { try { a.ctrl?.abort(); } catch { /* */ } }
      }
      resolve(value);
    };

    const start = () => {
      if (done) return;
      if (hedge) { clearTimeout(hedge); hedge = null; }
      if (next >= chain.length) {
        // Nothing left to start; the last attempt in flight decides it.
        if (live === 0) finish(null);
        return;
      }
      const gw = chain[next++];
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      running.push({ gw, ctrl });
      live++;
      // Armed BEFORE the await, or a stall would never reach the hedge at all.
      if (next < chain.length) hedge = setTimeout(start, HEDGE_MS);
      timedFetch(gw + cid, FETCH_TIMEOUT, ctrl).then(({ res, cool }) => {
        live--;
        // A rival already won and cancelled us. Say nothing: benching a gateway
        // for losing a race it might well have finished would be a lie that
        // compounds, since orderGateways would then steer traffic away from it.
        if (done) return;
        if (res) { noteOk(gw); finish({ gw, res }); return; }
        noteFail(gw, cool);
        start();   // this one is out — do not wait on the hedge, go now
      });
    };

    start();
  });
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
  const chain = orderGateways(gateways);
  const won = await walkGateways(cid, chain);
  if (won) {
    const { res } = won;
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

  // ⚠ THE ONE PLACE THAT SAYS ANYTHING OUT LOUD.
  //
  // Every layer below this is a deliberate graceful degradation — a tile that
  // cannot load is a grey square, a crew slot that cannot load keeps its
  // cartoon — and the sum of all that politeness is a game that silently shows
  // stand-ins with nothing whatsoever in the console. That is precisely how the
  // last three art outages presented (see the note in js/main.js: a memoised
  // empty index, an unfenced loadHead, a retired Cloudflare gateway), and each
  // one cost a debugging session that started from "it just doesn't work".
  //
  // Whole chain down is not a degradation, it is a fault, and it gets one line.
  try {
    console.warn(
      `[primos] no gateway served ${cid} — tried ${chain.length}`,
      gatewayHealth(),
    );
  } catch { /* console is not load bearing */ }
  return null;
}

/**
 * Forget one image's bytes.
 *
 * For the caller that got bytes out of here and could not decode them: those
 * bytes are wrong, and because the cache is keyed on the CID they will keep
 * being wrong on this device forever otherwise. Evicting turns a permanent
 * failure into one bad load, and the gateway walk behind it can then heal.
 */
export async function evict(cid) {
  if (!cid) return;
  writeIndex(readIndex().filter((c) => c !== cid));
  try {
    const cache = await open();
    if (cache) await cache.delete(keyFor(cid));
  } catch {
    /* best effort — the worst case is the state we were already in */
  }
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
