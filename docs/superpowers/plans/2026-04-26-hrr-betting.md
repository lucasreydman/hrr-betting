# HRR Betting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the HRR Betting v1 — an MLB Hits+Runs+RBIs prop ranker with three rungs (1+, 2+, 3+), lineup-aware Monte Carlo simulation, EDGE-based ranking, and auto-tracked picks.

**Architecture:** Next.js 16 App Router serving three pages (today's slate, history, methodology). Background `/api/sim/[gameId]` endpoint runs the 10k-iteration Monte Carlo per game (cached in KV per `(lineupHash, weatherHash)`); `/api/picks` reads cached sims and aggregates per-rung rankings. Cron-driven lock snapshots and settlement. Free APIs (MLB Stats, Baseball Savant, Open-Meteo). Patterns ported from sibling projects bvp-betting / yrfi / nrfi where applicable.

**Tech Stack:** TypeScript · Next.js 16 App Router · React 19 · Tailwind v4 · `@vercel/kv@^3.0.0` · Jest

**Spec:** [`docs/superpowers/specs/2026-04-26-hrr-betting-design.md`](../specs/2026-04-26-hrr-betting-design.md) — read this first if you haven't.

**Sibling project references (read-only — port patterns, don't import):**
- `C:\Users\lucas\dev\yrfi\lib\` — closest stack twin (KV, MLB API, Savant, weather, park, Poisson math)
- `C:\Users\lucas\dev\bvp-betting\lib\` — BvP regression, lineup estimation, auto-settle pattern
- `C:\Users\lucas\dev\nrfi\lib\` — verify NRFI variant of yrfi patterns

---

## File Structure (locked)

```
hrr-betting/
├── app/
│   ├── api/
│   │   ├── picks/route.ts                  # reads cached sims, aggregates per-rung
│   │   ├── sim/[gameId]/route.ts           # 10k-iter Monte Carlo, maxDuration: 60
│   │   ├── lock/route.ts                   # cron: snapshot Tracked picks at lock trigger
│   │   ├── history/route.ts                # settled-history endpoint
│   │   └── settle/route.ts                 # cron: pull boxscore, mark HIT/MISS
│   ├── page.tsx                            # main slate (3 boards)
│   ├── history/page.tsx
│   ├── methodology/page.tsx
│   ├── layout.tsx
│   └── globals.css                         # Tailwind v4 + design tokens
├── components/
│   ├── ClientShell.tsx                     # wraps boards, handles refresh
│   ├── BoardSection.tsx                    # one rung's pick list
│   ├── PickRow.tsx                         # single pick row + tier badge
│   ├── StatusBanner.tsx                    # tracked counts + lineup status
│   ├── HistoryChart.tsx
│   ├── CalibrationTable.tsx
│   └── methodology/                        # factor cards, formula blocks
│       ├── FactorCard.tsx
│       └── FormulaBlock.tsx
├── lib/
│   ├── kv.ts                               # Vercel KV wrapper + in-memory fallback
│   ├── types.ts                            # all shared types
│   ├── mlb-api.ts                          # schedule, lineup, boxscore, pitcher stats
│   ├── savant-api.ts                       # Statcast CSV cache + lookup
│   ├── weather-api.ts                      # Open-Meteo + outfield-facing degrees
│   ├── park-factors.ts                     # 30 stadiums, per-outcome + HR-specific
│   ├── lineup.ts                           # confirmed/estimated lineup logic
│   ├── stabilization.ts                    # per-stat empirical regression w/ career prior
│   ├── rates.ts                            # season/L30/L15 blend + handedness splits
│   ├── per-pa.ts                           # 7-outcome distribution (log-5 + Statcast)
│   ├── tto.ts                              # times-through-order multipliers
│   ├── bullpen.ts                          # leverage-tier classification + rates
│   ├── starter-share.ts                    # IP CDF + tiered fallback
│   ├── baserunner.ts                       # bases-state evolution rules
│   ├── sim.ts                              # lineup-aware Monte Carlo (10k iters)
│   ├── p-typical.ts                        # replay-the-season sim
│   ├── edge.ts                             # EDGE / SCORE formulas
│   ├── confidence.ts                       # hard gates + graded multiplier
│   ├── ranker.ts                           # rank picks per rung, tier classification
│   ├── tracker.ts                          # lock snapshot, settle, metrics
│   └── constants.ts                        # league averages, stabilization sample sizes
├── __tests__/
│   ├── stabilization.test.ts
│   ├── rates.test.ts
│   ├── per-pa.test.ts
│   ├── tto.test.ts
│   ├── starter-share.test.ts
│   ├── baserunner.test.ts
│   ├── sim.test.ts
│   ├── edge.test.ts
│   ├── confidence.test.ts
│   └── ranker.test.ts
├── scripts/
│   └── recalibrate.ts                      # post-30-day floor recalibration audit
├── public/
│   └── favicon.svg
├── docs/
│   └── superpowers/
│       ├── specs/2026-04-26-hrr-betting-design.md   # the spec
│       └── plans/2026-04-26-hrr-betting.md          # this plan
├── README.md
├── CLAUDE.md
├── jest.config.ts
├── jest.setup.ts
├── package.json
├── tsconfig.json
├── next.config.ts
├── eslint.config.mjs
├── postcss.config.mjs
├── vercel.json
└── .gitignore
```

**Each file has one responsibility.** Math primitives (`stabilization.ts`, `rates.ts`, `per-pa.ts`, etc.) are pure functions — no I/O, no caching. Data adapters (`mlb-api.ts`, `savant-api.ts`, `weather-api.ts`) handle network + caching. Composition layers (`sim.ts`, `p-typical.ts`, `ranker.ts`) tie them together. Routes are thin orchestrators.

---

## Phases

| # | Phase | Tasks | Gate |
|---|---|---|---|
| 1 | Project scaffold | 1–4 | `npm run build` succeeds with empty pages |
| 2 | Data adapters (port from yrfi) | 5–9 | All adapters have integration tests passing |
| 3 | Math primitives | 10–15 | All math unit tests pass |
| 4 | Simulation engine | 16–19 | Sim endpoint produces stable HRR distributions |
| 5 | EDGE & ranking | 20–23 | `/api/picks` returns ranked output |
| 6 | Pages & UI | 24–28 | All three pages render with real data |
| 7 | Tracking infrastructure | 29–32 | Lock + settle + history wired end-to-end |
| 8 | Deploy & verification | 33–35 | Live at `hrr-betting.vercel.app` |

---

# Phase 1 — Project Scaffold

## Task 1: Next.js + TypeScript scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd C:/Users/lucas/dev/hrr-betting
npm init -y
npm install next@^16 react@^19 react-dom@^19
npm install -D typescript @types/node @types/react @types/react-dom \
  eslint eslint-config-next@^16 \
  tailwindcss@^4 @tailwindcss/postcss \
  jest @types/jest ts-jest
npm install @vercel/kv@^3.0.0
```

- [ ] **Step 2: Add scripts to `package.json`**

Replace the auto-generated `"scripts"` block with:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "jest",
  "test:watch": "jest --watch"
}
```

Set `"name": "hrr-betting"`, `"version": "0.1.0"`, `"private": true`.

- [ ] **Step 3: Create `tsconfig.json`**

Mirror `yrfi/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `next.config.ts`**

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig
```

- [ ] **Step 5: Create `eslint.config.mjs`**

Copy the structure from `yrfi/eslint.config.mjs`. (Run `cat C:/Users/lucas/dev/yrfi/eslint.config.mjs` to see the current pattern.)

- [ ] **Step 6: Create `postcss.config.mjs`**

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
}
```

- [ ] **Step 7: Verify build infrastructure**

Run: `npm run lint` — expected: passes (no source files yet).
Run: `npx tsc --noEmit` — expected: passes.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts \
  eslint.config.mjs postcss.config.mjs
git commit -m "chore: scaffold Next.js 16 + TS + Tailwind v4 + Jest"
```

---

## Task 2: Tailwind v4 + globals.css design tokens

**Files:**
- Create: `app/globals.css`, `app/layout.tsx`, `app/page.tsx`

- [ ] **Step 1: `app/globals.css` with Tailwind v4 import + design tokens**

```css
@import "tailwindcss";

@theme {
  --color-bg: #0a0a0c;
  --color-card: #14141a;
  --color-border: #2a2a35;
  --color-ink: #f5f5f7;
  --color-ink-muted: #9ca3af;
  --color-accent: #22d3ee;
  --color-tracked: #f59e0b;
  --color-hit: #10b981;
  --color-miss: #ef4444;

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo;
}

html, body { background: var(--color-bg); color: var(--color-ink); }
```

- [ ] **Step 2: `app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HRR Betting',
  description: 'MLB Hits + Runs + RBIs prop ranker with auto-tracked picks',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  )
}
```

- [ ] **Step 3: `app/page.tsx` (placeholder)**

```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-semibold">HRR Betting</h1>
      <p className="text-ink-muted mt-2">Today's slate — under construction.</p>
    </main>
  )
}
```

- [ ] **Step 4: Verify**

Run: `npm run build` — expected: builds successfully, prerenders `/`.

- [ ] **Step 5: Commit**

```bash
git add app/
git commit -m "feat(scaffold): add Tailwind v4 globals + root layout + placeholder home"
```

---

## Task 3: Jest test setup

**Files:**
- Create: `jest.config.ts`, `jest.setup.ts`

- [ ] **Step 1: `jest.config.ts`** — copy `yrfi/jest.config.ts` verbatim and adjust paths

```bash
cp C:/Users/lucas/dev/yrfi/jest.config.ts jest.config.ts
```

**yrfi's config is the source of truth.** Do not invent field names — use the same Jest config fields yrfi uses (which are valid Jest fields by virtue of yrfi running tests in production). For "after each test" hooks, write them as `afterEach(() => {...})` calls inside the setup file or test files; do not invent a config field for it.

After porting, the file looks approximately like:

```ts
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
}

export default config
```

- [ ] **Step 2: `jest.setup.ts`** (minimal — extend later)

```ts
// Suppress noisy console.log during tests; keep warn/error
const originalLog = console.log
beforeAll(() => { console.log = () => {} })
afterAll(() => { console.log = originalLog })
```

- [ ] **Step 3: Sanity-check test**

Create `__tests__/_sanity.test.ts`:

```ts
test('jest works', () => { expect(1 + 1).toBe(2) })
```

Run: `npm test` — expected: 1 passing.

- [ ] **Step 4: Commit**

```bash
git add jest.config.ts jest.setup.ts __tests__/_sanity.test.ts
git commit -m "chore: jest test setup"
```

---

## Task 4: Project meta files

**Files:**
- Create: `CLAUDE.md`, update `README.md` (already exists)
- Create: `public/favicon.svg`

- [ ] **Step 1: `CLAUDE.md`** — project guide for future Claude sessions

```markdown
# HRR Betting — CLAUDE.md

## Project context

MLB Hits + Runs + RBIs prop ranker with three rungs (1+, 2+, 3+). Per-PA Monte Carlo
sim with hybrid log-5 + Statcast outcome distribution. Replay-the-season `P_typical`
denominator. Tracked picks (high-conviction tier) auto-settle from boxscore.

## Architecture

- `app/` — Next.js App Router. Three pages (`/`, `/history`, `/methodology`) and four
  API routes (`picks`, `sim/[gameId]`, `lock`, `settle`, `history`).
- `lib/` — pure math + data adapters. Math files have NO I/O; data files handle KV +
  network caching.
- `components/` — UI building blocks.
- `__tests__/` — Jest unit tests for math primitives.

## Stack

Next.js 16 App Router · React 19 · Tailwind v4 · TypeScript · @vercel/kv@^3.0.0 · Jest.
Free APIs only (MLB Stats, Baseball Savant CSV, Open-Meteo). Vercel Pro deployment
required for `maxDuration: 60` on `/api/sim/[gameId]`.

## Critical files

- `lib/sim.ts` — the lineup-aware Monte Carlo. Heart of the model.
- `lib/per-pa.ts` — log-5 + Statcast hybrid 7-outcome distribution.
- `lib/edge.ts` — EDGE = `P_matchup / max(P_typical, 0.01) − 1`.
- `lib/tracker.ts` — lock snapshot + settlement.

## Commands

- `npm run dev` — local dev with in-memory KV fallback.
- `npm run build` — production build (must stay green).
- `npm test` — run unit tests.

## Spec & plan

- Spec: `docs/superpowers/specs/2026-04-26-hrr-betting-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-26-hrr-betting.md`
```

- [ ] **Step 2: Add a minimal `public/favicon.svg`**

Use a simple monogram (HRR baseball-ish):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#14141a"/>
  <text x="16" y="22" font-family="ui-monospace" font-size="12" font-weight="700"
        text-anchor="middle" fill="#22d3ee">HRR</text>
</svg>
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md public/favicon.svg
git commit -m "docs: add CLAUDE.md project guide + favicon"
```

---

# Phase 2 — Data Adapters (port from yrfi)

> **Strategy:** for each adapter, read the yrfi source, port verbatim with minor adjustments for HRR types, then add an integration test that hits the real API once and snapshots the response.

## Task 5: KV wrapper

**Files:**
- Create: `lib/kv.ts`
- Create: `lib/types.ts` (start the file)
- Test: `__tests__/kv.test.ts`

- [ ] **Step 1: Read yrfi's KV wrapper**

```bash
cat C:/Users/lucas/dev/yrfi/lib/kv.ts
```

This file has: `sanitizeEnvValue`, `getKvCredentials`, `kvGet/kvSet/kvDel`,
`isVercelKvAvailable`, in-memory fallback `Map`.

- [ ] **Step 2: Copy verbatim to `lib/kv.ts`**

```bash
cp C:/Users/lucas/dev/yrfi/lib/kv.ts lib/kv.ts
```

Verify the file uses `@vercel/kv` (not `@upstash/redis`).

- [ ] **Step 3: Create `lib/types.ts` with shared base types**

```ts
export type Rung = 1 | 2 | 3
export type Handedness = 'R' | 'L' | 'S'  // S = switch (special handling)
export type Outcome = '1B' | '2B' | '3B' | 'HR' | 'BB' | 'K' | 'OUT'

export interface PlayerRef {
  playerId: number
  fullName: string
  team: string  // 3-letter abbrev
  bats: Handedness
  throws?: Handedness
}
```

- [ ] **Step 4: Write KV smoke test**

`__tests__/kv.test.ts`:

```ts
import { kvGet, kvSet, kvDel, isVercelKvAvailable } from '@/lib/kv'

describe('kv wrapper (in-memory fallback)', () => {
  beforeEach(() => { delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN })

  test('isVercelKvAvailable returns false without env', () => {
    expect(isVercelKvAvailable()).toBe(false)
  })

  test('set / get / del round-trip in memory', async () => {
    await kvSet('hrr:test', { foo: 'bar' }, { ex: 60 })
    const got = await kvGet<{ foo: string }>('hrr:test')
    expect(got).toEqual({ foo: 'bar' })
    await kvDel('hrr:test')
    expect(await kvGet('hrr:test')).toBeNull()
  })

  test('expired key returns null', async () => {
    await kvSet('hrr:exp', 'x', { ex: 0 })
    await new Promise(r => setTimeout(r, 5))
    expect(await kvGet('hrr:exp')).toBeNull()
  })
})
```

- [ ] **Step 5: Run test — expected: 3 passing**

```bash
npm test -- kv
```

- [ ] **Step 6: Commit**

```bash
git add lib/kv.ts lib/types.ts __tests__/kv.test.ts
git commit -m "feat(lib): port KV wrapper from yrfi + smoke tests"
```

---

## Task 6: MLB Stats API adapter

**Files:**
- Create: `lib/mlb-api.ts`
- Add to: `lib/types.ts`
- Test: `__tests__/mlb-api.test.ts`

- [ ] **Step 1: Read yrfi's MLB API adapter**

```bash
cat C:/Users/lucas/dev/yrfi/lib/mlb-api.ts
```

Has: `fetchSchedule`, `fetchPitcherStatLine`, `fetchPitcherFipAndKPct`, `fetchTeamOBP`,
`extractTopOfOrderStats`, `fetchGameLineupStats`, `fetchLinescore`, `parseIP`, etc.

- [ ] **Step 2: Read bvp-betting's MLB API**

```bash
cat C:/Users/lucas/dev/bvp-betting/lib/mlb-api.ts
```

Has lineup estimation (confirmed vs estimated), batter career-vs-pitcher fetcher, recent
batting-order history. Some pieces overlap with yrfi.

- [ ] **Step 3: Port to `lib/mlb-api.ts`**

Combine both — `lib/mlb-api.ts` exports:

- `fetchSchedule(date: string): Promise<Game[]>`
- `fetchProbablePitchers(gameId: number): Promise<{ home: number; away: number }>`
- `fetchLineup(gameId: number): Promise<{ home: LineupEntry[]; away: LineupEntry[]; status: 'confirmed' | 'partial' | 'estimated' }>`
- `fetchBoxscore(gameId: number): Promise<Boxscore>` (used by settle)
- `fetchPitcherSeasonStats(pitcherId: number, season: number): Promise<PitcherStats>`
- `fetchPitcherRecentStarts(pitcherId: number, n: number): Promise<StartLine[]>` (for IP CDF)
- `fetchBatterSeasonStats(batterId: number, season: number): Promise<BatterStats>`
- `fetchBatterGameLog(batterId: number, season: number): Promise<GameLogEntry[]>` (for L15/L30)
- `fetchTeamBullpenStats(teamId: number): Promise<BullpenStats>` (split by handedness, leverage-tiered — see note below)
- `fetchBvP(batterId: number, pitcherId: number): Promise<{ ab: number; h: number; '1b': number; '2b': number; '3b': number; 'hr': number; 'bb': number; 'k': number }>`
- `fetchPlayerSlotFrequency(playerId: number, season: number): Promise<Record<number, number>>` — historical lineup-slot distribution (e.g. `{ 4: 0.80, 3: 0.20 }`), used by `lib/p-typical.ts` for replay-the-season

**Leverage-index data source note:** MLB Stats API does not expose per-reliever leverage index directly. For `fetchTeamBullpenStats`, classify high-leverage tier using one of these proxies (in priority order):
1. **Baseball Savant** has `pLI` (pitcher leverage index) per pitcher in the bullpen splits — pull from existing Savant cache (Task 7) and aggregate by team
2. Fallback proxy: relievers with ≥10 appearances AND ≥30% of appearances in 7th–9th inning AND in close-game state (run differential ≤ 3) — derivable from MLB Stats game logs
3. Last resort fallback: relievers with the lowest team-aggregate FIP among those with ≥10 appearances → top 3-4 by FIP = high-leverage tier

Document which approach was used in `lib/bullpen.ts` JSDoc.

Each function: 6-hour KV cache via `kvGet`/`kvSet` keyed by inputs. Fallback to live fetch when miss.

- [ ] **Step 4: Add types to `lib/types.ts`**

```ts
export interface Game {
  gameId: number
  gameDate: string
  homeTeam: TeamRef
  awayTeam: TeamRef
  venueId: number
  venueName: string
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed'
}

export interface TeamRef { teamId: number; abbrev: string; name: string }

export interface LineupEntry { slot: number; player: PlayerRef }

export interface PitcherStats {
  pitcherId: number
  ip: number
  fip: number
  kPct: number
  bbPct: number
  hrPer9: number
  // ... etc
}

export interface BatterStats {
  batterId: number
  pa: number
  hits: number
  outcomeRates: Record<Outcome, number>  // probabilities summing to ~1
  // ... etc
}

export interface BullpenStats {
  highLeverage: { fip: number; kPct: number; bbPct: number; hrPer9: number; vsR: OutcomeRates; vsL: OutcomeRates }
  rest: { fip: number; kPct: number; bbPct: number; hrPer9: number; vsR: OutcomeRates; vsL: OutcomeRates }
}

export type OutcomeRates = Record<Outcome, number>

export interface StartLine { gameDate: string; ip: number; outcomeAtPullingNumber?: number }
```

- [ ] **Step 5: Smoke test (real API hit, gated by env)**

`__tests__/mlb-api.test.ts`:

```ts
import { fetchSchedule, fetchPitcherSeasonStats } from '@/lib/mlb-api'

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1'
const maybe = RUN_LIVE ? test : test.skip

maybe('fetchSchedule returns games for a known date', async () => {
  const games = await fetchSchedule('2025-07-04')
  expect(games.length).toBeGreaterThan(0)
  expect(games[0]).toMatchObject({ gameId: expect.any(Number) })
}, 30_000)

maybe('fetchPitcherSeasonStats returns plausible numbers', async () => {
  // Gerrit Cole - playerId 543037
  const s = await fetchPitcherSeasonStats(543037, 2024)
  expect(s.fip).toBeGreaterThan(2)
  expect(s.fip).toBeLessThan(7)
}, 30_000)
```

- [ ] **Step 6: Run live tests once**

```bash
RUN_LIVE_TESTS=1 npm test -- mlb-api
```

Expected: passing (ignore ports of structured tests for now).

- [ ] **Step 7: Commit**

```bash
git add lib/mlb-api.ts lib/types.ts __tests__/mlb-api.test.ts
git commit -m "feat(lib): port MLB Stats API adapter (schedule, lineup, pitcher/batter/bullpen stats, BvP)"
```

---

## Task 7: Baseball Savant adapter

**Files:**
- Create: `lib/savant-api.ts`
- Test: `__tests__/savant-api.test.ts`

- [ ] **Step 1: Read yrfi's Savant adapter**

```bash
cat C:/Users/lucas/dev/yrfi/lib/savant-api.ts
```

Has CSV fetch + parse, `loadSavantStore`, `getSavantStats`, validation, 12-hour cache.

- [ ] **Step 2: Port to `lib/savant-api.ts`**

Extend yrfi's pattern with HRR-specific stat lookups:
- Batter: `barrelPct`, `hardHitPct`, `xwOBA`, `xISO`, `avgExitVelocity`
- Pitcher: `barrelsAllowedPct`, `hardHitPctAllowed`, `xwOBAAllowed`, `whiffPct`

Add functions:
- `getBatterStatcast(batterId: number, season: number): Promise<BatterStatcast | null>`
- `getPitcherStatcast(pitcherId: number, season: number): Promise<PitcherStatcast | null>`

Both use the existing yrfi CSV-store loading + 12-hour KV cache.

- [ ] **Step 3: Add types to `lib/types.ts`**

```ts
export interface BatterStatcast {
  batterId: number
  barrelPct: number      // 0-1
  hardHitPct: number     // 0-1
  xwOBA: number
  xISO: number
  avgExitVelo: number
}

export interface PitcherStatcast {
  pitcherId: number
  barrelsAllowedPct: number
  hardHitPctAllowed: number
  xwOBAAllowed: number
  whiffPct: number
}
```

- [ ] **Step 4: Smoke test (live, gated)**

`__tests__/savant-api.test.ts`:

```ts
import { getBatterStatcast, getPitcherStatcast } from '@/lib/savant-api'

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1'
const maybe = RUN_LIVE ? test : test.skip

maybe('getBatterStatcast returns barrel% for known slugger', async () => {
  // Aaron Judge - 592450
  const sc = await getBatterStatcast(592450, 2024)
  expect(sc?.barrelPct).toBeGreaterThan(0.10)  // Judge always elite
  expect(sc?.barrelPct).toBeLessThan(0.30)
}, 30_000)
```

Run: `RUN_LIVE_TESTS=1 npm test -- savant-api`

- [ ] **Step 5: Commit**

```bash
git add lib/savant-api.ts lib/types.ts __tests__/savant-api.test.ts
git commit -m "feat(lib): port Savant adapter + extend with HRR-relevant Statcast metrics"
```

---

## Task 8: Weather + park factors

**Files:**
- Create: `lib/weather-api.ts`, `lib/park-factors.ts`
- Test: `__tests__/weather-api.test.ts`

- [ ] **Step 1: Port yrfi's weather adapter**

```bash
cp C:/Users/lucas/dev/yrfi/lib/weather-api.ts lib/weather-api.ts
```

Yrfi's adapter: Open-Meteo forecast for upcoming games, archive for backtests, returns `{ temp, windSpeed, windDirection }`. Adjust the `getOutfieldFacingDegrees` lookup if it lives in `weather-api.ts` or `park-factors.ts`.

> **Forward reference**: Task 18b will add a `weatherHash` export here (used by the sim prewarm orchestrator for cache invalidation). No work needed in this task — just be aware the file gets one more export later.

- [ ] **Step 2: Port + extend park factors**

```bash
cp C:/Users/lucas/dev/yrfi/lib/park-factors.ts lib/park-factors.ts
```

Yrfi's file has 30 stadiums with constants + outfield-facing degrees. **Extend** with per-outcome park factors and HR-specific factors:

```ts
export interface ParkFactors {
  venueId: number
  outfieldFacingDeg: number
  // multiplicative factors vs neutral park (1.00)
  factors: {
    hr: number       // HR-specific (the new one)
    '1b': number
    '2b': number
    '3b': number
    bb: number
    k: number
  }
  // per-handedness HR factors (some parks favor LHB or RHB)
  hrByHand: { vsL: number; vsR: number }
}
```

For v1, populate from public park-factor data (FanGraphs, ESPN). If exact handedness splits aren't available, default `hrByHand: { vsL: hr, vsR: hr }` and recalibrate later.

- [ ] **Step 3: Smoke tests**

`__tests__/weather-api.test.ts`:

```ts
import { fetchWeather } from '@/lib/weather-api'

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1'
const maybe = RUN_LIVE ? test : test.skip

maybe('fetchWeather returns temp for Yankee Stadium', async () => {
  const w = await fetchWeather(3313, '2025-07-04T19:05:00Z')  // venueId for Yankee Stadium
  expect(w.temp).toBeGreaterThan(0)
  expect(w.windSpeed).toBeGreaterThanOrEqual(0)
}, 30_000)
```

- [ ] **Step 4: Commit**

```bash
git add lib/weather-api.ts lib/park-factors.ts __tests__/weather-api.test.ts
git commit -m "feat(lib): port weather + park factors; extend park with per-outcome + HR-by-hand"
```

---

## Task 9: Lineup logic

**Files:**
- Create: `lib/lineup.ts`
- Test: `__tests__/lineup.test.ts`

- [ ] **Step 1: Read bvp-betting's lineup logic**

```bash
cat C:/Users/lucas/dev/bvp-betting/lib/lineup-estimation.ts
```

(Or whichever filename it uses — it's the lineup-estimation file with `getLineupPlayerIds`, `fetchRecentLineupPositions`, etc.)

- [ ] **Step 2: Port + extend to `lib/lineup.ts`**

Exports:
- `getLineup(gameId: number): Promise<Lineup>` — confirmed if available; otherwise estimated from recent starts
- `Lineup.status: 'confirmed' | 'partial' | 'estimated'`
- `Lineup.entries: LineupEntry[]` (length 9, slot 1-9)
- `lineupHash(lineup: Lineup): string` — deterministic hash for cache invalidation (used by sim)

- [ ] **Step 3: Unit test for lineupHash determinism**

`__tests__/lineup.test.ts`:

```ts
import { lineupHash } from '@/lib/lineup'

test('lineupHash is deterministic for same input', () => {
  const lineup = {
    status: 'confirmed' as const,
    entries: [
      { slot: 1, player: { playerId: 1, fullName: 'A', team: 'NYY', bats: 'R' as const } },
      // ... slots 2-9
    ],
  }
  const h1 = lineupHash(lineup)
  const h2 = lineupHash(lineup)
  expect(h1).toBe(h2)
})

test('lineupHash differs when slots reorder', () => {
  // ... two lineups same players, different slot order → different hashes
})
```

- [ ] **Step 4: Commit**

```bash
git add lib/lineup.ts __tests__/lineup.test.ts
git commit -m "feat(lib): port lineup logic with status + lineupHash for sim cache key"
```

---

# Phase 3 — Math Primitives (TDD-heavy)

> Each math file is a pure function module. Write the test first, watch it fail, then implement. These are the heart of the model — invest in test coverage.

## Task 10: `lib/constants.ts` + stabilization sample sizes

**Files:**
- Create: `lib/constants.ts`

- [ ] **Step 1: Author `lib/constants.ts`**

```ts
// Russell Carleton's empirical stabilization sample sizes (in PAs)
export const STABILIZATION_PA: Record<string, number> = {
  k: 60,
  bb: 120,
  hr: 170,
  '1b': 600,
  '2b': 700,
  '3b': 800,
  babip: 800,
  obp: 460,
  slg: 320,
}

// Approximate league-average outcome rates per PA (recalibrate from real data later)
export const LEAGUE_AVG_RATES: Record<string, number> = {
  '1b': 0.143,
  '2b': 0.045,
  '3b': 0.005,
  hr: 0.030,
  bb: 0.085,
  k: 0.225,
  out: 0.467,
}

// TTO multipliers (league-avg fallback when pitcher-specific data unavailable)
// Multipliers applied to BATTER outcome rates (i.e., > 1 = batter benefit)
export const TTO_MULTIPLIERS: Record<string, Record<string, number>> = {
  '1': { '1b': 1.00, '2b': 1.00, '3b': 1.00, hr: 1.00, bb: 1.00, k: 1.00 },
  '2': { '1b': 1.04, '2b': 1.05, '3b': 1.05, hr: 1.08, bb: 1.03, k: 0.98 },
  '3': { '1b': 1.10, '2b': 1.15, '3b': 1.15, hr: 1.25, bb: 1.08, k: 0.94 },
  '4': { '1b': 1.13, '2b': 1.20, '3b': 1.20, hr: 1.35, bb: 1.10, k: 0.92 },
}

// Period-aware blend weights for stabilized season vs L30 vs L15
export function blendWeights(month: number): { season: number; l30: number; l15: number } {
  if (month <= 4) return { season: 0.70, l30: 0.20, l15: 0.10 }
  if (month <= 6) return { season: 0.60, l30: 0.25, l15: 0.15 }
  return { season: 0.50, l30: 0.30, l15: 0.20 }
}

// Tracked tier floors (placeholders, recalibrate after 30 days)
export const EDGE_FLOORS: Record<1 | 2 | 3, number> = { 1: 0.10, 2: 0.30, 3: 0.60 }
export const PROB_FLOORS: Record<1 | 2 | 3, number> = { 1: 0.85, 2: 0.55, 3: 0.20 }

// Display floor for Watching tier
export const DISPLAY_FLOOR_SCORE = 0.05
export const CONFIDENCE_FLOOR_TRACKED = 0.85
```

- [ ] **Step 2: Commit**

```bash
git add lib/constants.ts
git commit -m "feat(lib): math constants — stabilization PAs, league rates, TTO, floors"
```

---

## Task 11: `lib/stabilization.ts`

**Files:**
- Create: `lib/stabilization.ts`
- Test: `__tests__/stabilization.test.ts`

- [ ] **Step 1: Write failing tests first**

`__tests__/stabilization.test.ts`:

```ts
import { stabilize, stabilizeRates } from '@/lib/stabilization'
import { STABILIZATION_PA } from '@/lib/constants'

describe('stabilize', () => {
  test('with PA = stabilization point, weight is 0.5 toward prior', () => {
    const result = stabilize({ observed: 0.05, sampleSize: STABILIZATION_PA.hr, prior: 0.03, statKey: 'hr' })
    expect(result).toBeCloseTo(0.04, 3)  // halfway between 0.05 and 0.03
  })

  test('with PA >> stabilization point, almost no shrinkage', () => {
    const result = stabilize({ observed: 0.05, sampleSize: 1700, prior: 0.03, statKey: 'hr' })
    expect(result).toBeGreaterThan(0.045)
    expect(result).toBeLessThan(0.05)
  })

  test('with zero PA, fully shrinks to prior', () => {
    const result = stabilize({ observed: 0.05, sampleSize: 0, prior: 0.03, statKey: 'hr' })
    expect(result).toBeCloseTo(0.03, 5)
  })

  test('preserves true skill differences between elite and average', () => {
    const elite = stabilize({ observed: 0.075, sampleSize: 600, prior: 0.065, statKey: 'hr' })  // career prior
    const avg = stabilize({ observed: 0.030, sampleSize: 600, prior: 0.030, statKey: 'hr' })
    expect(elite).toBeGreaterThan(avg + 0.030)  // genuine 3+pp gap preserved
  })
})

describe('stabilizeRates', () => {
  test('normalizes 7 outcome rates after stabilization', () => {
    const rates = { '1b': 0.15, '2b': 0.05, '3b': 0.005, hr: 0.04, bb: 0.10, k: 0.20, out: 0.455 }
    const careerPrior = { '1b': 0.143, '2b': 0.045, '3b': 0.005, hr: 0.030, bb: 0.085, k: 0.225, out: 0.467 }
    const result = stabilizeRates(rates, careerPrior, 400)
    const sum = Object.values(result).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 6)
  })
})
```

- [ ] **Step 2: Run test — expected: FAIL (functions not defined)**

```bash
npm test -- stabilization
```

- [ ] **Step 3: Implement `lib/stabilization.ts`**

```ts
import { STABILIZATION_PA } from './constants'

export interface StabilizeArgs {
  observed: number
  sampleSize: number
  prior: number
  statKey: string  // key into STABILIZATION_PA
}

export function stabilize({ observed, sampleSize, prior, statKey }: StabilizeArgs): number {
  const stabPoint = STABILIZATION_PA[statKey]
  if (stabPoint == null) throw new Error(`Unknown statKey: ${statKey}`)
  const weight = sampleSize / (sampleSize + stabPoint)
  return weight * observed + (1 - weight) * prior
}

export function stabilizeRates(
  observed: Record<string, number>,
  prior: Record<string, number>,
  sampleSize: number,
): Record<string, number> {
  const stabilized: Record<string, number> = {}
  for (const k of Object.keys(observed)) {
    if (k === 'out') continue  // out is a residual; computed last
    stabilized[k] = stabilize({
      observed: observed[k],
      sampleSize,
      prior: prior[k] ?? observed[k],
      statKey: k,
    })
  }
  // Set 'out' as residual to ensure sum = 1
  const non_out_sum = Object.values(stabilized).reduce((a, b) => a + b, 0)
  stabilized.out = Math.max(0, 1 - non_out_sum)
  // Re-normalize in case stabilized rates summed > 1
  const total = Object.values(stabilized).reduce((a, b) => a + b, 0)
  return Object.fromEntries(Object.entries(stabilized).map(([k, v]) => [k, v / total]))
}
```

- [ ] **Step 4: Run test — expected: PASS**

```bash
npm test -- stabilization
```

- [ ] **Step 5: Commit**

```bash
git add lib/stabilization.ts __tests__/stabilization.test.ts
git commit -m "feat(lib): stabilization with empirical PA points + career-prior shrinkage"
```

---

## Task 12: `lib/rates.ts` — season/L30/L15 blend + handedness

**Files:**
- Create: `lib/rates.ts`
- Test: `__tests__/rates.test.ts`

- [ ] **Step 1: Failing tests first**

```ts
import { blendRates, applyHandedness } from '@/lib/rates'

test('blendRates produces weighted average of three time windows', () => {
  const result = blendRates({
    season: { hr: 0.040, k: 0.220, bb: 0.090, '1b': 0.150, '2b': 0.045, '3b': 0.005, out: 0.450 },
    l30:    { hr: 0.060, k: 0.200, bb: 0.100, '1b': 0.140, '2b': 0.050, '3b': 0.005, out: 0.445 },
    l15:    { hr: 0.080, k: 0.180, bb: 0.110, '1b': 0.130, '2b': 0.055, '3b': 0.005, out: 0.440 },
    weights: { season: 0.5, l30: 0.3, l15: 0.2 },
  })
  expect(result.hr).toBeCloseTo(0.054, 3)  // 0.5×0.040 + 0.3×0.060 + 0.2×0.080
  const sum = Object.values(result).reduce((a, b) => a + b, 0)
  expect(sum).toBeCloseTo(1, 6)
})

test('applyHandedness picks vs-RHP rates when batter faces RHP', () => {
  const seasonByHand = {
    vsR: { hr: 0.030, k: 0.220, bb: 0.090, '1b': 0.150, '2b': 0.045, '3b': 0.005, out: 0.460 },
    vsL: { hr: 0.050, k: 0.200, bb: 0.080, '1b': 0.155, '2b': 0.050, '3b': 0.005, out: 0.460 },
  }
  expect(applyHandedness(seasonByHand, 'R').hr).toBe(0.030)
  expect(applyHandedness(seasonByHand, 'L').hr).toBe(0.050)
})
```

- [ ] **Step 2: Run — expected FAIL.**

- [ ] **Step 3: Implement `lib/rates.ts`**

```ts
import type { Handedness, OutcomeRates } from './types'

export interface BlendArgs {
  season: OutcomeRates
  l30: OutcomeRates
  l15: OutcomeRates
  weights: { season: number; l30: number; l15: number }
}

export function blendRates({ season, l30, l15, weights }: BlendArgs): OutcomeRates {
  const result: Partial<OutcomeRates> = {}
  for (const k of Object.keys(season)) {
    const v = weights.season * season[k as keyof OutcomeRates]
            + weights.l30 * l30[k as keyof OutcomeRates]
            + weights.l15 * l15[k as keyof OutcomeRates]
    result[k as keyof OutcomeRates] = v
  }
  // Normalize to sum 1
  const total = Object.values(result).reduce((a, b) => a + b!, 0)!
  return Object.fromEntries(
    Object.entries(result).map(([k, v]) => [k, v! / total])
  ) as OutcomeRates
}

export function applyHandedness(
  splits: { vsR: OutcomeRates; vsL: OutcomeRates },
  pitcherHand: Handedness,
): OutcomeRates {
  if (pitcherHand === 'R') return splits.vsR
  if (pitcherHand === 'L') return splits.vsL
  // Switch — average (rare in practice for pitchers)
  return blendRates({
    season: splits.vsR, l30: splits.vsR, l15: splits.vsL,
    weights: { season: 0.4, l30: 0.4, l15: 0.2 },  // approximate — recalibrate
  })
}
```

- [ ] **Step 4: Run — expected PASS. Commit.**

```bash
git add lib/rates.ts __tests__/rates.test.ts
git commit -m "feat(lib): season/L30/L15 blend + handedness split helpers"
```

---

## Task 13: `lib/per-pa.ts` — log-5 + Statcast hybrid

**Files:**
- Create: `lib/per-pa.ts`
- Test: `__tests__/per-pa.test.ts`

- [ ] **Step 1: Failing tests**

`__tests__/per-pa.test.ts`:

```ts
import { computePerPA } from '@/lib/per-pa'

const elliteBatter = {
  rates: { '1b': 0.16, '2b': 0.06, '3b': 0.005, hr: 0.075, bb: 0.13, k: 0.18, out: 0.39 },
  statcast: { barrelPct: 0.18, hardHitPct: 0.55, xwOBA: 0.420, xISO: 0.290, avgExitVelo: 92 },
}

const avgPitcher = {
  rates: { '1b': 0.143, '2b': 0.045, '3b': 0.005, hr: 0.030, bb: 0.085, k: 0.225, out: 0.467 },
  statcast: { barrelsAllowedPct: 0.08, hardHitPctAllowed: 0.40, xwOBAAllowed: 0.320, whiffPct: 0.25 },
}

const neutralCtx = {
  parkFactors: { hr: 1.0, '1b': 1.0, '2b': 1.0, '3b': 1.0, bb: 1.0, k: 1.0 },
  weatherFactors: { hr: 1.0, '1b': 1.0, '2b': 1.0, '3b': 1.0, bb: 1.0, k: 1.0 },
  ttoMultipliers: { hr: 1.0, '1b': 1.0, '2b': 1.0, '3b': 1.0, bb: 1.0, k: 1.0 },
}

test('outcomes sum to 1', () => {
  const out = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  const sum = Object.values(out).reduce((a, b) => a + b, 0)
  expect(sum).toBeCloseTo(1, 6)
})

test('elite barrel% boosts HR rate above raw batter rate', () => {
  const out = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  expect(out.hr).toBeGreaterThan(elliteBatter.rates.hr)  // Statcast adjustment helped
})

test('weak pitcher (low whiff%) lowers K rate vs avg pitcher', () => {
  const weakPitcher = { ...avgPitcher, statcast: { ...avgPitcher.statcast, whiffPct: 0.18 } }
  const outVsAvg = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  const outVsWeak = computePerPA({ batter: elliteBatter, pitcher: weakPitcher, ctx: neutralCtx })
  expect(outVsWeak.k).toBeLessThan(outVsAvg.k)
})

test('TTO 3rd-time multiplier boosts batter outcomes', () => {
  const tto3 = { ...neutralCtx, ttoMultipliers: { hr: 1.25, '1b': 1.10, '2b': 1.15, '3b': 1.15, bb: 1.08, k: 0.94 } }
  const outNeutral = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  const outTTO = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: tto3 })
  expect(outTTO.hr).toBeGreaterThan(outNeutral.hr)
})

test('park HR factor passes through', () => {
  const coors = { ...neutralCtx, parkFactors: { ...neutralCtx.parkFactors, hr: 1.30 } }
  const outNeutral = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: neutralCtx })
  const outCoors = computePerPA({ batter: elliteBatter, pitcher: avgPitcher, ctx: coors })
  expect(outCoors.hr).toBeGreaterThan(outNeutral.hr)
})
```

- [ ] **Step 2: Run — expected FAIL.**

- [ ] **Step 3: Implement `lib/per-pa.ts`**

```ts
import { LEAGUE_AVG_RATES } from './constants'
import type { Outcome, OutcomeRates } from './types'

export interface PerPAInputs {
  batter: {
    rates: OutcomeRates  // already blended + stabilized + handedness-adjusted
    statcast?: {
      barrelPct: number
      hardHitPct: number
      xwOBA?: number
      xISO?: number
      avgExitVelo?: number
    }
  }
  pitcher: {
    rates: OutcomeRates  // ditto
    statcast?: {
      barrelsAllowedPct: number
      hardHitPctAllowed: number
      xwOBAAllowed?: number
      whiffPct: number
    }
  }
  ctx: {
    parkFactors: Record<Outcome, number>
    weatherFactors: Record<Outcome, number>
    ttoMultipliers: Record<Outcome, number>
  }
}

const LG_BARREL_PCT = 0.075
const LG_HARD_HIT_PCT = 0.395
const LG_WHIFF_PCT = 0.245

export function computePerPA(inputs: PerPAInputs): OutcomeRates {
  const { batter, pitcher, ctx } = inputs

  // Log-5 base: combine batter and pitcher rates per outcome relative to league avg
  const base: Partial<OutcomeRates> = {}
  for (const k of Object.keys(LEAGUE_AVG_RATES) as Outcome[]) {
    const lg = LEAGUE_AVG_RATES[k]
    if (lg === 0) { base[k] = 0; continue }
    base[k] = batter.rates[k] * (pitcher.rates[k] / lg)
  }

  // Statcast adjustments
  if (batter.statcast && pitcher.statcast) {
    const barrelMult = (batter.statcast.barrelPct / LG_BARREL_PCT) *
                       (pitcher.statcast.barrelsAllowedPct / LG_BARREL_PCT)
    const hardHitMult = (batter.statcast.hardHitPct / LG_HARD_HIT_PCT) *
                        (pitcher.statcast.hardHitPctAllowed / LG_HARD_HIT_PCT)
    const whiffMult = pitcher.statcast.whiffPct / LG_WHIFF_PCT

    // Geometric blend with raw rate (50/50) to keep adjustments tempered
    base.hr = base.hr! * Math.sqrt(barrelMult)
    base['1b'] = base['1b']! * Math.sqrt(hardHitMult)
    base['2b'] = base['2b']! * Math.sqrt(hardHitMult)
    base.k = base.k! * Math.sqrt(whiffMult)
  }

  // Apply context multipliers
  const adjusted: Partial<OutcomeRates> = {}
  for (const k of Object.keys(base) as Outcome[]) {
    const park = ctx.parkFactors[k] ?? 1
    const wx = ctx.weatherFactors[k] ?? 1
    const tto = ctx.ttoMultipliers[k] ?? 1
    adjusted[k] = base[k]! * park * wx * tto
  }

  // Normalize to sum 1
  const total = Object.values(adjusted).reduce((a, b) => a + b!, 0)!
  return Object.fromEntries(
    Object.entries(adjusted).map(([k, v]) => [k, v! / total])
  ) as OutcomeRates
}
```

- [ ] **Step 4: Run — expected PASS. Commit.**

```bash
git add lib/per-pa.ts __tests__/per-pa.test.ts
git commit -m "feat(lib): per-PA outcome distribution (log-5 + Statcast hybrid)"
```

---

## Task 14: `lib/tto.ts` + `lib/bullpen.ts`

**Files:**
- Create: `lib/tto.ts`, `lib/bullpen.ts`
- Test: `__tests__/tto.test.ts`, `__tests__/bullpen.test.ts`

- [ ] **Step 1: TDD `lib/tto.ts`** — exports `getTtoMultipliers(pitcherId, ttoIndex)`. Sample size threshold: ≥ 5 starts use pitcher-specific Statcast splits, else fall back to `TTO_MULTIPLIERS[ttoIndex]` from constants.

```ts
// __tests__/tto.test.ts
import { getTtoMultipliers } from '@/lib/tto'

test('returns league-avg multipliers when pitcher data is missing', async () => {
  const result = await getTtoMultipliers({ pitcherId: 999999999, ttoIndex: 3 })
  expect(result.hr).toBeCloseTo(1.25, 2)  // matches TTO_MULTIPLIERS['3'].hr
})

test('1st time through has 1.0 multipliers across all outcomes', async () => {
  const result = await getTtoMultipliers({ pitcherId: 543037, ttoIndex: 1 })
  expect(result.hr).toBe(1.0)
})
```

- [ ] **Step 2: Implement `lib/tto.ts`**

For v1, return league-avg from constants. Pitcher-specific TTO requires Statcast pitch-by-pitch data — wire as a stub that falls back, leave the Statcast hookup as a follow-up.

```ts
import { TTO_MULTIPLIERS } from './constants'
import type { Outcome } from './types'

export async function getTtoMultipliers(args: {
  pitcherId: number
  ttoIndex: 1 | 2 | 3 | 4
}): Promise<Record<Outcome, number>> {
  const fallback = TTO_MULTIPLIERS[String(args.ttoIndex)]
  // TODO: pull pitcher-specific Statcast splits when available; for v1 fall back.
  // Cache key: pitcher-tto:{pitcherId}:YYYY-MM-DD
  return { ...fallback, out: 1.0 } as Record<Outcome, number>
}
```

- [ ] **Step 3: Run TTO tests, commit.**

```bash
npm test -- tto
git add lib/tto.ts __tests__/tto.test.ts
git commit -m "feat(lib): TTO multipliers with league-avg fallback (Statcast hookup TODO)"
```

- [ ] **Step 4: TDD `lib/bullpen.ts`** — exports `getBullpenTiers(teamId, batterHand)`. Returns `{ highLeverage: OutcomeRates; rest: OutcomeRates; weightForPA(paIndex): number }`.

```ts
// __tests__/bullpen.test.ts
import { weightForPA } from '@/lib/bullpen'

test('weightForPA returns mostly high-leverage in late PAs', () => {
  expect(weightForPA(4)).toBeGreaterThan(0.7)  // 4th PA → mostly closer/setup
})

test('weightForPA returns low high-leverage weight in early PAs', () => {
  expect(weightForPA(2)).toBeLessThan(0.3)  // 2nd PA → mostly mid-relief if at all bullpen
})
```

- [ ] **Step 5: Implement `lib/bullpen.ts`**

```ts
import { fetchTeamBullpenStats } from './mlb-api'
import type { Handedness, OutcomeRates } from './types'

export async function getBullpenTiers(args: { teamId: number; batterHand: Handedness }): Promise<{
  highLeverage: OutcomeRates
  rest: OutcomeRates
}> {
  const stats = await fetchTeamBullpenStats(args.teamId)
  const hand = args.batterHand === 'R' ? 'vsR' : 'vsL'
  return {
    highLeverage: stats.highLeverage[hand] as OutcomeRates,
    rest: stats.rest[hand] as OutcomeRates,
  }
}

// PA index → fraction of weight on high-leverage tier (rest = 1 - this)
export function weightForPA(paIndex: number): number {
  if (paIndex <= 2) return 0.10  // unlikely to face bullpen at all; if so, mid-relief
  if (paIndex === 3) return 0.45
  return 0.85  // 4th+ PA → almost always closer/setup
}
```

- [ ] **Step 6: Commit.**

```bash
git add lib/bullpen.ts __tests__/bullpen.test.ts
git commit -m "feat(lib): leverage-tier bullpen rates with PA-aware weighting"
```

---

## Task 15: `lib/starter-share.ts`

**Files:**
- Create: `lib/starter-share.ts`
- Test: `__tests__/starter-share.test.ts`

- [ ] **Step 1: Failing tests for tiered fallback**

```ts
import { getStarterShare, ipCdfFromStarts } from '@/lib/starter-share'

test('ipCdfFromStarts produces monotonic decreasing CDF', () => {
  const starts = [{ ip: 5.0 }, { ip: 6.0 }, { ip: 5.7 }, { ip: 4.3 }, { ip: 6.2 }]
  const cdf = ipCdfFromStarts(starts)
  expect(cdf.completedAtLeast(5)).toBeGreaterThan(cdf.completedAtLeast(7))
  expect(cdf.completedAtLeast(0)).toBeCloseTo(1.0)
})

test('starter_share for top-of-order vs avg starter is ~0.75', async () => {
  const result = await getStarterShare({
    pitcherId: 999,  // missing → fallback
    pitcherType: 'starter',
    lineupSlot: 1,
    expectedPA: 4,
  })
  expect(result.starterShare).toBeGreaterThan(0.65)
  expect(result.starterShare).toBeLessThan(0.85)
})

test('starter_share for opener is much lower', async () => {
  const result = await getStarterShare({
    pitcherId: 999,
    pitcherType: 'opener',
    lineupSlot: 1,
    expectedPA: 4,
  })
  expect(result.starterShare).toBeLessThan(0.4)
})
```

- [ ] **Step 2: Implement `lib/starter-share.ts`**

Pseudocode (full implementation in the task):
1. Fetch recent starts via `fetchPitcherRecentStarts(pitcherId, 10)`
2. Determine fallback tier based on count: ≥5 / 1-4 (Bayesian blend) / 0 with career (career CDF) / 0 anywhere (league-avg-by-type)
3. Build CDF: `completedAtLeast(inning) = fraction of starts where IP >= inning`
4. For each PA index `i`, estimate inning of that PA (lineup slot + PA index → inning estimate)
5. `P(starter still in | PA_i) = cdf.completedAtLeast(estimatedInning - 0.5)` (half-inning offset to handle mid-inning pulls)
6. `starter_share = mean of P(starter still in) across PA_1..PA_expectedPA`

League-avg-by-type CDFs are constants:
- Regular starter: rough triangular distribution centered at 5.5 IP
- Opener: triangular distribution centered at 1.5 IP

- [ ] **Step 3: Run, commit.**

```bash
npm test -- starter-share
git add lib/starter-share.ts __tests__/starter-share.test.ts
git commit -m "feat(lib): starter_share with tiered IP CDF fallback (incl. opener handling)"
```

---

# Phase 4 — Simulation Engine

## Task 16: `lib/baserunner.ts` — bases-state evolution

**Files:**
- Create: `lib/baserunner.ts`
- Test: `__tests__/baserunner.test.ts`

- [ ] **Step 1: TDD with explicit outcome scenarios**

```ts
import { applyOutcome, EMPTY_BASES, BasesState } from '@/lib/baserunner'

describe('applyOutcome', () => {
  test('solo HR with empty bases: 1 R, 1 RBI', () => {
    const result = applyOutcome(EMPTY_BASES, 'HR', { batterId: 100 })
    expect(result.bases).toEqual({ b1: null, b2: null, b3: null })
    expect(result.runsScored).toEqual([100])  // batter scored
    expect(result.rbis).toBe(1)
  })

  test('grand slam: 4 R, 4 RBI, bases empty after', () => {
    const loaded: BasesState = { b1: 1, b2: 2, b3: 3 }
    const result = applyOutcome(loaded, 'HR', { batterId: 100 })
    expect(result.runsScored.sort()).toEqual([1, 2, 3, 100])
    expect(result.rbis).toBe(4)
    expect(result.bases).toEqual({ b1: null, b2: null, b3: null })
  })

  test('walk with bases empty: batter to first, no RBI', () => {
    const result = applyOutcome(EMPTY_BASES, 'BB', { batterId: 100 })
    expect(result.bases.b1).toBe(100)
    expect(result.runsScored).toEqual([])
    expect(result.rbis).toBe(0)
  })

  test('walk with bases loaded: 1 R, 1 RBI, force', () => {
    const loaded: BasesState = { b1: 1, b2: 2, b3: 3 }
    const result = applyOutcome(loaded, 'BB', { batterId: 100 })
    expect(result.runsScored).toEqual([3])
    expect(result.rbis).toBe(1)
    expect(result.bases).toEqual({ b1: 100, b2: 1, b3: 2 })
  })

  test('1B with runner on 2nd: probabilistic — runner usually scores', () => {
    // Runs 100 sims; expect runner-from-2nd to score in majority
    let scores = 0
    for (let i = 0; i < 100; i++) {
      const res = applyOutcome({ b1: null, b2: 2, b3: null }, '1B', { batterId: 100 })
      if (res.runsScored.includes(2)) scores++
    }
    expect(scores).toBeGreaterThan(50)
    expect(scores).toBeLessThan(100)
  })

  test('OUT with no force advance returns bases unchanged', () => {
    const start: BasesState = { b1: 1, b2: null, b3: 3 }
    const result = applyOutcome(start, 'OUT', { batterId: 100 })
    expect(result.bases).toEqual(start)
    expect(result.runsScored).toEqual([])
    expect(result.rbis).toBe(0)
    expect(result.outsRecorded).toBe(1)
  })

  test('OUT records exactly 1 out in v1 (no double-play modeling)', () => {
    expect(applyOutcome(EMPTY_BASES, 'OUT', { batterId: 100 }).outsRecorded).toBe(1)
    expect(applyOutcome(EMPTY_BASES, 'K', { batterId: 100 }).outsRecorded).toBe(1)
  })

  test('Hits and walks do not record outs', () => {
    expect(applyOutcome(EMPTY_BASES, 'HR', { batterId: 100 }).outsRecorded).toBe(0)
    expect(applyOutcome(EMPTY_BASES, 'BB', { batterId: 100 }).outsRecorded).toBe(0)
    expect(applyOutcome(EMPTY_BASES, '1B', { batterId: 100 }).outsRecorded).toBe(0)
  })
})

// Note: baserunner advancement constants (e.g., SCORE_FROM_2ND_ON_SINGLE = 0.62)
// derive from public run-expectancy tables (Tom Tango / The Book). v1 uses fixed
// constants; recalibration backlog includes pulling event-level Statcast advancement
// rates by base-out state.
```

- [ ] **Step 2: Implement `lib/baserunner.ts`**

```ts
import type { Outcome } from './types'

export interface BasesState { b1: number | null; b2: number | null; b3: number | null }
export const EMPTY_BASES: BasesState = { b1: null, b2: null, b3: null }

export interface OutcomeResult {
  bases: BasesState
  runsScored: number[]  // playerIds who scored on this play (incl. batter)
  rbis: number
  outsRecorded: number  // 0 for hits/walks/HR; 1 for K/standard out/sac fly; 2 for double plays (rare; v1: always 1 for OUT)
}

// Probability that runner on 2nd scores on a 1B (publicly available stat: ~62%)
const SCORE_FROM_2ND_ON_SINGLE = 0.62
const SCORE_FROM_3RD_ON_OUT = 0.30  // sac fly / productive out

export function applyOutcome(
  bases: BasesState,
  outcome: Outcome,
  batter: { batterId: number },
): OutcomeResult {
  // Implement each outcome's standard advancement rules:
  // - HR: all runners score; batter scores
  // - 3B: all on score; batter to 3B
  // - 2B: r3 scores, r2 scores, r1 to 3B (or scores 50% of time?), batter to 2B
  // - 1B: r3 scores, r2 scores 62%/stays at 3B 38%, r1 to 2B (or 3B 30%), batter to 1B
  // - BB: force advances only when forced
  // - K: nothing changes
  // - OUT: r3 scores 30% of time on sac fly / productive out; otherwise nothing
  //
  // (Full implementation here — TDD-driven)
  // ...
}
```

The full implementation should encode standard MLB advancement rules. Use deterministic outcomes for clarity where possible (HR, BB-force, K), probabilistic for ambiguous cases (1B with runner on 2nd). Random rolls use `Math.random()` — sim is non-seeded for v1.

> **Forward reference**: Task 20 will add a second export (`simSinglePlayerHRR`) to `lib/sim.ts` for the P_typical replay-sim. Structure the file so per-PA helpers (sample outcome, apply outcome, advance to next batter) are private functions that both `simGame` and the upcoming `simSinglePlayerHRR` can share — DRY them out now to avoid duplication later.

- [ ] **Step 3: Run, iterate, commit.**

```bash
npm test -- baserunner
git add lib/baserunner.ts __tests__/baserunner.test.ts
git commit -m "feat(lib): bases-state evolution rules per outcome"
```

---

## Task 17: `lib/sim.ts` — lineup-aware Monte Carlo

**Files:**
- Create: `lib/sim.ts`
- Test: `__tests__/sim.test.ts`

- [ ] **Step 1: TDD with sanity-check expectations**

```ts
import { simGame } from '@/lib/sim'

const MOCK_LINEUP_HOME = /* 9 batters with roughly avg rates */
const MOCK_LINEUP_AWAY = /* 9 batters */

describe('simGame', () => {
  test('returns histogram for each batter with HRR ≥ 0', async () => {
    const result = await simGame({
      home: MOCK_LINEUP_HOME, away: MOCK_LINEUP_AWAY,
      homeStarter: MOCK_PITCHER, awayStarter: MOCK_PITCHER,
      homeBullpen: MOCK_BP, awayBullpen: MOCK_BP,
      ctx: NEUTRAL_CTX,
      iterations: 1000,
    })
    expect(result.batterHRR.size).toBe(18)  // 9+9 batters
    for (const dist of result.batterHRR.values()) {
      expect(dist.totalSims).toBe(1000)
      expect(dist.atLeast[0]).toBe(1.0)  // P(HRR ≥ 0) trivially 1
      expect(dist.atLeast[1]).toBeLessThanOrEqual(1.0)
      expect(dist.atLeast[3]).toBeLessThanOrEqual(dist.atLeast[2])
    }
  })

  test('elite hitter has higher P(HRR ≥ 3) than 9-hole', async () => {
    // Set lineup with one elite hitter at slot 3, weak hitter at slot 9
    const result = await simGame({ /* ... */ iterations: 5000 })
    const elite = result.batterHRR.get(eliteId)!.atLeast[3]
    const weak = result.batterHRR.get(weakId)!.atLeast[3]
    expect(elite).toBeGreaterThan(weak * 2)
  })
})
```

- [ ] **Step 2: Implement `lib/sim.ts`**

Pseudocode:
1. Build per-PA distribution per batter against starter (with TTO multipliers per PA-against-starter index) and against bullpen (leverage-tier weighted).
2. Simulate `iterations` games:
   - Track batting order index for each team
   - For each half-inning, run PAs until 3 outs
   - Each PA: determine pitcher (starter via `starter_share` logic, else bullpen tier)
   - Sample outcome from distribution, apply to baserunner state
   - Track H, R, RBI per batter
3. End at 9 innings (no extras — see spec §4.9)
4. Aggregate per-batter HRR distribution → `atLeast: [P(HRR≥0), P(HRR≥1), P(HRR≥2), P(HRR≥3), P(HRR≥4+)]`

Performance target: 10k iterations on a 15-game slate completes in < 60s.

- [ ] **Step 3: Run, iterate.**

The implementation will be ~200 lines — bigger than other tasks. Take time to get it right.

- [ ] **Step 4: Commit**

```bash
git add lib/sim.ts __tests__/sim.test.ts
git commit -m "feat(lib): lineup-aware Monte Carlo simulator (10k iter target)"
```

---

## Task 18: `app/api/sim/[gameId]/route.ts` — sim endpoint with caching

**Files:**
- Create: `app/api/sim/[gameId]/route.ts`

- [ ] **Step 1: Implement endpoint**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet } from '@/lib/kv'
import { simGame } from '@/lib/sim'
import { fetchSchedule } from '@/lib/mlb-api'
import { getLineup, lineupHash } from '@/lib/lineup'
// ... other inputs

export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: { gameId: string } }) {
  const gameId = parseInt(params.gameId, 10)
  if (isNaN(gameId)) return NextResponse.json({ error: 'invalid gameId' }, { status: 400 })

  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  // Build inputs
  const lineup = await getLineup(gameId)
  const lineupH = lineupHash(lineup)
  // ... weather, starter, bullpen, etc.
  const weatherH = /* hash of weather forecast */ ''

  // Cache check — key is keyed by lineupHash only (per spec §7);
  // sim-meta tracks both hashes for invalidation logic
  const cacheKey = `sim:${gameId}:${lineupH}`
  const meta = await kvGet<{ lineupHash: string; weatherHash: string; simAt: number }>(`sim-meta:${gameId}`)
  const cacheValid = meta && meta.lineupHash === lineupH && meta.weatherHash === weatherH
  if (cacheValid) {
    const cached = await kvGet(cacheKey)
    if (cached) return NextResponse.json({ ...cached, fromCache: true })
  }

  // Run sim
  const result = await simGame({ /* assembled inputs */, iterations: 10_000 })

  // Cache
  await kvSet(cacheKey, result, { ex: 86400 })  // 24h
  await kvSet(`sim-meta:${gameId}`, { lineupHash: lineupH, weatherHash: weatherH, simAt: Date.now() }, { ex: 86400 })

  return NextResponse.json({ ...result, fromCache: false })
}
```

**Performance optimization** (apply during Task 17 implementation):
- In the per-PA inner loop, sample outcomes via cumulative-sum + binary search rather than linear scan of the 7-element distribution.
- Avoid object allocation in the hot path — pre-allocate the `BasesState` and reuse via reset rather than constructing per-PA.
- Measure: 10k iter × 15 games on local dev should complete in < 60s. Profile if slower.

- [ ] **Step 2: Manual smoke test**

```bash
npm run dev
# In another shell:
curl 'http://localhost:3000/api/sim/12345?date=2025-07-04'
```

Expected: JSON response with `batterHRR` map, completes < 60s.

- [ ] **Step 3: Commit**

```bash
git add app/api/sim/
git commit -m "feat(api): /api/sim/[gameId] runs Monte Carlo with lineup+weather cache key"
```

---

## Task 18b: `app/api/sim/route.ts` — prewarm orchestrator

**Files:**
- Create: `app/api/sim/route.ts`

This endpoint is what cron calls to prewarm sims for today's slate. It iterates today's games and dispatches `/api/sim/[gameId]` for any whose `(lineupHash, weatherHash)` has changed since the last sim (per `sim-meta:{gameId}`).

- [ ] **Step 1: Implement orchestrator**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { kvGet } from '@/lib/kv'
import { fetchSchedule } from '@/lib/mlb-api'
import { getLineup, lineupHash } from '@/lib/lineup'
import { fetchWeather } from '@/lib/weather-api'
// hash helper exported from /lib/lineup or /lib/weather-api
import { weatherHash } from '@/lib/weather-api'

export const maxDuration = 60

function getBaseUrl(req: NextRequest): string {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(req.url).origin
}

export async function GET(req: NextRequest) {
  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const games = await fetchSchedule(date)
  const baseUrl = getBaseUrl(req)

  const results: Array<{ gameId: number; status: 'simmed' | 'cached' | 'failed'; reason?: string }> = []

  // Run sequentially to avoid stampeding KV / external APIs.
  // 15 games × ~5-10s each (when sim runs) is fine for 60s budget when most are cached.
  for (const g of games) {
    try {
      const lineup = await getLineup(g.gameId)
      const lH = lineupHash(lineup)
      const weather = await fetchWeather(g.venueId, g.gameDate)
      const wH = weatherHash(weather)

      const meta = await kvGet<{ lineupHash: string; weatherHash: string }>(`sim-meta:${g.gameId}`)
      if (meta && meta.lineupHash === lH && meta.weatherHash === wH) {
        results.push({ gameId: g.gameId, status: 'cached' })
        continue
      }

      // Cache miss / invalidation needed — call the per-game sim endpoint
      const r = await fetch(`${baseUrl}/api/sim/${g.gameId}?date=${date}`)
      if (!r.ok) {
        results.push({ gameId: g.gameId, status: 'failed', reason: `${r.status}` })
        continue
      }
      results.push({ gameId: g.gameId, status: 'simmed' })
    } catch (e) {
      results.push({ gameId: g.gameId, status: 'failed', reason: (e as Error).message })
    }
  }

  return NextResponse.json({ date, summary: results })
}
```

- [ ] **Step 2: Add `weatherHash` helper to `lib/weather-api.ts`**

```ts
import { createHash } from 'crypto'

export function weatherHash(w: { temp: number; windSpeed: number; windDirection: number }): string {
  // Round to coarse buckets so trivial forecast jitter doesn't invalidate sim cache
  const rounded = {
    temp: Math.round(w.temp / 5) * 5,                   // 5°F buckets
    wind: Math.round(w.windSpeed / 3) * 3,              // 3 mph buckets
    dir: Math.round(w.windDirection / 30) * 30,         // 30° buckets
  }
  return createHash('sha1').update(JSON.stringify(rounded)).digest('hex').slice(0, 12)
}
```

- [ ] **Step 3: Manual smoke test**

```bash
curl 'http://localhost:3000/api/sim?date=2025-07-04'
```

Expected: JSON summary with one entry per game.

- [ ] **Step 4: Commit**

```bash
git add app/api/sim/route.ts lib/weather-api.ts
git commit -m "feat(api): /api/sim prewarm orchestrator + weatherHash helper"
```

---

## Task 19: `vercel.json` for cron + maxDuration

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Configure crons**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "app/api/sim/[gameId]/route.ts": { "maxDuration": 60 },
    "app/api/sim/route.ts": { "maxDuration": 60 },
    "app/api/lock/route.ts": { "maxDuration": 30 },
    "app/api/settle/route.ts": { "maxDuration": 60 }
  },
  "crons": [
    { "path": "/api/sim", "schedule": "*/5 14-23 * * *" },
    { "path": "/api/sim", "schedule": "*/5 0-6 * * *" },
    { "path": "/api/lock", "schedule": "*/5 14-23 * * *" },
    { "path": "/api/lock", "schedule": "*/5 0-6 * * *" },
    { "path": "/api/settle", "schedule": "0 10 * * *" }
  ]
}
```

**Cron schedule notes:**
- Vercel crons run in **UTC**. Pacific Time is UTC-7 (PDT) or UTC-8 (PST).
- Slate hours target: ~10 AM – 11 PM Pacific. In UTC during PDT (most of season): 17:00 – 06:00 next day.
- Cron hours are 0–23 (so the original `14-26` was invalid). To wrap midnight, use **two entries** as shown above: `14-23` and `0-6`.
- `0 10 * * *` = 10:00 UTC = 3 AM Pacific (PDT) — settle previous day's picks.
- During PST (Nov–Mar), the offset is one hour — schedule still works since slate is wider than the cron window.

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore: vercel.json with maxDuration: 60 + valid UTC cron schedule"
```

---

# Phase 5 — EDGE & Ranking

## Task 20: `lib/p-typical.ts` — replay-the-season sim

**Files:**
- Create: `lib/p-typical.ts`
- Test: `__tests__/p-typical.test.ts`

**Performance constraint:** running full 10k-iter `simGame` × N actual opponents × 30 active players per slate is too expensive. Use a reduced-iteration single-batter-faster path.

- [ ] **Step 1: Add `simSinglePlayerHRR` to `lib/sim.ts`** (extracted from full sim)

This variant simulates only the target player's HRR distribution without tracking the other 8 batters' final stats — ~9x faster than full `simGame` for P_typical purposes.

```ts
// in lib/sim.ts (add alongside simGame)
export async function simSinglePlayerHRR(args: {
  targetPlayerId: number
  team: { lineup: BatterContext[]; ourStarter: PitcherContext; ... }
  opponent: { /* same shape */ }
  ctx: GameCtx
  iterations: number  // typically 1500 for P_typical (vs 10k for P_matchup)
}): Promise<{ atLeast: number[]; totalSims: number }>
```

The internal loop is the same as `simGame` but only records H/R/RBI for `targetPlayerId`, skipping the per-batter aggregation for the other 17 batters. Reuses `applyOutcome`, `getStarterShare`, etc. — DRY with `simGame`.

- [ ] **Step 2: Implement `lib/p-typical.ts`**

```ts
import { kvGet, kvSet } from './kv'
import { simSinglePlayerHRR } from './sim'
import { fetchBatterGameLog, fetchPlayerSlotFrequency } from './mlb-api'
// ... build inputs from each historical game

export async function getPTypical(args: {
  playerId: number
  date: string
}): Promise<{ atLeast: number[] }> {
  const cacheKey = `p-typical:${args.playerId}:${args.date}`
  const cached = await kvGet<{ atLeast: number[] }>(cacheKey)
  if (cached) return cached

  const gameLog = await fetchBatterGameLog(args.playerId, /* season */)
  // Sample up to 30 games at random from the season log to keep compute bounded;
  // for season-long average this is statistically sufficient and 5x faster.
  const sample = gameLog.length > 30 ? randomSample(gameLog, 30) : gameLog

  const slotFreq = await fetchPlayerSlotFrequency(args.playerId, /* season */)
  const totalAtLeast = [0, 0, 0, 0, 0]

  for (const g of sample) {
    // Build sim inputs from THIS historical game's actual opponent + park + weather
    // Use the player's most-frequent slot for that game (or actual slot from boxscore if known)
    const result = await simSinglePlayerHRR({
      targetPlayerId: args.playerId,
      /* ... assembled from historical game */,
      iterations: 1500,  // reduced — sufficient for averaging across 30 games
    })
    for (let i = 0; i < 5; i++) totalAtLeast[i] += result.atLeast[i]
  }

  const atLeast = totalAtLeast.map(v => v / sample.length)
  await kvSet(cacheKey, { atLeast }, { ex: 86400 })
  return { atLeast }
}
```

**Compute budget:** 30 games × 1500 iter × 1 batter ≈ 45k PA samples per player vs full-sim 10k × 9 batters × 40 PAs = 3.6M per game. About **80x cheaper** per player. Fits in cron budget for ~30 active players.

- [ ] **Step 3: Test that running on a known elite player produces plausible numbers**

E.g., Judge career-typical ≥1+ HRR ~0.78, ≥2+ HRR ~0.42, ≥3+ HRR ~0.18 (rough — actual numbers fluctuate).

- [ ] **Step 4: Commit**

```bash
git add lib/p-typical.ts lib/sim.ts __tests__/p-typical.test.ts
git commit -m "feat(lib): P_typical via reduced-iter single-batter replay-sim with KV cache"
```

---

## Task 21: `lib/edge.ts` — EDGE / SCORE formulas

**Files:**
- Create: `lib/edge.ts`
- Test: `__tests__/edge.test.ts`

- [ ] **Step 1: TDD**

```ts
import { computeEdge, computeScore } from '@/lib/edge'

test('EDGE = P_matchup / max(P_typical, 0.01) - 1', () => {
  expect(computeEdge({ pMatchup: 0.20, pTypical: 0.10 })).toBeCloseTo(1.0)
  expect(computeEdge({ pMatchup: 0.50, pTypical: 0.50 })).toBeCloseTo(0)
})

test('floor: P_typical near zero clamps to 0.01', () => {
  const result = computeEdge({ pMatchup: 0.05, pTypical: 0.001 })
  expect(result).toBeCloseTo(4.0)  // 0.05 / 0.01 - 1
})

test('SCORE = EDGE × confidence', () => {
  expect(computeScore({ edge: 0.5, confidence: 0.8 })).toBeCloseTo(0.4)
})
```

- [ ] **Step 2: Implement, run, commit.**

```ts
export function computeEdge(args: { pMatchup: number; pTypical: number }): number {
  return args.pMatchup / Math.max(args.pTypical, 0.01) - 1
}

export function computeScore(args: { edge: number; confidence: number }): number {
  return args.edge * args.confidence
}
```

```bash
git add lib/edge.ts __tests__/edge.test.ts
git commit -m "feat(lib): EDGE and SCORE formulas"
```

---

## Task 22: `lib/confidence.ts`

**Files:**
- Create: `lib/confidence.ts`
- Test: `__tests__/confidence.test.ts`

- [ ] **Step 1: TDD hard gates + graded multiplier**

```ts
import { computeConfidence, passesHardGates } from '@/lib/confidence'

test('hard gates: postponed game fails', () => {
  expect(passesHardGates({ gameStatus: 'postponed', /* ... */ })).toBe(false)
})

test('hard gates: TBD pitcher fails', () => {
  expect(passesHardGates({ probableStarterId: null, /* ... */ })).toBe(false)
})

test('hard gates: expected PA < 3 fails', () => {
  expect(passesHardGates({ expectedPA: 2.5, /* ... */ })).toBe(false)
})

test('confidence multiplier: confirmed lineup + good samples = 1.0', () => {
  const c = computeConfidence({
    lineupStatus: 'confirmed',
    bvpAB: 25,
    pitcherStartCount: 12,
    weatherStable: true,
    isOpener: false,
    /* ... */
  })
  expect(c).toBeCloseTo(1.0, 2)
})

test('confidence multiplier: estimated lineup + low samples ~ 0.55-0.65', () => {
  const c = computeConfidence({
    lineupStatus: 'estimated',
    bvpAB: 0,
    pitcherStartCount: 3,
    weatherStable: false,
    isOpener: true,
    /* ... */
  })
  expect(c).toBeGreaterThan(0.40)
  expect(c).toBeLessThan(0.65)
})
```

- [ ] **Step 2: Implement & commit.**

```bash
git add lib/confidence.ts __tests__/confidence.test.ts
git commit -m "feat(lib): confidence factor (hard gates + graded multiplier)"
```

---

## Task 23: `lib/ranker.ts` + `app/api/picks/route.ts`

**Files:**
- Create: `lib/ranker.ts`, `app/api/picks/route.ts`
- Test: `__tests__/ranker.test.ts`

### Pick contract (returned by `/api/picks`)

```ts
// JSON shape returned by GET /api/picks?date=YYYY-MM-DD
export interface PicksResponse {
  date: string
  refreshedAt: string  // ISO timestamp
  rung1: Pick[]        // sorted by SCORE desc
  rung2: Pick[]
  rung3: Pick[]
  meta: {
    gamesTotal: number
    gamesWithSim: number     // < gamesTotal if some sims still warming
    gamesWithoutSim: number[] // gameIds skipped this refresh
    fromCache: boolean
  }
}

export interface Pick {
  player: { playerId: number; fullName: string; team: string; bats: 'R' | 'L' | 'S' }
  opponent: { teamId: number; abbrev: string }
  gameId: number
  lineupSlot: number
  lineupStatus: 'confirmed' | 'partial' | 'estimated'
  pMatchup: number      // P(HRR ≥ rung) for this matchup
  pTypical: number
  edge: number          // pMatchup / max(pTypical, 0.01) - 1
  confidence: number    // 0.55 - 1.00
  score: number         // edge × confidence
  tier: 'tracked' | 'watching'
}
```

UI tasks (Phase 6) should code against this contract.

- [ ] **Step 1: `lib/ranker.ts`** — composes everything. Given today's slate, for each (player, rung) compute SCORE, classify as Tracked/Watching, return ranked lists.

```ts
import { EDGE_FLOORS, PROB_FLOORS, CONFIDENCE_FLOOR_TRACKED, DISPLAY_FLOOR_SCORE } from './constants'

export interface Pick {
  player: PlayerRef
  opponent: TeamRef
  lineupSlot: number
  pMatchup: number
  pTypical: number
  edge: number
  confidence: number
  score: number
  tier: 'tracked' | 'watching'
}

export function classifyTier(args: {
  rung: 1 | 2 | 3
  edge: number
  pMatchup: number
  confidence: number
  score: number
}): 'tracked' | 'watching' | null {
  if (
    args.confidence >= CONFIDENCE_FLOOR_TRACKED &&
    args.edge >= EDGE_FLOORS[args.rung] &&
    args.pMatchup >= PROB_FLOORS[args.rung]
  ) return 'tracked'
  if (args.score >= DISPLAY_FLOOR_SCORE) return 'watching'
  return null  // dropped from display entirely
}

export async function rankPicks(date: string): Promise<PicksResponse> {
  // 1. Load schedule for `date`
  // 2. For each game:
  //    - Read sim from KV `sim:{gameId}:{lineupH}` (look up lineupH first)
  //    - If sim cache empty → SKIP this game (do NOT trigger sync sim — that would
  //      blow /api/picks budget). Add gameId to meta.gamesWithoutSim. The /api/sim
  //      orchestrator runs every 5 min and will populate it; user sees a "warming"
  //      indicator next refresh.
  // 3. For each player in available sims, compute P_matchup (from sim) and P_typical (from getPTypical, cached)
  // 4. Compute EDGE, confidence, SCORE
  // 5. Classify tier per rung
  // 6. Sort each rung by SCORE descending
  // 7. Return PicksResponse with `meta.gamesWithoutSim` populated
}
```

- [ ] **Step 2: `app/api/picks/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { rankPicks } from '@/lib/ranker'
import { kvGet, kvSet } from '@/lib/kv'

export const revalidate = 60  // page-level cache 60s

export async function GET(req: NextRequest) {
  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  // Try short cache first
  const cacheKey = `picks:current:${date}`
  const cached = await kvGet(cacheKey)
  if (cached) return NextResponse.json({ ...cached, fromCache: true })

  const ranked = await rankPicks(date)
  await kvSet(cacheKey, ranked, { ex: 300 })  // 5 min
  return NextResponse.json({ ...ranked, fromCache: false })
}
```

- [ ] **Step 3: Manual smoke test, commit.**

```bash
npm run dev
curl 'http://localhost:3000/api/picks?date=2025-07-04'
```

```bash
git add lib/ranker.ts app/api/picks/ __tests__/ranker.test.ts
git commit -m "feat(api): /api/picks aggregates ranked picks per rung from sim cache"
```

---

# Phase 6 — Pages & UI

## Task 24: `components/PickRow.tsx`

**Files:**
- Create: `components/PickRow.tsx`

- [ ] **Step 1: Implement** — single row component showing player, opponent, slot, P_matchup, P_typical, EDGE %, SCORE, tier badge.

- [ ] **Step 2: Verify visually with `npm run dev` once connected to mock data, commit.**

```bash
git add components/PickRow.tsx
git commit -m "feat(ui): PickRow component with tier badge"
```

---

## Task 25: `components/BoardSection.tsx`, `components/StatusBanner.tsx`

**Files:**
- Create: both

- [ ] **Step 1: Implement** — `BoardSection` takes `{ rung, picks }`, renders header + Tracked picks (🔥 above) + Watching picks (below). `StatusBanner` shows tracked count + lineup confirm time.

- [ ] **Step 2: Commit**

```bash
git add components/BoardSection.tsx components/StatusBanner.tsx
git commit -m "feat(ui): board section + status banner components"
```

---

## Task 26: `app/page.tsx` — main slate

**Files:**
- Modify: `app/page.tsx`
- Create: `components/ClientShell.tsx`

- [ ] **Step 1: ClientShell handles 5-min refresh, fetches `/api/picks`**

- [ ] **Step 2: page.tsx** — server component shell that initially fetches picks, hands to ClientShell

- [ ] **Step 3: Verify visually, commit**

```bash
git add app/page.tsx components/ClientShell.tsx
git commit -m "feat(ui): main slate page with 3 boards + auto-refresh"
```

---

## Task 27: `app/history/page.tsx` + chart components

**Files:**
- Create: `app/history/page.tsx`, `components/HistoryChart.tsx`, `components/CalibrationTable.tsx`, `app/api/history/route.ts`

- [ ] **Step 1: `/api/history` endpoint** — reads `picks:settled:*` keys, aggregates rolling 30-day stats per rung + Brier.

- [ ] **Step 2: Build the page with chart (recharts or hand-rolled SVG) + calibration table**

- [ ] **Step 3: Commit**

```bash
git add app/history/ app/api/history/ components/HistoryChart.tsx components/CalibrationTable.tsx
git commit -m "feat(ui): history page with rolling Tracked record + calibration"
```

---

## Task 28: `app/methodology/page.tsx`

**Files:**
- Create: `app/methodology/page.tsx`, `components/methodology/FactorCard.tsx`, `components/methodology/FormulaBlock.tsx`

- [ ] **Step 1: Static-ish page** explaining HRR rules, math overview, every factor, sources cited (link to MLB Stats, Statcast, Open-Meteo).

- [ ] **Step 2: Commit**

```bash
git add app/methodology/ components/methodology/
git commit -m "feat(ui): methodology page documenting all factors + sources"
```

---

# Phase 7 — Tracking Infrastructure

## Task 29: `lib/tracker.ts`

**Files:**
- Create: `lib/tracker.ts`
- Test: `__tests__/tracker.test.ts`

- [ ] **Step 1: TDD lock-trigger semantics** (earliest-wins per §5.4)

```ts
import { shouldLock } from '@/lib/tracker'

test('locks when lineup confirmed AND ≥ 90 min before first pitch', () => {
  expect(shouldLock({
    now: new Date('2025-07-04T22:00:00Z').getTime(),
    firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),  // 90 min later
    lineupStatus: 'confirmed',
  })).toBe(true)
})

test('does NOT lock for confirmed lineup if > 90 min remain', () => {
  expect(shouldLock({
    now: new Date('2025-07-04T20:00:00Z').getTime(),
    firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),  // 3.5h later
    lineupStatus: 'confirmed',
  })).toBe(false)
})

test('locks at 30 min before first pitch regardless of lineup status', () => {
  expect(shouldLock({
    now: new Date('2025-07-04T23:00:00Z').getTime(),
    firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
    lineupStatus: 'estimated',
  })).toBe(true)
})

test('does NOT lock at 31 min if lineup not confirmed', () => {
  expect(shouldLock({
    now: new Date('2025-07-04T22:59:00Z').getTime(),
    firstPitch: new Date('2025-07-04T23:30:00Z').getTime(),
    lineupStatus: 'estimated',
  })).toBe(false)
})
```

- [ ] **Step 2: Implement** — also export `snapshotLockedPicks(date, ranking)`, `settlePicks(date)` (boxscore lookup, mark HIT/MISS), `computeMetrics(rung, days)`.

- [ ] **Step 3: Commit**

```bash
git add lib/tracker.ts __tests__/tracker.test.ts
git commit -m "feat(lib): tracker with lock-trigger logic, snapshot, settle, metrics"
```

---

## Task 30: `app/api/lock/route.ts`

**Files:**
- Create: `app/api/lock/route.ts`

- [ ] **Step 1: Cron-callable endpoint** — iterates today's games, applies `shouldLock`, snapshots Tracked picks per game.

- [ ] **Step 2: Commit**

```bash
git add app/api/lock/
git commit -m "feat(api): /api/lock cron snapshots Tracked picks at lock trigger"
```

---

## Task 31: `app/api/settle/route.ts`

**Files:**
- Create: `app/api/settle/route.ts`

- [ ] **Step 1: Cron-callable endpoint at 3 AM Pacific** — pulls boxscore for previous day's games, computes actual H+R+RBI per player, marks each Tracked pick HIT/MISS.

- [ ] **Step 2: Commit**

```bash
git add app/api/settle/
git commit -m "feat(api): /api/settle cron settles previous-day Tracked picks from boxscore"
```

---

## Task 32: `scripts/recalibrate.ts` — manual audit tool

**Files:**
- Create: `scripts/recalibrate.ts`

- [ ] **Step 1: Standalone Node script** that reads settled history, computes Brier per rung + hit-rate-by-EDGE-bucket, suggests adjusted floor values.

- [ ] **Step 2: Commit**

```bash
git add scripts/recalibrate.ts
git commit -m "tools: scripts/recalibrate.ts audit tool for floor recalibration"
```

---

# Phase 8 — Deploy & Verification

## Task 33: Vercel project + KV provisioning

**Manual steps (require user):** the GitHub repo `lucasreydman/hrr-betting` already exists from Phase 0; no Vercel project exists yet.

- [ ] **Step 1:** From the repo root, `npx vercel link` → choose "Create new project" → name it `hrr-betting`. Or alternately import via Vercel dashboard ("Add New Project" → select GitHub repo `lucasreydman/hrr-betting`).
- [ ] **Step 2:** Provision Vercel KV via dashboard → "Storage" tab → "Create Database" → KV → attach to the `hrr-betting` project. Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars.
- [ ] **Step 3:** Verify env vars present in Project Settings → Environment Variables.
- [ ] **Step 4:** Upgrade Vercel team to **Pro** (required for `maxDuration: 60` and cron jobs). Free / Hobby caps `maxDuration` at 10s and does not run cron.
- [ ] **Step 5:** In Project Settings → Domains, alias the project to `hrr-betting.vercel.app` (Vercel reserves matching domain by default — confirm it's set).
- [ ] **Step 6:** Push to `main` to trigger first deploy. Verify build succeeds in Vercel dashboard.

## Task 34: Local end-to-end test

- [ ] **Step 1:** `npm run dev` with real MLB API + in-memory KV, hit `/api/picks?date=YYYY-MM-DD` for today's slate, verify 3 boards render with sane data
- [ ] **Step 2:** Manually run `/api/sim/[gameId]` for one game, verify response time + cached on second call
- [ ] **Step 3:** Manually trigger `/api/lock` and `/api/settle` paths

## Task 35: Production deploy + smoke test

- [ ] **Step 1:** `git push` (auto-deploys to Vercel)
- [ ] **Step 2:** Hit production URL: today's slate renders, picks API responds, `/methodology` displays correctly
- [ ] **Step 3:** Verify cron schedules registered in Vercel dashboard
- [ ] **Step 4:** Wait through one full settle cycle (game → lock → boxscore → settle)
- [ ] **Step 5:** Verify history page shows the first settled day's data

---

## Final commit + tag

```bash
git tag -a v0.1.0 -m "HRR Betting v0.1.0 - initial release"
git push origin v0.1.0
```

---

## Acceptance verification (per spec §9)

After v0.1.0 ships, run through the spec's acceptance criteria checklist. Any items still failing become follow-up tasks (separate plans, not v1 scope creep).

## Calibration kickoff (post-30-day)

After ~30 days of settled picks:
1. Run `scripts/recalibrate.ts` — produces suggested floor adjustments + weight schedule tweaks
2. Open separate spec/plan for calibration changes if non-trivial
3. If trivial (just floor tweaks), update `lib/constants.ts` directly with a calibration commit

---
