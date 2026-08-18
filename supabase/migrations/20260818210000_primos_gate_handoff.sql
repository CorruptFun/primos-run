-- ============================================================================
-- 20260818210000_primos_gate_handoff.sql
-- The mobile half of the gate: verify in the wallet, collect in the app.
--
-- Client half is js/gate.js + wallet.html, verifier is the same Edge Function
-- (supabase/functions/primos-gate). docs/NFT_GATE.md → "Mobile, PWAs and the
-- wallet browser" is the write-up.
--
-- ⚠ TIMESTAMPED, like every migration here. `version` is the primary key of
-- supabase_migrations.schema_migrations and that table is PER-PROJECT; Viva Maya
-- and Turbo Maze already own 0001–0022, so a hand-numbered file is read as
-- already-applied and SKIPPED WITH A SUCCESS MESSAGE. Apply with
-- `supabase db query --linked -f <file>`; `db push` does not work from this repo.
--
-- ============================================================================
-- WHY THIS EXISTS
--
-- A wallet does not inject a provider into mobile Safari or mobile Chrome. So on
-- a phone the gate's only route was Phantom's in-app browser — and an in-app
-- browser has no Add to Home Screen. Gating the door did not merely make the PWA
-- harder to install on mobile; it made it impossible, which is the opposite of
-- what a game meant to be kept on a home screen wants.
--
-- The wallet CAN be reached from an ordinary browser (Phantom and Solflare both
-- publish universal links), but the answer comes back to whichever browser
-- context the operating system chooses, and on iOS that is never the installed
-- web app: a home screen web app is not a universal-link handler, and it is
-- given its OWN storage jar — separate cookies, localStorage, IndexedDB and
-- service worker — from Safari. A pass written on the way back lands in a jar the
-- installed app cannot see. No amount of client cleverness crosses that line.
--
-- So the verdict travels through the one place both contexts can reach: here.
-- The nonce row already exists, is already single-use and is already service-role
-- only — it is exactly the right object to hand a result to, and this file adds
-- the columns that let it.
--
-- ============================================================================
-- ⚠ NOTHING IN THIS FILE IS A CREDENTIAL AT REST, AND THAT IS DELIBERATE.
--
-- The obvious shape is to mint the pass at verify time and park it here for the
-- app to collect. Do not: a pass is a bearer token for the door, and a bearer
-- token sitting in a row until the pruner runs is a bearer token with a lifetime
-- nobody chose. What is parked instead is the FINDING — this wallet, this many
-- Primos, these token numbers — and the pass is minted fresh in the claim, from
-- a secret the database never holds. Same for the one-time session token: it is
-- generated for the device that collects, not stored for it.
--
-- The rule that falls out of it: `claim_hash` is the only secret-shaped column
-- here, and it is a HASH. The device keeps the token; the database keeps the
-- hash; the nonce travels through the wallet in a URL and is worth nothing on
-- its own. Getting that backwards — putting the claim token itself in the row,
-- or the nonce alone in the claim — turns a URL that passes through another
-- app's hands into a key to somebody else's pass.
-- ============================================================================
--
-- Additive only. It creates no policy, tightens no policy, and changes no
-- existing column, so it is safe to apply under the client already in the field:
-- an old client never sends `claimHash` and never calls `claim`, and every
-- column below stays null for it.
--
-- Idempotent-friendly: safe to re-run.
-- ============================================================================


-- ==========================================
-- THE HANDOFF, bolted onto the challenge it belongs to.
--
-- One nonce, two devices' worth of story: the app that asked for it, and the
-- wallet browser that spent it. Kept on the same row rather than in a table of
-- its own because it IS the same event — a second table would need its own
-- expiry, its own prune and its own RLS argument for no gain.
-- ==========================================
alter table public.primos_gate_nonces
    -- sha256 (hex) of a random token the asking device keeps to itself. Present
    -- only on a challenge issued for a handoff; null for the ordinary in-page
    -- path, which never leaves the tab and needs no collection step.
    --
    -- ⚠ THE HASH, NEVER THE TOKEN. The nonce is carried into the wallet's
    -- browser in a URL — visible to that app, to its history, and to anything
    -- that can observe a deeplink. The claim demands nonce AND token, so a
    -- captured URL is half of a key and the half that stays home is the half
    -- that matters.
    add column if not exists claim_hash text,

    -- The finding, written by the Edge Function after it has checked the chain
    -- itself. Not a claim by any browser — the same rule primos_holders follows,
    -- and for the same reason.
    add column if not exists primo_count integer,
    add column if not exists tokens integer[],

    -- Stamped when the verdict is ready to collect. Null means the wallet has
    -- not answered yet, which is what the asking device polls against.
    add column if not exists pass_ready_at timestamptz,

    -- Stamped by the atomic collect below. A non-null value means the verdict
    -- has been handed over and this row is spent for good.
    add column if not exists pass_claimed_at timestamptz;


-- The claim's lookup is by primary key, so it needs no index of its own. This
-- one is for the prune, which sweeps by readiness rather than by creation.
create index if not exists primos_gate_nonces_ready_idx
    on public.primos_gate_nonces (pass_ready_at)
    where pass_ready_at is not null;


-- ==========================================
-- HOUSEKEEPING
--
-- Replaces the prune from 20260816210000 with one that also forgets a FINDING
-- that was never collected. The row is litter either way, but an uncollected
-- finding is litter that names a wallet and its holdings, so it goes early and
-- on its own clock rather than waiting for the row's.
--
-- `create or replace` on our own prefixed function, so nothing of another game's
-- is at risk here — that hazard is real in this shared project and is why every
-- object in this directory is `primos_`-prefixed, but this one is ours.
-- ==========================================
create or replace function public.primos_prune_gate_nonces(keep_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
    -- A finding nobody collected within the hour is not going to be collected:
    -- the claim window in the Edge Function is far shorter than that, so this
    -- only ever clears rows that are already refusable.
    update public.primos_gate_nonces
       set primo_count = null,
           tokens = null
     where pass_ready_at is not null
       and pass_ready_at < now() - interval '1 hour';

    delete from public.primos_gate_nonces
     where created_at < now() - make_interval(hours => greatest(keep_hours, 1));
    get diagnostics removed = row_count;
    return removed;
end; $$;

revoke all on function public.primos_prune_gate_nonces(integer) from public, anon, authenticated;
grant execute on function public.primos_prune_gate_nonces(integer) to service_role;


-- ==========================================
-- SELF-CHECK.
--
-- The columns above make the nonce row worth reading — it now names a wallet and
-- what it holds — so the "no policies, ever" rule from 20260816210000 stops being
-- a tidiness argument and becomes the thing standing between a browser and
-- another player's holdings. Asserted again here, because this file is what
-- changed the stakes.
-- ==========================================
do $$
begin
    if exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'primos_gate_nonces'
    ) then
        raise exception
            'primos_gate_nonces has a policy. It is service-role only by design — '
            'and since the handoff migration the row also carries a wallet and its '
            'holdings, so a readable one leaks what primos_holders is closed to.';
    end if;

    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'primos_gate_nonces'
           and column_name = 'claim_hash'
    ) then
        raise exception 'claim_hash did not apply — the handoff cannot be collected without it.';
    end if;
end $$;
