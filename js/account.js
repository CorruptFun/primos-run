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
import * as store from './store.js';

const $ = (id) => document.getElementById(id);

let unsub = null;

function status(msg, bad = false) {
  const el = $('acct-status');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
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

// --- wiring -----------------------------------------------------------------

/** Wire the screen once, at boot. */
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
  };
  $('btn-name').addEventListener('click', saveName);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });

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
          .then(() => status(t('acct.copied')))
          .catch(fallback);
      } else fallback();
    } catch {
      fallback();
    }
  });

  $('btn-restore').addEventListener('click', () => {
    const code = $('restore-code').value.trim();
    if (!code) { status(t('acct.needCode'), true); return; }
    if (store.importSave(code)) location.reload();
    else status(t('acct.badCode'), true);
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
  // Repaint whenever auth changes while the screen is open. Only meaningful on
  // a configured build — auth never changes otherwise, so the friendly
  // not-configured path never depends on a live client.
  if (isCloudConfigured() && !unsub) {
    unsub = onCloudChange(() => { paintAuth(); paintName(); });
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
