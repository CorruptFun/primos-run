// The dashboard's pure half: coercion, rate math, funnel assembly, chart
// geometry. No DOM, no network, no imports with side effects — so
// dev/cloud-test.html can assert all of it in the browser.
//
// TWO RULES CARRY MOST OF THE VALUE HERE.
//
// 1. COERCE SHAPE-TOLERANTLY, FIELD BY FIELD, WITH DEFAULTS. The SQL in
//    supabase/migrations/20260731120000_primos_analytics.sql and this file drift
//    independently — they are deployed by different acts, by hand, on different
//    days. A dashboard that throws on one missing key shows NOTHING, which is
//    the worst possible response to a partially-applied migration. A server that
//    predates a panel must degrade to an empty panel.
//
// 2. A RATE WITH A ZERO DENOMINATOR IS NULL, NEVER ZERO. "0% of players bought
//    something" and "nobody has opened the shop yet" are different sentences and
//    only one of them is a reason to change the game. Every rate below returns
//    null on an empty denominator and the renderer prints "—".

const num = (v, dflt = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

const int = (v, dflt = 0) => Math.round(num(v, dflt));

const str = (v, cap = 140) => (v === null || v === undefined ? '' : String(v).slice(0, cap));

const arr = (v) => (Array.isArray(v) ? v : []);

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// ------------------------------------------------------------------ coercion

/**
 * Force the RPC payload into the shape the renderer expects. Every field has a
 * default; nothing here can throw on a missing or hostile key.
 */
export function coerceStats(raw) {
  const r = obj(raw);
  const totals = obj(r.totals);
  const retention = obj(r.retention);
  const sessions = obj(r.sessions);
  const runs = obj(r.runs);
  const funnels = obj(r.funnels);
  const errors = obj(r.errors);
  const meta = obj(r.meta);

  return {
    meta: {
      days: int(meta.days, 14),
      since: str(meta.since, 40),
      generatedAt: str(meta.generated_at, 40),
    },
    totals: {
      devices: int(totals.devices),
      signedIn: int(totals.signed_in),
      sessions: int(totals.sessions),
      events: int(totals.events),
      newDevices: int(totals.new_devices),
    },
    daily: arr(r.daily).map((d) => ({
      day: str(obj(d).day, 10),
      devices: int(obj(d).devices),
      sessions: int(obj(d).sessions),
      events: int(obj(d).events),
      runs: int(obj(d).runs),
      newDevices: int(obj(d).new_devices),
    })),
    counts: arr(r.counts).map((c) => ({
      name: str(obj(c).name, 40),
      events: int(obj(c).events),
      devices: int(obj(c).devices),
    })),
    retention: {
      d1: coerceCohort(retention.d1),
      d7: coerceCohort(retention.d7),
    },
    sessionStats: {
      total: int(sessions.total),
      medianSeconds: int(sessions.median_seconds),
      bounces: int(sessions.bounces),
    },
    runs: {
      total: int(runs.total),
      devices: int(runs.devices),
      medianScore: int(runs.median_score),
      p90Score: int(runs.p90_score),
      medianSeconds: int(runs.median_seconds),
      continued: int(runs.continued),
      scoreBuckets: arr(runs.score_buckets).map((b) => ({
        bucket: int(obj(b).bucket),
        runs: int(obj(b).runs),
      })),
      reasons: arr(runs.reasons).map((x) => ({
        reason: str(obj(x).reason, 40),
        runs: int(obj(x).runs),
      })),
    },
    funnels: {
      tutorial: {
        started: int(obj(funnels.tutorial).started),
        finished: int(obj(funnels.tutorial).finished),
        skipped: int(obj(funnels.tutorial).skipped),
      },
      firstRun: {
        opened: int(obj(funnels.first_run).opened),
        started: int(obj(funnels.first_run).started),
        ended: int(obj(funnels.first_run).ended),
      },
      shop: {
        opened: int(obj(funnels.shop).opened),
        bought: int(obj(funnels.shop).bought),
        denied: int(obj(funnels.shop).denied),
      },
      continue: {
        offered: int(obj(funnels.continue).offered),
        taken: int(obj(funnels.continue).taken),
        declined: int(obj(funnels.continue).declined),
      },
      signIn: {
        started: int(obj(funnels.sign_in).started),
        done: int(obj(funnels.sign_in).done),
      },
      primo: {
        opened: int(obj(funnels.primo).opened),
        set: int(obj(funnels.primo).set),
      },
    },
    shop: arr(r.shop).map((s) => ({
      item: str(obj(s).item, 24),
      buys: int(obj(s).buys),
      devices: int(obj(s).devices),
    })),
    continues: arr(r.continues).map((c) => ({
      takenBefore: int(obj(c).taken_before, -1),
      offers: int(obj(c).offers),
      takes: int(obj(c).takes),
    })),
    errors: {
      events: int(errors.events),
      devices: int(errors.devices),
      top: arr(errors.top).map((e) => ({
        message: str(obj(e).message, 140),
        count: int(obj(e).count),
        devices: int(obj(e).devices),
        versions: arr(obj(e).versions).map((v) => str(v, 32)),
      })),
    },
    versions: arr(r.versions).map((v) => ({
      version: str(obj(v).version, 32),
      devices: int(obj(v).devices),
      events: int(obj(v).events),
    })),
  };
}

function coerceCohort(raw) {
  const c = obj(raw);
  return { eligible: int(c.eligible), returned: int(c.returned) };
}

/** The four triage lanes, in the order the queue is worked. */
export const FEEDBACK_STATUSES = ['new', 'triaged', 'done', 'spam'];

/**
 * Force primos_admin_feedback()'s payload into the shape the panel expects.
 *
 * Same shape-tolerance rule as coerceStats, and one addition that only applies
 * here: EVERY STRING ON A ROW WAS TYPED BY A PLAYER. The caps below are the
 * second line of defence behind the guard trigger — a client that predates a
 * cap, or a row written before one existed, still has to render as a row and
 * not as a page-wide layout failure. The FIRST line of defence is that the
 * renderer only ever writes these through textContent; see the XSS note at the
 * top of js/stats/feedback.js. Truncating here is not that defence and must
 * never be mistaken for it.
 */
export function coerceFeedback(raw) {
  const r = obj(raw);
  const meta = obj(r.meta);
  const counts = obj(r.counts);

  return {
    meta: {
      days: int(meta.days, 30),
      status: FEEDBACK_STATUSES.includes(meta.status) ? meta.status : null,
      limit: int(meta.limit, 200),
      matched: int(meta.matched),
      generatedAt: str(meta.generated_at, 40),
    },
    counts: {
      total: int(counts.total),
      new: int(counts.new),
      triaged: int(counts.triaged),
      done: int(counts.done),
      spam: int(counts.spam),
      devices: int(counts.devices),
    },
    kinds: arr(r.kinds).map((k) => ({
      kind: str(obj(k).kind, 16),
      reports: int(obj(k).reports),
    })),
    rows: arr(r.rows).map((x) => {
      const row = obj(x);
      return {
        id: int(row.id),
        kind: str(row.kind, 16) || 'other',
        // The one field that is allowed to be long — it is the whole point of
        // the panel, and a bug report cut off at 140 characters is a bug report
        // whose repro steps are missing.
        message: str(row.message, 1000),
        contact: str(row.contact, 80),
        context: obj(row.context),
        appVersion: str(row.app_version, 32),
        lang: str(row.lang, 8),
        status: FEEDBACK_STATUSES.includes(row.status) ? row.status : 'new',
        adminNote: str(row.admin_note, 500),
        signedIn: !!row.signed_in,
        device: str(row.device, 8),
        deviceReports: int(row.device_reports, 1),
        createdAt: str(row.created_at, 40),
      };
    }),
  };
}

// ----------------------------------------------------------------- rate math

/**
 * A percentage, or null when there is nothing to divide by.
 *
 * THE NULL IS THE WHOLE POINT. Returning 0 for 0/0 puts a number on the screen
 * that looks like a measurement and is not one — and 0% conversion is precisely
 * the kind of figure someone acts on.
 */
export function rate(numerator, denominator) {
  const n = num(numerator, 0);
  const d = num(denominator, 0);
  if (!(d > 0)) return null;
  return (n / d) * 100;
}

/** A rate as text, with the null case spelled "—" rather than "0%". */
export function ratePct(numerator, denominator, digits = 0) {
  const r = rate(numerator, denominator);
  return r === null ? '—' : `${r.toFixed(digits)}%`;
}

/**
 * D1/D7, over the HONEST denominator.
 *
 * `eligible` counts only devices whose day0+N has FULLY elapsed — the SQL
 * excludes the rest. A cohort that has not had its chance yet must not be
 * folded in as a miss, because that drags every retention number toward zero
 * and does it worse the more new players arrive, which is exactly backwards.
 */
export function retentionRate(cohort) {
  const c = obj(cohort);
  return rate(c.returned, c.eligible);
}

/** Bounce share of sessions, or null when there were no sessions. */
export function bounceRate(sessionStats) {
  const s = obj(sessionStats);
  return rate(s.bounces, s.total);
}

/** `1m 42s` / `48s` — seconds as something readable at a glance. */
export function formatDuration(seconds) {
  const s = Math.max(0, int(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

/** Thousands separators, and never `NaN` on the screen. */
export function formatCount(n) {
  return int(n).toLocaleString();
}

// ------------------------------------------------------------------- funnels

/**
 * Turn a list of `{ label, value }` steps into rows carrying conversion against
 * the PREVIOUS step and against the first.
 *
 * Steps are named by the caller from the EVENTS constant in js/analytics.js —
 * never from a string literal here. A funnel step built on a misspelled name
 * renders as a permanently-zero row that looks exactly like real data, and
 * there is no compile step in this project to catch it. dev/cloud-test.html
 * pins the two together instead.
 */
export function buildFunnel(steps) {
  const rows = arr(steps).map((s) => ({ label: str(obj(s).label, 40), value: int(obj(s).value) }));
  if (rows.length === 0) return [];
  const first = rows[0].value;
  return rows.map((row, i) => ({
    ...row,
    fromPrev: i === 0 ? null : rate(row.value, rows[i - 1].value),
    fromFirst: i === 0 ? null : rate(row.value, first),
    // Share of the widest step, for the bar width. Guarded so an empty funnel
    // renders as empty bars rather than NaN-width rectangles.
    share: first > 0 ? Math.max(0, Math.min(1, row.value / first)) : 0,
  }));
}

// --------------------------------------------------------------- score buckets

/**
 * Labels for the run-score histogram.
 *
 * The SQL owns the bucket INDICES (`width_bucket(score, 0, 5000, 10)`) and this
 * file owns the LABELS. Splitting it that way is deliberate: the labels are a
 * presentation choice that changes often, the boundaries are a data choice that
 * must not, and keeping the boundaries in one place stops the two versions of
 * "what is bucket 4" from drifting apart.
 *
 * width_bucket returns 0 for below-range and 11 for above-range, which is why
 * there are 12 labels and not 10.
 */
export const SCORE_BUCKET_LABELS = [
  '0',
  '1–500', '500–1k', '1k–1.5k', '1.5k–2k', '2k–2.5k',
  '2.5k–3k', '3k–3.5k', '3.5k–4k', '4k–4.5k', '4.5k–5k',
  '5k+',
];

export function scoreBucketLabel(index) {
  const i = int(index, 0);
  return SCORE_BUCKET_LABELS[i] ?? `#${i}`;
}

/** Zero-fill the histogram so an empty bucket is a visible gap, not a missing bar. */
export function fillScoreBuckets(buckets) {
  const out = SCORE_BUCKET_LABELS.map((label, i) => ({ bucket: i, label, runs: 0 }));
  for (const b of arr(buckets)) {
    const i = int(obj(b).bucket, -1);
    if (i >= 0 && i < out.length) out[i].runs = int(obj(b).runs);
  }
  return out;
}

// ----------------------------------------------------------- chart geometry

/**
 * Zero-fill a daily series across the whole window.
 *
 * THE SILENCE IS THE SIGNAL. A day with no events is a day the pipe may have
 * been dead, and a line chart that simply skips it draws a smooth line straight
 * through the outage. `days` and `endDay` come from the caller so this stays
 * pure — no clock in here.
 */
export function fillDays(series, days, endDay) {
  const byDay = new Map();
  for (const d of arr(series)) {
    const day = str(obj(d).day, 10);
    if (day) byDay.set(day, d);
  }
  const out = [];
  const end = new Date(`${str(endDay, 10)}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return arr(series);
  for (let i = int(days, 14) - 1; i >= 0; i--) {
    const dt = new Date(end.getTime() - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    const hit = byDay.get(key);
    out.push({
      day: key,
      devices: int(obj(hit).devices),
      sessions: int(obj(hit).sessions),
      events: int(obj(hit).events),
      runs: int(obj(hit).runs),
      newDevices: int(obj(hit).new_devices ?? obj(hit).newDevices),
    });
  }
  return out;
}

/**
 * A y-axis that ends on a round number: 1/2/5 × 10ⁿ, at or above the max.
 * Returns `{ max, ticks }` — always at least `[0, 1]` so an all-zero chart still
 * draws an axis instead of collapsing to a line.
 */
export function niceScale(max, tickCount = 4) {
  const m = num(max, 0);
  if (!(m > 0)) return { max: 1, ticks: [0, 1] };
  const rough = m / Math.max(1, int(tickCount, 4));
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(m / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}

/** Map a series to SVG points. Pure — the caller owns the box. */
export function linePoints(values, box) {
  const b = obj(box);
  const w = num(b.width, 0);
  const h = num(b.height, 0);
  const max = num(b.max, 1) || 1;
  const vals = arr(values).map((v) => num(v, 0));
  if (vals.length === 0) return '';
  const stepX = vals.length > 1 ? w / (vals.length - 1) : 0;
  return vals
    .map((v, i) => `${(i * stepX).toFixed(2)},${(h - (v / max) * h).toFixed(2)}`)
    .join(' ');
}
