// Pseudo-3D projection. Everything on screen goes through project().

import { CAM } from './config.js';

export const cam = {
  x: 0,
  y: CAM.height,
  z: -CAM.back,
  shake: 0,
  shakeX: 0,
  shakeY: 0,
  roll: 0,
};

let W = 0, H = 0, focal = 0, horizon = 0;

export function resizeCamera(w, h) {
  W = w;
  H = h;
  // Keep the focal length tied to width so the alley reads the same on any aspect.
  focal = w * CAM.focal;
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
    y: horizon + (cam.y - y) * scale + cam.shakeY,
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
    y: horizon + (cam.y - y) * scale + cam.shakeY,
    scale,
    dz,
  };
}

export function updateCamera(dt, targetX, targetZ, targetY) {
  cam.x += (targetX * CAM.lag - cam.x) * Math.min(1, dt * 7.5);
  cam.z = targetZ - CAM.back;
  // A touch of vertical follow so big jumps still frame the runner.
  const wantY = CAM.height + Math.max(0, targetY) * 0.34;
  cam.y += (wantY - cam.y) * Math.min(1, dt * 6);

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
}
