# HRR Betting — Deployment Runbook

This is the manual-action checklist for taking the codebase from "v0.1.0-rc1 on `main`" to "live at `hrr-betting.vercel.app`."

**Current state:** all 32 code tasks complete, build/lint/tests clean, pushed to `main`. The only remaining steps are external infrastructure (Vercel project + KV + domain) which require dashboard access.

---

## Phase 8 / Task 33 — Vercel project setup

### 1. Link the repo to Vercel

From the repo root in your terminal:

```bash
cd C:/Users/lucas/dev/hits-runs-rbis
npx vercel link
```

When prompted: "Set up and deploy?" → **Yes** → "Create new project?" → **Yes** → name it **`hrr-betting`** → confirm scope (your personal Vercel team).

**Alternative (dashboard):** go to vercel.com/new → Import Git Repository → select `lucasreydman/hrr-betting` → name it `hrr-betting`.

### 2. Provision Vercel KV

Dashboard → your project (`hrr-betting`) → **Storage** tab → **Create Database** → **KV** → attach to the `hrr-betting` project. Vercel auto-injects:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

Verify in Project Settings → **Environment Variables** that these three are present in the Production scope.

### 3. Upgrade to Vercel Pro

**Required.** The Hobby tier caps `maxDuration` at 10s and does not run cron jobs. The sim endpoint needs `maxDuration: 60`.

Settings → Plan → Upgrade to Pro ($20/mo as of 2025).

### 4. Domain alias

Settings → **Domains**. By default Vercel assigns `hrr-betting.vercel.app` because the project name matches. Verify it's listed; if not, add it manually.

If you want a custom domain later (e.g. `hrr.lucasreydman.com`), add it here too.

### 5. First deploy

After steps 1-4 are complete:

```bash
git push origin main  # if not already pushed
```

Or trigger from dashboard. The build should:
- Compile Next.js
- Bundle all routes (verify in build output: `/`, `/history`, `/methodology`, `/api/picks`, `/api/sim`, `/api/sim/[gameId]`, `/api/lock`, `/api/settle`, `/api/history`)
- Static-generate `/methodology`

If the build fails, check Vercel logs.

### 6. Verify cron jobs registered

Dashboard → **Cron Jobs** tab. Should show 5 schedules:
| Path | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/sim` | `*/5 14-23 * * *` | Sim prewarm (afternoon-evening UTC) |
| `/api/sim` | `*/5 0-6 * * *` | Sim prewarm (early morning UTC, evening Pacific) |
| `/api/lock` | `*/5 14-23 * * *` | Lock-trigger check |
| `/api/lock` | `*/5 0-6 * * *` | Lock-trigger check (continued) |
| `/api/settle` | `0 10 * * *` | Daily settle at 3 AM Pacific (10 UTC) |

If they're missing, the `vercel.json` config didn't deploy — check for typos.

---

## Phase 8 / Task 34 — Local end-to-end test (optional but recommended before relying on production)

### 1. Run dev server with real MLB data

```bash
npm run dev
```

Note: locally there's no Vercel KV, so the in-memory fallback is used. Cache TTLs apply but caches reset on every restart.

### 2. Hit `/api/picks` for today

Pick a date during MLB regular season (April-October):

```bash
curl 'http://localhost:3000/api/picks?date=2025-07-04' | head -100
```

Expected: JSON `PicksResponse` with `rung1`, `rung2`, `rung3` arrays. May be empty on early calls — the simulator runs lazily; `gamesWithoutSim` will list game IDs that need warming.

### 3. Warm a game manually

Pick a `gameId` from today's MLB schedule and trigger the sim:

```bash
curl 'http://localhost:3000/api/sim/{gameId}?date=2025-07-04'
```

Should complete in 5-15 seconds (10k-iter Monte Carlo for 1 game). On second call, returns instantly with `fromCache: true`.

### 4. Trigger the prewarm orchestrator

```bash
curl 'http://localhost:3000/api/sim?date=2025-07-04'
```

Iterates today's games, runs sim for any whose lineup/weather hash has changed. Returns a per-game summary.

### 5. Test lock + settle paths

```bash
curl 'http://localhost:3000/api/lock'    # checks if any game is past lock trigger
curl 'http://localhost:3000/api/settle'  # tries to settle yesterday's locked picks
```

Both should return JSON status responses without errors.

### 6. Visit the pages

- `http://localhost:3000/` — main slate (3 boards)
- `http://localhost:3000/history` — empty until first settle (returns `{ rolling30Day: { overall: { hits: 0, total: 0, rate: 0 }, ... } }`)
- `http://localhost:3000/methodology` — static documentation page

---

## Phase 8 / Task 35 — Production smoke test

After the first Vercel deploy succeeds:

### 1. Visit the production URL

`https://hrr-betting.vercel.app/` — main slate page should render (may show "0 tracked" with empty boards if it's the first refresh).

`https://hrr-betting.vercel.app/methodology` — documentation page renders.

### 2. Trigger sim warmup manually (first run)

The cron runs every 5 minutes, so picks should populate within 5-10 minutes of first deploy. To force-warm immediately:

```bash
curl 'https://hrr-betting.vercel.app/api/sim'
```

Wait for the response, then refresh `/`.

### 3. Verify cron is firing

Vercel dashboard → **Logs** → filter by function. Should see:
- `/api/sim` invocations every 5 min during slate hours
- `/api/lock` invocations every 5 min during slate hours
- `/api/settle` invocation at ~10 UTC daily

### 4. First-day end-to-end validation

After the first MLB game day completes:
1. Wait for the 3 AM Pacific settle cron
2. Visit `/history` — should show settled picks for the previous day
3. Verify Brier scores, calibration table populates

---

## Calibration kickoff (post-launch, ~30 days)

Once you have ~30 days of settled history, run:

```bash
npx tsx scripts/recalibrate.ts
```

(Install `tsx` if needed: `npm i -D tsx`.)

The script reports:
- Per-rung hit rate vs predicted average (calibration delta)
- Brier scores
- Hit rate by EDGE bucket

Use the output to adjust the floors in `lib/constants.ts`:
- `EDGE_FLOORS` — raise if too many low-edge picks are slipping through
- `PROB_FLOORS` — raise if low-probability picks have poor hit rates
- Stabilization weights (`STABILIZATION_PA` in same file) — only adjust if you have evidence the model is over- or under-shrinking

Commit floor adjustments as `chore(calibration): tune Tracked floors based on N days settled history`.

---

## Out of scope for v0.1.0 (deferred)

- Book odds integration (compare EDGE to actual sportsbook lines)
- Discord notifications
- Mobile-specific layouts
- Automated recalibration cron
- 2023+ ghost-runner extras rule (documented as ~0.5% downward bias on rung probabilities)
- Per-handedness park HR factors (currently both `vsR`/`vsL` use the same value)
- Per-pitcher TTO splits from Statcast pitch-level data (currently league-avg fallback)

These are all noted in the spec (`docs/superpowers/specs/2026-04-26-hrr-betting-design.md`) sections 10 and 11.

---

## Troubleshooting

**`npm run dev` fails with "module not found"**: run `npm install` first.

**`/api/picks` returns 500**: check that you're hitting it for a date with MLB games scheduled (April-October). Off-season returns `gamesTotal: 0`.

**Sim takes > 60s**: drop the iteration count in `app/api/sim/[gameId]/build-context.ts` (currently 1000) or in `lib/sim.ts` if simSinglePlayerHRR is slow. Each simGame call should complete in < 1s on local hardware.

**Cron doesn't fire**: verify Vercel Pro is active and `vercel.json` deployed.

**Lock fires but settle doesn't see picks**: settle reads `picks:locked:YYYY-MM-DD` for *yesterday's* Pacific date — verify the date computation is correct in `app/api/settle/route.ts` (it accounts for UTC offset).
