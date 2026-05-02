# Methodology Audit — 2026-05-02

Reverse-engineered from the codebase to back the rewritten `/methodology`
page. Every claim on that page must be traceable to a row in this doc.

## Files inspected (production code paths only)

- `lib/constants.ts` — floors, league averages, TTO multipliers, slot PA
- `lib/edge.ts` — `computeEdge`, `computeScore`
- `lib/prob-today.ts` — closed-form `probToday` (odds-ratio composition)
- `lib/factors/pitcher.ts` · `park.ts` · `weather.ts` · `handedness.ts` · `bullpen.ts` · `pa-count.ts`
- `lib/p-typical.ts` — baseline cache reader + offline computer
- `lib/offline-sim/sim.ts` — Monte Carlo engine (`simSinglePlayerHRR`)
- `lib/offline-sim/baserunner.ts` — bases / runs / RBIs state machine
- `lib/per-pa.ts` — per-PA log-5 helper (NOT called from production)
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
- **Rate prior**: full-season `outcomeRates` from `fetchBatterSeasonStats`, stabilized via `stabilizeRates(observed, LEAGUE_AVG_RATES, pa)` — **prior is league average**, not career
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

| Factor | Source | Range |
|---|---|---|
| `lineup` | `lineupStatus` | confirmed 1.00 / partial 0.85 / estimated 0.70 |
| `bvp` | career AB vs starter | linear 0.90 → 1.00 over 0–20 AB |
| `pitcherStart` | recent starts available | 0.90 at ≤3 → 1.00 at ≥10 |
| `weather` | `weatherStable` boolean | stable 1.00 / volatile 0.90 |
| `time` | minutes to first pitch | 1.00 ≤ 90 min → 0.95 ≥ 240 min |
| `opener` | `isOpener` boolean | normal 1.00 / opener 0.90 |
| `sampleSize` | batter season PA | 0.85 at 0 PA → 1.00 at ≥200 PA |
| `dataFreshness` | maxCacheAgeSec | 1.00 ≤ 5 min → 0.90 ≥ 30 min |

### Hard gates

- **File**: `lib/confidence.ts:passesHardGates`
- Drops the pick if any: `gameStatus === 'postponed'`, `probableStarterId == null`, `lineupStatus == null`, `expectedPA < 3`
- `expectedPA` is hardcoded to 4 in the ranker — that gate never trips today

### Tracked / watching classification

- **File**: `lib/ranker.ts:classifyTier`
- **Tracked** iff all three: `confidence ≥ 0.85`, `edge ≥ EDGE_FLOORS[rung]`, `pMatchup ≥ PROB_FLOORS[rung]`
- Floors: `EDGE_FLOORS = {1:0.10, 2:0.30, 3:0.60}`; `PROB_FLOORS = {1:0.85, 2:0.55, 3:0.20}`; `CONFIDENCE_FLOOR_TRACKED = 0.85`
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
| Settle | 10:00 UTC daily (6 AM ET) | `/api/settle` → `tracker.ts:settlePicks` | Reads previous slate's `locked_picks`, fetches boxscores, upserts to `settled_picks` |

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

## Inconsistencies between prior UI copy and actual code

Each row needs the methodology page rewritten to match.

| Old claim (existing methodology page) | Reality |
|---|---|
| "1,000 iterations per game" | 20,000 iterations, **per player**, offline only. Request time is closed-form. |
| "Regression target is the player's career rate" | Code uses `LEAGUE_AVG_RATES` as the prior in `stabilizeRates`. Career rates aren't read anywhere in production. |
| "Per-PA distribution = batter × pitcher_rate / lg × park × weather × tto" | `computePerPA` exists in `lib/per-pa.ts` but is **not called from production**. The offline sim feeds raw stabilized batter rates straight into the engine; pitcher / park / weather / TTO never enter the per-PA layer. They enter at the closed-form factor stage at request time. |
| "Bullpen leverage tier — high-leverage vs rest, weighted by PA index" | The live `computeBullpenFactor` uses **team season ERA × slot share**, not tier-of-relief rates. The tier-rate fetcher exists (`lib/mlb-api.ts:fetchBullpenStats` returns `highLeverage`/`rest`) but isn't wired into the request-time factor. |
| "TTO penalty applied per outcome" | `TTO_MULTIPLIERS` exist in `constants.ts` but no code path applies them today. |
| "Display floor SCORE ≥ 0.10" | Actual `DISPLAY_FLOOR_SCORE = 0.05`. |
| "Confidence depends on weather stability and opener risk" | These multipliers exist in `computeConfidence` but the ranker passes constants: `weatherStable: true`, `isOpener: false`, `maxCacheAgeSec: 0`. Until those are wired to real signals, these factors are inert. |
| "Career BvP feeds the per-PA rate" | Career BvP only feeds the `bvp` confidence multiplier (0.90–1.00 ramp on AB). It's not in any per-PA rate path. |

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

Cron (10 UTC daily)
  → /api/settle → reads locked_picks, fetchBoxscore, upsert settled_picks

Render: /history
  → reads settled_picks ≥ slateDateString() − 30 days
  → computeRollingMetrics (Brier, predicted avg, hit rate per rung)
```

---

## Pages / components changed

- `app/methodology/page.tsx` — full rewrite from this map
- `docs/methodology-audit.md` — this file

## Recommended follow-up fixes (not in this PR)

1. Wire `weatherStable`, `isOpener`, `maxCacheAgeSec` to real signals in the ranker so the corresponding confidence factors stop being constants.
2. Decide whether `lib/per-pa.ts` (and the `TTO_MULTIPLIERS` it would consume) should be wired into the offline sim's rate construction, or removed.
3. Tune the placeholder tracked-tier floors once 30+ days of settled history exists (`npm run recalibrate`).
4. Bullpen factor: either wire the `highLeverage` / `rest` tier rates into the request-time factor, or remove them from the data layer.
5. Consider using batter career rates (when available) as the `stabilizeRates` prior instead of league average — would preserve true skill differences in the baseline.
