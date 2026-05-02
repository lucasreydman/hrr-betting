# HRR Betting — Design Spec

**Date:** 2026-04-26
**Status:** Approved (brainstorming phase)
**App:** `hrr-betting.vercel.app`
**Repo:** `lucasreydman/hrr-betting` (public)
**Local path:** `C:\Users\lucas\dev\hrr-betting`
**Companion projects** (patterns reused): `bvp-betting`, `bet-yrfi`, `bet-nrfi`

---

## 1. Goal

Build an MLB prop-betting tool that ranks the best **Hits + Runs + RBIs (HRR)** plays for the day across three rungs (1+, 2+, 3+). Each rung is its own independently-ranked board (same player can appear on multiple lists with different ranks). The headline metric is the rolling 30-day hit rate of **Tracked** picks (high-conviction picks clearing absolute thresholds), with Brier score for calibration integrity.

The tool integrates patterns from sibling projects:
- **bvp-betting** — BvP regression math, lineup estimation, auto-settle pattern
- **yrfi/nrfi** — free-API stack, weather/park factors, Vercel KV, 5-min poll, break-even-odds output, stabilization taper

---

## 2. The HRR prop

HRR = (Hits) + (Runs scored) + (RBIs), summed over the player's full game. Lines: Over 0.5, 1.5, 2.5 — "1+, 2+, 3+" rungs.

### Mechanics that drive the math

| Outcome | H | R | RBI | HRR |
|---|---|---|---|---|
| Solo HR | 1 | 1 | 1 | **3** |
| Walk + score | 0 | 1 | 0 | 1 |
| Sac fly | 0 | 0 | 1 | 1 |
| 2-RBI single, batter LOB | 1 | 0 | 2 | 3 |
| Grand slam | 1 | 1 | 4 | **6** |
| Reach on error + score | 0 | 1 | 0 | 1 |
| HBP + score | 0 | 1 | 0 | 1 |

### Why this prop demands per-PA simulation

- 1+ HRR is a base-rate question — most starters clear it most nights
- 3+ HRR is **HR-driven**: dominated by scenarios where one event contributes to all three (solo HR), or by big-RBI hits with multiple runners on
- Closed-form Poisson on the *sum* systematically under-prices power hitters at 3+ because it can't model the HR-trifecta correlation
- Per-PA simulation naturally captures the correlation by tracking outcomes event-by-event

---

## 3. Pages

### `/` — today's slate (main page)

Three stacked sections (one per rung: 1+, 2+, 3+ HRR), each ranked by SCORE descending. Same player can appear on multiple boards.

**Per-pick row** shows:
- Player name + team + opponent
- Lineup slot (e.g. "Slot 4", "Slot 1 (estimated)")
- `P_matchup` (% probability of clearing rung today)
- `P_typical` (% in player's typical matchup)
- `EDGE` (`P_matchup / P_typical − 1`)
- `confidence` (0.55–1.00)
- `SCORE` (`EDGE × confidence`)
- Tier badge: 🔥 Tracked or no badge for Watching

**Status banner**: `X tracked across all rungs · lineups confirming at HH:MM · last refresh N min ago`

**Auto-refresh** every 5 min while board is open (faster while lineups still estimating).

### `/history`

- **Headline**: rolling 30-day Tracked record (e.g. `28-9 → 76% hit rate`)
- **Per-rung breakdown**: hit rate + predicted-avg + Brier score for each of 1+, 2+, 3+
- **Time-series chart**: rolling hit rate, calibration drift over time
- **Per-pick log**: filterable by date, player, rung, outcome
- Days with 0 Tracked picks recorded as `0/0` (transparent — they don't dilute the rate)

### `/methodology`

Static-ish page documenting:
- HRR rules + edge cases (table from §2)
- Math overview: per-PA model → lineup sim → P_matchup/P_typical → EDGE → SCORE → tracking
- Every factor with formula and weight
- Anti-over-stabilization principles
- All data sources cited (MLB Stats, Statcast, Open-Meteo)
- Calibration approach + recalibration schedule

---

## 4. Math model

### 4.1 Per-PA outcome distribution

For each PA, sample one of seven outcomes: **1B, 2B, 3B, HR, BB, K, other_out**. Probabilities are computed via **log-5 (odds-ratio) with Statcast adjustments**:

```
P(outcome | batter, pitcher, ctx) =
    batter_rate(outcome)
  × (pitcher_rate(outcome) / lg_avg_rate(outcome))
  × park_factor(outcome)
  × weather_factor(outcome)
  × tto_multiplier(outcome, time_through_order)
```

After computing all seven, normalize so they sum to 1.

### 4.2 Statcast adjustments (predictive layer)

Layered on top of the rates to add predictive power beyond raw outcomes:

- **Batter HR rate**: scaled by `batter_barrel% / lg_avg_barrel%`
- **Pitcher HR allowed**: scaled by `pitcher_barrels_allowed% / lg_avg`
- **Hit rate (1B/2B)**: scaled by `hard_hit% / lg_avg`
- **K rate**: cross-checked against `whiff%` and `swinging-strike%`
- **xwOBA** used as integrity check on the overall outcome distribution

### 4.3 BvP layer (starter-share weighted)

For the `starter_share` portion of PAs (the fraction facing the starter), apply BvP regression on top of the per-PA rates (bvp-betting pattern, generalized to all outcomes):

```
adjusted_rate = (AB_BvP / (AB_BvP + 50)) × BvP_rate
              + (50 / (AB_BvP + 50)) × per_PA_baseline
```

Where `BvP_rate` is the empirical rate of that outcome in the batter's career vs this specific starter. Skip BvP layer if `AB_BvP < 5` (too noisy) and rely on handedness-based per_PA_baseline only.

### 4.4 `starter_share` calculation

For each PA index `i` (1st PA, 2nd PA, …) for a given batter, compute:

```
P(starter still in | PA_i) = derived from starter's IP distribution over recent starts
```

Build empirical CDF of "did starter complete inning N" from the starter's recent starts. For each batter PA, map to expected inning, then use CDF for the probability the starter is still pitching.

#### Tiered fallback for thin samples

| Starts this season | CDF source |
|---|---|
| ≥ 5 | Empirical CDF from this season's last 5–10 starts |
| 1–4 | Bayesian blend: `weight_empirical = n/5`, rest from league-avg-by-pitcher-type prior |
| 0 (call-up / debut) but career history | Career CDF if ≥ 5 career starts |
| 0 anywhere | League-average CDF **by pitcher type** — regular starter (~5.5 IP modal) vs opener (1–2 IP modal). Type determined from `gamesStarted` history or pre-game role designation in MLB Stats. |

**Openers also reduce confidence factor** by 0.90× because the bullpen-after-opener composition is harder to predict (manager makes mid-game decisions about which long-relief follower to use).

```
expected_AB_vs_starter = Σᵢ P(starter still in | PA_i)
expected_AB_vs_bullpen = E[total_PA] − expected_AB_vs_starter
starter_share          = expected_AB_vs_starter / E[total_PA]
```

Typical values: **0.75 for top-of-order vs avg starter (5.5 IP); 0.55 for bottom-of-order**.

### 4.5 TTO (times-through-the-order) multipliers

Pitcher gets worse each time through the lineup. Use **pitcher-specific Statcast splits** when sample is sufficient (≥ 5 starts), fall back to league averages:

| Time through | League-avg multiplier on batter outcomes |
|---|---|
| 1st | 1.000× (baseline) |
| 2nd | ~1.05× |
| 3rd | ~1.20× |
| 4th | ~1.30× |

Multipliers are per-outcome (HR boost is more pronounced than BB boost). Applied only while the starter is on the mound.

### 4.6 Bullpen handling (leverage-tier)

For the `(1 − starter_share)` portion of PAs, sample from one of two reliever tiers:

- **High-leverage tier**: relievers with avg leverage index > 1.2 AND ≥ 10 appearances. Typically closer + setup. FIP usually 2.50–3.20.
- **Rest of bullpen**: everyone else. FIP usually 3.80–4.50.

Tier assignment is per-team and recomputed weekly. Late-game PAs (e.g., a batter's 4th PA in the 8th–9th inning) heavily weight the high-leverage tier; mid-game PAs (5th–7th) blend both. Both tier rates split by handedness.

### 4.7 Park, weather, handedness

- **Park factors**: extend yrfi/nrfi `park-factors.ts` to include HR-specific park factor (some parks suppress doubles but not HRs — e.g., Yankee Stadium short porch). Per-outcome park factors for each of the 30 stadiums.
- **Weather**: reuse yrfi/nrfi `weather-api.ts` (Open-Meteo). Temperature, wind speed, wind direction relative to the field's outfield-facing degrees. Wind-out boosts HR rate; wind-in suppresses. Temperature affects ball flight (warmer = farther).
- **Handedness splits**: all batter and pitcher rates split by RHP/LHP and RHB/LHB. Use the batter-vs-pitcher-handedness combination throughout.

### 4.8 Stabilization & recent form

Two distinct concerns handled together but not stacked:

#### Stabilization (small-sample noise)

Each stat has its own empirical stabilization sample size (Russell Carleton's research). Regress half-stabilizes at:
- K rate: ~60 PAs
- BB rate: ~120 PAs
- HR rate: ~170 PAs
- BABIP / AVG: ~800+ PAs

**Prior: regress toward the player's career rate** (not league mean) when multi-year history exists. League mean is fallback for true rookies. This is the biggest fix preventing over-stabilization — Judge's HR rate regresses toward Judge's career HR rate (~6.5%), not league HR (~3%).

#### Recent form (state changes)

Blend stabilized season rate with recent-form windows:

```
rate_used = w_season × stabilized_season_rate
          + w_L30    × L30_rate
          + w_L15    × L15_rate
```

Weights shift through the season:

| Period | w_season | w_L30 | w_L15 |
|---|---|---|---|
| Early (Mar–Apr) | 0.70 | 0.20 | 0.10 |
| Mid (May–Jun) | 0.60 | 0.25 | 0.15 |
| Late (Jul+) | 0.50 | 0.30 | 0.20 |

L30 and L15 windows are **not separately shrunk** — the blend itself is the regularizer; the season rate (already stabilized) acts as the anchor against L15 noise.

#### Anti-over-stabilization principles (explicit design rules)

1. **Empirical stabilization sample sizes** per stat (not arbitrary 50 AB priors)
2. **Player career rate as prior**, not league mean
3. **Blend handles state changes; shrinkage handles noise — they don't compound**
4. **Display raw + stabilized side-by-side** in debug output for sanity-checking
5. **Backtest-calibrated weights** — start with reasonable defaults, recalibrate after 30 days using Brier score and hit-rate-by-EDGE-bucket analysis

### 4.9 Lineup-aware Monte Carlo simulation

The heart of the model. For each game on the slate, run **10,000 iterations**:

1. Initialize the 9-batter lineup with each batter's per-PA outcome distribution (log-5 + Statcast hybrid, with all the layers above)
2. Each batter has *two* distributions: one vs the starter (with BvP layer + appropriate TTO multiplier per PA), one vs the bullpen (leverage-tier weighted by inning)
3. Simulate top-down through innings:
   - For each PA in the batting order, determine whether facing starter or bullpen using `starter_share` logic
   - Draw an outcome from the appropriate distribution
   - Update baserunner state (`bases = [r1, r2, r3]` with player IDs)
   - Score runs as appropriate, attribute RBIs to the batter who drove them in
4. End condition: 9 innings (extra-inning rule for ties: minimum innings until ≥ 1 team leads after a complete inning)
5. For the target batter, record final `(H, R, RBI)` and HRR sum

Output per batter: empirical histogram of HRR. Compute `P(HRR ≥ 1)`, `P(HRR ≥ 2)`, `P(HRR ≥ 3)` directly from histogram counts.

**Why lineup-aware (not just batter-vs-pitcher in isolation):**
- RBI ceilings are massively lineup-dependent — a 5-hole hitter behind two .380-OBP guys has fundamentally more RBI opportunity than a leadoff hitter behind the 8/9-hole
- Walks-as-baserunners matter — a high-walk-rate target who reaches on a BB still scores when the next batter doubles them in
- Naturally produces "HR with 2 on = 3 RBI" scenarios that drive the 3+ rung

**Extra innings**: end sim at 9 innings if the game is tied (record partial-game outcome). The 2023+ ghost-runner-on-2nd extras rule is **not modeled in v1** — its impact on 1+/2+/3+ probabilities is < 0.5% absolute (extras occur in ~8% of games), and modeling baserunner-on-2nd-each-inning adds non-trivial baserunner-state complexity for trivial signal gain. Listed in §11 as a known minor downward bias on HRR; revisit if 3+ Brier is consistently off in extras-heavy stretches.

#### Runtime location

Run the sim in a **dedicated compute path**, NOT inline on `/api/picks`:

- Endpoint: `/api/sim/[gameId]` with `maxDuration: 60` (Vercel Pro)
- Output: full per-game sim result (all 9 batters' HRR distributions) cached in KV under `sim:{gameId}:{lineupHash}`
- `/api/picks` only **reads** these cached results and aggregates per-rung rankings — stays < 1s
- Sim is recomputed when the lineup hash changes (lineup confirmed, slot reorder, weather forecast meaningfully shifts) — invalidation key is `(gameId, lineupHash, weatherHash)`

**Why separate path**: ~15 games × 10k iter × ~40 PAs ≈ 6M samples per slate. Inline on Hobby would timeout (10s); on Pro it would burn compute on every `/api/picks` refresh. Separate path means the heavy work runs once per lineup change, not every 5 min.

**Cron-driven prewarming** during slate hours: every 5 min, iterate today's games and call `/api/sim/[gameId]` for any whose `(lineupHash, weatherHash)` has changed since last sim. Failed sims (timeout, API hiccup) are retried independently — one bad game doesn't block the rest.

### 4.10 `P_typical`: replay-the-season simulation

For each player on the slate, compute `P_typical(rung)` once per day using a separate simulation:

- Use the **same simulator** as P_matchup
- Replay the player's actual schedule of opponents this season:
  - For each game played, capture: opposing starter, that day's bullpen leverage tiers, park, weather, this player's actual lineup slot
  - Average the per-game `P(HRR ≥ N)` weighted by lineup-slot frequency
- Cache result in KV: `p-typical:{playerId}:YYYY-MM-DD`
- Updates daily as new games are added to the schedule

**Why replay-the-season** (not synthetic neutral opponent):
- Captures schedule-strength bias appropriately — a player who's faced tough divisional pitching has a depressed `P_typical`, so genuinely good matchups today register as bigger edges (which IS the +EV reality)
- Naturally aligns with "find spots where today is meaningfully better than this player's normal experience" — the question we actually care about
- Same simulation infrastructure → no duplicate code path

---

## 5. EDGE, SCORE, and tracking

### 5.1 Formula

```
EDGE  = P_matchup / max(P_typical, 0.01) − 1
SCORE = EDGE × confidence
```

`max(P_typical, 0.01)` floor prevents divide-by-near-zero when computing 3+ for a rookie with no career baseline.

### 5.2 Confidence factor (hybrid)

**Hard gates** (drop the pick if any fail):
- Game not postponed / weather-cancelled
- Probable starter confirmed (not "TBD")
- Lineup exists (confirmed OR estimated with high confidence)
- Expected PA ≥ 3

**Graded multiplier** (multiplied together → 0.55–1.00 typical range):

| Input | Range |
|---|---|
| Lineup confirmed (1.0) / partial (0.85) / estimated (0.70) | 0.70–1.00 |
| BvP sample size (≥ 20 ABs → 1.0; 0 ABs → 0.85 fallback to handedness) | 0.85–1.00 |
| Pitcher recent-start sample (≥ 10 starts → 1.0; 3 starts → 0.85) | 0.85–1.00 |
| Time-to-first-pitch / lineup posting freshness | 0.95–1.00 |
| Weather forecast volatility (stable forecast → 1.0; volatile → 0.90) | 0.90–1.00 |

### 5.3 Tracked vs Watching tiers

A pick is **🔥 Tracked** if all three conditions clear:
- `confidence ≥ 0.85`
- `EDGE ≥ edge_floor(rung)`
- `P_matchup ≥ prob_floor(rung)`

Both EDGE and P_matchup floors are required because each catches a different failure mode:
- **EDGE floor only** would track a 30% prob at 3+ if typical is 8% (EDGE = 2.75) — but 30% is still a coin-flip on the bad side
- **P_matchup floor only** would track every Aaron Judge 3+ even when matchup is neutral (high absolute prob, no real edge)

#### Starting floors (placeholder — recalibrate after 30 days)

| Rung | EDGE floor | P_matchup floor |
|---|---|---|
| 1+ | 0.10 | 0.85 |
| 2+ | 0.30 | 0.55 |
| 3+ | 0.60 | 0.20 |

A pick is **Watching** if it clears the display floor (`SCORE ≥ 0.05`) but doesn't clear all three Tracked conditions. Shown on the board for transparency, never affects tracked metrics.

**Volume of Tracked picks varies by slate.** Days with weak slates may produce 0 Tracked picks — the board says so honestly and `0/0` is recorded for that day (it doesn't dilute the rate).

### 5.4 Settlement

- **Lock trigger** — earliest-wins, with quality conditions:
  - Fires when lineup is **officially confirmed** AND `now ≥ first_pitch − 90 min` (don't lock 5+ hours early on rare super-early confirmations — matchup conditions like weather can still update meaningfully), OR
  - `now ≥ first_pitch − 30 min` regardless of lineup status (forced fallback lock with estimated lineup if not confirmed)
- **At lock**: snapshot all Tracked picks for that game with current SCORE/EDGE/P_matchup/confidence — these become the immutable per-game record
- **Settle**: Vercel cron at 3 AM Pacific the next day. For each Tracked pick:
  - Pull boxscore via MLB Stats API
  - Compute actual `H + R + RBI` for the player
  - Mark each rung HIT/MISS based on whether `actual_HRR ≥ N`
- **Watching picks not snapshotted** — displayed only, no settlement

### 5.5 Tracked metrics

- **Per-rung hit rate** — rolling 30-day, season-to-date
- **Brier score per rung** — calibration check (does a 70% predicted pick actually hit 70%?)
- **Per-EDGE-bucket hit rate** — sanity: do higher-EDGE picks hit more often?
- **Days-with-zero-Tracked count** — transparency

The headline metric is **Tracked-overall hit rate over the last 30 days**. Brier score is the integrity check — a model that's overconfident on 3+ is recoverable (recalibrate the floors); a model that's wrong on 1+ base rates is broken.

---

## 6. Stack & infrastructure

| Component | Choice |
|---|---|
| Framework | Next.js 16 App Router |
| UI | React 19, Tailwind v4 (`@import "tailwindcss"`) |
| Language | TypeScript |
| Cache | Vercel KV via `@vercel/kv@^3.0.0` (matches yrfi/nrfi/bvp-betting); `lib/kv.ts` wrapper with in-memory fallback for local dev (direct port of `yrfi/lib/kv.ts`) |
| APIs | MLB Stats API, Baseball Savant CSV, Open-Meteo (all free, no auth) |
| Deployment | Vercel **Pro** (required for `maxDuration: 60` on `/api/sim/[gameId]`), auto-deploys from `main` |
| Production URL | `hrr-betting.vercel.app` |
| Repo | `github.com/lucasreydman/hrr-betting` (public) |

### Cron schedule (`vercel.json`)

- **Sim prewarming**: every 5 min during slate hours (10 AM – 11 PM Pacific) — iterates today's games, recomputes `/api/sim/[gameId]` for any whose `(lineupHash, weatherHash)` changed since last sim
- **Lock check**: every 5 min — for each game, if lock trigger conditions clear (see §5.4), snapshot Tracked picks to `picks:locked:YYYY-MM-DD`
- **Settle previous day**: 3 AM Pacific daily — runs `/api/settle`, pulls boxscores, marks HIT/MISS

---

## 7. Vercel KV schema

Mirrors yrfi/nrfi naming patterns:

| Key | Purpose | TTL |
|---|---|---|
| `picks:current:YYYY-MM-DD` | Current ranked picks for today's slate (refreshed every 5 min) | 24h |
| `picks:locked:YYYY-MM-DD` | Tracked picks snapshotted at lock-time (immutable) | 60d |
| `picks:settled:YYYY-MM-DD` | Locked picks with HIT/MISS appended after settlement | 365d |
| `sim:{gameId}:{lineupHash}` | Per-game 10k-iter sim result (all 9 batters' HRR distributions) | 24h |
| `sim-meta:{gameId}` | Latest `(lineupHash, weatherHash)` and sim timestamp for invalidation check | 24h |
| `p-typical:{playerId}:YYYY-MM-DD` | Cached P_typical replay-sim per player | 24h |
| `pitcher-tto:{pitcherId}:YYYY-MM-DD` | Cached pitcher-specific TTO splits | 7d |
| `pitcher-ipcdf:{pitcherId}:YYYY-MM-DD` | Cached starter IP CDF (with fallback tier metadata) | 7d |
| `bullpen-tiers:{teamId}:WEEK` | Leverage-tier bullpen rates per team | 7d |
| `metrics:rolling:{rung}` | Pre-computed rolling 30-day stats per rung | 1h |
| `metrics:calibration` | Brier score history per rung | 1h |
| `savant:{statKey}` | Reused yrfi/nrfi pattern — Savant CSV cache | 12h |
| `weather:{venueId}:{gameDate}` | Reused yrfi/nrfi pattern — weather lookup | 1h |

---

## 8. File structure

```
hrr-betting/
├── app/
│   ├── api/
│   │   ├── picks/route.ts          ← daily picks endpoint (reads cached sim results)
│   │   ├── sim/[gameId]/route.ts   ← per-game 10k-iter Monte Carlo, maxDuration: 60
│   │   ├── lock/route.ts           ← cron-triggered Tracked-pick snapshotting
│   │   ├── history/route.ts        ← settled-history endpoint
│   │   └── settle/route.ts         ← cron-triggered settlement
│   ├── page.tsx                    ← main board
│   ├── history/page.tsx
│   ├── methodology/page.tsx
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ClientShell.tsx
│   ├── BoardSection.tsx            ← per-rung pick list
│   ├── PickRow.tsx                 ← individual pick with badge
│   ├── HistoryChart.tsx
│   ├── CalibrationTable.tsx
│   └── methodology/                ← factor cards, formula blocks
├── lib/
│   ├── mlb-api.ts                  ← schedule, lineup, boxscore
│   ├── savant-api.ts               ← Statcast CSV cache (yrfi pattern)
│   ├── weather-api.ts              ← Open-Meteo (yrfi pattern)
│   ├── park-factors.ts             ← extended with HR-specific factors
│   ├── kv.ts                       ← Vercel KV wrapper
│   ├── stabilization.ts            ← per-stat regression with anti-over-shrink
│   ├── rates.ts                    ← season/L30/L15 blend + handedness splits
│   ├── per-pa.ts                   ← log-5 + Statcast hybrid distribution
│   ├── tto.ts                      ← times-through-order multipliers
│   ├── bullpen.ts                  ← leverage-tier rates
│   ├── lineup.ts                   ← reuse bvp-betting estimation logic
│   ├── starter-share.ts            ← P(starter still in) per PA
│   ├── sim.ts                      ← lineup-aware Monte Carlo (10k iters)
│   ├── edge.ts                     ← P_matchup, P_typical, EDGE, SCORE
│   ├── confidence.ts               ← hard gates + graded multiplier
│   ├── tracker.ts                  ← lock snapshot, settle, metrics
│   └── types.ts
├── __tests__/                      ← Jest unit tests (yrfi pattern)
├── scripts/
│   └── recalibrate.ts              ← post-30-day floor recalibration
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-26-hrr-betting-design.md   ← this file
├── public/
│   ├── favicon.svg
│   └── og-image.png
├── README.md
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── vercel.json
└── .gitignore
```

---

## 9. Acceptance criteria (v1)

- [ ] All three pages render — main board with placeholder data shows 1+/2+/3+ sections, history page shows zero-state correctly, methodology renders fully
- [ ] MLB Stats API integration: schedule, probable pitchers, lineups (confirmed + recent-start estimation), boxscore retrieval
- [ ] Baseball Savant integration: per-batter and per-pitcher Statcast metrics (barrel%, hard-hit%, xwOBA, exit velo)
- [ ] Open-Meteo weather + 30-stadium park factor lookups (extended with HR-specific factors)
- [ ] Stabilization module with player-career-rate prior + per-stat sample sizes; raw vs stabilized debug output
- [ ] Recent-form blend (season/L30/L15) with period-aware weights
- [ ] Per-PA outcome distribution (log-5 + Statcast hybrid) — unit-tested against known sabermetric examples
- [ ] Lineup-aware Monte Carlo simulator runs 10k iterations per game in < 5s
- [ ] TTO multipliers (pitcher-specific with league-avg fallback)
- [ ] Leverage-tier bullpen handling (high-leverage vs rest, by handedness)
- [ ] BvP layer applied with regression and starter-share weighting
- [ ] EDGE / SCORE computed per pick per rung; per-rung sort
- [ ] Confidence factor (hard gates + graded multiplier) wired through
- [ ] Tracked vs Watching tier logic with starting floor values
- [ ] Lock-time snapshot endpoint
- [ ] Auto-settle cron at 3 AM Pacific runs and updates settled history
- [ ] 30-day rolling Tracked hit rate displayed on `/history`
- [ ] Brier score calibration row per rung on `/history`
- [ ] Methodology page documents every factor, formula, source

---

## 10. Out of scope (v1)

- **Book odds integration** — comparing EDGE to actual sportsbook lines (we output break-even-style probs only)
- **Discord notifications** (yrfi/nrfi pattern) — could add post-launch
- **Mobile-specific layouts** — responsive web only for v1
- **Automated recalibration** — `scripts/recalibrate.ts` is manual run for v1; surfaces suggested floor adjustments based on settled history
- **Backtest harness** with full historical data ingestion — separate v2 effort once a few months of forward-tracked picks exist
- **Pitcher-specific TTO when sample is < 5 starts** — falls back to league averages until enough data accumulates
- **2023+ ghost-runner extras rule** — not modeled; introduces a known minor downward bias on HRR for batters who play into extras (~8% of games). Revisit if 3+ Brier shows consistent miscalibration during extras-heavy stretches.

---

## 11. Calibration / future-tuning placeholders

These values are intentional placeholders that will be tuned from data after ~30 days of settled picks:

- Stabilization weight schedule (`w_season`, `w_L30`, `w_L15`) per period of season
- Tracked floor values per rung (EDGE + P_matchup)
- TTO multiplier magnitudes when pitcher-specific data unavailable
- Statcast adjustment magnitudes (barrel boost factor, hard-hit boost factor, etc.)
- Park HR-specific factors (calibrate from recent home-run rate splits)
- Confidence multiplier ranges per input

`scripts/recalibrate.ts` is the audit tool that suggests adjusted values based on Brier score per rung and hit-rate-by-EDGE-bucket analysis.

---

## 12. Key references

- bvp-betting README: BvP regression formula, lineup estimation logic
- bet-yrfi README: Poisson model, stabilization taper, free-API stack
- bet-nrfi README: same stack, complementary side of first-inning prop
- Russell Carleton (Baseball Prospectus): empirical stabilization sample sizes per stat
- The Book: log-5 / odds-ratio framework for batter-vs-pitcher modeling
- Tom Tango: TTO penalty research

---

## 13. Sequencing

1. ✅ Brainstorming complete — design approved
2. ✅ Repo created (`lucasreydman/hrr-betting`), spec doc committed
3. ⏳ Spec review loop (spec-document-reviewer)
4. ⏳ User reviews + approves spec
5. ⏳ Move to `superpowers:writing-plans` to produce implementation plan
6. ⏳ Implementation in phases (per the plan)
