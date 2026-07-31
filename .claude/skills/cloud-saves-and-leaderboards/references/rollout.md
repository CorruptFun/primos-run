# Rollout — provider config, migration order, live audit

Shipping this stack is three separate acts that are easy to conflate: applying the schema,
configuring the OAuth provider, and deploying the client. Getting them out of order is the most
common way this breaks in production.

## Order

1. **Apply the schema.** Boards and policies must exist before a client can write to them.
2. **Audit RLS against the live API** (below). Do this before, not after, the client ships.
3. **Configure the OAuth provider and redirect URLs.** A client deployed before this shows every
   player an error on tap.
4. **Deploy the client.**

Steps 1 and 4 are independent — the dormant gate means an unconfigured client is harmless, and the
guards mean an un-deployed client leaves the schema idle. That is the point of the gate: the ordering
above is for *correctness of the live experience*, not for avoiding breakage.

## Google OAuth setup

The user has to do this part in two consoles; you cannot. Give them the exact list:

**Google Cloud Console** → APIs & Services → Credentials → OAuth 2.0 Client ID (Web application):
- *Authorized JavaScript origins*: the site's origin (e.g. `https://owner.github.io`).
- *Authorized redirect URI*: **the Supabase callback**, `https://<ref>.supabase.co/auth/v1/callback`
  — not the game's URL. This is the single most common misconfiguration; the game's URL goes in the
  *Supabase* redirect allow-list, not here.
- The consent screen needs a name, a support email and a logo before external users can sign in.

**Supabase dashboard** → Authentication:
- *Providers → Google*: paste the client ID and secret.
- *URL Configuration → Site URL*: the deployed site.
- *URL Configuration → Redirect URLs*: add the deployed origin **and** `http://localhost:<port>` for
  local development. `signInWithOAuth` passes `redirectTo`, and anything not on this list is silently
  rejected back to the Site URL — which looks exactly like "sign-in did nothing".

For a project deployed to a subdirectory (GitHub Pages project sites), the redirect URL must include
that path.

## One project or two?

When adding this to a second game, decide deliberately:

- **A separate backend project** gives clean separation, its own quota, and no chance of one game's
  migration breaking the other. Costs a second OAuth client and a second set of consoles to keep in
  step. Note the free tier's cap on active projects.
- **One shared project** means one `auth.users` table, one OAuth client to configure, and one place
  to look. It requires **game-prefixed table names** (`primos_saves`, not `saves`) from the very
  first migration, because generic names taken by game one are unavailable to game two — and
  retrofitting a rename across policies, triggers, indexes and views is far more work than choosing
  the prefix up front.

Separate origins mean separate `localStorage`, so a shared project does **not** give players a single
sign-on across the two games. Don't sell it as one.

## Applying migrations

Number them sequentially and apply them in order. Two failure modes worth pre-empting:

**A migration numbered below the highest already applied is silently skipped.** With the Supabase
CLI, `--include-all` is not optional:

```sh
supabase db push --dry-run --include-all   # always look first
supabase db push --include-all             # apply
```

Without it, a file that lands out of order sits unapplied under a higher number with only a hint
buried in the output.

**"Remote migration versions not found" usually means your branch is behind**, not that history
drifted. Check that before running any `migration repair --status reverted`, which will otherwise
mark an applied migration as reverted and manufacture exactly the drift it was meant to fix.

**If migrations are applied by hand** (pasted into a SQL editor), then applying to production and
merging to the default branch are two separate acts, and *the repo does not describe production until
both have happened*. Land migration branches promptly — a migration that is live but unmerged is
invisible to whoever looks next.

## The two-phase rule for cached clients

A PWA keeps players on a cached bundle until they accept an update, so **old clients keep running
against your new schema for days**. Any change that would break them needs two phases:

1. Ship the schema change so that both old and new clients work (add the column, keep the old one;
   widen the guard before narrowing it).
2. Only after the client rollout has drained, remove the compatibility.

This is why the name fix in `names.md` had to land server-side: there was no client-only phase 1 that
would have stopped stale devices publishing email names.

## Auditing RLS against the live API

Migrations proving themselves locally is not the same statement as "production is safe", especially
when migrations are applied by hand. Script the exposure matrix and run it against both.

The rule that makes such a script trustworthy:

> **Every "must be empty" assertion needs a paired CONTROL probe against a table that does not
> exist.** Without it, an empty `[]` is ambiguous between "RLS refused you" and "the table isn't
> there at all" — and those look identical from the client while meaning opposite things about your
> security.

What to assert with only the publishable key (no session):

| probe | expected |
|---|---|
| `GET /saves` | empty — no anonymous read of anyone's save |
| `GET /game_daily_scores` | **rows** — the board is public by design |
| `POST /game_daily_scores` with someone else's `user_id` | rejected |
| `PATCH /game_daily_scores` (anonymous) | rejected / affects nothing |
| `GET /game_weekly_totals` | rows, and no column beyond name/total/days |
| control: `GET /table_that_does_not_exist` | a *different* failure than the empties above |

Signed in as user A, additionally: reading A's save succeeds, reading B's returns empty, and writing
a row with B's `user_id` is refused.

Assert the **guards** too, since they are what the boards actually rest on — a submission for
yesterday's `day_key` must be rejected, and an upsert with a lower score must leave the stored score
unchanged. Both are one `curl` each and both have silently regressed before.

Never pass a service-role/secret key on a shared machine's command line; export it, or skip the
sender-side checks and label them SKIP.

## Verify after shipping

- Sign in on a fresh browser profile → progress restores.
- Sign in on a device with *further* local progress → the merge keeps the further one (this is the
  path that destroys saves when merge is wrong).
- Set a name → it appears on the board, and on **yesterday's** board too.
- Clear site data → restore from the downloaded backup file.
- Turn off the network → the game still plays, and the queued push drains when it returns.
- For a PWA: a deploy invalidates precached assets, so re-check offline behaviour after shipping.
