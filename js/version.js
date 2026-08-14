// The build stamp, and nothing else.
//
// WHY IT IS ITS OWN FILE. Every analytics event carries this (js/analytics.js),
// and under a prompt-mode service worker that is not decoration: cached clients
// keep running an old bundle for days after a deploy, so a metric that moves
// afterwards is unreadable without knowing who is running which code. "Errors
// spiked" and "errors spiked ON THIS BUILD" are different sentences.
//
// It lives apart from js/config.js because that file is game tuning — a number
// someone changes while playing with feel — and this is a deploy artifact. A
// bumped version in a diff full of tuning is a bumped version nobody reviews.
//
// ⚠ BUMP THIS WITH `CACHE_VERSION` IN sw.js, in the same commit. There is no
// build step to derive it from a commit SHA, so the two are kept in step by
// hand and the checklist in docs/GO_LIVE_CHECKLIST.md asks for both. If they
// ever disagree, sw.js is the one players actually feel and this one is the one
// the dashboard reports — a drift means the dashboard is attributing events to
// the wrong build, which is worse than it sounds, because that is exactly the
// panel you reach for when something has just broken.
export const APP_VERSION = 'v21-fair-at-any-framerate';
