// Swipe on glass, arrow keys on a desk. Both land on the same four verbs.
//
// LATENCY IS THE WHOLE DESIGN HERE. This used to wait for 26px of travel before
// it would call anything, and on a phone that is a quarter of a thumb-length of
// nothing happening — the single most-felt flaw in how the game played. A swipe
// is not a drag: the player has already decided by the time their finger is
// moving, so the job is to work out WHICH verb as early as the direction is
// honest, and then fire, mid-gesture, without waiting for the finger to lift.
//
// Three ways in, cheapest first:
//   FLICK_PX  6px, but only with real speed behind it. A flick is ~500–2000px/s
//             and a tap's wobble is under ~80px/s, so velocity separates them
//             cleanly and this can sit well below the tap slop without ever
//             stealing a tap.
//   SWIPE_PX  12px for a deliberate, slow drag that has picked a side.
//   ANY_PX    18px fires whatever axis is winning even on a dead 45° diagonal,
//             which DOMINANCE would otherwise hold off forever. This is the
//             slowest path in the file and it is still eight px earlier than the
//             old threshold was for EVERY gesture.
//
// DOMINANCE is what makes the small thresholds safe: at 6px of travel the axis
// is only meaningful if it is actually beating the other one, or a diagonal
// flick becomes a coin toss between a lane change and a jump.
//
// Everything below is a comparison and a branch — no hypot, no atan2, no
// allocation. onMove runs on every pointermove of every gesture.

const FLICK_PX = 6;        // dominant-axis px, with FLICK_V behind it
const SWIPE_PX = 12;       // dominant-axis px, at any speed
const ANY_PX = 18;         // ...and past here, direction stops needing to be clean
const FLICK_V = 0.35;      // px per ms — above this is a flick, below is a wobble
const DOMINANCE = 1.25;    // how far the winning axis must be ahead to commit

const TAP_MAX_MS = 260;
const TAP_MAX_PX = 14;

export function attachInput(target, actions) {
  let sx = 0, sy = 0, st = 0, tracking = false, fired = false;

  const onDown = (x, y) => {
    sx = x; sy = y; st = performance.now();
    tracking = true; fired = false;
  };

  const onMove = (x, y) => {
    if (!tracking || fired) return;
    const dx = x - sx, dy = y - sy;
    const ax = dx < 0 ? -dx : dx;
    const ay = dy < 0 ? -dy : dy;
    const horiz = ax > ay;
    const maj = horiz ? ax : ay;

    if (maj < FLICK_PX) return;
    if (maj < ANY_PX) {
      // The other axis, still in the running.
      const min = horiz ? ay : ax;
      if (maj < min * DOMINANCE) return;
      // Under the outright threshold only a genuine flick commits, so a tap
      // whose contact point rolls a few px stays a tap.
      if (maj < SWIPE_PX && maj < (performance.now() - st) * FLICK_V) return;
    }

    fired = true;
    if (horiz) {
      actions.lane(dx > 0 ? 1 : -1);
    } else if (dy < 0) {
      actions.jump();
    } else {
      actions.slide();
    }
  };

  const onUp = (x, y) => {
    if (!tracking) return;
    tracking = false;
    if (fired) return;
    const dt = performance.now() - st;
    if (dt < TAP_MAX_MS && Math.hypot(x - sx, y - sy) < TAP_MAX_PX) actions.jump();
  };

  target.addEventListener('pointerdown', (e) => {
    target.setPointerCapture?.(e.pointerId);
    onDown(e.clientX, e.clientY);
  });
  target.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  target.addEventListener('pointerup', (e) => onUp(e.clientX, e.clientY));
  target.addEventListener('pointercancel', () => { tracking = false; });

  // Stop the browser from scrolling / rubber-banding mid-run.
  target.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const keymap = {
    ArrowLeft: () => actions.lane(-1),
    KeyA: () => actions.lane(-1),
    ArrowRight: () => actions.lane(1),
    KeyD: () => actions.lane(1),
    ArrowUp: () => actions.jump(),
    KeyW: () => actions.jump(),
    Space: () => actions.jump(),
    ArrowDown: () => actions.slide(),
    KeyS: () => actions.slide(),
    Escape: () => actions.pause(),
    KeyP: () => actions.pause(),
    KeyM: () => actions.mute(),
  };

  // Typing beats driving. The map above claims a, d, w, s, p, m, space, the
  // arrows and Escape, and it used to preventDefault() them wherever the focus
  // happened to be — so the runner-name box on the ACCOUNT screen silently
  // refused six letters and the space bar. It reads as the field being broken,
  // because a keystroke that produces nothing is indistinguishable from one.
  const typing = (el) => !!el && (
    el.isContentEditable ||
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  );

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (typing(e.target)) return;
    const fn = keymap[e.code];
    if (!fn) return;
    e.preventDefault();
    fn();
  });
}
