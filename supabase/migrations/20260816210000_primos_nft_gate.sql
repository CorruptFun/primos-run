-- ============================================================================
-- 20260816210000_primos_nft_gate.sql
-- The NFT gate: you hold a Primo in a Solana wallet, or you do not get in.
--
-- The client half is js/gate.js, the UI is index.html #screen-gate, and the
-- verification itself runs in the Edge Function supabase/functions/primos-gate.
-- docs/NFT_GATE.md is the write-up.
--
-- ⚠ TIMESTAMPED, like every migration here since the analytics one, and for the
-- same reason: `version` is the primary key of
-- supabase_migrations.schema_migrations and that table is PER-PROJECT. Viva Maya
-- and Turbo Maze already own versions 0001–0022, so a hand-numbered `0005` here
-- would be read as already-applied and SKIPPED WITH A SUCCESS MESSAGE. Apply
-- with `supabase db query --linked -f <file>`; `db push` does not work from this
-- repo (see CLAUDE.md).
--
-- ============================================================================
-- ⚠ EVERY OBJECT IS `primos_`-PREFIXED. Same rule as every migration in this
-- directory, same reason: this is a SHARED Supabase project. `holders`,
-- `gate_nonces` and `is_holder()` are exactly the names another game here would
-- reach for, and `create table if not exists` on a collision QUIETLY DOES
-- NOTHING while `create or replace function` on a matching signature SILENTLY
-- REPLACES someone else's. Neither says a word.
-- ============================================================================
--
-- ⚠ THIS FILE IS THE ADDITIVE HALF, AND THAT SPLIT IS DELIBERATE.
--
-- It creates the tables and the helper and changes NO existing policy, so it is
-- safe to apply to a live project with the current, ungated client in the field.
-- The half that actually REFUSES a non-holder's board write is
-- 20260816210001_primos_gate_enforce_boards.sql, and it must not be applied
-- until the gated client has been live long enough for holders to have verified.
--
-- That ordering is the opposite of the usual "schema first, client second" rule
-- and it is the same lesson Viva Maya paid for with its 0008 → client deploy →
-- 0009 sequence: this is a RESTRICTING change, and tightening a policy under a
-- prompt-mode PWA that players keep running for days makes a legitimate action
-- look broken. Ship the client, let holders verify, then tighten.
--
-- ============================================================================
--
-- SECURITY MODEL, stated plainly:
--   · THE NONCE TABLE IS SERVICE-ROLE ONLY. RLS is on and there are NO policies
--     at all, so anon and authenticated are denied outright. Only the Edge
--     Function, holding the service-role key, ever reads or writes it. A client
--     that could mint or read its own nonces could replay somebody else's
--     signature, which is the whole attack this table exists to stop.
--   · A NONCE IS SINGLE-USE AND SHORT-LIVED. Verification claims it with an
--     atomic conditional update; a second attempt to use the same nonce finds
--     zero rows and is refused. Without that, a captured {wallet, nonce,
--     signature} triple is a reusable key to somebody else's wallet identity.
--   · A HOLDER MAY READ THEIR OWN ROW AND NOTHING ELSE. The table links a Google
--     identity to a Solana wallet address, which is a real-world identity join
--     on a public chain — the one thing in this project worth leaking least. No
--     blanket select policy, ever.
--   · OWNERSHIP IS NEVER ASSERTED BY THE CLIENT. `primo_count` is written only
--     by the Edge Function after it has checked the chain itself. Nothing a
--     browser sends is trusted here; that is the entire point of doing this
--     server-side rather than in js/gate.js.
--
-- Idempotent-friendly: safe to re-run.
-- ============================================================================


-- ==========================================
-- THE CHALLENGE
--
-- One row per issued nonce. The client asks for one, signs it with the wallet's
-- private key, and sends the signature back; the function checks the signature
-- against the claimed public key and then claims the nonce.
-- ==========================================
create table if not exists public.primos_gate_nonces (
    -- The nonce itself, as the function generated it. Text rather than uuid so
    -- the function is free to widen it later without a migration.
    nonce       text primary key,

    created_at  timestamptz not null default now(),

    -- Deliberately short. A challenge is signed within seconds of being issued;
    -- anything longer is only widening the window a captured one is useful in.
    expires_at  timestamptz not null,

    -- Stamped by the atomic claim below. A non-null value means spent.
    used_at     timestamptz,

    -- Which wallet spent it, for the audit trail. Null until claimed.
    wallet      text
);

-- The prune reads this, and so does the claim's expiry test.
create index if not exists primos_gate_nonces_expires_idx
    on public.primos_gate_nonces (expires_at);

alter table public.primos_gate_nonces enable row level security;

-- ⚠ NO POLICIES. Not an oversight — RLS with no policy denies every client,
-- which is exactly right for a table only the Edge Function may touch. The
-- self-check at the bottom refuses to apply this file if one ever appears.
revoke all on public.primos_gate_nonces from anon, authenticated;


-- ==========================================
-- WHO HOLDS WHAT
--
-- One row per wallet that has ever proved itself. `verified_at` is what makes
-- the row mean anything: holdings change the moment somebody sells, so a row
-- is a statement about a point in time and every consumer applies a freshness
-- window rather than trusting it forever.
-- ==========================================
create table if not exists public.primos_holders (
    -- The base58 Solana address. Primary key: one row per wallet, re-verified
    -- in place rather than appended, so this table stays the size of the holder
    -- base and not the size of the login history.
    wallet       text primary key,

    -- Set when the player is ALSO signed in with Google. Null for someone who
    -- only ever connected a wallet — the game plays local-only without an
    -- account, so this is genuinely optional. It is what lets the board policy
    -- in the enforcing migration ask "is the user writing this row a holder?".
    user_id      uuid references auth.users(id) on delete set null,

    -- How many Primos the Edge Function counted at verified_at. Stored rather
    -- than just a boolean because "you hold 9" is worth knowing and costs
    -- nothing, and because a count of 0 is a meaningful record of a wallet that
    -- asked and was turned away.
    primo_count  integer not null default 0 check (primo_count >= 0),

    first_seen   timestamptz not null default now(),
    verified_at  timestamptz not null default now()
);

-- The board policy in the enforcing migration looks a holder up by user_id, and
-- that is a per-write lookup on every score submitted.
create unique index if not exists primos_holders_user_idx
    on public.primos_holders (user_id) where user_id is not null;

alter table public.primos_holders enable row level security;

-- A signed-in player may read THEIR OWN row — the client shows "verified, 3
-- Primos" and this is where that comes from. Nothing else is readable: no
-- listing the holder base, no looking up somebody else's wallet.
drop policy if exists "Holders can read their own row" on public.primos_holders;
create policy "Holders can read their own row"
    on public.primos_holders for select
    using (user_id is not null and auth.uid() = user_id);

-- ⚠ NO INSERT OR UPDATE POLICY, EVER. Writing here is asserting ownership of an
-- NFT, and a client that could do that would make the entire gate decorative.
-- Only the Edge Function writes, through the service role, after checking the
-- chain itself.
revoke insert, update, delete on public.primos_holders from anon, authenticated;


-- ==========================================
-- IS THIS USER A HOLDER?
--
-- SECURITY DEFINER so it can see primos_holders past the select policy above,
-- which deliberately only exposes a caller's own row. The enforcing migration's
-- board policies call this.
--
-- `stale_days` is not decoration. A holder row is a claim about the moment it
-- was written, and someone can sell their Primo five minutes later. Every
-- consumer states how old a proof it will accept.
-- ==========================================
create or replace function public.primos_is_holder(uid uuid, stale_days integer default 7)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.primos_holders h
         where h.user_id = uid
           and h.primo_count > 0
           and h.verified_at > now() - make_interval(days => greatest(stale_days, 1))
    );
$$;

revoke all on function public.primos_is_holder(uuid, integer) from public;
grant execute on function public.primos_is_holder(uuid, integer) to anon, authenticated, service_role;


-- ==========================================
-- HOUSEKEEPING
--
-- Spent and expired nonces are litter — they carry nothing worth keeping the
-- moment they are used or stale. Service-role only, same as the table.
-- ==========================================
create or replace function public.primos_prune_gate_nonces(keep_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
    delete from public.primos_gate_nonces
     where created_at < now() - make_interval(hours => greatest(keep_hours, 1));
    get diagnostics removed = row_count;
    return removed;
end; $$;

revoke all on function public.primos_prune_gate_nonces(integer) from public, anon, authenticated;
grant execute on function public.primos_prune_gate_nonces(integer) to service_role;


-- ==========================================
-- SELF-CHECK. The two mistakes here that cannot be walked back: a client that
-- can mint its own challenge, and a holder table anyone can read. Refuse to
-- leave the file in either state.
-- ==========================================
do $$
begin
    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'primos_gate_nonces'
    ) then
        raise exception
            'primos_gate_nonces has a policy. It is service-role only by design — '
            'a client that can read or mint a nonce can replay another wallet''s signature.';
    end if;

    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'primos_holders'
           and cmd in ('INSERT', 'UPDATE', 'DELETE')
    ) then
        raise exception
            'primos_holders has a write policy. Ownership is asserted by the Edge '
            'Function after checking the chain, never by a browser.';
    end if;

    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'primos_holders' and cmd = 'SELECT'
           and qual not like '%auth.uid()%'
    ) then
        raise exception
            'primos_holders has a SELECT policy that is not scoped to auth.uid(). '
            'This table joins a Google identity to a wallet on a public chain.';
    end if;
end $$;
