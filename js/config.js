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
// Where haze begins eating colour. This is a READABILITY number, not a look
// one: at 33 u/s, 42u of clear alley is 1.27 seconds of warning about what is
// coming, and players reported obstacles being hard to see in time. 50u buys
// about a fifth of a second more. It costs nothing to draw — props are drawn
// out to DRAW_DIST either way, this only changes the alpha they get there.
export const FOG_START = 50;

export const RUN = {
  startSpeed: 15.0,                  // units/sec
  maxSpeed: 33.0,
  // Units/sec added per second survived. Was 0.135, which put you at top speed
  // 133s in; 0.12 makes that 150s. Nothing else moves with it — the tier
  // schedule in PACING is gated on time, and the chunk stretch is a function
  // of speed, so this changes ONLY how long the climb takes. It is the one
  // knob to turn back first if the run ever reads as sluggish.
  accel: 0.12,
  gassedSpeed: 8.5,                  // crawl once stamina is gone
  laneSnap: 11.0,                    // how fast you slide between lanes
  gravity: -52.0,
  // apex = v^2 / (2g): 1.43u standing, 2.16u on the skateboard. Tuned so a jump
  // clears dumpsters/crates/cones but never a checkpoint or a border wall.
  jumpV: 12.2,
  boardJumpV: 15.0,
  slideTime: 0.62,
  stumbleTime: 0.55,
};

// ------------------------------------------------------------------- pacing
// How the run gets harder. Everything here exists because of one mistake made
// twice: the world used to measure the run in METRES while the runner's
// metres-per-second keeps climbing, so every metre-denominated rule tightened
// itself behind your back.
//
//   * Tiers were gated on distance. Distance accelerates, so the tiers arrived
//     about three times faster than the speed curve did — the gauntlets landed
//     90s in, while top speed is 133s away, and tier 0 was over in 20s.
//     `tierSeconds` gates on TIME survived instead. world.js derives that from
//     distance in closed form, so nothing outside world.js has to change.
//   * Chunk spacing was authored in fixed world units, and a fixed distance is
//     a SHRINKING reaction time: 9u is 0.60s at 15 u/s and 0.27s at 33 u/s,
//     which is below human reaction time — the only way to survive it was to
//     have memorised the pattern. `speedComp` stretches every chunk along z as
//     the run speeds up, so the SECONDS between rows stay roughly flat.
//
// The useful consequence of stretching in proportion to speed is that a chunk
// takes a constant amount of TIME to run through, whatever the speed. Tacos,
// powerups and stamina are all metered per chunk, so they stay in step for
// free.
export const PACING = {
  // Seconds survived at which each tier opens. Deliberately widening — 45s,
  // then 65, then 85 — so each tier is longer than the last and competence has
  // room to catch up with the alley.
  tierSeconds: [0, 35, 90, 160],
  // Seconds a freshly opened tier takes to reach its full share of the pick
  // table. Without this, crossing a boundary unlocks every hard pattern at
  // once and the step reads as a wall rather than a ramp. Longer than the
  // narrowest tier on purpose, so the phase-ins overlap and the curve has no
  // corners in it.
  tierPhaseIn: 45,
  // Weight multiplier on the newest tier's chunks: start of phase-in -> end.
  // Ends above 1 so the run still escalates once the tier has settled in.
  newTierWeight: [0.2, 2.6],
  // ...and every tier BELOW the current one is multiplied by this per step
  // down. Without it the ten tier-0 chunks keep full weight forever and a
  // five-minute run still spends a third of itself in the tutorial, which is
  // its own kind of bad pacing. Kept well above zero so the calm patterns
  // survive as breathers.
  tierFade: 0.62,
  // Fraction of the speed increase paid back as extra spacing. 1.0 would hold
  // reaction time perfectly constant and make speed pure spectacle; a little
  // under that lets the alley still tighten as the run goes on.
  speedComp: 0.68,
  maxStretch: 2.4,          // ceiling, so a future maxSpeed can't run away
  // Non-dense chunks required after a gauntlet before another may be picked.
  // The old rule only blocked two dense chunks back to back, which still let
  // tier 3 alternate gauntlet/normal forever.
  denseSpacing: 2,

  // The quiet after a chunk, in world units at starting speed — placeChunk
  // multiplies the lot by the same stretch as the chunk itself, so it is
  // really a number of SECONDS. `gapTier` used to be 1.6, which slammed the
  // gap shut at exactly the tiers whose patterns were nastiest; it is a light
  // touch now and the escalation is carried by which chunks get picked.
  gapBase: 10,
  gapTier: 1.2,
  gapJitter: 3,
  gapMin: 4.5,
  gapDense: 4,              // a gauntlet earns extra open alley behind it
  gapCalm: -1.5,
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
  skateboard: { time: 13.0, label: 'SKATEBOARD',      color: '#4dd8ff' },
};

export const MAGNET_RADIUS = 3.6;
export const CHANCLA_SPEED = 1.55;

// ICE air support — the drone that comes flying down your lane late in the
// run. An EVENT, not a prop: it is scheduled off time survived, telegraphs
// loudly, dives the lane you were standing in when the siren started, and
// leaves. The two ways out are the two verbs the alley already taught: change
// lanes, or slide under it.
//
// TIME-GATED, NEVER DISTANCE-GATED — the same scar PACING documents twice:
// distance accelerates, so anything keyed on metres arrives faster every
// minute the player survives. `startTime` sits between tier 2 (90s) and
// tier 3 (160s): the alley is already asking real questions, the gauntlets
// have not opened, and a drone landing there reads as an escalation rather
// than a pile-on.
//
// FAIR BY CONSTRUCTION, like the chunks: the lane is locked when the WARNING
// starts and never retargets, so switching lanes always dodges; `height` sits
// between the slide hitbox (0.72) and the standing one (1.62), so staying put
// and sliding also dodges. Jumping does NOT clear it — apex 1.43 lifts you
// INTO the hull, which is the checkpoint rule's shape: the alley's tall
// things are answered by lanes and slides, never by faith in a jump.
export const DRONE = {
  startTime: 110,       // seconds survived before the first event can launch
  interval: 46,         // seconds between events…
  intervalJitter: 18,   // …plus up to this much, so it never turns metronomic
  telegraph: 1.7,       // siren + searchlight before the first pass
  reTelegraph: 1.05,    // re-lock warning between passes in one event
  approach: 30,         // closing u/s ON TOP of the player's own speed
  spawnAhead: 46,       // units ahead where the dive begins — ~0.8s of strike
  passBehind: 7,        // units past the player before a pass counts as dodged
  hover: 2.6,           // cruise height while telegraphing, well over the head
  height: 1.12,         // hull underside during the dive: slide clears, standing does not
  w: 0.72,              // hull half-width-ish for the lane hit test
  // Passes per event, escalating with the event count and clamping at the
  // tail. The first drone is a warning shot; by the third event it is a
  // proper strafing run.
  passes: [1, 2, 2, 3],
};

// Getting back up after La Migra had you. Shared by the vida bought ahead of
// time at la tiendita and the continue paid for at the moment of the bust, so
// the two can never feel different.
//
// The PRICES are not here — they sit with the catalog in js/tiendita.js,
// because a price and the thing it buys are one row of one table.
export const REPRIEVE = {
  invuln: 2.4,        // seconds where nothing can touch you
  clear: 16,          // units of alley swept ahead, so you do not get back up
                      // inside the dumpster that just put you down
  grace: 2.0,         // seconds before La Migra starts building again
};

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
  // A menu press. The shortest one in the table on purpose: it fires on every
  // button in the game, so anything you can still feel a moment later is a tic.
  ui: 6,
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
  // The drone warning — bust's rhythm at a fraction of its weight, because it
  // means "incoming", not "over". Fires per telegraph, so it stays short.
  drone: [18, 34, 18],
};
