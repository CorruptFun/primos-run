-- ============================================================================
-- 20260731190000_primos_feedback.sql
-- The suggestion box: player-written bug reports and requests for PRIMOS:
-- BARRIO RUN.
--
-- The client half is js/feedback.js, the UI is the Corrupt badge on the HELP
-- sheet (index.html #screen-help → #screen-feedback), and the read path is the
-- FEEDBACK panel on stats.html. docs/FEEDBACK.md is the write-up.
--
-- ⚠ TIMESTAMPED, like 20260731120000_primos_analytics.sql and for the same
-- reason. `version` is the primary key of supabase_migrations.schema_migrations
-- and that table is PER-PROJECT: Viva Maya and Turbo Maze already own versions
-- 0001–0022 in this project, so a hand-numbered `0004` here would be read as
-- already-applied and SKIPPED WITH A SUCCESS MESSAGE. Number anything new by
-- timestamp. Apply with `supabase db query --linked -f <file>`; `db push` does
-- not work from this repo (see CLAUDE.md).
--
-- ============================================================================
-- ⚠ EVERY OBJECT IS `primos_`-PREFIXED. Same rule as 0002 and the analytics
-- migration, same reason: this is a SHARED Supabase project. `feedback`,
-- `feedback_guard()` and `admin_feedback()` are exactly the names another game
-- in this project would reach for, and `create table if not exists` on a
-- collision QUIETLY DOES NOTHING while `create or replace function` on a
-- matching signature SILENTLY REPLACES someone else's. Neither says a word.
-- Keep every object in this file prefixed.
-- ============================================================================
--
-- SECURITY MODEL, stated plainly — it is the analytics model with one addition:
--   · APPEND-ONLY TO EVERY CLIENT. An INSERT policy and NO SELECT POLICY, EVER.
--     Free text typed by one player is worse to leak than the event log: it is
--     the only table in this project where a player can put a sentence about
--     themselves, and some of them will. The self-check at the bottom refuses to
--     apply this file if a select policy exists.
--   · Reads go through ONE admin-gated SECURITY DEFINER RPC. Unlike
--     primos_admin_analytics that RPC returns RAW ROWS — reading the sentence is
--     the entire point of a suggestion box — which is exactly why the table
--     itself must never be readable.
--   · RATE LIMITED IN THE GUARD. This is the addition. Every other write path in
--     this project is bounded by what an honest client would send; a free-text
--     box on a public origin with a publishable key is a spam target, and the
--     only place a limit cannot be bypassed is the database.
--
-- Idempotent-friendly: safe to re-run.
-- ============================================================================


-- ==========================================
-- WHAT A REPORT IS
-- ==========================================
create table if not exists public.primos_feedback (
    id          bigint generated always as identity primary key,

    -- The same anonymous localStorage UUID js/analytics.js mints, so a report
    -- can be read next to what that device actually did. NOT NULL and not
    -- optional: it is also the rate-limit key, and an unattributable row cannot
    -- be limited at all. js/feedback.js discloses it in the UI rather than
    -- making it silent.
    device_id   uuid not null,

    -- Only while signed in. The policy below pins it to auth.uid().
    user_id     uuid references auth.users(id) on delete set null,

    -- 'bug' | 'idea' | 'other'. TEXT rather than an enum for the PWA reason:
    -- cached clients keep sending last month's vocabulary for weeks, and the
    -- guard buckets an unknown value rather than rejecting a real report.
    kind        text not null default 'other',

    -- What they actually wrote. The whole reason this table exists.
    message     text not null,

    -- Optional and PLAYER-TYPED. ⚠ NEVER derived from the account email — the
    -- same rule as the display name, for the same reason: a contact field that
    -- fills itself in from auth publishes an address the player never chose to
    -- give. js/feedback.js leaves it empty and says what it is for.
    contact     text,

    -- Small bag of "what was happening": screen, score, best, runs, whether
    -- they were mid-run. A bug report without it costs a round trip that a solo
    -- owner will not get, because the player has already closed the tab.
    context     jsonb not null default '{}'::jsonb,

    app_version text,
    lang        text,

    -- The triage lane. Client-settable is not a thing: the guard forces 'new'
    -- on insert and only primos_admin_feedback_status() moves it.
    status      text not null default 'new',
    admin_note  text,

    -- Idempotency key, minted client-side. NULLABLE with a FULL (not partial)
    -- unique index — same shape and same reasoning as primos_events.event_id.
    -- Here it also means the SEND button is safe to press twice on a flaky
    -- connection, which is precisely when a player presses it twice.
    feedback_id uuid,

    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists primos_feedback_created_at
    on public.primos_feedback (created_at desc);
create index if not exists primos_feedback_status_created_at
    on public.primos_feedback (status, created_at desc);
-- The rate-limit lookup runs on EVERY insert, so it gets its own index.
create index if not exists primos_feedback_device_created_at
    on public.primos_feedback (device_id, created_at desc);
create unique index if not exists primos_feedback_feedback_id
    on public.primos_feedback (feedback_id);

alter table public.primos_feedback enable row level security;

-- THE MOST IMPORTANT LINES IN THIS FILE: an INSERT policy, and no SELECT
-- policy. `user_id is null` admits the signed-out majority — most players who
-- hit a glitch have never signed in — and `auth.uid() = user_id` stops one
-- player filing a report under another's name.
drop policy if exists "Anyone can file their own feedback" on public.primos_feedback;
create policy "Anyone can file their own feedback"
    on public.primos_feedback for insert
    with check (user_id is null or auth.uid() = user_id);

-- Clients may only ever append. Without these revokes the default grants leave
-- UPDATE/DELETE reachable the moment anyone adds a select policy — and UPDATE
-- on this table is how a player would edit their own report's `status` to
-- 'done' and bury it.
revoke update, delete on table public.primos_feedback from anon, authenticated;


-- ==========================================
-- THE GUARD — bound what an untrusted client can put in a row, and how often.
--
-- ⚠ THIS ONE THROWS, DELIBERATELY, WHERE primos_events_guard() DEGRADES.
--
-- The analytics guard must never raise: its error would surface inside a fetch
-- that sits next to the game loop, and a lost metric is cheaper than a lost run.
-- This one is called from a button the player pressed on purpose and is WAITING
-- ON, with a status line under it. Silently dropping a report the player was
-- told was sent is the worse failure here, so an unsendable row gets an error
-- the client can render as a sentence.
--
-- The `PTxyz` SQLSTATEs are PostgREST's convention for choosing the HTTP status
-- (PT429 → 429, PT400 → 400). js/feedback.js reads the STATUS CODE, not the
-- body, and treats anything it does not recognise as a plain failure — so the
-- mapping being unavailable would cost the specific wording and nothing else.
-- ==========================================
create or replace function public.primos_feedback_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
    recent_hour integer;
    recent_day  integer;
begin
    -- Dedupe FIRST, before the rate limit. A retry of a report that already
    -- landed must not be counted against the player who is retrying it —
    -- otherwise a flaky connection spends someone's whole hourly allowance on
    -- one message, and the report they actually wanted to send is the one that
    -- gets refused.
    if new.feedback_id is not null
       and exists (select 1 from public.primos_feedback f
                    where f.feedback_id = new.feedback_id) then
        return null;   -- already have it; drop silently, the client sees 201
    end if;

    -- Normalise the lane. Anything unrecognised becomes 'other' rather than a
    -- rejection: a cached client sending a kind this build has never heard of is
    -- still a player telling you something.
    new.kind := lower(trim(coalesce(new.kind, '')));
    if new.kind not in ('bug', 'idea', 'other') then
        new.kind := 'other';
    end if;

    -- The message. Trimmed, capped, and REQUIRED to be a sentence — an empty or
    -- one-character body is a mis-tap, and a suggestion box full of "a" is a
    -- suggestion box nobody opens.
    new.message := left(trim(coalesce(new.message, '')), 1000);
    if length(new.message) < 4 then
        raise exception 'feedback message is empty' using errcode = 'PT400';
    end if;

    new.contact := nullif(left(trim(coalesce(new.contact, '')), 80), '');

    -- Context must be a bounded JSON OBJECT. A client can send an array, a
    -- scalar, or a megabyte of nonsense; none of those may land, and none of
    -- them is worth losing the message over.
    if jsonb_typeof(new.context) is distinct from 'object'
       or length(new.context::text) > 1024 then
        new.context := '{}'::jsonb;
    end if;

    new.app_version := left(nullif(trim(coalesce(new.app_version, '')), ''), 32);
    new.lang        := left(nullif(trim(coalesce(new.lang, '')), ''), 8);

    -- The triage lane belongs to the owner, not to the sender. Forced here so
    -- no client can file a report pre-marked 'done' and out of the queue.
    new.status     := 'new';
    new.admin_note := null;

    -- The client NEVER chooses when. Every window below is keyed on this, the
    -- rate limit included — a forged timestamp would walk straight past it.
    new.created_at := now();
    new.updated_at := new.created_at;

    -- ---- the rate limit -------------------------------------------------
    -- Per DEVICE, which is the only identity a signed-out player has. Someone
    -- determined can clear localStorage and get a fresh allowance; that is true
    -- of every client-held id and is not what this is for. This stops the
    -- ordinary cases — a stuck retry loop, a bored player, a script that found
    -- an open POST endpoint — from filling the table faster than one person can
    -- read it.
    select count(*) into recent_hour
      from public.primos_feedback f
     where f.device_id = new.device_id
       and f.created_at > now() - interval '1 hour';
    if recent_hour >= 5 then
        raise exception 'too many reports from this device in the last hour'
            using errcode = 'PT429';
    end if;

    select count(*) into recent_day
      from public.primos_feedback f
     where f.device_id = new.device_id
       and f.created_at > now() - interval '24 hours';
    if recent_day >= 20 then
        raise exception 'too many reports from this device today'
            using errcode = 'PT429';
    end if;

    return new;
end; $$;

drop trigger if exists primos_feedback_guard on public.primos_feedback;
create trigger primos_feedback_guard before insert on public.primos_feedback
    for each row execute function public.primos_feedback_guard();


-- ==========================================
-- THE ADMIN ALLOW-LIST.
--
-- The SAME table the analytics migration creates, repeated here `if not exists`
-- and byte-identical so this file can be applied on its own — a migration that
-- only works if you happened to apply another one first is a migration that
-- fails at 2am. Re-running it against the existing table is a no-op.
--
-- RLS on, ZERO policies: the API can neither read nor write it in any role.
-- Membership is granted only from the SQL editor. A row here is a person.
-- ==========================================
create table if not exists public.primos_app_admins (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    note       text,
    created_at timestamptz not null default now()
);
alter table public.primos_app_admins enable row level security;
revoke all on table public.primos_app_admins from public, anon, authenticated;


-- ==========================================
-- THE READ PATH — one RPC, admin- or service-role-gated.
--
-- Returns RAW ROWS, which is the one place this file departs from the analytics
-- design on purpose: an aggregate of a suggestion box tells you how many people
-- wrote in and nothing about what they said. That is also why the table itself
-- has no select policy — the sentence is exactly the thing that must not be
-- readable by anyone but the owner.
-- ==========================================
create or replace function public.primos_admin_feedback(
    p_days   integer default 30,
    p_status text    default null,
    p_limit  integer default 200
)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
    d      integer := least(greatest(coalesce(p_days, 30), 1), 3650);
    lim    integer := least(greatest(coalesce(p_limit, 200), 1), 500);
    -- null (or anything unrecognised) means "every lane", which is what the
    -- dashboard asks for on first paint.
    st     text := lower(nullif(trim(coalesce(p_status, '')), ''));
    since  timestamptz;
    jwt_role text := coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
    result jsonb;
begin
    -- An admin, or the service_role JWT. 42501 specifically, so the dashboard
    -- can tell "you are not an admin" from "this is broken" — they need
    -- completely different screens.
    if jwt_role is distinct from 'service_role'
       and (auth.uid() is null
            or not exists (select 1 from public.primos_app_admins a
                            where a.user_id = auth.uid())) then
        raise exception 'primos_admin_feedback is admin-only' using errcode = '42501';
    end if;

    if st is not null and st not in ('new', 'triaged', 'done', 'spam') then
        st := null;
    end if;

    since := now() - make_interval(days => d);

    with
    win as (
        select * from public.primos_feedback where created_at >= since
    ),
    -- How many reports this device has EVER filed. The triage signal that is
    -- worth the join: one person's tenth message reads differently from ten
    -- people's first, and the raw list cannot show you which you are holding.
    per_device as (
        select device_id, count(*) as reports
          from public.primos_feedback group by 1
    ),
    picked as (
        select w.*, coalesce(p.reports, 1) as device_reports
          from win w left join per_device p using (device_id)
         where st is null or w.status = st
         order by w.created_at desc
         limit lim
    )
    select jsonb_build_object(
        'meta', jsonb_build_object(
            'days', d, 'status', st, 'limit', lim,
            'since', since, 'generated_at', now(),
            -- So the dashboard can say "showing 200 of 431" rather than
            -- implying the list it is holding is all there is.
            'matched', (select count(*) from win w
                         where st is null or w.status = st)),

        -- The queue at a glance, ALWAYS over the full window and never over the
        -- filtered slice — the count of what is still unread must not change
        -- because you are currently looking at 'done'.
        'counts', (select jsonb_build_object(
            'total',   count(*),
            'new',     count(*) filter (where w.status = 'new'),
            'triaged', count(*) filter (where w.status = 'triaged'),
            'done',    count(*) filter (where w.status = 'done'),
            'spam',    count(*) filter (where w.status = 'spam'),
            'devices', count(distinct w.device_id)
        ) from win w),

        'kinds', coalesce((
            select jsonb_agg(jsonb_build_object('kind', t.kind, 'reports', t.reports)
                             order by t.reports desc)
              from (select w.kind, count(*) as reports from win w group by 1) t
        ), '[]'::jsonb),

        'rows', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', p.id,
                     'kind', p.kind,
                     'message', p.message,
                     'contact', p.contact,
                     'context', p.context,
                     'app_version', p.app_version,
                     'lang', p.lang,
                     'status', p.status,
                     'admin_note', p.admin_note,
                     'signed_in', p.user_id is not null,
                     -- The first 8 characters only. Enough to see that three
                     -- reports came from one device, useless for anything else,
                     -- and it keeps a full device id off a screen that gets
                     -- screenshotted.
                     'device', left(p.device_id::text, 8),
                     'device_reports', p.device_reports,
                     'created_at', p.created_at) order by p.created_at desc)
              from picked p
        ), '[]'::jsonb)
    ) into result;

    return result;
end; $$;

revoke all on function public.primos_admin_feedback(integer, text, integer) from public, anon;
grant execute on function public.primos_admin_feedback(integer, text, integer)
    to authenticated, service_role;


-- ==========================================
-- THE TRIAGE WRITE — the one way a row's status ever moves.
--
-- A suggestion box you cannot mark as read is a suggestion box you stop opening:
-- the second visit shows the same thirty messages as the first and there is no
-- way to tell which are new. That is the whole failure mode this function
-- exists to prevent, and it is why the status column is not decoration.
-- ==========================================
create or replace function public.primos_admin_feedback_status(
    p_id     bigint,
    p_status text,
    p_note   text default null
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
    st text := lower(trim(coalesce(p_status, '')));
    jwt_role text := coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
    updated public.primos_feedback%rowtype;
begin
    if jwt_role is distinct from 'service_role'
       and (auth.uid() is null
            or not exists (select 1 from public.primos_app_admins a
                            where a.user_id = auth.uid())) then
        raise exception 'primos_admin_feedback_status is admin-only' using errcode = '42501';
    end if;

    if st not in ('new', 'triaged', 'done', 'spam') then
        raise exception 'status must be new, triaged, done or spam' using errcode = 'PT400';
    end if;

    update public.primos_feedback
       set status     = st,
           admin_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
           updated_at = now()
     where id = p_id
    returning * into updated;

    if not found then
        raise exception 'no such feedback row' using errcode = 'PT404';
    end if;

    return jsonb_build_object('id', updated.id, 'status', updated.status,
                              'admin_note', updated.admin_note);
end; $$;

revoke all on function public.primos_admin_feedback_status(bigint, text, text)
    from public, anon;
grant execute on function public.primos_admin_feedback_status(bigint, text, text)
    to authenticated, service_role;


-- ==========================================
-- RETENTION PRUNING.
--
-- Deliberately NOT scheduled from inside this migration, same as
-- primos_prune_events — a migration that silently starts deleting production
-- rows on a timer is a bad surprise.
--
-- The default keeps a YEAR, not the events table's 90 days: an event is a data
-- point and a report is someone's sentence, and "we shipped the thing you asked
-- for" is worth being able to say a year later.
-- ==========================================
create or replace function public.primos_prune_feedback(keep_days integer default 365)
returns bigint language plpgsql security definer
set search_path = public, pg_temp as $$
declare removed bigint;
begin
    delete from public.primos_feedback
     where created_at < now() - make_interval(days => greatest(keep_days, 1))
       -- Never prune what has not been read. A queue that empties itself is a
       -- queue that loses the one report nobody got to.
       and status <> 'new';
    get diagnostics removed = row_count;
    return removed;
end; $$;

revoke all on function public.primos_prune_feedback(integer) from public, anon, authenticated;
grant execute on function public.primos_prune_feedback(integer) to service_role;


-- ==========================================
-- SELF-CHECK. Refuse to leave this file in a state where one player can read
-- another's message — the one mistake here that cannot be walked back, because
-- by the time it is noticed the box has already been dumpable for however long
-- it took to notice.
-- ==========================================
do $$
begin
    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'primos_feedback' and cmd = 'SELECT'
    ) then
        raise exception
            'primos_feedback has a SELECT policy. The suggestion box is append-only '
            'to every client, by design — read it through primos_admin_feedback().';
    end if;
end $$;
