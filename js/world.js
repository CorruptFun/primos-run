// Procedural alley generator. Hand-authored chunks keep every pattern fair —
// each one always leaves at least one survivable line through it.

import { LANE_W, DRAW_DIST } from './config.js';
import { PROP_SPEC } from './art/props.js';

/**
 * Chunks are authored in local space: `dz` is metres from the chunk start,
 * `lane` is -1/0/1. `tier` gates a chunk until the run has heated up.
 */
const CHUNKS = [
  // ---- tier 0: teach the verbs -------------------------------------------
  {
    id: 'open-road', tier: 0, len: 16, weight: 3,
    items: [
      { t: 'beer', lane: 0, dz: 3 }, { t: 'beer', lane: 0, dz: 4.6 },
      { t: 'beer', lane: 0, dz: 6.2 }, { t: 'beer', lane: 0, dz: 7.8 },
    ],
  },
  {
    id: 'first-checkpoint', tier: 0, len: 20, weight: 4,
    items: [
      { t: 'checkpoint', lane: 0, dz: 9 },
      { t: 'beer', lane: -1, dz: 7 }, { t: 'beer', lane: -1, dz: 8.6 },
      { t: 'beer', lane: -1, dz: 10.2 }, { t: 'beer', lane: -1, dz: 11.8 },
    ],
  },
  {
    id: 'hop-the-dumpster', tier: 0, len: 20, weight: 4,
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
    id: 'duck-the-laundry', tier: 0, len: 20, weight: 4,
    items: [
      { t: 'clothesline', lane: 0, dz: 9 },
      { t: 'beer', lane: 0, dz: 8.4, y: 0.42 },
      { t: 'beer', lane: 0, dz: 9.6, y: 0.42 },
      { t: 'beer', lane: 1, dz: 12.5 },
    ],
  },
  {
    id: 'taco-stand', tier: 0, len: 18, weight: 3,
    items: [
      { t: 'taco', lane: 0, dz: 8 },
      { t: 'beer', lane: -1, dz: 6 }, { t: 'beer', lane: 1, dz: 6 },
      { t: 'beer', lane: -1, dz: 11 }, { t: 'beer', lane: 1, dz: 11 },
    ],
  },

  // ---- tier 1: commit to a lane ------------------------------------------
  {
    id: 'border-gap-left', tier: 1, len: 24, weight: 4,
    items: [
      { t: 'border', lane: 0, dz: 11 }, { t: 'border', lane: 1, dz: 11 },
      { t: 'beer', lane: -1, dz: 8 }, { t: 'beer', lane: -1, dz: 9.6 },
      { t: 'beer', lane: -1, dz: 11.2 }, { t: 'beer', lane: -1, dz: 12.8 },
      { t: 'taco', lane: -1, dz: 15.5 },
    ],
  },
  {
    id: 'border-gap-right', tier: 1, len: 24, weight: 4,
    items: [
      { t: 'border', lane: -1, dz: 11 }, { t: 'border', lane: 0, dz: 11 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: 1, dz: 11.2 }, { t: 'beer', lane: 1, dz: 12.8 },
    ],
  },
  {
    id: 'checkpoint-pair', tier: 1, len: 26, weight: 4,
    items: [
      { t: 'checkpoint', lane: -1, dz: 9 }, { t: 'checkpoint', lane: 0, dz: 9 },
      { t: 'copcar', lane: 1, dz: 17 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 9.6 },
      { t: 'beer', lane: 0, dz: 16 }, { t: 'beer', lane: 0, dz: 17.6 },
    ],
  },
  {
    id: 'dumpster-row', tier: 1, len: 22, weight: 3,
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
    id: 'awning-run', tier: 1, len: 24, weight: 3,
    items: [
      { t: 'awning', lane: -1, dz: 9 }, { t: 'awning', lane: 0, dz: 9 },
      { t: 'awning', lane: 1, dz: 9 },
      { t: 'taco', lane: 0, dz: 9, y: 0.45 },
      { t: 'beer', lane: -1, dz: 14 }, { t: 'beer', lane: 1, dz: 14 },
    ],
  },
  {
    id: 'cone-slalom', tier: 1, len: 26, weight: 3,
    items: [
      { t: 'cones', lane: -1, dz: 7 },
      { t: 'cones', lane: 0, dz: 13 },
      { t: 'cones', lane: 1, dz: 19 },
      { t: 'beer', lane: 0, dz: 7 }, { t: 'beer', lane: 1, dz: 13 },
      { t: 'beer', lane: -1, dz: 19 },
    ],
  },

  // ---- tier 2: stack the verbs -------------------------------------------
  {
    id: 'checkpoint-gauntlet', tier: 2, len: 34, weight: 4,
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
    id: 'wall-then-duck', tier: 2, len: 30, weight: 4,
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
    id: 'jump-then-swerve', tier: 2, len: 30, weight: 4,
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
    id: 'migra-blockade', tier: 2, len: 32, weight: 3,
    items: [
      { t: 'copcar', lane: -1, dz: 10 }, { t: 'copcar', lane: 1, dz: 10 },
      { t: 'border', lane: 0, dz: 20 }, { t: 'border', lane: -1, dz: 20 },
      { t: 'beer', lane: 0, dz: 9 }, { t: 'beer', lane: 0, dz: 10.6 },
      { t: 'beer', lane: 1, dz: 19 }, { t: 'beer', lane: 1, dz: 20.6 },
      { t: 'beer', lane: 1, dz: 22.2 },
    ],
  },

  // ---- tier 3: no mercy ---------------------------------------------------
  {
    id: 'the-corridor', tier: 3, len: 40, weight: 4,
    items: [
      { t: 'border', lane: -1, dz: 8 }, { t: 'border', lane: 0, dz: 8 },
      { t: 'clothesline', lane: 1, dz: 15 },
      { t: 'checkpoint', lane: 1, dz: 23 }, { t: 'checkpoint', lane: 0, dz: 23 },
      { t: 'dumpster', lane: -1, dz: 31 }, { t: 'dumpster', lane: 0, dz: 31 },
      { t: 'dumpster', lane: 1, dz: 31 },
      { t: 'beer', lane: 1, dz: 8 }, { t: 'beer', lane: 1, dz: 14.6, y: 0.42 },
      { t: 'beer', lane: -1, dz: 23 }, { t: 'beer', lane: -1, dz: 24.6 },
      { t: 'beer', lane: -1, dz: 30, y: 1.1 }, { t: 'beer', lane: -1, dz: 31.4, y: 1.5 },
      { t: 'taco', lane: 0, dz: 37 },
    ],
  },
  {
    id: 'zigzag-walls', tier: 3, len: 38, weight: 4,
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
    id: 'full-send', tier: 3, len: 36, weight: 3,
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
];

// Powerups get sprinkled between chunks rather than baked into them.
const POWERUPS = ['magnet', 'chancla', 'lowrider'];

export class World {
  constructor() {
    this.reset();
  }

  reset() {
    this.objects = [];
    this.zCursor = 40;          // first obstacle sits a beat ahead of the start
    this.seed = 1;
    this.lastChunk = null;
    this.sincePower = 0;
    this.sinceTaco = 0;
    this.decor = [];
  }

  /** Difficulty tier from distance travelled. */
  tierFor(distance) {
    if (distance < 320) return 0;
    if (distance < 900) return 1;
    if (distance < 1900) return 2;
    return 3;
  }

  /** Keep roughly DRAW_DIST of alley authored ahead of the runner. */
  ensureAhead(playerZ, distance) {
    const tier = this.tierFor(distance);
    let guard = 0;
    while (this.zCursor < playerZ + DRAW_DIST + 30 && guard++ < 12) {
      this.placeChunk(tier);
    }
  }

  placeChunk(tier) {
    const pool = CHUNKS.filter(c => c.tier <= tier && c.id !== this.lastChunk);
    // Bias toward the newest tier so the run keeps escalating.
    const weighted = [];
    for (const c of pool) {
      const bias = c.tier === tier ? c.weight + 2 : c.weight;
      for (let i = 0; i < bias; i++) weighted.push(c);
    }
    const chunk = weighted[Math.floor(Math.random() * weighted.length)] || CHUNKS[0];
    this.lastChunk = chunk.id;

    const base = this.zCursor;
    let hadTaco = false;
    for (const it of chunk.items) {
      this.spawn(it.t, it.lane, base + it.dz, it.y);
      if (it.t === 'taco') hadTaco = true;
    }

    // Breathing room between chunks, tighter as things speed up.
    const gap = 10 - tier * 1.6;
    this.zCursor = base + chunk.len + gap;

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
