# HRR Betting — Deployment Runbook

Manual checklist for taking the codebase from "v0.1.0-rc2 on `main`" to "live at `hrr-betting.vercel.app`."

**Stack at deploy time:**
- **Vercel Hobby** (free) — hosts the Next.js app, no `maxDuration` overrides needed
- **Vercel KV** — hot caches (sim results, P_typical, weather, Savant CSVs)
- **Supabase free tier** — persistent picks history (locked_picks, settled_picks)
- **GitHub Actions cron** (free on public repos) — sim prewarm, lock checks, daily settle

---

## 1. Vercel project setup (Hobby tier — free)

### 1a. Link repo

```bash
cd C:/Users/lucas/dev/hits-runs-rbis
npx vercel link
```

When prompted: "Set up and deploy?" → **Yes** → "Create new project?" → **Yes** → name **`hrr-betting`** → confirm scope.

(Or import via dashboard at vercel.com/new → Git Repository → `lucasreydman/hrr-betting`.)

### 1b. Provision Vercel KV

Project dashboard → **Storage** tab → **Create Database** → **KV** → attach to `hrr-betting`. Vercel auto-injects:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

Verify in Project Settings → Environment Variables.

### 1c. Domain alias

Settings → **Domains** → confirm `hrr-betting.vercel.app` is listed (Vercel reserves it because the project name matches).

### 1d. **Stay on Hobby** — do NOT upgrade to Pro

Hobby is intentionally fine for this app:
- `maxDuration` defaults to 10s. The 10k-iter Monte Carlo for one game completes in ~500ms locally, well under that.
- Vercel cron is disabled — we use GitHub Actions instead (see step 4).
- Vercel KV on Hobby has generous free limits (3k requests/day, 256MB storage).

---

## 2. Supabase project setup (free tier)

### 2a. Create the project (you already did this)

If not done: supabase.com → New Project → name `hrr-betting`, region East US (`aws-us-east-1`) to match Vercel `iad1`. Free plan. Save the database password in your password manager.

### 2b. Link the local CLI to the remote project

The CLI is already installed locally (`devDependency: supabase` in package.json). You need to log in via OAuth and link to your project:

```bash
cd C:/Users/lucas/dev/hits-runs-rbis
npx supabase login                                    # browser OAuth — approve in browser
npx supabase link --project-ref hzfzuemmhjnnlptoyqlg  # paste DB password when prompted
```

### 2c. Apply the migration

```bash
npx supabase db push
```

This applies `supabase/migrations/20260426000000_initial_schema.sql` to your remote project, creating `locked_picks` and `settled_picks` tables with proper indexes and RLS enabled. ~5 sec.

To verify in the Supabase dashboard: Tables tab → you should see both tables; click each to confirm RLS is on with no policies (locked to service-role-only access).

### 2d. Get the service role key for Vercel

Supabase dashboard → Project Settings → API → **`service_role`** key. **Do not paste this in chat.** Copy directly into the Vercel env var below.

---

## 3. Vercel env vars

Project Settings → Environment Variables → add the following to **Production** scope:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://hzfzuemmhjnnlptoyqlg.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | (from step 2d — secret) |
| `CRON_SECRET` | `tixqKv4paliuUCi3Dvfudw1S8Sh6TM-ZabL5RvDw16w` |

The `CRON_SECRET` was pre-generated for you and lives in this repo's deploy notes. Use the same value in the next step.

---

## 4. GitHub Actions secrets (free cron replacement)

Repo → Settings → Secrets and variables → **Actions** → New repository secret:

| Name | Value |
|---|---|
| `VERCEL_DEPLOY_URL` | `https://hrr-betting.vercel.app` (after first deploy succeeds) |
| `CRON_SECRET` | same value as the Vercel one above |

The workflow at `.github/workflows/cron.yml` triggers three jobs on these schedules (UTC):
- `sim` — every 5 min from 17-23 UTC and 0-6 UTC (slate hours)
- `lock` — same schedule
- `settle` — once daily at 10 UTC (3 AM Pacific)

Note: GitHub Actions cron has 5-15 min jitter on free tier — fine for our use case (eventually-consistent refresh, not exact-time triggers). Total compute usage is ~50 min/month against a 2000 min/month free quota.

---

## 5. First deploy

After steps 1-4 are complete:

```bash
git push origin main
```

Or trigger from the Vercel dashboard. Build should:
- Compile Next.js
- Bundle all routes (verify in build output: `/`, `/history`, `/methodology`, `/api/picks`, `/api/sim`, `/api/sim/[gameId]`, `/api/lock`, `/api/settle`, `/api/history`)
- Static-generate `/methodology`

If the build fails, check Vercel logs.

### Manually fire the first cron

To trigger the first sim warmup without waiting:
- GitHub → repo → Actions tab → "Cron — sim/lock/settle" → "Run workflow" → choose `sim` → Run.

After ~30 sec the workflow log should show `200 OK` from `/api/sim`. Then visit `https://hrr-betting.vercel.app/` to see the slate populate.

---

## 6. Smoke test (production)

After the first deploy and first cron run:

- `https://hrr-betting.vercel.app/` — main slate (3 boards, may show "warming" if sims are still in flight)
- `https://hrr-betting.vercel.app/history` — empty until first settle (returns `0/0` rates)
- `https://hrr-betting.vercel.app/methodology` — static documentation

### Verify cron jobs registered

GitHub Actions tab → "Cron — sim/lock/settle" workflow → see the three jobs listed. Their first-fire happens at the next 5-minute mark UTC.

### Verify Supabase rows after first lock + settle

After the first MLB game day completes:
1. Wait for ~3 AM Pacific settle workflow run
2. Supabase dashboard → Tables → `locked_picks` and `settled_picks` should have rows
3. Visit `/history` — should show settled picks for the previous day

---

## 7. Calibration kickoff (post-launch, ~30 days)

Once you have ~30 days of settled history, run:

```bash
npx tsx scripts/recalibrate.ts
```

(Install `tsx` if needed: `npm i -D tsx`. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your shell first — or just `vercel env pull .env.local` to grab them.)

The script reports per-rung Brier scores and hit rate by EDGE bucket. Use the output to adjust the floors in `lib/constants.ts`:
- `EDGE_FLOORS` — raise if too many low-edge picks are slipping through
- `PROB_FLOORS` — raise if low-probability picks have poor hit rates

Commit floor adjustments as `chore(calibration): tune Tracked floors based on N days settled history`.

---

## Out of scope for v0.1.0 (deferred)

- Book odds integration
- Discord notifications
- Mobile-specific layouts
- Automated recalibration cron
- 2023+ ghost-runner extras rule
- Per-handedness park HR factors
- Per-pitcher TTO splits from Statcast pitch-level data
- Real-time leaderboard via Supabase Realtime subscriptions

These are all noted in the spec (`docs/superpowers/specs/2026-04-26-hrr-betting-design.md`) sections 10 and 11.

---

## Troubleshooting

**`/api/picks` returns 500 with Supabase error**: verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in Vercel. Without them, the code silently falls back to KV (which won't have the data). Check Vercel logs.

**GitHub Actions cron jobs return `401 unauthorized`**: the `CRON_SECRET` GitHub secret doesn't match the Vercel env var. Regenerate (use the value in step 3) and update both.

**Supabase tables exist but no rows after first lock**: check Vercel function logs for `/api/lock` — confirms whether it found Tracked picks or returned `no-lock` (lineups not confirmed yet, or no game in lock window).

**`npx supabase db push` fails with auth error**: re-run `npx supabase login` (the CLI's auth token may have expired) and `npx supabase link` again.

**Sim is timing out**: drop `SIM_ITERATIONS` in `app/api/sim/[gameId]/route.ts` from 1000 to 500. If still timing out, the build context fan-out is the bottleneck — profile via local `npm run dev` first.
