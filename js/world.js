// Procedural alley generator. Hand-authored chunks keep every pattern fair —
// each one always leaves at least one survivable line through it.

import { LANE_W, DRAW_DIST, HITBOX, RUN, PACING } from './config.js';
import { PROP_SPEC, DECOR_HIT_W } from './art/props.js';

// ------------------------------------------------------------- the run clock
//
// game.js only ever hands the world a DISTANCE, and distance is the wrong
// clock for difficulty because it accelerates: gating tiers on metres made
// them arrive roughly three times faster than the speed curve did.
//
// Nothing needs plumbing through game.js to fix that, because RUN's
// acceleration is constant in time, which makes v² = v0² + 2·a·d exact. Both
// the nominal speed and the nominal seconds survived therefore fall straight
// out of distance in closed form.
//
// "Nominal" is doing real work in that sentence: this is the clock of a player
// who never gets gassed. Anyone who does crawls at RUN.gassedSpeed, covers
// less ground per second than the curve assumes, and so reaches each tier
// LATER in wall-clock terms than these numbers say. The error is always in the
// player's favour, which is the only direction it is allowed to be.
const V0 = RUN.startSpeed;
const VMAX = RUN.maxSpeed;
const ACC = RUN.accel;
const D_TOP = (VMAX * VMAX - V0 * V0) / (2 * ACC);   // 3600u before speed caps
const T_TOP = (VMAX - V0) / ACC;                     // 150s before speed caps

/** Nominal speed, u/s, after `distance` units. */
export function speedAt(distance) {
  const d = distance > 0 ? distance : 0;
  return Math.min(VMAX, Math.sqrt(V0 * V0 + 2 * ACC * d));
}

/** Nominal seconds survived after `distance` units. */
export function secondsAt(distance) {
  const d = distance > 0 ? distance : 0;
  if (d <= D_TOP) return (speedAt(d) - V0) / ACC;
  return T_TOP + (d - D_TOP) / VMAX;
}

/**
 * Chunks are authored in local space: `dz` is metres from the chunk start,
 * `lane` is -1/0/1. `tier` gates a chunk until the run has heated up.
 *
 * Authoring rules, all of them load bearing:
 *
 *   * A row (obstacles sharing a `dz`) never blocks all three lanes with
 *     `dodge` props — checkpoint, border and copcar are taller than the jump
 *     apex on purpose, so the only answer to them is a lane that is open.
 *   * A row may fill all three lanes with `jump` props, or all three with
 *     `slide` props. It may never put a jump and a slide in the SAME lane at
 *     the same dz, because you cannot do both.
 *   * Rows sit at least 8 units apart, and at least 9 when the verb changes
 *     between them.
 *
 * Those dz values are authored at STARTING speed and stretched from there —
 * placeChunk multiplies every dz by a factor that tracks how fast the runner
 * is going, so 8 authored units stays about half a second of reaction time all
 * the way up instead of decaying to a quarter of one. Authoring in the units
 * of the slowest moment of the run is what makes that safe: the multiplier is
 * never below 1, so no pattern can ever come out tighter than it was written.
 *
 * `density` shapes the gap AFTER the chunk (see placeChunk), so the run
 * breathes instead of droning: a gauntlet is followed by open alley.
 */
const CHUNKS = [
  // ---- tier 0: teach the verbs -------------------------------------------
  {
    id: 'open-road', tier: 0, len: 16, weight: 3, density: 'calm',
    items: [
      { t: 'beer', lane: 0, dz: 3 }, { t: 'beer', lane: 0, dz: 4.6 },
      { t: 'beer', lane: 0, dz: 6.2 }, { t: 'beer', lane: 0, dz: 7.8 },
    ],
  },
  {
    id: 'cantina-strip', tier: 0, len: 26, weight: 3, density: 'calm',
    items: [
      // The weave is stretched on purpose: a lane change takes about an eighth
      // of a second to clear the pickup box, so beers spaced tighter than this
      // are uncollectable at top speed and read as the game cheating you.
      { t: 'beer', lane: -1, dz: 4 }, { t: 'beer', lane: -1, dz: 6.4 },
      { t: 'beer', lane: 0, dz: 8.8 }, { t: 'beer', lane: 0, dz: 11.2 },
      { t: 'beer', lane: 1, dz: 13.6 }, { t: 'beer', lane: 1, dz: 16 },
      { t: 'beer', lane: 0, dz: 18.4 }, { t: 'beer', lane: -1, dz: 20.8 },
      { t: 'taco', lane: -1, dz: 23.5 },
    ],
  },
  {
    id: 'first-checkpoint', tier: 0, len: 20, weight: 4, density: 'mid',
    items: [
      { t: 'checkpoint', lane: 0, dz: 9 },
      { t: 'beer', lane: -1, dz: 7 }, { t: 'beer', lane: -1, dz: 8.6 },
      { t: 'beer', lane: -1, dz: 10.2 }, { t: 'beer', lane: -1, dz: 11.8 },
    ],
  },
  {
    id: 'hop-the-dumpster', tier: 0, len: 20, weight: 4, density: 'mid',
    items: [
      { t: 'dumpster', lane: 0, dz: 9 },
      // beers arc over the lid to reward the jump
      { t: 'beer', lane: 0, dz: 7.4, y: 1.05 },
      { t: 'beer', lane: 0, dz: 8.6, y: 1.5 },
      { t: 'beer', lane: 0, dz: 9.8, y: 1.5 },
      { t: 'beer', lane: 0, dz: 11.0, y: 1.05 },
    ],
  },
  {
    id: 'duck-the-laundry', tier: 0, len: 20, weight: 4, density: 'mid',
    items: [
      { t: 'clothesline', lane: 0, dz: 9 },
      { t: 'beer', lane: 0, dz: 8.4, y: 0.42 },
      { t: 'beer', lane: 0, dz: 9.6, y: 0.42 },
      { t: 'beer', lane: 1, dz: 12.5 },
    ],
  },
  {
    id: 'taco-stand', tier: 0, len: 18, weight: 3, density: 'calm',
    items: [
      { t: 'taco', lane: 0, dz: 8 },
      { t: 'beer', lane: -1, dz: 6 }, { t: 'beer', lane: 1, dz: 6 },
      { t: 'beer', lane: -1, dz: 11 }, { t: 'beer', lane: 1, dz: 11 },
    ],
  },
  {
    id: 'cone-in-the-way', tier: 0, len: 19, weight: 3, density: 'mid',
    items: [
      { t: 'cones', lane: 0, dz: 9 },
      { t: 'beer', lane: 0, dz: 7.6, y: 1.0 },
      { t: 'beer', lane: 0, dz: 9, y: 1.35 },
      { t: 'beer', lane: 0, dz: 10.4, y: 1.0 },
      { t: 'beer', lane: 1, dz: 14 },
    ],
  },
  {
    id: 'crate-hop', tier: 0, len: 19, weight: 3, density: 'mid',
    items: [
      { t: 'crates', lane: 1, dz: 9 },
      { t: 'beer', lane: 1, dz: 7.6, y: 0.95 },
      { t: 'beer', lane: 1, dz: 9, y: 1.3 },
      { t: 'beer', lane: 1, dz: 10.4, y: 0.95 },
      { t: 'beer', lane: -1, dz: 14 },
    ],
  },
  {
    id: 'awning-single', tier: 0, len: 20, weight: 3, density: 'mid',
    items: [
      { t: 'awning', lane: 0, dz: 9 },
      { t: 'beer', lane: 0, dz: 8.2, y: 0.42 },
      { t: 'beer', lane: 0, dz: 9.6, y: 0.42 },
      { t: 'taco', lane: 0, dz: 13.5 },
    ],
  },
  {
    id: 'side-step', tier: 0, len: 21, weight: 3, density: 'mid',
    items: [
      { t: 'checkpoint', lane: 1, dz: 9 },
      { t: 'beer', lane: 0, dz: 8 }, { t: 'beer', lane: 0, dz: 9.6 },
      { t: 'beer', lane: -1, dz: 14 }, { t: 'beer', lane: -1, dz: 15.6 },
    ],
  },

  // ---- tier 1: commit to a lane ------------------------------------------
  {
    id: 'border-gap-left', tier: 1, len: 24, weight: 4, density: 'mid',
    items: [
      { t: 'border', lane: 0, dz: 11 }, { t: 'border', lane: 1, dz: 11 },
      { t: 'beer', lane: -1, dz: 8 }, { t: 'beer', lane: -1, dz: 9.6 },
      { t: 'beer', lane: -1, dz: 11.2 }, { t: 'beer', lane: -1, dz: 12.8 },
      { t: 'taco', lane: -1, dz: 15.5 },
    ],
  },
  {
    id: 'border-gap-right', tier: 1, len: 24, weight: 4, density: 'mid',
    items: [
      { t: 'border', lane: -1, dz: 11 }, { t: 'border', lane: 0, dz: 11 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: 1, dz: 11.2 }, { t: 'beer', lane: 1, dz: 12.8 },
    ],
  },
  {
    id: 'checkpoint-pair', tier: 1, len: 26, weight: 4, density: 'mid',
    items: [
      { t: 'checkpoint', lane: -1, dz: 9 }, { t: 'checkpoint', lane: 0, dz: 9 },
      { t: 'copcar', lane: 1, dz: 17 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: 0, dz: 16 }, { t: 'beer', lane: 0, dz: 17.6 },
    ],
  },
  {
    id: 'dumpster-row', tier: 1, len: 22, weight: 3, density: 'mid',
    items: [
      { t: 'dumpster', lane: -1, dz: 9 }, { t: 'dumpster', lane: 0, dz: 9 },
      { t: 'dumpster', lane: 1, dz: 9 },
      { t: 'beer', lane: 0, dz: 7.4, y: 1.05 },
      { t: 'beer', lane: 0, dz: 8.8, y: 1.55 },
      { t: 'beer', lane: 0, dz: 10.2, y: 1.55 },
      { t: 'beer', lane: 0, dz: 11.6, y: 1.05 },
    ],
  },
  {
    id: 'awning-run', tier: 1, len: 24, weight: 3, density: 'mid',
    items: [
      { t: 'awning', lane: -1, dz: 9 }, { t: 'awning', lane: 0, dz: 9 },
      { t: 'awning', lane: 1, dz: 9 },
      { t: 'taco', lane: 0, dz: 9, y: 0.45 },
      { t: 'beer', lane: -1, dz: 14 }, { t: 'beer', lane: 1, dz: 14 },
    ],
  },
  {
    // Rows were 6u apart, the tightest anywhere in the table and the only
    // place that broke the 8u house minimum. Opened to 8u.
    id: 'cone-slalom', tier: 1, len: 30, weight: 3, density: 'mid',
    items: [
      { t: 'cones', lane: -1, dz: 7 },
      { t: 'cones', lane: 0, dz: 15 },
      { t: 'cones', lane: 1, dz: 23 },
      { t: 'beer', lane: 0, dz: 7 }, { t: 'beer', lane: 1, dz: 15 },
      { t: 'beer', lane: -1, dz: 23 },
    ],
  },
  {
    id: 'dumpster-diver', tier: 1, len: 24, weight: 3, density: 'mid',
    items: [
      { t: 'dumpster', lane: -1, dz: 8 }, { t: 'dumpster', lane: 1, dz: 8 },
      { t: 'cones', lane: 0, dz: 17 },
      { t: 'beer', lane: -1, dz: 6.6, y: 1.05 },
      { t: 'beer', lane: -1, dz: 8, y: 1.5 },
      { t: 'beer', lane: -1, dz: 9.4, y: 1.05 },
      { t: 'beer', lane: 0, dz: 15.6, y: 0.95 },
      { t: 'beer', lane: 0, dz: 17, y: 1.3 },
    ],
  },
  {
    id: 'laundry-day', tier: 1, len: 27, weight: 3, density: 'mid',
    items: [
      { t: 'clothesline', lane: -1, dz: 8 }, { t: 'clothesline', lane: 0, dz: 8 },
      { t: 'clothesline', lane: 0, dz: 18 }, { t: 'clothesline', lane: 1, dz: 18 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: -1, dz: 18 }, { t: 'beer', lane: -1, dz: 19.6 },
    ],
  },
  {
    id: 'mercado-crates', tier: 1, len: 26, weight: 3, density: 'mid',
    items: [
      { t: 'crates', lane: -1, dz: 8 }, { t: 'crates', lane: 0, dz: 8 },
      { t: 'crates', lane: 1, dz: 8 },
      { t: 'taco', lane: 0, dz: 8, y: 1.3 },
      { t: 'copcar', lane: -1, dz: 18 },
      { t: 'beer', lane: 0, dz: 6.6, y: 1.0 },
      { t: 'beer', lane: 0, dz: 8, y: 1.45 },
      { t: 'beer', lane: 0, dz: 9.4, y: 1.0 },
      { t: 'beer', lane: 1, dz: 18 }, { t: 'beer', lane: 1, dz: 19.6 },
    ],
  },
  {
    id: 'cop-block-mid', tier: 1, len: 26, weight: 4, density: 'mid',
    items: [
      { t: 'copcar', lane: 0, dz: 10 },
      { t: 'cones', lane: -1, dz: 19 },
      { t: 'beer', lane: -1, dz: 9 }, { t: 'beer', lane: -1, dz: 10.6 },
      { t: 'beer', lane: 1, dz: 9 }, { t: 'beer', lane: 1, dz: 10.6 },
      { t: 'beer', lane: 0, dz: 19 }, { t: 'beer', lane: 0, dz: 20.6 },
    ],
  },
  {
    id: 'wall-hug-right', tier: 1, len: 27, weight: 3, density: 'mid',
    items: [
      { t: 'border', lane: -1, dz: 9 }, { t: 'border', lane: 0, dz: 9 },
      { t: 'dumpster', lane: 1, dz: 19 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: 1, dz: 11.2 },
      { t: 'beer', lane: 1, dz: 17.6, y: 1.05 },
      { t: 'beer', lane: 1, dz: 19, y: 1.5 },
      { t: 'beer', lane: 1, dz: 20.4, y: 1.05 },
    ],
  },
  {
    id: 'cone-corridor', tier: 1, len: 30, weight: 3, density: 'mid',
    items: [
      { t: 'cones', lane: -1, dz: 8 }, { t: 'cones', lane: 1, dz: 8 },
      { t: 'cones', lane: 0, dz: 17 },
      { t: 'cones', lane: -1, dz: 26 }, { t: 'cones', lane: 1, dz: 26 },
      { t: 'beer', lane: 0, dz: 8 }, { t: 'beer', lane: 0, dz: 9.6 },
      { t: 'beer', lane: -1, dz: 17 }, { t: 'beer', lane: 1, dz: 17 },
      { t: 'beer', lane: 0, dz: 26 }, { t: 'beer', lane: 0, dz: 27.6 },
    ],
  },
  {
    id: 'awning-and-wall', tier: 1, len: 28, weight: 3, density: 'mid',
    items: [
      { t: 'awning', lane: -1, dz: 8 }, { t: 'awning', lane: 0, dz: 8 },
      { t: 'border', lane: 0, dz: 18 }, { t: 'border', lane: 1, dz: 18 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: -1, dz: 18 }, { t: 'beer', lane: -1, dz: 19.6 },
      { t: 'beer', lane: -1, dz: 21.2 },
      { t: 'taco', lane: -1, dz: 24.5 },
    ],
  },

  // ---- tier 2: stack the verbs -------------------------------------------
  {
    id: 'checkpoint-gauntlet', tier: 2, len: 34, weight: 4, density: 'dense',
    items: [
      { t: 'checkpoint', lane: -1, dz: 8 }, { t: 'checkpoint', lane: 0, dz: 8 },
      { t: 'checkpoint', lane: 0, dz: 17 }, { t: 'checkpoint', lane: 1, dz: 17 },
      { t: 'checkpoint', lane: -1, dz: 26 }, { t: 'checkpoint', lane: 1, dz: 26 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: -1, dz: 17 }, { t: 'beer', lane: -1, dz: 18.6 },
      { t: 'beer', lane: 0, dz: 26 }, { t: 'beer', lane: 0, dz: 27.6 },
      { t: 'taco', lane: 0, dz: 31 },
    ],
  },
  {
    id: 'wall-then-duck', tier: 2, len: 30, weight: 4, density: 'dense',
    items: [
      { t: 'border', lane: -1, dz: 9 }, { t: 'border', lane: 1, dz: 9 },
      { t: 'clothesline', lane: -1, dz: 19 }, { t: 'clothesline', lane: 0, dz: 19 },
      { t: 'clothesline', lane: 1, dz: 19 },
      { t: 'beer', lane: 0, dz: 8 }, { t: 'beer', lane: 0, dz: 9.6 },
      { t: 'beer', lane: 0, dz: 18.6, y: 0.42 },
      { t: 'beer', lane: 0, dz: 20.0, y: 0.42 },
    ],
  },
  {
    id: 'jump-then-swerve', tier: 2, len: 30, weight: 4, density: 'dense',
    items: [
      { t: 'crates', lane: -1, dz: 8 }, { t: 'crates', lane: 0, dz: 8 },
      { t: 'crates', lane: 1, dz: 8 },
      { t: 'copcar', lane: 0, dz: 18 }, { t: 'checkpoint', lane: 1, dz: 18 },
      { t: 'beer', lane: 0, dz: 6.6, y: 1.0 },
      { t: 'beer', lane: 0, dz: 8.0, y: 1.45 },
      { t: 'beer', lane: 0, dz: 9.4, y: 1.0 },
      { t: 'beer', lane: -1, dz: 17 }, { t: 'beer', lane: -1, dz: 18.6 },
    ],
  },
  {
    id: 'migra-blockade', tier: 2, len: 32, weight: 3, density: 'dense',
    items: [
      { t: 'copcar', lane: -1, dz: 10 }, { t: 'copcar', lane: 1, dz: 10 },
      { t: 'border', lane: 0, dz: 20 }, { t: 'border', lane: -1, dz: 20 },
      { t: 'beer', lane: 0, dz: 9 }, { t: 'beer', lane: 0, dz: 10.6 },
      { t: 'beer', lane: 1, dz: 19 }, { t: 'beer', lane: 1, dz: 20.6 },
      { t: 'beer', lane: 1, dz: 22.2 },
    ],
  },
  {
    id: 'taco-truck-alley', tier: 2, len: 32, weight: 3, density: 'dense',
    items: [
      { t: 'awning', lane: -1, dz: 8 }, { t: 'awning', lane: 0, dz: 8 },
      { t: 'awning', lane: 1, dz: 8 },
      { t: 'taco', lane: 0, dz: 8, y: 0.42 },
      { t: 'checkpoint', lane: 0, dz: 18 }, { t: 'copcar', lane: 1, dz: 18 },
      { t: 'crates', lane: -1, dz: 27 }, { t: 'crates', lane: 0, dz: 27 },
      { t: 'beer', lane: 0, dz: 6.8, y: 0.42 },
      { t: 'beer', lane: 0, dz: 9.2, y: 0.42 },
      { t: 'beer', lane: -1, dz: 18 }, { t: 'beer', lane: -1, dz: 19.6 },
      { t: 'beer', lane: 1, dz: 27 }, { t: 'beer', lane: 1, dz: 28.6 },
    ],
  },
  {
    id: 'double-back', tier: 2, len: 34, weight: 4, density: 'dense',
    items: [
      { t: 'checkpoint', lane: -1, dz: 8 }, { t: 'copcar', lane: 0, dz: 8 },
      { t: 'clothesline', lane: 0, dz: 17 }, { t: 'clothesline', lane: 1, dz: 17 },
      { t: 'border', lane: 0, dz: 26 }, { t: 'border', lane: 1, dz: 26 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: -1, dz: 17 }, { t: 'beer', lane: -1, dz: 18.6 },
      { t: 'beer', lane: -1, dz: 26 }, { t: 'beer', lane: -1, dz: 27.6 },
      { t: 'taco', lane: -1, dz: 31 },
    ],
  },
  {
    id: 'pincer', tier: 2, len: 30, weight: 3, density: 'mid',
    items: [
      { t: 'copcar', lane: -1, dz: 9 }, { t: 'copcar', lane: 1, dz: 9 },
      { t: 'dumpster', lane: 0, dz: 19 },
      { t: 'cones', lane: -1, dz: 19 }, { t: 'cones', lane: 1, dz: 19 },
      { t: 'beer', lane: 0, dz: 9 }, { t: 'beer', lane: 0, dz: 10.6 },
      { t: 'beer', lane: 0, dz: 17.6, y: 1.05 },
      { t: 'beer', lane: 0, dz: 19, y: 1.5 },
      { t: 'beer', lane: 0, dz: 20.4, y: 1.05 },
    ],
  },
  {
    id: 'roll-under-the-line', tier: 2, len: 33, weight: 3, density: 'dense',
    items: [
      { t: 'clothesline', lane: -1, dz: 8 }, { t: 'clothesline', lane: 0, dz: 8 },
      { t: 'clothesline', lane: 1, dz: 8 },
      { t: 'checkpoint', lane: -1, dz: 18 }, { t: 'checkpoint', lane: 1, dz: 18 },
      { t: 'awning', lane: -1, dz: 27 }, { t: 'awning', lane: 0, dz: 27 },
      { t: 'beer', lane: 0, dz: 7.2, y: 0.42 },
      { t: 'beer', lane: 0, dz: 9.2, y: 0.42 },
      { t: 'beer', lane: 0, dz: 18 }, { t: 'beer', lane: 0, dz: 19.6 },
      { t: 'beer', lane: 1, dz: 27 }, { t: 'beer', lane: 1, dz: 28.6 },
    ],
  },
  {
    id: 'scrapyard', tier: 2, len: 31, weight: 3, density: 'mid',
    items: [
      { t: 'crates', lane: -1, dz: 8 }, { t: 'dumpster', lane: 0, dz: 8 },
      { t: 'cones', lane: 1, dz: 8 },
      { t: 'border', lane: -1, dz: 18 }, { t: 'border', lane: 0, dz: 18 },
      { t: 'dumpster', lane: 1, dz: 27 },
      { t: 'beer', lane: 0, dz: 6.6, y: 1.05 },
      { t: 'beer', lane: 0, dz: 8, y: 1.5 },
      { t: 'beer', lane: 0, dz: 9.4, y: 1.05 },
      { t: 'beer', lane: 1, dz: 18 }, { t: 'beer', lane: 1, dz: 19.6 },
      { t: 'beer', lane: 1, dz: 25.6, y: 1.05 },
      { t: 'beer', lane: 1, dz: 27, y: 1.5 },
    ],
  },
  {
    id: 'siren-alley', tier: 2, len: 34, weight: 3, density: 'dense',
    items: [
      { t: 'checkpoint', lane: -1, dz: 9 }, { t: 'copcar', lane: 0, dz: 9 },
      { t: 'awning', lane: 0, dz: 19 }, { t: 'awning', lane: 1, dz: 19 },
      { t: 'copcar', lane: -1, dz: 29 }, { t: 'border', lane: 0, dz: 29 },
      { t: 'beer', lane: 1, dz: 9 }, { t: 'beer', lane: 1, dz: 10.6 },
      { t: 'beer', lane: -1, dz: 19 }, { t: 'beer', lane: -1, dz: 20.6 },
      { t: 'beer', lane: 1, dz: 29 }, { t: 'beer', lane: 1, dz: 30.6 },
    ],
  },
  {
    id: 'catch-your-breath', tier: 2, len: 30, weight: 2, density: 'calm',
    items: [
      { t: 'beer', lane: -1, dz: 5 }, { t: 'beer', lane: -1, dz: 7.4 },
      { t: 'beer', lane: 0, dz: 9.8 }, { t: 'beer', lane: 0, dz: 12.2 },
      { t: 'beer', lane: 1, dz: 14.6 }, { t: 'beer', lane: 1, dz: 17 },
      { t: 'beer', lane: 0, dz: 19.4 }, { t: 'beer', lane: -1, dz: 21.8 },
      { t: 'beer', lane: -1, dz: 24.2 },
      { t: 'taco', lane: -1, dz: 27 },
    ],
  },

  // ---- tier 3: no mercy ---------------------------------------------------
  {
    // The wall->duck step was 7u, under the house minimum and with a verb
    // change across it. Every row here is 8u apart now.
    id: 'the-corridor', tier: 3, len: 41, weight: 4, density: 'dense',
    items: [
      { t: 'border', lane: -1, dz: 8 }, { t: 'border', lane: 0, dz: 8 },
      { t: 'clothesline', lane: 1, dz: 16 },
      { t: 'checkpoint', lane: 1, dz: 24 }, { t: 'checkpoint', lane: 0, dz: 24 },
      { t: 'dumpster', lane: -1, dz: 32 }, { t: 'dumpster', lane: 0, dz: 32 },
      { t: 'dumpster', lane: 1, dz: 32 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 15.6, y: 0.42 },
      { t: 'beer', lane: -1, dz: 24 }, { t: 'beer', lane: -1, dz: 25.6 },
      { t: 'beer', lane: -1, dz: 31, y: 1.1 }, { t: 'beer', lane: -1, dz: 32.4, y: 1.5 },
      { t: 'taco', lane: 0, dz: 38 },
    ],
  },
  {
    id: 'zigzag-walls', tier: 3, len: 38, weight: 4, density: 'dense',
    items: [
      { t: 'border', lane: 0, dz: 8 }, { t: 'border', lane: 1, dz: 8 },
      { t: 'border', lane: -1, dz: 17 }, { t: 'border', lane: 0, dz: 17 },
      { t: 'border', lane: 0, dz: 26 }, { t: 'border', lane: 1, dz: 26 },
      { t: 'checkpoint', lane: -1, dz: 34 }, { t: 'checkpoint', lane: 0, dz: 34 },
      { t: 'beer', lane: -1, dz: 8 }, { t: 'beer', lane: 1, dz: 17 },
      { t: 'beer', lane: -1, dz: 26 }, { t: 'beer', lane: 1, dz: 34 },
    ],
  },
  {
    id: 'full-send', tier: 3, len: 36, weight: 3, density: 'dense',
    items: [
      { t: 'awning', lane: -1, dz: 7 }, { t: 'awning', lane: 0, dz: 7 },
      { t: 'awning', lane: 1, dz: 7 },
      { t: 'copcar', lane: -1, dz: 15 }, { t: 'copcar', lane: 0, dz: 15 },
      { t: 'cones', lane: 1, dz: 23 }, { t: 'cones', lane: 0, dz: 23 },
      { t: 'border', lane: 1, dz: 31 }, { t: 'border', lane: 0, dz: 31 },
      { t: 'beer', lane: 0, dz: 6.6, y: 0.42 },
      { t: 'beer', lane: 1, dz: 15 }, { t: 'beer', lane: 1, dz: 16.6 },
      { t: 'beer', lane: -1, dz: 22.6, y: 1.0 },
      { t: 'beer', lane: -1, dz: 31 },
    ],
  },
  {
    id: 'the-gauntlet-run', tier: 3, len: 43, weight: 3, density: 'dense',
    items: [
      { t: 'border', lane: -1, dz: 8 }, { t: 'border', lane: 1, dz: 8 },
      { t: 'clothesline', lane: -1, dz: 17 }, { t: 'clothesline', lane: 0, dz: 17 },
      { t: 'checkpoint', lane: 1, dz: 26 }, { t: 'copcar', lane: 0, dz: 26 },
      { t: 'crates', lane: -1, dz: 35 }, { t: 'crates', lane: 0, dz: 35 },
      { t: 'crates', lane: 1, dz: 35 },
      { t: 'beer', lane: 0, dz: 8 }, { t: 'beer', lane: 0, dz: 9.6 },
      { t: 'beer', lane: 1, dz: 16.4 }, { t: 'beer', lane: 1, dz: 18 },
      { t: 'beer', lane: -1, dz: 26 }, { t: 'beer', lane: -1, dz: 27.6 },
      { t: 'beer', lane: -1, dz: 33.6, y: 1.0 },
      { t: 'beer', lane: -1, dz: 35, y: 1.45 },
      { t: 'taco', lane: 0, dz: 40 },
    ],
  },
  {
    id: 'wall-of-cops', tier: 3, len: 40, weight: 3, density: 'dense',
    items: [
      { t: 'copcar', lane: -1, dz: 8 }, { t: 'copcar', lane: 0, dz: 8 },
      { t: 'cones', lane: -1, dz: 17 }, { t: 'cones', lane: 0, dz: 17 },
      { t: 'cones', lane: 1, dz: 17 },
      { t: 'copcar', lane: 0, dz: 26 }, { t: 'copcar', lane: 1, dz: 26 },
      { t: 'awning', lane: -1, dz: 35 }, { t: 'awning', lane: 0, dz: 35 },
      { t: 'awning', lane: 1, dz: 35 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: 1, dz: 15.6, y: 1.0 },
      { t: 'beer', lane: 1, dz: 17, y: 1.4 },
      { t: 'beer', lane: -1, dz: 26 }, { t: 'beer', lane: -1, dz: 27.6 },
      { t: 'beer', lane: -1, dz: 34, y: 0.42 },
      { t: 'beer', lane: -1, dz: 36, y: 0.42 },
    ],
  },
  {
    id: 'no-exit', tier: 3, len: 42, weight: 3, density: 'dense',
    items: [
      { t: 'checkpoint', lane: -1, dz: 8 }, { t: 'checkpoint', lane: 0, dz: 8 },
      { t: 'border', lane: 0, dz: 17 }, { t: 'border', lane: 1, dz: 17 },
      { t: 'clothesline', lane: -1, dz: 26 }, { t: 'clothesline', lane: 0, dz: 26 },
      { t: 'clothesline', lane: 1, dz: 26 },
      { t: 'dumpster', lane: -1, dz: 36 }, { t: 'dumpster', lane: 1, dz: 36 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: -1, dz: 17 }, { t: 'beer', lane: -1, dz: 18.6 },
      { t: 'beer', lane: -1, dz: 25, y: 0.42 },
      { t: 'beer', lane: -1, dz: 27, y: 0.42 },
      { t: 'beer', lane: 0, dz: 36 }, { t: 'beer', lane: 0, dz: 37.6 },
      { t: 'taco', lane: 0, dz: 40 },
    ],
  },
  {
    id: 'barrio-blitz', tier: 3, len: 39, weight: 3, density: 'dense',
    items: [
      { t: 'cones', lane: -1, dz: 7 }, { t: 'dumpster', lane: 0, dz: 7 },
      { t: 'crates', lane: 1, dz: 7 },
      { t: 'border', lane: 0, dz: 16 }, { t: 'checkpoint', lane: 1, dz: 16 },
      { t: 'awning', lane: -1, dz: 25 }, { t: 'awning', lane: 0, dz: 25 },
      { t: 'copcar', lane: 0, dz: 34 }, { t: 'copcar', lane: 1, dz: 34 },
      { t: 'beer', lane: 0, dz: 5.6, y: 1.05 },
      { t: 'beer', lane: 0, dz: 7, y: 1.5 },
      { t: 'beer', lane: 0, dz: 8.4, y: 1.05 },
      { t: 'beer', lane: -1, dz: 16 }, { t: 'beer', lane: -1, dz: 17.6 },
      { t: 'beer', lane: -1, dz: 24, y: 0.42 },
      { t: 'beer', lane: -1, dz: 26, y: 0.42 },
      { t: 'beer', lane: -1, dz: 34 }, { t: 'beer', lane: -1, dz: 35.6 },
    ],
  },
  {
    id: 'long-haul', tier: 3, len: 32, weight: 2, density: 'calm',
    items: [
      { t: 'cones', lane: 0, dz: 9 },
      { t: 'beer', lane: 0, dz: 7.6, y: 1.0 },
      { t: 'beer', lane: 0, dz: 9, y: 1.35 },
      { t: 'beer', lane: 0, dz: 10.4, y: 1.0 },
      { t: 'beer', lane: 1, dz: 18 }, { t: 'beer', lane: 1, dz: 20.4 },
      { t: 'beer', lane: 0, dz: 22.8 }, { t: 'beer', lane: -1, dz: 25.2 },
      { t: 'taco', lane: -1, dz: 28 },
    ],
  },
];

// Powerups get sprinkled between chunks rather than baked into them.
const POWERUPS = ['magnet', 'chancla', 'skateboard'];

// ------------------------------------------------------------- set dressing
//
// Decor is scenery only, and the ONE thing keeping it that way is its x.
// game.collide has no idea what a 'decor' kind is; anything that reaches the
// bottom of that loop is a crash. What it never reaches is the bottom of the
// loop, because of this test, which runs before any kind check:
//
//     if (Math.abs(o.x - p.x) > (o.w + HITBOX.w) * 0.5) continue;
//
// The player's x is a lerp toward lane * LANE_W and never overshoots, so
// |p.x| <= LANE_W. Every decor spec carries w = DECOR_HIT_W, so the widest
// clearance any of them needs is (DECOR_HIT_W + HITBOX.w) / 2. DECOR_X_MIN is
// that number plus a fat margin, and spawnDecor clamps to it — there is no
// path that puts set dressing inside a lane, whatever a caller asks for.
const DECOR_REACH = LANE_W + (DECOR_HIT_W + HITBOX.w) * 0.5;   // 1.36 today
const DECOR_X_MIN = DECOR_REACH + 0.2;                          // 1.56
const DECOR_X_MAX = 1.94;                                       // wall is at 2.05

/**
 * `x` is the anchor the art is drawn around, `pitch` the minimum z separation
 * from the previous piece on the SAME wall (roughly its own footprint, so two
 * junkers never telescope into one another).
 */
const DECOR = [
  { t: 'junker',    weight: 3, x: 1.75, pitch: 3.4 },
  { t: 'stall',     weight: 3, x: 1.74, pitch: 2.8 },
  { t: 'pallets',   weight: 6, x: 1.72, pitch: 1.7 },
  { t: 'bags',      weight: 9, x: 1.72, pitch: 1.3 },
  { t: 'cart',      weight: 5, x: 1.72, pitch: 1.4 },
  { t: 'drums',     weight: 6, x: 1.72, pitch: 1.5 },
  { t: 'pigeons',   weight: 7, x: 1.66, pitch: 1.1 },
  { t: 'cardboard', weight: 8, x: 1.70, pitch: 1.2 },
  { t: 'tyres',     weight: 5, x: 1.74, pitch: 1.2 },
  { t: 'hydrant',   weight: 4, x: 1.80, pitch: 1.1 },
  { t: 'plants',    weight: 5, x: 1.78, pitch: 1.1 },
  { t: 'sign',      weight: 4, x: 1.82, pitch: 1.3 },
  { t: 'mattress',  weight: 4, x: 1.80, pitch: 1.7 },
];

// Flattened pick table, built once. Picking by weight per item would either
// allocate an array every call or walk the list; this is a single index.
const DECOR_BAG = [];
for (const d of DECOR) {
  for (let i = 0; i < d.weight; i++) DECOR_BAG.push(d);
}

// How far ahead of the authored chunks the dressing is laid down. Decor has to
// exist before a chunk streams into view or the gutters pop in behind it.
const DECOR_LEAD = 12;

export class World {
  constructor() {
    this.reset();
  }

  reset() {
    this.objects = [];
    this.zCursor = 40;          // first obstacle sits a beat ahead of the start
    this.seed = 1;
    this.recent = [];           // last few chunk ids, to stop patterns repeating
    this.sincePower = 0;
    this.sinceTaco = 0;
    this.sinceDense = 99;       // non-dense chunks since the last gauntlet
    this.stretch = 1;           // z scale for the current speed (see stretchFor)
    this.tierAge = 0;           // nominal seconds since the current tier opened
    // Dressing starts almost under the camera so the menu alley is never bare.
    this.decorZ = 4;
    this.decorSideZ = [4, 4];   // last placed z, per wall: [left, right]
  }

  /**
   * Difficulty tier from distance travelled — but gated on the TIME that
   * distance implies, not the distance itself. See PACING in config.js: metres
   * are a clock that speeds up, so the old metre gates outran the player.
   */
  tierFor(distance) {
    const t = secondsAt(distance);
    const gates = PACING.tierSeconds;
    let tier = 0;
    for (let i = 1; i < gates.length; i++) if (t >= gates[i]) tier = i;
    return tier;
  }

  /**
   * How far the alley is stretched along z right now. 1 at starting speed and
   * rising with it, so a pattern authored at 15 u/s keeps most of its reaction
   * time at 33. Clamped below at 1: stretching may only ever add room.
   */
  stretchFor(distance) {
    const k = speedAt(distance) / V0;
    const s = 1 + (k - 1) * PACING.speedComp;
    return Math.min(PACING.maxStretch, Math.max(1, s));
  }

  /** Keep roughly DRAW_DIST of alley authored ahead of the runner. */
  ensureAhead(playerZ, distance) {
    const tier = this.tierFor(distance);
    this.stretch = this.stretchFor(distance);
    this.tierAge = secondsAt(distance) - PACING.tierSeconds[tier];
    let guard = 0;
    while (this.zCursor < playerZ + DRAW_DIST + 30 && guard++ < 12) {
      this.placeChunk(tier);
    }
  }

  placeChunk(tier, stretch = this.stretch) {
    const chunk = this.pickChunk(tier);
    this.remember(chunk.id);

    const base = this.zCursor;
    let hadTaco = false;
    for (const it of chunk.items) {
      this.spawn(it.t, it.lane, base + it.dz * stretch, it.y);
      if (it.t === 'taco') hadTaco = true;
    }

    // Breathing room between chunks — pulsed, not constant. A gauntlet earns a
    // long empty stretch behind it, and that stretch is where the alley itself
    // gets to be the thing you look at.
    //
    // Numbers in PACING; the whole gap rides the same stretch as the chunk, so
    // it holds a constant number of seconds rather than a constant distance.
    const dense = chunk.density === 'dense';
    const pad = dense ? PACING.gapDense : chunk.density === 'calm' ? PACING.gapCalm : 0;
    const gap = Math.max(PACING.gapMin,
      PACING.gapBase - tier * PACING.gapTier + pad + Math.random() * PACING.gapJitter) * stretch;
    this.zCursor = base + chunk.len * stretch + gap;
    this.sinceDense = dense ? 0 : this.sinceDense + 1;

    // Stamina safety valve: never let three chunks pass without food, or a
    // fast run starves out through no fault of the player.
    this.sinceTaco = hadTaco ? 0 : this.sinceTaco + 1;
    if (this.sinceTaco >= 2) {
      this.sinceTaco = 0;
      this.spawn('taco', [-1, 0, 1][Math.floor(Math.random() * 3)], this.zCursor - gap * 0.6);
    }

    // A powerup every few chunks, always in a lane, always reachable.
    this.sincePower++;
    if (this.sincePower >= 4 && Math.random() < 0.75) {
      this.sincePower = 0;
      const type = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
      const lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
      this.spawn(type, lane, this.zCursor - gap * 0.5);
    }

    this.streamDecor(this.zCursor + DECOR_LEAD * stretch, stretch);
  }

  /**
   * Weighted pick. Three jobs, and the last two are the pacing ones:
   *
   *   * avoid the last few chunk ids outright, so patterns stay unfamiliar;
   *   * keep gauntlets apart — PACING.denseSpacing normal chunks have to pass
   *     before another dense one is eligible. The old rule only forbade two in
   *     a row, which still let tier 3 alternate gauntlet/normal indefinitely;
   *   * PHASE IN the newest tier instead of unlocking it. Reaching a tier used
   *     to hand its chunks a flat weight bonus, so the boundary opened every
   *     hard pattern at full rate the instant it was crossed. Now the newest
   *     tier starts as a rare guest and grows into the headliner over
   *     PACING.tierPhaseIn seconds.
   */
  pickChunk(tier) {
    const fresh = (c) => !this.recent.includes(c.id);
    const spaced = (c) => c.density !== 'dense' || this.sinceDense >= PACING.denseSpacing;
    let pool = CHUNKS.filter(c => c.tier <= tier && fresh(c) && spaced(c));
    // Relax, in order, until something is left. Tier 0 only has so many chunks,
    // and the dense rule is the first thing to give — but never all the way to
    // back-to-back gauntlets while any alternative exists.
    if (!pool.length) pool = CHUNKS.filter(c => c.tier <= tier && fresh(c)
      && (c.density !== 'dense' || this.sinceDense >= 1));
    if (!pool.length) pool = CHUNKS.filter(c => c.tier <= tier && fresh(c));
    if (!pool.length) pool = CHUNKS.filter(c => c.tier <= tier && c.id !== this.recent[0]);
    if (!pool.length) pool = CHUNKS.filter(c => c.tier <= tier);

    const [wLo, wHi] = PACING.newTierWeight;
    const frac = Math.max(0, Math.min(1, this.tierAge / PACING.tierPhaseIn));
    const mul = wLo + (wHi - wLo) * frac;
    const weightOf = (c) => c.weight
      * (c.tier === tier ? mul : Math.pow(PACING.tierFade, tier - c.tier));

    let total = 0;
    for (const c of pool) total += weightOf(c);
    let roll = Math.random() * total;
    for (const c of pool) {
      roll -= weightOf(c);
      if (roll <= 0) return c;
    }
    return pool[pool.length - 1] || CHUNKS[0];
  }

  remember(id) {
    this.recent.unshift(id);
    if (this.recent.length > 4) this.recent.length = 4;
  }

  spawn(type, lane, z, yOverride) {
    const spec = PROP_SPEC[type];
    if (!spec) return;
    this.objects.push({
      type,
      kind: spec.kind,
      lane,
      x: lane * LANE_W,
      z,
      y: yOverride != null ? yOverride : spec.y,
      w: spec.w,
      h: spec.h,
      seed: this.seed++ * 0.618,
      dead: false,
      pulled: false,
    });
  }

  /**
   * Lay set dressing in the gutters up to `toZ`.
   *
   * Deliberately clumpy. Evenly spaced props read as wallpaper — the eye locks
   * onto the rhythm and stops seeing the objects. A knot of four things and
   * then twelve metres of nothing reads as a place, and it also means the
   * quiet stretches after a gauntlet are quiet to look at as well as to play.
   *
   * The gaps ride the same `stretch` as the chunks, for the same reason: a
   * fixed z spacing means the gutters stream past twice as fast at top speed
   * as at the start, and that flicker is a large part of what reads as "too
   * fast" long before any of it is actually unfair. `pitch` is deliberately
   * NOT stretched — it is the art's own footprint, not a rhythm.
   */
  streamDecor(toZ, stretch = this.stretch) {
    let guard = 0;
    while (this.decorZ < toZ && guard++ < 240) {
      const clump = 1 + Math.floor(Math.random() * 3.4);
      let reach = this.decorZ;
      for (let i = 0; i < clump; i++) {
        const d = DECOR_BAG[Math.floor(Math.random() * DECOR_BAG.length)];
        const side = Math.random() < 0.5 ? -1 : 1;
        const si = side < 0 ? 0 : 1;
        let z = this.decorZ + i * (0.9 + Math.random() * 1.5) * stretch;
        // Keep neighbours on the same wall from telescoping into one blob.
        if (z - this.decorSideZ[si] < d.pitch) z = this.decorSideZ[si] + d.pitch;
        this.decorSideZ[si] = z;
        this.spawnDecor(d.t, side * (d.x + (Math.random() - 0.5) * 0.12), z);
        if (z > reach) reach = z;
      }
      // Skewed gap: usually a short breath, occasionally a long clean run.
      // Lands at roughly one piece every four units at starting speed, so
      // something is entering frame about six times a second without the prop
      // count inside DRAW_DIST running away from the fill budget.
      this.decorZ = reach + (3.2 + Math.random() * Math.random() * 15) * stretch;
    }
    if (this.decorZ < toZ) this.decorZ = toZ;
  }

  /**
   * Spawn one piece of set dressing at world x (signed). The clamp is the
   * guard rail: no matter what a caller passes, decor lands in the gutter.
   */
  spawnDecor(type, x, z) {
    const spec = PROP_SPEC[type];
    if (!spec || spec.kind !== 'decor') return;
    const mag = Math.min(DECOR_X_MAX, Math.max(DECOR_X_MIN, Math.abs(x)));
    this.objects.push({
      type,
      kind: 'decor',
      lane: null,
      x: x < 0 ? -mag : mag,
      z,
      y: 0,
      w: spec.w,
      h: spec.h,
      seed: this.seed++ * 0.618,
      dead: false,
      pulled: false,
    });
  }

  /** Drop anything the camera has already passed. */
  prune(playerZ) {
    const cut = playerZ - 12;
    if (this.objects.length > 260) {
      this.objects = this.objects.filter(o => o.z > cut && !o.dead);
    } else {
      for (let i = this.objects.length - 1; i >= 0; i--) {
        if (this.objects[i].z < cut) this.objects.splice(i, 1);
      }
    }
  }
}

// Exported for the fairness/decor checks in dev — see the notes above DECOR.
export { CHUNKS, DECOR_X_MIN, DECOR_X_MAX };
