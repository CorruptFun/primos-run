// The analytics dashboard — the everyday read path for the event log.
//
// This page holds NOTHING secret. It ships the same publishable key the game
// does and relies on the owner's own Google session; the SERVER decides what it
// may see (primos_admin_analytics, gated on public.primos_app_admins). A
// stranger who finds this URL gets a sign-in button and a 403. That is why it is
// safe to host in a public repo on a public origin.
//
// It is on the game's own origin ON PURPOSE: the auth session is already there,
// under the same storage key, so signing in here is the same act as signing in
// to the game. The cost is that sw.js must not precache it — see the PRECACHE
// note there — because players must never download the owner's tool.
//
// ⚠ XSS RULE, and it is not theoretical: EVERY string that originated in a
// client — event names, error messages, prop values, build versions — reaches
// the DOM through textContent and nothing else. This page is authenticated as
// the owner, so innerHTML on a player-written string is stored XSS aimed
// squarely at the one session that can read the whole event log.

import { sbClient } from '../cloud.js';
import { SUPABASE_URL } from '../cloud-config.js';
import {
  bounceRate, buildFunnel, coerceStats, fillDays, fillScoreBuckets,
  formatCount, formatDuration, linePoints, niceScale, ratePct, retentionRate,
} from './model.js';

const $ = (id) => document.getElementById(id);

// Categorical colours in FIXED SLOT ORDER — series 0 is always the same hue on
// every chart, so a colour means one thing across the page.
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];

let days = 14;
let busy = false;

// ------------------------------------------------------------------ elements

/** Build an element. `text` goes in as textContent — never as markup. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function svg(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  return node;
}

function show(id) {
  for (const name of ['view-loading', 'view-signin', 'view-denied', 'view-error', 'view-stats']) {
    $(name).classList.toggle('hidden', name !== id);
  }
}

// ---------------------------------------------------------------------- auth

async function client() {
  const c = await sbClient();
  if (!c) throw new Error('Cloud config is empty — fill js/cloud-config.js.');
  return c;
}

async function currentUser() {
  try {
    const c = await client();
    const { data } = await c.auth.getSession();
    return data?.session?.user ?? null;
  } catch {
    return null;
  }
}

async function signIn() {
  try {
    const c = await client();
    await c.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href.split('#')[0] },
    });
  } catch {
    showError('Could not start Google sign-in.');
  }
}

async function signOut() {
  try {
    const c = await client();
    await c.auth.signOut();
    window.location.reload();
  } catch {
    /* best effort */
  }
}

// --------------------------------------------------------------------- fetch

async function load() {
  if (busy) return;
  busy = true;
  // Hold the previous render at reduced opacity rather than flashing a
  // skeleton — a refetch is a small change to numbers already on screen.
  $('view-stats').classList.add('refetching');

  try {
    const user = await currentUser();
    if (!user) { show('view-signin'); return; }

    const c = await client();
    const { data, error } = await c.rpc('primos_admin_analytics', { p_days: days });

    if (error) {
      // 42501 is raised deliberately by the RPC so this page can tell "you are
      // signed in but not an admin" from "this is broken". They need completely
      // different screens.
      if (error.code === '42501' || /admin-only/i.test(error.message || '')) {
        showDenied(user.id);
      } else {
        showError(error.message || 'The analytics query failed.');
      }
      return;
    }

    render(coerceStats(data));
    show('view-stats');
  } catch (e) {
    showError(e?.message || 'Something went wrong.');
  } finally {
    busy = false;
    $('view-stats').classList.remove('refetching');
  }
}

function showDenied(userId) {
  // The exact insert, with their id already in it. This only helps someone who
  // can already open the SQL editor — i.e. the owner — and it beats making them
  // go and hunt for their own UUID.
  $('denied-sql').textContent =
    `insert into public.primos_app_admins (user_id, note)\n`
    + `values ('${userId}', 'owner');`;
  show('view-denied');
}

function showError(message) {
  $('error-message').textContent = message;
  show('view-error');
}

// -------------------------------------------------------------------- render

function render(s) {
  renderKpis(s);
  renderDaily(s);
  renderRetention(s);
  renderRuns(s);
  renderFunnels(s);
  renderShop(s);
  renderErrors(s);
  renderVersions(s);
  renderNames(s);

  $('generated').textContent = s.meta.generatedAt
    ? `window: ${s.meta.days}d · generated ${s.meta.generatedAt.slice(0, 19).replace('T', ' ')} UTC`
    : `window: ${s.meta.days}d`;
}

function tile(label, value, sub, tone) {
  const box = el('div', `tile${tone ? ` tile-${tone}` : ''}`);
  box.appendChild(el('span', 'tile-label', label));
  box.appendChild(el('b', 'tile-value', value));
  if (sub) box.appendChild(el('span', 'tile-sub', sub));
  return box;
}

function renderKpis(s) {
  const wrap = $('kpis');
  wrap.replaceChildren();
  const t = s.totals;
  wrap.appendChild(tile('Devices', formatCount(t.devices),
    `${formatCount(t.newDevices)} new · ${formatCount(t.signedIn)} signed in`));
  wrap.appendChild(tile('Sessions', formatCount(t.sessions),
    `median ${formatDuration(s.sessionStats.medianSeconds)}`));
  wrap.appendChild(tile('Runs', formatCount(s.runs.total),
    `median score ${formatCount(s.runs.medianScore)}`));
  const bounce = bounceRate(s.sessionStats);
  wrap.appendChild(tile('Bounce', bounce === null ? '—' : `${bounce.toFixed(0)}%`,
    `${formatCount(s.sessionStats.bounces)} of ${formatCount(s.sessionStats.total)}`));
  // Status colour is paired with a word, never carried by colour alone.
  wrap.appendChild(tile(
    'Client errors',
    formatCount(s.errors.events),
    s.errors.events > 0 ? `⚠ on ${formatCount(s.errors.devices)} devices` : 'none',
    s.errors.events > 0 ? 'bad' : 'good',
  ));
  wrap.appendChild(tile('Events', formatCount(t.events), `${s.meta.days}-day window`));
}

function renderDaily(s) {
  const host = $('chart-daily');
  host.replaceChildren();

  const endDay = s.daily.length ? s.daily[s.daily.length - 1].day : new Date().toISOString().slice(0, 10);
  const series = fillDays(s.daily, s.meta.days, endDay);

  const W = 760;
  const H = 220;
  const PAD = { l: 44, r: 12, t: 12, b: 26 };
  const bw = W - PAD.l - PAD.r;
  const bh = H - PAD.t - PAD.b;

  const max = Math.max(1, ...series.map((d) => Math.max(d.devices, d.sessions, d.runs)));
  const scale = niceScale(max);

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    'aria-label': `Daily activity over ${s.meta.days} days`,
  });

  // Hairline gridlines + one y axis. Never two.
  for (const t of scale.ticks) {
    const y = PAD.t + bh - (t / scale.max) * bh;
    root.appendChild(svg('line', {
      x1: PAD.l, x2: PAD.l + bw, y1: y, y2: y, class: 'grid',
    }));
    const label = svg('text', { x: PAD.l - 8, y: y + 4, class: 'axis', 'text-anchor': 'end' });
    label.textContent = formatCount(t);
    root.appendChild(label);
  }

  const box = { width: bw, height: bh, max: scale.max };
  const lines = [
    { key: 'devices', label: 'Devices' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'runs', label: 'Runs' },
    { key: 'newDevices', label: 'New' },
  ];
  lines.forEach((line, i) => {
    const pts = linePoints(series.map((d) => d[line.key]), box);
    if (!pts) return;
    const g = svg('g', { transform: `translate(${PAD.l},${PAD.t})` });
    g.appendChild(svg('polyline', { points: pts, class: 'line', stroke: SERIES[i] }));
    root.appendChild(g);
  });

  // First and last date only — a 90-day window cannot carry 90 labels.
  if (series.length) {
    const first = svg('text', { x: PAD.l, y: H - 6, class: 'axis' });
    first.textContent = series[0].day;
    root.appendChild(first);
    const last = svg('text', { x: PAD.l + bw, y: H - 6, class: 'axis', 'text-anchor': 'end' });
    last.textContent = series[series.length - 1].day;
    root.appendChild(last);
  }

  host.appendChild(root);

  const legend = el('div', 'legend');
  lines.forEach((line, i) => {
    const item = el('span', 'legend-item');
    const dot = el('i', 'legend-dot');
    dot.style.background = SERIES[i];
    item.appendChild(dot);
    item.appendChild(el('span', null, line.label));
    legend.appendChild(item);
  });
  host.appendChild(legend);

  tableTwin($('table-daily'), ['Day', 'Devices', 'Sessions', 'Runs', 'New', 'Events'],
    series.map((d) => [d.day, d.devices, d.sessions, d.runs, d.newDevices, d.events]));
}

function renderRetention(s) {
  const wrap = $('retention');
  wrap.replaceChildren();
  for (const [key, label] of [['d1', 'D1'], ['d7', 'D7']]) {
    const cohort = s.retention[key];
    const r = retentionRate(cohort);
    wrap.appendChild(tile(
      `${label} retention`,
      r === null ? '—' : `${r.toFixed(0)}%`,
      cohort.eligible > 0
        ? `${formatCount(cohort.returned)} of ${formatCount(cohort.eligible)} eligible`
        : 'no cohort has fully elapsed yet',
    ));
  }
}

function renderRuns(s) {
  const wrap = $('run-tiles');
  wrap.replaceChildren();
  wrap.appendChild(tile('Median score', formatCount(s.runs.medianScore),
    `p90 ${formatCount(s.runs.p90Score)}`));
  wrap.appendChild(tile('Median run', formatDuration(s.runs.medianSeconds),
    `${formatCount(s.runs.total)} runs`));
  wrap.appendChild(tile('Continued', formatCount(s.runs.continued),
    ratePct(s.runs.continued, s.runs.total) + ' of runs'));
  wrap.appendChild(tile('Runs per device', s.runs.devices > 0
    ? (s.runs.total / s.runs.devices).toFixed(1) : '—', `${formatCount(s.runs.devices)} devices`));

  // Score histogram — where runs actually end.
  const host = $('chart-scores');
  host.replaceChildren();
  const buckets = fillScoreBuckets(s.runs.scoreBuckets);
  const max = Math.max(1, ...buckets.map((b) => b.runs));
  const chart = el('div', 'bars');
  for (const b of buckets) {
    const row = el('div', 'bar-row');
    row.appendChild(el('span', 'bar-label', b.label));
    const trackEl = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${(b.runs / max) * 100}%`;
    // `.bar-fill` carries a 2px min-width so a tiny-but-real value still shows.
    // A genuine ZERO must not inherit that — a sliver where there is no data
    // reads as "a few", and on a histogram of where runs end that is the exact
    // misreading this panel exists to prevent.
    if (b.runs === 0) fill.style.minWidth = '0';
    trackEl.appendChild(fill);
    row.appendChild(trackEl);
    row.appendChild(el('span', 'bar-value', formatCount(b.runs)));
    row.title = `${b.label}: ${b.runs} runs`;
    chart.appendChild(row);
  }
  host.appendChild(chart);

  tableTwin($('table-reasons'), ['How the run ended', 'Runs', 'Share'],
    s.runs.reasons.map((r) => [r.reason, r.runs, ratePct(r.runs, s.runs.total)]));
}

function funnelBlock(title, note, steps) {
  const wrap = el('section', 'funnel');
  wrap.appendChild(el('h3', null, title));
  if (note) wrap.appendChild(el('p', 'note', note));
  const rows = buildFunnel(steps);
  for (const row of rows) {
    const line = el('div', 'funnel-row');
    line.appendChild(el('span', 'funnel-label', row.label));
    const trackEl = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${row.share * 100}%`;
    if (row.value === 0) fill.style.minWidth = '0';   // see the note in renderRuns
    trackEl.appendChild(fill);
    line.appendChild(trackEl);
    line.appendChild(el('span', 'bar-value', formatCount(row.value)));
    line.appendChild(el('span', 'funnel-pct',
      row.fromPrev === null ? '' : `${row.fromPrev.toFixed(0)}%`));
    wrap.appendChild(line);
  }
  return wrap;
}

function renderFunnels(s) {
  const wrap = $('funnels');
  wrap.replaceChildren();
  const f = s.funnels;

  wrap.appendChild(funnelBlock('First run', 'Devices, not events — nine opens count once.', [
    { label: 'Opened the game', value: f.firstRun.opened },
    { label: 'Started a run', value: f.firstRun.started },
    { label: 'Finished a run', value: f.firstRun.ended },
  ]));

  wrap.appendChild(funnelBlock('Tutorial',
    `${formatCount(f.tutorial.skipped)} skipped out`, [
      { label: 'Started training', value: f.tutorial.started },
      { label: 'Completed it', value: f.tutorial.finished },
    ]));

  wrap.appendChild(funnelBlock('La Tiendita',
    `${formatCount(f.shop.denied)} hit a price they could not pay`, [
      { label: 'Opened the shop', value: f.shop.opened },
      { label: 'Bought something', value: f.shop.bought },
    ]));

  wrap.appendChild(funnelBlock('The continue offer',
    'Priced at 25 × 2ⁿ — see the ladder below.', [
      { label: 'Were offered one', value: f.continue.offered },
      { label: 'Paid for it', value: f.continue.taken },
    ]));

  wrap.appendChild(funnelBlock('Sign-in', 'The only path to cloud save and the boards.', [
    { label: 'Started sign-in', value: f.signIn.started },
    { label: 'Completed it', value: f.signIn.done },
  ]));

  wrap.appendChild(funnelBlock('Running as their own Primo', null, [
    { label: 'Opened the picker', value: f.primo.opened },
    { label: 'Set a Primo', value: f.primo.set },
  ]));
}

function renderShop(s) {
  tableTwin($('table-shop'), ['Item', 'Buys', 'Devices'],
    s.shop.map((r) => [r.item, r.buys, r.devices]), true);

  tableTwin($('table-continues'), ['Continues already taken', 'Cost', 'Offers', 'Takes', 'Rate'],
    s.continues
      .filter((r) => r.takenBefore >= 0)
      .map((r) => [
        r.takenBefore,
        formatCount(25 * Math.pow(2, r.takenBefore)),
        r.offers,
        r.takes,
        ratePct(r.takes, r.offers),
      ]), true);
}

function renderErrors(s) {
  tableTwin($('table-errors'), ['Message', 'Count', 'Devices', 'Builds'],
    s.errors.top.map((e) => [e.message, e.count, e.devices, e.versions.join(', ')]), true);
}

function renderVersions(s) {
  tableTwin($('table-versions'), ['Build', 'Devices', 'Events'],
    s.versions.map((v) => [v.version, v.devices, v.events]), true);
}

function renderNames(s) {
  // EVERY name in the window, unfiltered — this table is how a client-side typo
  // and the guard's 'unknown' bucket become visible at all.
  tableTwin($('table-names'), ['Event', 'Count', 'Devices'],
    s.counts.map((c) => [c.name, c.events, c.devices]), true);
}

/**
 * A plain table. `open` controls whether the <details> starts expanded; charts
 * get a collapsed twin, tables that ARE the panel get an open one.
 */
function tableTwin(host, headers, rows, open = false) {
  host.replaceChildren();
  const details = el('details', 'twin');
  details.open = open;
  const summary = el('summary', null, `${headers[0]} — ${rows.length} row${rows.length === 1 ? '' : 's'}`);
  details.appendChild(summary);

  if (rows.length === 0) {
    details.appendChild(el('p', 'note', 'Nothing in this window.'));
    host.appendChild(details);
    return;
  }

  const table = el('table');
  const thead = el('thead');
  const hrow = el('tr');
  for (const h of headers) hrow.appendChild(el('th', null, h));
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    row.forEach((cell, i) => {
      // textContent via el() — every one of these strings came from a client.
      tr.appendChild(el('td', i === 0 ? null : 'num', cell));
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  details.appendChild(table);
  host.appendChild(details);
}

// ---------------------------------------------------------------------- boot

function wireRange() {
  for (const btn of document.querySelectorAll('[data-days]')) {
    btn.addEventListener('click', () => {
      days = Number(btn.dataset.days) || 14;
      for (const other of document.querySelectorAll('[data-days]')) {
        other.classList.toggle('on', other === btn);
      }
      void load();
    });
  }
}

$('btn-signin').addEventListener('click', () => { void signIn(); });
$('btn-retry').addEventListener('click', () => { void load(); });
$('btn-refresh').addEventListener('click', () => { void load(); });
// Two of these — one on the toolbar, one on the not-an-admin screen. A shared
// data attribute rather than a shared id, because duplicate ids silently wire
// only the first and the other button would look broken.
for (const btn of document.querySelectorAll('[data-signout]')) {
  btn.addEventListener('click', () => { void signOut(); });
}

wireRange();
try {
  $('host').textContent = SUPABASE_URL ? new URL(SUPABASE_URL).host : 'not configured';
} catch {
  $('host').textContent = 'not configured';
}

/**
 * Render a payload without a database behind it.
 *
 * Every panel on this page is behind TWO human-only doors — a Google sign-in and
 * a row in primos_app_admins — so without this hook the only way to see a layout
 * change is to be the owner, signed in, against production, with real data in
 * the window. That is not a loop anyone can iterate a chart in, and it means the
 * renderer's first ever execution would be in front of the person it is for.
 *
 * Same shape the RPC returns; coerceStats does the rest. In the console:
 *
 *   __renderStats({ totals: { devices: 42 }, daily: [{ day: '2026-07-31', devices: 9 }] })
 *
 * Reads nothing, sends nothing, and is inert on the game's own pages — this
 * module is only ever loaded by stats.html.
 */
window.__renderStats = (payload) => {
  render(coerceStats(payload));
  show('view-stats');
};

void load();
