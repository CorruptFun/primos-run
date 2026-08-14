# Game Design

What the game *is*, why each rule exists, and where its numbers live. Every
tunable in this document is in [`js/config.js`](../js/config.js) unless noted;
prices are in [`js/tiendita.js`](../js/tiendita.js) because a price and the thing
it buys are one row of one table.

For the code shape see [BUILD_OVERVIEW.md](BUILD_OVERVIEW.md).

## The pitch

An endless runner down Los Angeles alleyways starring the Primos Solana NFT
collection. Three lanes, jump and slide, seen from behind. Collect chelas, eat
tacos, dodge police checkpoints and border walls, and stay ahead of ICE.

## What separates it from Subway Surfers

Three things, in order of how much they matter.

**1. Stamina.** Stamina drains faster the faster you run, and only tacos refill
it. At zero you gas out: your speed halves and the cruiser reels you in. This is
the core differentiator — **you cannot purely dodge, you have to eat**. Subway
Surfers has no resource the player manages; the whole run is reflex. Here the
alley asks a second question every few seconds: is that taco worth the lane?

**2. Chase pressure instead of one-hit death.** A crash does not end the run. It
adds ~46 to a 100-point ICE meter that bleeds off while you run clean. So a
mistake is a debt you can work off, and three mistakes in ten seconds is a bust.
That converts the failure state from a coin-flip into a curve the player can
feel building.

**3. You run as your own Primo.** The menu takes a token number, an image URL or
a file, and the head on the runner becomes that Primo — outfit colours sampled
off the PFP, hair colour off the crown, so it still reads as *yours* from behind.

## The run

### Speed

| | value |
|---|---|
| `RUN.startSpeed` | 15.0 u/s |
| `RUN.maxSpeed` | 33.0 u/s |
| `RUN.accel` | 0.12 u/s per second survived |
| `RUN.gassedSpeed` | 8.5 u/s |

Top speed arrives 150 seconds in. `accel` was 0.135 (133s) and was slowed
deliberately. **Nothing else moves with it** — the tier schedule is gated on
time and the chunk stretch is a function of speed — so this changes only how
long the climb takes. It is the first knob to turn back if the run ever reads as
sluggish.

### Jumping and sliding

Apex is `v²/2g`: **1.43u standing, 2.16u on the skateboard**.

**Checkpoints, border walls and cruisers are taller than the apex on purpose.**
They cannot be jumped, at all, by design (see `PROP_SPEC` in
[`js/art/props.js`](../js/art/props.js)). Lane changes are the only honest
answer. Dumpsters, crates and cones are jumpable; laundry lines and taco-shop
awnings must be slid under.

This is the single most common thing a new player learns by dying, which is why
the tutorial exists — see [First-run training](#first-run-training).

### Stamina

| | value |
|---|---|
| `STAMINA.max` / `start` | 100 / 78 |
| `STAMINA.drainBase` | 2.6 per second at `startSpeed` |
| `STAMINA.drainSpeedFactor` | 0.55 — extra drain scaled by speed |
| `STAMINA.taco` | +34 |
| `STAMINA.lowWarn` | 30 — the HUD starts shouting |

Starting at 78 rather than 100 is deliberate: the first taco should feel needed
inside the first half-minute, or the mechanic reads as decoration.

### ICE pressure

| | value |
|---|---|
| `CHASE.max` | 100 |
| `CHASE.hit` | +46 per crash |
| `CHASE.decay` | −7.2 per second while clean |
| `CHASE.gassedGain` | +13.0 per second at zero stamina |
| `CHASE.grace` | 1.1s after a hit before decay resumes |

Three crashes inside the grace windows is a bust. Running out of stamina is
death on a ~7.7 second timer unless you find a taco.

The cruiser's on-screen distance is a *function of the meter*, not a chase
simulation: it eases toward `z − (3.2 + (1 − chase/max) × 26)`. So the picture
always agrees with the number, and the player learns to read the meter by
looking over their shoulder.

### Scoring

| | value |
|---|---|
| `SCORE.perUnit` | 1.0 per world unit travelled |
| `SCORE.beer` | 10 per chela, × multiplier |
| `SCORE.comboStep` | 8 chelas per multiplier bump |
| `SCORE.comboMax` | ×8 |

A crash resets the combo, not the score. Roughly: **one point per metre, ten a
chela**, which is what makes `QUALIFY_SCORE = 1500` (see
[Invites](#invites)) about two minutes of real play.

### Power-ups

| | duration | what it does |
|---|---|---|
| **Piñata Magnet** | 10.0s | pulls chelas in from `MAGNET_RADIUS` 3.6u |
| **Chancla Rush** | 6.5s | invincible, ×1.55 speed, flattens obstacles for +25 each |
| **Skateboard** | 13.0s | eats one crash, higher jump (apex 2.16u), and you ride it |

The prop keys are `magnet`, `chancla` and `skateboard`. The first two are still
named for what they were when the art was a piñata and a sandal, and the art is
now a gun and a bag of white powder — the roadmap below is why. **The third was
renamed**, because it was `lowrider` and the art had already been a skateboard
for two versions: the HUD said LOWRIDER, a board appeared under the runner's
feet, and the shop sold a car. `js/wallet.js`'s `RENAMED` carries the old id off
players' shelves; nothing else validates a shelf id, so without it the rename
would have quietly binned a 55-chela item.

### ICE air support — the drone

Late in the run, ICE starts flying drones down your lane. It is an **event, not
a prop**: a siren screams, a searchlight locks the lane you are standing in,
and ~1.7 seconds later the drone dives down that lane at strike height. Later
events make multiple passes (1 → 1 → 2 → 2 → 3), each with its own re-lock and
a shorter warning — the first two events are single passes by owner direction,
so the drone introduces itself before it escalates.

| | value (`DRONE` in config) |
|---|---|
| `startTime` | 110s survived — between tier 2 (90s) and tier 3 (160s) |
| `interval` / `intervalJitter` | 46s + up to 18s between events |
| `telegraph` / `reTelegraph` | 1.7s first warning, 1.05s between passes |
| `approach` | +30 u/s closing on top of the player's own speed |
| `height` | 1.12u hull underside — a slide (0.72u) clears it |

Four rules keep a homing enemy inside the fair-by-construction promise:

- **Time-gated, never distance-gated** — the pacing chapter's scar, applied:
  distance accelerates, so anything keyed on metres arrives faster every
  minute the player survives.
- **The pass is judged as a CROSSING, not sampled as a window.** The drone
  closes at `approach` *plus* the player's own speed — about 58 u/s when it
  first launches — so the frame that should catch it advances 1.45u at 40fps
  through what used to be a 1.2u test window. Below roughly 45fps the hull
  stepped clean over the player and no strike was ever tested: the drone was
  decoration on exactly the devices least able to render it, and `drones`
  counted the non-event as a dodge that fed a jale. It now resolves on the
  frame `gap` first goes non-positive, which happens exactly once per pass at
  any step size.
- **The lane locks when the WARNING starts and never retargets.** Changing
  lanes always dodges. The searchlight is gameplay information, not
  decoration — it stands on the exact lane the dive will come down.
- **The strike height sits between the slide hitbox and the standing one**,
  so staying put and sliding also dodges. Jumping does NOT clear it — apex
  1.43u lifts you *into* the hull, the checkpoint rule's shape: the alley's
  tall things are never answered by faith in a jump.

A strike is a **normal crash** through the same `hit()` every prop uses —
chase +46, combo reset, nothing new to fear. A chancla rush **swats the drone
out of the sky** (the standard smash bonus, and the whole event ends). The
reprieve after a bust cancels any event in flight — nobody gets dive-bombed
while getting back on their feet.

Passes survived count as **dodges** (`drones` in the run stats), which the
jales price (`DODGE %n ICE DRONES`) — the one daily that asks for *longer*
runs rather than more of them.

## Pacing

The alley is built from **42 hand-authored chunks** — 10 tier-0, 13 tier-1,
11 tier-2, 8 tier-3; 5 calm, 22 mid, 15 dense. A chunk is a small pattern with a
guaranteed-passable line through it, so the run is fair **by construction**
rather than by rejection sampling.

| | value |
|---|---|
| `PACING.tierSeconds` | `[0, 35, 90, 160]` — seconds survived at which each tier opens |
| `PACING.tierPhaseIn` | 45s for a new tier to reach its full share of the pick table |
| `PACING.newTierWeight` | `[0.2, 2.6]` across the phase-in |
| `PACING.tierFade` | 0.62 per step down — old tiers stay as breathers |
| `PACING.speedComp` | 0.68 of the speed increase paid back as spacing |
| `PACING.maxStretch` | 2.4 |
| `PACING.denseSpacing` | 2 non-dense chunks required after a gauntlet |

Two things here exist because of the same mistake, made twice:

- **Tiers used to be gated on distance.** Distance accelerates, so the tiers
  arrived about three times faster than the speed curve did — the gauntlets
  landed 90s in while top speed is 150s away, and tier 0 was over in 20 seconds.
  `tierSeconds` gates on **time**.
- **Chunk spacing used to be authored in fixed world units.** A fixed distance is
  a *shrinking* reaction time: 9u is 0.60s at 15 u/s and 0.27s at 33 u/s, which
  is below human reaction time — the only way to survive it is to have memorised
  the pattern. `speedComp` stretches every chunk along z as speed climbs.

The tiers deliberately widen (35s, then 55, then 70) so each is longer than the
last and competence has room to catch up with the alley. `tierPhaseIn` is longer
than the narrowest tier, so the phase-ins overlap and the difficulty curve has no
corners in it.

## The economy

**Chelas are the currency, and running is the only way to get them.** There is no
payment sheet anywhere in this game. That single fact is what makes the shop and
the continue offer honest rather than predatory — an unaffordable offer is not a
taunt, it is the price list for the thing the player just wanted.

### La Tiendita

Corrupt's corner store. The shelf, cheapest first — **the order is load-bearing**,
because "the first thing you can afford" is what the shelf highlights for a
player standing there with their first thirty chelas.

| item | price | effect |
|---|---|---|
| **Gasolina** | 20 | start the run with a full tank |
| **Piñata Magnet** | 30 | start with the magnet running |
| **Chancla Rush** | 35 | start with the rush running |
| **Vida** | 45 | Corrupt looks the other way once — a free reprieve |
| **Skateboard** | 55 | start on the board |

A good run pays out **25–45 chelas**, so the shelf is priced against *one run*:
the cheap end is a run's takings, the expensive end is a run and a bit. Nothing
here is a grind, and nothing here is pocket change.

Purchases stack on a shelf (`MAX_STOCK` 9 per item) and one of each is consumed
at the start of the next run. Buying three chanclas gets you a chancla on each of
the next three runs, not one thirty-second chancla.

### El Fit — gear you keep

The second half of the counter. Consumables above are priced against one run;
**gear is priced against several days**, because gear is what a wallet is *for*
once the shelf stops being novel. Bought once, owned forever, worn on the
runner — and worn where the game actually looks at you: **from behind**.

| item | slot | price |
|---|---|---|
| **Pasamontañas Negro** | mask | 150 |
| **Pasamontañas Rosa** | mask | 200 |
| **Pasamontañas Oro** | mask | 400 |
| **Cadena de Oro** | chain | 250 |
| **Cadena Cubana** | chain | 500 |

Why these prices: the retention systems below pay a fully-engaged player about
**110 chelas a day** on top of run takings, so the cheap mask is a day or two of
real play, the gold one most of a week. A cosmetic must be saved for or owning
it says nothing.

Rules that keep the economy honest:

- **Buying gear you already own is refused, not double-charged** — ownership is
  checked inside the same atomic write as the debit (`wallet.buyGear`).
- **Owned gear is merged by UNION across devices** — the same reasoning as the
  consumable shelf: it was paid for with chelas the player actually earned, and
  a merge must never delete a purchase (see `mergeGear` in `js/merge.js`).
- **What is *worn* merges by recency**, like the race name: `fit` carries its
  own `fitSetAt` timestamp, because "which mask am I wearing" is a preference,
  not progress, and the device you dressed yourself on last is the one telling
  the truth (see `pickFit`).
- A mask deliberately covers the Primo's hair and hat. That trade — identity
  for anonymity — is the player's to make; outfit colours are still sampled
  from their PFP, so the runner stays *theirs*.

### Continues

Priced by how many you have already taken **this run**:

```
continueCost(n) = 25 × 2ⁿ     →  25, 50, 100, 200, 400 …
```

It doubles and never stops doubling. A first continue is priced at a fair run's
takings so one good run funds one; the fourth is 200, which no amount of good
running funds on the spot. **That curve is the whole safety rail** — death has to
stay expensive or the run stops being a run.

Buying your way back never buys **score**, only more alley. A wallet can extend a
run and can never inflate what it was worth.

The reprieve (`REPRIEVE` in config) is shared by the paid continue and the free
vida, so the two can never feel different: 2.4s invulnerable, 16u of alley swept
ahead so you do not get back up inside the dumpster that just put you down, 2.0s
before ICE starts building, and a fresh tank. What it deliberately does **not**
touch: score, distance, combo, multiplier, tacos, chelas and the clock. Keeping
the run is the entire product being sold — a reprieve that resets the score is
just a restart with extra steps.

### Continued runs count on the board, and are marked

A deliberate decision (see ADR-0007 in the vault): **the score shown at game over
is the score submitted**, including runs that were paid back into. The cost of
that is a board where a full wallet buys distance, so every place one of those
scores is displayed says so — the `continued` flag rides the score it belongs to,
and the server's guard preserves it on any write that does not *raise* the score,
so a rename cannot launder a bought run into a clean one.

A weekly total is marked if **any** day inside it was bought (`bool_or` in the
view). That is the honest reading: the number being ranked is partly made of a
run that was paid for.

## Coming back tomorrow

Everything above makes a single run good. This chapter is what makes *tomorrow's*
run exist. Design rule for the whole chapter: **every reward is paid by running,
never by showing up** — there is no login bonus, no claim button, no payment
sheet. The game only ever pays people for playing it, which is what keeps the
streak from becoming an obligation to open an app.

Both systems reset on the **same UTC clock as the boards** (`dayKey` in
`js/raceday.js`) — one clock for everyone, for the boards' stated reason.

### La Racha — the daily streak

The first run you **bank** each UTC day pays a bonus that escalates with your
streak:

```
day    1    2    3    4    5    6    7+
bonus  5   10   15   20   25   30   40      (RACHA_TABLE in js/racha.js)
```

Skip a day and it resets to day 1. The table caps at 7 on purpose: an
ever-growing bonus turns a habit into a hostage, and 40 is already a mid-shelf
item every single day. The menu shows the streak — and shows it *at risk* when
yesterday counted but today has not — because loss aversion only works on a
number the player can see.

Merge rule (`pickRacha` in `js/merge.js`): the side with the **later day** wins;
same day, the longer streak. Never summed — a streak is a fact about days, not
a counter.

### Los Jales del día — daily missions

Three jobs a day, **the same three for every player on earth** — they are
picked deterministically from the day key (`js/jales.js`), so "did you get the
taco one done" is a conversation, not a coincidence. Three slots, drawn from a
pool of run-shaped goals: chelas collected today, tacos eaten, slides, jumps,
power-ups grabbed, obstacles flattened, best combo, single-run score, single-run
distance. Cumulative goals progress across every run of the day, so a bad run
still moves something.

| | pays |
|---|---|
| each jale | 15 chelas |
| all three (la propina) | +25 |

Ceiling per day: `40 (racha) + 70 (jales) = 110` on top of takings — about two
to three good runs' worth, which funds the gear ladder above in days without
inflating the continue ladder (a continue is still real money at 25·2ⁿ).

Progress, completion and payout are settled at **run end, in one atomic
economy write** together with the run's takings and the racha bonus
(`settleRun` in `js/main.js` → `writeEcon`), so a payout and the latch that
says it was paid can never tear apart — the exact lesson
`referralWelcomeClaimed` already taught this codebase. Completed jales are
celebrated on the game-over sheet, under the score, where the "one more run"
decision is actually made.

Merge rule (`pickJales`): later day wins outright; same day unions `done` and
takes max progress per goal. Two devices played offline on the same day can
each pay the same jale once — bounded at 70 chelas and partly self-cancelling,
since the wallet merge keeps only one side's balance (`pickWallet`). Accepted,
documented, same class as every other cross-device money tradeoff here.

### Why this holds up long-term

The dopamine architecture, named honestly:

1. **Appointment** — la racha's visible at-risk state is the reason to come
   back *today*, jales are the reason today is *different from yesterday*.
2. **Savings goals** — el fit's 150–500 range means the wallet always has a
   next thing it is *for*, several days out.
3. **Competition** — the daily and weekly boards (already live) are where a
   good run goes to matter; racha and jales exist to put players on them daily.
4. **Identity** — your own Primo, wearing the fit you saved for. Status you
   can see from behind.
5. **In-run texture** — combo ladder, near-miss kicks, power-ups: the
   second-to-second variable rewards were already built.

What is deliberately absent: loot boxes, timers that punish absence beyond the
streak reset, and anything bought with money. Chelas in, chelas out.

## Invites

Every signed-in player mints one six-character code. The friend arrives on
`?ref=CODE`, their browser stashes it at boot, and it survives there until they
sign in — even days later.

| | value |
|---|---|
| `QUALIFY_SCORE` | 1500 — the referee's best run must pass this |
| `REFERRER_CHELAS` | 60 |
| `REFEREE_CHELAS` | 30 |
| `REFERRAL_CAP` | 20 rewarded invites, lifetime |

The qualification gate is most of what makes farming unattractive: **real play,
not a click**. At roughly one point per metre plus ten a chela, 1500 is a couple
of minutes of genuinely dodging things rather than a fresh account that pressed
start and died. The work per head is real and the prize is about two runs'
takings.

Priced against the shelf: the referrer's cut buys the top of the shelf outright,
and the newcomer's welcome covers a mid item on their first day.

> **Status:** invites landed on `main` in `0dda343` (2026-07-31). Whether
> `supabase/migrations/0002_primos_referrals.sql` has been **applied to
> production** is a separate act that no file in this repo can tell you — only
> `scripts/verify-rls.sh` against production can.
> See [CLOUD_AND_LEADERBOARDS.md](CLOUD_AND_LEADERBOARDS.md).

## First-run training

The alley is fair but it is not obvious, and three of its obstacles cannot be
jumped at all. A player who discovers that by dying learns it as *"the game
cheated me"*. So the first time anyone presses RUN they get taught by doing
(`js/tutorial.js`), and only then does the first real run start.

It is also **replayable on demand**: RUN THE TRAINING AGAIN on the HOW TO PLAY
sheet calls `resetTutorial()` and takes the course from the top. That path puts
the game back to `MENU` and resets the world first, because the course is taught
over a *live* alley and that is the only state it has ever run in. The button is
hidden when the sheet was opened from PAUSE — there the run is still going, and
starting the course would throw it away.

Both endings lead into a run. The course running out is seen by `drawFrame()`,
which calls `startRun()`; **SKIP ends it from outside the frame loop**, where
that branch cannot see it — so the pill has to start the run itself. Without
that it fell through every sheet the course had hidden and left the player on an
empty scrolling alley with nothing to press.

Rules the tutorial holds itself to:

- It **never writes to the Game**. It owns nothing but its own step state.
- It gates on the same four verbs the input layer already produces, *and* watches
  the player independently, so it works whether the caller freezes the world
  behind the overlay or lets it run live.
- **Every step has an unconditional exit** (nudge at 6s, give up shortly after).
  A tutorial that can deadlock is worse than no tutorial, and there are two ways
  to strand someone: a gesture their device will not produce, and a caller that
  never routes `tutorialInput` while the world behind the overlay is frozen.

A save written before the tutorial shipped has no `trainedAt` at all. If it has
runs on the clock the player already knows the alley and is stamped trained on
sight (`LEGACY = -1`); a save with no runs is treated as fresh and still gets
taught. **`LEGACY` is −1 and not 0 on purpose** — the cross-device merge latches
"has trained at all", and `Math.max(-1, 0)` is `0`, which would replay training
for every grandfathered player.

## Camera feel

Everything in `JUICE` is a spring target the run implies. **None of it touches
the physics the player is judged against**, so juice can never cost you a run.

| | value |
|---|---|
| `tiltMax` | 0.05 rad of roll at full lane-change velocity |
| `bobAmp` / `bobRate` | 3.2px, 2 bobs per stride |
| `fovKick` | focal shrinks 10% at top speed (wider view) |
| `fovRush` | a further 8% during a chancla rush |
| `nearMiss` | 0.7u — closer than this and you feel the dodge |

The near-miss kick fires **once per obstacle and only when the gap was genuinely
tight**. Rewarding a comfortable jump with the same kick as a hair's-breadth one
teaches the player nothing.

## Haptics

`HAPTICS` patterns are short by design — long buzzes read as a malfunction. Each
one sits on the same line as the sound it belongs to in `game.js`, so the two
can never drift apart and there is no second list of "moments" to maintain.
Gated by the sound toggle (someone playing silently wants silence, not buzz) and
a no-op on every device without `navigator.vibrate`, which includes all of iOS
Safari.

## Roadmap

From the owner, 2026-07-30. Not built yet.

**Levels and progression beyond the endless alley.** Power-ups were re-themed to
guns, a bag of white powder and a skateboard because **later levels have ICE
drones you shoot down**. That is the reason the gun exists — it is a mechanic,
not set dressing. `js/art/ice.js` is the rig for those units.

> The first half of that shipped: drones now FLY (see
> [ICE air support](#ice-air-support--the-drone) above) as a dodge event in the
> endless run. What remains of this roadmap item is the *shooting* — the gun
> verb below — and the level structure around it.

The design consequence not yet built: `chancla` currently smashes whatever you
*collide with*. A gun needs a verb — fire, or auto-target — or it is a reskin
that will feel wrong the moment drones appear.

The largest remaining gap against the genre reference is **scenery density per
metre** (chunk authoring in `js/world.js`); the reference has roughly 3× the
objects.
