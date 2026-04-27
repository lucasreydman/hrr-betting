# HRR Betting — CLAUDE.md

## Project context

MLB Hits + Runs + RBIs prop ranker with three rungs (1+, 2+, 3+). Per-PA Monte
Carlo sim with hybrid log-5 + Statcast outcome distribution. `P_typical`
denominator runs the player's own stabilised season rates against synthetic
league-average opponents at each slot they've batted in this season (v1
simplification of the spec's full replay-the-season approach). Tracked picks
(high-conviction tier) auto-settle from boxscore.

## Architecture

- `app/` — Next.js App Router. Three pages (`/`, `/history`, `/methodology`)
  and seven API routes:
  - Public: `picks`, `history`
  - Cron-authed: `sim` (orchestrator), `sim/[gameId]` (per-game), `lock`,
    `settle`, `admin/bvp` (diagnostic)
- `lib/` — pure math + data adapters. Math files have NO I/O; data files
  handle caching against the Supabase `cache` table or the in-memory fallback.
- `components/` — UI building blocks (`NavBar`, `ClientShell`, `BoardSection`,
  `PickRow`, `StatusBanner`, `CalibrationTable`, `HistoryChart`, `EmptyState`).
- `__tests__/` — Jest unit tests for math primitives + adapters. Live
  smoke tests gated on `RUN_LIVE_TESTS=1`.
- `supabase/migrations/` — Postgres schema (`locked_picks`, `settled_picks`,
  `cache`) and one-shot cache invalidations.
- `.github/workflows/cron.yml` — GitHub Actions cron (sim warm + lock + settle).
- `.github/workflows/ci.yml` — lint / typecheck / test / build on every PR.

## Stack

- **Runtime**: Next.js 16 App Router (Turbopack) · React 19 · Tailwind v4 · TypeScript 6 (strict) · Jest 30 + ts-jest
- **Persistence**: Supabase Postgres (cache + history). RLS on, service-role-only.
- **Cron**: GitHub Actions free tier (~50 min/month against a 2,000 min quota).
- **CI**: GitHub Actions — every push and PR runs lint / typecheck / test / build.
- **Hosting**: Vercel Hobby (free); 1,000-iter sim runs in ~500 ms (10 s budget).
- **External APIs (no auth)**: MLB Stats, Baseball Savant CSV, Open-Meteo.

## Storage model

| What | Table | Why |
|---|---|---|
| Sim results, P_typical, weather, Savant CSVs, TTO, bullpen, schedules, lineups | `cache` | Hot key/value cache with TTL — replaces Vercel KV / Upstash. JSONB. |
| Locked + settled picks | `locked_picks` / `settled_picks` | History queries (rolling 30-day, recalibration) want SQL. UNIQUE(date, game_id, player_id, rung). |

`lib/db.ts` exposes `getSupabase()` (returns `null` when env vars missing).
`lib/kv.ts` keeps the historical `kvGet/kvSet/kvDel` API — under the hood it
reads/writes the `cache` table via Supabase, with an in-memory `Map` fallback
for tests/dev.

## Critical files

- `lib/sim.ts` — the lineup-aware Monte Carlo. Heart of the model.
- `lib/per-pa.ts` — log-5 + Statcast hybrid 7-outcome distribution. Statcast multipliers clamped to `[0.25, 4]` before sqrt to prevent zero-collapse.
- `lib/edge.ts` — `EDGE = max(P_matchup, 0.01) / max(P_typical, 0.01) − 1`. Symmetric floor on both sides.
- `lib/p-typical.ts` — player-specific typical-game distribution. Target uses stabilised season rates; opponents stay league-avg.
- `lib/tracker.ts` — lock snapshot + settlement (writes to Supabase, KV fallback).
- `lib/cron-auth.ts` — `x-cron-secret` header check for cron-triggered routes.
- `lib/date-utils.ts` — `pacificDateString()` (IANA tz), `shiftIsoDate`, `isValidIsoDate`. Use these everywhere a slate date is needed.
- `app/api/sim/[gameId]/route.ts` — orchestrator that materialises sim contexts and runs the Monte Carlo.
- `supabase/migrations/20260426000000_initial_schema.sql` — schema.

## Commands

| Command | What |
| --- | --- |
| `npm run dev` | Next dev server (KV in-memory fallback; Supabase no-op without env vars). |
| `npm run build` | Production build (must stay green). |
| `npm test` | Jest unit tests. |
| `npm run lint` | ESLint over `app lib components scripts __tests__`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run recalibrate` | Tracked-tier floor audit (`scripts/recalibrate.ts`). Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and ≥ 30 days of settled history. |
| `npx supabase db push` | Apply migrations to remote Supabase project (after `supabase link`). |
| `RUN_LIVE_TESTS=1 npm test` | Run live-network smoke tests (MLB / Savant / weather / p-typical). |

## Validation checklist (before any commit/merge)

CI runs all four. Local equivalents:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Environment variables

| Name | Required for | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Production | Without it, code falls back to in-memory KV (works for dev/tests). |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Server-only. Bypasses RLS. **Never expose to the browser.** |
| `CRON_SECRET` | Production cron + GitHub Actions secret | `x-cron-secret` header check. Without it, cron routes accept all callers (dev-mode bypass in `lib/cron-auth.ts`). |

`lib/env.ts` exports `sanitizeEnvValue` to strip whitespace and matched
surrounding quotes from env values — Vercel and `.env` files both sometimes
wrap values, this normalises both.

## Coding conventions

- **Math files have NO I/O.** Pure functions, deterministic, unit-testable. (`per-pa`, `edge`, `confidence`, `baserunner`, `rates`, `stabilization`, `bullpen` weights.)
- **Data adapters cache through `lib/kv.ts`.** Cache keys live in the function that owns them (e.g. `hrr:lineup:{gameId}:{teamId}:{side}`); never share keys across modules.
- **Date handling: always Pacific for slates.** UTC is a footgun — late-night PT games cross midnight UTC mid-slate. Use `lib/date-utils.ts` helpers for any user-facing slate boundary.
- **API input validation: strict.** All `?date=` params go through `isValidIsoDate`; all IDs must be positive integers.
- **Cron routes 401 on bad secret, 400 on bad input.** Never silently accept malformed input.
- **Picks history is idempotent.** `locked_picks` / `settled_picks` upserts use `onConflict: 'date,game_id,player_id,rung'`. Re-runs are safe.
- **Tracked tier floors are placeholders.** `EDGE_FLOORS`, `PROB_FLOORS`, `CONFIDENCE_FLOOR_TRACKED` in `lib/constants.ts` need ≥ 30 days of settled history before they can be tuned. Don't tune from gut feel.

## Testing expectations

- New math primitives → unit test alongside (`__tests__/<name>.test.ts`).
- New API routes → at minimum an input-validation test if no fetch mock is available.
- Tests must be hermetic — no live network calls without `RUN_LIVE_TESTS=1`.
- Pure functions in `lib/tracker.ts` (`shouldLock`, `computeRollingMetrics`) have explicit tests; preserve that pattern when adding new pure helpers.

## Cron schedule (UTC)

- `*/5 17-23 * * *` and `*/5 0-6 * * *` — sim warm + lock check (every 5 min during slate hours).
- `0 10 * * *` — settle (3 AM Pacific / 2 AM PST).
- 5–15 min jitter on GitHub Actions free tier; fine for eventually-consistent refresh.

## Known limitations / follow-ups

These are intentional v1 simplifications, not bugs. Calibration target: post ≥ 30 days of settled history.

- **Tracked-tier floors** (`lib/constants.ts`) are placeholders. Run `npm run recalibrate` to tune.
- **MISS vs VOID outcome.** Players who didn't enter the boxscore are recorded as MISS with 0 HRR; sportsbooks would void. Tracking-accuracy implications acknowledged but no schema migration shipped.
- **No L30/L15 batter rolling blend** in `buildBatterContext` — season stats only.
- **Pitcher TTO splits** use league-average multipliers; pitcher-specific TTO requires Savant pitch-level data.
- **Opener detection** is hardcoded to `'starter'` in the sim route; needs Savant pitch-by-pitch data.
- **Park factors** are HR-only (1.00 for non-HR outcomes); per-handedness park factors deferred.
- **`/api/admin/bvp`** is gated on the same `CRON_SECRET` as cron routes — fine for a personal-scope project; split if surface widens.

## Spec & plan

- Spec: `docs/superpowers/specs/2026-04-26-hrr-betting-design.md`
- Plan: `docs/superpowers/plans/2026-04-26-hrr-betting.md`
- Deploy runbook: `docs/DEPLOY.md`
