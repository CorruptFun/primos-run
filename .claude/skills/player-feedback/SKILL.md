---
name: player-feedback
description: >-
  Add an in-app suggestion box — a character or icon players tap to report a bug, request a feature,
  or say something — with a write-only backend table, a rate limit that lives in the database, and an
  admin-only triage queue for reading and marking reports. Use whenever the user wants to hear from
  the people using their thing: "feedback", "suggestion box", "report a bug", "bug report", "contact
  us", "let players tell me", "feature requests", "complaints", "send me a message", "a button they
  can click to tell me things", "glitch report", "support form" — even if they don't name the
  mechanism. Also use when reviewing or extending an existing feedback form, contact form, or report
  button so the exposure and spam rules below aren't re-broken. Assumes a Postgres-backed API in the
  shape of Supabase/PostgREST (RLS + auto REST), a JS/TS client, and works with or without a build
  step — including a static site with no server of its own.
---

# Player feedback

An in-app suggestion box, distilled from a shipped implementation (Primos: Barrio Run — PWA game,
Supabase backend, GitHub Pages hosting, solo owner). Four layers, each independently shippable:

```
1. TABLE     write-only rows + a guard that bounds and rate-limits    (references/schema.sql)
2. CLIENT    dormant-until-configured send path, honest results        (references/client.md)
3. UI        the way in, and the form it opens                         (references/ui.md)
4. TRIAGE    admin-only read RPC + a queue you can mark read           (references/dashboard.md)
```

Adapt table and field names to the project; the invariants below are the skill.

## The one-paragraph version

A feedback box is the cheapest product research there is and the easiest thing to build wrong. The
two failure modes are not symmetrical: a box that **leaks** publishes strangers' sentences about
themselves, and a box **nobody reads** quietly teaches your most engaged players that writing in
does nothing. Almost every rule below is aimed at one of those two.

## The invariants (why each exists)

**WRITE-ONLY TO EVERY CLIENT. An INSERT policy and NO SELECT POLICY, EVER.**
RLS denies what it does not allow, so a visitor holding the publishable key can file a report and
read nothing. This is the single most important line in the schema. A feedback table is the one
place in most apps where a user can write **a sentence about themselves** — some will paste an email
address, a phone number, or an account problem into the message body no matter what the form asks
for. There is no version of "just for debugging" that justifies a select policy here. Make the
migration end with a self-check that refuses to apply if one exists.

**Corollary that WILL bite: `Prefer: return=minimal` on the insert is correctness, not tuning.**
Ask PostgREST to return the inserted row and it reads a row it is not allowed to read, and the whole
write fails. The related trap — `?on_conflict=...&resolution=ignore-duplicates` for idempotency —
is *permanently* unusable on a table with no select policy: `ON CONFLICT` makes Postgres require
SELECT rights, so the rewriter folds the (nonexistent) SELECT policies in as an extra `WITH CHECK`,
which is then a constant false. **The error names no policy — that is the tell.** Worse, it succeeds
on a retry that actually conflicts (no row is inserted, so the check never evaluates), so a probe
that reuses an id reports a false pass. Put the dedupe in the trigger instead.

**The read path returns RAW ROWS, and that is the opposite of an analytics RPC.**
If this codebase also has a first-party analytics stack, its admin RPC returns aggregates only —
copy the gate, not the shape. An aggregate of a suggestion box tells you how many people wrote in
and nothing about what they said. Reading the sentence is the entire point, which is precisely why
the table underneath must be unreadable: exactly one door, admin-gated, `security definer`.

**RATE LIMIT IN THE DATABASE. The client's limit is a courtesy, not a control.**
This is an open POST endpoint on a public origin that accepts prose. Every other write path in a
typical app is bounded by what an honest client would send; this one is not, and anyone can skip the
client limit by not being the client. Count prior rows for the same identity inside the guard and
raise. Something like 5/hour and 20/day per device is generous for a real person and useless for a
script.

Keep a **paired copy in the client** so somebody who has already said their piece is told before
typing another paragraph, rather than after a round trip that reads like the message failed. If the
two drift, the client's number must be the SMALLER one, or it promises a send the server refuses.
Record only **successful** sends in the client's ledger, so it stays at or below the server's count
and the two can only disagree in the safe direction.

**DEDUPE BEFORE RATE-LIMITING, in that order, and it matters.**
Mint an idempotency id per attempt and reuse it across retries; the guard drops a second arrival and
returns success. Run that check FIRST. A retry of a report that already landed must not be counted
against the person retrying it — otherwise one flaky connection spends the whole hourly allowance on
a message that is already stored, and the report they actually wanted to send is the one refused.

Use a nullable column with a **full** unique index, not a partial one: id-less rows from older
clients then insert forever (NULLs never collide), and a partial index would silently disable a
later `on conflict` inference.

**THIS GUARD THROWS, where a telemetry guard degrades.**
If the codebase has an analytics guard, it almost certainly must never raise — its error surfaces
inside a fire-and-forget fetch next to the app's hot path, and a lost metric is cheaper than a
crash. Invert that here. This guard runs behind a button the user pressed on purpose and is
**watching a status line for**. Silently dropping a report after telling someone it was sent is the
worse failure, so refuse loudly and let the client render it as a sentence.

With PostgREST, `PTxyz` SQLSTATEs choose the HTTP status (`PT429` → 429, `PT400` → 400). Read the
**status code** in the client, never the body — if that mapping is ever unavailable the user gets
generic wording instead of specific wording, which is a copy regression and not a broken box.

**Attach the context the user will never type.**
Screen, app version, locale, viewport, device pixel ratio, and whatever "where were they" means in
this app. That is the difference between *the slide doesn't work* and something actionable. Bound it
in the CLIENT, field by field, not in the guard — a guard that replaces an oversized bag with `{}`
loses every field rather than the offending one. Keep the guard as the backstop.

**A contact field is OPTIONAL and NEVER PREFILLED FROM THE ACCOUNT.**
An address the user did not type is an address they did not agree to hand over. A field that fills
itself in from the session reads as a convenience right up until someone notices their email was
attached to a message they believed was anonymous. (If the project has a display-name rule that
forbids deriving public names from emails, this is the same rule wearing a different hat.)

On the admin page render it as **plain text, not a `mailto:` link**. Building an `href` out of a
user-typed string puts a `javascript:` or `data:` URI one click away inside the one session that can
read every message ever written.

**The message must never enter the analytics event log.**
Track *opened the box* and *sent a report* — those answer a question the inbox cannot: how many
people opened it and then did not write. A box nobody finds and a box everybody abandons need
opposite fixes and look identical from the pile of messages. But log the message's **length**, never
its content. Two tables, two retentions, and only one of them is unreadable; a prop carrying the
sentence quietly copies the thing the split exists to contain.

**EVERY user string reaches the admin DOM through `textContent`. No exceptions, no `innerHTML`.**
This page is authenticated as the owner and is the only session that can read the whole box, so a
stored XSS here is aimed at the highest-value target in the system. Use `white-space: pre-wrap` to
preserve the writer's own line breaks without building a single tag from their string. Length caps
in the coercion layer are a defence against layout blow-ups, **not** the XSS defence, and must never
be mistaken for it. Strip control characters client-side on the way in for the same reason.

**A box you cannot mark as read is a box you stop opening.**
This is the failure that kills the whole feature, and it is invisible for the first two weeks. On
visit three the same thirty messages are there, nothing distinguishes new from handled, and the
owner quietly stops looking. So `status` is load-bearing infrastructure, not metadata: `new →
triaged → done`, plus `spam`. The guard forces `new` on insert and nulls any admin note, so no
client can file a report pre-marked done and out of the queue. Exactly one admin RPC moves it.

**Refetch after a status change; do not patch the card in place.**
The counters above the list are aggregates over the same rows. A card that says "done" next to an
unread count that did not move is a dashboard nobody trusts a second time.

**The queue is read over a LONG window, not the analytics date range.**
If the admin page has 7/14/30/90 buttons, do not wire this panel to them. Those windows are right
for a rate; they are wrong for a queue. A report left unread for three weeks would drop out of a
14-day window **along with the unread count that was the only thing still pointing at it**, and the
panel would report "all caught up" because the evidence expired. Read a year. For the same reason,
never prune a row still marked `new`, and keep reports far longer than telemetry — an event is a
data point, a report is somebody's sentence, and *we shipped the thing you asked for* is worth being
able to say a year later.

**DORMANT UNTIL CONFIGURED, and hide the entry point rather than offering a dead form.**
With no backend URL/key present every export no-ops — and the UI must not render the button at all.
A form that silently goes nowhere is worse than no form: it spends the user's goodwill and their
actual bug report at the same time. Same reasoning applies on the admin side: the panel renders its
own error in its own box instead of taking the page down, because the client half ships in the same
commit as the migration while the migration is applied **by hand, afterwards**.

**Never queue a failed send for "later".**
Report the failure and keep what they wrote in the box. A message the user was told had been sent,
delivered silently an hour later from a different screen, is a promise the client cannot keep
honestly — and clearing the textarea on failure loses the report *and* the goodwill, right at the
moment they were about to press the button again. Clear on success only.

## Build order

1. **Schema first** (`references/schema.sql`) — table, insert policy, guard (bound → dedupe →
   rate-limit), admin read RPC, status RPC, prune, self-check. Apply it, then audit the live API:
   an anonymous `select` must return empty **and** you must pair that with a control probe against a
   table that does not exist, or "RLS refused you" is indistinguishable from "the table isn't there".
2. **Client** (`references/client.md`) — dormant gate, pure sanitisers, the send, stable result keys.
3. **UI** (`references/ui.md`) — where the button goes, and the form.
4. **Triage** (`references/dashboard.md`) — the list, the status buttons, the counters.

## Applying this to a new project

**Where the button goes is a product decision, and the default is wrong.**
Most apps bury it in Settings or About. Put it where users already are **when the thing goes wrong**
— on a help screen, next to whatever confused them, at the end of a failed flow. In the shipped
implementation it sits on the HOW TO PLAY sheet, because *I don't understand this* and *this is
broken* are one tap apart, whereas Settings is a screen you visit on purpose and nobody is in that
frame of mind mid-failure.

**Give it a face if the product has one.** A mascot, a character, the founder's photo. A bare
"Feedback" link in a footer reads as a form; a face reads as a person, and people write more to
people. If the product has a voice, the box should speak in it — a support-desk register ("we value
your input") is the fastest way to convince someone nobody is on the other end. Say plainly what you
*do* do ("he reads these") and never promise a reply you will not send.

**Pick the identity you rate-limit by.** Signed-in apps can use the user id. Anything with anonymous
users needs a client-held id — a random UUID in local storage, minted once, not a fingerprint. If
the project already mints one for analytics, **reuse it**: minting a second one costs the ability to
read a report next to what that user actually did, and buys no privacy, because it is one more
anonymous UUID for the same browser. Disclose it in the form. Note that this id is deliberately not
gated on an analytics opt-out — telemetry respects that toggle by not sending events at all, while a
message the user typed and pressed send on needs an identity to be rate-limited by; someone opted
out has no event log for it to join to. Show only a short prefix on the admin page: enough to see
that three reports came from one person, useless for anything else, and it keeps a full id off a
screen that gets screenshotted.

**Kinds are a short, closed list, and the guard buckets rather than rejects.**
Three is usually right (bug / idea / other). Store it as TEXT, not an enum: cached clients keep
sending last month's vocabulary for weeks, and someone telling you something in a category this
build has never heard of is still someone telling you something. Bucket the unknown value and keep
the row.

**If the project shares a database with other apps, PREFIX EVERY OBJECT.** `feedback`,
`feedback_guard()` and `admin_feedback()` are exactly the names a sibling project would also reach
for, and a collision does not announce itself: `create table if not exists` finds the other app's
table and **quietly does nothing** (after which you read and write their data), while
`create or replace function` on a matching signature **silently replaces theirs**. Check the
migration-history table too — it is usually per-database, so a hand-numbered file can look
already-applied and be skipped with a success message.
