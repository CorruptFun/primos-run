-- ============================================================================
-- cloud-saves-and-leaderboards — reference schema
--
-- A portable distillation of a shipped Supabase schema (Viva Maya migrations
-- 0001 / 0007 / 0012 / 0017). Copy into your project's migration directory,
-- rename the marked identifiers, delete the boards you don't need, and KEEP
-- every guard trigger — each one is load-bearing and the header above it says
-- what breaks without it.
--
-- 👉 CUSTOMIZE markers show what changes per project. Everything else should
--    be copied verbatim; the details that look fussy are the scars.
--
-- Written idempotent (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS) so it is
-- safe to re-run — which matters more than usual on a project where migrations
-- are applied by hand.
--
-- TRUST MODEL, stated plainly: scores are self-reported by an untrusted client.
-- Nothing here pretends otherwise. What it DOES guarantee is that RLS stops
-- anyone writing anyone else's row, and the guards stop the cheap structural
-- attacks — wrong board, lowered score, forged timestamp, leaked email. Making
-- the SCORE itself unforgeable needs server-side deterministic replay (submit
-- the input log, replay the seeded run) and is a separate, much larger project.
-- Note that a daily board makes that easier to defer: a forged score buys one
-- day, not one season.
-- ============================================================================


-- ============================================================================
-- LAYER 2 — THE SAVE. One row per user, the whole save blob as jsonb.
--
-- jsonb, not columns, on purpose: the save's shape changes every time the game
-- grows, and a schema migration per gameplay feature is a tax you will stop
-- paying after the third one. The client already has to tolerate old shapes
-- (people return after months), so it owns coercion either way.
-- ============================================================================

create table if not exists public.saves (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    data       jsonb not null,
    updated_at timestamptz not null default now()
);

-- Deny-by-default. With RLS on and no permissive policy matched, access is
-- refused — the policies below re-grant to each row's OWNER only. This is
-- exactly why the publishable anon key is safe to ship in the client: the key
-- grants only what RLS allows for the currently signed-in user.
alter table public.saves enable row level security;

drop policy if exists "Users can view own save" on public.saves;
create policy "Users can view own save"
    on public.saves for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own save" on public.saves;
create policy "Users can insert own save"
    on public.saves for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own save" on public.saves;
create policy "Users can update own save"
    on public.saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own save" on public.saves;
create policy "Users can delete own save"
    on public.saves for delete using (auth.uid() = user_id);

-- updated_at must be SERVER time regardless of what the client sends. The
-- column default covers INSERT; this covers overwrite. search_path is pinned to
-- '' as hardening (now() is in pg_catalog, always resolvable).
create or replace function public.set_saves_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_saves_updated_at on public.saves;
create trigger trg_saves_updated_at
    before update on public.saves
    for each row execute function public.set_saves_updated_at();


-- ============================================================================
-- LAYER 4 — THE PUBLIC NAME. Never the account's email.
--
-- Two functions, both used by every board guard below.
--
-- anon_display_name() MUST STAY BYTE-IDENTICAL to the client's copy. The server
-- substitutes it when a submission would publish an email name — including from
-- an old cached client — so if the two formulas drift the player sees one name
-- in the app and the board shows another. The self-check at the bottom of this
-- file refuses to apply on drift; mirror it with a client unit test.
-- ============================================================================

create or replace function public.anon_display_name(uid uuid)
returns text language sql immutable as $$
    -- 👉 CUSTOMIZE the prefix if you like, then change the client to match.
    select 'Player ' || upper(substr(replace(uid::text, '-', ''), 1, 4));
$$;

-- Compare a submitted name against THAT account's own email local-part and
-- substitute the anonymous name on a match. Exact, not a heuristic: it reads
-- auth.users for the one submitting user, so it needs no guess about what
-- "looks like" an email name and touches no other account.
--
-- Deliberate trade-off: a player who genuinely chose their own email local-part
-- as a handle gets the anonymous name instead. The privacy requirement is
-- absolute, so that is the right way to be wrong.
--
-- security definer to read auth.users; search_path pinned because a SECURITY
-- DEFINER function without it is hijackable via a shadowed relation.
create or replace function public.public_display_name(uid uuid, submitted text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
    email_local text;
    clean       text := left(coalesce(nullif(trim(submitted), ''), 'player'), 24);
begin
    select lower(split_part(u.email, '@', 1)) into email_local
      from auth.users u where u.id = uid;
    if email_local is not null and email_local <> '' and lower(clean) = email_local then
        return public.anon_display_name(uid);
    end if;
    return clean;
end;
$$;


-- ============================================================================
-- LAYER 3 — THE BOARDS.
--
-- 👉 CUSTOMIZE: this reference models a DAILY board with a WEEKLY rollup, which
--    is the right shape for an endless/score-attack game. For a campaign
--    ladder, drop the partition key and rank on (furthest, mastery) instead —
--    the pattern (owner-only writes, public reads, monotonic guard, index
--    matching the ORDER BY) is identical. Rename `game_daily_scores` to
--    something game-specific if one database serves more than one game.
-- ============================================================================

-- The server's own copy of the client's day key. MUST stay identical in format
-- and semantics. `at time zone 'utc'` pins the conversion so no session
-- TimeZone setting can move the answer — a day boundary that moved per
-- connection would reject honest scores for hours at a time.
--
-- 👉 CUSTOMIZE: to reset the day in a local timezone instead of UTC, swap 'utc'
--    for the IANA zone (e.g. 'America/Edmonton') in BOTH this and the client,
--    and update the self-check cases at the bottom.
create or replace function public.game_day_key(ts timestamptz)
returns text language sql immutable as $$
    select to_char(ts at time zone 'utc', 'YYYY-MM-DD');
$$;

-- Which week a day belongs to — the ONE definition of the daily→weekly rollup.
--
-- to_date(), not ::date: the cast reads DateStyle and is therefore only STABLE,
-- which would make this function un-indexable and turn the weekly view into a
-- full scan of every day ever played. to_date's format is explicit, so this is
-- genuinely IMMUTABLE and the expression index below is legal.
create or replace function public.game_week_of_day(day_key text)
returns text language sql immutable as $$
    select to_char(to_date(day_key, 'YYYY-MM-DD'), 'IYYY-"W"IW');
$$;

-- One row per (user, day). Nothing private lives here — this table is
-- world-readable by design, so it holds only what you would print on a
-- billboard.
create table if not exists public.game_daily_scores (
    user_id      uuid not null references auth.users(id) on delete cascade,
    day_key      text not null check (day_key ~ '^\d{4}-\d{2}-\d{2}$'),
    score        bigint not null check (score >= 0),
    display_name text not null default 'player',
    scored_at    timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (user_id, day_key)
);

-- The daily board's exact query shape: top-N for a day, best first, earliest to
-- reach it breaking ties. KEEP THE CLIENT'S ORDER BY BYTE-IDENTICAL TO THIS or
-- the index stops being used and the board degrades to a scan.
create index if not exists game_daily_day_rank
    on public.game_daily_scores (day_key, score desc, scored_at asc);

-- The weekly rollup's filter. The view groups on game_week_of_day(day_key), so
-- a `week_key=eq.…` lands on this expression index instead of hashing every
-- daily row in the table's history.
create index if not exists game_daily_week
    on public.game_daily_scores (public.game_week_of_day(day_key));

alter table public.game_daily_scores enable row level security;

-- Reads public (that is the point of a leaderboard), writes owner-only.
drop policy if exists "Anyone can read the daily board" on public.game_daily_scores;
create policy "Anyone can read the daily board"
    on public.game_daily_scores for select using (true);

drop policy if exists "Users can insert own daily score" on public.game_daily_scores;
create policy "Users can insert own daily score"
    on public.game_daily_scores for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own daily score" on public.game_daily_scores;
create policy "Users can update own daily score"
    on public.game_daily_scores for update
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ==========================================
-- THE GUARD. Everything the boards actually guarantee lives in here.
--
--   · the SERVER decides which board a score belongs to, not the submitter's
--     clock. Without this, a clock set forward opens tomorrow's board early
--     (play it unhurried, arrive on the day with a score nobody had time to
--     chase) and a clock set back re-opens a board whose layout is known. It
--     also closes the quiet hole: backfilling a CLOSED day whose winner was
--     already crowned, which needs no tampering, just a late sync.
--   · score is MONOTONIC per (user, day) — a stale or duplicate submit can
--     never clobber a better run.
--   · scored_at moves ONLY on a genuine rise, so "first to reach it wins the
--     tie" survives a cosmetic display-name edit.
--   · display_name is trimmed, capped, and run through the email check.
--   · updated_at is server time.
--
-- THE RENAME TRAP — read before touching the day check. Retroactive rename
-- UPDATEs display_name on every row the player owns, INCLUDING past days. If
-- the day check runs on those, every one of them raises, the client swallows
-- the rejection, and scrubbing history silently never works. So the check is
-- skipped when the score is unchanged: a rename is not a submission.
--
-- GRACE: a run that starts before midnight and syncs after it is honest, so the
-- previous day is accepted for one hour past the boundary — expressed as "the
-- day of now() or of now() - 1 hour", which needs no extra constant and
-- self-closes.
--
-- Rejection must be SAFE client-side: the submit path swallows the error and
-- simply doesn't memo the send, so a stale submit is a no-op, not a crash.
-- ==========================================
create or replace function public.game_daily_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
    is_submission boolean := true;
begin
    if tg_op = 'UPDATE' then
        -- A rename (or any write that does not raise the score) is not a
        -- submission and must not be judged against the current day.
        is_submission := new.score > old.score;
    end if;

    if is_submission
       and new.day_key <> public.game_day_key(now())
       and new.day_key <> public.game_day_key(now() - interval '1 hour') then
        raise exception
            'game_daily_scores: day_key % is not the current board (server day is %)',
            new.day_key, public.game_day_key(now())
            using errcode = 'check_violation';
    end if;

    if tg_op = 'UPDATE' then
        if is_submission then
            new.scored_at := now();
        else
            new.score     := old.score;      -- monotonic: an update can never lower it
            new.scored_at := old.scored_at;  -- and a no-rise update can't touch the tiebreak
            new.day_key   := old.day_key;    -- nor silently move the row to another board
        end if;
    else
        new.scored_at := now();
    end if;

    new.display_name := public.public_display_name(new.user_id, new.display_name);
    new.updated_at   := now();
    return new;
end;
$$;

drop trigger if exists game_daily_guard on public.game_daily_scores;
create trigger game_daily_guard
    before insert or update on public.game_daily_scores
    for each row execute function public.game_daily_guard();


-- ==========================================
-- THE SEASON — a VIEW, not a second table.
--
-- A stored weekly total is a denormalised copy that another trigger has to keep
-- in step with every daily upsert, and the first time the two disagree the
-- leaderboard lies. Summing the daily rows makes the total BY CONSTRUCTION the
-- sum of the scores that produced it, and PostgREST reads the view with the
-- same select/order/limit shape the client already uses for every other board.
--
--   total        the ranking key. This is what makes showing up the strategy:
--                a skipped day is a zero with no way to make it back.
--   days_played  shown next to the total ("18,204 · 5d") because it EXPLAINS
--                the ranking, and it breaks ties in favour of more turnout.
--   display_name from the player's MOST RECENT day, so a rename lands here
--                immediately, exactly as it does on the daily board.
--
-- `where score > 0` keeps a zero-scored row (only reachable via a hand-crafted
-- submit) from inflating days_played.
-- ==========================================
drop view if exists public.game_weekly_totals;
create view public.game_weekly_totals as
select
    public.game_week_of_day(day_key)                    as week_key,
    user_id,
    (array_agg(display_name order by day_key desc))[1]  as display_name,
    sum(score)::bigint                                  as total,
    count(*)::int                                       as days_played,
    max(scored_at)                                      as last_scored_at
from public.game_daily_scores
where score > 0
group by 1, 2;

-- Run the view as the CALLER so the base table's RLS applies, rather than being
-- bypassed by the view owner's rights. The SELECT policy above is `using (true)`
-- so this changes nothing today — it means that the day the base table's read
-- policy is narrowed, this view narrows with it instead of quietly becoming the
-- way around it. Wrapped because security_invoker needs PG15+ and a migration
-- must not fail on an older server over a belt-and-braces detail.
do $$
begin
    execute 'alter view public.game_weekly_totals set (security_invoker = true)';
exception when others then
    raise notice 'security_invoker unsupported here; view runs as owner (base table is public-read anyway)';
end;
$$;

grant select on public.game_weekly_totals to anon, authenticated;


-- ============================================================================
-- SELF-CHECK — this migration REFUSES TO APPLY if the server's idea of a day,
-- or of which week a day belongs to, disagrees with the client's.
--
-- If game_day_key() drifts from the client's dayKey(), the database starts
-- rejecting every honest score and the board silently goes empty. If
-- game_week_of_day() drifts, the daily boards keep working perfectly while the
-- weekly standings rank the wrong seven days — which is worse, because nothing
-- about it looks broken.
--
-- 👉 CUSTOMIZE: mirror these exact cases in the client's unit test.
-- ============================================================================
do $$
declare
    day_cases constant text[][] := array[
        ['2026-07-29T00:00:00Z', '2026-07-29'],  -- the moment the board opens
        ['2026-07-29T23:59:59Z', '2026-07-29'],  -- last second of the same board
        ['2026-07-30T00:00:00Z', '2026-07-30'],  -- the rollover, exactly
        ['2026-01-01T12:00:00Z', '2026-01-01'],  -- year seam
        ['2026-03-01T00:00:00Z', '2026-03-01']   -- month seam, non-leap February
    ];
    week_cases constant text[][] := array[
        ['2026-07-27', '2026-W31'],  -- Monday: the season opens
        ['2026-08-02', '2026-W31'],  -- Sunday: still the same season
        ['2026-08-03', '2026-W32'],  -- next Monday: a new one
        ['2025-12-29', '2026-W01'],  -- ISO year seam: W01 starts in December
        ['2026-01-04', '2026-W01'],
        ['2026-01-05', '2026-W02']
    ];
    i int; got text; expected text;
begin
    for i in 1 .. array_length(day_cases, 1) loop
        expected := day_cases[i][2];
        got := public.game_day_key(day_cases[i][1]::timestamptz);
        if got <> expected then
            raise exception
                'game_day_key(%) returned % but the client computes % — server and client disagree about which day it is; DO NOT deploy this guard until they match',
                day_cases[i][1], got, expected;
        end if;
        if got !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'game_day_key(%) returned %, violating the day_key CHECK', day_cases[i][1], got;
        end if;
    end loop;

    for i in 1 .. array_length(week_cases, 1) loop
        expected := week_cases[i][2];
        got := public.game_week_of_day(week_cases[i][1]);
        if got <> expected then
            raise exception
                'game_week_of_day(%) returned % but the client computes % — the weekly totals would roll up the wrong days',
                week_cases[i][1], got, expected;
        end if;
    end loop;

    -- The real risk both share: a session TimeZone quietly shifting the answer.
    set local timezone = 'Pacific/Kiritimati';  -- UTC+14, furthest ahead on earth
    if public.game_day_key('2026-07-29T23:59:59Z'::timestamptz) <> '2026-07-29' then
        raise exception 'game_day_key is sensitive to the session timezone — it must be pinned';
    end if;
    set local timezone = 'Pacific/Niue';        -- UTC-11, furthest behind
    if public.game_day_key('2026-07-30T00:00:00Z'::timestamptz) <> '2026-07-30' then
        raise exception 'game_day_key is sensitive to the session timezone — it must be pinned';
    end if;

    -- The name rule, on the shared case the client test also asserts.
    if public.anon_display_name('7f3a91b2-0000-4000-8000-000000000000') <> 'Player 7F3A' then
        raise exception 'anon_display_name drifted from the client formula — players would see two different names';
    end if;

    raise notice 'day/week keys and the anonymous name agree with the client across all checked cases.';
end;
$$;
