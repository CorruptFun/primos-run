-- ============================================================================
-- 0001_primos_cloud.sql
-- Cloud save + the daily/weekly race boards for PRIMOS: BARRIO RUN.
--
-- Built from .claude/skills/cloud-saves-and-leaderboards, which distills the
-- shipped Viva Maya implementation. Read that skill before changing anything
-- here: most of what looks fussy below is a scar, and the comment above each
-- guard says what breaks without it.
--
-- TABLE NAMES ARE GAME-PREFIXED (`primos_*`) ON PURPOSE. This project may end
-- up sharing a Supabase project with another game, and generic names like
-- `saves` are exactly the ones already taken. Retrofitting a rename across
-- policies, triggers, indexes and a view is far more work than the prefix.
--
-- SECURITY MODEL: Row Level Security denies by default; the policies below
-- re-grant per row. The board is world-readable BY DESIGN — that is what a
-- leaderboard is — so it holds only what you would print on a billboard: a user
-- id, a chosen display name, a day key and a score. The save is owner-only. The
-- publishable anon key is safe to ship in js/cloud-config.js precisely because
-- these policies, not the key, are the protection.
--
-- TRUST MODEL, stated plainly: scores are self-reported by an untrusted client
-- and nothing here pretends otherwise. What IS guaranteed is that RLS stops
-- anyone writing anyone else's row, and the guard stops the cheap structural
-- attacks — wrong board, lowered score, forged timestamp, leaked email. Making
-- the SCORE itself unforgeable needs server-side deterministic replay and is a
-- separate project. A DAILY board makes that easier to defer: a forged score
-- buys one day, not a season.
--
-- Idempotent-friendly: safe to re-run.
-- ============================================================================


-- ==========================================
-- TABLE: public.primos_saves
-- One row per user; the whole save blob as jsonb.
--
-- jsonb rather than columns because the save's shape changes every time the
-- game grows, and a schema migration per gameplay feature is a tax you stop
-- paying after the third one. js/store.js coerce() already has to tolerate old
-- shapes (people come back after months), so the client owns validation either
-- way.
-- ==========================================
create table if not exists public.primos_saves (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    data       jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.primos_saves enable row level security;

drop policy if exists "Users can view own save" on public.primos_saves;
create policy "Users can view own save"
    on public.primos_saves for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own save" on public.primos_saves;
create policy "Users can insert own save"
    on public.primos_saves for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own save" on public.primos_saves;
create policy "Users can update own save"
    on public.primos_saves for update
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own save" on public.primos_saves;
create policy "Users can delete own save"
    on public.primos_saves for delete using (auth.uid() = user_id);

-- updated_at must be SERVER time whatever the client sends. The column default
-- covers INSERT; this covers overwrite. search_path pinned to '' as hardening
-- (now() is in pg_catalog, always resolvable).
create or replace function public.primos_saves_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_primos_saves_touch on public.primos_saves;
create trigger trg_primos_saves_touch
    before update on public.primos_saves
    for each row execute function public.primos_saves_touch();


-- ==========================================
-- THE PUBLIC NAME — never the account's email.
--
-- The email local-part of a Google account is very often a real name
-- ('jane.doe'). A client-side fallback to it published real names for every
-- player who never opened the name picker; that shipped on the sister project
-- and a player reported it. Fixing the client is NOT enough, for two permanent
-- reasons: a cached PWA keeps submitting the old name for as long as it takes
-- the player to accept an update (a green deploy is not "players are on it"),
-- and rows already published never rewrite themselves.
--
-- primos_anon_display_name MUST STAY BYTE-IDENTICAL to anonName() in
-- js/leaderboard.js — the server substitutes this exact string, so any drift
-- shows the player one name in the game and the board another. The self-check
-- at the bottom of this file refuses to apply on drift; dev/cloud-test.html
-- asserts the same case from the client side.
--
-- PREFIXED, and that is not cosmetic. This project shares a Supabase project
-- with Viva Maya and Turbo Maze, and Viva Maya already owns an unprefixed
-- public.anon_display_name(p_user uuid) from its own migration 0017. Two games
-- sharing one mutable function means either one changing its anonymous-name
-- format silently rewrites the other's live board. Postgres also refuses to
-- `create or replace` across a renamed parameter (42P13: cannot change name of
-- input parameter), so the unprefixed version would have failed this migration
-- outright. Every other object in this file was already prefixed; this one had
-- been missed.
-- ==========================================
create or replace function public.primos_anon_display_name(uid uuid)
returns text language sql immutable as $$
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
-- security definer to reach auth.users; search_path pinned because a SECURITY
-- DEFINER function without it is hijackable via a shadowed relation.
create or replace function public.primos_public_name(uid uuid, submitted text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
    email_local text;
    clean       text := left(coalesce(nullif(trim(submitted), ''), 'player'), 24);
begin
    select lower(split_part(u.email, '@', 1)) into email_local
      from auth.users u where u.id = uid;
    if email_local is not null and email_local <> '' and lower(clean) = email_local then
        return public.primos_anon_display_name(uid);
    end if;
    return clean;
end;
$$;


-- ==========================================
-- WHICH BOARD — the server's own copy of js/raceday.js.
--
-- `at time zone 'utc'` pins the conversion so no session TimeZone setting can
-- move the answer. A day boundary that moved per connection would reject honest
-- scores for hours at a time.
-- ==========================================
create or replace function public.primos_day_key(ts timestamptz)
returns text language sql immutable as $$
    select to_char(ts at time zone 'utc', 'YYYY-MM-DD');
$$;

-- Which week a day belongs to — the ONE definition of the daily→weekly rollup.
--
-- to_date(), not ::date: the cast reads DateStyle and is therefore only STABLE,
-- which would make this un-indexable and turn the weekly view into a full scan
-- of every day ever played. to_date's format is explicit, so this is genuinely
-- IMMUTABLE and the expression index below is legal.
create or replace function public.primos_week_of_day(day_key text)
returns text language sql immutable as $$
    select to_char(to_date(day_key, 'YYYY-MM-DD'), 'IYYY-"W"IW');
$$;


-- ==========================================
-- TABLE: public.primos_daily_scores — one row per (user, UTC day).
-- ==========================================
create table if not exists public.primos_daily_scores (
    user_id      uuid not null references auth.users(id) on delete cascade,
    day_key      text not null check (day_key ~ '^\d{4}-\d{2}-\d{2}$'),
    score        bigint not null check (score >= 0),
    display_name text not null default 'player',
    -- Did the run that set this score pay Corrupt to keep going?
    --
    -- Continued runs ARE eligible for the boards. The alternative — submitting
    -- the score at the first bust — makes the number on the game-over sheet
    -- differ from the number that goes up, which is worse than a board where
    -- some rows were bought, PROVIDED the board says which ones. Hence a column
    -- rather than a filter: it ranks normally and is marked wherever shown.
    --
    -- Defaulted, so a cached client that predates this column still submits.
    continued    boolean not null default false,
    scored_at    timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (user_id, day_key)
);

-- Additive and defaulted, so re-running this migration over an earlier install
-- costs nothing and old rows read as clean runs — which is what they were.
alter table public.primos_daily_scores
    add column if not exists continued boolean not null default false;

-- The daily board's exact query shape: top-N for a day, best first, earliest to
-- reach it breaking ties. KEEP js/leaderboard.js's ORDER BY BYTE-IDENTICAL TO
-- THIS or the index quietly stops being used.
create index if not exists primos_daily_day_rank
    on public.primos_daily_scores (day_key, score desc, scored_at asc);

-- The weekly rollup's filter. The view groups on primos_week_of_day(day_key),
-- so `week_key=eq.…` from PostgREST lands here instead of hashing every daily
-- row in the table's history.
create index if not exists primos_daily_week
    on public.primos_daily_scores (public.primos_week_of_day(day_key));

alter table public.primos_daily_scores enable row level security;

drop policy if exists "Anyone can read the daily board" on public.primos_daily_scores;
create policy "Anyone can read the daily board"
    on public.primos_daily_scores for select using (true);

drop policy if exists "Users can insert own daily score" on public.primos_daily_scores;
create policy "Users can insert own daily score"
    on public.primos_daily_scores for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own daily score" on public.primos_daily_scores;
create policy "Users can update own daily score"
    on public.primos_daily_scores for update
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ==========================================
-- THE GUARD. Everything the board actually guarantees lives in here.
--
--   · the SERVER decides which board a score belongs to, not the submitter's
--     clock. Without this, a clock set forward opens tomorrow's board early —
--     play it unhurried, arrive on the day with a score nobody had time to
--     chase — and a clock set back re-opens a board whose layout is already
--     known. It also closes the quiet hole: backfilling a CLOSED day whose
--     winner was already crowned, which needs no tampering at all, just a
--     client that synced late.
--   · score is MONOTONIC per (user, day) — a stale or duplicate submit can
--     never clobber a better run.
--   · scored_at moves ONLY on a genuine rise, so "first to reach it wins the
--     tie" survives a cosmetic rename.
--   · display_name is trimmed, capped, and run through the email check.
--
-- THE RENAME TRAP — read this before touching the day check. Retroactive rename
-- (js/leaderboard.js renameEverywhere) UPDATEs display_name on every row the
-- player owns, INCLUDING closed days. If the day check ran on those, every one
-- would raise, the client would swallow the rejection, and scrubbing a name from
-- history would silently never work — invisibly, for months. So the check is
-- skipped when the score does not rise: a rename is not a submission.
--
-- GRACE: a run that finishes just before midnight and syncs after it is honest,
-- so the previous day is accepted for one hour past the boundary — expressed as
-- "the day of now() or of now() - 1 hour", which needs no extra constant and
-- self-closes.
--
-- Rejection is SAFE client-side: maybeSubmitDaily swallows the error and simply
-- doesn't memo the send, so a stale submit is a no-op rather than a crash.
-- ==========================================
create or replace function public.primos_daily_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
    is_submission boolean := true;
begin
    if tg_op = 'UPDATE' then
        is_submission := new.score > old.score;
    end if;

    if is_submission
       and new.day_key <> public.primos_day_key(now())
       and new.day_key <> public.primos_day_key(now() - interval '1 hour') then
        raise exception
            'primos_daily_scores: day_key % is not the current board (server day is %)',
            new.day_key, public.primos_day_key(now())
            using errcode = 'check_violation';
    end if;

    if tg_op = 'UPDATE' then
        if is_submission then
            new.scored_at := now();
        else
            new.score     := old.score;      -- monotonic: an update can never lower it
            new.scored_at := old.scored_at;  -- a no-rise update can't touch the tiebreak
            new.day_key   := old.day_key;    -- nor silently move the row to another board
            new.continued := old.continued;  -- nor launder a bought run into a clean one
        end if;
    else
        new.scored_at := now();
    end if;

    new.display_name := public.primos_public_name(new.user_id, new.display_name);
    new.updated_at   := now();
    return new;
end;
$$;

drop trigger if exists primos_daily_guard on public.primos_daily_scores;
create trigger primos_daily_guard
    before insert or update on public.primos_daily_scores
    for each row execute function public.primos_daily_guard();


-- ==========================================
-- VIEW: public.primos_weekly_totals — the season. A VIEW, not a second table.
--
-- A stored weekly total is a denormalised copy that another trigger has to keep
-- in step with every daily upsert, and the first time the two disagree the
-- leaderboard lies. Summing the daily rows makes the total BY CONSTRUCTION the
-- sum of the scores that produced it.
--
--   total        the ranking key. This is what makes showing up the strategy: a
--                skipped day is a zero with no way to make it back.
--   days_played  shown next to the total ("18,204 · 5d") because it EXPLAINS
--                the ranking, and it breaks ties toward more turnout.
--   display_name from the player's MOST RECENT day, so a rename lands here
--                immediately, exactly as it does on the daily board.
--
-- `where score > 0` keeps a zero-scored row (only reachable via a hand-crafted
-- submit) from inflating days_played.
-- ==========================================
drop view if exists public.primos_weekly_totals;
create view public.primos_weekly_totals as
select
    public.primos_week_of_day(day_key)                  as week_key,
    user_id,
    (array_agg(display_name order by day_key desc))[1]  as display_name,
    sum(score)::bigint                                  as total,
    count(*)::int                                       as days_played,
    -- A weekly total is marked if ANY day inside it was bought. The total is
    -- made partly of that run, so saying otherwise would be the lie the daily
    -- mark exists to prevent.
    bool_or(continued)                                  as continued,
    max(scored_at)                                      as last_scored_at
from public.primos_daily_scores
where score > 0
group by 1, 2;

-- Run as the CALLER so the base table's RLS applies rather than being bypassed
-- by the view owner's rights. The SELECT policy is `using (true)`, so this
-- changes nothing today — it means that the day the base table's read policy is
-- narrowed, this view narrows with it instead of quietly becoming the way
-- around it. Wrapped because security_invoker needs PG15+ and a migration must
-- not fail on an older server over a belt-and-braces detail.
do $$
begin
    execute 'alter view public.primos_weekly_totals set (security_invoker = true)';
exception when others then
    raise notice 'security_invoker unsupported here; view runs as owner (base table is public-read anyway)';
end;
$$;

grant select on public.primos_weekly_totals to anon, authenticated;


-- ==========================================
-- BACKFILL — apply the name rule to anything already stored. On a first install
-- this touches nothing; it exists so re-running after the rule changes is not a
-- silent no-op on history.
-- ==========================================
update public.primos_daily_scores
   set display_name = public.primos_public_name(user_id, display_name)
 where display_name is distinct from public.primos_public_name(user_id, display_name);


-- ============================================================================
-- SELF-CHECK — this migration REFUSES TO APPLY if the server's idea of a day,
-- or of which week a day belongs to, or of the anonymous name, disagrees with
-- the game client's.
--
-- If primos_day_key() drifts from js/raceday.js dayKey(), the database starts
-- rejecting every honest score and the board silently goes empty. If
-- primos_week_of_day() drifts, the daily boards keep working perfectly while the
-- weekly standings rank the wrong seven days — which is worse, because nothing
-- about it looks broken.
--
-- Mirror any change to these cases in dev/cloud-test.html.
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
        got := public.primos_day_key(day_cases[i][1]::timestamptz);
        if got <> expected then
            raise exception
                'primos_day_key(%) returned % but the game client computes % — server and client disagree about which day it is; DO NOT deploy this guard until they match',
                day_cases[i][1], got, expected;
        end if;
        if got !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'primos_day_key(%) returned %, violating the day_key CHECK', day_cases[i][1], got;
        end if;
    end loop;

    for i in 1 .. array_length(week_cases, 1) loop
        expected := week_cases[i][2];
        got := public.primos_week_of_day(week_cases[i][1]);
        if got <> expected then
            raise exception
                'primos_week_of_day(%) returned % but the game client computes % — the weekly totals would roll up the wrong days',
                week_cases[i][1], got, expected;
        end if;
    end loop;

    -- The real risk both share: a session TimeZone quietly shifting the answer.
    set local timezone = 'Pacific/Kiritimati';  -- UTC+14, furthest ahead on earth
    if public.primos_day_key('2026-07-29T23:59:59Z'::timestamptz) <> '2026-07-29' then
        raise exception 'primos_day_key is sensitive to the session timezone — it must be pinned to UTC';
    end if;
    set local timezone = 'Pacific/Niue';        -- UTC-11, furthest behind
    if public.primos_day_key('2026-07-30T00:00:00Z'::timestamptz) <> '2026-07-30' then
        raise exception 'primos_day_key is sensitive to the session timezone — it must be pinned to UTC';
    end if;
    if public.primos_week_of_day('2026-08-02') <> '2026-W31' then
        raise exception 'primos_week_of_day is sensitive to the session timezone — it must not be';
    end if;

    if public.primos_anon_display_name('7f3a91b2-0000-4000-8000-000000000000') <> 'Player 7F3A' then
        raise exception 'primos_anon_display_name drifted from js/leaderboard.js anonName — players would see two different names';
    end if;

    raise notice 'day/week keys and the anonymous name agree with the game client across all checked cases.';
end;
$$;
