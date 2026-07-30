// Tunables for PRIMOS: BARRIO RUN.
// World units: 1 unit == 1 lane width. Ground is y=0, up is +y, forward is +z.

export const LANES = [-1, 0, 1];
export const LANE_W = 1.0;
export const ALLEY_HALF = 2.05;      // x of the alley walls
export const WALL_H = 4.2;           // how tall the alley walls stand

export const CAM = {
  height: 2.62,        // eye height above the asphalt
  back: 5.3,           // how far behind the runner the camera sits
  focal: 1.15,         // multiplied by canvas width to get focal length px
  horizon: 0.42,       // fraction of canvas height where y=camHeight lands
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
