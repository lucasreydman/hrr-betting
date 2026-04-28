# Hybrid Ranking Model Refactor — Design

**Date**: 2026-04-28
**Status**: Draft (pre-implementation)
**Owner**: lucasreydman

---

## 1. Goal

Refactor the HRR prop ranker to a **hybrid model**: a Monte Carlo simulation runs **offline (nightly)** to produce a stable per-player typical-game probability baseline (`probTypical`); at request time, a **closed-form formula** adjusts that baseline to today's matchup context (`probToday`). The closed-form layer is the user-visible model — every input has a labelled, testable, explainable contribution.

This is the design that came out of brainstorming on 2026-04-28 after evaluating three options:

- **Option A**: keep the per-game MC, focus only on freshness/UI improvements.
- **Option B**: full closed-form rewrite (no MC anywhere).
- **Option C**: hybrid (this spec).

B was rejected because the dependency structure of HRR (RBI ↔ baserunner state, R ↔ subsequent batters, joint H/R/RBI correlation) cannot be captured by a single closed-form formula without devolving into a Markov-chain solver — which is just a simulator written in linear algebra, with worse readability and a larger silent-bug surface than the current MC. C captures everything B promised (clean formula on top, fast at request time, explainable per-factor) without the structural fidelity loss.

The non-negotiable user requirements driving this design:

1. The user-visible math is a **single explainable formula**, not a black-box sim.
2. The board updates as upstream data changes (lineups confirm, weather shifts, pitcher announcements).
3. A **manual refresh button** that actually re-pulls upstream data and recomputes rankings.
4. Standardised columns: `PLAYER | GAME | PROB.TYPICAL | PROB.TODAY | EDGE | CONF | SCORE`.
5. No paid infrastructure. Free tier (Vercel Hobby + GitHub Actions) only.

## 2. Non-goals

- **Calibrating placeholder constants** (`EDGE_FLOORS`, `PROB_FLOORS`, `CONFIDENCE_FLOOR_TRACKED`, weather constants). Locked behind ≥30 days of settled history. Run `npm run recalibrate` after.
- **L30 / L15 rolling rate blend** in per-PA computation. Listed as v1 simplification in CLAUDE.md; deferred.
- **BvP layer in per-PA outcome rates**. Currently disabled; deferred (BvP still feeds the confidence factor).
- **Pitcher-specific TTO splits**. Needs Savant pitch-level data; deferred.
- **Opener detection**. Needs Savant pitch-by-pitch; deferred.
- **Live in-game updates**. The in-progress board (designed in the same brainstorm) is a flat list of tracked picks whose games are live, showing live HRR count from boxscore — no live model recomputation. Separate spec when we ship that feature.
- **Sub-10s freshness**. Would require websockets / paid Vercel tier.
- **A/B comparison of new vs old model in production**. We don't have the settled history to validate either way; we're picking the model that's structurally sounder and shipping.

## 3. Decision summary

| Aspect | Before | After |
|---|---|---|
| Ranking model | Per-game MC at request time | Offline MC for `probTypical` + closed-form `probToday` at request time |
| `probTypical` iterations | 500 × 10 games (~5,000 sample HRR draws) | 20,000 iterations per player (slot-4 baseline) |
| `probTypical` cadence | On-demand (TTL 24h) | Weekly full population + nightly slate-only refresh, both 4 AM ET |
| `probToday` compute | MC sim per game per request | Closed-form formula evaluation |
| Request-time MC | Yes (warmed by cron + ranker self-warm) | **None** |
| Cron load | Every 5 min during slate hours, full per-game sim | Every 2 min during slate hours, formula-only refresh |
| Refresh button | Implicit (poll-driven) | **Explicit `/api/refresh` button** |
| Freshness target | ~5-7 min worst case | ~30s typical, ~2 min worst case |
| Table columns | Score-driven row, repeated micro-labels | `PLAYER \| GAME \| PROB.TYPICAL \| PROB.TODAY \| EDGE \| CONF \| SCORE` |

## 4. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│         WEEKLY FULL TYPICAL CRON (Sunday 4 AM ET, off-slate)        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  POST /api/sim/typical {mode: 'full'} → orchestrator         │   │
│  │    → fans out 1 fetch per active batter (~750)               │   │
│  │  POST /api/sim/typical {mode: 'player', playerId} per call:  │   │
│  │    1. Fetch season game log + season rates                   │   │
│  │    2. Stabilize rates against league avg (Carleton)          │   │
│  │    3. Run 20k-iter MC vs league-avg opponent at slot 4       │   │
│  │       (one Vercel function call per player, ~10s each)       │   │
│  │    4. kvSet `typical:v1:{playerId}` → atLeast[0..3]          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│         NIGHTLY SLATE TYPICAL CRON (Mon-Sat 4 AM ET, off-slate)     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Build slate-batter list from fetchSchedule(tomorrow)        │   │
│  │  + fetchLineup per game (~150 unique batters)                │   │
│  │  Then: 1 POST /api/sim/typical {mode: 'player'} per batter   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               │ writes
                               ▼
                  ┌─────────────────────────────┐
                  │  Supabase `cache` table     │
                  │  key: typical:v1:{playerId} │
                  │  TTL: 14 days               │
                  └─────────────────────────────┘
                               ▲
                               │ reads
┌──────────────────────────────┴──────────────────────────────────────┐
│                  REQUEST PATH (/api/picks)                          │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  rankPicks(date):                                            │  │
│   │    For each game on the slate:                               │  │
│   │      1. Fetch lineup + probable + weather + park (parallel)  │  │
│   │      2. For each batter × rung:                              │  │
│   │         a. probTypical = kvGet `typical:v1:{playerId}`[rung] │  │
│   │            (lazy backfill: single 20k-iter sim if cache miss)│  │
│   │         b. probToday = computeProbToday({                    │  │
│   │              probTypical, pitcher, park, weather, handedness,│  │
│   │              bullpen, lineupSlot                             │  │
│   │            })                                                │  │
│   │         c. edge = (probToday/probTypical) − 1                │  │
│   │         d. confidence = computeConfidence(...)               │  │
│   │         e. score = edge × confidence                         │  │
│   │         f. classifyTier (tracked / watching / dropped)       │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  No simulation on the request path (except rare cold-miss backfill).│
│  Pure formula evaluation + upstream data reads.                     │
│  Latency = upstream-cache-hit cost (~50-200ms).                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                  SLATE REFRESH CRON (every 2 min, 1 PM ET → 3 AM ET)│
│   POST /api/refresh: invalidates upstream caches, calls rankPicks,  │
│   busts picks:current. Same code path as the manual refresh button. │
│   No MC. Pure formula re-evaluation against fresh upstream data.    │
└─────────────────────────────────────────────────────────────────────┘
```

### What goes away

- `/api/sim` orchestrator (no longer needed at request time)
- `/api/sim/[gameId]` (no longer needed; the per-game MC was the bottleneck)
- `warmMissingSims` self-warming logic in `lib/ranker.ts` (no sims to warm)
- `sim:{gameId}:{lineupHash}:{probableHash}` cache keys (deprecated)
- `sim-meta:{gameId}` cache keys (deprecated)
- The per-game iteration in cron.yml
- `lib/sim.ts` and `lib/build-context.ts` are **kept** but their only caller becomes the offline `probTypical` job. They're moved (logically, not necessarily by file) into a `offline-sim/` namespace; documented as offline-only.

### What stays

- `lib/per-pa.ts` (per-PA outcome rates — used by offline sim AND by the new closed-form `pitcher_factor`)
- `lib/baserunner.ts` (used by offline sim)
- `lib/p-typical.ts` (refactored: stops running MC at request time, becomes a thin reader of the offline cache)
- `lib/edge.ts` (formula unchanged)
- `lib/confidence.ts` (extended — new `dataFreshness` factor, see §11)
- `lib/tracker.ts` (lock + settle logic untouched)
- Cron lock + settle workflows (untouched)

## 5. The five metrics

Concrete formulas. Each lives in a centralised, unit-tested helper. Math files have no I/O.

### 5.1 `PROB.TYPICAL`

> "How often would this player typically clear this HRR rung in a normal context?"

**Source**: offline MC. Computed by `/api/sim/typical` (weekly full population + nightly slate refresh, both 4 AM ET — see §8.1), cached at `typical:v1:{playerId}` for 14 days. Read at request time via `lib/p-typical.ts#getPTypical()`.

**Definition** (offline computation):

```
Run 20,000-iter MC vs synthetic league-average lineup + starter + bullpen,
target batter at slot 4 (mid-order baseline) with stabilized season rates.

probTypical[k] = E[1{HRR ≥ k}]   for k ∈ {1, 2, 3}
```

This is a deliberate simplification from the previous multi-slot blend: rather than weighting by the player's slot frequency, we treat slot 4 (mid-order, league-avg PA expectation) as the canonical "typical context" and let `paCountFactor` in `probToday` (§5.2) absorb today's actual slot. Cleaner separation of concerns: `probTypical` measures the player's skill in a neutral context; `probToday` carries everything contextual including slot.

**Iteration count**: 20,000. Standard error on a probability of 0.5 with N=20k is ~0.71% — well below the 1% display precision and far below model bias (input quality dominates noise). Single-call execution: 20k × ~0.5 ms/iter = ~10 seconds, fits the Vercel Hobby 10s function limit without chunking. See §11 for the full justification of this choice over higher iteration counts.

**Stabilization**: per Russell Carleton, weighted shrinkage of season outcome rates toward league average using PA-based stabilization sample sizes (`STABILIZATION_PA` in `lib/constants.ts`, unchanged). A player with 50 PAs gets heavy regression; a player with 600 PAs barely shrinks. Existing logic in `lib/stabilization.ts` is preserved.

**Sample-size guards**:
- 0 games played → return league-avg fallback `{1: 0.65, 2: 0.30, 3: 0.10}`. Confidence factor will downweight via `dataFreshness` and `sampleSize`.
- < 20 PAs → flag in `inputs` so `confidence.sampleSize` factor can penalize.

**Lazy backfill on cache miss**: if a request hits a player not in cache (e.g., mid-day call-up), the ranker triggers a single inline 20k-iter sim before returning. Wall time ~10s, fits within the request's Vercel function budget. Result is cached, subsequent requests are free. Rare path — the nightly slate job pre-warms ~95% of cases.

**Variance reduction (optional, deferred)**: common random numbers between the player's MC and the synthetic league-average MC would tighten `probToday/probTypical` ratio noise. Not load-bearing for v1 with SE 0.71%; revisit if calibration shows the ratio variance matters.

**Cache**:
- Key: `typical:v1:{playerId}`
- Value: `{ atLeast: [1, p1, p2, p3], iterations, computedAt }`
- TTL: 14 days. Long enough that misses are rare during the season; short enough that any stale player data ages out within two refresh cycles.
- Refresh trigger: weekly cron (full population) + nightly cron (slate population). Manual refresh does NOT trigger a re-sim. `npm run recalibrate` does.
- Key prefix bumped from `p-typical:` → `typical:v1:` to invalidate any leftover request-time entries.

### 5.2 `PROB.TODAY`

> "Given today's matchup, how likely is this player to clear this HRR rung today?"

**Source**: closed-form formula. Computed at request time by `lib/prob-today.ts#computeProbToday()`.

**Formula**:

```
probToday = clamp01(
  probTypical × pitcherFactor × parkFactor × weatherFactor ×
  handednessFactor × bullpenFactor × paCountFactor
)

clamp01(x) = max(0.001, min(0.999, x))
```

Each factor is a pure function with **bounded output** (typically `[0.5, 2.0]`) so no single multiplier can dominate. The product is clamped to `[0.001, 0.999]`.

**Per-factor definitions**:

#### `pitcherFactor`

```
If pitcher.id === 0 (TBD):           return 1.0
If pitcher recent starts < 3:        return 1.0  (insufficient sample, downweight via confidence)

# Build a quality index from pitcher's stabilized recent rates vs league avg:
kRatio   = stabilize(pitcher.kPct,   LG_K_PCT,   pitcher.bf, K_STAB_PA=70)  / LG_K_PCT
bbRatio  = stabilize(pitcher.bbPct,  LG_BB_PCT,  pitcher.bf, BB_STAB_PA=170) / LG_BB_PCT
hrRatio  = stabilize(pitcher.hrPct,  LG_HR_PCT,  pitcher.bf, HR_STAB_PA=170) / LG_HR_PCT
hardHitRatio = stabilize(pitcher.hardHitPct, LG_HARD_HIT, pitcher.bf, HH_STAB_PA=200) / LG_HARD_HIT

# Higher K and BB → fewer balls in play → lower HRR. Higher HR allowed → higher HRR. Higher hard-hit → higher HRR.
# Each ratio is signed: > 1 = pitcher worse than league (helps batter); < 1 = pitcher better.
qualityIndex = (1/kRatio) × (1/bbRatio) × hrRatio × hardHitRatio
return clamp(qualityIndex, 0.5, 2.0)
```

The bounds `[0.5, 2.0]` cover ~99% of starting pitcher variance (deGrom ≈ 0.6, replacement-level ≈ 1.5). Outside that range, the pitcher is almost certainly a small-sample fluke we don't trust.

#### `parkFactor`

Existing `lib/park-factors.ts#getHrParkFactorForBatter(venueId, bats)` already returns per-handedness factors. Extend to a composite HRR factor (HR alone undercounts the prop value):

```
hrFactor    = parkHrFactor(venueId, bats)         (existing)
hitFactor   = parkHitFactor(venueId, bats)        (new — derive from FG Guts! 1B + 2B + 3B)
runFactor   = parkRunFactor(venueId)              (new — FG Guts! Run column, side-agnostic)

# HRR = H + R + RBI. Approximate weighting based on average HRR composition:
# ~50% from hits, ~25% from R, ~25% from RBI. RBI scales with HR, so:
parkFactor = 0.50 × hitFactor + 0.25 × runFactor + 0.25 × hrFactor
return clamp(parkFactor, 0.7, 1.3)
```

Bounds `[0.7, 1.3]` because no MLB park is more than ±30% from neutral on aggregate HRR.

#### `weatherFactor`

Existing `lib/weather-factors.ts#computeWeatherFactors()` already returns an HR multiplier. Extend to HRR:

```
{ hrMult, controlled, failure } = computeWeatherFactors(weatherInputs)

If controlled (dome) or failure: return 1.0
weatherFactor = 1.0 + 0.6 × (hrMult − 1.0)         # HRR is dampened version of HR
return clamp(weatherFactor, 0.85, 1.20)
```

The 0.6 dampener: weather affects HR strongly but only weakly affects 1B/2B (which dominate HRR for most players). Empirical ratio from Alan Nathan / Kovalchik literature.

#### `handednessFactor`

```
batterHand   = batter.bats        # 'R' | 'L' | 'S'
pitcherThrows = pitcher.throws    # 'R' | 'L'

# Standard platoon advantages from MLB league rates (recalibration target):
if batterHand === 'S':                                  return 1.00
if batterHand === pitcherThrows:                        return 0.97  # same-side disadvantage
if batterHand !== pitcherThrows:                        return 1.03  # platoon advantage
```

Bounded by definition. Documented as a calibration target.

#### `bullpenFactor`

Late-PA exposure to the bullpen. PA 4+ is increasingly bullpen.

```
opponentBullpenQuality = stabilize(team.bullpenERA, LG_ERA, team.bullpenIP, BP_STAB_IP=150) / LG_ERA

# Quality > 1 = bullpen worse than league (helps batter). < 1 = better.
# Weight by expected share of PAs faced against bullpen — mid-order ~25% bullpen, top of order less.
bullpenShare = paShareVsBullpenForSlot(lineupSlot)     # ~0.20-0.30
bullpenFactor = 1.0 + bullpenShare × (opponentBullpenQuality − 1.0)
return clamp(bullpenFactor, 0.85, 1.15)
```

#### `paCountFactor`

Lineup slot determines expected PA count. More PAs → more shots at clearing the rung.

```
expectedPA = expectedPAByLineupSlot[slot]    # slot 1: 4.6, slot 5: 4.2, slot 9: 3.8 (empirical league averages)
basePA = 4.2                                  # league mean PA per game

# Per-PA marginal HRR probability ≈ probTypical / 4.2.
# Probability of NOT clearing in N PAs ≈ (1 − pPerPA)^N.
# Adjustment factor = [1 − (1 − pPerPA)^expectedPA] / [1 − (1 − pPerPA)^basePA]
pPerPA = probTypical / basePA
notClearPAToday = (1 − pPerPA)^expectedPA
notClearPABase  = (1 − pPerPA)^basePA
paCountFactor = (1 − notClearPAToday) / (1 − notClearPABase)
return clamp(paCountFactor, 0.85, 1.15)
```

For a leadoff hitter (4.6 PA) the factor is ~1.05; for a 9-hole bat (3.8 PA) it's ~0.90.

### 5.3 `EDGE`

Unchanged from `lib/edge.ts`:

```
EDGE = max(probToday, ε) / max(probTypical, ε) − 1     where ε = 0.01
```

Symmetric ε floor on both sides prevents extreme edges on rare events. **No changes.** The formula is correct and well-tested; only its inputs change (closed-form `probToday` instead of MC `pMatchup`).

### 5.4 `CONFIDENCE`

Existing `lib/confidence.ts#computeConfidenceBreakdown()` is structurally sound — multiplicative breakdown with bounded factors, each in `[0.7, 1.0]`. Two new factors:

```
factors = {
  lineup,                 # existing — confirmed/partial/estimated
  bvp,                    # existing — career AB vs starter ramp
  pitcherStart,           # existing — recent starts available
  weather,                # existing — stable / volatile
  time,                   # existing — minutes to first pitch
  opener,                 # existing — opener flag

  # NEW:
  sampleSize,             # ramp 0.85 → 1.00 over batter PA: 0 → 200
  dataFreshness,          # 1.00 if all upstream cache ages < 5 min, ramps to 0.90 at 30 min
}

product = lineup × bvp × pitcherStart × weather × time × opener × sampleSize × dataFreshness
```

`sampleSize` factor:

```
sampleSize = clamp(0.85 + 0.15 × min(1, batterSeasonPA / 200), 0.85, 1.00)
```

A call-up with 30 PAs gets `0.85 + 0.15 × 0.15 = 0.87`. A full-season starter gets 1.00.

`dataFreshness` factor:

```
maxAgeSec = max(lineupCacheAge, weatherCacheAge, probableCacheAge, typicalCacheAge / 24h)
dataFreshness =
  maxAgeSec ≤  5min:  1.00
  maxAgeSec ≥ 30min:  0.90
  else:               1.00 − (maxAgeSec − 300s) / 1500s × 0.10
```

This makes confidence honest about pipeline staleness — if lineups haven't been refetched in 25 minutes, confidence drops a little.

**Display**: confidence is always rendered as a percentage `0–100%`. Internally it stays in `[0, 1]` for math.

### 5.5 `SCORE`

```
score = edge × confidence
```

Same as today. The user's spec lists "edgeComponent × probabilityComponent × confidenceComponent" as an example shape, but probability is already encoded into edge (edge depends on probToday) and confidence (confidence ramps with sample size). Adding a third multiplier of `probToday^α` would double-count.

The protection against "low-confidence noisy picks" is that `confidence` directly multiplies in. A pick with great edge but estimated lineup + TBD pitcher gets crushed: `edge × 0.7 × 0.85 ≈ 0.6 × edge`.

The `tier` classification (`tracked` / `watching` / dropped) uses `EDGE_FLOORS`, `PROB_FLOORS`, `CONFIDENCE_FLOOR_TRACKED` from `lib/constants.ts`. Unchanged.

## 6. Fallbacks for missing data

| Missing input | Fallback | Confidence impact |
|---|---|---|
| TBD probable pitcher | `pitcherFactor = 1.0` | `confidence.pitcherStart` ramps to 0.90 |
| Pitcher recent starts < 3 | `pitcherFactor = 1.0` | `confidence.pitcherStart` ramps to 0.90 |
| Estimated lineup | use estimated slots | `confidence.lineup = 0.70` |
| Partial lineup | use known slots, neutral fallbacks | `confidence.lineup = 0.85` |
| Weather fetch failure | `weatherFactor = 1.0` | `confidence.weather = 0.90` |
| Park not in factor table | `parkFactor = 1.0` (and log a warning) | no confidence change |
| Player game log empty | `probTypical = league-avg` | `confidence.sampleSize = 0.85` |
| `typical:{playerId}` cache miss | recompute on demand (slow path) — single player MC, ~2-3s | `confidence.dataFreshness` reflects the freshness |
| Bullpen stats missing | `bullpenFactor = 1.0` | no confidence change |
| Postponed game | drop pick (hard gate, existing logic) | n/a |
| Final / live game | drop from pre-game boards (hard gate, existing logic) | n/a |

A cache miss on `typical:{playerId}` (e.g., a mid-day call-up nobody has simmed yet) triggers an inline single-player MC at request time. This is the only request-time MC path that survives the refactor, gated to single-player misses with a per-request timeout (3s).

## 7. UI changes

### 7.1 Column layout (desktop)

```
┌──────────────────────┬─────────────────┬───────────────┬─────────────┬───────┬──────┬───────┐
│  PLAYER              │  GAME           │ PROB. TYPICAL │ PROB. TODAY │ EDGE  │ CONF │ SCORE │
├──────────────────────┼─────────────────┼───────────────┼─────────────┼───────┼──────┼───────┤
│  Aaron Judge      4  │  NYY @ BOS      │     69.2%     │   78.4%     │ +13%  │ 92%  │ 0.120 │
│  R · ✓ confirmed     │  7:07 PM EDT    │               │             │       │      │       │
│  vs G. Cole          │                 │               │             │       │      │       │
│  PROBABLE            │                 │               │             │       │      │       │
└──────────────────────┴─────────────────┴───────────────┴─────────────┴───────┴──────┴───────┘
```

- **PLAYER** column:
  - Line 1: full name + lineup slot number (right-aligned within column)
  - Line 2: handedness · lineup status badge (`✓ confirmed` green, `partial` yellow, `est.` gray)
  - Line 3: `vs <pitcher name>` (or `vs TBD`)
  - Line 4: pitcher status pill (`TBD` gray, `PROBABLE` blue, `CONFIRMED` green)
- **GAME** column:
  - Line 1: matchup `AWAY @ HOME` (away first, MLB convention)
  - Line 2: first pitch in viewer's local time (formatted `7:07 PM EDT`)
- **PROB. TYPICAL / PROB. TODAY**: percentage with 1 decimal, tabular numerals
- **EDGE**: signed percentage `+13%` / `−4%`. Positive in green, negative in muted red
- **CONF**: percentage 0–100%, single colour, tabular
- **SCORE**: 3-decimal tabular, used for sort

The repeated micro-labels (`prob`, `edge`, `conf`) in the current row component are removed — column headers carry that info.

### 7.2 Mobile layout

Stacked card per pick (current pattern) but with the same data hierarchy:

```
┌────────────────────────────────────────┐
│  Aaron Judge    [SLOT 4]               │
│  R · ✓ confirmed                        │
│  NYY @ BOS · 7:07 PM EDT                │
│  vs G. Cole · PROBABLE                  │
│ ─────────────────────────────────────── │
│  Typical 69.2%   Today 78.4%            │
│  Edge +13%   Conf 92%   Score 0.120     │
└────────────────────────────────────────┘
```

Labels visible inline on mobile (since there are no column headers). Two rows of metrics, balanced layout.

### 7.3 Manual refresh button

- Position: top of the picks page, near the freshness indicator.
- States: idle / loading (spinner) / error (red toast) / success (green check, briefly).
- Disabled while loading; double-clicks deduped by ref.
- On click: `POST /api/refresh` with viewer-derived nonce (see §9). On success, hot-swap the picks payload and update the freshness indicator.
- Failure modes: clear inline error message and revert to previous state.

### 7.4 Freshness indicator

```
Updated 32s ago · auto-refresh on    [Refresh now]
```

- Shows seconds since last refresh, formatted (`32s`, `1m 12s`, `2m 41s`).
- Indicates whether the page is auto-polling.
- Click target: same as button.

### 7.5 Tracked / watching tier rendering

Existing `tier` classification is preserved. Tracked picks show with a subtle accent (left border, slightly bolder typography); watching picks render normally; dropped picks aren't returned. **No new tier visualization** — tracked tier is the existing concept, just now drives which rows move to the in-progress board when their game starts (separate spec).

### 7.6 Empty states

- No games today: "No MLB games scheduled. Check back tomorrow."
- All games postponed: "All games postponed. We'll have picks once the slate resumes."
- No picks above the watching floor: "No picks meet the floor today. Edge is below the watching threshold for every player on every rung."
- API failure: "Couldn't load picks. Refresh to try again." with the manual refresh button highlighted.

### 7.7 Accessibility

- Semantic `<table>` on desktop with proper `<thead>` / `<tbody>` / `<th scope='col'>`.
- Mobile cards use semantic structure (article role + heading hierarchy).
- All interactive elements keyboard-focusable with visible focus ring.
- Contrast ratio ≥ 4.5:1 for all text, ≥ 3:1 for large text.
- No page-level horizontal overflow at 320px viewport width.
- `aria-live="polite"` on the freshness indicator + post-refresh status messages.

## 8. Refresh strategy

### 8.1 Automatic

| Cron | Cadence (UTC) | ET equivalent | Purpose |
|---|---|---|---|
| **Weekly typical (full)** | `0 8 * * 0` | Sun 4 AM | 20k-iter MC for **all ~750 active MLB batters**. Off-slate window. Catches roster moves + season-rate drift across the league. |
| **Nightly typical (slate)** | `0 8 * * 1-6` | Mon–Sat 4 AM | 20k-iter MC for **batters in tomorrow's projected lineups (~150 unique)**. Off-slate window. Catches per-team news (call-ups, recent BvP). |
| **Slate refresh** | `*/2 17-23 * * *` and `*/2 0-7 * * *` | every 2 min, 1 PM ET → 3 AM ET | Refetch lineups/weather/probables, recompute closed-form picks, bust `picks:current` cache. **No MC.** |
| **Lock** | `*/5 17-23 * * *` and `*/5 0-7 * * *` | every 5 min during slate hours | Existing — unchanged. |
| **Settle** | `0 10 * * *` | 6 AM ET | Existing — unchanged. |

Off-slate window (3 AM ET → ~12 PM ET) gives ~9 hours of unconstrained compute time daily; both typical-sim jobs run in the early portion of that window so they're done well before any slate activity.

The slate refresh is the new lightweight cron. It replaces the old per-game sim cron and is much cheaper (no MC, just upstream refetches + formula evaluation).

**Estimated GitHub Actions usage**: ~250 min/mo (vs ~50 min/mo today). Well within 2,000 min budget.

**Estimated Vercel function invocations** (single 10s call per player, no chunking):
- Weekly full: 750 calls × 4.3 weeks ≈ 3,225/mo
- Nightly slate: 150 calls × 26 days ≈ 3,900/mo
- Slate refresh: ~30 cron firings/hour × 17 hours × 30 days ≈ 15,300/mo
- Lazy backfill (cold misses): negligible (<100/mo expected)
- **Total: ~22,500/mo** against 100k/mo Hobby budget. ~4× headroom for manual refreshes, browser triggers, and growth.

### 8.2 Manual

The manual refresh button hits `POST /api/refresh` (same handler as slate cron) but with `force=true` to invalidate upstream caches before refetching. See §9.

### 8.3 Client-side

- Polls `/api/picks` every 60s while tab is visible.
- Instant refetch on `visibilitychange` (return to tab) and `online` (reconnect).
- Server cache on `/api/picks` reduced from 60s → 30s (catches the 2-min cron more responsively).

## 9. Backend routes

### 9.1 `GET /api/picks`

Existing route. **Behaviour change**: the ranker no longer self-warms missing per-game sims (the per-game sim cache no longer exists). Instead, on a cache miss, it falls through to the closed-form path which is fast enough to compute inline. Server cache stays in place but at 30s TTL.

Response shape (`PicksResponse`) unchanged except:
- `meta.gamesWithSim` and `meta.gamesWithoutSim` removed
- `meta.refreshedAt` (existing) and a new `meta.cacheAges` block:
  ```ts
  meta: {
    gamesTotal,
    gameStates: { scheduled, inProgress, final, postponed },
    fromCache: boolean,
    refreshedAt: string,        // ISO
    cacheAges: {
      lineupMaxSec: number,
      weatherMaxSec: number,
      probableMaxSec: number,
      typicalMaxSec: number,
    }
  }
  ```

The `cacheAges` block feeds the freshness indicator and the `confidence.dataFreshness` factor.

### 9.2 `POST /api/refresh` (NEW)

Triggers a forced-refetch + recompute pass.

```
POST /api/refresh
Headers:
  x-cron-secret: <CRON_SECRET>      # for cron callers
    OR
  x-refresh-token: <session token>  # for browser button (see auth)

Body (optional):
  { "scope": "today" | "specific-game", "gameId"?: number }

Response:
  200 { date, refreshedAt, picks: PicksResponse, partialFailures: [...] }
  401 { error: "unauthorized" }
  429 { error: "rate limited", retryAfterSec: number }
  503 { error: "upstream failure", details: [...] }
```

**Auth**:
- Cron path: standard `x-cron-secret` (existing pattern from `lib/cron-auth.ts`).
- Browser path: rate-limited per IP (5 refreshes / minute / IP). No user accounts in this app, so we don't need session tokens — the rate limit is the abuse protection. Can revisit if abuse becomes a problem.
- 401 if neither auth path is satisfied AND we're in production. Dev mode skips auth (existing pattern).

**Behaviour**:
1. Validate `date` (defaults to slate date).
2. Invalidate upstream caches: `lineup:*`, `weather:*`, `probables:*` for today's game IDs.
3. Re-fetch each upstream source.
4. Call `rankPicks(date)`.
5. Bust `picks:current:{date}` cache.
6. Return fresh payload.
7. Partial failures (e.g., one game's lineup couldn't fetch) are reported in `partialFailures` but don't block the response.

**Timeout**: 10s (Vercel Hobby limit). If we can't finish in 10s, return what we have with `partialFailures`.

### 9.3 `POST /api/sim/typical` (NEW, replaces `/api/sim` and `/api/sim/[gameId]`)

Offline MC for `probTypical`. Called only by cron jobs (or by `npm run recalibrate`).

**Two distinct request shapes**:

```
POST /api/sim/typical
Headers: x-cron-secret
Body — full-population mode:
  {
    mode: 'full',
    season?: number             // defaults to current season
  }

Body — single-player mode (used by both slate cron and lazy backfill):
  {
    mode: 'player',
    playerId: number,
    season?: number
  }

Response (both modes):
  200 { mode, playerIds: number[], computedAt, errors: [...] }
  400 { error }
  401 { error }
  504 { error: 'timed out', completedPlayerIds: [...] }
```

**Behaviour**:

- **`mode: 'full'`** — orchestrator pattern. Returns immediately after fanning out one fire-and-forget HTTP call per active batter, each call hitting `mode: 'player'`. The orchestrator HTTP call is just a fan-out and finishes well within 10 s. Each per-player invocation has its own full 10 s budget.
- **`mode: 'player'`** — does the actual sim. 20,000 iterations vs synthetic league-average opponent at slot 4. Writes `typical:v1:{playerId}` on success. ~10 s wall time.

**Active-batters list** (used by `mode: 'full'`): batters with ≥ 1 PA in the current season AND on a 40-man roster as of today. Existing `lib/mlb-api.ts` exposes the season game log; the 40-man roster check uses the `/api/v1/teams/{teamId}/roster?rosterType=40Man` endpoint (already cached upstream). Approx 750 players.

**Slate-batter list** (used by the nightly slate cron): batters in tomorrow's projected lineups, deduped by `playerId`. The cron derives this list by calling `fetchSchedule(tomorrow)` then `fetchLineup` for each game (projected lineup status accepted). Approx 150 unique players. The cron then makes one `mode: 'player'` call per unique player.

**Lazy backfill** (used by request path on cache miss): `lib/p-typical.ts#getPTypical()` calls `mode: 'player'` synchronously when the cache is empty for a requested player. Result is cached and returned. Future requests for that player skip this path.

### 9.4 Routes that are removed

- `GET /api/sim` — removed
- `GET /api/sim/[gameId]` — removed

Their cache keys (`sim:*`, `sim-meta:*`) are GC'd by a one-shot SQL migration (see §11).

## 10. Cache structure

| Key prefix | Owner | TTL | Bumped? |
|---|---|---|---|
| `typical:v1:{playerId}` | offline `/api/sim/typical` | 14 days | NEW prefix |
| `lineup:{gameId}:{side}` | `lib/lineup.ts` | 5 min (was longer) | unchanged prefix, lower TTL |
| `weather:{venueId}:{date}` | `lib/weather-api.ts` | 30 min | unchanged |
| `probables:{gameId}` | `lib/mlb-api.ts` | 5 min (was longer) | unchanged prefix, lower TTL |
| `picks:current:{date}` | `app/api/picks/route.ts` | 30s (was 60s) | unchanged prefix, lower TTL |
| `bvp:{batterId}:{pitcherId}` | `lib/mlb-api.ts` | 24h | unchanged |
| `pitcher-recent:{pitcherId}` | `lib/mlb-api.ts` | 6h | unchanged |
| `bullpen:{teamId}` | NEW `lib/bullpen.ts` | 6h | NEW |
| `slot-freq:{playerId}:{season}` | `lib/mlb-api.ts` | 7 days | unchanged |
| `game-log:{playerId}:{season}` | `lib/mlb-api.ts` | 24h | unchanged |
| ~~`sim:*`~~ | ~~per-game MC~~ | ~~24h~~ | **deprecated** |
| ~~`sim-meta:*`~~ | ~~per-game MC~~ | ~~24h~~ | **deprecated** |
| ~~`p-typical:*`~~ | ~~old per-player MC~~ | ~~24h~~ | **deprecated** (replaced by `typical:v1:*`) |

A one-shot SQL migration in `supabase/migrations/2026-04-28-deprecate-sim-cache.sql` deletes the deprecated rows so the storage isn't carrying dead weight for 24 hours after deploy.

## 11. Sim accuracy choices

### 11.1 Iteration count: 20,000 per player

Standard error of a Monte Carlo probability estimator scales as `1/√N`:

| Iterations | SE @ p=0.5 | Wall time @ 0.5 ms/iter | Vercel call fit |
|---|---|---|---|
| 1,000 (current) | ~3.16% | ~0.5 s | trivial |
| 10,000 | ~1.00% | ~5 s | one call |
| **20,000 (chosen)** | **~0.71%** | **~10 s** | **one call (at limit)** |
| 50,000 | ~0.45% | ~25 s | requires chunking |
| 100,000 | ~0.32% | ~50 s | requires chunking + finalizer |

**Why 20k**: it's the largest N that fits in a single Vercel Hobby 10-second function invocation, eliminating the need for a chunked-aggregator pattern. SE 0.71% is well below the 1% display precision (no visible difference in the rendered percentages) and far below model bias (input quality dominates). Going to 100k would cut SE from 0.71% to 0.32% — a ~2× noise reduction at 5× the invocation cost and significantly more orchestration complexity. Not worth it.

**One-iteration-equals-one-game**: the simulation runs a full 9-inning game per iteration with a synthetic league-average lineup of fillers around the target batter. This captures lineup interactions for R and RBI (the structural fidelity that motivated keeping MC over a closed form for `probTypical`). The target batter's HRR distribution is extracted at the end of each iteration.

### 11.2 Single-slot baseline

`probTypical` is computed at slot 4 only (mid-order, league-mean PA expectation). The previous multi-slot blend in `lib/p-typical.ts` is discontinued — `paCountFactor` in `probToday` (§5.2) absorbs slot variance at request time. This:
- Reduces `probTypical` compute by ~3× (one slot instead of three)
- Cleanly separates "player skill in neutral context" (`probTypical`) from "today's context including slot" (`probToday`)
- Has bounded approximation error (`paCountFactor` is clamped to `[0.85, 1.15]`)

### 11.3 Common random numbers (CRN, optional v2)

Pair the player's MC with the synthetic league-average MC using the same random seed, so `probToday/probTypical` ratio noise is reduced. Not load-bearing for v1 with SE 0.71%; revisit if calibration shows the ratio variance matters. Flagged but deferred.

### 11.4 Stratification (deferred)

Variance reduction via stratified sampling on outcome buckets (samples in the tail are scarce; stratification helps tighten the 3+ rung estimate). Worth ~30% effective N gain. Deferred to v2.

### 11.5 What we are NOT improving in this refactor

The model still uses season-only rates (no L30/L15 blend), no BvP layer in per-PA, league-avg TTO, hardcoded 'starter' (no opener detection), and switch-hitter average park factor. These are listed in CLAUDE.md as v1 simplifications and remain so. **Do not bundle them into this refactor** — they have their own design questions and their own calibration costs.

## 12. Migration plan

Phased migration so we can validate the new model against the old in shadow mode before flipping.

### Phase 1: Build offline `probTypical` infrastructure

- Add `app/api/sim/typical/route.ts` supporting both `mode: 'full'` (orchestrator) and `mode: 'player'` (single-batter compute).
- Refactor `lib/p-typical.ts`: split into `computeTypicalOffline()` (the heavy compute, called by `mode: 'player'`), `getPTypical()` (the cache reader used by the request path with lazy backfill), and `getSlateBatterIds()` (helper used by the nightly slate cron).
- Add two cron entries to `.github/workflows/cron.yml`: weekly full (Sunday 4 AM ET) + nightly slate (Mon-Sat 4 AM ET).
- Run once manually: `gh workflow run "Weekly typical sim" --ref main`.
- Verify cache populated for ≥600 active players (after the weekly run).
- **No production behaviour change** — the ranker still uses the old per-game sim.

### Phase 2: Build closed-form `probToday`

- Add `lib/prob-today.ts` with `computeProbToday()` function.
- Add `lib/factors/` directory: `pitcher.ts`, `park.ts`, `weather.ts`, `handedness.ts`, `bullpen.ts`, `pa-count.ts`. Each is a pure function with bounded output.
- Add `lib/bullpen.ts` for opponent bullpen stat fetching/caching.
- Unit tests for every factor (see §13).

### Phase 3: Shadow mode

- Modify `lib/ranker.ts`: keep computing the old `pMatchup` from sim cache, ALSO compute `probToday` from the new formula. Log both for every pick (Supabase `cache` table or simple JSON log).
- Run for 2-3 days during slate hours.
- Compare distributions: where do they diverge? Are the divergences explainable (e.g., low-PA players, dome games)?
- If divergence > 10% on any pick, investigate before flipping.

### Phase 4: Flip to formula

- `lib/ranker.ts`: switch to closed-form `probToday`. Old per-game sim cache reads removed.
- Remove sim-warming code in `rankPicks`.
- Update `lib/p-typical.ts` to read only from `typical:v1:*` cache (no inline MC fallback except for true cache misses).
- Deploy. Monitor for a day.

### Phase 5: Cleanup

- Remove `app/api/sim/route.ts` and `app/api/sim/[gameId]/route.ts`.
- Move `lib/sim.ts`, `lib/build-context.ts` to `lib/offline-sim/` (semantic relocation; logically these are offline-only now).
- Run one-shot SQL migration to GC `sim:*` and `sim-meta:*` cache rows.
- Update `cron.yml`: remove old sim warming, add slate-refresh job.
- Update `CLAUDE.md` and `README.md`.
- Update tests: remove tests for deleted routes; add tests for new routes.

### Rollback plan

If Phase 4 reveals a problem we can't fix in-flight: revert the ranker change. The per-game sim cache infrastructure isn't deleted until Phase 5, so rolling back to the old behaviour is a single-commit revert + redeploy.

## 13. Tests

New test files:

- `__tests__/factors/pitcher.test.ts` — `pitcherFactor`, including TBD, low sample, extreme values
- `__tests__/factors/park.test.ts` — composite HRR park factor, per-handedness, switch hitter
- `__tests__/factors/weather.test.ts` — dome, failure, dampened HR multiplier
- `__tests__/factors/handedness.test.ts` — all 6 batter/pitcher hand combos
- `__tests__/factors/bullpen.test.ts` — quality scaling, stabilization, missing data
- `__tests__/factors/pa-count.test.ts` — per-slot PA expectations, monotonic in slot
- `__tests__/prob-today.test.ts` — full closed-form formula, clamping, fallback chain
- `__tests__/refresh.test.ts` — `/api/refresh` auth, scope validation, partial-failure handling

Updated test files:

- `__tests__/confidence.test.ts` — extend for new `sampleSize` and `dataFreshness` factors
- `__tests__/ranker.test.ts` — exists or add: ranking + sort stability + fallback ordering

Removed test files (Phase 5):

- Any `__tests__/sim*` that exclusively tests the per-game sim orchestrator
- Tests for `/api/sim` and `/api/sim/[gameId]` route handlers (the routes are gone)

The offline sim itself (`lib/sim.ts`, `lib/per-pa.ts`, `lib/baserunner.ts`) keeps its existing tests — that math is still in use.

## 14. Documentation updates

- `README.md`: replace any "Monte Carlo" framing with "deterministic formula model with offline simulation baseline." Update the "How it works" section. Add a section on the manual refresh button.
- `CLAUDE.md`: update the "Architecture" and "Critical files" sections. Note that `lib/sim.ts` is offline-only now. Update commands table if `npm run recalibrate` semantics change.
- `docs/DEPLOY.md`: update the cron section. Document the weekly-full + nightly-slate typical jobs (4 AM ET) and the new every-2-min slate-refresh job.
- New: `docs/superpowers/specs/2026-04-28-hybrid-ranking-refactor-design.md` — this document.

No new audit/report file. The user's spec explicitly says "Do not create a separate audit report markdown file."

## 15. Validation gates

Before merging:

```
npm run lint
npm run typecheck
npm test
npm run build
```

All four must pass. CI runs all four on every PR.

Manual smoke:

- Open `/` after deploy: page loads, picks render, all 7 columns visible.
- Click manual refresh: status changes to loading, completes < 5s, freshness indicator updates.
- Inspect a single pick: `probTypical`, `probToday`, `edge`, `confidence`, `score` all displayed and internally consistent (`edge ≈ probToday/probTypical − 1`, `score ≈ edge × confidence`).
- Verify a TBD-pitcher game: `pitcherFactor = 1.0`, `confidence.pitcherStart` shows penalty, pitcher status pill shows "TBD".
- Verify cache freshness: open Supabase dashboard, confirm `typical:v1:*` keys present for slate's batters.

## 16. Out of scope (explicit)

These came up in brainstorming and are deferred:

- **In-progress board** for tracked picks whose games have started — has its own spec.
- **Calibration of placeholder constants** — locked behind ≥30 days of settled history.
- **L30/L15 rolling blend** — listed as v1 simplification in CLAUDE.md.
- **BvP in per-PA outcome rates** — separate concern from BvP in confidence factor (which we keep).
- **Pitcher-specific TTO** — needs Savant pitch-level data.
- **Opener detection** — needs Savant pitch-by-pitch.
- **Switch-hitter handedness weighting per PA** — uses averaged park factor today; deferred.
- **Live in-game model updates** — separate feature.
- **Sub-10s freshness** — paid infra.
- **A/B testing the new model in production** — no settled history to validate against.

## 17. Open questions / risks

### 17.1 PA count factor approximation

The Bernoulli-based `paCountFactor` formula assumes per-PA HRR probability is constant across PAs and that PAs are independent. Both are wrong — TTO penalizes PA 3+, and HRR clears compound (a hit in PA 1 raises P(R) for PA 1's score chance via subsequent batters).

The factor is bounded `[0.85, 1.15]` so the error is small. Documented as approximation; recalibrate post-launch.

### 17.2 Park factor composite weights

The `0.50 hits + 0.25 R + 0.25 HR` weighting is a guess. Actual HRR composition varies by player (a HR-heavy slugger gets more from R+HR than from H1B). A more rigorous version would compute weights per player based on their HRR breakdown.

Deferred to post-calibration. The current composite is bounded `[0.7, 1.3]` so the error is small.

### 17.3 `dataFreshness` factor double-counting?

We already have a 30s server cache and a manual refresh button. Does adding `dataFreshness` to confidence layer too much penalty? Probably not — the factor only kicks in for stale fetches (>5 min), which means the cron has missed a window. That's exactly when the user should know confidence is degraded.

### 17.4 What if a player has zero PAs this season?

Game log is empty → `probTypical = league-avg fallback`, `confidence.sampleSize = 0.85`, `confidence.lineup` reflects whatever the lineup status is. Pick will rank low because of the confidence multiplier. Acceptable.

### 17.5 What about doubleheaders?

The cache key `typical:v1:{playerId}` is date-agnostic, so doubleheaders share `probTypical`. That's correct. `lineupSlot` and `paCountFactor` may differ between games — handled at the per-pick level.

### 17.6 Migration: how do we know shadow mode caught the divergences?

We log `(probTodayOld, probTodayNew, divergencePct)` per pick to the `cache` table or a simple Supabase logging table. After 2-3 slate days we have ~5,000 paired observations across all rungs. Visual inspection + percentile divergence stats. If 95th-percentile divergence > 10%, dig in before flipping.

### 17.7 What's the actual formula for `pitcherFactor` once stabilization is done?

The spec gives the structure (kRatio × bbRatio × etc.) but the actual coefficients come from empirical analysis on the existing season's data. Phase 2 (closed-form `probToday`) needs a working calibration; we'll fit on 2025 settled boxscore data which is widely available, before flipping in Phase 4. If 2025 data isn't available in the form we need, fall back to literature priors (FIP-style coefficients) and document.

---

## Appendix A: file map

| File | Action | Notes |
|---|---|---|
| `app/api/picks/route.ts` | Modify | `meta.cacheAges` field; cache TTL 60→30s |
| `app/api/refresh/route.ts` | New | Manual refresh + slate cron entry |
| `app/api/sim/typical/route.ts` | New | Nightly offline sim |
| `app/api/sim/route.ts` | Delete (Phase 5) | |
| `app/api/sim/[gameId]/route.ts` | Delete (Phase 5) | |
| `lib/p-typical.ts` | Refactor | Split into `computeTypicalOffline` + `getPTypical` reader |
| `lib/prob-today.ts` | New | Closed-form `computeProbToday` |
| `lib/factors/pitcher.ts` | New | |
| `lib/factors/park.ts` | New | Composite HRR factor |
| `lib/factors/weather.ts` | New | Wraps `weather-factors.ts` for HRR |
| `lib/factors/handedness.ts` | New | |
| `lib/factors/bullpen.ts` | New | |
| `lib/factors/pa-count.ts` | New | |
| `lib/bullpen.ts` | New | Bullpen stat fetcher + cache |
| `lib/confidence.ts` | Modify | Add `sampleSize` + `dataFreshness` factors |
| `lib/ranker.ts` | Modify | Drop self-warming, switch to closed-form |
| `lib/sim.ts` | Keep, relocate | Logically `lib/offline-sim/sim.ts` |
| `lib/per-pa.ts` | Keep | Used by offline sim |
| `lib/baserunner.ts` | Keep | Used by offline sim |
| `lib/edge.ts` | No change | |
| `lib/constants.ts` | Extend | `LG_K_PCT`, `LG_BB_PCT`, `LG_HR_PCT`, `LG_HARD_HIT`, expectedPAByLineupSlot, paShareVsBullpenForSlot |
| `components/PickRow.tsx` | Modify | New 7-column layout, removed micro-labels |
| `components/StatusBanner.tsx` | Modify | Freshness indicator + manual refresh button |
| `components/RefreshButton.tsx` | New | The button itself + state |
| `.github/workflows/cron.yml` | Modify | Add weekly-full + nightly-slate typical jobs (both 4 AM ET), remove per-game sim cron, add slate-refresh cron (every 2 min during slate hours) |
| `CLAUDE.md` | Modify | Architecture + critical files + commands |
| `README.md` | Modify | Drop "Monte Carlo" framing |
| `supabase/migrations/2026-04-28-deprecate-sim-cache.sql` | New | One-shot GC of `sim:*` and `sim-meta:*` |

## Appendix B: tracked-tier threshold structure (clarification)

This refactor preserves the existing tracked-tier classification (`lib/ranker.ts#classifyTier`):

```
A pick is Tracked iff:
  confidence ≥ CONFIDENCE_FLOOR_TRACKED  (currently 0.85)
  AND edge ≥ EDGE_FLOORS[rung]            (currently 0.10/0.30/0.60)
  AND probToday ≥ PROB_FLOORS[rung]       (currently 0.85/0.55/0.20)
```

The threshold *values* are placeholders. Per CLAUDE.md, **don't tune from gut feel** — run `npm run recalibrate` once ≥30 days of settled history exists. The threshold *structure* (per-rung floors) is preserved.

If the new model produces meaningfully different `probToday` distributions than the old MC, the floors may need to be retuned earlier. This is part of the Phase 3 shadow-mode validation.

---

End of design doc.
