// Press feedback — the answer to "did that button do anything?"
//
// Three separate things go missing on a phone, and all three reach the player
// as the same complaint: a dead button.
//
//   · THE PRESS. `-webkit-tap-highlight-color: transparent` is set on the body
//     deliberately — the OS flash is a grey rectangle over a gold button — so
//     `.btn:active` is the only press state left. iOS Safari does not paint
//     `:active` until it has decided the touch is not the start of a scroll,
//     and every menu here lives inside `.screen`, which is `overflow-y: auto`
//     with `touch-action: pan-y`. For a quick tap that decision routinely
//     arrives after the finger has already lifted, so the state is skipped
//     entirely and the button never moves. A delegated `pointerdown` paints it
//     on contact and does not care what the gesture turns out to be.
//
//   · THE CLICK. `sfx.uiClick()` is wired per button in js/main.js, so any
//     control wired somewhere ELSE is silent — which was the whole ACCOUNT
//     screen, every button on it, because js/account.js wires its own. One
//     delegated listener is what makes that impossible to forget again.
//
//   · THE RESULT. See `uiToast` below.
//
// Nothing in here calls preventDefault or stopPropagation. It listens at the
// document and may change only how a control FEELS, never what it does.

import * as sfx from './audio.js';
import { hap } from './haptics.js';

/** Everything the player can press. Inputs are excluded — they show a caret. */
const PRESSABLE = '.btn, .file-btn, .opt-row, .lang button, .help-fab';

let held = null;

function release() {
  if (!held) return;
  held.classList.remove('pressed');
  held = null;
}

/**
 * Wire the press once, at boot, for the whole document — including controls
 * that do not exist yet. js/account.js builds its sign-in button at paint time
 * and boards.js builds rows on every refresh; delegation covers both without
 * either file knowing this exists.
 */
export function initUiFeedback() {
  // Capture, so a control that stops propagation on its own tap cannot swallow
  // its own press state.
  document.addEventListener('pointerdown', (e) => {
    // Left/primary only. A right-click opens a context menu; it is not a press.
    if (e.button !== 0) return;
    const el = e.target?.closest?.(PRESSABLE);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    release();
    held = el;
    el.classList.add('pressed');
    // Both on contact rather than on `click`: the point of this file is that
    // the acknowledgement lands before the finger lifts. audio.js swallows a
    // repeat inside one gesture, so buttons that ALSO call uiClick() in their
    // own click handler — most of js/main.js — do not double up.
    sfx.uiClick();
    hap.ui();
  }, true);

  // pointercancel is what fires when the browser takes the gesture over for a
  // scroll, which is the common way a press on a sheet ends without a click.
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, release, true);
  }
  // Belt and braces: a scroll that never cancelled, or a tap that took the page
  // away entirely (sign-in leaves for Google), must not leave a button stuck
  // down. Both are cheap and neither can fire mid-press.
  document.addEventListener('scroll', release, true);
  window.addEventListener('blur', release);
}

// ------------------------------------------------------------------- toast

/**
 * A confirmation where the eye already is.
 *
 * The ACCOUNT sheet is far taller than a phone, and its `#acct-status` line
 * sits at the BOTTOM of it, below the privacy toggle. So pressing COPY CODE
 * halfway up wrote a perfectly good confirmation several hundred pixels below
 * the fold, and the player — correctly — reported that nothing happened. The
 * inline line stays, because it is the record you scroll down to; this is the
 * half that actually gets read.
 */
let toastEl = null;
let toastTimer = 0;

export function uiToast(msg, bad = false) {
  if (!msg) return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'ui-toast';
    // Announced, not merely drawn. This is the confirmation for something the
    // player just did, which is exactly what a polite live region is for.
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.toggle('bad', !!bad);

  // The update bar owns the bottom of the screen while it is up (pwa-register
  // .js, at the top of the z stack — and it stays there, it is the one that
  // fixes a stale build). Sit above it rather than under it.
  const bar = document.getElementById('pwa-update-toast');
  toastEl.style.setProperty('--toast-lift', bar ? `${bar.offsetHeight + 10}px` : '0px');

  // Restart the entry animation even when the text is identical. Pressing COPY
  // twice must not look like the second press did nothing — which is the exact
  // bug this whole file exists to fix.
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');

  clearTimeout(toastTimer);
  // Something that went wrong is worth reading twice.
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), bad ? 4200 : 2600);
}

// ------------------------------------------------------- states on the button

const flashes = new WeakMap();

/**
 * Say it ON the button: COPY becomes COPIED. The toast says the same thing,
 * but the eye is on the thing the finger just hit, and this is the version it
 * cannot miss.
 *
 * The original label is remembered on the FIRST flash and reused by every one
 * after it, so hammering the button cannot latch "COPIED" in permanently.
 */
export function flashLabel(btn, text, ms = 1400) {
  if (!btn) return;
  const prev = flashes.get(btn);
  if (prev) clearTimeout(prev.timer);
  const original = prev ? prev.original : btn.textContent;
  btn.textContent = text;
  btn.classList.add('flash');
  const timer = setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('flash');
    flashes.delete(btn);
  }, ms);
  flashes.set(btn, { original, timer });
}

/**
 * The working state for the ones that genuinely are slow — a network round
 * trip, a file being read off disk.
 *
 * Returns the function that ends it. Call that in BOTH branches: a button left
 * disabled forever is the failure this is supposed to prevent, not cause.
 * Calling it twice is safe, so a `.then()` and a `.catch()` can both hold it.
 *
 * Buttons only. It writes `textContent`, so pointing it at something whose
 * label is not its only child — `.file-btn`, which wraps the hidden file input
 * — deletes the rest of it.
 */
export function busy(btn, label) {
  if (!btn) return () => {};
  const original = btn.textContent;
  const wasDisabled = !!btn.disabled;
  btn.textContent = label;
  btn.disabled = true;
  btn.classList.add('busy');
  let spent = false;
  return () => {
    if (spent) return;
    spent = true;
    btn.textContent = original;
    btn.disabled = wasDisabled;
    btn.classList.remove('busy');
  };
}
