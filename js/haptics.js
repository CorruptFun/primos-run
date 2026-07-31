// Vibration feedback.
//
// On a phone this is most of what makes a swipe feel like it did something. The
// visual response to a lane change is a camera bank that takes ~150ms to read;
// the tap on your palm lands immediately, so the input feels acknowledged well
// before the picture catches up.
//
// Everything here is fire-and-forget and must never throw. navigator.vibrate is
// absent on desktop, absent on iOS Safari, and present-but-ignored on Android
// until the page has been interacted with — all three are normal, none are
// errors, and none of them may interrupt a run.

import { HAPTICS } from './config.js';

const can = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
let enabled = true;

/** Follows the sound toggle: someone playing silently wants silence, not buzz. */
export function setHaptics(on) {
  enabled = !!on;
  if (!enabled && can) { try { navigator.vibrate(0); } catch (e) { /* ignore */ } }
}

export function hapticsAvailable() {
  return can;
}

/**
 * @param {number|number[]} pattern ms, or an on/off pattern
 */
export function buzz(pattern) {
  if (!can || !enabled || !pattern) return;
  try {
    navigator.vibrate(pattern);
  } catch (e) {
    /* A browser that rejects the pattern is not a reason to drop a frame. */
  }
}

// Named events, so call sites read as intent rather than as durations.
export const hap = {
  lane:    () => buzz(HAPTICS.lane),
  blocked: () => buzz(HAPTICS.blocked),
  jump:    () => buzz(HAPTICS.jump),
  slide:   () => buzz(HAPTICS.slide),
  beer:    () => buzz(HAPTICS.beer),
  taco:    () => buzz(HAPTICS.taco),
  power:   () => buzz(HAPTICS.power),
  hit:     () => buzz(HAPTICS.hit),
  smash:   () => buzz(HAPTICS.smash),
  bust:    () => buzz(HAPTICS.bust),
};
