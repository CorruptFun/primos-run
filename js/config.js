// Tunables for PRIMOS: BARRIO RUN.
// World units: 1 unit == 1 lane width. Ground is y=0, up is +y, forward is +z.

export const LANES = [-1, 0, 1];
export const LANE_W = 1.0;
export const ALLEY_HALF = 2.05;      // x of the alley walls
export const WALL_H = 4.2;           // how tall the alley walls stand

export const CAM = {
  // Close and low, deliberately. Sitting further back shrinks the runner to a
  // sixteenth of the screen, and on a phone that is the difference between a
  // character you play as and a sprite you supervise. Pulling in to 4.25 puts
  // the runner at roughly a fifth of frame height, which is where the genre
  // sits. The cost is less warning before an obstacle — RUN.startSpeed and the
  // chunk spacing in world.js are what pay for that.
  height: 2.25,        // eye height above the asphalt
  back: 4.25,          // how far behind the runner the camera sits
  focal: 1.15,         // multiplied by canvas width to get focal length px
  horizon: 0.40,       // fraction of canvas height where y=camHeight lands
  lag: 0.34,           // how much of the runner's sideways move the camera copies
  near: 0.35,          // anything closer than this is clipped away
};

export const DRAW_DIST = 95;         // units of alley kept on screen
export const FOG_START = 42;         // haze begins eating colour here

export const RUN = {
  startSpeed: 15.0,                  // units/sec
  maxSpeed: 33.0,
  accel: 0.135,                      // units/sec added per second survived
  gassedSpeed: 8.5,                  // crawl once stamina is gone
  laneSnap: 11.0,                    // how fast you slide between lanes
  gravity: -52.0,
  // apex = v^2 / (2g): 1.43u standing, 2.16u on the lowrider. Tuned so a jump
  // clears dumpsters/crates/cones but never a checkpoint or a border wall.
  jumpV: 12.2,
  boardJumpV: 15.0,
  slideTime: 0.62,
  stumbleTime: 0.55,
};

export const STAMINA = {
  max: 100,
  start: 78,
  drainBase: 2.6,                    // per second at startSpeed
  drainSpeedFactor: 0.55,            // extra drain scaled by how fast you're going
  taco: 34,
  lowWarn: 30,
};

// La Migra pressure. Hits push it up, clean running pulls it down.
export const CHASE = {
  max: 100,
  hit: 46,
  decay: 7.2,                        // per second while clean
  gassedGain: 13.0,                  // per second once stamina hits zero
  grace: 1.1,                        // seconds after a hit before decay resumes
};

export const POWER = {
  magnet:   { time: 10.0, label: 'PIÑATA MAGNET', color: '#ff4d9d' },
  chancla:  { time: 6.5,  label: 'CHANCLA RUSH',  color: '#ffcf3d' },
  lowrider: { time: 13.0, label: 'LOWRIDER',      color: '#4dd8ff' },
};

export const MAGNET_RADIUS = 3.6;
export const CHANCLA_SPEED = 1.55;

export const SCORE = {
  beer: 10,
  perUnit: 1.0,                      // score per world unit travelled
  comboStep: 8,                      // beers per multiplier bump
  comboMax: 8,
};

// Collision box for the runner, in world units.
export const HITBOX = {
  w: 0.52,
  standH: 1.62,
  slideH: 0.72,
  depth: 0.55,
};

// ------------------------------------------------------------- mobile budget
// Fill rate, not logic, is what drops a phone under 60 here — the alley is
// hundreds of overlapping path fills per frame. Both levers below take away
// pixels and never geometry, so a struggling device gets a softer picture
// rather than an emptier alley.
export const MOBILE = {
  dprCap: 1.5,          // past this, retina buys nothing you can see at arm's length
  scaleMin: 0.7,        // floor for the dynamic scene scale
  scaleMax: 1.0,
  scaleStep: 0.06,
  budgetMs: 14,         // frame work above this sheds resolution
  comfortMs: 10.5,      // below this we start winning it back
  window: 24,           // frames per decision — long enough to ignore one hitch
  settleMs: 500,        // min gap between changes; resizing a canvas is not free
};

// Camera feel. Every value is a spring target the run implies — none of them
// touch the physics the player is actually judged against, so juice can never
// cost you a run.
export const JUICE = {
  tiltMax: 0.05,        // radians of roll at full lane-change velocity
  tiltRate: 9,          // how fast roll chases its target
  bobAmp: 3.2,          // px of vertical bob at the run cadence
  bobRate: 2,           // bobs per stride
  fovKick: 0.1,         // focal shrinks by this fraction at top speed (wider view)
  fovRush: 0.08,        // extra widening during a chancla rush
  fovRate: 2.6,
  nearMiss: 0.7,        // world units — closer than this and you feel the dodge
  nearMissShake: 0.14,
};

// Look. Wetness drives the reflection strength on the asphalt.
export const FX = {
  wetness: 0.85,        // 0 dry alley, 1 rain-slicked
  puddleFade: 26,       // world units where puddles stop being drawn
  bloomStrength: 0.5,
};

// Vibration patterns, in ms. Kept short — long buzzes read as a malfunction.
export const HAPTICS = {
  lane: 9,
  blocked: [5, 20, 5],
  jump: 7,
  slide: 6,
  beer: 5,
  taco: [8, 24, 8],
  power: [12, 26, 18],
  hit: [26, 44, 26],
  smash: [10, 18, 22],
  bust: [40, 70, 40, 70, 110],
};
