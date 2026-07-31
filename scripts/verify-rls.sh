#!/usr/bin/env bash
# ============================================================================
# verify-rls.sh — prove the exposure rules of 0001_primos_cloud.sql and
# 0002_primos_referrals.sql against a LIVE API.
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

# --- the email oracle -------------------------------------------------------
# primos_public_name(uid, submitted) answers "is this string that account's email
# local-part?" — the submitted name back for no, 'Player XXXX' for YES. It is
# SECURITY DEFINER so it can read auth.users.
#
# It shipped in 0001 WITHOUT a revoke, so Supabase's default left it executable
# by PUBLIC — i.e. by anyone holding the publishable key, which is in the client.
# The board is world-readable and every row carries a user_id, so that was a
# dictionary attack on every player's real email local-part, one cheap REST call
# per guess. Closed by 20260731173000. Measured: HTTP 200 before, 401 after.
#
# Paired with a control, because a function that does not exist is ALSO refused.
echo
echo "primos_public_name — must NOT be an email oracle"
C="$(code -X POST "$REST/rpc/primos_public_name" -d "{\"uid\":\"$FAKE\",\"submitted\":\"guess\"}")"
CTRLFN="$(code -X POST "$REST/rpc/primos_function_that_does_not_exist" -d '{}')"
if [ "$C" = "$CTRLFN" ]; then
  meh "anonymous EXECUTE refused (HTTP $C) — INCONCLUSIVE" \
      "a nonexistent function answers HTTP $CTRLFN too — has 0001 been applied at all?"
elif [ "$C" = "401" ] || [ "$C" = "403" ]; then
  ok "anonymous EXECUTE denied (HTTP $C, vs HTTP $CTRLFN for a missing function)"
else
  bad "the email oracle is OPEN — anyone can test a name against any player's account" "HTTP $C"
fi

# The anonymous name is deliberately still public: it is derived from a user id
# that is already printed on every board row. If this ever starts failing,
# somebody over-tightened the revoke above.
R="$(anon -X POST "$REST/rpc/primos_anon_display_name" -d '{"uid":"7f3a91b2-0000-4000-8000-000000000000"}')"
[ "$R" = '"Player 7F3A"' ] \
  && ok "primos_anon_display_name is public and byte-identical to the client's anonName()" \
  || bad "the anonymous name drifted or was over-revoked — players would see two different names" "$R"

# --- the rollup view --------------------------------------------------------
echo
echo "primos_weekly_totals — the derived season view"
R="$(anon "$REST/primos_weekly_totals?select=week_key,display_name,total,days_played&limit=1")"
case "$R" in
  \[*) ok "the weekly view is readable and exposes only shareable columns" ;;
  *)   bad "the weekly view should be readable but was not" "$R" ;;
esac

# --- invites: both tables private, the lookup function the only door ---------
# THE ASSERTION THAT MATTERS: Viva Maya shipped `referral_codes` with
# `for select using (true)`, so anyone holding the publishable key could dump
# every invite code alongside its owner's auth UUID. It took two migrations
# sequenced around a client deploy to close. 0002 never opens it — these probes
# are what proves that stayed true.
echo
echo "primos_referral_codes — must NOT be enumerable (Viva Maya's scar)"
R="$(anon "$REST/primos_referral_codes?select=code,user_id")"
[ "$R" = "[]" ] && ok "anonymous SELECT returns no codes" \
                || bad "invite codes are ENUMERABLE — this is the hole 0002 exists to avoid" "$R"

C="$(code -X POST "$REST/primos_referral_codes" -d "{\"code\":\"ZZZZZZ\",\"user_id\":\"$FAKE\"}")"
{ [ "$C" = "401" ] || [ "$C" = "403" ] || [ "$C" = "400" ]; } \
  && ok "anonymous INSERT refused (HTTP $C)" || bad "anonymous INSERT was accepted" "HTTP $C"

echo
echo "primos_referrals — who invited whom is private to the two parties"
R="$(anon "$REST/primos_referrals?select=referee_user_id,referrer_user_id")"
[ "$R" = "[]" ] && ok "anonymous SELECT returns no rows" \
                || bad "the referral graph leaked" "$R"

C="$(code -X POST "$REST/primos_referrals" \
       -d "{\"referee_user_id\":\"$FAKE\",\"referrer_user_id\":\"$FAKE\"}")"
{ [ "$C" = "401" ] || [ "$C" = "403" ] || [ "$C" = "400" ]; } \
  && ok "anonymous INSERT refused (HTTP $C)" || bad "anonymous INSERT was accepted" "HTTP $C"

# The lookup function, with a CONTROL PAIR. EXECUTE is granted to `authenticated`
# only, so anonymous must be denied — but a function that does not exist is ALSO
# refused, with a different code. Probing one alone cannot tell "permission
# denied on a real function" from "you never applied the migration", and the
# second reads as a pass if you only check that anon was refused.
echo
echo "primos_resolve_referral_code — the only way to resolve someone else's code"
C="$(code -X POST "$REST/rpc/primos_resolve_referral_code" -d '{"p_code":"ABC123"}')"
CTRLFN="$(code -X POST "$REST/rpc/primos_function_that_does_not_exist" -d '{}')"
if [ "$C" = "$CTRLFN" ]; then
  meh "anonymous RPC refused (HTTP $C) — INCONCLUSIVE" \
      "a nonexistent function answers HTTP $CTRLFN too, so this cannot tell a real permission denial from a missing function — has 0002 been applied?"
elif [ "$C" = "401" ] || [ "$C" = "403" ]; then
  ok "anonymous EXECUTE denied (HTTP $C, vs HTTP $CTRLFN for a function that isn't there)"
else
  bad "anonymous callers can resolve invite codes" "HTTP $C"
fi

# --- analytics: append-only, and readable by nobody --------------------------
# The event log is the most sensitive thing in this project — a per-device
# behavioural history, which is worse to leak than a board or an invite code.
# 0003 grants INSERT and NO SELECT AT ALL, and these probes are what proves it
# stayed that way. The write probe is not a formality either: analytics that
# cannot be written by an anonymous visitor is analytics that is simply dead,
# and that failure is invisible from the client, which swallows everything.
echo
echo "primos_events — append-only to the world"
# `[]` IS THE SECURE ANSWER HERE, and this assertion is the right way round only
# because of the control probe at the top of this script.
#
# anon holds the ordinary Supabase SELECT *grant*, so PostgREST does not refuse
# the request — RLS simply filters every row away and the result is an empty
# array. That is indistinguishable from "the table isn't there" on its own,
# which is precisely why the control exists: a nonexistent table ERRORS, so an
# empty array from a table that does exist means RLS did its job.
#
# An earlier version of this probe asserted the opposite and passed only while
# the table was ABSENT (a 404 is not `[]`), then failed the moment the migration
# was applied — green for the wrong reason, then red for the wrong reason.
R="$(anon "$REST/primos_events?select=device_id,name,props")"
[ "$R" = "[]" ] && ok "anonymous SELECT returns no rows (and the control proves that means RLS, not absence)" \
                || bad "the event log answered something other than an empty set" "$R"

EV="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z')"
: "${EV:=22222222-2222-4222-8222-222222222222}"

# THE PIPE ITSELF. A plain insert — the exact shape js/analytics.js sends.
C="$(code -X POST "$REST/primos_events" -H 'Prefer: return=minimal' \
     -d "[{\"device_id\":\"$FAKE\",\"session_id\":\"$FAKE\",\"name\":\"verify_probe\",\"props\":{},\"app_version\":\"verify\",\"event_id\":\"$EV\"}]")"
{ [ "$C" = "201" ] || [ "$C" = "204" ]; } \
  && ok "anonymous INSERT accepted (HTTP $C) — the pipe is alive" \
  || bad "anonymous INSERT refused — analytics is DEAD, and the client cannot tell you" "HTTP $C"

# Sent again, same event_id. Must be ACCEPTED (the guard trigger returns null
# rather than raising) and must not create a second row. The row count is
# unreadable from here by design, so the effect is reported inconclusive with
# the exact query to settle it.
C="$(code -X POST "$REST/primos_events" -H 'Prefer: return=minimal' \
     -d "[{\"device_id\":\"$FAKE\",\"session_id\":\"$FAKE\",\"name\":\"verify_probe\",\"props\":{},\"app_version\":\"verify\",\"event_id\":\"$EV\"}]")"
if [ "$C" = "201" ] || [ "$C" = "204" ]; then
  meh "duplicate event_id accepted (HTTP $C) — INCONCLUSIVE" \
      "accepted is only half of it; the dedupe is real only if the row count did not move, and this table refuses reads by design. Settle it with: select count(*) from public.primos_events where event_id = '$EV'; — it must be 1"
else
  bad "a re-sent event was rejected — the guard must DROP duplicates, not raise" "HTTP $C"
fi

# ⚠ THE INVERTED ASSERTION, and the one that cost a live bug.
#
# `?on_conflict=event_id` + `resolution=ignore-duplicates` is the idempotent
# wire shape every guide reaches for, and js/analytics.js shipped it in its
# first draft. It CANNOT work here: ON CONFLICT makes Postgres require SELECT
# rights on the target, so the rewriter folds the table's SELECT policies in as
# an extra WITH CHECK on the new row — there are none, so the check is a
# constant false and every batch is refused 42501 → 401. The client dropped any
# 4xx that was not 400, so every event was being silently discarded.
#
# So this probe asserts the shape is REFUSED. If it ever starts succeeding,
# somebody has added a SELECT policy to the event log — which is the one change
# that must never happen — and this line is where that shows up.
#
# ⚠ IT MUST USE A FRESH event_id, and that is not a detail. `ON CONFLICT DO
# NOTHING` that actually CONFLICTS inserts no row, so the folded-in check never
# evaluates and the request succeeds — the broken shape looks fine on a retry
# and fails only on genuinely new events, i.e. on all real traffic. Reusing $EV
# here made this probe report a false pass on 2026-07-31.
EV2="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z')"
: "${EV2:=44444444-4444-4444-8444-444444444444}"
C="$(code -X POST "$REST/primos_events?on_conflict=event_id" \
     -H 'Prefer: return=minimal,resolution=ignore-duplicates' \
     -d "[{\"device_id\":\"$FAKE\",\"session_id\":\"$FAKE\",\"name\":\"verify_probe\",\"event_id\":\"$EV2\"}]")"
{ [ "$C" = "401" ] || [ "$C" = "403" ]; } \
  && ok "the ON CONFLICT wire shape is refused (HTTP $C) — no SELECT policy exists, as designed" \
  || bad "ON CONFLICT succeeded, which means the event log now HAS a select policy" "HTTP $C"

# Attributing an event to somebody else's account. The policy admits a null
# user_id or auth.uid(); anonymously there is no auth.uid(), so a non-null one
# must be refused.
C="$(code -X POST "$REST/primos_events" \
     -d "[{\"device_id\":\"$FAKE\",\"session_id\":\"$FAKE\",\"name\":\"forged\",\"user_id\":\"$FAKE\"}]")"
{ [ "$C" = "401" ] || [ "$C" = "403" ] || [ "$C" = "400" ]; } \
  && ok "anonymous INSERT with a forged user_id refused (HTTP $C)" \
  || bad "events can be attributed to another account" "HTTP $C"

echo
echo "primos_app_admins — the whole authorization model for reads"
R="$(anon "$REST/primos_app_admins?select=user_id")"
[ "$R" = "[]" ] && bad "the admin list is readable — it must have RLS on and ZERO policies" "$R" \
                || ok "anonymous SELECT is refused"

echo
echo "the read path — admin-gated, with a control pair"
C="$(code -X POST "$REST/rpc/primos_admin_analytics" -d '{"p_days":7}')"
CTRLFN="$(code -X POST "$REST/rpc/primos_function_that_does_not_exist" -d '{}')"
if [ "$C" = "$CTRLFN" ]; then
  meh "anonymous RPC refused (HTTP $C) — INCONCLUSIVE" \
      "a nonexistent function answers HTTP $CTRLFN too, so this cannot tell a real permission denial from a missing function — has 0003 been applied?"
elif [ "$C" = "401" ] || [ "$C" = "403" ]; then
  ok "anonymous EXECUTE of primos_admin_analytics denied (HTTP $C, vs HTTP $CTRLFN for a missing function)"
else
  bad "anonymous callers can read the analytics aggregates" "HTTP $C"
fi

C="$(code -X POST "$REST/rpc/primos_prune_events" -d '{"keep_days":1}')"
if [ "$C" = "$CTRLFN" ]; then
  meh "anonymous prune refused (HTTP $C) — INCONCLUSIVE" \
      "indistinguishable from the function being absent — has 0003 been applied?"
elif [ "$C" = "401" ] || [ "$C" = "403" ]; then
  ok "anonymous EXECUTE of primos_prune_events denied (HTTP $C)"
else
  bad "anonymous callers can DELETE the event log" "HTTP $C"
fi

# --- the suggestion box -----------------------------------------------------
# 20260731190000_primos_feedback.sql. Same exposure rules as the event log and
# one more reason to hold them: this is the only table in the project where a
# player can put a SENTENCE ABOUT THEMSELVES, and some of them will put an email
# address in it. A readable feedback table is a worse day than a readable board.
echo
echo "primos_feedback — append-only to the world"
R="$(anon "$REST/primos_feedback?select=message,contact,device_id")"
[ "$R" = "[]" ] && ok "anonymous SELECT returns no rows (the control at the top proves that means RLS, not absence)" \
                || bad "the suggestion box answered something other than an empty set" "$R"

FB="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z')"
: "${FB:=33333333-3333-4333-8333-333333333333}"

# THE BOX ITSELF. The exact shape js/feedback.js sends. A refusal here means
# every player who writes in is told "it did not go through" — and unlike
# analytics, they will notice, because they are watching a status line.
C="$(code -X POST "$REST/primos_feedback" -H 'Prefer: return=minimal' \
     -d "{\"device_id\":\"$FAKE\",\"kind\":\"other\",\"message\":\"verify-rls probe, safe to delete\",\"context\":{},\"app_version\":\"verify\",\"lang\":\"en\",\"feedback_id\":\"$FB\"}")"
{ [ "$C" = "201" ] || [ "$C" = "204" ]; } \
  && ok "anonymous INSERT accepted (HTTP $C) — the box is alive" \
  || bad "anonymous INSERT refused — nobody can report anything, and the send button says so" "HTTP $C"

# Same feedback_id again: the guard must DROP it and answer success, so a player
# who taps SEND twice on a stalled connection gets one row and one "sent".
C="$(code -X POST "$REST/primos_feedback" -H 'Prefer: return=minimal' \
     -d "{\"device_id\":\"$FAKE\",\"kind\":\"other\",\"message\":\"verify-rls probe, safe to delete\",\"feedback_id\":\"$FB\"}")"
if [ "$C" = "201" ] || [ "$C" = "204" ]; then
  meh "duplicate feedback_id accepted (HTTP $C) — INCONCLUSIVE" \
      "accepted is only half of it; the dedupe is real only if the row count did not move, and this table refuses reads by design. Settle it with: select count(*) from public.primos_feedback where feedback_id = '$FB'; — it must be 1"
else
  bad "a re-sent report was rejected — the guard must DROP duplicates, not raise" "HTTP $C"
fi

# An empty message. The guard raises PT400 rather than storing a mis-tap, and
# js/feedback.js refuses it before this point — this proves the backstop.
C="$(code -X POST "$REST/primos_feedback" -H 'Prefer: return=minimal' \
     -d "{\"device_id\":\"$FAKE\",\"kind\":\"bug\",\"message\":\"  \"}")"
[ "$C" = "400" ] \
  && ok "an empty message is refused by the guard (HTTP $C)" \
  || bad "the guard stored an empty report — the box will fill with mis-taps" "HTTP $C"

# THE RATE LIMIT, and it is the one probe here that is worth the noise it makes.
# An open POST endpoint that takes free text is a spam magnet, and the client's
# own limit is a courtesy that anyone can skip by not being the client. Six
# distinct reports from one device inside an hour: the sixth must be refused.
#
# ⚠ This deliberately WRITES five probe rows. They land in the box marked 'new',
# so clear them after a production run:
#   delete from public.primos_feedback where app_version = 'verify';
LIMITED=""
for i in 1 2 3 4 5 6; do
  RID="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z')"
  : "${RID:=5555555$i-5555-4555-8555-555555555555}"
  C="$(code -X POST "$REST/primos_feedback" -H 'Prefer: return=minimal' \
       -d "{\"device_id\":\"$FAKE\",\"kind\":\"other\",\"message\":\"verify-rls rate probe $i, safe to delete\",\"app_version\":\"verify\",\"feedback_id\":\"$RID\"}")"
  [ "$C" = "429" ] && { LIMITED="$i"; break; }
done
if [ -n "$LIMITED" ]; then
  ok "the guard rate-limits one device (refused at attempt $LIMITED with HTTP 429)"
else
  bad "six reports from one device in an hour were all accepted — the box is unbounded" "no 429"
fi

echo
echo "primos_feedback — the read path is admin-only"
C="$(code -X POST "$REST/rpc/primos_admin_feedback" -d '{"p_days":7}')"
CTRLFN2="$(code -X POST "$REST/rpc/primos_function_that_does_not_exist" -d '{}')"
if [ "$C" = "$CTRLFN2" ]; then
  meh "anonymous RPC refused (HTTP $C) — INCONCLUSIVE" \
      "a nonexistent function answers HTTP $CTRLFN2 too — has 20260731190000_primos_feedback.sql been applied?"
elif [ "$C" = "401" ] || [ "$C" = "403" ]; then
  ok "anonymous EXECUTE of primos_admin_feedback denied (HTTP $C, vs HTTP $CTRLFN2 for a missing function)"
else
  bad "anonymous callers can READ every message players have written" "HTTP $C"
fi

# Marking somebody else's report as spam is a write, and it is the one that
# would let a player bury their own abuse report.
C="$(code -X POST "$REST/rpc/primos_admin_feedback_status" -d '{"p_id":1,"p_status":"spam"}')"
if [ "$C" = "$CTRLFN2" ]; then
  meh "anonymous triage refused (HTTP $C) — INCONCLUSIVE" \
      "indistinguishable from the function being absent — has the feedback migration been applied?"
elif [ "$C" = "401" ] || [ "$C" = "403" ]; then
  ok "anonymous EXECUTE of primos_admin_feedback_status denied (HTTP $C)"
else
  bad "anonymous callers can re-file or bury reports" "HTTP $C"
fi

# --- cross-game collision ----------------------------------------------------
# Viva Maya lives in this same project and owns UNPREFIXED events / app_admins /
# admin_analytics / prune_events. If 0003 had shipped unprefixed it would have
# adopted its table and REPLACED its hardened guard and RPC, silently. This
# probe cannot see into the database, but it can prove the prefixed objects are
# the ones actually answering — the two above already did that.
echo
echo "note: Viva Maya owns the UNPREFIXED public.events in this same project."
echo "      Every object 0003 creates is primos_-prefixed for that reason. If a"
echo "      future migration drops the prefix, it will not fail — it will"
echo "      silently take over that game's analytics. Check the prefix by eye."

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
