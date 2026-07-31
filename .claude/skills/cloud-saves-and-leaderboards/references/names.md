# Names — the privacy invariant and the handle bridge

This layer is short and it is the one that shipped a real privacy bug. Read the whole file before
changing anything that decides what a board displays.

## What went wrong

Every board row carries a self-reported `display_name`. The original fallback for a player who had
never opened the name picker was the **email local-part**. For a Google account that is very often a
real name — `jane.doe` — so every player who hadn't found the picker was publishing one to a
world-readable table. A player reported it: he was re-entering his name repeatedly and watching his
email name come back whenever he didn't.

Two separate defects, and fixing either alone leaves the bug live:

1. the client's fallback published the email name;
2. **renaming could not reach history**, so even a player who *did* set a name left the old one on
   every past board (see "the rename trap" below).

## The rule

> Nothing derived from the account's email may ever reach a public board.

Enforced in three places, because each covers a hole the others can't:

**Client — one function decides.** `preferredName()` returns the chosen handle, else
`anonName(userId)`. The session's email is not referenced anywhere inside it. That is deliberate:
making the email *unreachable* from the only function that produces a public name means the invariant
holds by construction rather than by everyone remembering it.

```js
export function anonName(userId) {
  const hex = (userId ?? '').replace(/-/g, '').slice(0, 4).toUpperCase()
  return /^[0-9A-F]{4}$/.test(hex) ? `Player ${hex}` : 'player'
}
export function preferredName() { return getHandle() ?? anonName(cloudSession()?.userId) }
```

The anonymous name is derived from the user id, which is **already on every board row**, so it
discloses nothing that reading the board didn't. Four hex digits keep boards legible — twenty rows
of "player" tells a reader nothing.

**Server — refuses it anyway.** The client fix is not enough and never will be:

- *Stale clients.* A PWA on `registerType: 'prompt'` keeps players on a cached bundle until they
  accept an update. Every un-updated device keeps submitting its email name for as long as that
  takes. **A green deploy is not "players are on it."**
- *History.* Rows already published keep their name until their owner next submits — and for a
  closed day that is never.

So `public_display_name()` (in `schema.sql`) compares the submitted name against that account's own
email local-part and substitutes the anonymous name on a match. It is exact, not a heuristic: it
reads `auth.users` for the one submitting user, so it needs no guess about what "looks like" an email
name and touches no other account.

**Backfill — once, over existing rows.** Everything already in the table predates both fixes. Run the
same substitution across every board table as the last step of the migration.

`anonName` and `anon_display_name()` **must stay byte-identical.** The server substitutes its copy,
so any drift shows the player one name in the app and the board another. Both `schema.sql`'s
self-check and a client unit test assert the same shared case (`7f3a91b2-…` → `Player 7F3A`); keep
both.

## The handle bridge

The chosen handle is persisted **twice, on purpose**:

- its own localStorage key, for a synchronous read on the submit path;
- and **inside the save**, so it rides cloud sync.

Storage-only was why players had to re-enter their name after clearing a browser or moving to a new
phone: the cloud restored their progress but had never been told their name, so the boards silently
reverted to the default. The save carries `handle` plus `handleSetAt`, and the merge picks the most
recently set one (see the SKILL.md invariant on recency fields).

Three functions close the loop:

```js
setHandle(raw)      // sanitize → write BOTH homes → flush the save now → rename every owned row
adoptHandle(save)   // after a sync: write the merge winner's handle into this device's mirror
reconcileName()     // once per page-load, after sign-in/sync: re-publish the name over owned rows
```

`setHandle` calls the **flush-now** save push rather than the debounced one. "Set my name, then close
the browser" is the exact flow this was reported from, and it fits inside a 1.5s debounce window —
the name would reach the boards (the rename below is immediate) but never the cloud *save*, so the
next device would restore progress without it.

`adoptHandle` deliberately does **not** re-stamp `handleSetAt`. An adopted name would then look
freshly chosen, win every future merge, and the oldest device to sync would start dictating the name.

`sanitizeName` strips at the first `@` before anything else — belt and braces, so even a caller that
hands it an email address cannot publish one:

```js
export function sanitizeName(raw) {
  const base = (raw ?? '').split('@')[0].replace(/[^\p{L}\p{N} _.\-]/gu, '').trim()
  return (base || 'player').slice(0, 24)
}
```

Keep the Unicode property escapes. Stripping to ASCII would mangle the names of a large share of
players, which is its own kind of wrong.

## Retroactive rename — and the trap

A rename UPDATEs `display_name` on **every row the player owns, across every board table**, past
partitions included. That is the entire promise of the picker: a real name can be scrubbed from
history, not just from future submissions. RLS already scopes the UPDATE to the owner's own rows, so
this is safe to fire blind.

```js
async function renameEverywhere() {
  try {
    const s = cloudSession(), c = await client()
    if (!s || !c) return
    const name = preferredName()
    await Promise.all([
      c.from('game_daily_scores').update({ display_name: name }).eq('user_id', s.userId),
      c.from('level_progress').update({ display_name: name }).eq('user_id', s.userId),
      // 👉 add every table that carries display_name. A derived VIEW needs no entry —
      //    renaming its base rows renames it.
    ])
  } catch { /* offline — the next submission still carries the new name */ }
}
```

**The trap.** If the guard trigger validates the partition key on *every* write, a rename touching a
past day raises, the client swallows the rejection, and scrubbing history silently never works — for
months, invisibly, because nothing surfaces. `schema.sql`'s guard skips the partition check when the
score is unchanged, precisely so a rename can reach closed boards. If you write a new board table,
carry that rule into its guard.

The list above must include **frozen/legacy tables** that are no longer written to. Rows a player
left there are exactly the history this feature exists to scrub.

Add a table to `renameEverywhere` the moment it starts carrying `display_name`. There is no way to
detect the omission from the outside: the board just keeps showing an old name to everyone except the
player who asked for it to go.
