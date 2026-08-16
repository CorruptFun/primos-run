-- ============================================================================
-- 20260816210001_primos_gate_enforce_boards.sql
-- The half of the NFT gate that actually refuses somebody.
--
-- Companion to 20260816210000_primos_nft_gate.sql, which created the tables and
-- the primos_is_holder() helper and changed no policy. This one tightens the
-- board's write policies so a score can only be submitted by a signed-in user
-- with a fresh, server-verified Primo holding behind them.
--
-- ⚠ DO NOT APPLY THIS WITH THE FILE ABOVE. Apply it only once the gated client
-- has been live long enough that holders have actually verified.
--
-- This is a RESTRICTING change, which inverts the project's usual "schema
-- first, client second" rule. The PWA is prompt-mode: players keep running a
-- cached bundle for days after a deploy. Tighten the policy before their client
-- knows how to prove anything and every one of them gets a silent write refusal
-- on a run they legitimately earned — a working game that looks broken, with
-- nothing on screen to explain it.
--
-- That is not a hypothesis. It is the sequence Viva Maya paid for with 0008 →
-- client deploy → 0009 (see the invites section of CLAUDE.md), and the lesson
-- transfers exactly: a legitimate action made to look dead by a policy the
-- client cannot yet satisfy.
--
-- The order is therefore:
--   1. apply 20260816210000 (additive, safe under the old client)
--   2. deploy the Edge Function and the gated client
--   3. give holders time to open the game and verify
--   4. apply THIS file
--
-- Reversible: the tail of this file has the exact statements to put the old
-- policies back, because step 4 is the one that can lock real players out.
--
-- Idempotent-friendly: safe to re-run.
-- ============================================================================


-- ==========================================
-- THE BOARD IS FOR HOLDERS
--
-- Rewritten rather than added to: a policy per command is OR-ed with the others
-- for that command, so leaving the old permissive pair in place beside a new
-- strict one would grant exactly what it was meant to refuse. Drop, then state
-- the whole condition once.
--
-- `auth.uid() = user_id` is kept as the first conjunct, unchanged — it is what
-- stops one player writing another's row and it has nothing to do with the
-- gate. The holder test is added to it, not substituted for it.
-- ==========================================
drop policy if exists "Users can insert own daily score" on public.primos_daily_scores;
create policy "Holders can insert own daily score"
    on public.primos_daily_scores for insert
    with check (
        auth.uid() = user_id
        and public.primos_is_holder(auth.uid())
    );

drop policy if exists "Users can update own daily score" on public.primos_daily_scores;
create policy "Holders can update own daily score"
    on public.primos_daily_scores for update
    using (
        auth.uid() = user_id
        and public.primos_is_holder(auth.uid())
    )
    with check (
        auth.uid() = user_id
        and public.primos_is_holder(auth.uid())
    );

-- ⚠ THE READ POLICY IS DELIBERATELY UNTOUCHED. "Anyone can read the daily
-- board" stays open to everyone, holder or not.
--
-- A leaderboard nobody outside the club can see is a leaderboard that cannot
-- advertise the club. The board is the shop window for the collection: someone
-- who does not hold a Primo should be able to see exactly what they are missing
-- and whose name is at the top of it. Gating the write is the whole point;
-- gating the read costs the gate its only marketing surface and protects
-- nothing — every row on it is already public by design.


-- ==========================================
-- SELF-CHECK. The failure this file can cause is locking out the entire player
-- base, so refuse to apply unless the machinery it depends on is actually here.
-- ==========================================
do $$
begin
    if to_regprocedure('public.primos_is_holder(uuid, integer)') is null then
        raise exception
            'primos_is_holder() is missing — apply 20260816210000_primos_nft_gate.sql '
            'first, or every board write will fail with an undefined function.';
    end if;

    if to_regclass('public.primos_holders') is null then
        raise exception 'primos_holders is missing — apply 20260816210000 first.';
    end if;

    -- A holder table with nobody in it means step 3 above was skipped, and
    -- applying this now refuses every player on the project including the
    -- owner. Warn rather than raise: a brand-new project legitimately has none,
    -- and only the operator knows which of the two they are looking at.
    if (select count(*) from public.primos_holders where primo_count > 0) = 0 then
        raise warning
            'primos_holders holds no verified holders. If the gated client has '
            'already been live, this is correct for a new project — but if it has '
            'not, you have just closed the board to everyone. See the rollback below.';
    end if;
end $$;


-- ==========================================
-- ROLLBACK — the exact statements, because this is the file most likely to need
-- them and reverting the FILE does nothing to a database. Paste and run:
--
--   drop policy if exists "Holders can insert own daily score"
--       on public.primos_daily_scores;
--   create policy "Users can insert own daily score"
--       on public.primos_daily_scores for insert with check (auth.uid() = user_id);
--
--   drop policy if exists "Holders can update own daily score"
--       on public.primos_daily_scores;
--   create policy "Users can update own daily score"
--       on public.primos_daily_scores for update
--       using (auth.uid() = user_id) with check (auth.uid() = user_id);
--
-- Those two restore 0001_primos_cloud.sql's originals byte for byte.
-- ==========================================
