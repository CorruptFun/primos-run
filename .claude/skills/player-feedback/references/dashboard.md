# Reading the box, and working the queue

The half that decides whether any of this survives past week two.

## The failure this panel exists to prevent

A list of messages with no state is a list you stop opening. Visit one you read
everything. Visit two you re-read everything and skim. Visit three you cannot
tell new from handled, so you skim harder. Visit four you do not open it.

Nothing about it looks broken while this is happening, which is why it has to be
designed against rather than noticed later. **`status` is the feature.**

## Shape

```
  What players wrote
  [All] [Unread] [Triaged] [Done] [Spam]              showing 20 of 43

  ┌ UNREAD 2 ─┐ ┌ REPORTS 43 ─┐ ┌ TRIAGED 12 ─┐ ┌ BY KIND ─┐
  │ waiting   │ │ 31 devices  │ │ 29 done     │ │ bug 26 … │
  └───────────┘ └─────────────┘ └─────────────┘ └──────────┘

  ┃ GLITCH   Jul 31, 06:20 PM                              NEW
  ┃ The slide does not register when I swipe fast.
  ┃ Happens every time on the third checkpoint.
  ┃ REPLY TO  me@example.com
  ┃ build v16 · lang en · device a1b2c3d4 (2 reports) · signed out · score 1420
  ┃ [triaged] [done] [spam]
```

The unread tile is the only number on the page that is a **to-do list** rather
than a measurement — colour it, and pair the colour with a word.

`device (2 reports)` is the triage signal worth the join: one person's tenth
message reads differently from ten people's first, and a flat list cannot show
you which you are holding.

## Rules

**Refetch after a status change. Do not patch the card in place.**
The tiles are counts over the same rows. A card that says "done" next to an
unread count that did not move is a dashboard nobody trusts a second time.

**Counters are computed over the whole window, never the filtered slice.**
The count of what is still unread must not change because you are currently
looking at "done".

**Read a long window — a YEAR — not the analytics date range.**
If the page has 7/14/30/90 buttons, this panel must not follow them. Those are
right for a rate and wrong for a queue: a report left unread for three weeks
drops out of a 14-day window **along with the unread count that was the only
thing still pointing at it**, and the panel reports "all caught up" because the
evidence expired.

**Say when the list is partial.** `showing 200 of 431`, never a silent truncation
— a capped list that looks complete is how the oldest unread report becomes
invisible.

**Render its own errors in its own box.** The client half ships in the same
commit as the migration, and the migration is applied **by hand, afterwards**. In
between, the RPC does not exist. That must cost this panel and not the page:

```js
note(error.code === '42501'
  ? 'Admin-only — you are signed in but not on the allow-list.'
  : `${error.message} (Has the feedback migration been applied?)`);
```

Naming the likely cause in the error saves the fifteen minutes you would
otherwise spend suspecting auth.

## ⚠ The XSS rule, and here it is not theoretical

Everywhere else on an admin page the client-supplied strings are event names and
error messages. Here the **entire payload is free text a stranger typed into a
box**, rendered inside a session authenticated as the owner — the one session
that can read every message anyone has ever written. That is the highest-value
target in the system, and this panel hands it attacker-controlled prose by
design.

- Every user string reaches the DOM through `textContent`. **No `innerHTML` in
  this file, ever.**
- `white-space: pre-wrap` preserves the writer's own line breaks without a single
  tag being built from their string.
- The contact field renders as **plain text, not a `mailto:` link**. Building an
  `href` out of a user-typed string puts a `javascript:` or `data:` URI one click
  away. The copy-paste is worth it.
- Length caps in the coercion layer defend the **layout**, not against XSS. Do
  not let their presence stand in for the rule above.

Worth an actual test. Feed the renderer a row whose message is
`<img src=x onerror="document.title='PWNED'">` and assert the title is unchanged
and `.fb-msg img` count is zero.

## Coerce shape-tolerantly

The SQL and the renderer drift independently — they are deployed by different
acts, by hand, on different days. A panel that throws on one missing key shows
nothing, which is the worst response to a half-applied migration.

```js
export function coerceFeedback(raw) { /* every field defaulted, nothing throws */ }
```

One exception to the usual caps: **the message keeps its full stored length.** A
bug report truncated to a headline is a bug report whose repro steps are gone.

## A no-database render hook

Every panel here is behind a sign-in *and* an admin row, so without this the
renderer's first ever execution is in front of the person it is for.

```js
window.__renderFeedback = (payload) => { render(coerceFeedback(payload)); };
```

Reads nothing, sends nothing. Use it to iterate the layout, and to run the XSS
probe above without writing a hostile row to a real table.

## Retention

Never prune a row still marked `new` — a queue that empties itself loses the one
report nobody got to. Keep reports far longer than telemetry: an event is a data
point, a report is somebody's sentence, and *we shipped the thing you asked for*
is worth being able to say a year later.

## Do not ship the admin page to users

If a service worker precaches the app shell, the admin page and its modules must
be **absent from the precache and skipped by the fetch handler** — without the
skip, an offline request for `/stats.html` is answered with the app itself,
which is a confusing bug on top of an unnecessary download.
