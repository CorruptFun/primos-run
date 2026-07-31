// Rules of the run: movement, stamina, La Migra pressure, scoring.

import {
  LANE_W, RUN, STAMINA, CHASE, POWER, SCORE, HITBOX,
  MAGNET_RADIUS, CHANCLA_SPEED, JUICE, REPRIEVE,
} from './config.js';
import { World } from './world.js';
import { CREW } from './art/runner.js';
import { resetCamera, updateCamera, addShake } from './camera.js';
import { burst, dust, updateParticles, resetParticles } from './particles.js';
import { startIntro, updateIntro, stopIntro } from './intro.js';
import * as sfx from './audio.js';
// Paired with sfx one-for-one, deliberately: every buzz sits on the same line as
// the sound it belongs to, so the two can never drift apart and there is no
// second list of "moments" to keep in step. Gated by the sound toggle from
// main.js — someone playing silently wants silence, not buzz — and a no-op on
// every device without navigator.vibrate, which includes all of iOS Safari.
import { hap } from './haptics.js';

export const STATE = {
  MENU: 'menu',
  // The opening camera move. The world scrolls and the runner runs, but nothing
  // can be collected, hit, or scored — so the sequence can never cost or earn
  // the player anything before they have control.
  INTRO: 'intro',
  PLAYING: 'playing',
  PAUSED: 'paused',
  OVER: 'over',
};

// z-thickness used for hit tests, by prop kind.
const DEPTH = { pickup: 0.42, power: 0.5, dodge: 0.5, jump: 0.5, slide: 0.55 };

/** Colour-only rig, used until a head sprite has been baked. */
function fallbackRig(c) {
  return {
    head: null,
    shirt: c.shirt, shirtDark: c.shirtDark,
    skin: c.skin, skinDark: c.skinDark,
    pants: c.pants,
    // The runner's head is drawn from these, not from the baked sprite, so they
    // have to survive the fallback path too or a character picked before the
    // bake finishes runs around bald.
    hair: c.hair, hairStyle: c.hairStyle,
    bandana: c.bandana, beanie: c.beanie, hoops: c.hoops, shades: c.shades,
  };
}

export class Game {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.world = new World();
    this.character = CREW[0];
    this.customImage = null;
    this.state = STATE.MENU;
    this.best = 0;
    this.reset();
  }

  reset() {
    this.time = 0;
    this.distance = 0;
    this.score = 0;
    this.beers = 0;
    this.tacos = 0;
    this.combo = 0;
    this.multiplier = 1;
    // Run-shape counters. Cheap ints, counted where the action is accepted —
    // js/jales.js prices the daily missions off this exact bundle, so a stat
    // that stops being counted here silently makes its mission uncompletable
    // (a permanently-stuck bar, which looks like a bug in the MISSION).
    this.jumps = 0;
    this.slides = 0;
    this.smashes = 0;
    this.powerups = 0;
    this.bestMult = 1;
    this.stamina = STAMINA.start;
    this.chase = 0;
    this.chaseGrace = 0;
    this.speed = RUN.startSpeed;
    this.invuln = 0;
    this.hitFlash = 0;
    this.stumble = 0;
    this.gameOverReason = '';
    // Economy state for THIS run. `freeLives` are vidas bought at la tiendita
    // before the run; `continues` counts the ones paid for during it, and is
    // what the price ladder in tiendita.js escalates against.
    this.freeLives = 0;
    this.continues = 0;

    this.power = { magnet: 0, chancla: 0, skateboard: 0 };

    this.player = {
      lane: 0,
      x: 0,
      y: 0,
      vy: 0,
      z: 0,
      phase: 0,
      sliding: false,
      slideT: 0,
      airborne: false,
      lean: 0,
      lastStep: -1,
      rig: this.rig || fallbackRig(this.character),
    };

    this.chaser = { x: 0, z: -30 };

    this.world.reset();
    resetParticles();
    resetCamera(0);
    this.world.ensureAhead(this.player.z, 0);
  }

  /**
   * @param {object} c   crew definition (drives menus + HUD badge)
   * @param {object} rig baked head sprite + outfit palette, from primo-head.js
   * @param {HTMLImageElement} img source image, for the HUD badge
   */
  setCharacter(c, rig, img) {
    this.character = c;
    this.rig = rig || fallbackRig(c);
    this.customImage = img || null;
    this.player.rig = this.rig;
  }

  /** 0 at the starting jog, 1 at top speed — drives lean and run cadence. */
  speedK() {
    return Math.max(0, Math.min(1,
      (this.speed - RUN.startSpeed) / (RUN.maxSpeed - RUN.startSpeed)));
  }

  /**
   * @param {{powers?: string[], fullTank?: boolean, lives?: number}} [loadout]
   *   What the player bought at la tiendita. Already paid for and already
   *   taken off the shelf by the caller — this class knows the rules of the
   *   alley and nothing whatsoever about money.
   */
  start(loadout) {
    this.reset();
    if (loadout) {
      if (loadout.fullTank) this.stamina = STAMINA.max;
      if (loadout.lives) this.freeLives = loadout.lives;
      const powers = loadout.powers;
      if (powers) {
        for (let i = 0; i < powers.length; i++) {
          const def = POWER[powers[i]];
          if (def) this.power[powers[i]] = def.time;
        }
      }
    }
    this.state = STATE.INTRO;
    startIntro(this);
    sfx.startMusic();
    this.hooks.onStateChange?.(this.state);
  }

  /** Cut the opening short — any input during the intro drops you into the run. */
  skipIntro() {
    if (this.state !== STATE.INTRO) return;
    stopIntro();
    this.state = STATE.PLAYING;
    this.hooks.onStateChange?.(this.state);
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    sfx.stopMusic();
    this.hooks.onStateChange?.(this.state);
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAYING;
    sfx.startMusic();
    this.hooks.onStateChange?.(this.state);
  }

  // ------------------------------------------------------------------ input

  moveLane(dir) {
    if (this.state !== STATE.PLAYING) return;
    const next = Math.max(-1, Math.min(1, this.player.lane + dir));
    if (next === this.player.lane) {
      this.player.lean = dir * 0.5;   // little body-check into the wall
      // The input WAS read — it just had nowhere to go. Without this a swipe
      // into the wall is indistinguishable from a swipe the game missed.
      hap.blocked();
      return;
    }
    this.player.lane = next;
    this.player.lean = dir;
    sfx.swipe();
    hap.lane();
  }

  jump() {
    if (this.state !== STATE.PLAYING) return;
    const p = this.player;
    if (p.airborne) return;
    p.vy = this.power.skateboard > 0 ? RUN.boardJumpV : RUN.jumpV;
    p.airborne = true;
    p.sliding = false;
    p.slideT = 0;
    this.jumps++;
    sfx.jump();
    hap.jump();
  }

  slide() {
    if (this.state !== STATE.PLAYING) return;
    const p = this.player;
    if (p.airborne) {
      // Slam back down so a swipe-down out of a jump feels responsive.
      p.vy = Math.min(p.vy, -18);
    }
    // Counted only when a slide STARTS — retriggering mid-slide extends it and
    // is not a second slide, or holding the input would farm the mission.
    if (!p.sliding) this.slides++;
    p.sliding = true;
    p.slideT = RUN.slideTime;
    sfx.slide();
    hap.slide();
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    if (this.state === STATE.INTRO) {
      // Everything that makes the alley feel alive, and nothing that judges the
      // player: no collide(), no stamina drain, no chase pressure, no score.
      this.time += dt;
      const p = this.player;
      p.z += RUN.startSpeed * dt;
      p.phase = (p.phase + dt * 2.4) % 1;
      this.world.ensureAhead(p.z, 0);
      this.world.prune(p.z);
      updateParticles(dt);
      updateCamera(dt, p.x, p.z, p.y, 0, 0, p.phase, true);
      if (!updateIntro(dt)) {
        this.state = STATE.PLAYING;
        this.hooks.onStateChange?.(this.state);
      }
      return;
    }

    if (this.state !== STATE.PLAYING) {
      // Keep the menu alley alive so the background still scrolls.
      if (this.state === STATE.MENU) {
        this.time += dt;
        this.player.z += RUN.startSpeed * 0.55 * dt;
        this.player.phase = (this.player.phase + dt * 2.2) % 1;
        this.world.ensureAhead(this.player.z, 0);
        this.world.prune(this.player.z);
        updateCamera(dt, 0, this.player.z, 0);
        updateParticles(dt);
      }
      return;
    }

    this.time += dt;

    const p = this.player;
    const gassed = this.stamina <= 0;

    // ---- speed
    let target = Math.min(RUN.maxSpeed, RUN.startSpeed + this.time * RUN.accel);
    if (gassed) target = RUN.gassedSpeed;
    if (this.power.chancla > 0) target *= CHANCLA_SPEED;
    if (this.stumble > 0) target *= 0.55;
    this.speed += (target - this.speed) * Math.min(1, dt * 3.5);

    const moved = this.speed * dt;
    p.z += moved;
    this.distance += moved;
    this.score += moved * SCORE.perUnit;

    // ---- lateral
    const wantX = p.lane * LANE_W;
    p.x += (wantX - p.x) * Math.min(1, dt * RUN.laneSnap);
    if (Math.abs(wantX - p.x) < 0.01) p.x = wantX;
    p.lean += (0 - p.lean) * Math.min(1, dt * 6);

    // ---- vertical
    if (p.airborne || p.y > 0) {
      p.vy += RUN.gravity * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        if (p.airborne) {
          p.airborne = false;
          burst(p.x, 0.05, p.z, 6, 'rgba(200,180,165,0.6)', { spread: 1.4, rise: 1.2, life: 0.3 });
          sfx.land();
        }
      }
    }

    // ---- slide timer
    if (p.sliding) {
      p.slideT -= dt;
      if (p.slideT <= 0) p.sliding = false;
    }

    // ---- run cycle + dust
    // Strides/sec. A real run is ~1.5–1.6; the top end is pushed for energy but
    // capped so it never turns into a cartoon scramble.
    const cadence = p.airborne ? 0.8 : 1.5 + this.speed * 0.05;
    p.phase = (p.phase + dt * cadence) % 1;
    // Kick dust on each footfall rather than at random.
    if (!p.airborne && !p.sliding) {
      const half = Math.floor(p.phase * 2);
      if (half !== p.lastStep) {
        p.lastStep = half;
        dust(p.x, p.z, this.speed);
        dust(p.x, p.z, this.speed);
      }
    }
    if (p.sliding && Math.random() < dt * 40) dust(p.x, p.z, this.speed);

    if (this.stumble > 0) this.stumble -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt * 2.2;

    // ---- stamina
    const speedRatio = this.speed / RUN.startSpeed;
    const drain = STAMINA.drainBase * (1 + (speedRatio - 1) * STAMINA.drainSpeedFactor);
    this.stamina = Math.max(0, this.stamina - drain * dt);
    if (!gassed && this.stamina <= 0) sfx.gassed();

    // ---- powerup timers
    for (const k of Object.keys(this.power)) {
      if (this.power[k] > 0) {
        this.power[k] = Math.max(0, this.power[k] - dt);
        if (this.power[k] === 0) sfx.powerDown();
      }
    }

    // ---- La Migra
    if (this.chaseGrace > 0) this.chaseGrace -= dt;
    if (gassed) {
      this.chase = Math.min(CHASE.max, this.chase + CHASE.gassedGain * dt);
    } else if (this.chaseGrace <= 0) {
      this.chase = Math.max(0, this.chase - CHASE.decay * dt);
    }
    // Cruiser eases toward the distance the pressure implies.
    const wantZ = p.z - (3.2 + (1 - this.chase / CHASE.max) * 26);
    this.chaser.z += (wantZ - this.chaser.z) * Math.min(1, dt * 2.4);
    this.chaser.x += (p.x * 0.6 - this.chaser.x) * Math.min(1, dt * 1.6);
    if (this.chase >= CHASE.max) {
      this.end('CAUGHT BY LA MIGRA');
      return;
    }

    // ---- world
    this.world.ensureAhead(p.z, this.distance);
    this.world.prune(p.z);
    this.collide(dt);
    updateParticles(dt);
    updateCamera(dt, p.x, p.z, p.y,
      this.speedK(), this.power.chancla > 0 ? 1 : 0, p.phase, !p.airborne);

    this.multiplier = Math.min(SCORE.comboMax, 1 + Math.floor(this.combo / SCORE.comboStep));
    if (this.multiplier > this.bestMult) this.bestMult = this.multiplier;
  }

  // --------------------------------------------------------------- collision

  collide(dt) {
    const p = this.player;
    const playerH = p.sliding ? HITBOX.slideH : HITBOX.standH;
    const magnetOn = this.power.magnet > 0;

    for (const o of this.world.objects) {
      if (o.dead) continue;
      const dz = o.z - p.z;
      if (dz > MAGNET_RADIUS + 1 || dz < -1.5) continue;

      // Magnet drags loose beers into your hand.
      if (magnetOn && o.type === 'beer' && dz > -0.5) {
        const d = Math.hypot(o.x - p.x, o.z - p.z, o.y - (p.y + 0.8));
        if (d < MAGNET_RADIUS) {
          const k = Math.min(1, dt * 9);
          o.x += (p.x - o.x) * k;
          o.z += (p.z + 0.15 - o.z) * k;
          o.y += (p.y + 0.8 - o.y) * k;
          o.pulled = true;
        }
      }

      const depth = DEPTH[o.kind] || 0.5;
      if (Math.abs(dz) > depth + HITBOX.depth * 0.5) continue;
      if (Math.abs(o.x - p.x) > (o.w + HITBOX.w) * 0.5) continue;

      if (o.kind === 'pickup' || o.kind === 'power') {
        // Pickups need a loose vertical match so arcs over jumps still count.
        const dy = Math.abs(o.y - (p.y + playerH * 0.5));
        if (dy > 0.95 && !o.pulled) continue;
        this.takePickup(o);
        continue;
      }

      if (o.kind === 'jump' && p.y >= o.h) {
        this.nearMiss(o, Math.abs(p.y - o.h));
        continue;
      }
      if (o.kind === 'slide') {
        const top = p.y + playerH;
        if (top <= o.y || p.y >= o.y + o.h) {
          this.nearMiss(o, Math.abs(top - o.y));
          continue;
        }
      }

      this.hit(o);
    }
  }

  /**
   * A clearance you only just made. Fires once per obstacle, and only when the
   * gap was genuinely tight — rewarding a comfortable jump with the same kick
   * as a hair's-breadth one teaches the player nothing.
   * @param {number} gap world units of clearance
   */
  nearMiss(o, gap) {
    if (o.grazed || gap > JUICE.nearMiss) return;
    o.grazed = true;
    addShake(JUICE.nearMissShake * (1 - gap / JUICE.nearMiss));
  }

  takePickup(o) {
    o.dead = true;
    switch (o.type) {
      case 'beer':
        this.beers++;
        this.combo++;
        this.score += SCORE.beer * this.multiplier;
        burst(o.x, o.y, o.z, 7, '#ffc93c', { spread: 1.6, life: 0.4, size: 0.07 });
        sfx.beer(Math.min(12, this.combo));
        hap.beer();
        break;
      case 'taco':
        this.tacos++;
        this.stamina = Math.min(STAMINA.max, this.stamina + STAMINA.taco);
        burst(o.x, o.y, o.z, 10, '#9ee34f', { spread: 1.9, life: 0.5, size: 0.08 });
        sfx.taco();
        hap.taco();
        this.hooks.onToast?.('¡TACO! +STAMINA', '#9ee34f');
        break;
      default: {
        const def = POWER[o.type];
        if (!def) break;
        this.power[o.type] = def.time;
        this.powerups++;
        burst(o.x, o.y, o.z, 18, def.color, { spread: 2.6, life: 0.7, size: 0.1 });
        sfx.powerUp();
        hap.power();
        this.hooks.onToast?.(def.label, def.color);
      }
    }
  }

  hit(o) {
    // Chancla rush flattens whatever it touches.
    if (this.power.chancla > 0) {
      o.dead = true;
      burst(o.x, 0.8, o.z, 20, '#ffcf3d', { spread: 3.4, life: 0.6, size: 0.13 });
      addShake(0.35);
      sfx.smash();
      hap.smash();
      this.smashes++;
      this.score += 25 * this.multiplier;
      return;
    }
    if (this.invuln > 0) return;

    // The skateboard eats one crash for you.
    if (this.power.skateboard > 0) {
      this.power.skateboard = 0;
      o.dead = true;
      this.invuln = 0.9;
      burst(o.x, 0.7, o.z, 22, '#4dd8ff', { spread: 3.2, life: 0.7, size: 0.12 });
      addShake(0.5);
      sfx.crash();
      hap.hit();
      this.hooks.onToast?.('BOARD SNAPPED', '#4dd8ff');
      return;
    }

    this.chase = Math.min(CHASE.max, this.chase + CHASE.hit);
    this.chaseGrace = CHASE.grace;
    this.invuln = 1.0;
    this.stumble = RUN.stumbleTime;
    this.hitFlash = 1;
    this.combo = 0;
    this.speed *= 0.6;
    addShake(0.8);
    burst(this.player.x, 0.9, this.player.z, 16, '#ff6b6b', { spread: 2.8, life: 0.55 });
    sfx.crash();
    hap.hit();

    if (this.chase >= CHASE.max) this.end('CAUGHT BY LA MIGRA');
  }

  end(reason) {
    if (this.state === STATE.OVER) return;

    // Corrupt was paid in advance, so he looks the other way — once per vida,
    // and without the bust, the music stopping or the run ending. Checked here
    // rather than at the two call sites so no future way of getting caught can
    // forget about it.
    if (this.freeLives > 0) {
      this.freeLives--;
      this.reprieve();
      sfx.powerUp();
      hap.power();
      this.hooks.onToast?.('CORRUPT LOOKED AWAY', '#ff6b6b');
      return;
    }

    this.state = STATE.OVER;
    this.gameOverReason = reason;
    this.score = Math.floor(this.score);
    sfx.stopMusic();
    sfx.bust();
    hap.bust();
    addShake(1.1);
    this.hooks.onStateChange?.(this.state);
  }

  // -------------------------------------------------------------- continues

  /**
   * Back on your feet, mid-alley. Shared by the free vida and the paid
   * continue so the two can never drift apart.
   *
   * Note what is NOT touched: score, distance, combo, multiplier, tacos,
   * chelas and the clock. Keeping the run is the entire product being sold —
   * a reprieve that resets the score is just a restart with extra steps.
   */
  reprieve() {
    const p = this.player;
    this.chase = 0;
    this.chaseGrace = REPRIEVE.grace;
    this.stumble = 0;
    this.hitFlash = 0;
    this.invuln = REPRIEVE.invuln;
    // A fresh tank. Being caught because the gasolina ran out and then waking
    // up with an empty one is not a second chance, it is a second bust.
    this.stamina = Math.max(this.stamina, STAMINA.start);
    // The speed target is a function of time survived, and time did not stop.
    // Coming back at what the clock implies would be a wall, so drop to the
    // opening jog and let the existing spring climb back over about a second.
    this.speed = RUN.startSpeed;
    p.y = 0;
    p.vy = 0;
    p.airborne = false;
    p.sliding = false;
    p.slideT = 0;

    // Sweep the stretch of alley you are standing in. Pickups stay — those are
    // a gift, not a hazard — but anything that can hit you is cleared, or the
    // reprieve hands you straight back to the dumpster that took you down.
    for (const o of this.world.objects) {
      if (o.dead || o.kind === 'pickup' || o.kind === 'power') continue;
      if (o.z > p.z - 3 && o.z < p.z + REPRIEVE.clear) o.dead = true;
    }

    // Push the cruiser back out to the horizon so the pressure reads as gone.
    this.chaser.z = p.z - 30;
    this.chaser.x = 0;
  }

  /**
   * Paid for at the moment of the bust. The wallet is drawn down by the
   * caller — by the time this runs the chelas are already gone.
   * @returns {boolean} false if there was nothing to continue from
   */
  continueRun() {
    if (this.state !== STATE.OVER) return false;
    this.continues++;
    this.reprieve();
    this.gameOverReason = '';
    this.state = STATE.PLAYING;
    sfx.startMusic();
    this.hooks.onStateChange?.(this.state);
    return true;
  }
}
