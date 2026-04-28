# HRR Betting — MLB Hits + Runs + RBIs Prop Model

A standalone MLB betting tool that ranks the best **Hits + Runs + RBIs** prop plays for the day across three rungs (1+, 2+, 3+ HRR). Each rung is its own independently-ranked board. Picks above the per-rung floors are auto-tracked, settled from the boxscore the next morning, and surfaced on a calibration history page.

**Live (planned):** [hrr-betting.vercel.app](https://hrr-betting.vercel.app)

**Companion projects:**
- [bvp-betting](https://bvp-betting.vercel.app) — Player Hits 1+ prop based on career batter-vs-pitcher splits
- [bet-yrfi](https://bet-yrfi.vercel.app) — Yes Run First Inning
- [bet-nrfi](https://bet-nrfi.vercel.app) — No Run First Inning

---

## What it does

For each player on the day's slate, the model:

1. **Offline (cron):** Runs a lineup-aware 20k-iter Monte Carlo simulation against a synthetic league-average opponent to compute a stable per-player `probTypical` baseline (`lib/offline-sim/sim.ts`). Refreshed weekly (full population) and nightly (slate batters).
2. **At request time (closed-form):** Evaluates `probToday = probTypical × pitcherFactor × parkFactor × weatherFactor × handednessFactor × bullpenFactor × paCountFactor` in sub-millisecond time (`lib/prob-today.ts`). No per-request Monte Carlo.
3. Computes `P(HRR ≥ N)` for each rung from `probToday`.
4. Compares to `probTypical` → **EDGE** = `max(probToday, ε) / max(probTypical, ε) − 1`.
5. Multiplies by a **confidence factor** (lineup confirmation, BvP sample, recent-pitcher-start sample, weather stability, time-to-first-pitch, opener flag) → **SCORE = EDGE × confidence**.
6. Ranks per-rung and tags **Tracked** picks (must clear all three: confidence ≥ 0.85, per-rung EDGE floor, per-rung probability floor).
7. Auto-settles picks from the boxscore the next morning. Tracks rolling 30-day hit rate + Brier score per rung.

---

## Pages

- **`/`** — today's slate (ET, 3 AM rollover), three boards (1+, 2+, 3+), ranked by SCORE. Auto-refreshes every 60 s while the tab is visible, plus instant refresh on tab focus / network reconnect. Manual Refresh button forces a cache-bypassed reload. No date navigator — past slates live on /history.
- **`/history`** — rolling 30-day Tracked record, per-rung calibration table, daily activity bar chart, recent settled picks.
- **`/methodology`** — full math, every factor, all sources cited.

---

## API endpoints

All routes live under `app/api/`. `picks` and `history` are public reads; the rest require an `x-cron-secret` header that matches the `CRON_SECRET` env var.

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/picks?date=YYYY-MM-DD` | public | Ranked picks for the slate. 30 s server-side cache; client polls every 60 s and on visibility-change. Default date = today's slate (ET 3 AM rollover). |
| `GET /api/history` | public | 30-day calibration + recent settled picks. |
| `POST /api/sim/typical` | cron | Runs the offline 20k-iter Monte Carlo for full population or slate batters, storing `probTypical` baselines in cache. |
| `GET /api/sim/typical-slate-ids` | cron | Returns batter IDs appearing on tomorrow's slate for targeted offline MC. |
| `POST /api/refresh` | cron | Refreshes lineup, weather, and probable pitcher data for today's slate without re-running the MC. |
| `GET /api/lock` | cron | Snapshots tracked picks into `locked_picks` when any game is in its lock window. |
| `GET /api/settle` | cron | Pulls boxscores for yesterday's `locked_picks` and writes outcomes to `settled_picks`. |
| `GET /api/admin/bvp?b=X&p=Y` | cron | Diagnostic: shows the cached + fresh BvP record for a (batter, pitcher) pair. |

All `?date=` params are validated as strict `YYYY-MM-DD` (no malformed strings or impossible dates) before they reach MLB Stats URLs or cache keys. All player/game IDs must be positive integers.

---

## Stack

- **Framework**: Next.js 16 App Router (Turbopack) · React 19 · Tailwind v4 · TypeScript 6 (strict)
- **Persistence**: Supabase Postgres
  - `cache` table — JSONB key/value hot cache (sim results, P_typical, schedules, lineups, weather, Savant CSVs). Replaces Vercel KV / Upstash.
  - `locked_picks` / `settled_picks` — durable history with `UNIQUE(date, game_id, player_id, rung)` for idempotent upserts.
  - All three tables have RLS enabled with no policies → service-role-only access.
  - In-memory `Map` fallback when env vars are unset, so dev and tests run hermetically.
- **Slate boundary**: ET, rolls over at 3 AM ET — the standard DFS / sportsbook convention. A 10 PM PT game starting on April 26 (which finishes ~2 AM ET on April 27) still belongs to the April 26 slate. See `lib/date-utils.ts:slateDateString()`.
- **Cron**: GitHub Actions (`.github/workflows/cron.yml`) — offline MC weekly/nightly, slate-refresh every 2 min and lock every 5 min during slate hours (17–07 UTC), settle once daily at 10 UTC (6 AM ET). Free on public repos (~50 min/month vs 2,000 min/month quota).
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) — lint, typecheck, test, build on every push and PR.
- **Hosting**: Vercel Hobby (free); closed-form `probToday` is sub-millisecond on the request path; offline MC (20k iters) runs in the cron, well outside the 10 s function budget.
- **External APIs (no auth)**: MLB Stats, Baseball Savant CSV, Open-Meteo.
- **Test runner**: Jest 30 + ts-jest. ~118 unit tests + ~19 live-network smoke tests gated on `RUN_LIVE_TESTS=1`.

---

## Local development

```bash
# Clone and install
git clone https://github.com/lucasreydman/hrr-betting.git
cd hrr-betting
npm install

# Run the dev server (Supabase env vars optional; in-memory fallback works fine)
npm run dev          # http://localhost:3000
```

The app gracefully degrades when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are unset — `lib/kv.ts` falls back to an in-memory `Map`, and `lib/db.ts` returns `null` from `getSupabase()`. You can browse all three pages without any external services.

### Required environment variables (production)

| Var | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Vercel + local `.env.local` (optional in dev) | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + local `.env.local` (optional in dev) | Server-side service role; bypasses RLS. **Never expose to the browser.** |
| `CRON_SECRET` | Vercel + GitHub Actions secret | Shared secret for `x-cron-secret` header on cron-only routes. |

### Available scripts

| Command | What |
| --- | --- |
| `npm run dev` | Next dev server with Turbopack. |
| `npm run build` | Production build. Must stay green on `main`. |
| `npm run start` | Serve a built app locally. |
| `npm test` | Jest unit tests (live tests skipped). |
| `npm run test:watch` | Jest in watch mode. |
| `npm run lint` | ESLint over `app lib components scripts __tests__`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run recalibrate` | Tracked-tier floor recalibration audit (requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and ≥ 30 days of settled history). |

### Live-network tests

`__tests__/{mlb-api,savant-api,weather-api,p-typical}.test.ts` contain integration tests gated on `RUN_LIVE_TESTS=1`:

```bash
RUN_LIVE_TESTS=1 npm test
```

These hit MLB Stats / Baseball Savant / Open-Meteo. They are *not* run in CI to keep the pipeline hermetic.

---

## Deployment

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full Vercel + Supabase + GitHub Actions runbook.

Quick summary:
1. `npx supabase link` and `npx supabase db push` to apply migrations.
2. Set the three env vars above on Vercel + GitHub Actions secrets.
3. `git push origin main` — Vercel auto-deploys.
4. Manually trigger the first sim cron run from the GitHub Actions tab.

---

## Validation

Before merging anything to `main`, all of the following must pass — CI enforces them:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

---

## Caveats

- **Calibration is in-flight.** EDGE / PROB / CONFIDENCE floors in `lib/constants.ts` are placeholders pending ≥ 30 days of settled history. Re-run `npm run recalibrate` post-launch to tune them.
- **Live-network tests** are intentionally gated; CI does not exercise external services.
- **Cron timing** has 5–15 min jitter on the GitHub Actions free tier — fine for an eventually-consistent refresh, not for hard real-time triggers.
- **Auto-refresh propagation.** Worst-case time from a fresh slate-refresh landing in cache to the user seeing it ≈ 30 s server-cache + 60 s client-poll = 90 s. The slate-refresh cron fires every 2 min; polling more aggressively won't surface new data faster.

---

## Spec & docs

- Full design spec: [`docs/superpowers/specs/2026-04-26-hrr-betting-design.md`](docs/superpowers/specs/2026-04-26-hrr-betting-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-04-26-hrr-betting.md`](docs/superpowers/plans/2026-04-26-hrr-betting.md)
- Deploy runbook: [`docs/DEPLOY.md`](docs/DEPLOY.md)
- Project conventions for future Claude Code sessions: [`CLAUDE.md`](CLAUDE.md)
