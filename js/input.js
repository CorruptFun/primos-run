// Swipe on glass, arrow keys on a desk. Both land on the same four verbs.

const SWIPE_MIN = 26;      // px before a drag counts as a swipe
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
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
    fired = true;
    if (Math.abs(dx) > Math.abs(dy)) {
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

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const fn = keymap[e.code];
    if (!fn) return;
    e.preventDefault();
    fn();
  });
}
