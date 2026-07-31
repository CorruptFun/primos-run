-- ============================================================================
-- The suggestion box — server half.
--
-- A write-only table, a guard that bounds AND rate-limits, an admin-gated read
-- RPC that returns raw rows, a status RPC, a prune, and a self-check.
--
-- 👉 ADAPT: replace the `app_` prefix throughout with your project's own. If
--    this database is shared with sibling projects the prefix is not style, it
--    is the whole safety — `create table if not exists public.feedback` finds a
--    sibling's table and QUIETLY DOES NOTHING, and `create or replace function`
--    on a matching signature SILENTLY REPLACES theirs. Neither says a word.
--
-- 👉 ADAPT: `app_admins` may already exist from an analytics stack. It is
--    created `if not exists` here so this file can be applied on its own — a
--    migration that only works if you happened to apply another one first is a
--    migration that fails at 2am.
--
-- Idempotent-friendly: safe to re-run.
-- ============================================================================


-- ==========================================
-- WHAT A REPORT IS
-- ==========================================
create table if not exists public.app_feedback (
    id          bigint generated always as identity primary key,

    -- The rate-limit key, and the only identity an anonymous user has. A random
    -- UUID minted once in local storage — NOT a fingerprint. NOT NULL, because
    -- an unattributable row cannot be limited at all. If an analytics stack
    -- already mints one of these, REUSE IT: a second id costs the ability to
    -- read a report next to what that user did and buys no privacy.
    device_id   uuid not null,

    -- Only while signed in. The policy below pins it to auth.uid().
    user_id     uuid references auth.users(id) on delete set null,

    -- TEXT, not an enum: cached clients keep sending last month's vocabulary
    -- for weeks, and the guard buckets an unknown value rather than rejecting a
    -- real report.
    kind        text not null default 'other',

    -- What they wrote. The whole reason this table exists.
    message     text not null,

    -- Optional and USER-TYPED. ⚠ NEVER derived from the account email — an
    -- address they did not type is one they did not agree to hand over.
    contact     text,

    -- What was happening: screen, version, viewport, whatever "where were they"
    -- means here. The client bounds this field by field; the guard is only the
    -- backstop, because replacing an oversized bag with {} loses every field
    -- rather than the offending one.
    context     jsonb not null default '{}'::jsonb,

    app_version text,
    locale      text,

    -- The triage lane. Client-settable is not a thing — see the guard.
    status      text not null default 'new',
    admin_note  text,

    -- Idempotency key, minted client-side. NULLABLE with a FULL (not partial)
    -- unique index: id-less rows from older clients insert forever because NULLs
    -- never collide, and a partial index would silently disable `on conflict`
    -- inference later. This is what makes the SEND button safe to press twice on
    -- a flaky connection — which is exactly when people press it twice.
    feedback_id uuid,

    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists app_feedback_created_at
    on public.app_feedback (created_at desc);
create index if not exists app_feedback_status_created_at
    on public.app_feedback (status, created_at desc);
-- The rate-limit lookup runs on EVERY insert, so it gets its own index.
create index if not exists app_feedback_device_created_at
    on public.app_feedback (device_id, created_at desc);
create unique index if not exists app_feedback_feedback_id
    on public.app_feedback (feedback_id);

alter table public.app_feedback enable row level security;

-- THE MOST IMPORTANT LINES IN THIS FILE: an INSERT policy, and no SELECT
-- policy. `user_id is null` admits the signed-out majority — most people who
-- hit a bug have never signed in — and `auth.uid() = user_id` stops one user
-- filing a report under another's name.
drop policy if exists "Anyone can file their own feedback" on public.app_feedback;
create policy "Anyone can file their own feedback"
    on public.app_feedback for insert
    with check (user_id is null or auth.uid() = user_id);

-- Clients may only ever append. Without these revokes the default grants leave
-- UPDATE/DELETE reachable the moment anyone adds a select policy — and UPDATE
-- here is how someone would set their own report's status to 'done' and bury it.
revoke update, delete on table public.app_feedback from anon, authenticated;


-- ==========================================
-- THE GUARD — bound what an untrusted client can send, and how often.
--
-- ⚠ THIS ONE THROWS. If this project also has an analytics guard, that one must
-- never raise (its error lands in a fire-and-forget fetch next to the hot path).
-- Invert it here: this runs behind a button the user pressed and is watching a
-- status line for, so silently dropping a report you told them was sent is the
-- worse failure.
--
-- `PTxyz` is PostgREST's convention for choosing the HTTP status (PT429 → 429,
-- PT400 → 400). The client reads the STATUS CODE, never the body, so losing
-- that mapping costs the specific wording and not the box.
--
-- ORDER IS LOAD-BEARING: bound → dedupe → rate-limit.
-- ==========================================
create or replace function public.app_feedback_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
    recent_hour integer;
    recent_day  integer;
begin
    -- Dedupe FIRST, before the rate limit. A retry of a report that already
    -- landed must not be counted against the person retrying it — otherwise one
    -- flaky connection spends the whole hourly allowance on a message that is
    -- already stored, and the report they actually wanted to send is refused.
    if new.feedback_id is not null
       and exists (select 1 from public.app_feedback f
                    where f.feedback_id = new.feedback_id) then
        return null;   -- already have it; drop silently, the client sees 201
    end if;

    -- 👉 ADAPT the kind list. Keep it short and closed, and BUCKET rather than
    -- reject: someone telling you something in a category this build has never
    -- heard of is still someone telling you something.
    new.kind := lower(trim(coalesce(new.kind, '')));
    if new.kind not in ('bug', 'idea', 'other') then
        new.kind := 'other';
    end if;

    -- The message. Trimmed, capped, and REQUIRED to be a sentence — an empty or
    -- one-character body is a mis-tap, and a box full of "a" is a box nobody
    -- opens.
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
    new.locale      := left(nullif(trim(coalesce(new.locale, '')), ''), 8);

    -- The triage lane belongs to the owner, not the sender. Forced here so no
    -- client can file a report pre-marked 'done' and out of the queue.
    new.status     := 'new';
    new.admin_note := null;

    -- The client NEVER chooses when. Every window below is keyed on this, the
    -- rate limit included — a forged timestamp walks straight past it.
    new.created_at := now();
    new.updated_at := new.created_at;

    -- ---- the rate limit -------------------------------------------------
    -- ⚠ THE CLIENT'S LIMIT IS A COURTESY. This is the control: an open POST
    -- endpoint that accepts prose is a spam target, and anyone can skip a
    -- client-side limit by not being the client.
    --
    -- Someone determined can clear local storage for a fresh allowance; that is
    -- true of every client-held id and is not what this is for. This stops the
    -- ordinary cases — a stuck retry loop, a bored user, a script that found an
    -- open endpoint — from filling the table faster than one person can read it.
    select count(*) into recent_hour
      from public.app_feedback f
     where f.device_id = new.device_id
       and f.created_at > now() - interval '1 hour';
    if recent_hour >= 5 then
        raise exception 'too many reports from this device in the last hour'
            using errcode = 'PT429';
    end if;

    select count(*) into recent_day
      from public.app_feedback f
     where f.device_id = new.device_id
       and f.created_at > now() - interval '24 hours';
    if recent_day >= 20 then
        raise exception 'too many reports from this device today'
            using errcode = 'PT429';
    end if;

    return new;
end; $$;

drop trigger if exists app_feedback_guard on public.app_feedback;
create trigger app_feedback_guard before insert on public.app_feedback
    for each row execute function public.app_feedback_guard();


-- ==========================================
-- THE ADMIN ALLOW-LIST.
-- RLS on, ZERO policies: the API can neither read nor write it in any role.
-- Membership is granted only from the SQL editor. A row here is a person.
-- ==========================================
create table if not exists public.app_admins (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    note       text,
    created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on table public.app_admins from public, anon, authenticated;


-- ==========================================
-- THE READ PATH — one RPC, admin- or service-role-gated.
--
-- Returns RAW ROWS. If this project has an analytics RPC, copy its GATE and not
-- its shape: an aggregate of a suggestion box says how many people wrote in and
-- nothing about what they said. That is exactly why the table has no select
-- policy — the sentence is the thing being protected, and this is the one door.
-- ==========================================
create or replace function public.app_admin_feedback(
    p_days   integer default 30,
    p_status text    default null,
    p_limit  integer default 200
)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
    d      integer := least(greatest(coalesce(p_days, 30), 1), 3650);
    lim    integer := least(greatest(coalesce(p_limit, 200), 1), 500);
    st     text := lower(nullif(trim(coalesce(p_status, '')), ''));
    since  timestamptz;
    jwt_role text := coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
    result jsonb;
begin
    -- 42501 specifically, so the admin page can tell "you are signed in but not
    -- an admin" from "this is broken". They need completely different screens.
    if jwt_role is distinct from 'service_role'
       and (auth.uid() is null
            or not exists (select 1 from public.app_admins a where a.user_id = auth.uid())) then
        raise exception 'app_admin_feedback is admin-only' using errcode = '42501';
    end if;

    if st is not null and st not in ('new', 'triaged', 'done', 'spam') then
        st := null;
    end if;

    since := now() - make_interval(days => d);

    with
    win as (select * from public.app_feedback where created_at >= since),
    -- How many reports this device has EVER filed. The triage signal worth the
    -- join: one person's tenth message reads differently from ten people's
    -- first, and the raw list cannot show you which you are holding.
    per_device as (select device_id, count(*) as reports from public.app_feedback group by 1),
    picked as (
        select w.*, coalesce(p.reports, 1) as device_reports
          from win w left join per_device p using (device_id)
         where st is null or w.status = st
         order by w.created_at desc
         limit lim
    )
    select jsonb_build_object(
        'meta', jsonb_build_object(
            'days', d, 'status', st, 'limit', lim, 'since', since, 'generated_at', now(),
            -- So the page can say "showing 200 of 431" rather than implying the
            -- list it is holding is all there is.
            'matched', (select count(*) from win w where st is null or w.status = st)),

        -- ALWAYS over the full window, never over the filtered slice: the count
        -- of what is still unread must not change because you are looking at
        -- 'done'.
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
                     'id', p.id, 'kind', p.kind, 'message', p.message, 'contact', p.contact,
                     'context', p.context, 'app_version', p.app_version, 'locale', p.locale,
                     'status', p.status, 'admin_note', p.admin_note,
                     'signed_in', p.user_id is not null,
                     -- The first 8 characters only. Enough to see three reports
                     -- came from one device, useless for anything else, and it
                     -- keeps a full id off a screen that gets screenshotted.
                     'device', left(p.device_id::text, 8),
                     'device_reports', p.device_reports,
                     'created_at', p.created_at) order by p.created_at desc)
              from picked p
        ), '[]'::jsonb)
    ) into result;

    return result;
end; $$;

revoke all on function public.app_admin_feedback(integer, text, integer) from public, anon;
grant execute on function public.app_admin_feedback(integer, text, integer)
    to authenticated, service_role;


-- ==========================================
-- THE TRIAGE WRITE — the one way a row's status ever moves.
--
-- A box you cannot mark as read shows the same thirty messages on every visit,
-- so by the third visit you stop opening it and the whole feature becomes a
-- table nobody reads. That is the failure this function exists to prevent, and
-- it is why `status` is infrastructure rather than metadata.
-- ==========================================
create or replace function public.app_admin_feedback_status(
    p_id bigint, p_status text, p_note text default null
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
    st text := lower(trim(coalesce(p_status, '')));
    jwt_role text := coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
    updated public.app_feedback%rowtype;
begin
    if jwt_role is distinct from 'service_role'
       and (auth.uid() is null
            or not exists (select 1 from public.app_admins a where a.user_id = auth.uid())) then
        raise exception 'app_admin_feedback_status is admin-only' using errcode = '42501';
    end if;

    if st not in ('new', 'triaged', 'done', 'spam') then
        raise exception 'status must be new, triaged, done or spam' using errcode = 'PT400';
    end if;

    update public.app_feedback
       set status = st,
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

revoke all on function public.app_admin_feedback_status(bigint, text, text) from public, anon;
grant execute on function public.app_admin_feedback_status(bigint, text, text)
    to authenticated, service_role;


-- ==========================================
-- RETENTION PRUNING. Deliberately NOT scheduled from inside the migration — a
-- migration that silently starts deleting production rows on a timer is a bad
-- surprise. A visible ops job is the right home.
--
-- Keeps a YEAR by default, not telemetry's 90 days: an event is a data point
-- and a report is somebody's sentence, and "we shipped the thing you asked for"
-- is worth being able to say a year later.
-- ==========================================
create or replace function public.app_prune_feedback(keep_days integer default 365)
returns bigint language plpgsql security definer
set search_path = public, pg_temp as $$
declare removed bigint;
begin
    delete from public.app_feedback
     where created_at < now() - make_interval(days => greatest(keep_days, 1))
       -- Never prune what has not been read. A queue that empties itself is a
       -- queue that loses the one report nobody got to.
       and status <> 'new';
    get diagnostics removed = row_count;
    return removed;
end; $$;

revoke all on function public.app_prune_feedback(integer) from public, anon, authenticated;
grant execute on function public.app_prune_feedback(integer) to service_role;


-- ==========================================
-- SELF-CHECK. Refuse to leave this file in a state where one user can read
-- another's message — the one mistake here that cannot be walked back, because
-- by the time it is noticed the box has already been dumpable for however long
-- it took to notice.
-- ==========================================
do $$
begin
    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'app_feedback' and cmd = 'SELECT'
    ) then
        raise exception
            'app_feedback has a SELECT policy. The box is append-only to every '
            'client, by design — read it through app_admin_feedback().';
    end if;
end $$;


-- ============================================================================
-- AUDIT IT LIVE. A migration proving itself locally is not the statement
-- "production is safe". Run these against the real API with the PUBLISHABLE key.
--
-- ⚠ PAIR EVERY "must be empty" ASSERTION WITH A CONTROL. `anon` holds the
-- ordinary SELECT *grant*, so PostgREST does not refuse — RLS filters every row
-- away and you get `[]`, which is byte-identical to what a table that does not
-- exist would give you if it gave you an array at all. The control probe is
-- what makes the empty answer mean something:
--
--   curl -s -H "apikey: $KEY" "$URL/rest/v1/table_that_does_not_exist?select=*"
--     → must ERROR (this is the control)
--   curl -s -H "apikey: $KEY" "$URL/rest/v1/app_feedback?select=message,contact"
--     → must be []   (RLS refused, and the control proves it is not absence)
--
--   POST /rest/v1/app_feedback  with `Prefer: return=minimal`  → 201
--   the same feedback_id again                                 → 201, ONE row
--   a message of "  "                                          → 400
--   six reports from one device_id inside an hour              → the 6th is 429
--   POST /rest/v1/rpc/app_admin_feedback                       → 401/403
--   POST /rest/v1/rpc/app_admin_feedback_status                → 401/403
--
-- ⚠ The rate-limit probe WRITES five rows, and they land marked 'new' — i.e. in
-- the owner's unread queue. Tag them (`app_version = 'verify'`) and clear them:
--   delete from public.app_feedback where app_version = 'verify';
-- ============================================================================
