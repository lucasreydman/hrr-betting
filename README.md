# HRR Betting — MLB Hits + Runs + RBIs Prop Model

A standalone MLB betting tool that ranks the best **Hits + Runs + RBIs** prop plays for the day across three rungs (1+, 2+, 3+ HRR). Each rung is its own independently-ranked board. Picks are auto-tracked with calibration metrics over time.

**Live (planned):** [hrr-betting.vercel.app](https://hrr-betting.vercel.app)

**Companion projects:**
- [bvp-betting](https://bvp-betting.vercel.app) — Player Hits 1+ prop based on career batter-vs-pitcher splits
- [bet-yrfi](https://bet-yrfi.vercel.app) — Yes Run First Inning
- [bet-nrfi](https://bet-nrfi.vercel.app) — No Run First Inning

---

## What it does

For each player on the day's slate, the model:

1. Estimates the per-PA outcome distribution (1B / 2B / 3B / HR / BB / K / other_out) using a hybrid log-5 + Statcast approach.
2. Runs a **lineup-aware Monte Carlo simulation** (10k iterations) that simulates the entire team's offensive innings — capturing baserunner state, surrounding-hitter quality, walks, and the HR-trifecta correlation that closed-form models miss.
3. Computes `P(HRR ≥ N)` for each rung from the empirical distribution.
4. Compares to the player's **typical matchup** (replay-the-season sim against opponents they've actually faced) → **EDGE** = `P_matchup / P_typical − 1`.
5. Multiplies by a **confidence factor** (lineup confirmation, BvP sample, weather stability, etc.) → **SCORE**.
6. Ranks per-rung and tags **🔥 Tracked** picks (clears all three: confidence ≥ 0.85, per-rung EDGE floor, per-rung probability floor).
7. Auto-settles picks from boxscore the next morning. Tracks rolling 30-day hit rate + Brier score per rung.

---

## Pages

- **`/`** — today's slate, three boards (1+, 2+, 3+), ranked by SCORE
- **`/history`** — rolling Tracked record + per-rung calibration
- **`/methodology`** — full math, every factor, all sources cited

---

## Stack

- Next.js 16 App Router · React 19 · Tailwind v4 · TypeScript
- Vercel KV cache (in-memory fallback for local dev)
- Free APIs only: MLB Stats, Baseball Savant CSV, Open-Meteo
- Vercel cron: 5-min refresh during slate, 3 AM Pacific settle
- Deploys from `main`

---

## Status

Design phase complete — see [`docs/superpowers/specs/2026-04-26-hrr-betting-design.md`](docs/superpowers/specs/2026-04-26-hrr-betting-design.md) for the full spec.
