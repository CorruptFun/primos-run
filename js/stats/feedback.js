// The FEEDBACK panel — the read path for the suggestion box.
//
// Its own module and its own RPC rather than a section of js/stats/main.js,
// because it is the one panel that is not analytics: it has a filter of its
// own, it WRITES (triage), and it refetches on a different beat from the
// numbers. Bolting it into render() would have coupled marking a message read
// to a full analytics refetch.
//
// ⚠ THE XSS RULE FROM js/stats/main.js APPLIES HERE HARDEST, AND IT IS NOT
// THEORETICAL ANY MORE. Everywhere else on this page the client strings are
// event names and error messages — attacker-controlled in principle. Here the
// entire payload is free text that a stranger typed into a box and pressed send
// on, rendered inside a session authenticated as the owner, which is the one
// session that can read every message anyone has ever written. EVERY player
// string below reaches the DOM through textContent and nothing else. There is
// no innerHTML in this file and there must never be one.
//
// The triage buttons are the reason the panel is worth building at all: a
// suggestion box you cannot mark as read shows you the same thirty messages on
// every visit, and by the third visit you stop opening it.

import { sbClient } from '../cloud.js';
import { FEEDBACK_STATUSES, coerceFeedback } from './model.js';

const $ = (id) => document.getElementById(id);

/** Mirrors the RPC's own filter: null means every lane. */
let status = null;

/**
 * A YEAR, and deliberately NOT the 7/14/30/90 toolbar that drives every other
 * panel on this page.
 *
 * Those windows are right for a rate — a conversion measured over 90 days is a
 * different and less useful number than one measured over 14. They are wrong
 * for a queue: a report that went unread for three weeks would drop out of a
 * 14-day window along with the "Unread" count that was the only thing still
 * pointing at it, and the panel would say "all caught up" because the evidence
 * expired. Unread has to mean unread.
 */
let days = 365;
let busy = false;
let lastPayload = null;

// ------------------------------------------------------------------ elements

/** Build an element. `text` goes in as textContent — never as markup. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

const KIND_LABEL = { bug: 'Glitch', idea: 'Idea', other: 'Other' };

/** A local-time stamp, because the reader is a person deciding what is recent. */
function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 19).replace('T', ' ');
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// --------------------------------------------------------------------- fetch

async function client() {
  const c = await sbClient();
  if (!c) throw new Error('Cloud config is empty — fill js/cloud-config.js.');
  return c;
}

/**
 * Load and paint. Silent about its own failures BY DESIGN: this panel hangs off
 * a page whose other half is already rendered, and a feedback RPC that has not
 * been applied yet — the state between merging this and running the migration —
 * must not replace a working analytics dashboard with an error screen. It says
 * so in its own panel and leaves everything else alone.
 */
export async function loadFeedback(nextDays = days) {
  if (busy) return;
  busy = true;
  days = nextDays;
  try {
    const c = await client();
    const { data, error } = await c.rpc('primos_admin_feedback', {
      p_days: days, p_status: status, p_limit: 200,
    });
    if (error) {
      note(error.code === '42501' || /admin-only/i.test(error.message || '')
        ? 'Admin-only — you are signed in but not on the allow-list.'
        // The overwhelmingly likely cause on a fresh deploy, and the one worth
        // naming: the client half of this feature ships in the same commit as
        // the migration, but the migration is applied BY HAND and afterwards.
        : `${error.message || 'The feedback query failed.'} `
          + '(Has 20260731190000_primos_feedback.sql been applied?)');
      return;
    }
    lastPayload = coerceFeedback(data);
    render(lastPayload);
  } catch (e) {
    note(e?.message || 'Could not reach the feedback table.');
  } finally {
    busy = false;
  }
}

function note(message) {
  $('fb-tiles').replaceChildren();
  $('fb-list').replaceChildren(el('p', 'note', message));
  $('fb-meta').textContent = '';
}

// -------------------------------------------------------------------- render

function tile(label, value, sub, tone) {
  const box = el('div', `tile${tone ? ` tile-${tone}` : ''}`);
  box.appendChild(el('span', 'tile-label', label));
  box.appendChild(el('b', 'tile-value', value));
  if (sub) box.appendChild(el('span', 'tile-sub', sub));
  return box;
}

function render(s) {
  const tiles = $('fb-tiles');
  tiles.replaceChildren();
  const c = s.counts;
  // Unread first and coloured, because it is the only number on this page that
  // is a to-do list rather than a measurement.
  tiles.appendChild(tile('Unread', String(c.new),
    c.new > 0 ? 'waiting on you' : 'all caught up', c.new > 0 ? 'bad' : 'good'));
  tiles.appendChild(tile('Reports', String(c.total), `from ${c.devices} devices`));
  tiles.appendChild(tile('Triaged', String(c.triaged), `${c.done} done`));
  const byKind = s.kinds.map((k) => `${KIND_LABEL[k.kind] || k.kind} ${k.reports}`).join(' · ');
  tiles.appendChild(tile('By kind', String(s.kinds.length), byKind || 'nothing yet'));

  $('fb-meta').textContent = s.rows.length < s.meta.matched
    // Never imply the list on screen is all there is.
    ? `showing ${s.rows.length} of ${s.meta.matched}`
    : `${s.rows.length} shown`;

  const list = $('fb-list');
  list.replaceChildren();
  if (s.rows.length === 0) {
    list.appendChild(el('p', 'note', status
      ? `Nothing in “${status}” in this window.`
      : 'Nobody has written in this window.'));
    return;
  }
  for (const row of s.rows) list.appendChild(card(row));
}

function card(row) {
  const box = el('article', `fb-card fb-${row.status}`);

  const head = el('div', 'fb-head');
  head.appendChild(el('span', `fb-kind fb-kind-${row.kind}`, KIND_LABEL[row.kind] || row.kind));
  head.appendChild(el('span', 'fb-when', when(row.createdAt)));
  head.appendChild(el('span', 'spacer'));
  head.appendChild(el('span', 'fb-status-tag', row.status));
  box.appendChild(head);

  // THE MESSAGE. textContent, and `white-space: pre-wrap` in the stylesheet so
  // the player's own line breaks survive without a single tag being built from
  // their string.
  box.appendChild(el('p', 'fb-msg', row.message));

  if (row.contact) {
    const line = el('p', 'fb-contact-line');
    line.appendChild(el('span', 'fb-tag', 'reply to'));
    // Plain text, NOT a mailto: link. Building an href out of a player-typed
    // string is how a javascript: or data: URI ends up one click away in the
    // owner's own session, and the copy-paste this costs is worth that.
    line.appendChild(el('span', null, row.contact));
    box.appendChild(line);
  }

  // The context bag, flattened. Keys are ours (js/main.js feedbackContext);
  // values came off a client, so both go in as text.
  const ctx = Object.entries(row.context || {});
  const meta = el('p', 'fb-meta-line');
  const bits = [
    row.appVersion ? `build ${row.appVersion}` : null,
    row.lang ? `lang ${row.lang}` : null,
    `device ${row.device}${row.deviceReports > 1 ? ` (${row.deviceReports} reports)` : ''}`,
    row.signedIn ? 'signed in' : 'signed out',
    ...ctx.map(([k, v]) => `${k} ${v}`),
  ].filter(Boolean);
  meta.textContent = bits.join(' · ');
  box.appendChild(meta);

  if (row.adminNote) {
    const n = el('p', 'fb-note-line');
    n.appendChild(el('span', 'fb-tag', 'note'));
    n.appendChild(el('span', null, row.adminNote));
    box.appendChild(n);
  }

  const actions = el('div', 'fb-actions');
  for (const next of FEEDBACK_STATUSES) {
    if (next === row.status) continue;
    const b = el('button', null, next === 'new' ? 'unread' : next);
    b.addEventListener('click', () => { void setStatus(row.id, next, b); });
    actions.appendChild(b);
  }
  box.appendChild(actions);
  return box;
}

// -------------------------------------------------------------------- triage

async function setStatus(id, next, btn) {
  btn.disabled = true;
  try {
    const c = await client();
    const { error } = await c.rpc('primos_admin_feedback_status', {
      p_id: id, p_status: next,
    });
    if (error) { btn.disabled = false; note(error.message || 'Could not update that row.'); return; }
    // Refetch rather than patching the card in place: the tiles above it are
    // counts over the same rows, and a card that says 'done' next to an unread
    // count that did not move is a dashboard nobody trusts twice.
    await loadFeedback(days);
  } catch {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------- wire

/** Called once by js/stats/main.js. Wires the lane filter; fetches nothing. */
export function initFeedback() {
  for (const btn of document.querySelectorAll('[data-fb-status]')) {
    btn.addEventListener('click', () => {
      status = FEEDBACK_STATUSES.includes(btn.dataset.fbStatus) ? btn.dataset.fbStatus : null;
      for (const other of document.querySelectorAll('[data-fb-status]')) {
        other.classList.toggle('on', other === btn);
      }
      void loadFeedback(days);
    });
  }

  /**
   * Render a payload with no database behind it — the same hook, and the same
   * reasoning, as window.__renderStats in js/stats/main.js: this panel is
   * behind a Google sign-in AND a row in primos_app_admins, so without it the
   * first execution of this renderer would be in front of the person it is for.
   *
   *   __renderFeedback({ counts: { new: 2 },
   *                      rows: [{ id: 1, kind: 'bug', message: 'the slide sticks',
   *                               created_at: '2026-07-31T12:00:00Z' }] })
   */
  window.__renderFeedback = (payload) => {
    lastPayload = coerceFeedback(payload);
    render(lastPayload);
  };
}
