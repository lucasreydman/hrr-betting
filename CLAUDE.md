# HRR Betting — CLAUDE.md

## Project context

MLB Hits + Runs + RBIs prop ranker with three rungs (1+, 2+, 3+). Per-PA Monte Carlo
sim with hybrid log-5 + Statcast outcome distribution. Replay-the-season `P_typical`
denominator. Tracked picks (high-conviction tier) auto-settle from boxscore.

## Architecture

- `app/` — Next.js App Router. Three pages (`/`, `/history`, `/methodology`) and five
  API routes (`picks`, `sim` orchestrator, `sim/[gameId]`, `lock`, `settle`, `history`).
- `lib/` — pure math + data adapters. Math files have NO I/O; data files handle
  caching against KV (hot data) or Supabase (persistent picks history).
- `components/` — UI building blocks.
- `__tests__/` — Jest unit tests for math primitives.
- `supabase/migrations/` — Postgres schema (locked_picks, settled_picks).
- `.github/workflows/cron.yml` — GitHub Actions cron (replaces Vercel cron, free).

## Stack

- **Runtime**: Next.js 16 App Router · React 19 · Tailwind v4 · TypeScript · Jest
- **Persistence**: Supabase Postgres (everything — `cache` table for hot caches, `locked_picks`/`settled_picks` for history)
- **Cron**: GitHub Actions (free on public repos)
- **Hosting**: Vercel **Hobby** (free tier — no Pro upgrade needed; sim runs in <10s)
- **APIs**: MLB Stats, Baseball Savant CSV, Open-Meteo (all free, no auth)

## Storage model

| What | Table | Why |
|---|---|---|
| Sim results, P_typical, weather, Savant CSVs, TTO, bullpen | `cache` | Hot key-value cache with TTL — replaces Vercel KV / Upstash |
| Locked + settled picks | `locked_picks` / `settled_picks` | History queries (rolling 30-day, recalibration) want SQL |

All three live in Supabase. `lib/db.ts` exposes `getSupabase()` (returns null in
dev when env vars missing). `lib/kv.ts` keeps the historical `kvGet/kvSet/kvDel`
API for backward compatibility — under the hood it now reads/writes the
`cache` table via the Supabase client, with an in-memory Map fallback for
tests/local dev.

## Critical files

- `lib/sim.ts` — the lineup-aware Monte Carlo. Heart of the model.
- `lib/per-pa.ts` — log-5 + Statcast hybrid 7-outcome distribution.
- `lib/edge.ts` — `EDGE = P_matchup / max(P_typical, 0.01) − 1`.
- `lib/tracker.ts` — lock snapshot + settlement (writes to Supabase, KV fallback).
- `lib/cron-auth.ts` — `x-cron-secret` header check for cron-triggered routes.
- `app/api/sim/route.ts` — orchestrator that fire-and-forgets per-game sims.
- `supabase/migrations/20260426000000_initial_schema.sql` — schema.

## Commands

- `npm run dev` — local dev (KV in-memory fallback; Supabase no-op without env vars)
- `npm run build` — production build (must stay green)
- `npm test` — run unit tests
- `npx supabase db push` — apply migrations to remote Supabase project (after `supabase link`)
- `npx tsx scripts/recalibrate.ts` — manual audit tool, run after ~30 days of settled history

## Spec & plan

- Spec: `docs/superpowers/specs/2026-04-26-hrr-betting-design.md`
- Plan: `docs/superpowers/plans/2026-04-26-hrr-betting.md`
- Deploy runbook: `docs/DEPLOY.md`
