// Pseudo-3D projection. Everything on screen goes through project().

import { CAM, JUICE, RUN } from './config.js';

export const cam = {
  x: 0,
  y: CAM.height,
  z: -CAM.back,
  shake: 0,
  shakeX: 0,
  shakeY: 0,
  roll: 0,
};

let W = 0, H = 0, baseFocal = 0, focal = 0, horizon = 0;

// Juice state. All of it is cosmetic — project() is the only consumer, and
// nothing here feeds back into game.js, so a wide FOV can never move a hitbox.
let fovK = 1;         // current focal multiplier, springs toward fovTarget
let bob = 0;          // vertical head bob, px
let rollV = 0;        // roll velocity, for the lane-change spring

export function resizeCamera(w, h) {
  W = w;
  H = h;
  // Keep the focal length tied to width so the alley reads the same on any aspect.
  baseFocal = w * CAM.focal;
  focal = baseFocal * fovK;
  horizon = h * CAM.horizon;
}

export function viewport() {
  return { W, H, focal, horizon };
}

/**
 * World point -> screen. Returns null when the point is behind the near plane,
 * so callers can skip it instead of drawing a mirrored ghost.
 */
export function project(x, y, z) {
  const dz = z - cam.z;
  if (dz < CAM.near) return null;
  const scale = focal / dz;
  return {
    x: W * 0.5 + (x - cam.x) * scale + cam.shakeX,
    y: horizon + (cam.y - y) * scale + cam.shakeY + bob,
    scale,
    dz,
  };
}

/** Same as project() but clamps to the near plane instead of failing. */
export function projectClamped(x, y, z) {
  const dz = Math.max(CAM.near, z - cam.z);
  const scale = focal / dz;
  return {
    x: W * 0.5 + (x - cam.x) * scale + cam.shakeX,
    y: horizon + (cam.y - y) * scale + cam.shakeY + bob,
    scale,
    dz,
  };
}

/**
 * @param {number} speedK 0 at the starting jog, 1 at top speed
 * @param {number} rush    1 while a chancla rush is active
 * @param {number} phase   run cycle 0..1, for head bob
 * @param {boolean} grounded false while airborne — bob comes from footfalls
 */
export function updateCamera(dt, targetX, targetZ, targetY,
  speedK = 0, rush = 0, phase = 0, grounded = true) {
  cam.x += (targetX * CAM.lag - cam.x) * Math.min(1, dt * 7.5);
  cam.z = targetZ - CAM.back;
  // A touch of vertical follow so big jumps still frame the runner.
  const wantY = CAM.height + Math.max(0, targetY) * 0.34;
  cam.y += (wantY - cam.y) * Math.min(1, dt * 6);

  // ---- FOV. Going faster widens the view, which is the oldest and still the
  // most effective speed cue there is: the walls start streaming past the edges
  // of the frame rather than merely moving. Focal DOWN == FOV wider.
  const wantFov = 1 - speedK * JUICE.fovKick - rush * JUICE.fovRush;
  fovK += (wantFov - fovK) * Math.min(1, dt * JUICE.fovRate);
  focal = baseFocal * fovK;

  // ---- Head bob, on footfalls. Twice per stride, and killed in the air where
  // there is no foot hitting anything to cause it.
  const bobWant = grounded
    ? Math.sin(phase * Math.PI * 2 * JUICE.bobRate) * JUICE.bobAmp * (0.35 + speedK * 0.65)
    : 0;
  bob += (bobWant - bob) * Math.min(1, dt * 14);

  // ---- Lane-change roll. A critically-damped spring toward a target set by
  // how fast the runner is crossing lanes, so the tilt leads the movement and
  // settles without wobbling.
  const want = -(targetX - cam.x / CAM.lag) * JUICE.tiltMax * 1.6;
  const clamped = Math.max(-JUICE.tiltMax, Math.min(JUICE.tiltMax, want));
  const k = JUICE.tiltRate;
  rollV += (clamped - cam.roll) * k * dt * k;
  rollV *= Math.exp(-2 * Math.sqrt(k) * dt);       // damping
  cam.roll += rollV * dt;

  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * 3.2);
    const m = cam.shake * cam.shake * 26;
    cam.shakeX = (Math.random() * 2 - 1) * m;
    cam.shakeY = (Math.random() * 2 - 1) * m;
  } else {
    cam.shakeX = 0;
    cam.shakeY = 0;
  }
}

export function addShake(amount) {
  cam.shake = Math.min(1.6, cam.shake + amount);
}

export function resetCamera(z) {
  cam.x = 0;
  cam.y = CAM.height;
  cam.z = z - CAM.back;
  cam.shake = 0;
  cam.shakeX = 0;
  cam.shakeY = 0;
  cam.roll = 0;
  rollV = 0;
  bob = 0;
  fovK = 1;
  focal = baseFocal;
}
