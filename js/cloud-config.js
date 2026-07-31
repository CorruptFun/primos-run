// Publishable backend config. THIS FILE IS MEANT TO BE COMMITTED.
//
// The URL and the anon ("publishable") key are designed to be public — Row Level
// Security is what protects the data, not the secrecy of this key. Every table
// in supabase/migrations/0001_primos_cloud.sql denies by default and re-grants
// only what the signed-in owner may touch, so shipping these two strings grants
// a reader exactly what the leaderboard already shows them.
//
// A SECRET / service-role key is the opposite and must never appear here or
// anywhere else in this repo.
//
// LEAVE THESE EMPTY and the whole cloud layer stays DORMANT: sign-in, sync and
// the boards all no-op, and the game plays exactly as it did before — local
// storage only, backup/restore still working. That is the shipping default
// until the Supabase project exists.
//
// 👉 To turn it on: paste the project URL and the anon key from
//    Supabase dashboard → Project Settings → API, then follow the checklist in
//    .claude/skills/cloud-saves-and-leaderboards/references/rollout.md
//    (the Google OAuth redirect URLs are the part that is easy to get wrong).

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// Where the supabase-js client is loaded from. This project has no build step,
// so there is no bundler to resolve a bare specifier — it comes from a CDN, and
// only ever inside the dynamic import in cloud.js, which never runs while the
// two constants above are empty. Pinned to an exact version on purpose: a
// floating tag would let a third party change what executes in the page.
export const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2.45.4';
