---
name: cloud-saves-and-leaderboards
description: >-
  Add player accounts, cross-device cloud save, device backup/restore, and public leaderboards to a
  game or app — OAuth sign-in, a per-user save row, partitioned score boards with server-side
  anti-cheat guards, a display-name picker that can never leak an email, and the sign-in UI that
  fronts all of it. Use whenever the user wants progress to survive a cleared browser or follow them
  to a new phone, or wants players ranked against each other: "cloud save", "sign in", "log in",
  "user accounts", "back up my progress", "sync across devices", "leaderboard", "high score table",
  "daily/weekly board", "ranks", "who's winning" — even if they don't name the mechanism. Also use
  when reviewing or extending an existing saves table, score table, or sign-in modal so the
  hard-won rules below aren't re-broken. Assumes a Postgres-backed API in the shape of
  Supabase/PostgREST (RLS + auto REST + OAuth), a JS/TS client, and works with or without a build
  step — including a static site with no server of its own.
---

# Cloud saves and leaderboards

A five-layer account stack, distilled from a shipped implementation (Viva Maya: PWA game, Supabase
backend, GitHub Pages hosting, solo owner). Every rule here earned its place by breaking first — the
scars are cited inline so you can tell a real constraint from a preference. Build the layers in
order; each is independently shippable and each degrades to "the game still plays" on its own.

```
1. IDENTITY   OAuth sign-in + session mirror, dormant until configured   (references/client.md §identity)
2. SAVE SYNC  one row per user, pull → merge → persist → push            (references/client.md §sync)
3. BOARDS     partitioned score table + guard trigger + derived view     (references/schema.sql)
4. NAMES      chosen handle, anonymous fallback, retroactive rename      (references/names.md)
5. UI         sign-in / backup modal + board panel                       (references/ui.md)
6. ROLLOUT    OAuth config, migration order, live RLS audit              (references/rollout.md)
```

Adapt table and key names to the project; the invariants below are the skill. When the project
already has some layers, audit them against the invariants instead of rebuilding.

## The invariants (why each exists)

**DORMANT UNTIL CONFIGURED, and nothing here may ever throw into the game loop.**
With no backend URL/key present, every export no-ops and the app runs exactly as it did before —
local storage only. Every network call sits inside `try/catch` that swallows and re-queues; a
leaderboard is a nice-to-have and a save is not worth a crash. This is what lets you build and merge
the whole stack before a backend project even exists, and what keeps an offline player playing.

**LOCAL STORAGE STAYS AUTHORITATIVE. The cloud is a mirror, never the source of truth.**
Boot does: pull the cloud row → merge with local → persist the winner locally → push it back, so both
ends converge. Thereafter every local persist debounce-pushes. Losing the network loses freshness and
nothing else. Inverting this — treating the server as truth and the device as cache — means every
network blip is a progress loss, and offline play stops being possible at all.

**A merge returns a WHOLE record, never a field-wise Frankenstein.**
Compare the two saves lexicographically on a progress vector (`[unlocked, best, stars, currency]`)
and keep the winner entire. Merging field-by-field invents a save state the player never had — max
level from one device, currency from the other — which is both a duplication exploit and impossible
to reason about. A dead tie prefers LOCAL (pass local first), so an identical cloud never clobbers.

**...except the fields that aren't magnitudes.** Two exceptions, and they are the whole reason merge
is subtle:
- *Recency fields* (the chosen display name) travel by their own timestamp, not with the progress
  winner. Rename yourself on the phone, then open a tablet that happens to be further along, and a
  naive merge silently restores the old name — and republishes it to the boards.
- *Monotonic latches* (one-time unlocks, "has claimed X") UNION rather than pick a side. They are
  facts that happened, not values in competition.

**Boot is BOUNDED.** Reconcile inside a `Promise.race` against a timeout (~3s). A slow or captive
network must never stall first paint. The push still stands behind it.

**Identity is OAuth, not an email code.** Supabase's built-in email sender is throttled to ~2/hour
and is explicitly testing-only, so an email-code flow that tests fine will fail the day real players
arrive. Google is one tap for a non-technical player.

**OAuth returns by FULL-PAGE REDIRECT — there is no verify callback to hang reconciliation on.**
An email-code flow reconciles inside `verifyOtp()`; OAuth has no such moment. So the null→session
transition itself must trigger the pull-merge-persist, and it must run BEFORE any local persist can
mirror a fresh default save over the player's real cloud progress. Get this wrong and signing in on a
new device *erases* the account it just restored.

**`SIGNED_IN` is not the same as "we now have a session".** A returning player's boot restore is also
a null→session transition — delivered as `INITIAL_SESSION`. Gating sign-in funnel analytics on the
transition instead of the event logged a completed sign-in on *every app open*: 242 completions
against 13 starts, which is how it was caught. Reconcile on the transition; count only on `SIGNED_IN`.

**NOTHING DERIVED FROM THE EMAIL MAY EVER REACH A PUBLIC BOARD.**
The email local-part of a Google account is very often a real name (`jane.doe`), so an
email-local-part fallback publishes real names for every player who never found the name picker —
this shipped, and a player reported it. The public name is the chosen handle, else an anonymous name
derived from the user id (already on every row, so it discloses nothing new). Exactly ONE function
decides what becomes public, and the session's email must be unreachable from inside it — the
invariant holds by construction, not by discipline.

**Fixing the client is NOT enough — the server must refuse it too.** Two reasons, both permanent:
stale PWA clients keep submitting the old name for as long as it takes them to accept an update (a
green deploy is not "players are on it"), and rows already published never rewrite themselves. So the
substitution belongs in the guard trigger, plus a one-time backfill. See `references/names.md`.

**The SERVER decides which board a score belongs to, not the submitter's clock.**
The partition key (day/week) is validated against server time in the guard trigger. Without it, a
device clock set forward opens tomorrow's board early — play it unhurried, arrive on the day with a
score nobody had time to chase — and a clock set back re-opens a board whose layout is already known.
It also closes the quiet one: backfilling a CLOSED board whose winner was already crowned, which
needs no tampering at all, just a client that synced late. Allow ~1h of grace so an honest run that
starts before midnight and syncs after it still counts.

**Scores are MONOTONIC per (user, partition), and the tiebreak clock moves only on a genuine rise.**
A stale or duplicate submit can never lower a better run. And `scored_at` must not advance on an
update that merely changes the display name, or a cosmetic rename silently forfeits the
"first to reach it wins the tie" rule the player already earned.

**A rename must reach EVERY row the player owns, on every board, past partitions included** — that is
the entire promise of a name picker, and a name left on an all-time ladder (which never rolls over)
defeats it completely. This has a trap: if the guard trigger validates the partition key on *every*
write, a rename touching a past day raises and is silently swallowed, so scrubbing history never
worked. Skip the partition check when the score is unchanged. See `references/names.md`.

**Derived boards are VIEWS, not second tables.** A stored weekly total is a denormalised copy kept in
step by yet another trigger, and the first time the two disagree the leaderboard lies. Summing the
component rows makes the total *by construction* the sum of the scores that produced it. Any view
over an RLS'd table needs `security_invoker = on`, or it runs with the owner's rights and becomes a
way around the policies it sits on top of.

**Reads are public, writes are owner-only, and only shareable fields live on the board table.**
User id, display name, partition key, score. Nothing else. A leaderboard row is world-readable by
design, so the table must contain nothing you would not print on a billboard.

**Submission piggybacks the save push.** After a successful save upsert, mirror the boards
fire-and-forget. No new traffic path, no per-frame cost, and a board failure can never block or fail
a save. Memo the last-sent `(partition, score)` to skip redundant upserts.

**The debounce that is right for gameplay is WRONG for a deliberate one-off act.** A level win writes
the save several times a second and one upsert should carry them all — hence ~1.5s. But "set my name,
then close the browser" fits inside that window and strands the name on one device. Deliberate acts
need a flush-now path *in addition to* the debounce, never instead of it.

**Own-rank outside the top N is a COMPOSITE comparison.** If the board ranks on `(total, days, time)`,
computing your rank with a single `.gt('total')` reports every tied player as joint-first — exactly
the pile-up the tiebreak exists to prevent. Count "strictly ahead on key 1" plus "level on key 1 and
ahead on key 2", then add one.

**The account is not the only backup — ALWAYS ship device backup/restore too.** A copyable code and a
downloadable file, working with no account at all. The file is the strongest durability available
without sign-in: it survives clearing site data, which is the exact event that loses everything else.
It also gives the "cloud isn't set up on this build" state something real to offer.

**Self-check the migration against the client.** If the server's idea of "which day is it" drifts
from the client's, the database rejects every honest score and the board silently goes empty; if a
rollup's week function drifts, the boards keep working while ranking the wrong seven days — which is
worse, because nothing *looks* broken. Assert the shared cases inside the migration and make it
refuse to apply on drift. Pin the timezone explicitly and test it under a hostile session `TimeZone`.

## Build order

1. **Schema first** (`references/schema.sql`) — `saves`, the board table + guard, the rollup view.
   Apply it, then run the RLS audit (`references/rollout.md`) against the live API before any client
   ships. Deny-by-default means an empty result is ambiguous between "RLS refused you" and "the table
   isn't there" — pair every "must be empty" assertion with a control probe.
2. **Client sync** (`references/client.md`) — the dormant gate, the lazy client singleton, session
   mirror, pull/merge/push, export/import.
3. **Boards** (`references/client.md` §boards) — submit on the save-push beat, fetch top-N + own rank.
4. **Names** (`references/names.md`) — the picker, the anonymous fallback, the handle bridge through
   the save, retroactive rename.
5. **UI** (`references/ui.md`) — the modal (renders by auth state, always offers backup) and the
   board panel.

## Applying this to a new project

The layers are the same; three things change per project.

**How the backend client loads.** With a bundler, dynamic-`import()` it so it lands in its own async
chunk and an unconfigured build never ships it. With no build step, load it from a CDN inside the
same dynamic import — the dormant gate means an offline or unconfigured player never makes the
request. Keep it out of any service-worker precache list: it must be *absent*, not *stale*.

**Where the publishable config lives.** Bundled: `import.meta.env.VITE_*`. No build step: a small
checked-in config module. The URL and anon/publishable key are designed to be public — RLS is what
protects the data, so shipping them is correct and putting them in a build secret is cargo cult.
Secret/service-role keys are the opposite and belong nowhere near the client.

**What the boards rank on.** Pick the partition from the game's natural rhythm — an endless runner
wants a daily board with a weekly rollup (a missed day is a zero you cannot make back with one big
run, so turning up *is* the strategy); a campaign wants an all-time ladder ranked on
`(furthest, mastery)`. The schema shape is identical either way: `(user_id, partition_key)` primary
key, guard trigger, one index matching the board's exact ORDER BY.

Keep the client's ORDER BY byte-identical to the index definition, or the index quietly stops being
used and the board degrades to a full scan as the table grows.
