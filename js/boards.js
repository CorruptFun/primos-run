// LA TABLA — the leaderboard screen, and the one-line standing on the game-over
// sheet.
//
// Both boards render through ONE row builder. js/leaderboard.js returns the same
// { key, entries, myRank, myScore } shape for daily and weekly, with an optional
// per-row `valueText` for the boards whose readout is not just the sort key — so
// nothing here has to know which board it is drawing.
//
// EMPTY IS A NORMAL STATE. Signed out, cloud not configured, offline, and a
// genuinely empty board all arrive here as the empty board, and all four render
// the same invitation. An error state would be wrong for three of them and
// unhelpful for the fourth.

import { cloudSession, isCloudConfigured } from './cloud.js';
import { t } from './i18n.js';
import { fetchDailyBoard, fetchWeeklyBoard } from './leaderboard.js';

const $ = (id) => document.getElementById(id);

let tab = 'daily';
let token = 0;   // guards against a slow fetch landing after the player switched tabs

function rowsInto(list, board) {
  list.replaceChildren();
  board.entries.forEach((e, i) => {
    const li = document.createElement('li');
    if (e.you) li.className = 'you';
    // Stagger the reveal, but cap it: a 25-row board should not take two
    // seconds to finish arriving.
    li.style.animationDelay = `${Math.min(i, 12) * 22}ms`;

    const r = document.createElement('span');
    r.className = 'r';
    r.textContent = e.rank;

    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = e.name;          // textContent, never innerHTML — this is player-supplied

    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = e.valueText ?? Math.floor(e.score).toLocaleString();
    // A run that paid for a continue still ranks — that is the decision — so the
    // board has to say which ones did. Marked on the SCORE, not the name: it is
    // the number that was bought, not the player who is suspect.
    if (e.continued) {
      const c = document.createElement('i');
      c.className = 'cont';
      c.textContent = t('board.contTag');
      v.append(c);
    }

    li.append(r, n, v);
    list.append(li);
  });
}

function emptyMessage() {
  if (!isCloudConfigured()) return t('board.offBuild');
  if (!cloudSession()) return t('board.signedOut');
  return t('board.nobody');
}

async function paint() {
  const mine = ++token;
  const list = $('board-list');
  const me = $('board-me');
  const key = $('board-key');
  const note = $('board-note');

  key.textContent = t('board.loading');
  list.replaceChildren();
  me.classList.add('hidden');
  note.classList.add('hidden');

  const board = tab === 'daily' ? await fetchDailyBoard() : await fetchWeeklyBoard();
  if (mine !== token) return;   // the player switched tabs while this was in flight

  // %k is filled here, not in t() — the table holds strings, never builds them.
  key.textContent = t(tab === 'daily' ? 'board.keyDaily' : 'board.keyWeekly')
    .replace('%k', board.key);

  if (!board.entries.length) {
    const p = document.createElement('p');
    p.className = 'board-empty';
    p.textContent = emptyMessage();
    list.append(p);
    return;
  }

  rowsInto(list, board);

  // The legend earns its place only when something on screen actually carries
  // the mark — an unexplained tag is worse than no tag, and a permanent line
  // about a rule most boards never hit is noise.
  const marked = board.entries.some((e) => e.continued) || !!board.myContinued;
  if (marked) {
    note.textContent = t('board.contNote');
    note.classList.remove('hidden');
  }

  // The pinned footer is only interesting when the player is NOT already visible
  // in the rows above it.
  const inRows = board.entries.some((e) => e.you);
  if (!inRows && board.myRank) {
    const value = board.myValueText ?? Math.floor(board.myScore).toLocaleString();
    const mark = board.myContinued ? ` ${t('board.contTag')}` : '';
    me.textContent = `${t('board.you')} · #${board.myRank} · ${value}${mark}`;
    me.classList.remove('hidden');
  }
}

function setTab(next) {
  tab = next;
  $('tab-daily').classList.toggle('on', next === 'daily');
  $('tab-weekly').classList.toggle('on', next === 'weekly');
  $('tab-daily').setAttribute('aria-selected', String(next === 'daily'));
  $('tab-weekly').setAttribute('aria-selected', String(next === 'weekly'));
  void paint();
}

/** Wire the screen once, at boot. */
export function initBoards() {
  $('tab-daily').addEventListener('click', () => setTab('daily'));
  $('tab-weekly').addEventListener('click', () => setTab('weekly'));
}

/**
 * Repopulate the board. Fetches on OPEN, never on a timer — a board is read far
 * less often than it is written.
 *
 * Showing and hiding the screen itself is main.js's job: `.screen` backgrounds
 * are translucent so they can sit over the canvas, which means two of them
 * visible at once show through each other. Screens are mutually exclusive and
 * exactly one place should know that.
 */
export function refreshBoards() {
  setTab(tab);
}

/**
 * Repaint after a language switch. Only does anything when the screen is up —
 * the rows are composed from live state, so `applyLang`'s data-i18n sweep cannot
 * reach them, and re-fetching a hidden board would be pure waste.
 */
export function relangBoards() {
  if (!$('screen-boards').classList.contains('hidden')) setTab(tab);
}

/**
 * The one-line standing under the final score.
 *
 * Deliberately fire-and-forget and deliberately hidden until it has something
 * true to say: the run has just been submitted on the same beat, so this races
 * the upsert, and a rank that says "#—" would be worse than no rank at all. The
 * caller re-hides it at the start of each game-over.
 */
export async function showRunStanding() {
  const el = $('over-rank');
  el.classList.add('hidden');
  if (!isCloudConfigured() || !cloudSession()) return;
  try {
    // Give the submission that rode this run's save push a moment to land, or
    // we rank the player against a board that does not yet contain them.
    await new Promise((r) => setTimeout(r, 1200));
    const board = await fetchDailyBoard(25);
    if (!board.myRank) return;
    // Continued runs count, so the rank shown here is the rank that stands — but
    // it says outright that it was bought, because this is the moment the player
    // is looking straight at the number and the board will carry the same mark.
    const first = board.myRank === 1;
    const key = board.myContinued
      ? (first ? 'over.rankFirstCont' : 'over.rankCont')
      : (first ? 'over.rankFirst' : 'over.rank');
    el.textContent = t(key).replace('%n', String(board.myRank));
    el.classList.toggle('bought', !!board.myContinued);
    el.classList.remove('hidden');
  } catch {
    // the standing is a garnish — never let it surface
  }
}
