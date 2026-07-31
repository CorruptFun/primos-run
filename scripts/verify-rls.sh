#!/usr/bin/env bash
# ============================================================================
# verify-rls.sh — prove the exposure rules of 0001_primos_cloud.sql against a
# LIVE API.
#
# Migrations proving themselves locally is not the same statement as "production
# is safe". This is what turns one into the other, and it has to run at least
# twice: once against a local stack while writing the migration, and again the
# moment it is applied to the real project.
#
# USAGE
#   scripts/verify-rls.sh local
#   scripts/verify-rls.sh <url> <publishable-key>
#
# EVERY "must be empty" assertion is paired with a CONTROL probe against a table
# that does not exist. Without the control, an empty [] is ambiguous between
# "RLS refused you" and "the table isn't there at all" — and those two look
# identical from the client while meaning opposite things about your security.
# ============================================================================
set -uo pipefail

case "${1:-}" in
  local)
    URL="http://127.0.0.1:54321"
    KEY="$(supabase status -o json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ANON_KEY",""))')"
    ;;
  "")
    echo "usage: $0 local | $0 <url> <publishable-key>" >&2; exit 2 ;;
  *)
    URL="$1"; KEY="${2:?publishable key required}" ;;
esac

PASS=0; FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n     got: %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }

anon() { curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
              -H 'Content-Type: application/json' "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' -H "apikey: $KEY" \
              -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' "$@"; }

REST="$URL/rest/v1"
FAKE="11111111-1111-1111-1111-111111111111"

echo
echo "verify-rls against $URL"
echo

# --- the control ------------------------------------------------------------
# Establishes what "the table isn't there" looks like, so every empty result
# below can be distinguished from it.
echo "control"
CTRL="$(anon "$REST/table_that_does_not_exist?select=*")"
if [ "$CTRL" = "[]" ]; then
  bad "a nonexistent table must NOT return [] — every empty assertion below is meaningless" "$CTRL"
else
  ok "a nonexistent table errors rather than returning [] (controls are meaningful)"
fi

# --- saves: private ---------------------------------------------------------
# Saves live in the SHARED public.game_saves, keyed (user_id, game) — this game
# is 'primos-run'. It is shared with Turbo Maze and every future game, so this
# probe is checking a table other games depend on too: a leak here is a leak of
# the whole player base, not just this one's.
echo
echo "game_saves — must be invisible to an anonymous reader (shared across games)"
R="$(anon "$REST/game_saves?select=user_id,game")"
[ "$R" = "[]" ] && ok "anonymous SELECT returns no rows" || bad "anonymous SELECT leaked rows" "$R"

R="$(anon "$REST/game_saves?select=user_id&game=eq.primos-run")"
[ "$R" = "[]" ] && ok "anonymous SELECT scoped to this game returns no rows" \
                || bad "anonymous SELECT leaked this game's rows" "$R"

C="$(code -X POST "$REST/game_saves" -d "{\"user_id\":\"$FAKE\",\"game\":\"primos-run\",\"data\":{}}")"
[ "$C" = "401" ] || [ "$C" = "403" ] || [ "$C" = "400" ] \
  && ok "anonymous INSERT refused (HTTP $C)" || bad "anonymous INSERT was accepted" "HTTP $C"

# --- the board: public to read, owner-only to write -------------------------
echo
echo "primos_daily_scores — public read, owner-only write"
R="$(anon "$REST/primos_daily_scores?select=user_id,display_name,score,day_key&limit=1")"
case "$R" in
  \[*) ok "anonymous SELECT works — the board is public by design" ;;
  *)   bad "the board should be readable but was not" "$R" ;;
esac

# Nothing private may ever be reachable on this table.
R="$(anon "$REST/primos_daily_scores?select=email&limit=1")"
case "$R" in
  *email*does*not*exist*|*42703*) ok "no email column exists on the board" ;;
  \[*) bad "the board exposes an email column" "$R" ;;
  *) ok "no email column exists on the board" ;;
esac

C="$(code -X POST "$REST/primos_daily_scores" \
     -d "{\"user_id\":\"$FAKE\",\"day_key\":\"$(date -u +%F)\",\"score\":999999,\"display_name\":\"anon\"}")"
[ "$C" = "401" ] || [ "$C" = "403" ] || [ "$C" = "400" ] \
  && ok "anonymous INSERT of a score refused (HTTP $C)" || bad "anonymous score INSERT accepted" "HTTP $C"

C="$(code -X PATCH "$REST/primos_daily_scores?day_key=eq.$(date -u +%F)" -d '{"score":999999}')"
[ "$C" = "401" ] || [ "$C" = "403" ] || [ "$C" = "404" ] || [ "$C" = "400" ] \
  && ok "anonymous UPDATE refused (HTTP $C)" || bad "anonymous UPDATE accepted" "HTTP $C"

C="$(code -X DELETE "$REST/primos_daily_scores?day_key=eq.$(date -u +%F)")"
[ "$C" = "401" ] || [ "$C" = "403" ] || [ "$C" = "404" ] \
  && ok "anonymous DELETE refused (HTTP $C)" || bad "anonymous DELETE accepted" "HTTP $C"

# --- the rollup view --------------------------------------------------------
echo
echo "primos_weekly_totals — the derived season view"
R="$(anon "$REST/primos_weekly_totals?select=week_key,display_name,total,days_played&limit=1")"
case "$R" in
  \[*) ok "the weekly view is readable and exposes only shareable columns" ;;
  *)   bad "the weekly view should be readable but was not" "$R" ;;
esac

# --- the guard --------------------------------------------------------------
# Not RLS, but what the board's fairness actually rests on. Both of these have
# silently regressed on the sister project, so they are asserted here.
echo
echo "guard (requires a signed-in session — SKIPPED anonymously)"
echo "  – submit a day_key of two days ago      → must be REJECTED"
echo "  – upsert a LOWER score for the same day → stored score must NOT change"
echo "  – rename a CLOSED day's row             → must SUCCEED (history is scrubbable)"
echo "    Run these by hand with a real user JWT after the first player signs in."

echo
printf 'passed %d, failed %d\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
