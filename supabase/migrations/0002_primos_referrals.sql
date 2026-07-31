-- ============================================================================
-- 0002_primos_referrals.sql
-- Invite a friend → they actually run the alley → both sides get chelas.
-- Two tables + RLS + a guard trigger + one lookup function.
--
-- FLOW: every signed-in player mints one short code (primos_referral_codes).
-- The invite link carries ?ref=CODE; the friend's client stashes it at boot and,
-- after Google sign-in, inserts its own primos_referrals row (one per account,
-- EVER — the PK). When the friend's best run passes the qualify score their
-- client stamps qualified_at; the referrer's client later finds
-- qualified-unclaimed rows, plays the reward moment, grants chelas locally and
-- stamps claimed_at.
--
-- TABLE NAMES ARE GAME-PREFIXED (`primos_*`), AND HERE THAT IS LOAD-BEARING IN A
-- WAY IT WAS NOT IN 0001. Viva Maya already owns UNPREFIXED `public.referral_codes`,
-- `public.referrals` and `public.resolve_referral_code()` in this same Supabase
-- project. The prefix collision would NOT have announced itself:
--
--   · `create table if not exists public.referral_codes` finds Viva Maya's table
--     already there and QUIETLY DOES NOTHING — no error, migration "succeeds",
--     and Primos then reads and writes Viva Maya's live referral table. Two
--     games would share one code namespace and one player's invites.
--   · `create or replace function public.resolve_referral_code(text)` has a
--     matching signature, so it would REPLACE Viva Maya's working function
--     rather than fail.
--
-- That is strictly worse than the 42P13 abort `primos_anon_display_name` hit in
-- 0001, because nothing anywhere would have said a word. Keep every object in
-- this file prefixed.
--
-- SINGLE MIGRATION, ALREADY HARDENED — deliberately unlike Viva Maya, which
-- needed 0004 → 0008 → 0009 to get here. Its `referral_codes` shipped with
-- `for select using (true)`, so anyone holding the publishable key (i.e. every
-- visitor, it ships in the client) could dump every invite code alongside its
-- owner's auth UUID. Closing that took two migrations *sequenced around a client
-- deploy*, because tightening the policy while an old cached PWA client was
-- still resolving codes by direct SELECT would have made real codes look dead —
-- and a dead code is treated as a DEFINITIVE rejection, so the stash is cleared
-- and the referral destroyed rather than retried.
--
-- Primos has no such legacy: no client has ever resolved a code here, so there
-- is no cached bundle to sequence around. The hole therefore never has to exist
-- in the first place — the table is own-rows-only from the first day and
-- resolving somebody else's code goes exclusively through the SECURITY DEFINER
-- function below. Do not add a permissive select policy to "make it work"; the
-- function is how it works.
--
-- TRUST MODEL, stated plainly (consistent with the board in 0001): clients
-- self-report, RLS confines every writer to its own lane, the guard trigger
-- makes timestamps set-once and identity columns immutable, and the schema
-- blocks self-referral and double-referral outright. Qualification requires a
-- real run rather than a click, and the lifetime cap keeps farming unprofitable
-- at the scale this game is played at. A referral is worth a couple of good
-- runs' chelas, so the prize for defeating all of it is small by construction.
--
-- Idempotent-friendly: safe to re-run.
-- ============================================================================


-- ==========================================
-- TABLE: public.primos_referral_codes — one short code per user.
--
-- The code is the PK, so collisions are refused by the database rather than
-- hoped away; the client retries a fresh code on 23505. `user_id` is UNIQUE so
-- a player can never end up with two codes, which is what makes "get or create"
-- safe to race from two devices.
-- ==========================================
create table if not exists public.primos_referral_codes (
    code       text primary key check (code ~ '^[A-Z0-9]{6}$'),
    user_id    uuid unique not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.primos_referral_codes enable row level security;

-- OWN ROW ONLY. This is all `mintMyCode` needs — it reads back the caller's own
-- code by user_id. Resolving SOMEBODY ELSE's code is not a table read at all; it
-- goes through primos_resolve_referral_code() at the bottom of this file.
drop policy if exists "Users read own code" on public.primos_referral_codes;
create policy "Users read own code"
    on public.primos_referral_codes for select
    using (auth.uid() = user_id);

drop policy if exists "Users mint own code" on public.primos_referral_codes;
create policy "Users mint own code"
    on public.primos_referral_codes for insert
    with check (auth.uid() = user_id);
-- (no UPDATE/DELETE policies → codes are immutable by deny-by-default. A code
-- that could be reassigned would silently redirect invite links already sent.)


-- ==========================================
-- TABLE: public.primos_referrals — one row per referred account, EVER.
--
-- The PK is the REFEREE, not a surrogate id, and that single choice is what
-- makes "you can only ever be referred once" a database guarantee instead of a
-- client convention. Re-installing the game, clearing storage or following a
-- second invite link all collide with the same row.
-- ==========================================
create table if not exists public.primos_referrals (
    referee_user_id  uuid primary key references auth.users(id) on delete cascade,
    referrer_user_id uuid not null references auth.users(id) on delete cascade,
    created_at       timestamptz not null default now(),
    -- Stamped by the REFEREE's client once their best run passes the qualify
    -- score (QUALIFY_SCORE in js/referrals.js).
    qualified_at     timestamptz,
    -- Stamped by the REFERRER's client after the reward moment is played.
    claimed_at       timestamptz,
    constraint primos_no_self_referral check (referee_user_id <> referrer_user_id)
);

-- The referrer-side query shape: "my rows, which are qualified, which unclaimed".
create index if not exists primos_referrals_by_referrer
    on public.primos_referrals (referrer_user_id, qualified_at, claimed_at);

alter table public.primos_referrals enable row level security;

-- The referee creates their own single row; both parties may read their own side.
drop policy if exists "Referee inserts own referral" on public.primos_referrals;
create policy "Referee inserts own referral"
    on public.primos_referrals for insert
    with check (auth.uid() = referee_user_id);

drop policy if exists "Parties read own referrals" on public.primos_referrals;
create policy "Parties read own referrals"
    on public.primos_referrals for select
    using (auth.uid() = referee_user_id or auth.uid() = referrer_user_id);

-- Updates: the referee may stamp qualified_at, the referrer may stamp claimed_at
-- and only once the row is qualified. WHICH COLUMN each side is allowed to touch
-- is not expressible in a policy — that is the guard trigger's job below.
drop policy if exists "Referee qualifies own referral" on public.primos_referrals;
create policy "Referee qualifies own referral"
    on public.primos_referrals for update
    using (auth.uid() = referee_user_id)
    with check (auth.uid() = referee_user_id);

drop policy if exists "Referrer claims qualified referral" on public.primos_referrals;
create policy "Referrer claims qualified referral"
    on public.primos_referrals for update
    using (auth.uid() = referrer_user_id and qualified_at is not null)
    with check (auth.uid() = referrer_user_id);
-- (no DELETE policy → a referral cannot be dropped and re-earned.)


-- ==========================================
-- THE GUARD. Identity columns frozen; both timestamps set-once, server-clocked
-- and ORDERED (a claim requires a qualification that already happened).
--
-- The policies above decide WHO may write the row; this decides WHAT a write is
-- allowed to change. Without it the referee — who legitimately holds UPDATE on
-- their own row — could rewrite referrer_user_id to point the reward at an
-- account they also own, or stamp claimed_at themselves.
--
-- Server clock, always: `now()` overwrites whatever the client sent, so a
-- forward-set clock cannot fabricate a qualification date and the ordering below
-- cannot be defeated by lying about when something happened.
-- ==========================================
create or replace function public.primos_referrals_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
    -- Identity and creation are frozen — the only columns anyone may move are
    -- the two timestamps, and only in one direction.
    new.referee_user_id  := old.referee_user_id;
    new.referrer_user_id := old.referrer_user_id;
    new.created_at       := old.created_at;

    -- qualified_at: set-once, server time, never cleared.
    if old.qualified_at is not null then
        new.qualified_at := old.qualified_at;
    elsif new.qualified_at is not null then
        new.qualified_at := now();
    end if;

    -- claimed_at: set-once, server time, and only after qualification. Nulling
    -- it rather than raising keeps the update a no-op the client simply retries
    -- later, which is the honest outcome for a friend who has not played yet.
    if old.claimed_at is not null then
        new.claimed_at := old.claimed_at;
    elsif new.claimed_at is not null then
        if old.qualified_at is null then
            new.claimed_at := null;
        else
            new.claimed_at := now();
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists primos_referrals_guard on public.primos_referrals;
create trigger primos_referrals_guard
    before update on public.primos_referrals
    for each row execute function public.primos_referrals_guard();


-- ==========================================
-- FUNCTION: primos_resolve_referral_code(code) -> the owner's user_id, or NULL.
--
-- The ONLY way to turn somebody else's code into an account, and the reason the
-- table above can stay own-rows-only. SECURITY DEFINER so it reads a table the
-- caller cannot, with search_path PINNED — an unpinned definer function is
-- hijackable through a caller-controlled search_path, the standard Postgres
-- footgun.
--
-- STABLE, not VOLATILE: it only reads, so the planner may cache it within a
-- statement.
--
-- Normalizes EXACTLY as the client does (`raw.trim().toUpperCase()` in
-- js/referrals.js) so a code pasted with stray whitespace or in lower case
-- resolves instead of looking dead. Those two normalizations must not drift.
--
-- HONEST LIMIT: this is still a lookup oracle — it answers "is this code real"
-- one guess at a time. That is a deliberate, enormous improvement over handing
-- over the whole table, not a claim of perfection. The keyspace is 36^6 ≈ 2.2
-- billion and EXECUTE is granted to `authenticated` only, so an attacker must
-- hold an account and brute-force one code at a time to win chelas worth about
-- two runs. If that ever stops being acceptable the next step is a rate limit or
-- an attempt ledger, not a different function shape.
-- ==========================================
create or replace function public.primos_resolve_referral_code(p_code text)
returns uuid language sql security definer set search_path = public, pg_temp stable as $$
    select user_id
      from public.primos_referral_codes
     where code = upper(trim(p_code))
     limit 1;
$$;

-- Anonymous visitors have no reason to resolve a code: the client only ever
-- resolves one at sign-in, by which point it is authenticated.
revoke all on function public.primos_resolve_referral_code(text) from public, anon;
grant execute on function public.primos_resolve_referral_code(text) to authenticated;
