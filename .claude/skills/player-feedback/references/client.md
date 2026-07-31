# The client pipe

One module. Dormant until configured, never throws, and — unlike a telemetry
pipe — **reports its own outcome honestly**, because someone is watching a
status line.

## The contract, stated at the top of the file

```js
// DESIGN CONTRACT:
//   · DORMANT UNTIL CONFIGURED. With no backend URL/key, every export no-ops
//     and the UI hides the entry point rather than offering a form that cannot
//     send. A button that lies is worse than a missing button.
//   · NOTHING HERE MAY EVER THROW INTO THE APP. Every path is wrapped.
//   · IT REPORTS ITS OWN OUTCOME. This is where the analytics contract inverts:
//     track() is fire-and-forget because a lost metric is free, and a lost
//     report is not. Every send resolves to a result the UI can render — and it
//     is only ever called "sent" when the server actually took it.
```

## Shape

```js
export const KINDS = ['bug', 'idea', 'other'];
export const MAX_MESSAGE = 1000;
export const MIN_MESSAGE = 4;
export const MAX_CONTACT = 80;

// ⚠ PAIRED WITH THE GUARD, which is the enforcement. This copy exists so
// someone who has already said their piece is told BEFORE typing another
// paragraph rather than after a round trip that reads like the message failed.
// If they drift, the CLIENT's must be the smaller, or it promises a send the
// server will refuse.
const HOUR_LIMIT = 5;
const DAY_LIMIT = 20;

export function isFeedbackConfigured() { … }         // the gate the UI checks
export function normalizeKind(kind) { … }            // pure
export function sanitizeMessage(text) { … }          // pure
export function sanitizeContact(text) { … }          // pure
export function validateFeedback({ message }) { … }  // { ok, reason }
export async function sendFeedback({ kind, message, contact, context }) { … }
```

Keeping the sanitisers **pure and exported** is what makes them assertable in a
test page with no network and no auth. That matters more here than usual: the
strings they produce are the ones that will be rendered inside an admin session.

## Stable result keys, never sentences

```js
return { ok: false, reason: 'rate' };   // 'off' | 'empty' | 'rate' | 'net'
```

The UI maps the key to copy. Returning a message string from this module puts
user-facing English inside the network layer and strands the second language
somewhere else — and this box, of all things, should speak the app's voice.

## Sanitising

```js
export function sanitizeMessage(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    // Strip C0 controls and DEL, KEEP tab and newline. Spelled as escapes
    // rather than typed literally so the line survives every editor, diff and
    // clipboard between here and the next person to read it.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')   // a phone keyboard sends a dozen blank lines
    .trim()
    .slice(0, MAX_MESSAGE);
}
```

Tabs and newlines survive because people paste repro steps as a list. Control
characters do not, because this string's destination is a page authenticated as
the owner. The contact field flattens **everything**, newlines included — it is
one line in a table and a pasted linebreak breaks the row it lands in.

## The wire

A plain insert with `Prefer: return=minimal`.

```js
const res = await fetch(`${URL}/rest/v1/app_feedback`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: KEY,
    Authorization: `Bearer ${token ?? KEY}`,
    // CORRECTNESS, not a size optimisation. This table has no SELECT policy, so
    // asking PostgREST to return the inserted row makes it read a row it is not
    // allowed to read and the whole write fails.
    Prefer: 'return=minimal',
  },
  body: JSON.stringify(row),
  cache: 'no-store',
});

if (res.ok) { recordSend(); return { ok: true, reason: null }; }
// The guard raises with PostgREST's PTxyz convention so the limit arrives as a
// real 429. Read the STATUS, never the body — if that mapping ever goes away
// the user gets generic wording instead of specific, which is a copy regression
// and not a broken box.
if (res.status === 429) return { ok: false, reason: 'rate' };
if (res.status === 400) return { ok: false, reason: 'empty' };
return { ok: false, reason: 'net' };
```

Send the signed-in user's JWT when there is a session so RLS admits `user_id`;
signed out, send the publishable key and a null `user_id`, which is what the
insert policy expects.

**Do not use `?on_conflict=…&resolution=ignore-duplicates`.** It is the shape
every idempotency guide reaches for and it can never work against a table with
no select policy — see the SKILL.md invariant. The dedupe belongs in the guard.

## Idempotency

Mint `feedback_id` once per attempt and reuse it across that attempt's retries.
The guard drops a repeat and answers 201, so someone who presses SEND again on a
stalled connection gets one row and one "sent".

## The local ledger

```js
// Only SUCCESSFUL sends are recorded: a retry the server deduped never happened
// as far as the limit is concerned. That keeps this ledger at or below the
// server's count, so the two can only disagree in the safe direction.
function recordSend() { … }   // append Date.now(), keep the last DAY_LIMIT
```

`validateFeedback` checks the message length **before** reading the ledger, so a
test page can assert the empty cases without depending on what was sent an hour
ago.

## Context, bounded here

```js
function safeContext(context) {
  // Bounded FIELD BY FIELD in the client, because the guard replaces an
  // oversized bag with {} — losing every field rather than the offending one.
  // The guard stays the backstop, not the mechanism.
  const out = {};
  for (const [k, v] of Object.entries(context || {})) {
    if (v == null) continue;
    const key = String(k).slice(0, 24);
    if (typeof v === 'number') out[key] = Number.isFinite(v) ? Math.round(v) : 0;
    else if (typeof v === 'boolean') out[key] = v;
    else out[key] = String(v).slice(0, 60);
  }
  return JSON.stringify(out).length > 900 ? {} : out;
}
```

Gather it at the call site, where the app state actually is, and wrap that in
its own `try/catch` — context is a nice-to-have on a message that is not, and
losing it must never lose the report.

Worth including: current screen, app version, locale, viewport, device pixel
ratio, and one or two domain facts that explain *which* user this is (progress,
plan, the item on screen). Viewport and dpr are the other half of most "it only
happens on my phone" reports.

## Never queue a failure

```js
} catch {
  // Offline, blocked, DNS — all the same to the user, and all of them mean "it
  // did not go". NOT queued for later: a report they were told was sent,
  // delivered silently an hour later from a different screen, is a promise this
  // file cannot keep honestly. Ask them to try again.
  return { ok: false, reason: 'net' };
}
```

And at the call site: **clear the textarea on success only.** They are about to
press the button again, and a box that empties itself on a network blip loses
the report and the goodwill together.

## The device id

Reuse the analytics one if it exists. Export it from that module rather than
minting a second — a second id costs the ability to read a report next to what
that user actually did and buys no privacy, since it is one more anonymous UUID
for the same browser.

It is deliberately **not** gated on an analytics opt-out. Telemetry honours the
toggle by not sending events at all; this is a message the user typed and
pressed send on, and it needs an identity to be rate-limited by and to group
repeat reports under. Someone opted out has no event log for it to join to, so
the id links their report to nothing. Say so in the form.
