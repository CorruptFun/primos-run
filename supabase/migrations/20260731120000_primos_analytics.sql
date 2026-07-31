-- ============================================================================
-- 20260731120000_primos_analytics.sql
-- First-party product analytics for PRIMOS: BARRIO RUN.
--
-- ⚠ WHY THIS ONE IS TIMESTAMPED WHEN ITS SIBLINGS ARE 0001 / 0002.
--
-- `version` is the primary key of supabase_migrations.schema_migrations, and
-- that table is PER-PROJECT, not per-game. This project is shared, and the
-- other two games got there first: the remote history already holds versions
-- 0001 through 0022 — Viva Maya's twenty plus Turbo Maze's — so Primos'
-- 0001/0002/0003 collide with THEIRS by pure numeric coincidence.
--
-- The consequence is not an error. `supabase db push` computes "pending" as
-- local versions absent from the remote history, sees 0003 already present
-- (Viva Maya's), and therefore APPLIES NOTHING WHILE REPORTING SUCCESS. This
-- file was written as 0003 and would have been silently skipped.
--
-- A 14-digit timestamp is Supabase's own convention and cannot collide with
-- another game's hand-numbered file or with a future one. 0001 and 0002 keep
-- their names because they are already applied and renaming an applied
-- migration only confuses humans — the database does not care about filenames.
-- Number anything NEW here by timestamp.
-- ============================================================================
-- An append-only event log, a guard trigger, an admin allow-list, one
-- aggregates-only read RPC, and a prune function.
--
-- Built from ~/.claude/skills/first-party-analytics, which distills the shipped
-- Viva Maya implementation (its 0010 → 0015 → 0018 → 0019 chain). Read that
-- skill before changing anything here; most of what looks fussy below is a scar
-- and the comment above it says what breaks without it.
--
-- ============================================================================
-- ⚠ EVERY OBJECT IS `primos_`-PREFIXED, AND HERE THAT IS LOAD-BEARING IN THE
-- SHARPEST WAY IT HAS BEEN YET.
--
-- Viva Maya lives in THIS SAME Supabase project (deskabqqxqqibxjffwmb) and
-- already owns, applied and live, all of:
--
--     public.events            (its 0010)
--     public.events_guard()    (its 0010, REWRITTEN by its 0018 to add dedupe)
--     public.prune_events()    (its 0010)
--     public.app_admins        (its 0014)
--     public.admin_analytics() (its 0014, HARDENED by its 0015)
--
-- An unprefixed version of this file would not have failed. It would have:
--
--   · `create table if not exists public.events` — found Viva Maya's live table
--     already there and QUIETLY DONE NOTHING. Primos would then write every one
--     of its events into Viva Maya's log. Two games, one stream, and both
--     dashboards silently wrong.
--   · `create or replace function public.events_guard()` — matching signature,
--     so it REPLACES rather than fails, throwing away the dedupe Viva Maya's
--     0018 exists to provide. Its event deduplication would just stop, with no
--     error anywhere.
--   · `create or replace function public.admin_analytics(integer)` — same, and
--     Viva Maya's dashboard would start rendering against this file's shape.
--   · `create or replace function public.prune_events(integer)` — same again.
--
-- That is the 0002 hazard with three more heads. Nothing anywhere would have
-- said a word. KEEP EVERY OBJECT IN THIS FILE PREFIXED.
--
-- `primos_app_admins` is prefixed for the same reason even though Viva Maya's
-- `app_admins` holds the same human. Reusing it would mean `create table if not
-- exists` silently adopting a table this repo does not own, plus a hidden
-- cross-game dependency where dropping Viva Maya's 0014 breaks the Primos
-- dashboard. The cost of owning it is one `insert` at rollout, once.
-- ============================================================================
--
-- SECURITY MODEL, stated plainly:
--   · The event log is APPEND-ONLY TO EVERY CLIENT. An INSERT policy and NO
--     SELECT POLICY, EVER. RLS denies what it does not allow, so a visitor
--     holding the publishable key can write their own events and read nothing.
--     An event log is a per-device behavioural history — it is worse to leak
--     than a leaderboard, and there is no version of "just for debugging" that
--     justifies a select policy here.
--   · Reads go through ONE admin-gated SECURITY DEFINER RPC that returns
--     AGGREGATES ONLY, never raw rows.
--   · Anonymous by construction. `device_id` is a random UUID minted in
--     localStorage — not derived from anything about the device or the person.
--     `user_id` is set only while signed in and RLS pins it to auth.uid(), so it
--     cannot be forged.
--
-- Idempotent-friendly: safe to re-run.
-- ============================================================================


-- ==========================================
-- THE EVENT LOG
-- ==========================================
create table if not exists public.primos_events (
    id          bigint generated always as identity primary key,

    -- Anonymous identity. A random UUID in localStorage, NOT a fingerprint and
    -- NOT the account: auth-keyed telemetry only ever sees the minority who sign
    -- in, and this game's whole reason for measuring is that the signed-out
    -- majority is currently invisible.
    device_id   uuid not null,

    -- Only while signed in. The policy below pins it to auth.uid().
    user_id     uuid references auth.users(id) on delete set null,

    -- Minted per app open, memory only. This is what turns a flat stream into
    -- sessions, bounce rates and lengths.
    session_id  uuid not null,

    -- Deliberately TEXT, not an enum and not an FK. This is a PWA: cached
    -- clients keep sending last month's vocabulary for weeks. The guard buckets
    -- an unrecognisable name as 'unknown' rather than rejecting the row, so a
    -- typo SURFACES on the dashboard instead of vanishing.
    name        text not null,

    props       jsonb not null default '{}'::jsonb,

    -- Which build produced the event. Under a prompt-mode service worker a
    -- metric that moves after a deploy is unreadable without knowing who is
    -- running which code.
    app_version text,

    -- Idempotency key, minted client-side. NULLABLE, with a FULL (not partial)
    -- unique index: id-less rows from older clients insert forever because NULLs
    -- never collide, and `on conflict (event_id)` can only infer a whole-column
    -- index — a partial one would silently disable the dedupe.
    event_id    uuid,

    created_at  timestamptz not null default now()
);

create index if not exists primos_events_created_at
    on public.primos_events (created_at desc);
create index if not exists primos_events_name_created_at
    on public.primos_events (name, created_at desc);
create index if not exists primos_events_device_created_at
    on public.primos_events (device_id, created_at desc);
create unique index if not exists primos_events_event_id
    on public.primos_events (event_id);

alter table public.primos_events enable row level security;

-- THE MOST IMPORTANT LINES IN THIS FILE: an INSERT policy, and no SELECT policy.
-- `user_id is null` admits the signed-out majority; `auth.uid() = user_id` stops
-- one player attributing events to another.
drop policy if exists "Anyone can append their own events" on public.primos_events;
create policy "Anyone can append their own events"
    on public.primos_events for insert
    with check (user_id is null or auth.uid() = user_id);

-- Clients may only ever append. Without these revokes the default grants would
-- leave UPDATE/DELETE reachable the moment anyone ever adds a select policy.
revoke update, delete on table public.primos_events from anon, authenticated;


-- ==========================================
-- THE GUARD — bound what an untrusted client can put in a row.
--
-- DEGRADE, NEVER THROW. An exception here goes back into the game loop through
-- the fetch that raised it. A bad row is worth losing; a crashed run is not.
--
-- The dedupe lives INSIDE the trigger as well as in the unique index, because
-- the trigger catches any plain insert — including every cached PWA bundle that
-- predates the idempotent wire shape. That is the shape Viva Maya's 0018 had to
-- be written for after the fact; this game starts with it.
-- ==========================================
create or replace function public.primos_events_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
    -- Normalise the name. Anything that is not lower snake_case becomes a
    -- VISIBLE 'unknown' bucket — a typo must surface, not disappear.
    new.name := lower(left(trim(coalesce(new.name, '')), 40));
    if new.name !~ '^[a-z][a-z0-9_]*$' then
        new.name := 'unknown';
    end if;

    -- Props must be a bounded JSON OBJECT. A client can send an array, a
    -- scalar, or a megabyte of nonsense; none of those may land.
    if jsonb_typeof(new.props) is distinct from 'object'
       or length(new.props::text) > 2048 then
        new.props := '{}'::jsonb;
    end if;

    new.app_version := left(nullif(trim(coalesce(new.app_version, '')), ''), 32);

    -- The client NEVER chooses when. A forged timestamp would let one device
    -- rewrite a day's history, and every bucket below is keyed on this.
    new.created_at := now();

    -- Idempotency, in the trigger so a plain insert dedupes too.
    if new.event_id is not null
       and exists (select 1 from public.primos_events e where e.event_id = new.event_id) then
        return null;   -- already have it; drop silently
    end if;

    return new;
end; $$;

drop trigger if exists primos_events_guard on public.primos_events;
create trigger primos_events_guard before insert on public.primos_events
    for each row execute function public.primos_events_guard();


-- ==========================================
-- THE ADMIN ALLOW-LIST.
--
-- RLS on, ZERO policies. The API can neither read nor write it in any role;
-- membership is granted only from the SQL editor / service role. This IS the
-- entire authorization model for reads — a row here is a person, not a role.
-- ==========================================
create table if not exists public.primos_app_admins (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    note       text,
    created_at timestamptz not null default now()
);
alter table public.primos_app_admins enable row level security;
revoke all on table public.primos_app_admins from public, anon, authenticated;


-- ==========================================
-- THE READ PATH — one RPC, aggregates only, admin- or service-role-gated.
--
-- Everything it touches is hostile: a jsonb_typeof check before every cast, a
-- round()::int so a forged float cannot error the whole payload, length caps on
-- strings, a LIMIT on every grouped list, and p_days clamped.
--
-- Buckets are EXPLICIT UTC, matching js/raceday.js dayKey() — so the boards, the
-- save's `days` map and this dashboard can never disagree about what a day is.
-- ==========================================
create or replace function public.primos_admin_analytics(p_days integer default 14)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
    d       integer := least(greatest(coalesce(p_days, 14), 1), 365);
    since   timestamptz;
    today   date := (now() at time zone 'utc')::date;
    jwt_role text := coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
    result  jsonb;
begin
    -- An admin, or the service_role JWT so a server-side ops job reports the
    -- same numbers. 42501 specifically, so the dashboard can tell "you are not
    -- an admin" from "this is broken".
    if jwt_role is distinct from 'service_role'
       and (auth.uid() is null
            or not exists (select 1 from public.primos_app_admins a
                            where a.user_id = auth.uid())) then
        raise exception 'primos_admin_analytics is admin-only' using errcode = '42501';
    end if;

    since := now() - make_interval(days => d);

    with
    win as (
        select device_id, user_id, session_id, name, props, app_version, created_at,
               (created_at at time zone 'utc') as utc_at
          from public.primos_events
         where created_at >= since
    ),
    first_seen as (
        select device_id, min(created_at) as first_at
          from public.primos_events group by 1
    ),
    device_days as (
        select distinct device_id, (created_at at time zone 'utc')::date as day
          from public.primos_events
    ),
    firsts as (select device_id, min(day) as day0 from device_days group by 1),
    ret as (
        select f.day0, f.device_id,
               exists (select 1 from device_days x
                        where x.device_id = f.device_id and x.day = f.day0 + 1) as r1,
               exists (select 1 from device_days x
                        where x.device_id = f.device_id and x.day = f.day0 + 7) as r7
          from firsts f
    ),
    sess as (
        select session_id,
               extract(epoch from max(created_at) - min(created_at))::int as secs,
               count(*) as events
          from win group by 1
    ),
    -- Runs, with their numbers pulled out of props ONLY where the type is right.
    runs as (
        select w.device_id, w.app_version, w.utc_at,
               case when jsonb_typeof(w.props->'score')    = 'number'
                    then round((w.props->>'score')::numeric)::int end   as score,
               case when jsonb_typeof(w.props->'seconds')  = 'number'
                    then round((w.props->>'seconds')::numeric)::int end as seconds,
               case when jsonb_typeof(w.props->'distance') = 'number'
                    then round((w.props->>'distance')::numeric)::int end as distance,
               case when jsonb_typeof(w.props->'continues') = 'number'
                    then round((w.props->>'continues')::numeric)::int end as continues,
               left(coalesce(w.props->>'reason', '?'), 40)              as reason
          from win w where w.name = 'run_end'
    )
    select jsonb_build_object(
        'meta', jsonb_build_object('days', d, 'since', since, 'generated_at', now()),

        'totals', (select jsonb_build_object(
            'devices',     count(distinct w.device_id),
            'signed_in',   count(distinct w.device_id) filter (where w.user_id is not null),
            'sessions',    count(distinct w.session_id),
            'events',      count(*),
            'new_devices', (select count(*) from first_seen f where f.first_at >= since)
        ) from win w),

        'daily', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'day', t.day, 'devices', t.devices, 'sessions', t.sessions,
                     'events', t.events, 'runs', t.runs,
                     'new_devices', coalesce(n.new_devices, 0)) order by t.day)
              from (select w.utc_at::date as day,
                           count(distinct w.device_id)  as devices,
                           count(distinct w.session_id) as sessions,
                           count(*)                     as events,
                           count(*) filter (where w.name = 'run_end') as runs
                      from win w group by 1) t
              left join (select (f.first_at at time zone 'utc')::date as day, count(*) as new_devices
                           from first_seen f where f.first_at >= since group by 1) n using (day)
        ), '[]'::jsonb),

        -- EVERY distinct name in the window, unfiltered. This is how the
        -- 'unknown' bucket and a client-side typo become visible at all.
        'counts', coalesce((
            select jsonb_agg(jsonb_build_object('name', t.name, 'events', t.events,
                                                'devices', t.devices) order by t.events desc)
              from (select w.name, count(*) as events, count(distinct w.device_id) as devices
                      from win w group by 1 order by 2 desc limit 200) t
        ), '[]'::jsonb),

        -- D1/D7 with HONEST eligibility: only devices whose day0+N has FULLY
        -- elapsed. Folding in yesterday's cohort drags every number toward zero.
        'retention', jsonb_build_object(
            'd1', (select jsonb_build_object(
                     'eligible', count(*) filter (where day0 + 1 < today),
                     'returned', count(*) filter (where day0 + 1 < today and r1)) from ret),
            'd7', (select jsonb_build_object(
                     'eligible', count(*) filter (where day0 + 7 < today),
                     'returned', count(*) filter (where day0 + 7 < today and r7)) from ret)
        ),

        'sessions', (select jsonb_build_object(
            'total',          count(*),
            'median_seconds', round(coalesce(percentile_cont(0.5) within group (order by s.secs), 0))::int,
            'bounces',        count(*) filter (where s.events <= 1 or s.secs < 10)
        ) from sess s),

        -- ---- the product's own panels ------------------------------------
        -- THE RUN. "Where do players quit" is the question this whole stack was
        -- built to answer, and for an endless runner it is a distribution, not a
        -- step: how long a run lasts, and what ended it.
        'runs', (select jsonb_build_object(
            'total',           count(*),
            'devices',         count(distinct r.device_id),
            'median_score',    round(coalesce(percentile_cont(0.5) within group (order by r.score), 0))::int,
            'p90_score',       round(coalesce(percentile_cont(0.9) within group (order by r.score), 0))::int,
            'median_seconds',  round(coalesce(percentile_cont(0.5) within group (order by r.seconds), 0))::int,
            'continued',       count(*) filter (where coalesce(r.continues, 0) > 0),
            -- Fixed buckets, indices owned here and labels owned by the
            -- dashboard, so the two cannot drift into disagreeing.
            'score_buckets', (select coalesce(jsonb_agg(jsonb_build_object(
                                       'bucket', b.bucket, 'runs', b.runs) order by b.bucket), '[]'::jsonb)
                                from (select width_bucket(coalesce(r2.score, 0), 0, 5000, 10) as bucket,
                                             count(*) as runs
                                        from runs r2 group by 1) b),
            'reasons', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'reason', t.reason, 'runs', t.runs) order by t.runs desc), '[]'::jsonb)
                          from (select r3.reason, count(*) as runs
                                  from runs r3 group by 1 order by 2 desc limit 12) t)
        ) from runs r),

        -- FUNNELS. Every denominator is a distinct-device count, so a player who
        -- opened the shop nine times counts once — a rate over event counts
        -- measures enthusiasm, not conversion.
        'funnels', (select jsonb_build_object(
            'tutorial', jsonb_build_object(
                'started',  count(distinct w.device_id) filter (where w.name = 'tutorial_start'),
                'finished', count(distinct w.device_id) filter (where w.name = 'tutorial_done'),
                'skipped',  count(distinct w.device_id) filter (where w.name = 'tutorial_skip')),
            'first_run', jsonb_build_object(
                'opened',  count(distinct w.device_id) filter (where w.name = 'app_open'),
                'started', count(distinct w.device_id) filter (where w.name = 'run_start'),
                'ended',   count(distinct w.device_id) filter (where w.name = 'run_end')),
            'shop', jsonb_build_object(
                'opened', count(distinct w.device_id) filter (where w.name = 'shop_open'),
                'bought', count(distinct w.device_id) filter (where w.name = 'shop_buy'),
                'denied', count(distinct w.device_id) filter (where w.name = 'shop_denied')),
            'continue', jsonb_build_object(
                'offered',  count(distinct w.device_id) filter (where w.name = 'continue_offer'),
                'taken',    count(distinct w.device_id) filter (where w.name = 'continue_take'),
                'declined', count(distinct w.device_id) filter (where w.name = 'continue_decline')),
            'sign_in', jsonb_build_object(
                'started', count(distinct w.device_id) filter (where w.name = 'sign_in_start'),
                'done',    count(distinct w.device_id) filter (where w.name = 'sign_in_done')),
            'primo', jsonb_build_object(
                'opened', count(distinct w.device_id) filter (where w.name = 'primo_open'),
                'set',    count(distinct w.device_id) filter (where w.name = 'primo_set'))
        ) from win w),

        -- LA TIENDITA, per item. `id` is a shelf key from js/tiendita.js CATALOG.
        'shop', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'item', t.item, 'buys', t.buys, 'devices', t.devices) order by t.buys desc)
              from (select left(coalesce(w.props->>'item', '?'), 24) as item,
                           count(*) as buys, count(distinct w.device_id) as devices
                      from win w where w.name = 'shop_buy'
                     group by 1 order by 2 desc limit 20) t
        ), '[]'::jsonb),

        -- THE CONTINUE LADDER. Which rung of 25·2ⁿ players actually pay at is a
        -- direct read on whether the doubling is priced right.
        'continues', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'taken_before', t.n, 'offers', t.offers, 'takes', t.takes) order by t.n)
              from (select case when jsonb_typeof(w.props->'n') = 'number'
                                then round((w.props->>'n')::numeric)::int else -1 end as n,
                           count(*) filter (where w.name = 'continue_offer') as offers,
                           count(*) filter (where w.name = 'continue_take')  as takes
                      from win w where w.name in ('continue_offer', 'continue_take')
                     group by 1 order by 1 limit 12) t
        ), '[]'::jsonb),

        -- ERRORS, split by build. That column is what turns "something broke"
        -- into "THIS deploy broke it".
        'errors', (select jsonb_build_object(
            'events',  count(*) filter (where w.name = 'client_error'),
            'devices', count(distinct w.device_id) filter (where w.name = 'client_error'),
            'top', coalesce((
                select jsonb_agg(jsonb_build_object(
                         'message', t.message, 'count', t.count, 'devices', t.devices,
                         'versions', t.versions) order by t.count desc)
                  from (select left(coalesce(w2.props->>'message', '?'), 140) as message,
                               count(*) as count,
                               count(distinct w2.device_id) as devices,
                               to_jsonb((array_agg(distinct coalesce(w2.app_version, '?')))[1:4]) as versions
                          from win w2 where w2.name = 'client_error'
                         group by 1 order by 2 desc limit 30) t), '[]'::jsonb)
        ) from win w),

        -- WHO IS RUNNING WHAT. Under a prompt-mode service worker every other
        -- panel is unreadable without this one.
        'versions', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'version', t.version, 'devices', t.devices, 'events', t.events)
                     order by t.devices desc)
              from (select coalesce(left(w.app_version, 32), '?') as version,
                           count(distinct w.device_id) as devices, count(*) as events
                      from win w group by 1 order by 2 desc limit 20) t
        ), '[]'::jsonb)
    ) into result;

    return result;
end; $$;

revoke all on function public.primos_admin_analytics(integer) from public, anon;
grant execute on function public.primos_admin_analytics(integer) to authenticated, service_role;


-- ==========================================
-- RETENTION PRUNING.
--
-- Deliberately NOT scheduled from inside this migration. A migration that
-- silently starts deleting production rows on a timer is a bad surprise; a
-- visible ops job is the right home for it. See docs/ANALYTICS.md.
-- ==========================================
create or replace function public.primos_prune_events(keep_days integer default 90)
returns bigint language plpgsql security definer
set search_path = public, pg_temp as $$
declare removed bigint;
begin
    delete from public.primos_events
     where created_at < now() - make_interval(days => greatest(keep_days, 1));
    get diagnostics removed = row_count;
    return removed;
end; $$;

revoke all on function public.primos_prune_events(integer) from public, anon, authenticated;
grant execute on function public.primos_prune_events(integer) to service_role;


-- ==========================================
-- SELF-CHECK. Refuse to leave this file in a state where the event log is
-- readable — the one mistake that cannot be walked back, because by the time it
-- is noticed the log has already been dumpable for however long it took.
-- ==========================================
do $$
begin
    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'primos_events' and cmd = 'SELECT'
    ) then
        raise exception
            'primos_events has a SELECT policy. The event log is append-only to '
            'every client, by design — read it through primos_admin_analytics().';
    end if;
end $$;
