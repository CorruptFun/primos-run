// Drive a real run to a chosen frame and look at what it drew.
//
// The bug this was written for could only be seen on ONE frame — the frame a
// powerup is collected on — which is unreachable by hand: you cannot press a
// key on the frame you meant to. It rides the same window.__step / window.__draw
// seam main.js already exposes for capture, so nothing here is a special code
// path and what it shoots is exactly what a player sees.
//
//   <script type="module" src="./dev/frame-probe.js"></script>
//
// ...or paste it into the console on the game page. Then:
//
//   await probe.collect('magnet')   // run until a magnet is picked up
//   probe.blob([255,77,157])        // biggest run of that exact colour on screen
//   probe.sheet(8)                  // the next 8 frames, tiled over the page
//   probe.clear()                   // take the sheet back down
//
// probe.blob() is the assertion worth keeping: a burst of sparks and a solid
// slab differ in FILL RATIO, not in pixel count, so `fill` near 1.0 over a box
// tens of pixels across is the failure this file exists to catch.

const probe = {
  /** The canvas the player actually looks at (the blit target, not the buffer). */
  canvas() {
    return document.querySelector('canvas');
  },

  /**
   * Play until `type` is collected, and stop on that exact frame.
   * The powerup is planted dead ahead in the player's own lane rather than
   * waited for, so the run is short and the same every time.
   */
  async collect(type = 'magnet', dt = 1 / 60) {
    // Works for any collectable — the powerups, and beer and taco too.
    const G = window.__game;
    let n = 0;
    // A run can end between probes — this drives whatever screen it lands on
    // back to PLAYING so a matrix of probes does not have to reload the page.
    while (G.state !== 'playing' && n++ < 4000) {
      // OVER can be showing the continue offer instead of the summary; decline
      // it rather than spending the player's chelas on a probe.
      const ids = { menu: ['btn-play'], paused: ['btn-resume'], over: ['btn-cont-no', 'btn-again'] }[G.state] || [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.offsetParent) { el.click(); break; }
      }
      window.__step(1, dt);
    }
    if (G.state !== 'playing') return { error: 'never reached playing', state: G.state };
    for (let i = 0; i < 30; i++) window.__step(1, dt);   // let the alley settle
    const p = G.player;
    G.world.spawn(type, Math.round(p.x), p.z + 16);
    // Hold the planted object by identity. `find` by type picks whichever one
    // is first in the array, and the world may already have laid one of the
    // same kind a hundred units down the alley — which reports a collection
    // that did happen at a distance that did not.
    const mine = G.world.objects[G.world.objects.length - 1];
    for (let i = 0; i < 400; i++) {
      const dz = mine.dead ? null : mine.z - p.z;
      window.__step(1, dt);
      // Stop on OUR object being taken, not on the power being up: a magnet
      // the world laid earlier would satisfy the second and stop the run on a
      // frame this probe did not choose.
      if (mine.dead) {
        return {
          // beer and taco are pickups, not powers — there is no timer to read.
          type, dt, frames: i, power: G.power[type] ?? null,
          dzFromPlayer: dz == null ? null : +dz.toFixed(2),
          // What the CAMERA sees, which is the number that decides scale —
          // CAM.back further away than the player's own plane.
          dzFromCamera: dz == null ? null : +(dz + 4.25).toFixed(2),
        };
      }
    }
    return { error: 'never collected' };
  },

  /**
   * The largest solid patch of one colour on screen, and how solid it is.
   * `region` defaults to the scene above the HUD's power bar, which is painted
   * in the powerup's own colour and would otherwise win every search.
   */
  blob(rgb, tol = 24, region = null) {
    const cv = this.canvas();
    const c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d');
    g.drawImage(cv, 0, 0);
    // Default region: a box around the runner. Every HUD readout is painted in
    // the same colours these bursts are — the stamina bar is the taco's green
    // and the power bar is the powerup's own — and left to the whole frame the
    // search finds the HUD every time.
    const r = region || {
      x: (cv.width >> 1) - 150, y: Math.round(cv.height * 0.44), w: 300, h: 260,
    };
    const d = g.getImageData(r.x, r.y, r.w, r.h).data;
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4;
        if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol
          && Math.abs(d[i + 2] - rgb[2]) <= tol) {
          n++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (!n) return { pixels: 0, box: null, fill: 0 };
    const box = { x: x0 + r.x, y: y0 + r.y, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    return { pixels: n, box, fill: +(n / (box.w * box.h)).toFixed(3) };
  },

  /**
   * Tile the next `n` frames over the page so a screenshot catches all of them.
   * An automated browser shoots one viewport and cannot scrub a timeline.
   */
  sheet(n = 8, crop = null, zoom = 1.3, cols = 4) {
    const cv = this.canvas();
    const c = crop || { x: (cv.width >> 1) - 130, y: Math.round(cv.height * 0.47), w: 260, h: 230 };
    const rows = Math.ceil(n / cols);
    const out = document.createElement('canvas');
    out.width = cols * c.w * zoom;
    out.height = rows * c.h * zoom;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000';
    g.fillRect(0, 0, out.width, out.height);
    for (let i = 0; i < n; i++) {
      if (i > 0) window.__step(1, 1 / 60);
      const col = i % cols, row = (i / cols) | 0;
      const dx = col * c.w * zoom, dy = row * c.h * zoom;
      g.drawImage(cv, c.x, c.y, c.w, c.h, dx, dy, c.w * zoom, c.h * zoom);
      g.strokeStyle = '#333';
      g.strokeRect(dx, dy, c.w * zoom, c.h * zoom);
      g.fillStyle = '#4f4';
      g.font = 'bold 16px monospace';
      g.fillText('+' + i, dx + 6, dy + 20);
    }
    out.id = '__probe-sheet';
    out.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;'
      + `width:${out.width}px;height:${out.height}px`;
    this.clear();
    document.body.appendChild(out);
    return { w: out.width, h: out.height };
  },

  clear() {
    document.getElementById('__probe-sheet')?.remove();
  },
};

window.probe = probe;
export default probe;
