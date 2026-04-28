# Hybrid Ranking Model Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the HRR prop ranker from a request-time Monte Carlo simulation to a hybrid model: offline MC computes a stable per-player `probTypical` baseline (cached); a closed-form formula computes `probToday` at request time using today's matchup context.

**Architecture:** Offline MC at 20k iter/player runs weekly (full population) + nightly (slate batters), writing to `typical:v1:{playerId}` cache. Request path reads cache + evaluates a chain of bounded factor multipliers (`pitcherFactor × parkFactor × weatherFactor × handednessFactor × bullpenFactor × paCountFactor`). Manual `/api/refresh` button + every-2-min slate-refresh cron keep upstream data fresh.

**Tech Stack:** Next.js 16 App Router · TypeScript 6 (strict) · Jest 30 + ts-jest · Supabase Postgres (cache) · GitHub Actions cron · Vercel Hobby

**Spec:** `docs/superpowers/specs/2026-04-28-hybrid-ranking-refactor-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `lib/factors/pa-count.ts` | `paCountFactor` — lineup slot → expected PA count multiplier |
| `lib/factors/handedness.ts` | `handednessFactor` — batter L/R/S vs pitcher L/R |
| `lib/factors/park.ts` | `parkFactor` — composite HRR park multiplier (existing per-handedness HR factor + new hit/run components) |
| `lib/factors/weather.ts` | `weatherFactor` — HRR-scaled adapter over `lib/weather-factors.ts` |
| `lib/factors/pitcher.ts` | `pitcherFactor` — pitcher quality index from K%, BB%, HR%, hard-hit% |
| `lib/factors/bullpen.ts` | `bullpenFactor` — opponent bullpen quality × slot exposure |
| `lib/bullpen.ts` | Bullpen stat fetcher + cache (new data adapter) |
| `lib/prob-today.ts` | `computeProbToday()` — orchestrator that composes all factors |
| `lib/slate-batters.ts` | `getSlateBatterIds()` — helper for nightly slate cron |
| `app/api/sim/typical/route.ts` | Offline MC route (mode='full' orchestrator + mode='player' compute) |
| `app/api/refresh/route.ts` | Manual refresh + slate cron |
| `components/RefreshButton.tsx` | The button + state |
| `supabase/migrations/2026-04-28-deprecate-sim-cache.sql` | One-shot GC of `sim:*` and `sim-meta:*` rows |
| `__tests__/factors/pa-count.test.ts` | |
| `__tests__/factors/handedness.test.ts` | |
| `__tests__/factors/park.test.ts` | |
| `__tests__/factors/weather.test.ts` | |
| `__tests__/factors/pitcher.test.ts` | |
| `__tests__/factors/bullpen.test.ts` | |
| `__tests__/bullpen.test.ts` | Bullpen data adapter |
| `__tests__/prob-today.test.ts` | Full orchestrator |
| `__tests__/refresh.test.ts` | `/api/refresh` route handler |
| `__tests__/sim-typical.test.ts` | `/api/sim/typical` route handler |

### Modified files

| Path | Change |
|---|---|
| `lib/constants.ts` | Add `LG_K_PCT`, `LG_BB_PCT`, `LG_HR_PCT`, `LG_HARD_HIT_RATE`, `expectedPAByLineupSlot`, `paShareVsBullpenBySlot` |
| `lib/p-typical.ts` | Refactor: split `computeTypicalOffline()` (compute) from `getPTypical()` (cache reader); single-slot baseline (slot 4); 20k iter; cache key prefix `p-typical:` → `typical:v1:`; lazy backfill on miss |
| `lib/confidence.ts` | Add `sampleSize` and `dataFreshness` factors to `ConfidenceFactors` |
| `lib/ranker.ts` | (Phase 6) shadow mode logging; (Phase 7) switch to closed-form `probToday`; (Phase 7) remove `warmMissingSims` |
| `app/api/picks/route.ts` | Add `meta.cacheAges`; reduce server cache TTL 60→30s |
| `components/PickRow.tsx` | New 7-column layout (PLAYER \| GAME \| PROB.TYPICAL \| PROB.TODAY \| EDGE \| CONF \| SCORE); remove repeated micro-labels |
| `components/StatusBanner.tsx` | Freshness indicator slot ("Updated Xs ago"), inline refresh button |
| `components/ClientShell.tsx` | Wire RefreshButton + freshness state |
| `.github/workflows/cron.yml` | Add weekly-typical + nightly-slate + slate-refresh; remove per-game sim cron |
| `__tests__/confidence.test.ts` | Extend for `sampleSize` + `dataFreshness` |
| `CLAUDE.md` | Architecture, critical files, commands |
| `README.md` | Drop "Monte Carlo" framing; explain hybrid model |
| `docs/DEPLOY.md` | New cron schedule documentation |

### Deleted files

| Path | Reason |
|---|---|
| `app/api/sim/route.ts` | Per-game orchestrator no longer needed (Phase 9) |
| `app/api/sim/[gameId]/route.ts` | Per-game sim no longer needed (Phase 9) |
| `app/api/sim/[gameId]/build-context.ts` | Moves to `lib/offline-sim/build-context.ts` (Phase 9) |
| Tests for the deleted routes | (Phase 9) |

### Relocated files

| From | To | When |
|---|---|---|
| `lib/sim.ts` | `lib/offline-sim/sim.ts` | Phase 9 |
| `lib/baserunner.ts` | `lib/offline-sim/baserunner.ts` | Phase 9 |
| `app/api/sim/[gameId]/build-context.ts` | `lib/offline-sim/build-context.ts` | Phase 9 |

`lib/per-pa.ts` stays in `lib/` because both the offline sim AND the new closed-form `pitcherFactor` use it.

---

## Phase ordering

Each phase ships safely on its own — old code keeps working until Phase 7's flip. Run validation gates (`npm run lint && npm run typecheck && npm test && npm run build`) after every commit.

| Phase | What | Risk | Reversible? |
|---|---|---|---|
| 0 | Constants + types | None | Trivial |
| 1 | Offline `probTypical` infrastructure (parallel to old MC) | None — old code untouched | Trivial |
| 2 | Factor library | None — new files only | Trivial |
| 3 | `computeProbToday()` orchestrator | None — not yet wired | Trivial |
| 4 | Extended confidence factors | Low — additive multipliers | Single-commit revert |
| 5 | UI: 7-column layout + freshness slot | Low — UI only | Single-commit revert |
| 6 | `/api/refresh` route + slate-refresh cron | Low — new route, additive cron | Single-commit revert |
| 7 | Shadow mode (log old + new probToday side-by-side) | Low — observe only | Single-commit revert |
| 8 | Flip to closed-form (request-path MC removed) | **High** — model change | Single-commit revert until Phase 9 cleanup |
| 9 | Cleanup: delete old routes, move files, SQL migration, docs | None — done after validation | Forward-only |

---

## Phase 0: Constants and types

### Task 0.1: Add league-average pitcher rate constants

**Files:**
- Modify: `lib/constants.ts`
- Test: `__tests__/constants.test.ts` (create if absent; otherwise extend)

**Why**: `pitcherFactor` and `bullpenFactor` need league-average baselines for ratio calculations. Existing `LEAGUE_AVG_RATES` is per-PA outcome; we need pitcher-side aggregates.

- [ ] **Step 1**: Add to `lib/constants.ts`:

```typescript
// League-average pitcher rates (recalibration target). 2025 MLB averages.
export const LG_K_PCT = 0.225        // K / BF
export const LG_BB_PCT = 0.085       // BB / BF
export const LG_HR_PCT = 0.030       // HR / BF
export const LG_HARD_HIT_RATE = 0.395 // hard-hit balls / BIP

// League-average team bullpen ERA (recalibration target).
export const LG_BULLPEN_ERA = 4.20

// Pitcher stabilization sample sizes (BF, batters faced).
export const STABILIZATION_BF: Record<string, number> = {
  k: 70,
  bb: 170,
  hr: 170,
  hardHit: 200,
}

// Bullpen stabilization sample size (IP).
export const STABILIZATION_BULLPEN_IP = 150

// Expected PA per game by lineup slot (1-9). Empirical league means.
export const expectedPAByLineupSlot: Record<number, number> = {
  1: 4.65, 2: 4.55, 3: 4.45, 4: 4.30, 5: 4.20, 6: 4.10, 7: 4.00, 8: 3.90, 9: 3.80,
}

// Average PA across all slots (weighted by frequency).
export const LG_PA_PER_GAME = 4.20

// Share of PAs faced against bullpen by lineup slot (empirical).
// Top-of-order sees less bullpen because they bat earlier in the game.
export const paShareVsBullpenBySlot: Record<number, number> = {
  1: 0.18, 2: 0.20, 3: 0.22, 4: 0.24, 5: 0.26, 6: 0.27, 7: 0.28, 8: 0.29, 9: 0.30,
}
```

- [ ] **Step 2**: Verify typecheck.

```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 3**: Verify build.

```bash
npm run build
```
Expected: PASS.

- [ ] **Step 4**: Commit.

```bash
git add lib/constants.ts
git commit -m "feat(constants): add pitcher/bullpen baselines + slot-PA tables for closed-form ranking"
```

---

## Phase 1: Offline probTypical infrastructure

### Task 1.1: Bullpen data adapter

**Files:**
- Create: `lib/bullpen.ts`
- Test: `__tests__/bullpen.test.ts`

- [ ] **Step 1**: Write `__tests__/bullpen.test.ts`:

```typescript
import { fetchBullpenStats } from '@/lib/bullpen'

describe('bullpen', () => {
  describe('fetchBullpenStats', () => {
    it('returns null gracefully on unknown teamId', async () => {
      const result = await fetchBullpenStats(0, 2026)
      expect(result).toBeNull()
    })

    it('returns shape { era, ip } on cached input', async () => {
      // Hermetic: prime the kv cache directly, then read.
      const { kvSet } = await import('@/lib/kv')
      await kvSet('bullpen:v1:147:2026', { era: 3.85, ip: 175.0 }, 60)
      const result = await fetchBullpenStats(147, 2026)
      expect(result).toEqual({ era: 3.85, ip: 175.0 })
    })
  })
})
```

- [ ] **Step 2**: Run test — fails (function doesn't exist).

```bash
npm test -- bullpen
```
Expected: FAIL.

- [ ] **Step 3**: Implement `lib/bullpen.ts`:

```typescript
import { kvGet, kvSet } from './kv'

export interface BullpenStats {
  era: number
  ip: number
}

const CACHE_TTL = 6 * 60 * 60  // 6 hours

/**
 * Fetch a team's bullpen stats from the MLB Stats API.
 * Returns null when the team or season is unknown / API fails.
 */
export async function fetchBullpenStats(
  teamId: number,
  season: number,
): Promise<BullpenStats | null> {
  if (teamId <= 0) return null

  const cacheKey = `bullpen:v1:${teamId}:${season}`
  const cached = await kvGet<BullpenStats>(cacheKey)
  if (cached) return cached

  // MLB Stats API: bullpen splits via teams/{teamId}/stats?stats=season&group=pitching&sportId=1
  // Filter to relievers (gamesStarted=0). Sum across the staff.
  try {
    const url =
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats` +
      `?stats=season&group=pitching&season=${season}&sportId=1&gameType=R`
    const res = await fetch(url, { next: { revalidate: CACHE_TTL } })
    if (!res.ok) return null
    const json = (await res.json()) as {
      stats?: Array<{ splits?: Array<{ stat?: { era?: string; inningsPitched?: string; gamesStarted?: number } }> }>
    }
    const splits = json.stats?.[0]?.splits ?? []
    let era = 0
    let ip = 0
    let weight = 0
    for (const s of splits) {
      const stat = s.stat
      if (!stat || (stat.gamesStarted ?? 0) > 0) continue  // skip starters
      const ipNum = parseFloat(stat.inningsPitched ?? '0')
      const eraNum = parseFloat(stat.era ?? '0')
      if (Number.isFinite(ipNum) && ipNum > 0) {
        era += eraNum * ipNum
        ip += ipNum
        weight += ipNum
      }
    }
    const result: BullpenStats = weight > 0
      ? { era: era / weight, ip }
      : { era: 4.2, ip: 0 }
    await kvSet(cacheKey, result, CACHE_TTL)
    return result
  } catch {
    return null
  }
}
```

- [ ] **Step 4**: Run test — passes.

```bash
npm test -- bullpen
```
Expected: PASS (2 tests).

- [ ] **Step 5**: Commit.

```bash
git add lib/bullpen.ts __tests__/bullpen.test.ts
git commit -m "feat(bullpen): add MLB stats adapter for opponent bullpen ERA + IP"
```

### Task 1.2: Slate batter list helper

**Files:**
- Create: `lib/slate-batters.ts`
- Test: `__tests__/slate-batters.test.ts`

- [ ] **Step 1**: Write the failing test.

```typescript
// __tests__/slate-batters.test.ts
import { getSlateBatterIds } from '@/lib/slate-batters'
import { kvSet } from '@/lib/kv'

describe('getSlateBatterIds', () => {
  it('returns empty array for date with no schedule', async () => {
    await kvSet('schedule:1990-01-01', [], 60)
    const ids = await getSlateBatterIds('1990-01-01')
    expect(ids).toEqual([])
  })

  it('deduplicates batters across games', async () => {
    // Implementation should call fetchSchedule + fetchLineup (per side) per game
    // and return unique playerIds. Mock at the cache-prime level.
    await kvSet('schedule:2026-04-28', [
      { gameId: 1, homeTeam: { teamId: 1 }, awayTeam: { teamId: 2 } },
      { gameId: 2, homeTeam: { teamId: 3 }, awayTeam: { teamId: 4 } },
    ], 60)
    await kvSet('lineup:1:home:2026-04-28', { entries: [{ player: { playerId: 100 } }, { player: { playerId: 101 } }] }, 60)
    await kvSet('lineup:1:away:2026-04-28', { entries: [{ player: { playerId: 102 } }] }, 60)
    await kvSet('lineup:2:home:2026-04-28', { entries: [{ player: { playerId: 100 } }, { player: { playerId: 103 } }] }, 60)
    await kvSet('lineup:2:away:2026-04-28', { entries: [{ player: { playerId: 104 } }] }, 60)
    const ids = await getSlateBatterIds('2026-04-28')
    expect(new Set(ids)).toEqual(new Set([100, 101, 102, 103, 104]))
  })
})
```

- [ ] **Step 2**: Run test — fails.

```bash
npm test -- slate-batters
```
Expected: FAIL.

- [ ] **Step 3**: Implement `lib/slate-batters.ts`:

```typescript
import { fetchSchedule } from './mlb-api'
import { fetchLineup } from './lineup'

/**
 * Build the deduplicated set of batter playerIds across all games on the given
 * date's slate. Used by the nightly slate-typical cron to know which batters
 * to prioritize for `probTypical` refresh.
 *
 * Tolerates partial / estimated lineups — they still expose batter identities,
 * just with lower confidence later in the pipeline.
 */
export async function getSlateBatterIds(date: string): Promise<number[]> {
  const games = await fetchSchedule(date)
  const playerIds = new Set<number>()
  for (const game of games) {
    if (game.status === 'postponed' || game.status === 'final') continue
    const [home, away] = await Promise.all([
      fetchLineup(game.gameId, game.homeTeam.teamId, 'home', date),
      fetchLineup(game.gameId, game.awayTeam.teamId, 'away', date),
    ])
    for (const e of home.entries) playerIds.add(e.player.playerId)
    for (const e of away.entries) playerIds.add(e.player.playerId)
  }
  return [...playerIds]
}
```

- [ ] **Step 4**: Run test — passes.

```bash
npm test -- slate-batters
```
Expected: PASS.

- [ ] **Step 5**: Commit.

```bash
git add lib/slate-batters.ts __tests__/slate-batters.test.ts
git commit -m "feat(slate-batters): helper to derive deduplicated batter ids for nightly slate sim"
```

### Task 1.3: Refactor `lib/p-typical.ts` — split compute from cache reader

**Files:**
- Modify: `lib/p-typical.ts`
- Test: `__tests__/p-typical.test.ts` (extend existing or create)

**Why**: We need `getPTypical()` to be a pure cache reader (with lazy backfill on miss); the heavy compute moves into `computeTypicalOffline()` which is called by the cron route.

- [ ] **Step 1**: Read the current `lib/p-typical.ts` to understand the existing flow.

```bash
# Just read it; no edit yet.
```

- [ ] **Step 2**: Write a failing test for the new shape.

```typescript
// __tests__/p-typical.test.ts (add or replace)
import { getPTypical } from '@/lib/p-typical'
import { kvSet } from '@/lib/kv'

describe('getPTypical (refactored)', () => {
  it('reads from typical:v1:{playerId} cache', async () => {
    await kvSet('typical:v1:592450', {
      playerId: 592450,
      atLeast: [1.0, 0.72, 0.38, 0.12, 0.04],
      iterations: 20000,
      computedAt: Date.now(),
    }, 60)
    const result = await getPTypical({ playerId: 592450 })
    expect(result.atLeast[1]).toBeCloseTo(0.72, 5)
    expect(result.atLeast[2]).toBeCloseTo(0.38, 5)
  })

  // Lazy backfill is exercised in an integration-style test;
  // skipped here to keep this hermetic.
})
```

- [ ] **Step 3**: Run test — should fail (current code uses different cache key).

```bash
npm test -- p-typical
```
Expected: FAIL.

- [ ] **Step 4**: Refactor `lib/p-typical.ts`. Replace the current file:

```typescript
/**
 * lib/p-typical.ts
 *
 * Cache-reader for `probTypical` baselines. The heavy compute lives in
 * computeTypicalOffline() and runs in the offline sim cron path —
 * see app/api/sim/typical/route.ts.
 *
 * Key prefix: `typical:v1:{playerId}`
 * TTL: 14 days (covers two refresh cycles)
 */

import { kvGet, kvSet } from './kv'
import { simSinglePlayerHRR } from './sim'
import { fetchBatterSeasonStats } from './mlb-api'
import { LEAGUE_AVG_RATES } from './constants'
import { stabilizeRates } from './stabilization'
import type { BatterSimContext, BatterHRRDist } from './sim'
import type { OutcomeRates } from './types'

export interface PTypicalResult {
  playerId: number
  atLeast: number[]                 // length 5, atLeast[k] = P(HRR ≥ k); atLeast[0] = 1
  iterations: number
  computedAt: number
}

const TYPICAL_TTL = 14 * 24 * 60 * 60   // 14 days
const SLATE_BASELINE_SLOT = 4
const ITERATIONS = 20_000

/** Fallback when no game log / season data exists. */
const LEAGUE_AVG_FALLBACK: number[] = [1.0, 0.65, 0.30, 0.10, 0.03]

/** Cache reader. Backfills inline (single 20k-iter sim) on miss. */
export async function getPTypical(args: {
  playerId: number
  season?: number
}): Promise<PTypicalResult> {
  const cacheKey = `typical:v1:${args.playerId}`
  const cached = await kvGet<PTypicalResult>(cacheKey)
  if (cached) return cached

  // Lazy backfill — rare path. Logs a warning so cron drift is visible.
  console.warn(`[p-typical] cache miss for player ${args.playerId} — running inline backfill`)
  const result = await computeTypicalOffline({ playerId: args.playerId, season: args.season })
  await kvSet(cacheKey, result, TYPICAL_TTL)
  return result
}

/** Heavy compute. Called by the offline sim route + the lazy backfill path. */
export async function computeTypicalOffline(args: {
  playerId: number
  season?: number
}): Promise<PTypicalResult> {
  const season = args.season ?? new Date().getFullYear()

  let batterSeason
  try {
    batterSeason = await fetchBatterSeasonStats(args.playerId, season)
  } catch {
    return makeFallback(args.playerId)
  }

  if (batterSeason.pa === 0) {
    return makeFallback(args.playerId)
  }

  const targetRates: OutcomeRates = stabilizeRates(
    batterSeason.outcomeRates,
    LEAGUE_AVG_RATES,
    batterSeason.pa,
  )

  const dist = await simulateAtSlot(args.playerId, SLATE_BASELINE_SLOT, ITERATIONS, targetRates)

  return {
    playerId: args.playerId,
    atLeast: [...dist.atLeast],
    iterations: ITERATIONS,
    computedAt: Date.now(),
  }
}

function makeFallback(playerId: number): PTypicalResult {
  return {
    playerId,
    atLeast: [...LEAGUE_AVG_FALLBACK],
    iterations: 0,
    computedAt: Date.now(),
  }
}

function makeContext(batterId: number, rates: OutcomeRates): BatterSimContext {
  const ratesArr = [rates, rates, rates, rates, rates]
  return {
    batterId,
    ratesVsStarterByPA: ratesArr,
    ratesVsBullpenByPA: ratesArr,
    starterShareByPA: [0.95, 0.85, 0.65, 0.40, 0.10],
  }
}

async function simulateAtSlot(
  playerId: number,
  slot: number,
  iterations: number,
  targetRates: OutcomeRates,
): Promise<BatterHRRDist> {
  const s = Math.max(1, Math.min(9, slot))
  const lgRates = { ...LEAGUE_AVG_RATES }
  const homeLineup: BatterSimContext[] = Array.from({ length: 9 }, (_, i) =>
    i + 1 === s ? makeContext(playerId, targetRates) : makeContext(1_000_000 + i, lgRates),
  )
  const awayLineup: BatterSimContext[] = Array.from({ length: 9 }, (_, i) =>
    makeContext(2_000_000 + i, lgRates),
  )
  return simSinglePlayerHRR({
    targetPlayerId: playerId,
    homeLineup,
    awayLineup,
    iterations,
  })
}
```

- [ ] **Step 5**: Run test — passes.

```bash
npm test -- p-typical
```
Expected: PASS.

- [ ] **Step 6**: Run full validation gates.

```bash
npm run lint && npm run typecheck && npm test
```
Expected: all PASS.

- [ ] **Step 7**: Add a one-shot SQL migration to GC the deprecated `p-typical:*` cache rows.

Create `supabase/migrations/2026-04-28-deprecate-p-typical-cache.sql`:

```sql
-- One-shot: delete deprecated p-typical:* cache rows. New baseline lives
-- under typical:v1:* (see docs/superpowers/specs/2026-04-28-hybrid-ranking-refactor-design.md).
DELETE FROM cache WHERE key LIKE 'p-typical:%';
```

- [ ] **Step 8**: Commit.

```bash
git add lib/p-typical.ts __tests__/p-typical.test.ts supabase/migrations/2026-04-28-deprecate-p-typical-cache.sql
git commit -m "refactor(p-typical): split offline compute from cache reader; bump key prefix to typical:v1; single-slot 20k-iter baseline"
```

### Task 1.4: `/api/sim/typical` route

**Files:**
- Create: `app/api/sim/typical/route.ts`
- Test: `__tests__/sim-typical.test.ts`

- [ ] **Step 1**: Write failing tests.

```typescript
// __tests__/sim-typical.test.ts
import { POST } from '@/app/api/sim/typical/route'
import { NextRequest } from 'next/server'

function buildReq(body: object, secret = process.env.CRON_SECRET ?? '') {
  return new NextRequest('http://localhost/api/sim/typical', {
    method: 'POST',
    headers: { 'x-cron-secret': secret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/sim/typical', () => {
  it('rejects requests without cron secret in production', async () => {
    process.env.NODE_ENV = 'production'
    const req = buildReq({ mode: 'player', playerId: 1 }, 'wrong-secret')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects malformed body', async () => {
    const req = buildReq({ mode: 'invalid' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects player mode without playerId', async () => {
    const req = buildReq({ mode: 'player' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('accepts full mode', async () => {
    const req = buildReq({ mode: 'full' })
    const res = await POST(req)
    // 200 even if zero players — orchestrator just enumerates
    expect([200, 504]).toContain(res.status)
  })
})
```

- [ ] **Step 2**: Run — fails (route doesn't exist).

```bash
npm test -- sim-typical
```
Expected: FAIL.

- [ ] **Step 3**: Implement `app/api/sim/typical/route.ts`:

```typescript
/**
 * POST /api/sim/typical
 *
 * Two modes:
 *  - { mode: 'full' } → orchestrator: enumerates active batters, fans out one
 *    fire-and-forget HTTPS call per batter to this same route in 'player' mode.
 *  - { mode: 'player', playerId } → run 20k-iter MC for one batter, write
 *    typical:v1:{playerId}.
 *
 * Auth: x-cron-secret header (same as other cron routes).
 *
 * The 'full' orchestrator returns immediately after fan-out; each per-player
 * call has its own full 10s Vercel function budget.
 */
import { NextRequest, NextResponse } from 'next/server'
import { computeTypicalOffline } from '@/lib/p-typical'
import { kvSet } from '@/lib/kv'
import { verifyCronRequest } from '@/lib/cron-auth'

export const maxDuration = 10
const TYPICAL_TTL = 14 * 24 * 60 * 60

interface PlayerBody { mode: 'player'; playerId: number; season?: number }
interface FullBody { mode: 'full'; season?: number }
type Body = PlayerBody | FullBody

function isFull(b: Body): b is FullBody { return b.mode === 'full' }
function isPlayer(b: Body): b is PlayerBody { return b.mode === 'player' }

function selfBaseUrl(): string {
  const v = process.env.VERCEL_URL
  if (v) return `https://${v}`
  return `http://localhost:${process.env.PORT ?? '3000'}`
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body || (body.mode !== 'full' && body.mode !== 'player')) {
    return NextResponse.json({ error: 'invalid mode' }, { status: 400 })
  }

  if (isPlayer(body)) {
    if (!Number.isInteger(body.playerId) || body.playerId <= 0) {
      return NextResponse.json({ error: 'invalid playerId' }, { status: 400 })
    }
    return await handlePlayerMode(body)
  }

  if (isFull(body)) {
    return await handleFullMode(body, req)
  }

  // Unreachable but keeps the compiler quiet.
  return NextResponse.json({ error: 'unreachable' }, { status: 500 })
}

async function handlePlayerMode(body: PlayerBody): Promise<NextResponse> {
  try {
    const result = await computeTypicalOffline({
      playerId: body.playerId,
      season: body.season,
    })
    await kvSet(`typical:v1:${body.playerId}`, result, TYPICAL_TTL)
    return NextResponse.json({
      mode: 'player',
      playerIds: [body.playerId],
      computedAt: result.computedAt,
      errors: [],
    })
  } catch (err) {
    return NextResponse.json({
      mode: 'player',
      playerIds: [body.playerId],
      computedAt: Date.now(),
      errors: [String((err as Error).message ?? err)],
    }, { status: 500 })
  }
}

async function handleFullMode(body: FullBody, req: NextRequest): Promise<NextResponse> {
  // Build the active-batters list. For v1 this uses fetchActiveBatterIds()
  // which we'll define in lib/active-batters.ts in Task 1.5. Since that task
  // hasn't shipped yet, this implementation imports it lazily and returns 0
  // players when the import fails.
  let playerIds: number[] = []
  try {
    const mod = await import('@/lib/active-batters')
    playerIds = await mod.getActiveBatterIds(body.season ?? new Date().getFullYear())
  } catch {
    // Module not available yet — shipped progressively. Return empty success.
    playerIds = []
  }

  const cronSecret = req.headers.get('x-cron-secret') ?? ''
  const base = selfBaseUrl()

  // Fire-and-forget per-player calls. Each is its own Vercel function invocation
  // with its own 10s budget.
  for (const pid of playerIds) {
    void fetch(`${base}/api/sim/typical`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify({ mode: 'player', playerId: pid }),
      cache: 'no-store',
    }).catch(() => undefined)
  }

  return NextResponse.json({
    mode: 'full',
    playerIds,
    computedAt: Date.now(),
    errors: [],
  })
}
```

- [ ] **Step 4**: Run tests — pass.

```bash
npm test -- sim-typical
```
Expected: PASS.

- [ ] **Step 5**: Commit.

```bash
git add app/api/sim/typical/route.ts __tests__/sim-typical.test.ts
git commit -m "feat(api): /api/sim/typical with full + player modes for offline probTypical"
```

### Task 1.5: Active batters helper

**Files:**
- Create: `lib/active-batters.ts`
- Test: `__tests__/active-batters.test.ts`

- [ ] **Step 1**: Write failing test.

```typescript
// __tests__/active-batters.test.ts
import { getActiveBatterIds } from '@/lib/active-batters'

describe('getActiveBatterIds', () => {
  it('returns a non-empty array of integer playerIds', async () => {
    if (!process.env.RUN_LIVE_TESTS) {
      // Hermetic stub: skip live network test
      return
    }
    const ids = await getActiveBatterIds(new Date().getFullYear())
    expect(Array.isArray(ids)).toBe(true)
    expect(ids.length).toBeGreaterThan(400)
    expect(ids.length).toBeLessThan(1500)
    expect(ids.every(id => Number.isInteger(id) && id > 0)).toBe(true)
  })
})
```

- [ ] **Step 2**: Implement `lib/active-batters.ts`.

```typescript
/**
 * Build the list of active MLB batter playerIds for the given season —
 * roster-based (40-man) intersected with "has at least 1 PA this season".
 *
 * Used by /api/sim/typical {mode: 'full'} to know which players to refresh
 * during the weekly population sweep.
 */
import { kvGet, kvSet } from './kv'

const TTL = 12 * 60 * 60  // 12h
const MLB_TEAMS = Array.from({ length: 30 }, (_, i) => i + 108)  // approximate; replaced with real fetch below

export async function getActiveBatterIds(season: number): Promise<number[]> {
  const cacheKey = `active-batters:v1:${season}`
  const cached = await kvGet<number[]>(cacheKey)
  if (cached) return cached

  const ids = new Set<number>()

  // Step 1: enumerate all MLB teams
  let teamIds: number[]
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Y`, { next: { revalidate: TTL } })
    if (!res.ok) return []
    const json = (await res.json()) as { teams?: Array<{ id: number }> }
    teamIds = (json.teams ?? []).map(t => t.id)
  } catch {
    return []
  }

  // Step 2: 40-man roster per team (parallel, tolerant of single-team failure)
  const rosters = await Promise.all(teamIds.map(async tid => {
    try {
      const res = await fetch(
        `https://statsapi.mlb.com/api/v1/teams/${tid}/roster?rosterType=40Man`,
        { next: { revalidate: TTL } },
      )
      if (!res.ok) return [] as number[]
      const json = (await res.json()) as { roster?: Array<{ person?: { id: number }; position?: { abbreviation?: string } }> }
      return (json.roster ?? [])
        .filter(r => r.position?.abbreviation && r.position.abbreviation !== 'P')
        .map(r => r.person?.id ?? 0)
        .filter(id => id > 0)
    } catch {
      return []
    }
  }))
  for (const arr of rosters) for (const id of arr) ids.add(id)

  const result = [...ids].sort((a, b) => a - b)
  await kvSet(cacheKey, result, TTL)
  return result
}

// Suppress unused-import warning while preserving the constant for reference.
void MLB_TEAMS
```

- [ ] **Step 3**: Verify tests + types.

```bash
npm test -- active-batters && npm run typecheck
```
Expected: PASS.

- [ ] **Step 4**: Commit.

```bash
git add lib/active-batters.ts __tests__/active-batters.test.ts
git commit -m "feat(active-batters): roster-derived active-batter id list for full-population sim"
```

### Task 1.6: Add cron jobs for typical sim

**Files:**
- Modify: `.github/workflows/cron.yml`

- [ ] **Step 1**: Read the current cron.yml to understand existing structure.

```bash
cat .github/workflows/cron.yml
```

- [ ] **Step 2**: Add two new cron entries (DO NOT remove the per-game sim cron yet — that happens in Phase 9).

Insert at the top of the schedule list:

```yaml
on:
  schedule:
    # Existing schedules below... add these two:
    - cron: '0 8 * * 0'      # Sunday 4 AM ET — full-population typical
    - cron: '0 8 * * 1-6'    # Mon-Sat 4 AM ET — slate-batter typical
    # ... existing schedules continue
```

Add the corresponding job:

```yaml
jobs:
  typical-sim:
    if: github.event_name == 'schedule' && (github.event.schedule == '0 8 * * 0' || github.event.schedule == '0 8 * * 1-6')
    runs-on: ubuntu-latest
    steps:
      - name: Determine mode
        id: mode
        run: |
          if [ "${{ github.event.schedule }}" = '0 8 * * 0' ]; then
            echo "mode=full" >> $GITHUB_OUTPUT
          else
            echo "mode=slate" >> $GITHUB_OUTPUT
          fi
      - name: Compute slate-batter ids (slate mode only)
        if: steps.mode.outputs.mode == 'slate'
        id: slate
        run: |
          TOMORROW=$(TZ='America/New_York' date -d 'tomorrow' +%Y-%m-%d)
          # Hit a helper endpoint that returns slate batter ids.
          IDS=$(curl -fsS -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_BASE_URL }}/api/sim/typical-slate-ids?date=$TOMORROW")
          echo "ids=$IDS" >> $GITHUB_OUTPUT
      - name: Trigger full-mode sim
        if: steps.mode.outputs.mode == 'full'
        run: |
          curl -fsS -X POST -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            -H "content-type: application/json" \
            -d '{"mode":"full"}' \
            "${{ secrets.APP_BASE_URL }}/api/sim/typical"
      - name: Trigger slate-mode per-player calls
        if: steps.mode.outputs.mode == 'slate'
        run: |
          for pid in $(echo '${{ steps.slate.outputs.ids }}' | jq -r '.[]'); do
            curl -fsS -X POST -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
              -H "content-type: application/json" \
              -d "{\"mode\":\"player\",\"playerId\":$pid}" \
              "${{ secrets.APP_BASE_URL }}/api/sim/typical" &
          done
          wait
```

- [ ] **Step 3**: The slate-mode step references `/api/sim/typical-slate-ids` which doesn't exist yet. Add a small read-only endpoint:

Create `app/api/sim/typical-slate-ids/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSlateBatterIds } from '@/lib/slate-batters'
import { verifyCronRequest } from '@/lib/cron-auth'
import { slateDateString, isValidIsoDate } from '@/lib/date-utils'

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dateParam = new URL(req.url).searchParams.get('date')
  if (dateParam !== null && !isValidIsoDate(dateParam)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 })
  }
  const date = dateParam ?? slateDateString()
  const ids = await getSlateBatterIds(date)
  return NextResponse.json(ids)
}
```

- [ ] **Step 4**: Validate gates.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```
Expected: all PASS.

- [ ] **Step 5**: Commit.

```bash
git add .github/workflows/cron.yml app/api/sim/typical-slate-ids/route.ts
git commit -m "ci(cron): weekly + nightly-slate typical-sim jobs"
```

---

## Phase 2: Closed-form `probToday` factor library

Each factor file is a small pure function with a unit test. Files DRY off `lib/constants.ts`.

### Task 2.1: `paCountFactor`

**Files:**
- Create: `lib/factors/pa-count.ts`
- Test: `__tests__/factors/pa-count.test.ts`

- [ ] **Step 1**: Failing test.

```typescript
// __tests__/factors/pa-count.test.ts
import { computePaCountFactor } from '@/lib/factors/pa-count'

describe('paCountFactor', () => {
  it('is > 1 for top-of-order slots', () => {
    const f = computePaCountFactor({ probTypical: 0.65, slot: 1 })
    expect(f).toBeGreaterThan(1.0)
    expect(f).toBeLessThanOrEqual(1.15)
  })

  it('is < 1 for bottom-of-order slots', () => {
    const f = computePaCountFactor({ probTypical: 0.65, slot: 9 })
    expect(f).toBeLessThan(1.0)
    expect(f).toBeGreaterThanOrEqual(0.85)
  })

  it('is ≈ 1 at slot 5 (near league mean PA)', () => {
    const f = computePaCountFactor({ probTypical: 0.65, slot: 5 })
    expect(f).toBeCloseTo(1.0, 1)
  })

  it('is monotonic decreasing in slot', () => {
    const fs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(s =>
      computePaCountFactor({ probTypical: 0.5, slot: s }),
    )
    for (let i = 1; i < fs.length; i++) expect(fs[i]).toBeLessThan(fs[i - 1])
  })

  it('clamps to [0.85, 1.15]', () => {
    expect(computePaCountFactor({ probTypical: 0.99, slot: 1 })).toBeLessThanOrEqual(1.15)
    expect(computePaCountFactor({ probTypical: 0.01, slot: 9 })).toBeGreaterThanOrEqual(0.85)
  })

  it('returns 1 for invalid slot', () => {
    expect(computePaCountFactor({ probTypical: 0.5, slot: 0 })).toBe(1)
    expect(computePaCountFactor({ probTypical: 0.5, slot: 10 })).toBe(1)
  })
})
```

- [ ] **Step 2**: Run — fails.

```bash
npm test -- factors/pa-count
```
Expected: FAIL.

- [ ] **Step 3**: Implement `lib/factors/pa-count.ts`:

```typescript
import { expectedPAByLineupSlot, LG_PA_PER_GAME } from '../constants'

/**
 * Adjust probTypical for the actual lineup slot's expected PA count today.
 *
 * Rationale: probTypical is computed at slot 4 (mid-order, league-mean PA).
 * A leadoff hitter sees more PAs than a 9-hole bat; this factor scales the
 * probability of clearing the rung accordingly.
 *
 * Approximation: assumes per-PA HRR probability is constant across PAs and
 * PAs are independent. Both are imperfect (TTO, baserunner state) but the
 * resulting factor is bounded [0.85, 1.15] so the error stays small.
 */
export function computePaCountFactor(args: {
  probTypical: number
  slot: number
}): number {
  if (!Number.isInteger(args.slot) || args.slot < 1 || args.slot > 9) return 1

  const expectedPA = expectedPAByLineupSlot[args.slot]
  if (!expectedPA) return 1

  const basePA = LG_PA_PER_GAME
  const pPerPA = Math.min(0.99, Math.max(0.001, args.probTypical / basePA))

  const notClearToday = Math.pow(1 - pPerPA, expectedPA)
  const notClearBase = Math.pow(1 - pPerPA, basePA)
  const factor = (1 - notClearToday) / Math.max(0.001, 1 - notClearBase)

  return Math.min(1.15, Math.max(0.85, factor))
}
```

- [ ] **Step 4**: Run — passes.

```bash
npm test -- factors/pa-count
```
Expected: PASS (6 tests).

- [ ] **Step 5**: Commit.

```bash
git add lib/factors/pa-count.ts __tests__/factors/pa-count.test.ts
git commit -m "feat(factors): paCountFactor adjusts for lineup-slot expected PA count"
```

### Task 2.2: `handednessFactor`

**Files:**
- Create: `lib/factors/handedness.ts`
- Test: `__tests__/factors/handedness.test.ts`

- [ ] **Step 1**: Failing test.

```typescript
import { computeHandednessFactor } from '@/lib/factors/handedness'

describe('handednessFactor', () => {
  it('1.00 for switch hitter regardless of pitcher hand', () => {
    expect(computeHandednessFactor({ batterHand: 'S', pitcherThrows: 'R' })).toBe(1.00)
    expect(computeHandednessFactor({ batterHand: 'S', pitcherThrows: 'L' })).toBe(1.00)
  })

  it('0.97 for same-side matchup', () => {
    expect(computeHandednessFactor({ batterHand: 'R', pitcherThrows: 'R' })).toBe(0.97)
    expect(computeHandednessFactor({ batterHand: 'L', pitcherThrows: 'L' })).toBe(0.97)
  })

  it('1.03 for opposite-side matchup', () => {
    expect(computeHandednessFactor({ batterHand: 'R', pitcherThrows: 'L' })).toBe(1.03)
    expect(computeHandednessFactor({ batterHand: 'L', pitcherThrows: 'R' })).toBe(1.03)
  })
})
```

- [ ] **Step 2**: Run — fails.

```bash
npm test -- factors/handedness
```
Expected: FAIL.

- [ ] **Step 3**: Implement `lib/factors/handedness.ts`:

```typescript
import type { Handedness } from '../types'

/**
 * Bounded platoon advantage multiplier.
 *
 * S (switch hitter) → 1.00 (effectively neutral; we use averaged park factor too)
 * Same-side          → 0.97 (~3% disadvantage for the hitter)
 * Opposite-side      → 1.03 (~3% advantage)
 *
 * Calibration target: empirical platoon split varies by player and outcome
 * mix, but the league aggregate is ~3% in OBP and ~5% in SLG. Using 3% as
 * an HRR-aggregate compromise.
 */
export function computeHandednessFactor(args: {
  batterHand: 'R' | 'L' | 'S'
  pitcherThrows: Handedness
}): number {
  if (args.batterHand === 'S') return 1.00
  if (args.batterHand === args.pitcherThrows) return 0.97
  return 1.03
}
```

- [ ] **Step 4**: Run — passes.

```bash
npm test -- factors/handedness
```
Expected: PASS.

- [ ] **Step 5**: Commit.

```bash
git add lib/factors/handedness.ts __tests__/factors/handedness.test.ts
git commit -m "feat(factors): handednessFactor with platoon advantage multiplier"
```

### Task 2.3: `weatherFactor`

**Files:**
- Create: `lib/factors/weather.ts`
- Test: `__tests__/factors/weather.test.ts`

- [ ] **Step 1**: Failing test.

```typescript
import { computeWeatherFactor } from '@/lib/factors/weather'

describe('weatherFactor', () => {
  it('returns 1.0 for dome (controlled)', () => {
    expect(computeWeatherFactor({ hrMult: 1.20, controlled: true, failure: false })).toBe(1)
  })

  it('returns 1.0 on fetch failure', () => {
    expect(computeWeatherFactor({ hrMult: 0.80, controlled: false, failure: true })).toBe(1)
  })

  it('dampens HR multiplier toward 1.0 for HRR aggregate', () => {
    // hrMult 1.20 (helps HRs) → factor < 1.20 because HRR also has H1B/H2B which weather barely affects
    const factor = computeWeatherFactor({ hrMult: 1.20, controlled: false, failure: false })
    expect(factor).toBeGreaterThan(1.0)
    expect(factor).toBeLessThan(1.20)
    expect(factor).toBeCloseTo(1.12, 2)  // 1 + 0.6 × 0.20
  })

  it('clamps to [0.85, 1.20]', () => {
    expect(computeWeatherFactor({ hrMult: 2.0, controlled: false, failure: false })).toBeLessThanOrEqual(1.20)
    expect(computeWeatherFactor({ hrMult: 0.1, controlled: false, failure: false })).toBeGreaterThanOrEqual(0.85)
  })
})
```

- [ ] **Step 2**: Implement `lib/factors/weather.ts`:

```typescript
/**
 * HRR-scaled weather factor. Wraps the HR-only multiplier from
 * lib/weather-factors.ts: HRR is a dampened version of HR because most HRR
 * comes from singles/doubles which weather barely affects.
 *
 * Empirical dampener 0.6 is grounded in published research (Nathan, Kovalchik)
 * and is a calibration target. Domes and fetch failures short-circuit to 1.0.
 */
export function computeWeatherFactor(args: {
  hrMult: number
  controlled: boolean
  failure: boolean
}): number {
  if (args.controlled || args.failure) return 1
  const factor = 1 + 0.6 * (args.hrMult - 1)
  return Math.min(1.20, Math.max(0.85, factor))
}
```

- [ ] **Step 3**: Run + commit.

```bash
npm test -- factors/weather
git add lib/factors/weather.ts __tests__/factors/weather.test.ts
git commit -m "feat(factors): weatherFactor wraps existing HR multiplier with HRR dampener"
```

### Task 2.4: `parkFactor` (composite HRR)

**Files:**
- Modify: `lib/park-factors.ts` (extend with `getHrrParkFactorForBatter`)
- Create: `lib/factors/park.ts` (the bounded wrapper)
- Test: `__tests__/factors/park.test.ts`

- [ ] **Step 1**: Read current `lib/park-factors.ts` to understand the existing data shape.

- [ ] **Step 2**: Failing test.

```typescript
import { computeParkFactor } from '@/lib/factors/park'

describe('parkFactor', () => {
  it('returns 1.0 for unknown venue', () => {
    expect(computeParkFactor({ venueId: 0, batterHand: 'R' })).toBe(1)
  })

  it('returns a value in [0.7, 1.3] for known venues', () => {
    // Coors Field venueId = 19 — most extreme hitter park
    const f = computeParkFactor({ venueId: 19, batterHand: 'R' })
    expect(f).toBeGreaterThan(0.7)
    expect(f).toBeLessThan(1.3)
  })

  it('treats switch hitter as average of L/R values', () => {
    const r = computeParkFactor({ venueId: 19, batterHand: 'R' })
    const l = computeParkFactor({ venueId: 19, batterHand: 'L' })
    const s = computeParkFactor({ venueId: 19, batterHand: 'S' })
    expect(s).toBeCloseTo((r + l) / 2, 3)
  })
})
```

- [ ] **Step 3**: Extend `lib/park-factors.ts` with hit and run factor lookups:

(See current `lib/park-factors.ts` for the existing per-handedness HR table. Add parallel tables for `1B`, `2B`, `3B`, and `R` columns from FanGraphs Guts! 2025 data. The hit factor combines the three single+extra-base factors weighted by league-rate-of-occurrence: 1B ~70%, 2B ~25%, 3B ~5%.)

- [ ] **Step 4**: Implement `lib/factors/park.ts`:

```typescript
import { getHrParkFactorForBatter, getHitParkFactorForBatter, getRunParkFactor, hasParkData } from '../park-factors'

/**
 * Composite HRR park factor: weighted sum of hit, run, and HR park factors.
 * Weights derived from empirical HRR composition (~50% from hits, ~25% R, ~25% RBI).
 * RBI scales tightly with HR. Bounded [0.7, 1.3] — covers all 30 MLB parks.
 */
export function computeParkFactor(args: {
  venueId: number
  batterHand: 'R' | 'L' | 'S'
}): number {
  if (!hasParkData(args.venueId)) return 1

  if (args.batterHand === 'S') {
    const r = composite(args.venueId, 'R')
    const l = composite(args.venueId, 'L')
    return clamp((r + l) / 2)
  }
  return clamp(composite(args.venueId, args.batterHand))
}

function composite(venueId: number, hand: 'R' | 'L'): number {
  const hr = getHrParkFactorForBatter(venueId, hand)
  const hit = getHitParkFactorForBatter(venueId, hand)
  const run = getRunParkFactor(venueId)
  return 0.50 * hit + 0.25 * run + 0.25 * hr
}

function clamp(x: number): number {
  return Math.min(1.3, Math.max(0.7, x))
}
```

- [ ] **Step 5**: Run + commit.

```bash
npm test -- factors/park
git add lib/factors/park.ts lib/park-factors.ts __tests__/factors/park.test.ts
git commit -m "feat(factors): composite HRR parkFactor using FG Guts hit + run + HR per-handedness"
```

### Task 2.5: `pitcherFactor`

**Files:**
- Create: `lib/factors/pitcher.ts`
- Test: `__tests__/factors/pitcher.test.ts`

- [ ] **Step 1**: Failing test.

```typescript
import { computePitcherFactor } from '@/lib/factors/pitcher'

describe('pitcherFactor', () => {
  it('returns 1.0 for TBD pitcher (id 0)', () => {
    expect(computePitcherFactor({ pitcher: { id: 0, kPct: 0, bbPct: 0, hrPct: 0, hardHitRate: 0, bf: 0, recentStarts: 0 } })).toBe(1)
  })

  it('returns 1.0 for low-sample pitcher (< 3 recent starts)', () => {
    expect(computePitcherFactor({ pitcher: { id: 1, kPct: 0.30, bbPct: 0.05, hrPct: 0.02, hardHitRate: 0.30, bf: 50, recentStarts: 2 } })).toBe(1)
  })

  it('returns < 1 for elite pitcher (high K, low HR)', () => {
    const f = computePitcherFactor({ pitcher: { id: 1, kPct: 0.32, bbPct: 0.05, hrPct: 0.020, hardHitRate: 0.30, bf: 800, recentStarts: 25 } })
    expect(f).toBeLessThan(1.0)
    expect(f).toBeGreaterThanOrEqual(0.5)
  })

  it('returns > 1 for poor pitcher (high HR, low K)', () => {
    const f = computePitcherFactor({ pitcher: { id: 1, kPct: 0.15, bbPct: 0.10, hrPct: 0.045, hardHitRate: 0.45, bf: 800, recentStarts: 25 } })
    expect(f).toBeGreaterThan(1.0)
    expect(f).toBeLessThanOrEqual(2.0)
  })

  it('clamps to [0.5, 2.0]', () => {
    const verylow = computePitcherFactor({ pitcher: { id: 1, kPct: 0.50, bbPct: 0.01, hrPct: 0.005, hardHitRate: 0.20, bf: 1000, recentStarts: 30 } })
    const veryhigh = computePitcherFactor({ pitcher: { id: 1, kPct: 0.05, bbPct: 0.20, hrPct: 0.10, hardHitRate: 0.55, bf: 1000, recentStarts: 30 } })
    expect(verylow).toBeGreaterThanOrEqual(0.5)
    expect(veryhigh).toBeLessThanOrEqual(2.0)
  })
})
```

- [ ] **Step 2**: Implement `lib/factors/pitcher.ts`:

```typescript
import { stabilize } from '../stabilization'
import {
  LG_K_PCT, LG_BB_PCT, LG_HR_PCT, LG_HARD_HIT_RATE, STABILIZATION_BF,
} from '../constants'

export interface PitcherInputs {
  id: number               // 0 = TBD
  kPct: number             // K / BF
  bbPct: number            // BB / BF
  hrPct: number            // HR / BF
  hardHitRate: number      // hard-hit / BIP
  bf: number               // batters faced (for stabilization)
  recentStarts: number     // count of recent starts in sample
}

export function computePitcherFactor(args: { pitcher: PitcherInputs }): number {
  const p = args.pitcher
  if (p.id === 0) return 1
  if (p.recentStarts < 3) return 1

  const k = stabilize(p.kPct, LG_K_PCT, p.bf, STABILIZATION_BF.k)
  const bb = stabilize(p.bbPct, LG_BB_PCT, p.bf, STABILIZATION_BF.bb)
  const hr = stabilize(p.hrPct, LG_HR_PCT, p.bf, STABILIZATION_BF.hr)
  const hh = stabilize(p.hardHitRate, LG_HARD_HIT_RATE, p.bf, STABILIZATION_BF.hardHit)

  // Higher K and BB suppress balls in play; higher HR allowed and hard-hit help the batter.
  const kRatio = k / LG_K_PCT
  const bbRatio = bb / LG_BB_PCT
  const hrRatio = hr / LG_HR_PCT
  const hhRatio = hh / LG_HARD_HIT_RATE

  const quality = (1 / kRatio) * (1 / bbRatio) * hrRatio * hhRatio
  return Math.min(2.0, Math.max(0.5, quality))
}
```

- [ ] **Step 3**: Verify `stabilize` exists at the expected location. If `lib/stabilization.ts` exports `stabilizeRates` only, add a scalar version:

```typescript
// lib/stabilization.ts (extend)
/**
 * Scalar stabilization (Carleton): shrink an observed rate toward a prior using
 * the harmonic ratio of sample size to stabilization PA/BF.
 */
export function stabilize(observed: number, prior: number, sample: number, stabilizationN: number): number {
  if (sample <= 0) return prior
  const w = sample / (sample + stabilizationN)
  return w * observed + (1 - w) * prior
}
```

- [ ] **Step 4**: Run + commit.

```bash
npm test -- factors/pitcher
git add lib/factors/pitcher.ts lib/stabilization.ts __tests__/factors/pitcher.test.ts
git commit -m "feat(factors): pitcherFactor combines stabilized K%/BB%/HR%/hard-hit ratios"
```

### Task 2.6: `bullpenFactor`

**Files:**
- Create: `lib/factors/bullpen.ts`
- Test: `__tests__/factors/bullpen.test.ts`

- [ ] **Step 1**: Failing test.

```typescript
import { computeBullpenFactor } from '@/lib/factors/bullpen'

describe('bullpenFactor', () => {
  it('returns 1.0 when bullpen stats are null', () => {
    expect(computeBullpenFactor({ bullpen: null, lineupSlot: 4 })).toBe(1)
  })

  it('returns 1.0 when bullpenIp is below stabilization threshold', () => {
    expect(computeBullpenFactor({
      bullpen: { era: 6.0, ip: 5 },  // tiny sample → fully shrunk → ratio ≈ 1
      lineupSlot: 4,
    })).toBeCloseTo(1.0, 1)
  })

  it('returns > 1 for poor bullpen at mid-order slot', () => {
    const f = computeBullpenFactor({
      bullpen: { era: 5.50, ip: 200 },
      lineupSlot: 5,
    })
    expect(f).toBeGreaterThan(1.0)
    expect(f).toBeLessThanOrEqual(1.15)
  })

  it('returns < 1 for elite bullpen', () => {
    const f = computeBullpenFactor({
      bullpen: { era: 2.80, ip: 200 },
      lineupSlot: 5,
    })
    expect(f).toBeLessThan(1.0)
    expect(f).toBeGreaterThanOrEqual(0.85)
  })

  it('is closer to 1.0 for top-of-order than bottom-of-order', () => {
    const top = computeBullpenFactor({ bullpen: { era: 5.50, ip: 200 }, lineupSlot: 1 })
    const bottom = computeBullpenFactor({ bullpen: { era: 5.50, ip: 200 }, lineupSlot: 9 })
    expect(top - 1.0).toBeLessThan(bottom - 1.0)
  })
})
```

- [ ] **Step 2**: Implement `lib/factors/bullpen.ts`:

```typescript
import type { BullpenStats } from '../bullpen'
import { stabilize } from '../stabilization'
import { LG_BULLPEN_ERA, STABILIZATION_BULLPEN_IP, paShareVsBullpenBySlot } from '../constants'

/**
 * Adjust for opponent bullpen quality, scaled by the share of PAs the batter
 * is expected to face the bullpen (depends on lineup slot).
 */
export function computeBullpenFactor(args: {
  bullpen: BullpenStats | null
  lineupSlot: number
}): number {
  if (!args.bullpen) return 1
  const slot = Number.isInteger(args.lineupSlot) && args.lineupSlot >= 1 && args.lineupSlot <= 9
    ? args.lineupSlot
    : 5
  const share = paShareVsBullpenBySlot[slot]
  const era = stabilize(args.bullpen.era, LG_BULLPEN_ERA, args.bullpen.ip, STABILIZATION_BULLPEN_IP)
  // ERA > LG = pitching is worse than league = batter is helped → factor > 1.
  const qualityRatio = era / LG_BULLPEN_ERA
  const factor = 1 + share * (qualityRatio - 1)
  return Math.min(1.15, Math.max(0.85, factor))
}
```

- [ ] **Step 3**: Run + commit.

```bash
npm test -- factors/bullpen
git add lib/factors/bullpen.ts __tests__/factors/bullpen.test.ts
git commit -m "feat(factors): bullpenFactor scales by opponent ERA × per-slot bullpen exposure"
```

---

## Phase 3: `computeProbToday()` orchestrator

### Task 3.1: Compose all factors into `probToday`

**Files:**
- Create: `lib/prob-today.ts`
- Test: `__tests__/prob-today.test.ts`

- [ ] **Step 1**: Failing test.

```typescript
import { computeProbToday } from '@/lib/prob-today'

describe('computeProbToday', () => {
  const baseInputs = {
    probTypical: 0.65,
    pitcher: { id: 0, kPct: 0, bbPct: 0, hrPct: 0, hardHitRate: 0, bf: 0, recentStarts: 0 },
    venueId: 0,
    batterHand: 'R' as const,
    weather: { hrMult: 1.0, controlled: true, failure: false },
    bullpen: null,
    lineupSlot: 5,
  }

  it('with all neutral inputs, returns ≈ probTypical', () => {
    const today = computeProbToday(baseInputs)
    expect(today).toBeCloseTo(0.65, 2)
  })

  it('clamps to [0.001, 0.999]', () => {
    const tooHigh = computeProbToday({ ...baseInputs, probTypical: 1.5 })
    expect(tooHigh).toBeLessThanOrEqual(0.999)
    const tooLow = computeProbToday({ ...baseInputs, probTypical: -0.5 })
    expect(tooLow).toBeGreaterThanOrEqual(0.001)
  })

  it('elite pitcher reduces probToday meaningfully', () => {
    const today = computeProbToday({
      ...baseInputs,
      pitcher: { id: 1, kPct: 0.32, bbPct: 0.05, hrPct: 0.02, hardHitRate: 0.30, bf: 800, recentStarts: 25 },
    })
    expect(today).toBeLessThan(baseInputs.probTypical)
  })
})
```

- [ ] **Step 2**: Implement `lib/prob-today.ts`:

```typescript
import { computePitcherFactor, type PitcherInputs } from './factors/pitcher'
import { computeParkFactor } from './factors/park'
import { computeWeatherFactor } from './factors/weather'
import { computeHandednessFactor } from './factors/handedness'
import { computeBullpenFactor } from './factors/bullpen'
import { computePaCountFactor } from './factors/pa-count'
import type { BullpenStats } from './bullpen'
import type { Handedness } from './types'

export interface ProbTodayInputs {
  probTypical: number
  pitcher: PitcherInputs & { throws?: Handedness }
  venueId: number
  batterHand: 'R' | 'L' | 'S'
  weather: { hrMult: number; controlled: boolean; failure: boolean }
  bullpen: BullpenStats | null
  lineupSlot: number
}

export interface ProbTodayBreakdown {
  probToday: number
  factors: {
    pitcher: number
    park: number
    weather: number
    handedness: number
    bullpen: number
    paCount: number
  }
}

/**
 * Closed-form probToday: probTypical × bounded factor multipliers.
 * Each factor is in roughly [0.5, 2.0]; clamping keeps the product in [0.001, 0.999].
 */
export function computeProbTodayWithBreakdown(args: ProbTodayInputs): ProbTodayBreakdown {
  const factors = {
    pitcher: computePitcherFactor({ pitcher: args.pitcher }),
    park: computeParkFactor({ venueId: args.venueId, batterHand: args.batterHand }),
    weather: computeWeatherFactor(args.weather),
    handedness: computeHandednessFactor({
      batterHand: args.batterHand,
      pitcherThrows: args.pitcher.throws ?? 'R',
    }),
    bullpen: computeBullpenFactor({ bullpen: args.bullpen, lineupSlot: args.lineupSlot }),
    paCount: computePaCountFactor({ probTypical: args.probTypical, slot: args.lineupSlot }),
  }
  const product = args.probTypical
    * factors.pitcher
    * factors.park
    * factors.weather
    * factors.handedness
    * factors.bullpen
    * factors.paCount
  const probToday = Math.min(0.999, Math.max(0.001, product))
  return { probToday, factors }
}

export function computeProbToday(args: ProbTodayInputs): number {
  return computeProbTodayWithBreakdown(args).probToday
}
```

- [ ] **Step 3**: Run + commit.

```bash
npm test -- prob-today
git add lib/prob-today.ts __tests__/prob-today.test.ts
git commit -m "feat(prob-today): closed-form orchestrator composes all factors with breakdown"
```

---

## Phase 4: Extended confidence

### Task 4.1: Add `sampleSize` and `dataFreshness` factors

**Files:**
- Modify: `lib/confidence.ts`
- Modify: `__tests__/confidence.test.ts`

- [ ] **Step 1**: Add failing tests for the new factors.

```typescript
// __tests__/confidence.test.ts (extend)
import { computeConfidenceBreakdown } from '@/lib/confidence'

describe('confidence — sampleSize factor', () => {
  it('returns 0.85 at 0 PAs, 1.0 at ≥200 PAs', () => {
    const low = computeConfidenceBreakdown({
      lineupStatus: 'confirmed', bvpAB: 0, pitcherStartCount: 10,
      weatherStable: true, isOpener: false, timeToFirstPitchMin: 60,
      batterSeasonPa: 0, maxCacheAgeSec: 0,
    })
    expect(low.factors.sampleSize).toBeCloseTo(0.85, 3)

    const high = computeConfidenceBreakdown({
      lineupStatus: 'confirmed', bvpAB: 0, pitcherStartCount: 10,
      weatherStable: true, isOpener: false, timeToFirstPitchMin: 60,
      batterSeasonPa: 250, maxCacheAgeSec: 0,
    })
    expect(high.factors.sampleSize).toBeCloseTo(1.0, 3)
  })

  it('ramps linearly between 0 and 200 PAs', () => {
    const mid = computeConfidenceBreakdown({
      lineupStatus: 'confirmed', bvpAB: 0, pitcherStartCount: 10,
      weatherStable: true, isOpener: false, timeToFirstPitchMin: 60,
      batterSeasonPa: 100, maxCacheAgeSec: 0,
    })
    expect(mid.factors.sampleSize).toBeCloseTo(0.925, 3)
  })
})

describe('confidence — dataFreshness factor', () => {
  it('1.0 when all caches < 5 min old', () => {
    const fresh = computeConfidenceBreakdown({
      lineupStatus: 'confirmed', bvpAB: 0, pitcherStartCount: 10,
      weatherStable: true, isOpener: false, timeToFirstPitchMin: 60,
      batterSeasonPa: 200, maxCacheAgeSec: 60,
    })
    expect(fresh.factors.dataFreshness).toBe(1.0)
  })

  it('0.90 when any cache ≥ 30 min old', () => {
    const stale = computeConfidenceBreakdown({
      lineupStatus: 'confirmed', bvpAB: 0, pitcherStartCount: 10,
      weatherStable: true, isOpener: false, timeToFirstPitchMin: 60,
      batterSeasonPa: 200, maxCacheAgeSec: 30 * 60,
    })
    expect(stale.factors.dataFreshness).toBe(0.90)
  })

  it('ramps from 1.0 → 0.90 between 5 and 30 min', () => {
    const mid = computeConfidenceBreakdown({
      lineupStatus: 'confirmed', bvpAB: 0, pitcherStartCount: 10,
      weatherStable: true, isOpener: false, timeToFirstPitchMin: 60,
      batterSeasonPa: 200, maxCacheAgeSec: 17.5 * 60,  // halfway between 5 and 30 min
    })
    expect(mid.factors.dataFreshness).toBeCloseTo(0.95, 2)
  })
})
```

- [ ] **Step 2**: Extend `lib/confidence.ts`. Add to `ConfidenceInputs` and `ConfidenceFactors`:

```typescript
export interface ConfidenceInputs {
  lineupStatus: Lineup['status']
  bvpAB: number
  pitcherStartCount: number
  weatherStable: boolean
  isOpener: boolean
  timeToFirstPitchMin: number
  // NEW:
  batterSeasonPa: number       // batter's PAs this season
  maxCacheAgeSec: number       // age of the freshest-out-of-date upstream cache, in seconds
}

export interface ConfidenceFactors {
  lineup: number
  bvp: number
  pitcherStart: number
  weather: number
  time: number
  opener: number
  // NEW:
  sampleSize: number           // 0.85 at 0 PA, 1.0 at ≥200 PA
  dataFreshness: number        // 1.0 < 5min, 0.90 ≥ 30min, linear in between
}

export function computeConfidenceBreakdown(args: ConfidenceInputs): {
  factors: ConfidenceFactors
  product: number
} {
  // ... (existing factors) ...
  const sampleSize = Math.min(1.0, Math.max(0.85, 0.85 + 0.15 * Math.min(1, args.batterSeasonPa / 200)))
  const dataFreshness =
    args.maxCacheAgeSec <= 5 * 60 ? 1.0 :
    args.maxCacheAgeSec >= 30 * 60 ? 0.90 :
    1.0 - ((args.maxCacheAgeSec - 5 * 60) / (25 * 60)) * 0.10

  const factors: ConfidenceFactors = {
    lineup, bvp, pitcherStart, weather, time, opener, sampleSize, dataFreshness,
  }
  const product = lineup * bvp * pitcherStart * weather * time * opener * sampleSize * dataFreshness
  return { factors, product }
}
```

- [ ] **Step 3**: Update existing callers (`lib/ranker.ts`) to pass the new inputs. Use `0` for `batterSeasonPa` until Phase 7 wires the real value (it's a confidence multiplier so 0 is the conservative default).

- [ ] **Step 4**: Verify all gates.

```bash
npm run lint && npm run typecheck && npm test
```
Expected: PASS.

- [ ] **Step 5**: Commit.

```bash
git add lib/confidence.ts __tests__/confidence.test.ts lib/ranker.ts
git commit -m "feat(confidence): add sampleSize + dataFreshness factors"
```

---

## Phase 5: UI changes

### Task 5.1: New 7-column `PickRow` layout

**Files:**
- Modify: `components/PickRow.tsx`

**Why**: align with spec §7. PLAYER \| GAME \| PROB.TYPICAL \| PROB.TODAY \| EDGE \| CONF \| SCORE.

- [ ] **Step 1**: Read current `components/PickRow.tsx` to understand the existing structure.

- [ ] **Step 2**: Refactor the row markup:
  - Remove repeated micro-labels (`prob`, `edge`, `conf`)
  - Add explicit `PROB. TYPICAL` and `PROB. TODAY` columns
  - Restructure PLAYER column per spec (name + slot, handedness · status, vs pitcher, status pill)
  - Restructure GAME column (away @ home + first pitch)

- [ ] **Step 3**: Update parent (`components/BoardSection.tsx`) to render a `<thead>` with the new column headers.

- [ ] **Step 4**: Test with `npm run dev` and visual inspection. Compare to spec §7.1.

- [ ] **Step 5**: Run all gates.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

- [ ] **Step 6**: Commit.

```bash
git add components/PickRow.tsx components/BoardSection.tsx
git commit -m "ui(picks): 7-column PLAYER|GAME|PROB.TYPICAL|PROB.TODAY|EDGE|CONF|SCORE layout"
```

### Task 5.2: Mobile card layout

- [ ] **Step 1**: Refactor mobile breakpoint in `PickRow.tsx` to match spec §7.2:
  - Stacked card, name + slot row, handedness/status row, game/time row, vs pitcher/status row, divider, two-row metrics block.
  - Inline labels visible on mobile only.

- [ ] **Step 2**: Visual verify at 320px viewport.

- [ ] **Step 3**: Commit.

```bash
git add components/PickRow.tsx
git commit -m "ui(picks): mobile stacked-card layout with inline metric labels"
```

### Task 5.3: `RefreshButton` component

**Files:**
- Create: `components/RefreshButton.tsx`

- [ ] **Step 1**: Implement:

```tsx
'use client'
import { useState, useTransition } from 'react'

export function RefreshButton(props: { onRefresh: () => Promise<void> }): React.ReactElement {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (isPending) return
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      try {
        await props.onRefresh()
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Refresh failed')
      }
    })
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        aria-busy={isPending}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-50"
      >
        {isPending ? 'Refreshing…' : 'Refresh now'}
      </button>
      {success && <span className="text-xs text-hit" role="status">Updated</span>}
      {error && <span className="text-xs text-warn" role="alert">{error}</span>}
    </div>
  )
}
```

- [ ] **Step 2**: Add a basic snapshot/render test (optional for this sub-skill).

- [ ] **Step 3**: Commit.

```bash
git add components/RefreshButton.tsx
git commit -m "ui(refresh): RefreshButton with idle/loading/success/error states"
```

### Task 5.4: Freshness indicator in `StatusBanner`

**Files:**
- Modify: `components/StatusBanner.tsx`
- Modify: `components/ClientShell.tsx` (wire props)

- [ ] **Step 1**: Read existing StatusBanner.

- [ ] **Step 2**: Add a "Updated Xs ago" element that re-renders every second from a `refreshedAt` prop. Mount the `RefreshButton` next to it.

- [ ] **Step 3**: Commit.

```bash
git add components/StatusBanner.tsx components/ClientShell.tsx
git commit -m "ui(status): freshness indicator + refresh button slot"
```

---

## Phase 6: `/api/refresh` route + slate-refresh cron

### Task 6.1: Implement `/api/refresh`

**Files:**
- Create: `app/api/refresh/route.ts`
- Test: `__tests__/refresh.test.ts`

- [ ] **Step 1**: Failing tests:

```typescript
import { POST } from '@/app/api/refresh/route'
import { NextRequest } from 'next/server'

function buildReq(body: object = {}, secret = process.env.CRON_SECRET ?? '') {
  return new NextRequest('http://localhost/api/refresh', {
    method: 'POST',
    headers: { 'x-cron-secret': secret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/refresh', () => {
  it('rejects without auth in production', async () => {
    process.env.NODE_ENV = 'production'
    const res = await POST(buildReq({}, 'wrong'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with picks on success', async () => {
    const res = await POST(buildReq({ scope: 'today' }))
    expect([200, 503]).toContain(res.status)
    if (res.status === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('picks')
      expect(body).toHaveProperty('refreshedAt')
    }
  })
})
```

- [ ] **Step 2**: Implement route:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { rankPicks } from '@/lib/ranker'
import { kvDel } from '@/lib/kv'
import { verifyCronRequest } from '@/lib/cron-auth'
import { slateDateString, isValidIsoDate } from '@/lib/date-utils'

export const maxDuration = 10

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth: cron secret OR rate-limited browser path. Phase 6.1 uses just the secret;
  // browser button can be wired without auth on the dev path or via rate limit later.
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { scope?: 'today' | 'specific-game'; gameId?: number; date?: string } = {}
  try { body = await req.json() } catch { /* empty body OK */ }

  if (body.date && !isValidIsoDate(body.date)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 })
  }
  const date = body.date ?? slateDateString()

  // Invalidate per-slate caches that the ranker reads.
  await Promise.all([
    kvDel(`picks:current:${date}`),
    // upstream caches refresh themselves on next read; ranker drives that.
  ])

  try {
    const picks = await rankPicks(date)
    return NextResponse.json({
      date,
      refreshedAt: new Date().toISOString(),
      picks,
      partialFailures: [],
    })
  } catch (e) {
    return NextResponse.json({
      error: 'upstream failure',
      details: [String((e as Error).message ?? e)],
    }, { status: 503 })
  }
}
```

- [ ] **Step 3**: Wire the button — the picks page calls `/api/refresh` from the `RefreshButton` `onRefresh` prop, then re-fetches `/api/picks` to update the UI.

- [ ] **Step 4**: Run tests + commit.

```bash
npm test -- refresh
git add app/api/refresh/route.ts __tests__/refresh.test.ts components/RefreshButton.tsx app/page.tsx
git commit -m "feat(api): /api/refresh route + button wires to backend recompute"
```

### Task 6.2: Add slate-refresh cron entry

**Files:**
- Modify: `.github/workflows/cron.yml`

- [ ] **Step 1**: Add entries:

```yaml
on:
  schedule:
    - cron: '*/2 17-23 * * *'   # every 2 min, 1 PM ET → 7 PM ET
    - cron: '*/2 0-7 * * *'     # every 2 min, 7 PM ET → 3 AM ET
    # ... existing entries ...
```

```yaml
jobs:
  slate-refresh:
    if: github.event_name == 'schedule' && (github.event.schedule == '*/2 17-23 * * *' || github.event.schedule == '*/2 0-7 * * *')
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            -H "content-type: application/json" \
            -d '{"scope":"today"}' \
            "${{ secrets.APP_BASE_URL }}/api/refresh"
```

- [ ] **Step 2**: Commit.

```bash
git add .github/workflows/cron.yml
git commit -m "ci(cron): every-2-min slate-refresh job during slate hours"
```

---

## Phase 7: Shadow mode

### Task 7.1: Log old vs new probToday side-by-side

**Files:**
- Modify: `lib/ranker.ts`
- Create: `lib/shadow-log.ts`

- [ ] **Step 1**: Build a tiny logger that writes one row per pick to a Supabase `shadow_log` table (or `cache` table with structured key) capturing `(playerId, rung, probTodayOld, probTodayNew, divergence)`.

- [ ] **Step 2**: In `lib/ranker.ts`, after computing the existing `pMatchup` from sim cache, also call `computeProbToday()` with the same context. Pass both into the logger. Use `pMatchup` (the existing value) for the `Pick.pMatchup` field — no behaviour change yet.

- [ ] **Step 3**: Deploy and run for 2-3 slate days. Inspect divergence percentiles.

- [ ] **Step 4**: Commit.

```bash
git add lib/ranker.ts lib/shadow-log.ts
git commit -m "feat(shadow): log old MC vs new closed-form probToday for validation"
```

### Task 7.2: Validate shadow-mode results

- [ ] **Step 1**: Query the shadow log:

```sql
SELECT
  rung,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(divergence)) AS p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ABS(divergence)) AS p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ABS(divergence)) AS p99
FROM shadow_log
GROUP BY rung;
```

- [ ] **Step 2**: If p95 divergence > 10% on any rung, dig into the worst cases and adjust formula coefficients before flipping. Add a follow-up commit if needed.

- [ ] **Step 3**: Decide: GO (proceed to Phase 8) or revise (loop back to relevant Phase 2/3 task).

---

## Phase 8: Flip to closed-form

### Task 8.1: Switch ranker to closed-form `probToday`

**Files:**
- Modify: `lib/ranker.ts`

- [ ] **Step 1**: In the per-batter loop, replace `dist.atLeast[rung]` reads with `computeProbToday()` calls. Keep `probTypical` reads from `getPTypical()`.

- [ ] **Step 2**: Remove the `warmMissingSims` call and the pre-pass that computed missing `gamesWithoutSim`. The closed-form path is fast enough to run inline.

- [ ] **Step 3**: Update `Pick` type / response: rename `pMatchup` → `pToday` and `pTypical` → `pTypical` (already named that). Update callers + tests.

- [ ] **Step 4**: Run full validation.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

- [ ] **Step 5**: Deploy + monitor. Watch for:
  - `/api/picks` p95 latency (should drop, not rise)
  - Pick distributions vs shadow log
  - Any 500s

- [ ] **Step 6**: Commit.

```bash
git add lib/ranker.ts lib/types.ts components/PickRow.tsx
git commit -m "feat(ranker): switch to closed-form probToday (removes request-time MC)"
```

---

## Phase 9: Cleanup

### Task 9.1: Delete obsolete sim routes

**Files:**
- Delete: `app/api/sim/route.ts`
- Delete: `app/api/sim/[gameId]/route.ts`

- [ ] **Step 1**: Verify nothing references them (`Grep '/api/sim/' --include='*.ts' --include='*.tsx'`).

- [ ] **Step 2**: Delete the files.

- [ ] **Step 3**: Update `.github/workflows/cron.yml` to remove the per-game sim cron.

- [ ] **Step 4**: Verify gates.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

- [ ] **Step 5**: Commit.

```bash
git rm app/api/sim/route.ts app/api/sim/[gameId]/route.ts app/api/sim/[gameId]/build-context.ts
git add .github/workflows/cron.yml
git commit -m "chore(sim): remove deprecated per-game sim routes + cron"
```

### Task 9.2: Move `lib/sim.ts` and friends to `lib/offline-sim/`

**Files:**
- Move: `lib/sim.ts` → `lib/offline-sim/sim.ts`
- Move: `lib/baserunner.ts` → `lib/offline-sim/baserunner.ts`
- Move: `app/api/sim/[gameId]/build-context.ts` (already deleted in 9.1; recreate at `lib/offline-sim/build-context.ts` if its build logic is still needed for offline sim — likely not, since `lib/p-typical.ts` builds contexts inline)

- [ ] **Step 1**: Verify which call sites import from these modules.

```bash
# search
```

- [ ] **Step 2**: Use `git mv` to preserve history.

- [ ] **Step 3**: Update imports in `lib/p-typical.ts` and any other callers.

- [ ] **Step 4**: Verify gates.

- [ ] **Step 5**: Commit.

```bash
git add -A
git commit -m "refactor: relocate sim primitives to lib/offline-sim/ — request path no longer uses them"
```

### Task 9.3: SQL migration to GC dead cache rows

**Files:**
- Create: `supabase/migrations/2026-04-28-deprecate-sim-cache.sql`

- [ ] **Step 1**: Write:

```sql
-- One-shot: delete deprecated sim cache rows. The hybrid model uses
-- typical:v1:* (offline-precomputed) instead of sim:* (request-time MC).
-- See docs/superpowers/specs/2026-04-28-hybrid-ranking-refactor-design.md
DELETE FROM cache WHERE key LIKE 'sim:%';
DELETE FROM cache WHERE key LIKE 'sim-meta:%';
```

- [ ] **Step 2**: Apply locally if a local Supabase is available, then push: `npx supabase db push`.

- [ ] **Step 3**: Commit.

```bash
git add supabase/migrations/2026-04-28-deprecate-sim-cache.sql
git commit -m "chore(db): migration to GC sim:* and sim-meta:* cache rows"
```

### Task 9.4: Update `app/api/picks/route.ts` for new metadata + lower TTL

**Files:**
- Modify: `app/api/picks/route.ts`

- [ ] **Step 1**: Drop `meta.gamesWithSim` and `meta.gamesWithoutSim` from the response (they're no longer meaningful).

- [ ] **Step 2**: Add `meta.cacheAges` populated by the ranker.

- [ ] **Step 3**: Reduce server cache TTL from 60 to 30s.

- [ ] **Step 4**: Update `lib/ranker.ts` to compute and emit `cacheAges`.

- [ ] **Step 5**: Validate + commit.

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add app/api/picks/route.ts lib/ranker.ts lib/types.ts
git commit -m "feat(picks): meta.cacheAges + 30s server cache (was 60s)"
```

### Task 9.5: Update CLAUDE.md, README.md, DEPLOY.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1**: In `CLAUDE.md`:
  - Architecture section: replace "Per-PA Monte Carlo sim with hybrid log-5 + Statcast outcome distribution" with "Hybrid ranking: offline 20k-iter MC for `probTypical` baseline, closed-form formula for `probToday` at request time. See `docs/superpowers/specs/2026-04-28-hybrid-ranking-refactor-design.md`."
  - Critical files: replace `lib/sim.ts` references with `lib/offline-sim/sim.ts`. Add `lib/prob-today.ts` and the factor library.
  - Cron schedule: rewrite to match new cadence.

- [ ] **Step 2**: In `README.md`: drop "Monte Carlo" framing. Add a "How it ranks" section with the 5 metrics + the closed-form formula. Add the manual refresh button.

- [ ] **Step 3**: In `docs/DEPLOY.md`: update cron section.

- [ ] **Step 4**: Commit.

```bash
git add CLAUDE.md README.md docs/DEPLOY.md
git commit -m "docs: update for hybrid model — drop Monte Carlo framing in user-facing docs"
```

### Task 9.6: Final test sweep

- [ ] **Step 1**: Remove any tests that exercised the deleted `/api/sim/[gameId]` route.

- [ ] **Step 2**: Run all gates one more time.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```
Expected: all PASS, 0 skipped tests.

- [ ] **Step 3**: Manual smoke per spec §15:
  - Open `/`: 7 columns visible, picks render
  - Click manual refresh: button shows loading, completes < 5s, updated indicator
  - Inspect a pick: probTypical/probToday/edge/confidence/score all consistent
  - TBD-pitcher game: pitcherFactor=1.0, confidence shows penalty
  - Supabase: confirm `typical:v1:*` keys present

- [ ] **Step 4**: Final commit (if any cleanup needed):

```bash
git add -A
git commit -m "chore: final cleanup after hybrid ranking flip"
```

---

## Validation gates (run after every commit)

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

All four must pass before merging. CI runs all four on every PR.

## Rollback plan

If Phase 8 reveals an unfixable issue:

1. `git revert <commit-of-task-8.1>`
2. The per-game sim cache infrastructure is still in place until Phase 9 starts; the old behaviour is restored by reverting the ranker change.
3. Investigate offline; ship a corrected Phase 8 commit when ready.

## Out of scope (do not touch in this plan)

- Calibration of placeholder constants (locked behind ≥30 days of settled history)
- L30/L15 rolling rate blend
- BvP layer in per-PA outcome rates (still in confidence factor only)
- Pitcher-specific TTO splits
- Opener detection
- Live in-game updates / in-progress board
- Sub-10s freshness via paid infrastructure

---

End of implementation plan.
