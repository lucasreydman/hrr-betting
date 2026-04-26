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
