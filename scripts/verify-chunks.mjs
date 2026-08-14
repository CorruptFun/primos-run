#!/usr/bin/env node
/**
 * Fairness audit for the alley: the authoring rules in js/world.js, checked.
 *
 *     node scripts/verify-chunks.mjs
 *
 * The chunk table is hand-authored and its rules live in a doc comment, which
 * means nothing enforces them. They have already been broken twice by hand —
 * `cone-slalom` shipped rows 6u apart, and `the-corridor` shipped a 7u step
 * with a verb change across it, was "fixed" to 8, and stayed one unit short of
 * the rule it was being fixed against. Both were found by reading. This finds
 * them by running.
 *
 * It also pins the geometry the verbs depend on. Those are the invariants that
 * do not live in any one file: the jump apex falls out of RUN.jumpV and
 * RUN.gravity, the slide clearance out of HITBOX, and whether a checkpoint can
 * be jumped out of all three at once. Nothing errors when they drift — the
 * alley just quietly stops meaning what the design says it means.
 *
 * Exits non-zero on any violation, so it can gate a deploy.
 */

import { CHUNKS } from '../js/world.js';
import { PROP_SPEC } from '../js/art/props.js';
import { RUN, HITBOX, PACING, DRONE, LANE_W } from '../js/config.js';

const APEX = (RUN.jumpV ** 2) / (2 * -RUN.gravity);
const BOARD_APEX = (RUN.boardJumpV ** 2) / (2 * -RUN.gravity);

// Row spacing floors, in AUTHORED units (i.e. at starting speed — placeChunk
// only ever stretches these, never compresses them).
const MIN_GAP = 8;
const MIN_GAP_VERB_CHANGE = 9;

const fails = [];
const warns = [];
const fail = (s) => fails.push(s);
const warn = (s) => warns.push(s);

// --------------------------------------------------------------- prop geometry

for (const [t, s] of Object.entries(PROP_SPEC)) {
  if (s.kind === 'jump' && s.h >= APEX) {
    fail(`PROP ${t}: h=${s.h} is at or above the jump apex ${APEX.toFixed(2)} — marked 'jump' but unjumpable`);
  }
  if (s.kind === 'dodge' && s.h < APEX) {
    fail(`PROP ${t}: h=${s.h} is under the jump apex ${APEX.toFixed(2)} — marked 'dodge' but a jump clears it`);
  }
  if (s.kind === 'slide') {
    if (s.y < HITBOX.slideH) fail(`PROP ${t}: hangs to y=${s.y}, under the slide box ${HITBOX.slideH} — cannot be slid under`);
    if (s.y >= HITBOX.standH) fail(`PROP ${t}: hangs to y=${s.y}, over the standing box ${HITBOX.standH} — you can just run under it`);
    // The one that will drift silently. A slide prop whose TOP is under an apex
    // is jumpable, and a prop that answers to two verbs teaches neither.
    const top = s.y + s.h;
    if (top < APEX) fail(`PROP ${t}: top ${top.toFixed(2)} is under the jump apex ${APEX.toFixed(2)} — jumpable, so 'slide' is a lie`);
    const boardMargin = top - BOARD_APEX;
    if (boardMargin <= 0) {
      fail(`PROP ${t}: top ${top.toFixed(2)} is under the SKATEBOARD apex ${BOARD_APEX.toFixed(2)} — a board jumps clean over it`);
    } else if (boardMargin < 0.15) {
      warn(`PROP ${t}: only ${boardMargin.toFixed(3)}u of clearance over the skateboard apex ${BOARD_APEX.toFixed(2)} — `
         + `any nudge to RUN.boardJumpV, RUN.gravity or this prop's y/h hands the board a jump-over`);
    }
  }
}

// The drone's two dodges, both of which are geometry and neither of which is
// asserted anywhere else. See DRONE in config.js.
if (DRONE.height <= HITBOX.slideH) fail(`DRONE.height ${DRONE.height} is at or under the slide box ${HITBOX.slideH} — sliding no longer clears it`);
if (DRONE.height >= HITBOX.standH) fail(`DRONE.height ${DRONE.height} is at or over the standing box ${HITBOX.standH} — standing still clears it, so there is no threat`);
if (DRONE.height >= APEX) warn(`DRONE.height ${DRONE.height} is at or over the jump apex ${APEX.toFixed(2)} — jumping would clear it, which the design says it must not`);
if (DRONE.startTime <= PACING.tierSeconds[2]) warn(`DRONE.startTime ${DRONE.startTime}s lands at or before tier 2 (${PACING.tierSeconds[2]}s) — the drone was meant to sit between tiers 2 and 3`);

// ------------------------------------------------------------------ the chunks

const KIND = (t) => PROP_SPEC[t]?.kind;
const isObstacle = (t) => { const k = KIND(t); return k && k !== 'pickup' && k !== 'power' && k !== 'decor'; };

for (const c of CHUNKS) {
  // ---- rows
  const rows = new Map();
  for (const it of c.items) {
    if (!PROP_SPEC[it.t]) { fail(`${c.id}: unknown prop '${it.t}'`); continue; }
    const key = it.dz.toFixed(3);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(it);
  }

  const obsRows = [];
  for (const key of [...rows.keys()].sort((a, b) => a - b)) {
    const items = rows.get(key).filter(i => isObstacle(i.t));
    if (!items.length) continue;
    const dz = Number(key);

    const perLane = { '-1': [], '0': [], '1': [] };
    for (const i of items) {
      if (![-1, 0, 1].includes(i.lane)) { fail(`${c.id} @dz${dz}: ${i.t} is in lane ${i.lane}`); continue; }
      perLane[String(i.lane)].push(KIND(i.t));
    }

    const safe = [];
    for (const L of ['-1', '0', '1']) {
      const kinds = perLane[L];
      if (!kinds.length) { safe.push({ lane: Number(L), verb: 'free' }); continue; }
      if (kinds.includes('jump') && kinds.includes('slide')) {
        fail(`${c.id} @dz${dz}: lane ${L} asks for a jump AND a slide at once — impossible`);
        continue;
      }
      if (kinds.includes('dodge')) continue;                    // lane is shut
      safe.push({ lane: Number(L), verb: kinds[0] });
    }
    if (!safe.length) fail(`${c.id} @dz${dz}: all three lanes are shut — no survivable line`);
    obsRows.push({ dz, safe, verbs: new Set(safe.map(s => s.verb)) });
  }

  // ---- spacing between consecutive obstacle rows
  for (let i = 1; i < obsRows.length; i++) {
    const a = obsRows[i - 1], b = obsRows[i];
    const gap = b.dz - a.dz;
    const changes = [...b.verbs].some(v => v !== 'free' && !a.verbs.has(v));
    const min = changes ? MIN_GAP_VERB_CHANGE : MIN_GAP;
    if (gap < min) {
      fail(`${c.id}: rows dz${a.dz} -> dz${b.dz} are ${gap.toFixed(1)}u apart, under the ${min}u floor`
         + (changes ? ' (the verb changes across them)' : ''));
    }
    // Two lanes of travel is the most the alley may ever ask for in one step,
    // and it costs about 0.19s of lateral spring on top of reaction time.
    let best = 99;
    for (const s1 of a.safe) for (const s2 of b.safe) best = Math.min(best, Math.abs(s1.lane - s2.lane));
    if (best >= 2) {
      warn(`${c.id}: dz${a.dz} -> dz${b.dz} forces a ${best}-lane move in ${gap.toFixed(1)}u `
         + `(${(gap / RUN.startSpeed).toFixed(2)}s at starting speed)`);
    }
  }

  // ---- the chunk has to contain its own items, or it runs into its own gap
  const maxDz = Math.max(...c.items.map(i => i.dz));
  if (maxDz > c.len) fail(`${c.id}: an item sits at dz${maxDz}, past the declared len ${c.len}`);

  // ---- pickups have to be reachable, and must not be bait
  for (const it of c.items) {
    const spec = PROP_SPEC[it.t];
    if (!spec || (spec.kind !== 'pickup' && spec.kind !== 'power')) continue;
    const y = it.y != null ? it.y : spec.y;
    const sameLane = (rows.get(it.dz.toFixed(3)) || [])
      .filter(i => i.lane === it.lane && isObstacle(i.t));

    // The vertical match game.collide uses: |o.y - (p.y + playerH/2)| < 0.95
    const reach = (py, h) => Math.abs(y - (py + h * 0.5)) < 0.95;
    let ok = reach(0, HITBOX.standH) || reach(0, HITBOX.slideH);
    for (let py = 0; !ok && py <= APEX; py += 0.02) ok = reach(py, HITBOX.standH);
    if (!ok) fail(`${c.id}: ${it.t} lane ${it.lane} dz${it.dz} at y=${y} is out of reach at every player height`);

    if (sameLane.some(i => KIND(i.t) === 'dodge')) {
      fail(`${c.id}: ${it.t} at dz${it.dz} lane ${it.lane} sits inside a dodge prop — unreachable bait`);
    }
    if (sameLane.some(i => KIND(i.t) === 'slide') && !reach(0, HITBOX.slideH)) {
      fail(`${c.id}: ${it.t} at dz${it.dz} lane ${it.lane} is under a slide prop but out of reach from a slide (y=${y})`);
    }
    if (sameLane.some(i => KIND(i.t) === 'jump')) {
      let air = false;
      const h = PROP_SPEC[sameLane.find(i => KIND(i.t) === 'jump').t].h;
      for (let py = h; !air && py <= APEX; py += 0.02) air = reach(py, HITBOX.standH);
      if (!air) fail(`${c.id}: ${it.t} at dz${it.dz} lane ${it.lane} rides a jump prop but is out of reach while clearing it (y=${y})`);
    }
  }
}

// ---- every tier needs enough chunks that pickChunk's `recent` filter (4 deep)
// still has something to choose from.
const perTier = {};
for (const c of CHUNKS) for (let t = c.tier; t <= 3; t++) perTier[t] = (perTier[t] || 0) + 1;
for (const [t, n] of Object.entries(perTier)) {
  if (n <= 5) fail(`tier ${t} can only draw from ${n} chunks — the 4-deep recent filter leaves almost no choice`);
}

// ---------------------------------------------------------------------- report

const N = CHUNKS.length;
const rowCount = CHUNKS.reduce((n, c) => n + c.items.length, 0);
console.log(`chunks ${N}, items ${rowCount}, tiers ${JSON.stringify(perTier)}`);
console.log(`jump apex ${APEX.toFixed(2)}u · board apex ${BOARD_APEX.toFixed(2)}u · `
          + `stand ${HITBOX.standH} · slide ${HITBOX.slideH} · drone ${DRONE.height}`);

for (const w of warns) console.log(`  warn  ${w}`);
for (const f of fails) console.log(`  FAIL  ${f}`);

if (fails.length) {
  console.log(`\n${fails.length} violation(s), ${warns.length} warning(s)`);
  process.exit(1);
}
console.log(`\nall clear — ${warns.length} warning(s), no violations`);
