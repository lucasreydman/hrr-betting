# Methodology Audit — 2026-05-02 (refreshed 2026-05-04)

Reverse-engineered from the codebase to back the rewritten `/methodology`
page. Every claim on that page must be traceable to a row in this doc.

> **Refresh note (2026-05-04):** drift items resolved during the production-grade
> sweep:
>
> - Two more closed-form factors landed since this doc was first written —
>   `lib/factors/bvp.ts` and `lib/factors/batter.ts` — bringing the total to
>   eight: pitcher, park, weather, handedness, bullpen, paCount, bvp, batter.
> - The weather factor is now an HRR-weighted multi-outcome composite (not the
>   old `1 + 0.6 × (hrMult − 1)` HR-only formula).
> - The park factor is now a 5-input composite (not the old 3-input).
> - Tracked-tier floors were retuned: `EDGE_FLOORS = {1: 0.10, 2: 0.20, 3: 0.30}`
>   and `PROB_FLOORS = {1: 0.80, 2: 0.60, 3: 0.40}`. The 0.85/0.55/0.20 +
>   0.10/0.30/0.60 layout in this doc reflects the pre-pitcher-fix calibration.
> - `lib/per-pa.ts` and `lib/factors/tto.ts` do not exist — TTO is applied
>   per-PA inside the offline sim (`lib/p-typical.ts:applyTto`), not as a
>   separate factor at request time.
> - Settle cron runs at **3:15 AM ET / 7:15 UTC** (the smallest safe gap after
>   the 3 AM ET rollover), not the 6 AM ET / 10 UTC noted below.

## Files inspected (production code paths only)

- `lib/constants.ts` — floors, league averages, TTO multipliers, slot PA
- `lib/edge.ts` — `computeEdge`, `computeScore`
- `lib/prob-today.ts` — closed-form `probToday` (odds-ratio composition)
- `lib/factors/pitcher.ts` · `park.ts` · `weather.ts` · `handedness.ts` · `bullpen.ts` · `pa-count.ts`
- `lib/p-typical.ts` — baseline cache reader + offline computer
- `lib/offline-sim/sim.ts` — Monte Carlo engine (`simSinglePlayerHRR`)
- `lib/offline-sim/baserunner.ts` — bases / runs / RBIs state machine
- `lib/stabilization.ts` — `stabilize`, `stabilizeRates`, `stabilizeScalar`
- `lib/confidence.ts` — `computeConfidence`, `computeConfidenceBreakdown`, `passesHardGates`
- `lib/ranker.ts` — orchestration, `classifyTier`, live-settle
- `lib/tracker.ts` — lock + settle, history aggregation
- `lib/mlb-api.ts` — schedule, lineup, season stats, boxscore, BvP, bullpen
- `lib/weather-factors.ts` — temp/wind multipliers used inside `factors/weather.ts`
- `lib/lineup.ts` — re-export + lineup hash
- `lib/bullpen.ts` — team bullpen ERA fetcher
- `app/api/picks/route.ts` · `refresh/route.ts` · `lock/route.ts` · `settle/route.ts` · `sim/typical/route.ts`
- `components/PickRow.tsx` — `americanOdds`, math panel
- `components/Board.tsx` — universe quotas, filter logic
- `.github/workflows/cron.yml` — schedule

---

## Implementation map

### `probTypical` — baseline "typical matchup" probability

- **File**: `lib/p-typical.ts`
- **Public reader**: `getPTypical(playerId)` — **cache-only**, returns league-average fallback `[1.0, 0.65, 0.30, 0.10, 0.03]` on miss
- **Heavy compute**: `computeTypicalOffline(playerId)` — runs only via offline cron (`/api/sim/typical`)
- **Iterations**: `ITERATIONS = 20_000`
- **Method**: per-player Monte Carlo via `simSinglePlayerHRR` from `lib/offline-sim/sim.ts`
- **Sim**: 9 innings, 18-batter game, target placed at lineup slot 4 (mid-order); other 17 batters drive league-average outcomes
- **Rate prior**: full-season `outcomeRates` from `fetchBatterSeasonStats`, stabilized via `stabilizeRates(observed, prior, pa)` — prior is the player's **career outcomeRates** when `fetchBatterCareerStats` returns ≥ 200 PAs, otherwise `LEAGUE_AVG_RATES`
- **Output**: `atLeast[k] = P(HRR ≥ k)` for k ∈ {0,1,2,3,4}
- **Cache**: key `typical:v1:{playerId}`, TTL 14 days
- **Cron warm**: Sunday 4 AM ET full sweep; Mon–Sat 4 AM ET slate-batter sweep
- **Notes**:
  - Same rates used for "vs starter" and "vs bullpen" inside the sim — no opponent context in the baseline
  - `starterShareByPA = [0.95, 0.85, 0.65, 0.40, 0.10]` (constant; not pitcher-specific)

### `probToday` — today-adjusted probability

- **File**: `lib/prob-today.ts:computeProbTodayWithBreakdown`
- **Method**: **closed-form, odds-ratio composition** (no per-game sim at request time)
- **Formula**:
  ```
  factorProduct = clamp(pitcher × park × weather × handedness × bullpen × paCount, 0.25, 4.0)
  oddsTypical   = pTypical / (1 - pTypical)
  oddsToday     = oddsTypical × factorProduct
  probToday     = oddsToday / (1 + oddsToday)         (clamped 0.001..0.999)
  ```
- **Cost**: sub-millisecond per pick — runs on every `/api/picks` request
- **`pTypical` clamp**: 0.001..0.999 before odds conversion
- **Where called**: `lib/ranker.ts` per (player, rung)

### Factors (all clamped, all multiplicative on the odds ratio)

| Factor | File | Range | Logic |
|---|---|---|---|
| Pitcher | `lib/factors/pitcher.ts` | [0.5, 2.0] | TBD (id 0) or <3 recent starts → 1.0. Else: stabilize K/BB/HR/HardHit vs league. `quality = (1/kRatio) × (1/bbRatio) × hrRatio × hhRatio`. |
| Park | `lib/factors/park.ts` | [0.7, 1.3] | Unknown venue → 1.0. Else FanGraphs 2025 per-handedness: `composite = 0.50×hit + 0.25×run + 0.25×hr`. |
| Weather | `lib/factors/weather.ts` | [0.85, 1.20] | Domes / fetch failures → 1.0. Else `1 + 0.6 × (hrMult − 1)`. The 0.6 dampens HR-only multiplier into HRR (most HRR is singles). |
| Handedness | `lib/factors/handedness.ts` | {0.97, 1.00, 1.03} | Switch hitter → 1.00. Same-side → 0.97. Opposite → 1.03. |
| Bullpen | `lib/factors/bullpen.ts` | [0.85, 1.15] | Null bullpen → 1.0. Else `1 + share × (qualityRatio − 1)` where share by lineup slot (`paShareVsBullpenBySlot`) and `qualityRatio = stabilizedERA / LG_BULLPEN_ERA`. |
| PA count | `lib/factors/pa-count.ts` | [0.85, 1.15] | Bernoulli scaling for slot-specific expected PA (`expectedPAByLineupSlot`) vs league-mean PA (4.20). |

### `weather hrMult` (input to weather factor)

- **File**: `lib/weather-factors.ts:computeWeatherFactors`
- Temp: `tempHrMult = 1 + 0.015 × (tempF − 70) / 10` (~1.5%/10°F)
- Wind projection: `outMph = −cos(windFromDeg − outfieldFacingDeg) × windSpeedMph`
- Wind effect: `windHrEffect = clamp(0.02 × outMph, ±0.25)` (~2%/mph, ±25% cap)
- Combined HR: `clamp(tempHrMult × (1 + windHrEffect), 0.65, 1.40)`
- Domes / fetch failures → neutral 1.0
- 2B/3B: small positive temp-only carry; 1B/BB/K: 1.00

### Edge

- **File**: `lib/edge.ts:computeEdge`
- **Formula**: `edge = max(pMatchup, 0.01) / max(pTypical, 0.01) − 1`
- Both floored at 1% so two tiny probabilities don't produce a misleading huge edge

### Score

- **File**: `lib/edge.ts:computeScore`
- **Formula**:
  ```
  kelly = (pMatchup − pTypical) / max(1 − pTypical, 0.01)
  score = kelly × confidence
  ```
- The default sort on the board

### Confidence

- **File**: `lib/confidence.ts:computeConfidenceBreakdown`
- Product of 8 multiplicative factors:

| Factor | Source | Signal | Range |
|---|---|---|---|
| `lineup` | `lineupStatus` from `fetchLineup` | three-tier | confirmed 1.00 / partial 0.85 / estimated 0.70 |
| `bvp` | career AB vs starter from `fetchBvP` | sample size | 0.90 at 0 AB → 1.00 at ≥20 AB |
| `pitcherStart` | recent starts count | sample size | 0.90 at ≤3 → 1.00 at ≥10 |
| `weather` | derived in ranker: `controlled \|\| failure \|\| abs(hrMult-1) < 0.10` | stability boolean | stable 1.00 / volatile 0.90 |
| `time` | minutes to first pitch | continuous | 1.00 ≤ 90 min → 0.95 ≥ 240 min |
| `opener` | derived in ranker: `recentStarts ≥ 3 && avgIp < 2.0` | boolean | normal 1.00 / opener 0.90 |
| `sampleSize` | batter season PA | continuous | 0.85 at 0 PA → 1.00 at ≥200 PA |
| `dataFreshness` | `getScheduleAgeSec(date)` schedule-cache age | continuous | 1.00 ≤ 5 min → 0.90 ≥ 30 min |

### Hard gates

- **File**: `lib/confidence.ts:passesHardGates`
- Drops the pick if any: `gameStatus === 'postponed'`, `probableStarterId == null`, `lineupStatus == null`, `expectedPA < 3`
- `expectedPA` is hardcoded to 4 in the ranker — that gate never trips today

### Tracked / watching classification

- **File**: `lib/ranker.ts:classifyTier`
- **Tracked** iff all three: `confidence ≥ 0.85`, `edge ≥ EDGE_FLOORS[rung]`, `pMatchup ≥ PROB_FLOORS[rung]`
- Floors (current, post-pitcher-fix): `EDGE_FLOORS = {1:0.10, 2:0.20, 3:0.30}`; `PROB_FLOORS = {1:0.80, 2:0.60, 3:0.40}`; `CONFIDENCE_FLOOR_TRACKED = 0.85`
- Else **watching** if `score ≥ DISPLAY_FLOOR_SCORE` (= 0.05)
- Else dropped

### Universe / per-rung quotas (board UI)

- **File**: `components/Board.tsx:RUNG_QUOTAS`
- `{1: 15, 2: 10, 3: 5}` → 30 plays max per slate
- Tracked picks for each rung always show (not capped); watching picks fill remaining slots up to the quota, sorted by score

### American odds (UI conversion only)

- **File**: `components/PickRow.tsx:americanOdds`
- Pure probability → American moneyline. No book odds ingested anywhere.

### Lineup status

- **File**: `lib/mlb-api.ts:fetchLineup`
- 3-tier fallback: boxscore batters (live game) → schedule lineups (≥9 = confirmed, <9 = partial) → estimated from 14-day batting-order history
- Status-aware TTL: confirmed 6h, partial/estimated 2 min

### Slate boundary

- **File**: `lib/date-utils.ts:slateDateString`
- ET, **3 AM rollover** (the standard DFS / sportsbook convention)

### Lifecycle

| Stage | Cron / Trigger | Code | Purpose |
|---|---|---|---|
| Pick generation | `/api/picks` (30s server cache) | `lib/ranker.ts:rankPicks` | Ranks every (player, rung) on the slate |
| Refresh | every 2 min during slate hours | `/api/refresh` | Invalidates picks cache + recomputes |
| Lock | every 5 min during slate hours | `/api/lock` → `tracker.ts:snapshotLockedPicks` | Inserts Tracked picks into `locked_picks` once a game's lock window opens (confirmed lineup ≤90 min before first pitch, OR ≤30 min regardless) |
| Live-settle | inside `/api/refresh` | `lib/ranker.ts` post-loop | For finalised games, fetches boxscore and stamps `outcome` + `actualHRR` on every pick (for live board display only) |
| Settle | 7:15 UTC daily (3:15 AM ET) | `/api/settle` → `tracker.ts:settlePicks` | Reads previous slate's `locked_picks`, fetches boxscores, upserts to `settled_picks` |

### Cache TTLs

| Key | TTL | Notes |
|---|---|---|
| `picks:current:{date}` | 30 s | Page cache |
| `hrr:schedule:v4:{date}` | 2 min | After dedupe via `dedupeGamesByMatchup` |
| `hrr:lineup:...` (confirmed) | 6 h | Stable post-posting |
| `hrr:lineup:...` (partial/estimated) | 2 min | Catches transitions fast |
| `hrr:probables:{gameId}` | 1 h |  |
| `hrr:boxscore:v2:{gameId}` | 6 h final / 2 min in-progress / 5 min fallback | Status-aware |
| `typical:v1:{playerId}` | 14 days | Offline-only writer |
| Cumulative slate caches: BvP, season stats, recent starts, bullpen, savant, gamelog, slot frequency | 24 h, slate-aligned key | Frozen across the slate by including `slateDateString()` in the key — cumulative data can't shift mid-game |

---

## Inconsistencies that were in the original page

All resolved by the methodology rewrite + follow-up commits. Kept here
as a record so the next audit knows what was intentionally fixed.

| Old claim | Resolution |
|---|---|
| "1,000 iterations per game" | Page now says 20,000, per-player, offline only. |
| "Regression target is career rate" | Was wrong before; **now true** after the follow-up wired career rates as the prior when ≥ 200 PAs exist. |
| "Per-PA distribution = batter × pitcher_rate / lg × park × weather × tto" | The dead `computePerPA` was deleted. Page describes the actual closed-form factor stage. |
| "Bullpen leverage tier" | Tier code deleted. Page describes the team-aggregate-ERA × slot-share factor that actually runs. |
| "TTO penalty applied per outcome" | `TTO_MULTIPLIERS` deleted. Page lists "no TTO" under model limits. |
| "Display floor SCORE ≥ 0.10" | Page corrected to 0.05. |
| "Confidence depends on weather stability and opener risk" | Three confidence factors are now real signals (weather hrMult deviation, recent-start avg IP, schedule-cache age). |
| "Career BvP feeds the per-PA rate" | Page is explicit: BvP enters confidence only. |

---

## Suspicious / fragile logic worth noting

- **Tracked floors are placeholders** (per `constants.ts` comments): `EDGE_FLOORS`, `PROB_FLOORS`, `CONFIDENCE_FLOOR_TRACKED`, `DISPLAY_FLOOR_SCORE` all need ≥30 days of settled history before they can be tuned. `npm run recalibrate` exists for this.
- **Boxscore parser fallback** (`lib/mlb-api.ts:fetchBoxscore`): if `gameData` is missing AND `playerStats` ≥ 9, infers `'final'`. Defensible but has a non-zero false-positive risk if MLB ever ships gameData-less responses mid-game. Documented in code.
- **`expectedPA` hardcoded to 4** in `lib/ranker.ts` for the hard-gate check — the gate effectively never trips on this dimension.
- **Confidence inputs hardcoded** (`weatherStable`, `isOpener`, `maxCacheAgeSec`) — three of eight confidence factors are currently constants.

---

## Data flow summary

```
Cron (Sun 4am ET full / Mon-Sat 4am ET slate)
  → /api/sim/typical
    → computeTypicalOffline(playerId)
      → fetchBatterSeasonStats → outcomeRates
      → stabilizeRates(rates, LEAGUE_AVG_RATES, pa)
      → simSinglePlayerHRR (20k iter, 9 inn, slot 4)
        → simHalfInning × 18 (ratesVsStarter[paIdx], ratesVsBullpen[paIdx], starterShareByPA)
          → applyOutcome(bases, outcome) → runs/RBIs/hits
      → atLeast[0..4]
    → cache `typical:v1:{playerId}` (14d)

Request: /api/picks
  → fetchSchedule (deduped via dedupeGamesByMatchup)
  → for each game (parallel via Promise.all):
      → fetchLineup × 2, fetchProbablePitchers, fetchWeather
      → fetchPitcherSeasonStats, fetchPitcherRecentStarts, getPitcherStatcast × 2
      → fetchBullpenStats × 2
      → for each batter (Promise.all):
          → getPTypical (cache-only)
          → fetchBvP, fetchBatterSeasonStats
          → for each rung 1/2/3:
              → computeProbTodayWithBreakdown (factor product, odds-ratio compose)
              → computeEdge, computeScore
              → classifyTier → tracked / watching / null
  → after main loop: live-settle for finalised games via fetchBoxscore
  → cache 30s, return JSON

Cron (every 5 min during slate)
  → /api/lock → snapshotLockedPicks (insert-only into locked_picks)

Cron (7:15 UTC daily / 3:15 AM ET)
  → /api/settle → reads locked_picks, fetchBoxscore, upsert settled_picks

Render: /history
  → reads settled_picks ≥ slateDateString() − 30 days
  → computeRollingMetrics (Brier, predicted avg, hit rate per rung)
```

---

## Pages / components changed

- `app/methodology/page.tsx` — full rewrite from this map
- `docs/methodology-audit.md` — this file

## Recommended follow-up fixes — status

All five resolved on 2026-05-02. Diff lives in commit message of the
follow-up-fixes commit.

### 1. Wire confidence signals (was: three inert factors) — RESOLVED

- `weatherStable`: now derived from the weather result —
  `controlled || failure || abs(hrMult - 1) < 0.10`. Domes / failed
  forecasts treated as stable; mid-temp / light-wind games stable;
  high-impact weather flips to volatile.
- `isOpener`: now derived from recent-starts IP — fires when the listed
  starter has ≥ 3 recent starts averaging under 2 IP per outing.
- `maxCacheAgeSec`: now reads schedule-cache age via the new
  `getScheduleAgeSec(date)` helper. Schedule has the shortest TTL
  (2 min) and is the canonical live-state signal — its age is the
  best single proxy for "is the cron hitting us on time?"

### 2. Dead code removed — RESOLVED (with one reversal)

`lib/per-pa.ts`, `lib/tto.ts`, and their tests deleted. `TTO_MULTIPLIERS`,
`LG_BARREL_PCT`, `LG_HARD_HIT_PCT`, `LG_WHIFF_PCT` removed from
`lib/constants.ts`. Comments in `lib/park-factors.ts` and
`lib/weather-factors.ts` that referenced `computePerPA` updated to
describe the closed-form factor stage that actually consumes them.

**Note (2026-05-03 follow-up):** `TTO_MULTIPLIERS` was reinstated in
`lib/constants.ts` once the new `lib/factors/tto.ts` factor was wired
into `prob-today.ts`. Same data, now actively consumed.

### 3. Tracked-tier floor recalibration — TOOLING UPGRADED

Cannot tune values yet (≥ 30 days of settled history is the gating
condition and we are not there). `scripts/recalibrate.ts` now prints
specific recommended `EDGE_FLOORS[rung]` values when sufficient data
exists, instead of leaving the operator to eyeball the bucket table.
Re-run quarterly.

### 4. Bullpen tier rates removed — RESOLVED

`getBullpenTiers`, `weightForPA`, and `fetchTeamBullpenStats` deleted —
they were dead code (only the team-aggregate ERA path is used by the
request-time factor in `lib/factors/bullpen.ts`). The `BullpenStats`
type was removed from `lib/types.ts` and the corresponding tests pruned.

### 5. Career rates as stabilization prior — RESOLVED

New `fetchBatterCareerStats(playerId)` in `lib/mlb-api.ts` (30-day TTL,
defensively cached even on null). `lib/p-typical.ts:computeTypicalOffline`
uses career outcome rates as the prior in `stabilizeRates` when ≥ 200
career PAs exist. Falls back to `LEAGUE_AVG_RATES` otherwise. This
preserves true skill differences for veterans (a career .280 hitter
isn't regressed all the way to the .240 league mean by a small
current-season sample).

---

## Underused signals — wired in 2026-05-03

The previous audit listed five fetched-but-unused data sources. All five
now contribute to `p̂ today` via dedicated factor functions.

### a. BvP results — RESOLVED

New `lib/factors/bvp.ts` exposes `computeBvpFactor`. Empirical-Bayes
shrinks observed wOBA-equivalent from career line vs the starter toward
league wOBA (0.310) using a 600-PA stabilization point. Returns 1.0 for
< 5 career AB. Bounded [0.90, 1.10]. Consumed by `lib/prob-today.ts`.

### b. Batter Statcast — RESOLVED, then fixed (2026-05-03)

First pass: new `lib/factors/batter.ts` exposes `computeBatterFactor`.
Reads `getBatterStatcast` from `lib/savant-api.ts` and composes
barrel% / hard-hit% / xwOBA against league averages, dampened by an
exponent of 0.25 since `pTypical` already encodes most batter skill.
Bounded [0.95, 1.05]. Wired into the ranker's per-batter parallel
fetch block.

**Bug found (2026-05-03):** the `lib/savant-api.ts` parser had a TODO
to verify column names; turned out the live Savant CSV uses `brl_percent`
/ `ev95percent` / `est_woba` (split across two endpoints), not the
`barrel_batted_rate` / `hard_hit_percent` / `xwoba` the parser
expected. Every batter and pitcher Statcast record was silently
all-zero, meaning:

- The `batter` p̂ today factor was clamped to its `0.95` floor for
  every player (zeros / league > 0 → near-zero, clamped).
- The pitcher factor's `hardHit` term was also broken — for any pitcher
  with a non-zero `bf` count, the stabilization weight pulled the
  hardHit ratio toward zero, dropping the pitcher quality multiplier
  and meaningfully suppressing pToday for batters facing those pitchers.

**Fix:** parser updated with real column names. xwOBA now merges from
the second `expected_statistics` endpoint via `mergeBatterXwobaCsv` /
`mergePitcherXwobaCsv`. Cache key bumped `savant:*:v1:*` → `v2`. SQL
migration `20260503000000_clear_savant_v1_cache.sql` flushes the bad
v1 rows. Tests rewritten against the real column names; 14 / 14 pass.

### c. TTO multipliers — RESOLVED, then refined

First pass: new `lib/factors/tto.ts` composed `TTO_MULTIPLIERS`
(PAs 1, 2, 3) into a single HRR-weighted multiplier (~1.08) and applied
it uniformly at request-time.

**Refined (same-day):** moved into the offline sim. New
`lib/p-typical.ts:applyTto` multiplies non-OUT outcome rates by the
per-outcome TTO multipliers for PA indices 0/1/2 (TTO 1/2/3 against
starter), then renormalises. PA 3+ rates pass through unchanged
(those are bullpen PAs). The closed-form TTO factor was deleted. This
lets TTO compound correctly through the baserunner state machine
(more contact → more baserunners → more RBI opportunities) and
implicitly varies by lineup slot via the `starterShareByPA` weighting,
instead of being a uniform constant lift on the binary "≥k HRR"
probability.

### d. Park K and BB factors — RESOLVED

`lib/factors/park.ts:computeParkFactor` was extended from a 3-component
composite (50% hit + 25% run + 25% HR) to a 5-component composite that
also weights `(1 / K_factor) × 0.10` and `BB_factor × 0.05`. New
exports `getKParkFactor` and `getBbParkFactor` in `lib/park-factors.ts`.

### e. Weather effects on hits — RESOLVED

`lib/factors/weather.ts:computeWeatherFactor` now accepts an optional
`factors: Partial<Record<Outcome, number>>` map. When supplied (always,
in production), composes weather across all HRR-relevant outcomes
(1B / 2B / 3B / HR / BB) weighted by HRR contribution. The legacy
"`1 + 0.6 × (hrMult − 1)`" path is kept as a fallback for any caller
that doesn't pass the full multiplier map. The new formulation agrees
with the dampened formula on mild weather and is more conservative at
extremes.

`computeProbTodayWithBreakdown` now exposes an 8-key `factors` object:
pitcher, park, weather, handedness, bullpen, paCount, bvp, batter.
TTO was briefly a 9th factor here; it now lives inside the offline sim
(see "TTO multipliers" entry above). Consumers that depended on the
6-key shape were updated (prob-today tests).
