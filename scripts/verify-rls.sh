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

PASS=0; FAIL=0; INCONCLUSIVE=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n     got: %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
# Neither a pass nor a failure. A test that CANNOT distinguish safe from unsafe
# must say so — reporting it green is the false assurance this whole script
# exists to avoid, and reporting it red sends you hunting a bug that isn't there.
meh()  { printf '  \033[33m?\033[0m %s\n     %s\n' "$1" "$2"; INCONCLUSIVE=$((INCONCLUSIVE+1)); }

anon() { curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
              -H 'Content-Type: application/json' "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' -H "apikey: $KEY" \
              -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' "$@"; }
# The rows a write ACTUALLY touched. This is the only trustworthy signal for a
# PATCH/DELETE: PostgREST answers 204 No Content whether it changed a thousand
# rows or none, so RLS filtering an anonymous caller down to zero is byte-for-
# byte indistinguishable from a successful mass delete if you read the status.
touched() { curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
                 -H 'Content-Type: application/json' \
                 -H 'Prefer: return=representation' "$@"; }
# How many rows the table has, via the Content-Range header ("*/0" when empty).
rowcount() { curl -s -D- -o /dev/null -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
                  -H 'Prefer: count=exact' -H 'Range: 0-0' "$1" \
             | tr -d '\r' | sed -n 's|^[Cc]ontent-[Rr]ange: .*/||p'; }

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

# UPDATE / DELETE — judged on ROWS TOUCHED, never on the status code.
#
# PostgREST returns 204 No Content for a write that matched nothing, exactly as
# it does for one that matched everything. Asserting on the status therefore
# reports "anonymous DELETE accepted" against a perfectly locked table, which is
# how this script cried wolf on 2026-07-31.
#
# And there is a second trap underneath: against an EMPTY table both probes
# touch nothing no matter what the policies say, so a pass there means nothing
# at all. That case is reported as inconclusive rather than green.
BOARD_ROWS="$(rowcount "$REST/primos_daily_scores?select=user_id")"
: "${BOARD_ROWS:=0}"

R="$(touched -X PATCH "$REST/primos_daily_scores?day_key=eq.$(date -u +%F)" -d '{"score":999999}')"
if [ "$BOARD_ROWS" = "0" ]; then
  meh "anonymous UPDATE — INCONCLUSIVE" "the board is empty, so nothing could be touched either way; re-run once a real player has submitted a score"
elif [ "$R" = "[]" ]; then
  ok "anonymous UPDATE touched no rows"
else
  bad "anonymous UPDATE modified rows" "$R"
fi

R="$(touched -X DELETE "$REST/primos_daily_scores?day_key=eq.$(date -u +%F)")"
if [ "$BOARD_ROWS" = "0" ]; then
  meh "anonymous DELETE — INCONCLUSIVE" "the board is empty; note there is deliberately NO delete policy on this table, so RLS denies it to everyone — but that is unproven until a row exists"
elif [ "$R" = "[]" ]; then
  ok "anonymous DELETE removed no rows"
  AFTER="$(rowcount "$REST/primos_daily_scores?select=user_id")"
  [ "$AFTER" = "$BOARD_ROWS" ] \
    && ok "row count unchanged after the delete attempt ($AFTER)" \
    || bad "rows disappeared during the delete probe" "$BOARD_ROWS -> $AFTER"
else
  bad "anonymous DELETE removed rows" "$R"
fi

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
if [ "$INCONCLUSIVE" -gt 0 ]; then
  printf 'passed %d, failed %d, INCONCLUSIVE %d\n' "$PASS" "$FAIL" "$INCONCLUSIVE"
  printf 'An inconclusive check is not a pass. Re-run once the board has real rows.\n\n'
else
  printf 'passed %d, failed %d\n\n' "$PASS" "$FAIL"
fi
[ "$FAIL" -eq 0 ] || exit 1
