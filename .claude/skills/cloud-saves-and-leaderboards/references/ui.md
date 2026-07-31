# UI — the sign-in / backup modal and the board panel

## Why the modal is plain DOM

Build it as framework-free DOM appended to `document.body`, even when the game is a canvas/WebGL
engine. It then layers cleanly over the canvas, survives a scene restart, needs no asset pipeline,
and gets native focus, scrolling and text input for free — a hand-rolled in-engine text field on a
phone is a large amount of work to arrive somewhere worse.

One export, idempotent:

```js
export function openCloudModal() {
  if (document.getElementById(MODAL_ID)) return   // a double-tap must not stack two overlays
  …
}
```

Tear everything down on close: the `onCloudChange` subscription, the Escape handler, the overlay.
A modal that leaks its auth subscription re-renders a detached tree on every later sign-in.

## Render by state, and always offer backup

The card is rebuilt wholesale by a `render()` that reads live state, and re-runs on every auth change
and after each async action, so it can never show a stale reality.

```
render()
├── auth block          — one of three states (below)
├── name picker         — only when configured
├── backup / restore    — ALWAYS, even unconfigured, even signed out
└── (optional) notification + analytics toggles
```

Three auth states, all of which must read as intentional:

| state | what it says |
|---|---|
| not configured | "Cloud sync isn't set up on this build yet, but your progress is saved on this device. You can still back it up below." |
| signed out | what signing in *buys* — "restore it on any device, even after clearing your browser or on a new phone" — then one primary button |
| signed in | who they are, that syncing is automatic, and a sign-out |

The unconfigured state is not an error and must not look like one. It is the state every build sits
in before the backend exists, and the backup block below it is genuinely useful there.

Local UI state (a pasted restore code, a half-typed name, an error string) lives in closure
variables *outside* `render()`, so a re-render triggered by an auth event doesn't wipe what the
player was typing.

## The sign-in button

```js
signInBtn.addEventListener('click', () => {
  signInBtn.disabled = true
  signInBtn.textContent = 'Continuing…'
  track(EVENTS.SIGNIN_STARTED)          // only STARTED is observable from here
  signInWithGoogle().then(res => { if (!res.ok) { authError = …; render() } })
})
```

The tap navigates the whole page to Google, so nothing after it runs and the button legitimately
stays in its "Continuing…" state. Only a failure to *start* the redirect is reportable here. The
matching `signin_completed` fires on the way back in, from the auth listener, gated on the `SIGNED_IN`
event — and the gap between the two is your OAuth drop-off rate.

## Sign-out reloads

```js
signOutCloud().then(() => location.reload())
```

Reload rather than patching state in place. Half the app is holding a save that came from an account
that no longer applies, and reasoning about which caches to invalidate is strictly harder than
starting clean. Same for a successful restore-from-backup.

## The name picker

Show it whenever cloud is configured — **including signed out**, so a name can be chosen before the
first submission ever happens.

Give it a **live preview** of the sanitized result, because sanitization is otherwise invisible and
surprising:

```js
const shows = v => {
  const clean = v.trim() === '' ? null : sanitizeName(v)
  if (clean) return `Shows on the board as: ${clean}`
  return anonFallback ? `No name set — the board shows: ${anonFallback}` : 'No name set yet.'
}
```

`anonFallback` is `null` when signed out — there is no user id to derive it from yet, and inventing
one would print a name that isn't the one they'll actually get.

State plainly, in the copy, that the email is never shown to anyone. It is the question players
actually have about signing in, and after the incident in `names.md` it is a promise the code now
keeps at three levels.

## Backup / restore

Four controls, in this order — the strongest first:

1. **Download backup file** — a file in Downloads/Files survives clearing site data, which is the
   exact event that loses everything else. This is the best durability available with no account.
2. **Copy backup code** — with a read-only `<textarea>` fallback shown only when the clipboard API is
   blocked or absent, focused and selected so a manual copy is one gesture.
3. **Restore from a file** — a hidden `<input type="file">` driven by a styled button. Reset
   `input.value = ''` after each pick, or re-picking the same file fires no `change` event.
4. **Paste a code → Restore** — reload on success, inline error on failure.

## The board panel

Render every board through one component. The uniform `{ key, entries, myRank, myScore }` shape from
`client.md` means a panel needs no per-board branching, and `entry.valueText` covers the boards whose
readout isn't just the sort key.

- **Mark the player's own row** (`entry.you`) with a distinct background. It is the first thing
  anyone looks for.
- **Pin an own-rank footer** when the player is outside the top N — otherwise the board is a wall of
  strangers and says nothing about you.
- **Show the board's identity** (the day, the week, `ALL TIME`) as a subtitle. Without it a daily
  board looks like a broken all-time board every midnight.
- **Empty is a normal state**, not an error: signed out, unconfigured, offline, and genuinely-empty
  all arrive as the empty board. Render an invitation ("sign in to join the race"), never a failure.
- **Fetch on open**, not on a timer. A board is read far less often than it is written.

## Accessibility and touch

`role="dialog"`, `aria-modal="true"`, an `aria-label`, a real `<button>` close with
`aria-label="Close"`, Escape to dismiss, and scrim-click that fires only when the target *is* the
scrim (`ev.target === overlay`) — otherwise a drag ending outside the card closes it mid-edit.

Every control ≥44px tall. `maxHeight: calc(100vh - 32px)` with `overflowY: auto` on the card, or the
modal becomes unusable on a short phone in landscape the moment the keyboard opens.
