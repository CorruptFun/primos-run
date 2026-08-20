/**
 * Marketing stills harness — drives a REAL run and shoots the game's own canvas.
 *
 * Injected into the running game (it is not imported by anything). Pair it with
 * `scripts/capture-sink.py`, which receives the PNGs:
 *
 *     python3 scripts/capture-sink.py 4178 press/shots
 *
 * Why an autopilot rather than posing the numbers: a screenshot with a score
 * typed into it is a mockup, not a screenshot. This plays the alley with the
 * same keyboard the player uses, so the distance, the multiplier and the
 * chelas on the HUD are all things the build actually did.
 *
 * Why fixed-dt stepping rather than watching it play: an automated browser runs
 * the page hidden, where rAF never fires — `window.__step`/`__draw` exist for
 * exactly this (see main.js). Fixed dt also makes a shot reproducible.
 */
(() => {
  const SINK = 'http://localhost:4178/shot/';
  const canvas = document.getElementById('stage');
  const G = () => window.__game;

  const key = (code) => window.dispatchEvent(
    new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));

  const LEFT = 'ArrowLeft', RIGHT = 'ArrowRight', JUMP = 'Space', SLIDE = 'ArrowDown';

  /** Mark the tutorial done so its coach marks stay out of every frame. */
  function train() {
    const K = 'primos-run.v1';
    try {
      const blob = JSON.parse(localStorage.getItem(K) || '{}');
      blob.trainedAt = Date.now();
      localStorage.setItem(K, JSON.stringify(blob));
      return true;
    } catch { return false; }
  }

  /**
   * One autopilot decision. Looks a fixed distance up the alley in the lane it
   * is standing in, and answers with the verb that prop was authored for —
   * `world.js` guarantees a lane is always open, so a dodge never has to guess.
   */
  function decide() {
    const g = G();
    if (g.state !== 'playing') return;
    const p = g.player;
    const objs = g.world.objects;
    const AHEAD = 9.5;          // how far up the alley a threat is answered
    const ACT = 5.2;            // jump/slide fire inside this gap
    let threat = null, nearest = 1e9;
    const blocked = { '-1': false, '0': false, '1': false };
    const treats = { '-1': 0, '0': 0, '1': 0 };

    for (const o of objs) {
      if (o.kind === 'decor' || o.lane == null) continue;
      const gap = o.z - p.z;
      if (gap < -1 || gap > AHEAD * 2) continue;
      if (o.kind === 'pickup') {
        if (gap > 0 && gap < AHEAD * 1.8) treats[o.lane] += 1;
        continue;
      }
      if (gap > 0 && gap < AHEAD) blocked[o.lane] = true;
      if (o.lane === p.lane && gap > -0.5 && gap < nearest) { nearest = gap; threat = o; }
    }

    if (threat && nearest < ACT) {
      if (threat.kind === 'jump' && !p.airborne) { key(JUMP); return; }
      if (threat.kind === 'slide' && !p.sliding) { key(SLIDE); return; }
    }
    // A `dodge` prop cannot be cleared by a verb — the lane change is the answer.
    if (threat && threat.kind === 'dodge' && nearest < AHEAD) {
      const opts = [p.lane - 1, p.lane + 1].filter(l => l >= -1 && l <= 1 && !blocked[l]);
      if (opts.length) {
        opts.sort((a, b) => treats[b] - treats[a]);
        key(opts[0] < p.lane ? LEFT : RIGHT);
        return;
      }
    }
    // Nothing to survive — drift toward whichever open lane has the most in it.
    if (!threat && !p.airborne && !p.sliding) {
      const here = treats[p.lane];
      for (const l of [p.lane - 1, p.lane + 1]) {
        if (l < -1 || l > 1 || blocked[l]) continue;
        if (treats[l] > here) { key(l < p.lane ? LEFT : RIGHT); return; }
      }
    }
  }

  /** Step `n` frames with the autopilot driving, painting each one. */
  function advance(n = 60, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      decide();
      window.__step(1, dt);
    }
    window.__draw(dt);
    const g = G();
    return { state: g.state, dist: Math.round(g.distance), score: g.score, mult: g.multiplier };
  }

  /** Run until `dist` metres or the run ends. */
  function runTo(dist, cap = 60000) {
    const g = G();
    let n = 0;
    while (g.distance < dist && g.state === 'playing' && n < cap) { decide(); window.__step(1, 1 / 60); n++; }
    window.__draw(1 / 60);
    return { state: g.state, dist: Math.round(g.distance), score: g.score, frames: n };
  }

  const shoot = (name) => new Promise((res) => {
    canvas.toBlob((b) => {
      fetch(SINK + name, { method: 'POST', body: b })
        .then(() => res(`ok ${name} ${b.size}`))
        .catch((e) => res(`ERR ${e.message}`));
    }, 'image/png');
  });

  /**
   * Step forward until the alley in front of the runner scores well as a
   * PICTURE, then stop. `want` names the prop kinds that must be in frame.
   */
  function findShot(want = ['pickup'], within = [8, 26], maxFrames = 3000) {
    const g = G();
    for (let i = 0; i < maxFrames; i++) {
      if (g.state !== 'playing') break;
      const p = g.player;
      const seen = new Set();
      let count = 0;
      for (const o of g.world.objects) {
        if (o.lane == null || o.kind === 'decor') continue;
        const gap = o.z - p.z;
        if (gap < within[0] || gap > within[1]) continue;
        seen.add(o.kind); count++;
      }
      if (want.every(k => seen.has(k)) && count >= want.length) {
        window.__draw(1 / 60);
        return { hit: true, dist: Math.round(g.distance), score: g.score, kinds: [...seen], count };
      }
      decide(); window.__step(1, 1 / 60);
    }
    window.__draw(1 / 60);
    return { hit: false, dist: Math.round(g.distance), score: g.score, state: g.state };
  }

  window.__mk = { key, train, decide, advance, runTo, shoot, findShot, LEFT, RIGHT, JUMP, SLIDE };
  return 'ready';
})()
