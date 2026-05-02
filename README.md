<p align="center">
  <img src="app/icon.png" alt="HRR Betting logo" width="120" />
</p>

<h1 align="center">HRR Betting</h1>

<p align="center">
  Daily MLB <strong>Hits + Runs + RBIs</strong> prop ranker with three independently-ranked rungs (1+, 2+, 3+ HRR), auto-tracked picks, and rolling calibration metrics.
</p>

---

## Overview

HRR Betting ranks every batter on the day's MLB slate against three player-prop rungs: 1+, 2+, and 3+ Hits + Runs + RBIs. Each rung is its own board; rows are scored by a Kelly-style fraction weighted by data-quality confidence.

The model is a **two-stage hybrid**:

1. **Offline Monte Carlo** (`probTypical`) — 20,000-iteration lineup-aware simulation per batter against a league-average opponent, recomputed weekly (Sunday full sweep) and nightly (Mon–Sat slate batters). Cached in Supabase for 14 days.
2. **Closed-form `probToday`** (request-time) — `probTypical × pitcherFactor × parkFactor × weatherFactor × handednessFactor × bullpenFactor × paCountFactor`. Sub-millisecond on the hot path so the page can stay on Vercel Hobby with no `maxDuration` overrides.

A "Tracked" tier (high-conviction picks gated by `EDGE` / probability / confidence floors) is locked at lineup-confirmation time and auto-settled the next morning from MLB boxscores. A `/history` page exposes hit rate and Brier score by rung over all settled history.

## Features

- Three independently-ranked rung boards (1+, 2+, 3+ HRR) sourced from a single slate.
- Hybrid ranking model with offline MC baseline + closed-form request-time factors.
- Auto-refresh: server cache 30 s, client polls every 60 s, instant refetch on tab focus / network reconnect.
- High-conviction "Tracked" picks auto-locked at lineup confirmation, auto-settled at 6 AM ET via MLB boxscore.
- `/history` dashboard with all-time hit rate, per-rung Brier score, predicted-vs-actual calibration, and recent settled picks.
- `/methodology` page that explains every factor and traces it back to the source code.
- Supabase-backed cache (`cache` table) replaces Vercel KV / Upstash; in-memory `Map` fallback for tests / dev with no env vars.
- GitHub Actions cron (free tier) drives baseline sims, slate refresh, lock checks, and daily settle — no Vercel cron needed.
- Strict input validation (`isValidIsoDate`, positive-integer ID checks) on every public + cron API route.
- ET 3 AM slate-rollover boundary applied uniformly via `slateDateString()`.
- Recalibration script (`npm run recalibrate`) for tuning Tracked-tier floors against ≥30 days of settled history.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS v4, dark theme, mobile-safe-area aware |
| Language | TypeScript 6 (strict mode) |
| Persistence | Supabase Postgres — `locked_picks`, `settled_picks`, `cache` (RLS on, service-role only) |
| Hot cache | `lib/kv.ts` over the Supabase `cache` table; in-memory `Map` fallback |
| Cron | GitHub Actions (free tier, ~50 min/month against 2,000 quota) |
| CI | GitHub Actions — lint · typecheck · test · build on every push and PR |
| Tests | Jest 30 + ts-jest, hermetic by default; live-network smoke tests opt-in via `RUN_LIVE_TESTS=1` |
| Hosting | Vercel Hobby (free), region `iad1` |
| External APIs (no auth) | MLB Stats API, Baseball Savant CSV, Open-Meteo (weather) |

## Project structure

```
.
├── app/                          # Next.js App Router
│   ├── api/                      # Public + cron-authed routes
│   │   ├── picks/                # GET — current slate boards
│   │   ├── history/              # GET — all-time + rolling settled metrics
│   │   ├── refresh/              # POST — invalidate + recompute (cron + UI button)
│   │   ├── lock/                 # GET — snapshot tracked picks at lineup time
│   │   ├── settle/               # GET — pull yesterday's boxscores + score picks
│   │   ├── sim/typical/          # POST — offline MC (mode: full | player)
│   │   ├── sim/typical-slate-ids # GET — list of batter IDs for slate-mode sim
│   │   └── admin/bvp/            # GET — diagnostic for batter-vs-pitcher cache
│   ├── history/                  # /history page
│   ├── methodology/              # /methodology page (static doc)
│   ├── icon.png · apple-icon.png · favicon.ico
│   ├── layout.tsx · page.tsx · globals.css
├── components/                   # NavBar, Board, PickRow, ClientShell, etc.
├── lib/
│   ├── factors/                  # Per-factor closed-form math (pitcher, park, weather, …)
│   ├── offline-sim/              # 20k-iter MC + baserunner state machine
│   ├── ranker.ts                 # Top-level scoring orchestrator
│   ├── prob-today.ts             # probTypical × factors composer
│   ├── p-typical.ts              # Cache reader + computeTypicalOffline()
│   ├── tracker.ts                # Lock + settle, pure metric helpers
│   ├── kv.ts · db.ts · env.ts    # Supabase + cache plumbing
│   ├── cron-auth.ts              # x-cron-secret check
│   ├── date-utils.ts             # slateDateString() — ET 3 AM rollover
│   └── …                         # mlb-api, savant-api, weather-api, lineup, etc.
├── __tests__/                    # Jest unit + adapter tests
├── scripts/recalibrate.ts        # Tracked-tier floor audit
├── supabase/migrations/          # SQL schema + cache invalidations
├── docs/
│   ├── DEPLOY.md                 # Manual deploy runbook
│   └── superpowers/              # Spec + plan + design docs
├── .github/workflows/
│   ├── ci.yml                    # lint · typecheck · test · build
│   └── cron.yml                  # sim · refresh · lock · settle schedules
├── next.config.ts · tsconfig.json · jest.config.mjs · eslint.config.mjs
└── vercel.json
```

`lib/` enforces a hard split: math files (`per-pa`, `edge`, `confidence`, `factors/*`, `weather-factors`, `park-factors`, `baserunner`) have **no I/O** and are deterministic + unit-testable. Data adapters (`mlb-api`, `savant-api`, `weather-api`, `lineup`, `slate-batters`, `p-typical`, `tracker`) handle caching through `lib/kv.ts`.

## Getting started

### Prerequisites

- **Node.js 22+** (matches CI; Next.js 16 requires ≥20)
- **npm** (a `package-lock.json` is committed)
- Optional for production parity: a Supabase project (free tier is enough)

### Install

```bash
git clone https://github.com/lucasreydman/hrr-betting.git
cd hrr-betting
npm install
```

### Run locally

```bash
npm run dev
```

Open http://localhost:3000. With no env vars set, `lib/db.ts` becomes a no-op and `lib/kv.ts` falls back to an in-memory `Map` — the app boots and the boards render against live MLB / Savant / weather data, without persistence between restarts. Cron-authed routes accept all callers in dev (see `lib/cron-auth.ts`).

### Production build

```bash
npm run build
npm run start
```

Production mode requires the env vars below. Without `CRON_SECRET`, the cron-authed routes fail closed (401) on Vercel.

## Environment variables

| Name | Required for | What it does |
| --- | --- | --- |
| `SUPABASE_URL` | Production | Supabase project URL. Without it, code falls back to in-memory KV (fine for dev/tests, not for prod). |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Server-only service-role key. Bypasses RLS on `cache` / `locked_picks` / `settled_picks`. **Never expose to the browser.** |
| `CRON_SECRET` | Production cron + GitHub Actions | Value of the `x-cron-secret` header that gates `/api/sim/*`, `/api/refresh`, `/api/lock`, `/api/settle`, `/api/admin/bvp`. Without it in production, those routes 401 every caller. |

`lib/env.ts` exports `sanitizeEnvValue` to strip whitespace and matched surrounding quotes — Vercel's UI sometimes wraps values in quotes while GitHub secrets don't, so both sides of the comparison are normalised.

A template lives at [`.env.example`](.env.example). Copy it to `.env.local` and fill in real values, or run `vercel env pull .env.local` once the Vercel project is linked.

## Available scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (Turbopack). KV in-memory fallback; Supabase no-op without env vars. |
| `npm run build` | Production build. Must stay green — gated in CI. |
| `npm run start` | Serve the production build. |
| `npm run lint` | ESLint over `app lib components scripts __tests__`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Jest unit suite (hermetic by default). |
| `npm run test:watch` | Jest in watch mode. |
| `npm run recalibrate` | `tsx scripts/recalibrate.ts` — Tracked-tier floor audit. Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and ≥30 days of settled history. |

Live-network smoke tests are opt-in: `RUN_LIVE_TESTS=1 npm test` (not run in CI).

## Main application flow

### Pages

| Path | Purpose |
| --- | --- |
| `/` | Today's slate — three rung boards. Server-rendered with `force-dynamic`; client polls `/api/picks` every 60 s. |
| `/history` | All-time hit rate, per-rung Brier score, predicted-vs-actual calibration, recent settled picks, "show all" link. |
| `/history/all` | Full settled-pick log. |
| `/methodology` | Static documentation of every factor and formula. |

### API routes

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/picks` | Public | Current slate's three boards. Server-side cache TTL 30 s. `?date=YYYY-MM-DD` for replays, `?nocache=1` to bypass. |
| `GET /api/history` | Public | All-time + per-rung settled metrics, plus most recent settled picks. |
| `GET /api/history/all` | Public | Full settled-pick history. |
| `POST /api/refresh` | `CRON_SECRET` (prod) | Invalidate `picks:current:{date}` and recompute. Hit by the every-2-min cron + UI Refresh button. |
| `GET /api/lock` | `CRON_SECRET` | Snapshot tracked picks into `locked_picks` once lineups are confirmed. Idempotent (UNIQUE constraint). |
| `GET /api/settle` | `CRON_SECRET` | Pull yesterday's boxscores, score every locked pick, write `settled_picks`. Idempotent. |
| `POST /api/sim/typical` | `CRON_SECRET` | Offline MC. `{mode: "full"}` fans out per-batter; `{mode: "player", playerId}` runs the 20k-iter sim and caches `typical:v1:{playerId}` for 14 d. |
| `GET /api/sim/typical-slate-ids` | `CRON_SECRET` | Returns the batter ID list for the next slate's sim warm. |
| `GET /api/admin/bvp` | `CRON_SECRET` | Diagnostic — returns batter-vs-pitcher record + cache state for one `(b, p)` pair. |

### Slate boundary

The slate cuts over at **3 AM ET** every day. `slateDateString()` (`lib/date-utils.ts`) is the only helper any caller should use to derive "today's slate" — `/api/picks`, `/api/lock`, `/api/settle`, `/api/sim/typical`, the home page, and the cron all go through it. `pacificDateString()` exists only for callers that genuinely want PT.

## Important implementation details

- **Math files have no I/O.** Pure functions are unit-tested in `__tests__/`. The split keeps `prob-today.ts`, `edge.ts`, `confidence.ts`, `per-pa.ts`, `factors/*`, `weather-factors`, `park-factors`, and `baserunner` deterministic.
- **Cache key versioning.** Bump the prefix (e.g. `hrr:lineup:` → `hrr:lineup:v2:`) when the **shape** of cached values changes so existing rows are forcibly re-fetched instead of serving stale data for the TTL window. Pair with a one-shot SQL migration in `supabase/migrations/` to free orphaned rows. There are already 11 such migrations on disk.
- **Edge formula.** `EDGE = max(P_matchup, 0.01) / max(P_typical, 0.01) − 1`. Symmetric floor on both sides prevents zero-collapse.
- **Statcast multiplier clamps.** `[0.25, 4]` before sqrt in `lib/per-pa.ts` to prevent zero-collapse on small samples.
- **Tracked tier locking.** `/api/lock` reads the `picks:current:{date}` cache when warm and falls back to a fresh `rankPicks(date)` when cold — without this fallback an empty cache silently dropped the entire slate's tracked picks (see comments in `app/api/lock/route.ts`).
- **History idempotency.** Both `locked_picks` and `settled_picks` upserts use `onConflict: 'date,game_id,player_id,rung'`, so re-runs are safe.
- **Cron auth.** `lib/cron-auth.ts` fails **closed** in production (no `CRON_SECRET` → 401) and **open** in dev (so `npm run dev` works without secrets).
- **Tracked-tier floors.** `EDGE_FLOORS`, `PROB_FLOORS`, `CONFIDENCE_FLOOR_TRACKED` in `lib/constants.ts` are placeholders; tune via `npm run recalibrate` after ≥30 days of settled history.

## Testing and quality checks

CI (`.github/workflows/ci.yml`) runs all four on every push and PR:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Test suite covers math primitives, adapters, and pure helpers in `lib/tracker.ts` (`shouldLock`, `computeRollingMetrics`). New math files **must** ship with a `__tests__/<name>.test.ts` alongside; new API routes need at least an input-validation test when no fetch mock is available. Tests are hermetic — no live network calls without `RUN_LIVE_TESTS=1`.

## Deployment

Hosted on **Vercel Hobby** (free tier) with persistence on **Supabase free tier** and cron driven by **GitHub Actions** (free on public repos). Full step-by-step is in [`docs/DEPLOY.md`](docs/DEPLOY.md). Key points:

- **Vercel** — link via `npx vercel link`, stay on Hobby (no `maxDuration` overrides needed; `probToday` is sub-ms on the request path). `vercel.json` is intentionally near-empty.
- **Supabase** — link via `npx supabase link --project-ref <ref>`, then `npx supabase db push` to apply every migration in `supabase/migrations/`. RLS on, no policies (service-role only).
- **GitHub Actions cron** — `.github/workflows/cron.yml` runs sim warm, refresh, lock, and settle on the schedules below. Set repo secrets `VERCEL_DEPLOY_URL` and `CRON_SECRET`. Free-tier jitter is 5–15 min, fine for an eventually-consistent refresh model.

### Cron schedule (UTC)

| Job | Cron | Local equivalent |
| --- | --- | --- |
| Full-population MC | `0 8 * * 0` | Sunday 4 AM ET |
| Slate-batter MC | `0 8 * * 1-6` | Mon–Sat 4 AM ET |
| Slate refresh | `*/2 17-23,0-7 * * *` | every 2 min, 1 PM ET → 3 AM ET |
| Lock check | `*/5 17-23,0-7 * * *` | every 5 min, 1 PM ET → 3 AM ET |
| Settle | `15 7 * * *` | 3:15 AM ET |

Manual trigger: GitHub → repo → Actions → "Cron — sim/lock/settle" → Run workflow → choose `lock` / `settle` / `refresh` / `typical-full` / `typical-slate`.

## Troubleshooting

- **`/api/picks` returns 500 in production with a Supabase error.** Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set on Vercel. Without them the code silently falls back to in-memory KV, which production won't have. Check Vercel function logs.
- **GitHub Actions cron returns `401 unauthorized`.** The `CRON_SECRET` GitHub Actions secret doesn't match the Vercel env var. Use the same value in both, then re-run the workflow.
- **`locked_picks` / `settled_picks` rows missing after a slate.** Inspect Vercel logs for `/api/lock` — it will report `no-lock` when lineups aren't confirmed yet or no game is in the lock window. The lock cron fires every 5 min during slate hours and is idempotent, so it eventually catches up.
- **`npx supabase db push` fails with auth error.** Re-run `npx supabase login` (token may have expired) and `npx supabase link --project-ref <ref>` again.
- **Offline MC times out.** `/api/sim/typical` runs up to 20k iterations per player. It's a cron-only path and never touches the request path. Reduce `TYPICAL_ITERATIONS` in `lib/constants.ts` or stick to slate-mode runs only if you blow GitHub Actions' minute budget.
- **Cache misses feel slow.** Each Supabase cache read is ~30–50 ms (vs Redis ~5 ms). The 30 s server cache on `/api/picks` masks this for most requests. If the hot path is bottlenecked, switching `lib/kv.ts` back to Upstash Redis is roughly a 30-min refactor.
- **Tests fail with network errors.** You probably set `RUN_LIVE_TESTS=1`. Unset it (or run `npm test` directly) for hermetic runs.

## Known limitations

These are intentional v1 simplifications, not bugs. Calibration target is ≥30 days of settled history.

- **Tracked-tier floors** (`lib/constants.ts`) are placeholders — run `npm run recalibrate`.
- **MISS vs VOID** — players who never entered the boxscore are scored MISS at 0 HRR; sportsbooks would void.
- **No L30/L15 batter rolling blend** in `buildBatterContext` — season stats only.
- **Pitcher TTO splits** use league-average multipliers; pitcher-specific TTO needs Savant pitch-level data.
- **Opener detection** is hardcoded to `'starter'` in the offline MC.
- **Switch hitters** get the L/R-average park factor; finer modelling would weight by the pitcher's hand for that PA.
- **Weather constants** are calibration targets — magnitudes are grounded in published research (Alan Nathan, Kovalchik), exact values to be tuned against settled history.
- **`/api/admin/bvp`** shares `CRON_SECRET` with the cron routes — fine for a single-user app; split if the surface grows.

## Contributing / workflow

1. Branch off `main`.
2. Keep math files I/O-free; data adapters cache through `lib/kv.ts`.
3. Add unit tests for any new math primitive (`__tests__/<name>.test.ts`); add input-validation tests for any new API route.
4. Run all four CI gates locally before pushing:

   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   ```

5. Open a PR against `main`. CI must pass.
6. When changing the **shape** of cached values, bump the cache key prefix and ship a one-shot SQL migration in `supabase/migrations/` to free orphaned rows.

## Spec, plan, and runbook

- Design spec: [`docs/superpowers/specs/2026-04-26-hrr-betting-design.md`](docs/superpowers/specs/2026-04-26-hrr-betting-design.md)
- Hybrid-ranking refactor design: [`docs/superpowers/specs/2026-04-28-hybrid-ranking-refactor-design.md`](docs/superpowers/specs/2026-04-28-hybrid-ranking-refactor-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-04-26-hrr-betting.md`](docs/superpowers/plans/2026-04-26-hrr-betting.md)
- Deploy runbook: [`docs/DEPLOY.md`](docs/DEPLOY.md)
- Methodology audit: [`docs/methodology-audit.md`](docs/methodology-audit.md)

## License

[ISC](LICENSE) — see the `LICENSE` file. Matches the `"license": "ISC"` declaration in `package.json`.
