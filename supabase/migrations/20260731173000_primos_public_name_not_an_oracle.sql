-- ============================================================================
-- 20260731173000_primos_public_name_not_an_oracle.sql
--
-- Close an EMAIL ORACLE on public.primos_public_name(uuid, text).
--
-- ============================================================================
-- WHAT WAS WRONG
--
-- 0001 created primos_public_name as SECURITY DEFINER so it could reach
-- auth.users, and then never revoked EXECUTE. Under Supabase's defaults a new
-- function is executable by PUBLIC, so `anon` and `authenticated` both held it —
-- and the publishable key that grants `anon` ships inside the game.
--
-- The function answers: "is this string that account's email local-part?"
--   · returns the submitted name  → no
--   · returns 'Player XXXX'       → YES
--
-- primos_daily_scores is world-readable BY DESIGN (it is a leaderboard) and
-- every row carries a user_id. So anyone could take the user ids off the board
-- and dictionary-attack the local-part of each player's Google address, one
-- cheap REST call per guess, with no account and no rate limit beyond the API's.
--
-- That inverts the whole point of the privacy work in 0001: the guard exists so
-- an email name can never REACH the board, and the function built to enforce it
-- was itself the leak. Measured live on 2026-07-31 with the shipped publishable
-- key — HTTP 200 and a value returned — against Viva Maya's equivalent, which
-- correctly answered `42501 permission denied for function public_display_name`.
-- Same project, same shape, one revoke apart.
--
-- Viva Maya's 0017 got this right and its comment says why. Primos ported the
-- function and not the revoke.
--
-- ============================================================================
-- WHY REVOKING IS SAFE
--
-- The only legitimate caller is public.primos_daily_guard(), which is itself
-- SECURITY DEFINER and owned by `postgres`. It therefore executes as postgres,
-- which keeps EXECUTE, so score submission and the rename path are unaffected.
-- No client has ever called this function directly, and none should: it is an
-- enforcement primitive, not an API.
--
-- Idempotent-friendly: safe to re-run.
-- ============================================================================

revoke all on function public.primos_public_name(uuid, text) from public;
revoke all on function public.primos_public_name(uuid, text) from anon;
revoke all on function public.primos_public_name(uuid, text) from authenticated;

-- service_role only, matching Viva Maya's public_display_name, so a server-side
-- ops job can still reason about the same rule.
grant execute on function public.primos_public_name(uuid, text) to service_role;

-- primos_anon_display_name is deliberately LEFT public. It derives a name from a
-- user id and nothing else, and that user id is already printed on every board
-- row — it discloses nothing that reading the board did not. Viva Maya's
-- anon_display_name is public for the same reason. Do not "tidy" this one too:
-- the client and the server must agree on that string, and the parity check in
-- 0001 is what proves they do.

-- ==========================================
-- SELF-CHECK. Refuse to leave this file in a state where the oracle is still
-- reachable — the whole point of the migration is one ACL, so assert it.
-- ==========================================
do $$
begin
    if has_function_privilege('anon', 'public.primos_public_name(uuid, text)', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.primos_public_name(uuid, text)', 'EXECUTE') then
        raise exception
            'primos_public_name is still executable by anon/authenticated — it is a '
            'SECURITY DEFINER function over auth.users, and the board publishes the '
            'user ids to test against. That is an email oracle.';
    end if;

    if not has_function_privilege('anon', 'public.primos_anon_display_name(uuid)', 'EXECUTE') then
        raise exception
            'primos_anon_display_name lost its public EXECUTE — it is derived from a '
            'user id that is already on every board row, and revoking it breaks nothing '
            'but confuses the next reader into thinking it was sensitive.';
    end if;
end $$;
