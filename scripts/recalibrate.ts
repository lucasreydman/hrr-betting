/**
 * Standalone audit tool for recalibrating Tracked tier floors.
 *
 * Pulls 60 days of settled picks from Supabase (one query) and reports:
 *   - Per-rung Brier score + calibration delta
 *   - Hit rate by EDGE bucket (and recommended EDGE_FLOORS)
 *   - Hit rate by PROB bucket (and recommended PROB_FLOORS)
 *   - Hit rate by CONFIDENCE bucket within [0.85, 1.0] (calibration check)
 *
 * Run: `npm run recalibrate`
 *   Loads `.env.local` automatically (so SUPABASE_URL / SERVICE_ROLE_KEY work
 *   the same as in `npm run dev`). Fails loudly if those aren't set so we
 *   never silently fall back to the in-memory KV (which would always report
 *   "no settled history") and look like the script just ran fine.
 *
 * NOTE: Manual tool, not a cron. Run after ~30 days of settled history.
 *
 * IMPORTANT — selection-bias limitation:
 *   `settled_picks` only contains rows that were LOCKED, which by definition
 *   were Tracked-tier at lock time (cleared all three floors). So this audit
 *   cannot directly answer "would lowering floor X have been profitable?" —
 *   the picks that *would* have been included aren't in the sample. What it
 *   CAN answer well is calibration *within* the existing tracked tier and
 *   relative hit rates across edge / prob / conf buckets that already passed.
 *   For a proper out-of-sample backtest, /api/picks for historical slates
 *   includes every pick (tracked + watching) with `outcome` filled in once
 *   the boxscore lands — that is a separate, larger script not built here.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// -- Tiny env loader. Reads .env.local in repo root and populates process.env
// -- BEFORE we import lib/db.ts (which captures SUPABASE_URL at module load).
// -- This is why the helper sits inline instead of in lib/ — it has to run
// -- pre-import. Fail-soft when the file doesn't exist (CI, devcontainers).
function loadDotEnvLocal(): void {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  const contents = readFileSync(path, 'utf8')
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx <= 0) continue
    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    // Don't overwrite values already in the shell env — explicit env vars
    // should always win over .env.local.
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
loadDotEnvLocal()

// Imports below this line trigger module init (e.g. lib/db.ts captures
// SUPABASE_URL at first call). The loadDotEnvLocal() call above must run
// first, which is why these imports sit after a non-import top-level
// statement. The ESM import-hoisting model means these still resolve at
// parse time, but their *side effects* (env reads in module init) only fire
// when this file's body runs — by which point env is populated.
import { getSettledPicks, computeRollingMetrics } from '../lib/tracker'
import { isSupabaseAvailable } from '../lib/db'
import { slateDateString, shiftIsoDate } from '../lib/date-utils'
import {
  EDGE_FLOORS,
  PROB_FLOORS,
  CONFIDENCE_FLOOR_TRACKED,
} from '../lib/constants'
import type { Rung } from '../lib/types'
import type { SettledPickRow } from '../lib/db'

interface BucketStats {
  label: string
  lowerBound: number
  count: number
  hits: number
  hitRate: number
  predictedAvg: number
}

const HORIZONTAL_RULE = '─'.repeat(72)

async function main(): Promise<void> {
  console.log('HRR Betting — Recalibration Audit')
  console.log('='.repeat(36) + '\n')

  // Hard guard. The script silently no-op'd before when env vars were missing
  // because lib/db.ts falls back to a null client and lib/tracker iterates KV
  // (which is empty in this fresh process), reporting "0 settled picks." That
  // was the worst-of-both: no error, no data, no signal that anything was
  // wrong. Fail loud instead.
  if (!isSupabaseAvailable()) {
    console.error('ERROR: Supabase is not configured.')
    console.error(
      'The script needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in either',
    )
    console.error(
      'the shell environment or .env.local in the repo root. Without them, the',
    )
    console.error(
      'script would silently fall through to an empty in-memory KV and report',
    )
    console.error('"no settled history" even when Supabase has data.')
    console.error('')
    console.error(
      'Quick fix: `vercel env pull .env.local` if the project is linked, then',
    )
    console.error('re-run.')
    process.exit(1)
  }

  // Anchor on slateDateString() so the 60-day window respects the ET 3 AM
  // rollover (instead of UTC midnight, which would be a day off during the
  // late-evening ET window when UTC has already rolled but the slate hasn't).
  const since = shiftIsoDate(slateDateString(), -60)
  const rows = await getSettledPicks({ sinceDate: since })

  if (rows.length === 0) {
    console.log('No settled history found since ' + since + '.')
    console.log('')
    console.log(
      'Expected if you have not yet shipped Tracked picks or settled any games.',
    )
    console.log('Re-run after ~30 days of settled history.')
    return
  }

  const totalDays = countDistinctDates(rows)
  console.log(
    `Loaded ${rows.length} settled picks across ${totalDays} days ` +
      `(since ${since})\n`,
  )
  console.log('Current floors:')
  console.log(`  EDGE_FLOORS = { 1: ${EDGE_FLOORS[1]}, 2: ${EDGE_FLOORS[2]}, 3: ${EDGE_FLOORS[3]} }`)
  console.log(`  PROB_FLOORS = { 1: ${PROB_FLOORS[1]}, 2: ${PROB_FLOORS[2]}, 3: ${PROB_FLOORS[3]} }`)
  console.log(`  CONFIDENCE_FLOOR_TRACKED = ${CONFIDENCE_FLOOR_TRACKED}\n`)

  // ──────────────────────────────────────────────────────────────────────
  // Per-rung headline metrics
  // ──────────────────────────────────────────────────────────────────────
  const metrics = computeRollingMetrics(rows)

  for (const rung of [1, 2, 3] as Rung[]) {
    console.log(HORIZONTAL_RULE)
    console.log(`Rung ${rung}+ HRR`)
    console.log(HORIZONTAL_RULE)

    const m = metrics.find(x => x.rung === rung)
    if (!m || m.total === 0) {
      console.log('  No settled picks for this rung.\n')
      continue
    }

    const calibrationDelta = m.rate - m.predicted_avg
    const calibrationLabel =
      calibrationDelta > 0.05
        ? '(underconfident — model wins more often than it predicts)'
        : calibrationDelta < -0.05
          ? '(overconfident — model loses more than it predicts)'
          : '(calibration good — actual within 5pp of predicted)'

    console.log(
      `  Record:        ${m.hits}-${m.total - m.hits} (${pct(m.rate)})`,
    )
    console.log(`  Predicted avg: ${pct(m.predicted_avg)}`)
    console.log(`  Brier score:   ${m.brier.toFixed(3)}`)
    console.log(
      `  Calibration:   ${signedPp(calibrationDelta)} ${calibrationLabel}`,
    )

    const rungRows = rows.filter(r => r.rung === rung && r.outcome !== 'PENDING')

    console.log('')
    console.log('  Hit rate by EDGE bucket:')
    printBucketTable(bucketByEdge(rungRows))

    console.log('')
    console.log('  Hit rate by PROB bucket (p̂ today):')
    printBucketTable(bucketByProb(rungRows))

    console.log('')
    console.log('  Hit rate by CONFIDENCE bucket (within tracked tier):')
    printBucketTable(bucketByConfidence(rungRows))

    console.log('')
  }

  // ──────────────────────────────────────────────────────────────────────
  // Floor recommendations (only when we have ≥30 days of data)
  // ──────────────────────────────────────────────────────────────────────
  console.log(HORIZONTAL_RULE)
  console.log('Floor recommendations')
  console.log(HORIZONTAL_RULE)

  if (totalDays < 30) {
    console.log(
      `Only ${totalDays} settled days. Wait for ≥30 before changing floors.`,
    )
    console.log(
      'Heuristic recommendations are unreliable below that sample size.\n',
    )
    return
  }

  // Hit-rate target = current PROB_FLOORS. The semantic: a pick that clears
  // the prob floor is forecast at p̂_today ≥ floor; a well-calibrated tracked
  // tier should empirically hit at the floor rate or above. If actual hit
  // rate falls below the floor, the floor itself is over-aggressive.
  const HIT_RATE_TARGET: Record<Rung, number> = {
    1: PROB_FLOORS[1],
    2: PROB_FLOORS[2],
    3: PROB_FLOORS[3],
  }

  for (const rung of [1, 2, 3] as Rung[]) {
    const rungRows = rows.filter(
      r => r.rung === rung && r.outcome !== 'PENDING',
    )
    if (rungRows.length < 30) {
      console.log(
        `Rung ${rung}+: only ${rungRows.length} settled picks — skipping recommendation.`,
      )
      continue
    }

    const target = HIT_RATE_TARGET[rung]
    console.log(
      `\nRung ${rung}+ (target hit rate ≥ ${pct(target)}, matches PROB_FLOOR):`,
    )

    recommendFloor({
      kind: 'EDGE',
      buckets: bucketByEdge(rungRows).filter(b => b.count >= 10),
      currentFloor: EDGE_FLOORS[rung],
      target,
    })

    recommendFloor({
      kind: 'PROB',
      buckets: bucketByProb(rungRows).filter(b => b.count >= 10),
      currentFloor: PROB_FLOORS[rung],
      target,
    })
  }

  // Confidence floor analysis — calibration WITHIN the [0.85, 1.0] band we
  // actually have. Cannot recommend "drop to 0.80" from this data alone
  // (selection bias) but can flag when high-conf rows underperform low-conf
  // rows, which is a calibration-within-tier red flag.
  console.log('\n' + HORIZONTAL_RULE)
  console.log('Confidence calibration (within tracked tier)')
  console.log(HORIZONTAL_RULE)
  const allSettled = rows.filter(r => r.outcome !== 'PENDING')
  if (allSettled.length < 50) {
    console.log(`Only ${allSettled.length} settled picks — skipping conf analysis.\n`)
  } else {
    printBucketTable(bucketByConfidence(allSettled))
    console.log('')
    console.log(
      'Reading: lower-confidence buckets (closer to the 0.85 floor) hitting',
    )
    console.log(
      'AT OR ABOVE higher-confidence buckets is mild evidence the floor is',
    )
    console.log(
      "too high. The reverse — high conf hitting more — is the model behaving",
    )
    console.log("as designed. Don't move the floor on this alone; pair with the")
    console.log('historical /api/picks backtest (not built here).')
  }

  console.log('\n' + HORIZONTAL_RULE)
  console.log('Apply changes manually in lib/constants.ts.')
  console.log('Re-deploy and re-track for another 30 days before tuning further.\n')
}

// ──────────────────────────────────────────────────────────────────────────
// Bucketing helpers
// ──────────────────────────────────────────────────────────────────────────

function bucketByRange(
  rows: SettledPickRow[],
  field: 'edge' | 'p_matchup' | 'confidence',
  ranges: Array<{ label: string; lowerBound: number; predicate: (v: number) => boolean }>,
): BucketStats[] {
  const buckets: BucketStats[] = []
  for (const range of ranges) {
    const inBucket = rows.filter(r => range.predicate(r[field]))
    if (inBucket.length === 0) continue
    const hits = inBucket.filter(r => r.outcome === 'HIT').length
    buckets.push({
      label: range.label,
      lowerBound: range.lowerBound,
      count: inBucket.length,
      hits,
      hitRate: hits / inBucket.length,
      predictedAvg:
        inBucket.reduce((a, r) => a + r.p_matchup, 0) / inBucket.length,
    })
  }
  return buckets
}

function bucketByEdge(rows: SettledPickRow[]): BucketStats[] {
  // Bucket edges around the current floor pattern (0.10/0.20/0.30) with
  // additional resolution in the high-edge tails so 3+ HRR longshots show
  // their behaviour separately from 2+ HRR meaningful-edge picks.
  return bucketByRange(rows, 'edge', [
    { label: 'EDGE < 0.05',     lowerBound: 0.00, predicate: e => e < 0.05 },
    { label: '0.05 ≤ EDGE < 0.10', lowerBound: 0.05, predicate: e => e >= 0.05 && e < 0.10 },
    { label: '0.10 ≤ EDGE < 0.20', lowerBound: 0.10, predicate: e => e >= 0.10 && e < 0.20 },
    { label: '0.20 ≤ EDGE < 0.30', lowerBound: 0.20, predicate: e => e >= 0.20 && e < 0.30 },
    { label: '0.30 ≤ EDGE < 0.50', lowerBound: 0.30, predicate: e => e >= 0.30 && e < 0.50 },
    { label: '0.50 ≤ EDGE < 1.00', lowerBound: 0.50, predicate: e => e >= 0.50 && e < 1.00 },
    { label: 'EDGE ≥ 1.00',       lowerBound: 1.00, predicate: e => e >= 1.00 },
  ])
}

function bucketByProb(rows: SettledPickRow[]): BucketStats[] {
  // Cover the full [0.20, 0.95] range with 5pp resolution near the current
  // floor edges (0.40, 0.60, 0.80) so the recommendation logic has fine-
  // grained candidates to compare.
  return bucketByRange(rows, 'p_matchup', [
    { label: 'PROB < 0.30',         lowerBound: 0.00, predicate: p => p < 0.30 },
    { label: '0.30 ≤ PROB < 0.40',  lowerBound: 0.30, predicate: p => p >= 0.30 && p < 0.40 },
    { label: '0.40 ≤ PROB < 0.50',  lowerBound: 0.40, predicate: p => p >= 0.40 && p < 0.50 },
    { label: '0.50 ≤ PROB < 0.60',  lowerBound: 0.50, predicate: p => p >= 0.50 && p < 0.60 },
    { label: '0.60 ≤ PROB < 0.70',  lowerBound: 0.60, predicate: p => p >= 0.60 && p < 0.70 },
    { label: '0.70 ≤ PROB < 0.80',  lowerBound: 0.70, predicate: p => p >= 0.70 && p < 0.80 },
    { label: '0.80 ≤ PROB < 0.90',  lowerBound: 0.80, predicate: p => p >= 0.80 && p < 0.90 },
    { label: 'PROB ≥ 0.90',         lowerBound: 0.90, predicate: p => p >= 0.90 },
  ])
}

function bucketByConfidence(rows: SettledPickRow[]): BucketStats[] {
  // settled_picks only contains rows that cleared CONFIDENCE_FLOOR_TRACKED
  // (currently 0.85), so the meaningful signal is variance WITHIN that band.
  return bucketByRange(rows, 'confidence', [
    { label: 'CONF < 0.85 (shouldn\'t exist)', lowerBound: 0.00, predicate: c => c < 0.85 },
    { label: '0.85 ≤ CONF < 0.88',             lowerBound: 0.85, predicate: c => c >= 0.85 && c < 0.88 },
    { label: '0.88 ≤ CONF < 0.92',             lowerBound: 0.88, predicate: c => c >= 0.88 && c < 0.92 },
    { label: '0.92 ≤ CONF < 0.96',             lowerBound: 0.92, predicate: c => c >= 0.92 && c < 0.96 },
    { label: 'CONF ≥ 0.96',                    lowerBound: 0.96, predicate: c => c >= 0.96 },
  ])
}

// ──────────────────────────────────────────────────────────────────────────
// Recommendation logic
// ──────────────────────────────────────────────────────────────────────────

interface RecommendFloorArgs {
  kind: 'EDGE' | 'PROB'
  buckets: BucketStats[]
  currentFloor: number
  target: number
}

function recommendFloor(args: RecommendFloorArgs): void {
  const { kind, buckets, currentFloor, target } = args
  const eligible = buckets.filter(b => b.hitRate >= target)
  if (eligible.length === 0) {
    console.log(
      `  ${kind}: no bucket clears ${pct(target)} target — keep current floor (${currentFloor}) or raise it.`,
    )
    return
  }
  // Pick the lowest qualifying lower-bound (most permissive while clearing target).
  const best = eligible.reduce((a, b) =>
    a.lowerBound < b.lowerBound ? a : b,
  )
  const direction =
    best.lowerBound < currentFloor
      ? `LOWER from ${currentFloor} → ${best.lowerBound.toFixed(2)} (more permissive)`
      : best.lowerBound > currentFloor
        ? `RAISE from ${currentFloor} → ${best.lowerBound.toFixed(2)} (stricter)`
        : `keep at ${currentFloor}`
  console.log(
    `  ${kind}: recommend ${direction} — bucket "${best.label}" hit ${pct(best.hitRate)} on n=${best.count}.`,
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Output helpers
// ──────────────────────────────────────────────────────────────────────────

function printBucketTable(buckets: BucketStats[]): void {
  if (buckets.length === 0) {
    console.log('    (no data in any bucket)')
    return
  }
  for (const b of buckets) {
    const delta = (b.hitRate - b.predictedAvg) * 100
    const deltaStr =
      delta >= 0.5
        ? `+${delta.toFixed(1)}pp under-predicted`
        : delta <= -0.5
          ? `${delta.toFixed(1)}pp over-predicted`
          : 'calibrated'
    console.log(
      `    ${b.label.padEnd(34)} n=${String(b.count).padStart(3)}  ` +
        `actual ${(b.hitRate * 100).toFixed(0).padStart(3)}%  ` +
        `predicted ${(b.predictedAvg * 100).toFixed(0).padStart(3)}%  ` +
        `(${deltaStr})`,
    )
  }
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function signedPp(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(1)}pp`
}

function countDistinctDates(rows: SettledPickRow[]): number {
  return new Set(rows.map(r => r.date)).size
}

main().catch(e => {
  console.error('Recalibration audit failed:', e)
  process.exit(1)
})
