// Procedural WebAudio — no sound files to load or cache.

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let muted = false;
let musicTimer = null;
let step = 0;
let nextNoteAt = 0;

const BPM = 104;
const STEP = 60 / BPM / 2;   // eighth notes

export function ready() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);

  musicGain = ctx.createGain();
  musicGain.gain.value = 0.26;
  musicGain.connect(master);

  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.85;
  sfxGain.connect(master);
  return ctx;
}

export function resume() {
  const c = ready();
  if (c && c.state === 'suspended') c.resume();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02);
}

export function isMuted() {
  return muted;
}

// ------------------------------------------------------------------ voices

function tone(freq, dur, type = 'square', gain = 0.2, slideTo = null, delay = 0) {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, gain = 0.2, filterFreq = 2400, delay = 0, target = null) {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(target || sfxGain);
  src.start(t0);
}

// --------------------------------------------------------------------- sfx

export function beer(combo) {
  // pitch climbs with the combo so a streak sounds like a streak
  const base = 620 * Math.pow(1.0595, Math.min(12, combo));
  tone(base, 0.09, 'square', 0.16);
  tone(base * 1.5, 0.07, 'triangle', 0.1, null, 0.02);
}

export function taco() {
  tone(300, 0.12, 'sawtooth', 0.18, 520);
  noise(0.09, 0.14, 1200, 0.02);
}

export function jump() {
  tone(320, 0.16, 'square', 0.14, 720);
}

export function land() {
  noise(0.08, 0.12, 700);
}

export function slide() {
  noise(0.26, 0.16, 1800);
}

export function swipe() {
  noise(0.07, 0.07, 3200);
}

export function powerUp() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 'square', 0.16, null, i * 0.055));
}

export function powerDown() {
  tone(760, 0.18, 'triangle', 0.1, 300);
}

export function smash() {
  noise(0.16, 0.24, 900);
  tone(140, 0.14, 'sawtooth', 0.16, 60);
}

export function crash() {
  noise(0.3, 0.3, 500);
  tone(180, 0.28, 'sawtooth', 0.2, 55);
}

export function gassed() {
  tone(220, 0.5, 'sine', 0.16, 90);
}

// The drone's two voices. The siren is the bust wail's vocabulary at half the
// length and a fifth up — same family (it IS la migra), clearly not the same
// event (that one means over, this one means MOVE). The dive is mostly air.
export function droneSiren() {
  for (let i = 0; i < 2; i++) {
    tone(1180, 0.16, 'square', 0.12, 880, i * 0.19);
    tone(880, 0.16, 'square', 0.12, 1180, i * 0.19 + 0.09);
  }
}

export function droneDive() {
  tone(1400, 0.5, 'sawtooth', 0.1, 240);
  noise(0.45, 0.2, 1800);
  noise(0.3, 0.14, 700, 0.12);
}

export function bust() {
  stopMusic();
  // two-tone siren wail
  for (let i = 0; i < 4; i++) {
    tone(880, 0.22, 'square', 0.13, 620, i * 0.24);
    tone(620, 0.22, 'square', 0.13, 880, i * 0.24 + 0.12);
  }
  tone(120, 0.9, 'sawtooth', 0.18, 45, 0.1);
}

// One press is one sound. js/ui-feedback.js clicks every control on
// `pointerdown`, and most of js/main.js's buttons also click in their own
// `click` handler — the same gesture arriving twice, ~80ms apart, which is
// close enough to be heard as a flam rather than as two presses. The second
// one is dropped here rather than by unpicking twenty call sites.
let lastClick = 0;

export function uiClick() {
  const now = performance.now();
  if (now - lastClick < 120) return;
  lastClick = now;
  tone(520, 0.06, 'square', 0.12);
}

// ------------------------------------------------------------------- music

// One bar of a loping cumbia-ish groove. Nothing fancy — it just has to sit
// under the run without getting in the way.
const BASS = [55, 0, 82.4, 0, 73.4, 0, 82.4, 0, 55, 0, 82.4, 0, 98, 0, 87.3, 0];
const STAB = [0, 466, 0, 466, 0, 392, 0, 0, 0, 466, 0, 466, 0, 349, 0, 392];

function scheduleStep(when) {
  const c = ctx;
  const i = step % 16;

  const b = BASS[i];
  if (b) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = b;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + STEP * 0.9);
    osc.connect(g); g.connect(musicGain);
    osc.start(when); osc.stop(when + STEP);
  }

  const s = STAB[i];
  if (s) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'square';
    osc.frequency.value = s;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.1, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + STEP * 0.55);
    osc.connect(g); g.connect(musicGain);
    osc.start(when); osc.stop(when + STEP);
  }

  // güiro scrape on the offbeat, kick on the one
  if (i % 2 === 1) {
    const len = Math.floor(c.sampleRate * 0.06);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 4200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.28, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    src.connect(bp); bp.connect(g); g.connect(musicGain);
    src.start(when);
  }
  if (i % 8 === 0) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, when);
    osc.frequency.exponentialRampToValueAtTime(40, when + 0.12);
    g.gain.setValueAtTime(0.7, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    osc.connect(g); g.connect(musicGain);
    osc.start(when); osc.stop(when + 0.16);
  }

  step++;
}

export function startMusic() {
  const c = ready();
  if (!c || musicTimer) return;
  resume();
  nextNoteAt = c.currentTime + 0.08;
  musicTimer = setInterval(() => {
    if (!ctx) return;
    while (nextNoteAt < ctx.currentTime + 0.12) {
      scheduleStep(nextNoteAt);
      nextNoteAt += STEP;
    }
  }, 25);
}

export function stopMusic() {
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}
