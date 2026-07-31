# Analytics

First-party product analytics — no third-party trackers, no ad SDKs, nothing
leaves this project. Code is the source of truth; this explains the *why*, what
the numbers mean, and the activation steps that are **human-only**.

Built to the **`first-party-analytics` skill** (`~/.claude/skills/`), which
distills the shipped Viva Maya implementation. Read it before changing anything
here.

## Why it exists

Before this, the only telemetry the game had was the leaderboards — and both
require a Google sign-in. So **every signed-out player was invisible**, and none
of these could be answered at all:

- How many people open the game? How many come back tomorrow?
- **Where do runs end?** Is the difficulty curve doing what `PACING` claims?
- Does the tutorial land, and if not, on which step do people bail?
- Does La Tiendita convert? Is the shelf priced right?
- Does anyone actually pay for a continue, and at which rung of the ladder?
- Did that deploy break something?

The sister project shipped with 8 known accounts against ~10–12 believed-active
players, which is the exact hole this closes.

## The pieces

| layer | where |
|---|---|
| Table + guard + admin RPC + prune | `supabase/migrations/20260731120000_primos_analytics.sql` |
| Client pipe + crash telemetry | `js/analytics.js` |
| Build stamp | `js/version.js` |
| Opt-out UI | `js/account.js` → ACCOUNT → "Gameplay stats" |
| Dashboard | `stats.html` + `js/stats/` |
| Pure model + tests | `js/stats/model.js`, asserted in `dev/cloud-test.html` |
| Live verification | `scripts/verify-rls.sh` |

---

## ⚠ Everything is `primos_`-prefixed, and here that is load-bearing

Viva Maya lives in **this same Supabase project** (`deskabqqxqqibxjffwmb`) and
already owns, applied and live:

```
public.events            public.events_guard()     public.prune_events()
public.app_admins        public.admin_analytics()
```

An unprefixed version of `0003` **would not have failed.** It would have:

- `create table if not exists public.events` → found Viva Maya's live table and
  **quietly done nothing**. Primos would then write every event into Viva Maya's
  log. Two games, one stream, both dashboards silently wrong.
- `create or replace function public.events_guard()` → matching signature, so it
  **replaces** rather than fails — throwing away the dedupe Viva Maya's `0018`
  exists to provide. Its deduplication would just stop, with no error anywhere.
- the same for `admin_analytics()` and `prune_events()`.

That is the `0002` invite-table hazard with three more heads, and nothing
anywhere would have said a word. **Keep every object prefixed.**

`primos_app_admins` is prefixed for the same reason even though Viva Maya's
`app_admins` holds the same human — reusing it means silently adopting a table
this repo does not own, plus a hidden cross-game dependency. The cost of owning
it is one `insert`, once.

---

## The invariants

### The event log is APPEND-ONLY to every client

`primos_events` has an **INSERT policy and no SELECT policy, ever.** RLS denies
what it does not allow, so a visitor holding the publishable key can write their
own events and read nothing.

This is not caution, it is proportionality: an event log is a **per-device
behavioural history**, which is worse to leak than a leaderboard or an invite
code. There is no version of "just for debugging" that justifies a select policy.
The migration ends with a self-check that **refuses to apply** if one exists.

Corollaries that follow from "no SELECT":

- Any view over it needs `security_invoker = on`, or it re-exposes everything as
  its owner.
- Every `security definer` function sets `search_path = public, pg_temp`.
- UPDATE/DELETE policies would be unreachable anyway — Postgres locates rows via
  the SELECT policy — so client writes go through a function, never policies.
- `Prefer: return=minimal` on the insert is **correctness, not optimisation**:
  asking PostgREST to return the inserted rows makes it read them back and fail
  the write.

### Anonymous by construction

`device_id` is a random UUID minted in `localStorage` — **not a fingerprint**,
not derived from anything about the device or the person, and not the account.
Auth-keyed telemetry only ever sees the minority who sign in, which is the
problem this exists to solve.

`user_id` is set only while signed in, and RLS pins it to `auth.uid()` so it
cannot be forged. `session_id` is minted per app open and never persisted.

That identity choice is what makes the disclosure in ACCOUNT honest, and an
honest disclosure is the only kind worth writing.

### Bound the damage; do not pretend to prevent forgery

Rows are self-reported by untrusted clients. The `BEFORE INSERT` guard:

- normalises the name to lower snake_case; **anything else becomes a visible
  `unknown` bucket** — a typo must surface on the dashboard, not vanish
- bounds `props` to a JSON object under 2KB, else `{}`
- forces `created_at = now()` — the client never chooses when
- dedupes on `event_id`
- **never throws.** An exception here goes back into the game loop through the
  fetch that raised it. A bad row is worth losing; a run is not.

### The client pipe never throws, never blocks, and is dormant until configured

`track()` is synchronous void: append to a queue and return. Batches at 20
events or 15s. Queue capped at 200, **dropping the oldest** — during an offline
stretch the recent events describe the player now.

The flush uses raw `fetch`, not supabase-js, for one reason: **`keepalive`**.
`visibilitychange → hidden` is the only reliable leaving signal on iOS —
`beforeunload` and `unload` do not fire when an installed PWA is swiped away,
and this game installs to exactly that. That flush carries "the player quit
here", which is the most valuable event in the set.

Idempotency: a client-minted `event_id` per event, **kept across re-queues** —
that persistence *is* the dedupe. The column is nullable with a **full** (not
partial) unique index, because id-less rows from older clients must insert
forever and a partial index cannot be inferred as a conflict target.

On the first 400 while sending ids, the client flips to a session-scoped legacy
mode that **re-queues and strips ids** — a client ahead of its migration must
*delay* events, never lose them.

#### ⚠ The dedupe is in the TRIGGER, and the wire is a PLAIN INSERT

This is the one that cost a live bug, on 2026-07-31, exactly as it did on the
sister project.

The obvious idempotent wire shape — `?on_conflict=event_id` +
`Prefer: resolution=ignore-duplicates` — **cannot work on this table, ever.**
`ON CONFLICT` makes Postgres require SELECT rights on the target, so the
rewriter folds the table's SELECT policies in as an extra `WITH CHECK` on the
new row. There are none, deliberately and permanently, so that check is a
constant false and every batch comes back `42501` → **401**.

Measured against production:

| wire shape | result |
|---|---|
| plain insert | `201` |
| `on_conflict` + `ignore-duplicates`, **new** id | `42501 new row violates row-level security policy` → 401 |
| `on_conflict` + `ignore-duplicates`, **existing** id | `201` |

Three things make this nasty:

1. **The error names no policy.** That absence is the tell.
2. **No SELECT policy can fix it.** The check runs against the *new* row, so it
   would have to be `using (true)` — publishing the whole behavioural log, the
   one thing this design exists to prevent.
3. **It succeeds on a retry and fails on new data**, because `ON CONFLICT DO
   NOTHING` that actually conflicts inserts no row, so the folded check never
   evaluates. A probe that reuses an id reports a false pass — which is how the
   first version of the verify script scored it green.

And the client swallowed it: `flush()` re-queues 5xx and 400 and **drops every
other 4xx**, so a 401 meant every batch was discarded in silence.

The fix, and Viva Maya's before it: **dedupe inside the guard trigger** (it
returns `null` for a seen `event_id`), and send a plain insert. That also
catches plain inserts from any older cached bundle. Verified live: the same
`event_id` sent twice → `201`, `201`, **one row stored**.

### Reads go through one admin-gated RPC returning aggregates only

`primos_admin_analytics(p_days)` is `SECURITY DEFINER`, checks `auth.uid()`
against `primos_app_admins` (RLS on, **zero policies**, writable only from the
SQL editor), and also admits the `service_role` JWT so a server-side job reports
the same numbers.

Everything it touches is hostile: `jsonb_typeof` before every cast,
`round(x::numeric)::int` so a forged `21.5` cannot error the whole payload,
length-capped strings, a LIMIT on every grouped list, `p_days` clamped to
1–365. Buckets are **explicit UTC**, matching `js/raceday.js` `dayKey()`, so the
boards, the save's day map and this dashboard can never disagree about a day.

It refuses with errcode **`42501`** specifically, so the dashboard can tell "you
are not an admin" from "this is broken" — they need completely different screens.

### Honest denominators

- **A rate with a zero denominator is `null`, rendered "—", never 0%.** "0% of
  players bought something" and "nobody has opened the shop yet" are different
  sentences, and only one is a reason to change the game.
- **D1/D7 count only devices whose day0+N has fully elapsed.** Folding in
  yesterday's cohort drags every retention number toward zero, and does it worse
  the more new players arrive — exactly backwards.
- **Funnel denominators are distinct-device counts.** A rate over event counts
  measures enthusiasm, not conversion.
- Silent days are **zero-filled**. A chart that skips them draws a smooth line
  straight through an outage. The silence is the signal.

### The vocabulary is pinned

`EVENTS` in `js/analytics.js` is the one source event names come from. A funnel
step built on a misspelled name renders as a permanently-zero step, which looks
exactly like real data — and there is no compile step here to catch it.

`dev/cloud-test.html` asserts every name the SQL filters on against `EVENTS`,
and that every name survives the guard's normalisation. **Do not delete that
block.**

---

## What is collected

| event | when | props |
|---|---|---|
| `app_open` | once per open | standalone, lang, signed_in |
| `run_start` | RUN pressed | loadout size, shelf item ids |
| `run_end` | the run is written down | score, distance, seconds, beers, tacos, continues, reason, pb, racha, jalesDone, drones |
| `tutorial_start` / `_done` / `_skip` | the escuela | step reached, total steps |
| `shop_open` / `_buy` / `_denied` | La Tiendita | balance, item, price, how short |
| `continue_offer` / `_take` / `_decline` | the bust | rung `n`, cost, could they afford it |
| `primo_open` / `_set` | the picker | **how** they set it — never which Primo |
| `sign_in_start` / `_done` | ACCOUNT | — |
| `board_open`, `invite_share` | — | — |
| `gear_equip` | el fit worn or taken off | item (or `none`), slot |
| `mission_done` | a jale completes | mission id, day |
| `client_error` | a crash | message, source basename, first stack frames |

**The retention pair rides `run_end`.** `racha` (streak length after this run)
and `jalesDone` (how many of today's three are finished) travel on every
`run_end`, so "do dailies keep people running" is answerable from one event.
`mission_done` exists separately because it names *which* jales players actually
finish — the pool needs pruning evidence, not vibes. The DB guard normalises
but does not whitelist names, so these needed **no migration**; the dashboard
picks them up in the by-name counts panel.

**`run_end` fires once per run, not once per bust** — it sits in
`fillGameOver()`, not `game.end()`, because a bust the player pays their way out
of is one run, not two. Same reasoning that decides where the chelas are banked.

**A token number is never sent.** It is a wallet fingerprint on a public chain,
and `primo_set` only records *how* the Primo was chosen — `number` if it was
typed into the menu panel, `browse` if it was picked out of the grid — which is
the only question worth asking. (It read `number / url / file` until the
paste-a-URL box and the file picker were removed; a save written before that can
still hold a URL, but nothing writes one any more, so neither value can appear
in new events.)

**Crash telemetry is capped twice** — 5 per session *and* one per distinct
message — because the thing producing errors here is a render frame, and an
error loop at 60Hz would bury every real signal. The dashboard splits errors by
`app_version`; that column is what turns "something broke" into "*this deploy*
broke it".

---

## The opt-out

ACCOUNT → **Gameplay stats**, a checkbox. Checked = on. Opting out also **drops
whatever is queued** — leaving it to flush later would mean the toggle lied
about the moment it was flipped.

It is in ACCOUNT next to the other decisions about what leaves the device (the
race name, the cloud save) because a privacy control the player cannot find is
not a control. The label is a whole-row tap target for the same reason.

---

## The dashboard

<https://corrupt.solutions/games/primos/stats.html>

It holds **nothing secret** — the same publishable key the game ships, plus the
owner's own Google session. The *server* decides what it may see. A stranger who
finds the URL gets a sign-in button and a 403.

Same origin as the game **on purpose**: the auth session is already there, under
the same storage key, so signing in here is the same act as signing in to the
game.

Consequences that are easy to undo by accident:

- **`sw.js` must not precache it,** and must not answer its URL at all. Without
  the skip in the fetch handler, an offline `/stats.html` gets
  `cache.match("./")` — i.e. the *game* — which looks exactly like the dashboard
  being broken. Players must never download the owner's tool.
- **`<meta name="robots" content="noindex">`** — harmless if found, no reason to
  advertise.
- **Every client-originated string reaches the DOM via `textContent`.** This page
  is authenticated as the owner, so `innerHTML` on a player-written string is
  stored XSS aimed squarely at the one session that can read the whole log.
  (Verified: an `<img src=x onerror=…>` event name renders as inert text.)
- The payload is coerced **field by field with defaults**, so a server that
  predates a panel degrades to an empty panel rather than showing nothing.

### Getting in

Sign in, get refused, and the page prints the exact insert with your user id
already in it. Run it in the SQL editor:

```sql
insert into public.primos_app_admins (user_id, note)
values ('<your-uuid>', 'owner');
```

That only helps someone who can already open the SQL editor — i.e. the owner —
and it beats making them hunt for their own UUID.

### Iterating on the layout

Every panel is behind two human-only doors, so `stats.html` exposes
`window.__renderStats(payload)` — same shape the RPC returns, rendered without a
database. In the console:

```js
__renderStats({ totals: { devices: 42 }, daily: [{ day: '2026-07-31', devices: 9 }] })
```

Reads nothing, sends nothing, inert on the game's own pages.

⚠ `stats.html` does **not** cache-bust its imports and `python3 -m http.server`
answers with `Last-Modified`, so a browser will happily show you the previous
build. Re-import with a query string when iterating:
`await import('/js/stats/main.js?v=' + Date.now())`.

---

## Rolling it out

**Status: the migration is APPLIED to production** (2026-07-31), verified by
probe — `verify-rls.sh` reports 20 passed / 0 failed, `primos_events` is empty
and accepting inserts, and the table is waiting on a client deploy.

### ⚠ `supabase db push` does not work from this repo, and fails SILENTLY

`version` is the primary key of `supabase_migrations.schema_migrations`, and
that table is **per-project, not per-game**. The remote history already holds
versions `0001`–`0022` — Viva Maya's twenty plus Turbo Maze's — so Primos'
`0001`/`0002`/`0003` collide with theirs by pure numeric coincidence.

`db push` computes "pending" as local versions absent from the remote history.
With this migration numbered `0003` it saw `0003` already present, **applied
nothing, and reported success.** That is why this file is timestamped and its
siblings are not.

Timestamping it makes the version unique, at which point `db push` refuses for a
second and permanent reason: *"Remote migration versions not found in local
migrations directory"* — remote has `0003`–`0022`, this repo never will.

> **Do NOT run the repair the CLI suggests.**
> `supabase migration repair --status reverted 0003 … 0022` would mark **Viva
> Maya's and Turbo Maze's** migrations reverted in the shared history, and their
> next `db push` would try to re-apply twenty migrations. `supabase db pull`
> would likewise drag all three games' schema into this repo. Both are wrong.

The working path is `supabase db query`, which goes through the Management API —
the SQL editor by another name, which is what this repo's "applied by hand" has
always meant:

```bash
supabase link --project-ref deskabqqxqqibxjffwmb
supabase db query --linked -f supabase/migrations/20260731120000_primos_analytics.sql
```

**Nothing is recorded in `schema_migrations`, on purpose.** Inserting a row there
would make the *other* games' `db push` complain about a version they do not have
locally — trading this repo's problem for theirs.

### The steps

1. **Apply the migration** as above. Schema first — the client tolerates a server
   without it (the 400 fallback), but not the other way round.
2. **Run the audit** and read the output:

   ```bash
   scripts/verify-rls.sh https://deskabqqxqqibxjffwmb.supabase.co <publishable-key>
   ```

   The probe that matters most is `anonymous INSERT accepted` — **analytics that
   cannot be written by an anonymous visitor is analytics that is dead**, and
   that failure is invisible from the client, which swallows everything. The
   duplicate-`event_id` probe reports **inconclusive** on purpose: proving the
   dedupe needs a row count, and this table correctly refuses reads. Confirm it
   in the SQL editor.
3. **Seed `primos_app_admins`** (above), or the dashboard 403s everyone.
4. **Bump `CACHE_VERSION` in `sw.js` AND `APP_VERSION` in `js/version.js`**, in
   the same commit, and deploy. If they drift, `sw.js` is what players feel and
   `version.js` is what the dashboard reports — so a drift means errors are
   attributed to the wrong build, which is precisely the panel reached for when
   something has just broken.

## Ops — not yet built

Two things from the skill are deliberately **not** here yet, and the stack works
without them:

- **Pruning is not scheduled.** `primos_prune_events(keep_days)` exists and is
  granted to `service_role` only. A migration that silently starts deleting
  production rows on a timer is a bad surprise; a visible job is the right home:

  ```sql
  select cron.schedule('primos-prune-events','0 4 * * *',
                       $$select public.primos_prune_events(90)$$);
  ```

- **There is no weekly digest.** The sister project posts one to a pinned issue
  from CI, built by calling **the same RPC the dashboard renders** — never a
  second aggregation, which would drift and then neither would be trusted. This
  repo has no CI job holding a service key yet, so the dashboard is the only read
  path. A dashboard nobody opens is decoration; if this stops being opened, build
  the digest.

## Checks

- `dev/cloud-test.html` — the vocabulary pin, rate math with zero denominators,
  shape-tolerant coercion, funnel assembly, bucket/day fills, the axis. **164
  assertions, all passing** as of 2026-07-31.
- `scripts/verify-rls.sh` against production, after applying `0003`.
- The syntax sweep in [BUILD_OVERVIEW.md](BUILD_OVERVIEW.md#checks) now covers
  `js/stats/*.js` too.
