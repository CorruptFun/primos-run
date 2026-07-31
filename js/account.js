// CUENTA — sign-in, race name, and device backup.
//
// Three auth states, all of which must read as intentional:
//   · not configured — a friendly note. This is the state the game SHIPS in, so
//     it is not an error and must not look like one; the backup block below it
//     is genuinely useful here.
//   · signed out     — what signing in buys, then one button.
//   · signed in      — who you are, and a way out.
//
// The backup block is shown in ALL THREE. A downloaded file survives clearing
// site data, which is the exact event that loses everything else, and it is the
// only durability on offer before the cloud exists.

import {
  cloudSession, isCloudConfigured, onCloudChange, signInWithGoogle, signOutCloud,
} from './cloud.js';
import { t } from './i18n.js';
import { anonName, getHandle, sanitizeName, setHandle } from './leaderboard.js';
import {
  QUALIFY_SCORE, REFEREE_CHELAS, REFERRER_CHELAS,
  claimReferralRewards, fetchMyReferralStats, fetchPendingRewards, inviteLink, mintMyCode,
} from './referrals.js';
import * as store from './store.js';
import { EVENTS, isOptedOut, setOptedOut, track } from './analytics.js';
import { cachedCount, clearArtCache } from './primo-cache.js';
import { busy, flashLabel, uiToast } from './ui-feedback.js';

const $ = (id) => document.getElementById(id);

// Set when the sign-in redirect is started, spent when the page comes back with
// a session. See the comment at the call site.
const SIGNIN_FLAG = 'primos-run:signin-started';

let unsub = null;

/**
 * Say what just happened, twice.
 *
 * `#acct-status` is the record — it sits above BACK and holds the last thing
 * that happened for as long as the screen is up. It is NOT the notification:
 * this sheet is far taller than a phone, so a press on SAVE or COPY CODE wrote
 * its confirmation several hundred pixels below the fold and the player saw
 * nothing at all. The toast is fixed to the viewport and is the half that
 * actually gets read.
 */
function status(msg, bad = false) {
  const el = $('acct-status');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  // Guarded, because refreshAccount() clears the line on every repaint and an
  // empty toast is a black bar sliding in over nothing.
  if (msg) uiToast(msg, bad);
}

// --- auth block -------------------------------------------------------------

function paintAuth() {
  const host = $('acct-auth');
  host.replaceChildren();

  const note = (text) => {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = text;
    return p;
  };

  if (!isCloudConfigured()) {
    host.append(note(t('acct.offBuild')));
    return;
  }

  const session = cloudSession();
  if (session) {
    host.append(note(session.email
      ? t('acct.signedInAs').replace('%s', session.email)
      : t('acct.signedIn')));
    const out = document.createElement('button');
    out.className = 'btn btn-ghost btn-small wide';
    out.type = 'button';
    out.textContent = t('acct.signOut');
    out.addEventListener('click', () => {
      out.disabled = true;
      out.textContent = t('acct.signingOut');
      // Reload rather than patching state in place: half the game is holding a
      // save from an account that no longer applies, and reasoning about which
      // caches to invalidate is strictly harder than starting clean.
      signOutCloud().then(() => location.reload()).catch(() => {
        out.disabled = false;
        out.textContent = t('acct.signOut');
      });
    });
    host.append(out);
    return;
  }

  host.append(note(t('acct.pitch')));
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary wide';
  btn.type = 'button';
  btn.textContent = t('acct.signIn');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = t('acct.continuing');
    track(EVENTS.SIGN_IN_START);
    // Sign-in leaves the page entirely, so "did it work" cannot be observed from
    // here — and on the way back it is a FRESH page load whose null→session
    // transition is indistinguishable from a returning player's ordinary boot
    // restore. sessionStorage survives the same-tab redirect and nothing else,
    // which makes it exactly the right width for this: the flag is set here and
    // spent by the completion check at the bottom of this file.
    try {
      sessionStorage.setItem(SIGNIN_FLAG, '1');
    } catch {
      // Blocked (private mode). The funnel loses its numerator; sign-in itself
      // is unaffected, which is the right way round for a metric to fail.
    }
    // The tap navigates the whole page to Google, so nothing after this runs on
    // success and the button legitimately stays in this state. Only a failure to
    // START the redirect is reportable from here.
    signInWithGoogle().then((res) => {
      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = t('acct.signIn');
        status(res.error ?? t('acct.signInFail'), true);
      }
    });
  });
  host.append(btn);
}

// --- race name --------------------------------------------------------------

/**
 * What the board will actually show for the text currently typed. Shared by the
 * initial paint and the live `input` handler so the two can never drift.
 * `anonFallback` is null when signed out — there is no user id to derive it
 * from, and inventing one would preview a name they will not get.
 */
function nameHint(value, anonFallback) {
  const clean = value.trim() === '' ? null : sanitizeName(value);
  if (clean) return t('acct.nameShows').replace('%s', clean);
  return anonFallback ? t('acct.nameAnon').replace('%s', anonFallback) : t('acct.nameNone');
}

function paintName() {
  const wrap = $('acct-name');
  // Only meaningful once there is a board to appear on.
  wrap.classList.toggle('hidden', !isCloudConfigured());
  if (!isCloudConfigured()) return;

  const session = cloudSession();
  // Null when signed out: there is no user id to derive the anonymous name
  // from yet, and inventing one would show a name they will not actually get.
  const anonFallback = session ? anonName(session.userId) : null;

  $('name-copy').textContent = t(session ? 'acct.nameCopyIn' : 'acct.nameCopyOut');

  const input = $('name-input');
  const preview = $('name-preview');

  // Sanitization is otherwise invisible and surprising, so show the result live.
  input.value = getHandle() ?? '';
  preview.textContent = nameHint(input.value, anonFallback);
}

// --- invites ----------------------------------------------------------------

/**
 * Paint generation. Every repaint bumps this and the async steps below check it
 * before touching the DOM, so a slow mintMyCode() that resolves after the player
 * has signed out — or after a newer repaint already ran — cannot write a stale
 * code into a panel that has moved on.
 */
let invitePaint = 0;

/** The pending rewards the claim button is currently offering, if any. */
let pendingRewards = [];

function paintInvite() {
  const gen = ++invitePaint;
  const wrap = $('acct-invite');
  const claim = $('btn-invite-claim');
  const share = $('btn-invite-share');

  // A code belongs to an account, so there is nothing truthful to show without
  // one — and nothing at all on the build this game ships as.
  const on = isCloudConfigured() && !!cloudSession();
  wrap.classList.toggle('hidden', !on);
  claim.classList.add('hidden');
  pendingRewards = [];
  if (!on) return;

  $('invite-copy').textContent = t('invite.pitch')
    .replace('%r', String(REFERRER_CHELAS))
    .replace('%f', String(REFEREE_CHELAS))
    // Grouped like every other score the game prints — a bare 1500 next to two
    // two-digit beer counts reads as a fourth small number rather than a target.
    .replace('%s', QUALIFY_SCORE.toLocaleString());

  const link = $('invite-link');
  const copy = $('btn-invite-copy');
  link.value = '';
  link.placeholder = t('invite.minting');
  // There is nothing to copy until the mint lands, and a button that answers a
  // press with an error is the same dead button by another route. It says so
  // now — see `.btn:disabled` in the stylesheet.
  copy.disabled = true;
  $('invite-stats').textContent = '';
  // navigator.share is a phone affordance and absent on most desktops. Asking
  // first is the difference between a share sheet and a button that does nothing.
  share.classList.toggle('hidden', typeof navigator.share !== 'function');

  void mintMyCode().then((code) => {
    if (gen !== invitePaint) return;
    if (!code) {
      // Offline, or the mint did not land. Not an error state the player can act
      // on, so it reads as "not yet" and the next repaint tries again.
      link.placeholder = t('invite.noCode');
      share.classList.add('hidden');
      return;
    }
    link.value = inviteLink(code);
    copy.disabled = false;
  });

  void fetchMyReferralStats().then((s) => {
    if (gen !== invitePaint) return;
    // Null means "we could not ask", which is not the same as zero — showing a
    // confident 0 to someone whose friends HAVE joined is the worse lie.
    $('invite-stats').textContent = s
      ? t('invite.stats')
        .replace('%i', String(s.invited))
        .replace('%q', String(s.qualified))
        .replace('%c', String(s.claimed))
      : t('invite.statsOff');
  });

  void fetchPendingRewards().then((rows) => {
    if (gen !== invitePaint || rows.length === 0) return;
    pendingRewards = rows;
    claim.textContent = t('invite.claim')
      .replace('%n', String(rows.length))
      .replace('%c', String(rows.length * REFERRER_CHELAS));
    claim.disabled = false;
    claim.classList.remove('hidden');
  });
}

/**
 * The newcomer's welcome, paid here because this is a screen they reach with the
 * cloud already reconciled.
 *
 * It lands on the visit AFTER the run that qualified them: the qualify stamp
 * goes up on the save push, so the earliest anything can know is the next time
 * the client asks. That is a deliberate simplification, not an oversight — the
 * alternative is threading a reward moment through the game-over path for a
 * grant the player is not waiting on.
 */
function payWelcomeIfDue() {
  if (!isCloudConfigured() || !cloudSession()) return;
  void import('./referrals.js').then(async (r) => {
    if (!(await r.isWelcomePending(store.load()))) return;
    const left = r.claimWelcome();
    if (left === null) return;                 // already collected — say nothing
    status(t('invite.welcome').replace('%c', String(REFEREE_CHELAS)));
    paintInvite();
  });
}

// --- wiring -----------------------------------------------------------------

/** Wire the screen once, at boot. */
/**
 * Close the sign-in funnel, if this page load is the far side of one.
 *
 * Called on every session change AND once at init, because the OAuth return can
 * establish the session either before or after this module wires its listener
 * and only one of those two orders fires an event. Spending the flag makes it
 * idempotent, so being called both ways costs nothing.
 */
function completeSignIn() {
  try {
    if (!cloudSession()) return;
    if (sessionStorage.getItem(SIGNIN_FLAG) !== '1') return;
    sessionStorage.removeItem(SIGNIN_FLAG);
    track(EVENTS.SIGN_IN_DONE);
  } catch {
    /* storage blocked — the funnel loses a row, nothing else */
  }
}

// --- analytics opt-out ------------------------------------------------------

/**
 * The toggle, and the honest sentence next to it.
 *
 * It is in ACCOUNT rather than buried in a settings sheet because this is where
 * the other "what leaves this device" decisions live — the race name and the
 * cloud save — and a privacy control the player cannot find is not a control.
 */
function paintPrivacy() {
  const box = $('acct-analytics');
  if (!box) return;
  box.checked = !isOptedOut();
}

/**
 * How much collection art this device is holding.
 *
 * Shown because the browser's own copy now promises the art "is kept on your
 * device, never on ours" — a claim that needs somewhere to point, and a stored-
 * data disclosure the player cannot act on is not a disclosure. Clearing it
 * costs nothing but a re-download of whatever they look at next.
 */
function paintArtCache() {
  const copy = $('acct-art-copy');
  const btn = $('btn-clear-art');
  if (!copy || !btn) return;
  const n = cachedCount();
  copy.textContent = n > 0
    ? t('acct.artCopy').replace('%n', String(n))
    : t('acct.artNone');
  btn.disabled = n === 0;
}

export function initAccount() {
  const input = $('name-input');
  const preview = $('name-preview');

  const previewNow = () => {
    const session = cloudSession();
    preview.textContent = nameHint(input.value, session ? anonName(session.userId) : null);
  };
  input.addEventListener('input', previewNow);

  const saveName = () => {
    const applied = setHandle(input.value);
    input.value = applied ?? '';
    previewNow();
    status(applied ? t('acct.nameSet').replace('%s', applied) : t('acct.nameCleared'));
    // Saving a name you already had changes nothing visible anywhere on the
    // sheet — same input, same preview line — so the button has to be the one
    // that says it landed.
    flashLabel($('btn-name'), t('ui.saved'));
  };
  $('btn-name').addEventListener('click', saveName);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });

  // --- invites ---
  $('btn-invite-copy').addEventListener('click', () => {
    const url = $('invite-link').value;
    if (!url) { status(t('invite.noCode'), true); return; }
    // The readonly input IS the fallback here — unlike the backup code there is
    // always something on screen to copy by hand, so a blocked clipboard just
    // selects it rather than revealing anything new.
    const fallback = () => {
      const el = $('invite-link');
      el.focus();
      el.select();
      status(t('acct.copyManual'));
    };
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url)
          .then(() => {
            status(t('invite.copied'));
            flashLabel($('btn-invite-copy'), t('ui.copied'));
          })
          .catch(fallback);
      } else fallback();
    } catch {
      fallback();
    }
  });

  $('btn-invite-share').addEventListener('click', () => {
    const url = $('invite-link').value;
    if (!url || typeof navigator.share !== 'function') return;
    // A dismissed share sheet rejects, and that is not a failure worth reporting.
    navigator.share({ title: t('invite.shareTitle'), text: t('invite.shareText'), url })
      .catch(() => {});
  });

  $('btn-invite-claim').addEventListener('click', () => {
    const btn = $('btn-invite-claim');
    if (pendingRewards.length === 0) return;
    // A real round trip, and the only one on this screen the player is actually
    // waiting on. paintInvite() below rebuilds the label either way, so the
    // restore is belt and braces rather than the mechanism.
    const done = busy(btn, t('invite.claiming'));
    void claimReferralRewards(pendingRewards).then((res) => {
      done();
      if (res.claimed > 0) {
        status(t('invite.claimed')
          .replace('%n', String(res.claimed))
          .replace('%c', String(res.claimed * REFERRER_CHELAS)));
      } else {
        // Nothing stamped — offline, or another device collected first. The rows
        // are untouched either way, so a repaint offers them again.
        status(t('invite.claimFail'), true);
      }
      paintInvite();
    });
  });

  // --- backup ---
  $('btn-backup-file').addEventListener('click', () => {
    try {
      const a = document.createElement('a');
      const url = URL.createObjectURL(new Blob([store.exportSave()], { type: 'text/plain' }));
      a.href = url;
      a.download = 'primos-run-backup.txt';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      status(t('acct.savedFile'));
      // A download that goes straight to the Files app shows nothing on the
      // page it came from, which is exactly the "I pressed it and nothing
      // happened" case.
      flashLabel($('btn-backup-file'), t('ui.saved'));
    } catch {
      status(t('acct.noDownload'), true);
    }
  });

  $('btn-backup-copy').addEventListener('click', () => {
    const code = store.exportSave();
    const out = $('backup-out');
    // The read-only textarea is a FALLBACK, shown only when the clipboard is
    // unavailable or blocked — focused and selected so a manual copy is one
    // gesture rather than a hunt.
    const fallback = () => {
      out.value = code;
      out.classList.remove('hidden');
      out.focus();
      out.select();
      status(t('acct.copyManual'));
    };
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code)
          .then(() => {
            status(t('acct.copied'));
            flashLabel($('btn-backup-copy'), t('ui.copied'));
          })
          .catch(fallback);
      } else fallback();
    } catch {
      fallback();
    }
  });

  $('btn-restore').addEventListener('click', () => {
    const code = $('restore-code').value.trim();
    if (!code) { status(t('acct.needCode'), true); return; }
    const done = busy($('btn-restore'), t('acct.loading'));
    // Deferred past a paint on purpose. importSave() is synchronous and a
    // successful one ends in location.reload(), so doing both in this task sets
    // a working label the player never sees and then tears the page down — a
    // press with a blank pause after it, which is the complaint this whole
    // change is answering. rAF alone runs BEFORE the frame paints; the timeout
    // inside it is what puts this after one.
    requestAnimationFrame(() => setTimeout(() => {
      if (store.importSave(code)) { location.reload(); return; }
      done();
      status(t('acct.badCode'), true);
    }, 0));
  });

  const file = $('restore-file');
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    file.value = '';   // allow re-picking the same file later
    if (!f) return;
    f.text()
      .then((txt) => {
        if (store.importSave(txt.trim())) location.reload();
        else status(t('acct.badBackup'), true);
      })
      .catch(() => status(t('acct.badBackup'), true));
  });

  // --- downloaded art ---
  $('btn-clear-art').addEventListener('click', () => {
    const btn = $('btn-clear-art');
    btn.disabled = true;
    void clearArtCache().then((ok) => {
      status(ok ? t('acct.artCleared') : t('acct.artClearFail'), !ok);
      paintArtCache();
    });
  });

  // --- privacy ---
  const optIn = $('acct-analytics');
  if (optIn) {
    optIn.addEventListener('change', () => {
      setOptedOut(!optIn.checked);
      status(optIn.checked ? t('acct.statsOn') : t('acct.statsOff'));
    });
  }

  // The OAuth return can land before this module wires its listener, so the
  // completion is checked here as well as on every session change. Spending the
  // flag makes the pair idempotent.
  completeSignIn();
}

/**
 * Repaint the account screen from live state.
 *
 * Showing and hiding the screen itself is main.js's job: `.screen` backgrounds
 * are translucent so they can sit over the canvas, which means two of them
 * visible at once show through each other. Screens are mutually exclusive and
 * exactly one place should know that.
 */
export function refreshAccount() {
  status('');
  paintAuth();
  paintName();
  paintInvite();
  paintPrivacy();
  paintArtCache();
  // After paintInvite, so a welcome that pays out repaints over a panel that has
  // already been built rather than racing it.
  payWelcomeIfDue();
  // Repaint whenever auth changes while the screen is open. Only meaningful on
  // a configured build — auth never changes otherwise, so the friendly
  // not-configured path never depends on a live client.
  if (isCloudConfigured() && !unsub) {
    unsub = onCloudChange(() => {
      completeSignIn();
      paintAuth();
      paintName();
      paintInvite();
    });
  }
}

/**
 * Repaint after a language switch. Only does anything when the screen is up: the
 * auth block and the name preview are BUILT from live state, so `applyLang`'s
 * data-i18n sweep cannot reach them.
 */
export function relangAccount() {
  if (!$('screen-account').classList.contains('hidden')) refreshAccount();
}

/**
 * Drop the auth subscription when the screen goes away. Without this a closed
 * screen keeps repainting a tree nobody is looking at on every future sign-in.
 */
export function releaseAccount() {
  if (unsub) { unsub(); unsub = null; }
}
