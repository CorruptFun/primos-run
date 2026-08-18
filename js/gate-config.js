// The NFT gate's switch. THIS FILE IS MEANT TO BE COMMITTED.
//
// ⚠ IT IS NOW TRUE, AND IT SHIPPED FALSE FOR A REASON THAT HAS NOT GONE AWAY.
// Everything below is why the switch exists and the order it has to be thrown
// in — read it before setting it back to true after any deploy that turns the
// backend off, and before assuming a fresh clone is safe to run gated.
//
// The gate's verdict comes from a Supabase Edge Function that has to be
// deployed, holding secrets that have to be set, against a migration that has
// to be applied by hand. Every one of those is a separate human act (see
// docs/NFT_GATE.md). Turn this on in a commit and the game is LOCKED FOR
// EVERYONE the moment Pages redeploys, whether or not the backend behind it
// exists — including for the owner, and including for every holder, with no way
// back in but another deploy.
//
// So the switch is separate from the code, exactly like js/cloud-config.js:
// with GATE_ENABLED false the whole layer no-ops, no wallet is ever asked for,
// and the game plays precisely as it does today.
//
// 👉 To turn it on, in this order — the order is load-bearing and is spelled
//    out with reasons in docs/NFT_GATE.md:
//      1. apply supabase/migrations/20260816210000_primos_nft_gate.sql
//      2. set the function's secrets and deploy supabase/functions/primos-gate
//      3. verify the function answers (docs/NFT_GATE.md has the curl)
//      4. flip GATE_ENABLED to true here and deploy
//      5. only once holders have had time to verify, apply
//         supabase/migrations/20260816210001_primos_gate_enforce_boards.sql
//
//    Doing 5 before 4 closes the leaderboard to every player including the
//    ones who hold. Doing 4 before 2 closes the game to everyone.

/** The master switch. False = no gate, no wallet prompt, game as usual. */
export const GATE_ENABLED = true;

/**
 * Where the verifier lives. Derived from the Supabase project rather than
 * written out, so it cannot drift from js/cloud-config.js's URL.
 *
 * Empty SUPABASE_URL (the dormant cloud state) leaves this empty too, and
 * js/gate.js treats an empty endpoint the same as GATE_ENABLED false — a gate
 * with nowhere to ask is a gate that must not refuse anyone.
 */
export const GATE_FUNCTION = 'primos-gate';

/**
 * How long a verified pass is trusted on this device before the wallet is asked
 * again. Must be <= the PASS_TTL_MS the Edge Function issues (24h) — the server
 * is the authority and a longer number here would just mean holding a pass the
 * server already considers dead.
 *
 * Not zero, on purpose. Re-signing on every launch is the kind of friction that
 * makes people stop opening a game, and the pass is already short enough that a
 * sold Primo loses access within a day.
 */
export const PASS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The page the wallet is sent to on a phone, relative to the game.
 *
 * It is a separate document rather than a mode of index.html on purpose: it
 * opens in the WALLET'S browser, where booting a whole game to draw one line of
 * text would mean downloading the game twice on a connection the player is
 * standing still on. Empty disables the handoff and leaves the gate exactly as
 * it was: injected providers only.
 */
export const HANDOFF_PAGE = 'wallet.html';

/**
 * Wallets offered, in the order the buttons appear.
 *
 * `path` is where the provider is injected. Phantom moved to
 * `window.phantom.solana` and left a `window.solana` alias that other wallets
 * also claim, so the namespaced path is checked first and the bare one is the
 * fallback — reading `window.solana` alone is how you end up asking Solflare to
 * sign while telling the player it is Phantom.
 *
 * `browse` is the universal link that opens a page inside that wallet's own
 * browser — `%u` is the destination and `%r` is us, both URL-encoded. It is what
 * makes the mobile handoff possible, because NOTHING is injected into mobile
 * Safari or mobile Chrome and without it a phone has no route to a wallet at
 * all.
 *
 * ⚠ THE TWO PATHS ARE NOT THE SAME SHAPE and copying one over the other gives a
 * link that silently 404s inside the wallet: Phantom is `/ul/browse/`, Solflare
 * is `/ul/v1/browse/`. Backpack publishes no browse deeplink, so it has none
 * here — a button that cannot work is worse than one that is absent, and
 * handoffWallets() filters on exactly this field.
 */
export const WALLETS = [
  {
    id: 'phantom', name: 'Phantom', path: ['phantom.solana', 'solana'],
    url: 'https://phantom.app/', browse: 'https://phantom.app/ul/browse/%u?ref=%r',
  },
  {
    id: 'solflare', name: 'Solflare', path: ['solflare'],
    url: 'https://solflare.com/', browse: 'https://solflare.com/ul/v1/browse/%u?ref=%r',
  },
  { id: 'backpack', name: 'Backpack', path: ['backpack'], url: 'https://backpack.app/' },
];
