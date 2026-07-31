// Frame pacing and the dynamic scene scale.
//
// The scene is drawn into an offscreen buffer that is allowed to be smaller
// than the screen and then stretched onto it. The HUD is *not* — it is painted
// straight onto the display buffer at full device resolution, so score digits
// and the stamina bar stay sharp however far the scene scale drops. That split
// is the whole point: the expensive thing (hundreds of alley path fills) scales,
// the thing you read (text) does not.
//
// The signal we steer on is our own work time, not the rAF delta. rAF is pinned
// to the display refresh, so it reports a flat 16.7ms right up until the moment
// we blow the budget — useless as an early warning. Work time tells us how much
// headroom is actually left.

import { MOBILE } from './config.js';

let scale = MOBILE.scaleMax;
let lastChange = -1e9;

// Ring of recent work times. Sized to the decision window so a single hitch
// (a GC pause, a sprite bake) can never move the scale on its own.
const win = new Float32Array(MOBILE.window);
let widx = 0;
let wfill = 0;

// Kept for the debug overlay only.
const sorted = new Float32Array(MOBILE.window);
let lastP80 = 0;
let lastAvg = 0;

export function sceneScale() {
  return scale;
}

export function perfStats() {
  return { scale, p80: lastP80, avg: lastAvg, fps: lastAvg > 0 ? 1000 / Math.max(lastAvg, 1) : 0 };
}

export function resetPerf() {
  scale = MOBILE.scaleMax;
  widx = 0;
  wfill = 0;
  lastChange = -1e9;
}

/**
 * Record one frame's work time and decide whether the scene scale should move.
 * @param {number} ms  how long this frame's update+render actually took
 * @param {number} now performance.now() at the end of the frame
 * @returns {boolean} true when the scale changed and the buffer needs resizing
 */
export function sampleFrame(ms, now) {
  win[widx] = ms;
  widx = (widx + 1) % MOBILE.window;
  if (wfill < MOBILE.window) wfill++;

  // Decide once per full window, and never twice inside the settle time —
  // resizing a canvas reallocates its backing store, which is itself a hitch.
  if (wfill < MOBILE.window || widx !== 0) return false;
  if (now - lastChange < MOBILE.settleMs) return false;

  sorted.set(win);
  Array.prototype.sort.call(sorted, (a, b) => a - b);

  // The 80th percentile, not the mean. Smoothness is judged by the bad frames;
  // averaging lets a run of good ones hide a stutter the player can feel.
  lastP80 = sorted[Math.floor(MOBILE.window * 0.8)];
  let sum = 0;
  for (let i = 0; i < MOBILE.window; i++) sum += sorted[i];
  lastAvg = sum / MOBILE.window;

  const before = scale;
  if (lastP80 > MOBILE.budgetMs) {
    scale = Math.max(MOBILE.scaleMin, scale - MOBILE.scaleStep);
  } else if (lastP80 < MOBILE.comfortMs) {
    scale = Math.min(MOBILE.scaleMax, scale + MOBILE.scaleStep);
  }

  if (scale === before) return false;
  lastChange = now;
  return true;
}
