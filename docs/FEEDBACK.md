# Feedback — the suggestion box

Corrupt's face on the HELP sheet, the form it opens, and the panel where the
owner reads what came in.

| piece | file |
|---|---|
| the way in | `index.html` `#screen-help` → `#btn-feedback-open` |
| the form | `index.html` `#screen-feedback`, wired in `js/main.js` |
| the client pipe | `js/feedback.js` |
| the strings | `js/i18n.js`, keys `fb.*` |
| the server | `supabase/migrations/20260731190000_primos_feedback.sql` |
| the read path | `stats.html` "What players wrote" + `js/stats/feedback.js` |
| the audit | `scripts/verify-rls.sh` |

Built to the **`player-feedback` skill** (`.claude/skills/player-feedback/`),
which is the portable version of this stack for the other Corrupt games.

## Why it exists

`docs/ANALYTICS.md` describes a pipe that can answer *where do runs end* and
*does the tutorial work*. It cannot answer either of these:

> the slide doesn't register on my phone when I swipe fast

> let me replay the tutorial

Those arrive as sentences or they do not arrive. Before this the only channel
was a player who cared enough to go and find a Twitter account, which selects
for the most motivated one per thousand — and a glitch nobody can report is a
glitch that gets reported by everybody quietly leaving.

It is on **HELP** rather than in ACCOUNT because HELP is where a player already
is when the game has just confused them. *I don't understand this* and *this is
broken* are one tap apart, and ACCOUNT is a screen you go to on purpose, which
is not the state someone is in when the slide just failed them.

## The shape

```
  HELP sheet  ──tap Corrupt──▶  #screen-feedback  ──SEND──▶  primos_feedback
      ▲                               │                           │
      └───────────BACK────────────────┘                    (no select policy)
                                                                  │
                                            primos_admin_feedback() ── stats.html
```

The run stays paused the whole time. Opening the box touches no game state, the
same way HELP does not — a bug report must never cost the run that produced it,
and the reports worth having are exactly the ones written mid-run.

## The invariants

### Append-only to every client. An INSERT policy and NO SELECT POLICY, ever

Identical to `primos_events`, and the reason is stronger here. This is the only
table in the project where a player can write **a sentence about themselves**,
and some of them will put an email address in the message body whether or not
they use the contact field. A readable feedback table is a worse day than a
readable leaderboard.

The migration ends with a self-check that refuses to apply if a SELECT policy
exists. `scripts/verify-rls.sh` asserts the same thing against a live API,
because a migration proving itself locally is not the statement "production is
safe".

Corollary, and it is the same trap `js/analytics.js` shipped broken once:
`Prefer: return=minimal` on the insert is **correctness**, not a size
optimisation. Ask PostgREST to return the inserted row and it tries to read a
row it is not allowed to read, and the whole write fails.

### Reads return RAW ROWS — the one place this departs from analytics

`primos_admin_analytics()` returns aggregates only and never raw rows. The
feedback RPC returns the messages themselves, because an aggregate of a
suggestion box tells you how many people wrote in and nothing about what they
said. That is precisely why the table underneath must never be readable: the
sentence is the thing being protected, and there is exactly one door to it.

### The guard THROWS where the analytics guard degrades

`primos_events_guard()` may never raise: its error would surface inside a fetch
sitting next to the game loop, and a lost metric is cheaper than a lost run.

`primos_feedback_guard()` is called from a button the player pressed on purpose
and is **watching a status line for**. Silently dropping a report after telling
someone it was sent is the worse failure here, so an unsendable row raises and
`js/feedback.js` renders it as a sentence.

It uses PostgREST's `PTxyz` SQLSTATE convention to choose the HTTP status
(`PT429` → 429, `PT400` → 400). The client reads the **status code**, never the
body — if that mapping ever goes away the player gets the generic wording
instead of the specific one, which is a wording regression and not a broken box.

### It is rate limited IN THE DATABASE

Five per device per hour, twenty per day, counted in the guard.

Every other write path in this project is bounded by what an honest client would
send. A free-text box on a public origin with a publishable key is not: it is an
open POST endpoint that accepts prose, which is a spam target, and the only
place a limit cannot be bypassed by not being the client is the database.

The client half (`HOUR_LIMIT` / `DAY_LIMIT` in `js/feedback.js`) is a **paired
copy and a courtesy** — it exists so somebody who has already said their piece
is told so before typing another paragraph rather than after a round trip that
reads like the message failed. If the two ever drift, the client's number must
be the smaller one, or it promises a send the server will refuse.

The client ledger records **successful** sends only. A retry the server deduped
never happened as far as the limit is concerned, which keeps the local count at
or below the server's and means the two can only disagree in the safe direction.

### Dedupe on `feedback_id`, in the trigger

Same shape as `primos_events.event_id`: nullable column, **full** (not partial)
unique index, and the dedupe lives in the trigger so a plain insert dedupes too.

Here it buys something specific: the SEND button is safe to press twice on a
flaky connection, which is exactly when a player presses it twice. The guard
drops the second arrival and answers 201, so they get one row and one "sent".

**Dedupe runs BEFORE the rate limit**, deliberately. A retry of a report that
already landed must not be counted against the person retrying it — otherwise a
bad connection spends someone's whole hourly allowance on one message and the
report they actually wanted to send is the one that gets refused.

### The contact field is never prefilled from the account

Same rule as the race name in `js/leaderboard.js`, same reason. An address the
player did not type is an address they did not agree to hand over. A field that
fills itself in from the session looks like a convenience right up until someone
notices their email was attached to a message they thought was anonymous.

On the dashboard it renders as **plain text, not a `mailto:` link** — building
an `href` out of a player-typed string is how a `javascript:` URI ends up one
click away in the owner's own session.

### The message never enters the event log

`FEEDBACK_OPEN` and `FEEDBACK_SEND` are tracked, and neither carries the text.
`feedback_send` records the message's **length**, not its content.

The two tables have different retention, different exposure and one of them has
no select policy. Putting the sentence in a prop would quietly copy the one
thing that split exists to keep in a single place.

The pair still earns its keep: it answers a question the pile of messages cannot
— how many people opened the box and then did *not* write. A box nobody finds
and a box everybody abandons need opposite fixes and look identical from the
inbox.

### `stats.html` renders every player string through `textContent`

The XSS rule from `js/stats/main.js`, and this is the panel where it stops being
theoretical. Everywhere else on that page the client strings are event names and
error messages. Here the entire payload is free text a stranger typed into a
box, rendered inside a session authenticated as the owner — the one session that
can read every message anyone has ever written.

There is no `innerHTML` in `js/stats/feedback.js` and there must never be one.
`white-space: pre-wrap` is what preserves the player's own line breaks, without
a single tag ever being built out of their string. The caps in
`coerceFeedback()` are a second line of defence against a layout blow-up, not
the XSS defence, and must never be mistaken for it.

## Triage, and why `status` is not decoration

A suggestion box you cannot mark as read shows you the same thirty messages on
every visit. There is no way to tell which are new, so by the third visit you
stop opening it, and the whole stack becomes a table nobody reads.

`primos_admin_feedback_status()` is the only way a row's status ever moves.
`new` → `triaged` → `done`, plus `spam`. The guard forces `new` on insert and
nulls `admin_note`, so no client can file a report pre-marked done and out of
the queue.

The dashboard **refetches after every status change** rather than patching the
card in place: the tiles above the list are counts over the same rows, and a
card that says "done" next to an unread count that did not move is a dashboard
nobody trusts twice.

### The FEEDBACK panel does not follow the 7/14/30/90 range buttons

It reads a **year**, always.

Those windows are right for a rate — a conversion over 90 days is a different
and less useful number than one over 14. They are wrong for a queue. A report
that went unread for three weeks would drop out of a 14-day window along with
the "Unread" count that was the only thing still pointing at it, and the panel
would say *all caught up* because the evidence expired.

For the same reason `primos_prune_feedback()` **never prunes a row still marked
`new`**, and its default keeps a year rather than the event log's 90 days. An
event is a data point; a report is somebody's sentence, and "we shipped the
thing you asked for" is worth being able to say a year later.

## What is collected

On every report:

| field | what it is |
|---|---|
| `message` | what they typed, ≤1000 chars |
| `kind` | `bug` \| `idea` \| `other` |
| `contact` | optional, **player-typed**, ≤80 chars |
| `device_id` | the anonymous localStorage UUID from `js/analytics.js` |
| `user_id` | only while signed in; RLS pins it to `auth.uid()` |
| `context` | screen, score, best, runs, beers, Primo, viewport, dpr, standalone |
| `app_version`, `lang` | which build and which language |

`context` is what turns "the slide doesn't work" into something actionable, and
the player will not type any of it. `primo` is in there because half the art
bugs in this game are one specific token's traits. `view` and `dpr` are the
other half of most "it only happens on my phone" reports.

**`device_id` is not gated on the analytics opt-out**, and the UI says so
plainly in `fb.privacy`. Analytics respects the toggle by not calling `track()`
at all. Feedback is a message the player typed and pressed send on, and it needs
an id to be rate-limited by and to group repeat reports under; an opted-out
player has no event log for it to join to, so the id links their report to
nothing. On the dashboard only the **first 8 characters** are shown — enough to
see that three reports came from one person, useless for anything else, and it
keeps a full id off a screen that gets screenshotted.

## Dormant until configured

With `js/cloud-config.js` empty, `isFeedbackConfigured()` is false, `js/main.js`
never unhides the Corrupt row, and the sheet is unreachable. That is deliberate:
on a build with no backend there is nobody on the other end, and a form that
silently goes nowhere is worse than no form at all.

The same reasoning is why the FEEDBACK panel on `stats.html` renders its own
error in its own box instead of taking the page down. The client half of this
feature ships in the same commit as the migration, but **the migration is
applied by hand and afterwards** — so between merging and applying, the RPC does
not exist, and that must cost one panel rather than the whole dashboard.

## Rolling it out

1. Apply the migration by hand. `supabase db push` does not work from this repo
   and its first failure mode is silence — see `docs/ANALYTICS.md` §*`supabase
   db push` does not work*, which explains the shared `schema_migrations` and
   why anything new must be numbered by timestamp.

   ```bash
   supabase db query --linked -f supabase/migrations/20260731190000_primos_feedback.sql
   ```

2. Seed `primos_app_admins` with the owner's user id if the analytics migration
   has not already done it. Sign in to `stats.html`; the not-an-admin screen
   prints the exact `insert` with the id already in it.

3. Audit it live:

   ```bash
   scripts/verify-rls.sh https://<project>.supabase.co <publishable-key>
   ```

   ⚠ The rate-limit probe **writes five rows** to prove the limit is real. They
   land in the box marked `new`, so clear them afterwards:

   ```sql
   delete from public.primos_feedback where app_version = 'verify';
   ```

4. Bump `CACHE_VERSION` in `sw.js` and `APP_VERSION` in `js/version.js`
   together, and deploy.

## Checks

`dev/cloud-test.html` asserts the pure half — the four bounds against their
copies in the guard, the sanitisers (including that control characters are
stripped before a player's string reaches a page authenticated as the owner),
and that `coerceFeedback` degrades rather than throwing on a server that
predates the panel.

The rate limit and the exposure rules are asserted by `scripts/verify-rls.sh`
against a live API, which is the only place either of them is real.
