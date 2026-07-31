# Client — identity, sync, boards

The client module is the *only* public surface for the sync layer. Everything else in the app talks
to it, never to the backend SDK directly, so the dormant gate and the never-throw contract are
enforced in one place.

Two modules, one direction of dependency: `cloud` owns the client singleton, the session and the
save; `leaderboard` imports from `cloud` and never the reverse. `cloud` reaches `leaderboard` only
through a lazy `import()` at the moment it needs it — which keeps the boot path free of the boards
and lets either be deleted without touching the other.

## §identity

### The dormant gate

```js
const URL = /* env var, or a checked-in config module on a no-build project */
const KEY = /* the publishable / anon key — safe to ship, RLS is the protection */

export function isCloudConfigured() { return !!URL && !!KEY }
```

Every exported function starts with this check and returns a neutral value when it fails: `null`,
`[]`, an empty board, or nothing at all. That is what lets the whole stack merge and deploy before a
backend project exists, and what keeps the "cloud isn't set up on this build" UI honest.

### The lazy singleton

```js
let clientPromise = null
async function sb() {
  if (!isCloudConfigured()) return null
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')          // bundled
    // clientPromise = import('https://esm.sh/@supabase/supabase-js@2')  // no build step
      .then(m => m.createClient(URL, KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }))
  }
  return clientPromise
}
export function sbClient() { return sb() }   // siblings share the SAME instance, never a second
```

`import()`, not a static import: on a bundled project this puts the SDK in its own async chunk so an
unconfigured build never ships it, and on a static project it means an unconfigured or offline player
never makes the CDN request at all. Exclude the chunk from any service-worker precache — it must be
*absent* on a local-only build, not *stale*.

`detectSessionInUrl: true` is what completes the OAuth redirect on the way back in. Without it the
player lands back on the app still signed out, with the tokens sitting unread in the URL.

### Session mirror

Keep a plain local mirror of `{ userId, email }` plus a listener set, so the rest of the app can read
auth state synchronously and re-render on change without knowing the SDK exists.

```js
export function onCloudChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }
export function cloudSession() { return session }
```

Notify inside a `try/catch` per listener — one broken subscriber must not cascade into the others.

If anything in the app posts to the REST API with a **raw `fetch`** rather than through the SDK
(analytics needs this for `keepalive` on the page-unload flush, which the SDK doesn't expose), mirror
the access token out too and refresh it on every auth event. A rotated token otherwise leaves those
writes authenticating as anonymous, and they will fail whatever RLS check expects a `user_id`.

### Sign-in

```js
export async function signInWithGoogle() {
  const c = await sb()
  if (!c) return { ok: false, error: "Cloud save isn't set up on this build." }
  const { error } = await c.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href.split('#')[0] },  // clean URL; SDK appends its own params
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}
```

This **redirects the whole page**. Nothing runs after it on success — the return is a fresh page
load. So the only failure you can report from here is "the redirect couldn't be started", and any
"you're signed in!" handling must live in the auth-state listener, not in a `.then()`.

### Boot

```js
export async function initCloud() {
  const c = await sb()
  if (!c) return
  c.auth.onAuthStateChange((event, s) => {
    const hadSession = session !== null
    applySession(s)
    notify()
    if (session && !hadSession) {
      // ONLY a genuinely new sign-in — a returning player's boot restore is the same
      // transition delivered as INITIAL_SESSION. See the SKILL.md invariant.
      if (event === 'SIGNED_IN') track(EVENTS.SIGNIN_COMPLETED)
      void syncNow()          // reconcile BEFORE any local persist can overwrite the cloud
    }
  })
  try { applySession((await c.auth.getSession()).data.session) } catch { session = null }
  window.addEventListener('online', () => { if (pending) void flushPush() })
  notify()
}

export async function bootstrapCloud(timeoutMs = 3000) {
  if (!isCloudConfigured()) return
  try {
    await initCloud()
    if (session) await Promise.race([syncNow(), new Promise(r => setTimeout(r, timeoutMs))])
  } catch { /* cloud must never block boot */ }
}
```

Call `bootstrapCloud()` before the game is created, and `await` it — a signed-in returning player
should boot *on* their cloud save from the first paint, not have it swapped in a second later.
The `Promise.race` is what makes that safe on a slow network.

## §sync

### Pull, merge, persist, push

```js
export async function syncNow() {
  if (!session) return
  const remote = await pullCloudSave()
  const winner = remote ? mergeSaves(loadSave(), remote) : loadSave()   // LOCAL first — it wins ties
  persistSave(winner)
  pushCloudSave(winner)   // ensures a first-ever cloud row exists even when local was already newest
}
```

`mergeSaves` is **pure** — no network, no clock — so it is trivially unit-testable, and it is worth
testing properly because it is the one function that can destroy a player's progress.

```js
export function mergeSaves(a, b) {
  const metrics = s => [s.unlocked || 1, s.best || 0, totalStars(s), s.currency || 0]
  const ma = metrics(a), mb = metrics(b)
  let winner = a                                  // dead tie prefers `a` (local)
  for (let i = 0; i < ma.length; i++) {
    if (mb[i] > ma[i]) { winner = b; break }
    if (ma[i] > mb[i]) break
  }
  return { ...winner, ...unionLatches(a, b), ...pickByRecency(a, b) }
}
```

A whole record, then the two exceptions spread over it — see the SKILL.md invariant on why the
display name must travel by recency and one-time latches must union.

### Push

Debounced (~1.5s) so a burst of persists during a level-end collapses into one upsert. Failures
**re-queue** rather than drop, and an `online` listener drains the queue.

```js
export function pushCloudSave(data) {
  if (!isCloudConfigured() || !session) return
  pending = data
  if (pushTimer) return
  pushTimer = setTimeout(() => { void flushPush() }, 1500)
}

async function flushPush() {
  pushTimer = null
  const c = await sb(), data = pending
  pending = null
  if (!c || !session || !data) return
  try {
    await c.from('saves').upsert(
      { user_id: session.userId, data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    // Boards ride the same beat — fire-and-forget, lazily imported, never blocking the save.
    void import('./leaderboard').then(m => { void m.maybeSubmitDaily(data) })
  } catch {
    pending = data    // offline / transient → retry on the next persist or the 'online' event
  }
}
```

Also export a **flush-now** that skips the debounce, for deliberate one-off acts (see the SKILL.md
invariant — "set my name, close the browser" fits inside 1.5s). It must clear the timer, call the
same `flushPush`, and swallow its own rejection: callers use `void flushNow()`, and `await sb()` is a
dynamic import that can fail offline *outside* `flushPush`'s own try/catch.

### Device backup — no account required

```js
export function exportSave() {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(loadSave())))) } catch { return '' }
}
export function importSave(code) {
  try { persistSave(coerceSave(JSON.parse(decodeURIComponent(escape(atob(code.trim())))))); return true }
  catch { return false }
}
```

The `unescape(encodeURIComponent(...))` sandwich is not decoration — plain `btoa` throws on any
non-Latin-1 character, and player-chosen names contain them constantly. Route the import through the
same `coerceSave` the normal load uses, so a hand-edited or truncated code degrades to defaults
instead of poisoning the save.

## §boards

### Submit

Piggybacks the save push; never its own timer, never its own traffic path.

```js
let lastSent = null   // (partition, score) memo — skip an upsert already sent this page-load

export async function maybeSubmitDaily(save, now = new Date()) {
  try {
    const s = cloudSession(); if (!s) return
    const day = dayKey(now)
    const score = bestForDay(save, day)
    if (score <= 0) return
    if (lastSent && lastSent.day === day && lastSent.score >= score) return
    const c = await client(); if (!c) return
    const { error } = await c.from('game_daily_scores').upsert(
      { user_id: s.userId, day_key: day, score, display_name: preferredName() },
      { onConflict: 'user_id,day_key' }
    )
    if (!error) lastSent = { day, score }
  } catch { /* offline — the next save push retries; the board loses only freshness */ }
}
```

Only ever submit the **current** partition. The guard refuses any other, so walking a whole history
map would just generate rejected requests — and every earlier day was already mirrored on the push
that recorded it.

The memo is an optimisation, not a correctness mechanism: the server's monotonic guard is what
actually makes redundant sends harmless. Only set the memo when the write **succeeded**, or one
offline blip suppresses submissions for the rest of the session.

### Fetch top-N plus own rank

```js
const { data } = await c.from('game_daily_scores')
  .select('user_id, display_name, score')
  .eq('day_key', day)
  .order('score', { ascending: false })
  .order('scored_at', { ascending: true })     // byte-identical to the index definition
  .limit(limit)
```

Then own rank. If the player is in the returned rows, read it off directly. If not, fetch their own
row and **count how many beat it** — a `head: true` count, so no rows cross the wire:

```js
const { count } = await c.from('game_daily_scores')
  .select('user_id', { count: 'exact', head: true })
  .eq('day_key', day).gt('score', score)
myRank = count + 1
```

For a board that ranks on more than one key, this must be a **composite** count — see the SKILL.md
invariant. Ranking on `(total desc, days_played desc)`:

```js
const higher = /* … .gt('total', row.total) */
const tied   = /* … .eq('total', row.total).gt('days_played', row.days_played) */
myRank = higher.count + tied.count + 1
```

Return a uniform board shape (`{ key, entries, myRank, myScore }`) from every board, and let a row
carry an optional `valueText` to override its right-hand readout. The level ladder ranks on a level
number but wants to show `47 · ★118`; the weekly board ranks on a total but wants `18,204 · 5d`.
Letting the row supply the string keeps the panel from having to know which board it is rendering.

Every fetch returns the **empty board** on any failure, so the panel renders "sign in to join the
race" rather than an error state — the same code path serves signed-out, unconfigured, and offline.
