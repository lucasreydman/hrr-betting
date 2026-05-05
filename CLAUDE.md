# CLAUDE.md

Short, repo-specific guidance for Claude. The README has the full picture — this file is the operating manual.

## Project Context

- MLB Hits + Runs + RBIs prop ranker. Three independently-ranked rungs (1+, 2+, 3+ HRR), auto-tracked picks, rolling calibration metrics.
- Hybrid model: an offline 20k-iter Monte Carlo (`probTypical`) cached in Supabase, multiplied at request time by **8 closed-form factors** composed on the odds scale — `pitcher · park · weather · handedness · bullpen · paCount · bvp · batter`.
- **Five-gate tracked tier**: `confidence ≥ 0.85`, `edge ≥ EDGE_FLOORS[rung]`, `p̂ today ≥ PROB_FLOORS[rung]`, `p̂ typical ≥ P_TYPICAL_FLOORS_TRACKED[rung]`, `score ≥ SCORE_FLOORS_TRACKED[rung]`. Picks lock at T-30 min before first pitch; live board surfaces three statuses (🔒 Tracking / 🎯 Targeting / 👀 Watching).
- Stack: Next.js 16 App Router (Turbopack), React 19, Tailwind v4, TypeScript 6 (strict), Jest 30 + ts-jest, Supabase Postgres.
- Hosted on Vercel Hobby; cron driven by GitHub Actions (free tier).

## Commands

Run from repo root.

| Command | Purpose |
| --- | --- |
| `npm install` | Install deps. |
| `npm run dev` | Next dev server. Works without env vars (in-memory KV, Supabase no-op). |
| `npm run build` | Production build. Must stay green. |
| `npm run start` | Serve the production build. |
| `npm run lint` | ESLint over `app lib components scripts __tests__`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Jest unit suite (hermetic). |
| `npm run test:watch` | Jest watch mode. |
| `npm run recalibrate` | `tsx scripts/recalibrate.ts` — Tracked-tier floor audit. Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and ≥30 days of settled history. |

Live-network smoke tests are opt-in: `RUN_LIVE_TESTS=1 npm test` (not in CI).

## Codebase Structure

- `app/` — Next.js App Router. Pages (`/`, `/history`, `/history/all`, `/methodology`) and API routes under `app/api/`.
- `components/` — UI building blocks (Board, PickRow, ClientShell, NavBar, CalibrationTable, …).
- `lib/factors/` — closed-form per-factor math (pitcher, park, weather, handedness, bullpen, paCount, batter, bvp).
- `lib/offline-sim/` — 20k-iter MC + baserunner state machine (cron-only path).
- `lib/ranker.ts` · `lib/prob-today.ts` · `lib/p-typical.ts` · `lib/edge.ts` — scoring pipeline.
- `lib/tracker.ts` — lock + settle, plus pure metric helpers (`shouldLock`, `computeRollingMetrics`).
- `lib/kv.ts` · `lib/db.ts` · `lib/env.ts` · `lib/cron-auth.ts` — Supabase + cache plumbing + `x-cron-secret` check.
- `lib/discord.ts` — Discord webhook notifier. Pure embed builders + thin POST wrapper. Idempotent via `locked_picks.discord_notified_at` (per-game lock alerts) and a KV flag (per-day settle digest).
- `lib/board-csv.ts` — flat one-row-per-pick CSV serializer used by the board's "Export CSV" button. Wide format (~60 columns) for off-line triage of the model's per-pick inputs.
- `scripts/cleanup-failing-locked-picks.ts` — one-shot tool to drop `locked_picks` rows whose snapshot fails current floors after a retroactive floor change. Documented playbook for the 2026-05-05 5-gate rollout.
- `lib/date-utils.ts` — `slateDateString()` (ET 3 AM rollover, the slate helper).
- `__tests__/` — Jest tests; one alongside each math primitive.
- `supabase/migrations/` — schema + one-shot cache invalidations.
- `.github/workflows/{ci,cron}.yml` — CI gates and cron schedule.
- `docs/DEPLOY.md` — deploy runbook. `docs/superpowers/` — spec + plan.

## Development Rules

- **Math files have no I/O.** `factors/*`, `prob-today`, `edge`, `confidence`, `weather-factors`, `park-factors`, `stabilization`, `rates`, `bet-sizing`, `offline-sim/{sim,baserunner}` are pure + unit-tested. Don't add fetches.
- **Data adapters cache through `lib/kv.ts`.** Cache keys live with the function that owns them.
- **Bump cache key prefix on shape changes.** Versioned prefixes (`hrr:lineup:` → `hrr:lineup:v2:`) force re-fetch instead of serving stale TTL data. Pair with a one-shot SQL migration in `supabase/migrations/` to free orphaned rows.
- **Slate boundary is ET 3 AM.** Use `slateDateString()` everywhere — `/api/picks`, `/api/lock`, `/api/settle`, `/api/sim/typical`, `app/page.tsx`. Never hardcode UTC `today`. `pacificDateString()` exists only for callers that genuinely want PT.
- **API input validation is strict.** All `?date=` go through `isValidIsoDate`. All IDs must be positive integers. Bad input → 400.
- **Cron routes 401 on bad secret.** `verifyCronRequest` fails closed in production, opens in dev.
- **Picks history is idempotent.** `locked_picks` / `settled_picks` upserts use `onConflict: 'date,game_id,player_id,rung'`.
- **Tracked-tier floors are placeholders.** All five floors in `lib/constants.ts` (`CONFIDENCE_FLOOR_TRACKED`, `EDGE_FLOORS`, `PROB_FLOORS`, `P_TYPICAL_FLOORS_TRACKED`, `SCORE_FLOORS_TRACKED`) need ≥30 days of settled history before tuning. Use `npm run recalibrate`. The `classifyTier` contract in `lib/ranker.ts` is locked by `__tests__/classify-tier.test.ts` — update that suite when changing gate logic.
- **Auto-refresh cadence.** Server cache 30 s; client polls every 60 s + on `visibilitychange`/`online`. Don't push lower without raising cron cadence.
- **New math primitive → unit test alongside.** New API route → at least an input-validation test.

## Environment Variables

Copy `.env.example` to `.env.local` for production-parity dev. Without these, dev still boots: KV falls back to in-memory; Supabase calls become no-ops; cron auth opens.

| Name | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL. Read in `lib/db.ts`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key. Bypasses RLS. **Server-only — never expose to the browser.** |
| `CRON_SECRET` | Value of the `x-cron-secret` header on cron routes. Read in `lib/cron-auth.ts`. |
| `DISCORD_WEBHOOK_URL` (optional) | Discord channel webhook. When set, `/api/lock` posts an embed per game with newly-locked tracked picks, and `/api/settle` posts a daily digest. Unset → notifier no-ops. Read in `lib/discord.ts`. |
| `DISCORD_LOCK_MENTION` (optional) | Mention prepended to lock messages so phone push-notifications fire (Discord channels default to "@mentions only"). Defaults to `@everyone`. Set to `@here`, `<@USER_ID>`, or empty string to override. |
| `RUN_LIVE_TESTS` (optional) | Set to `1` to opt into live-network smoke tests. |

`lib/env.ts` exports `sanitizeEnvValue` to strip whitespace + matched surrounding quotes — Vercel sometimes wraps values, GitHub secrets don't, so both sides are normalised.

## Cron / Automation

`.github/workflows/cron.yml` runs against the deployed Vercel URL. All UTC. ET conversions assume EDT (in effect during MLB season).

| Job | Cron (UTC) | ET equivalent |
| --- | --- | --- |
| Settle | `15 7 * * *` | 3:15 AM ET |
| Typical sim — full population | `0 8 * * 0` | Sunday 4 AM ET |
| Typical sim — slate batters | `0 8 * * 1-6` | Mon–Sat 4 AM ET |
| Slate refresh | `*/2 17-23 * * *` and `*/2 0-7 * * *` | every 2 min, 1 PM ET → 3 AM ET |
| Lock check | `*/5 17-23 * * *` and `*/5 0-7 * * *` | every 5 min, 1 PM ET → 3 AM ET |

GitHub free-tier cron has 5–15 min jitter — fine for this eventually-consistent refresh model. Manual dispatch: GitHub → Actions → "Cron — sim/lock/settle" → Run workflow.

## Testing / Quality Checks

After any change, before claiming done:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Same four gates CI runs (`.github/workflows/ci.yml`). All four must pass.

## Common Pitfalls

- **Production missing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.** Code silently falls back to in-memory KV — no errors, but no data either. Verify on Vercel.
- **Production missing `CRON_SECRET`.** Cron routes 401 every caller. GitHub Actions secret and Vercel env var must hold the same value.
- **Cache-shape change without prefix bump.** Stale entries served until TTL expires. Bump prefix + ship a SQL invalidation migration.
- **Hardcoding UTC `today` for slate work.** Use `slateDateString()`. Slate boundary is 3 AM ET.
- **Editing generated files.** `.next/`, `*.tsbuildinfo`, `next-env.d.ts`, `node_modules/`, `coverage/` are gitignored — never commit.
- **Drift between docs and config.** When changing `package.json` scripts, env var names, cron schedule, or API route shapes, update `README.md`, `CLAUDE.md`, `.env.example`, and `docs/DEPLOY.md` in the same change.
- **Adding live-network calls in tests.** Tests must be hermetic by default. Gate live calls on `RUN_LIVE_TESTS=1`.

## Change Guidelines

- Small, focused diffs. Don't bundle unrelated cleanup.
- Preserve existing behaviour unless explicitly asked to change it.
- Don't add dependencies without a clear reason — the dep tree is intentionally tiny.
- Don't expose service-role secrets to the browser. Anything client-bundled is public.
- Update related docs in the same change when behaviour changes.

## Before Finishing

- Run `npm run lint && npm run typecheck && npm test && npm run build` and confirm green.
- If you can't run a check (missing env vars, sandbox limits), say so explicitly — don't claim it passed.
- Summarise what changed and which files were touched.
