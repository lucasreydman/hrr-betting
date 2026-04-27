/**
 * Standalone audit tool for recalibrating Tracked tier floors.
 *
 * Pulls 60 days of settled picks from Supabase (one query) and reports:
 * - Per-rung Brier score + calibration delta
 * - Hit rate by EDGE bucket
 *
 * Run: `npx tsx scripts/recalibrate.ts`
 *   (Install tsx if needed: `npm i -D tsx`)
 *   Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars in your shell.
 *
 * NOTE: Manual tool, not a cron. Run after ~30 days of settled history.
 */

import { getSettledPicks, computeRollingMetrics } from '../lib/tracker'
import type { Rung } from '../lib/types'
import type { SettledPickRow } from '../lib/db'

interface BucketStats {
  label: string
  count: number
  hitRate: number
  predictedAvg: number
}

async function main() {
  console.log('HRR Betting — Recalibration Audit')
  console.log('================================\n')

  const today = new Date()
  const since = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Single query (Supabase) replaces 60 sequential KV gets
  const rows = await getSettledPicks({ sinceDate: since })

  if (rows.length === 0) {
    console.log('No settled history found. Cannot recalibrate.')
    console.log('\nThis is expected if you have not yet shipped Tracked picks or settled any games.')
    console.log('Re-run after ~30 days of settled history.')
    return
  }

  console.log(`Loaded ${rows.length} settled picks across ${countDistinctDates(rows)} days\n`)

  const metrics = computeRollingMetrics(rows)

  for (const rung of [1, 2, 3] as Rung[]) {
    console.log(`=== Rung ${rung}+ HRR ===`)
    const m = metrics.find(x => x.rung === rung)
    if (!m || m.total === 0) {
      console.log('  No settled picks for this rung.\n')
      continue
    }

    const calibrationDelta = m.rate - m.predicted_avg
    const calibrationLabel =
      calibrationDelta > 0.05 ? '(underconfident — model wins more often than it predicts)'
      : calibrationDelta < -0.05 ? '(overconfident — model loses more than it predicts)'
      : '(good)'

    console.log(`  Record: ${m.hits}-${m.total - m.hits} (${(m.rate * 100).toFixed(1)}%)`)
    console.log(`  Predicted avg: ${(m.predicted_avg * 100).toFixed(1)}%`)
    console.log(`  Brier: ${m.brier.toFixed(3)}`)
    console.log(`  Calibration delta: ${(calibrationDelta * 100).toFixed(1)}pp ${calibrationLabel}`)

    // Bucket by EDGE
    const rungRows = rows.filter(r => r.rung === rung && r.outcome !== 'PENDING')
    const buckets: BucketStats[] = bucketByEdge(rungRows)

    console.log('  Hit rate by EDGE bucket:')
    for (const b of buckets) {
      console.log(
        `    ${b.label.padEnd(20)} n=${String(b.count).padStart(3)}  ` +
        `actual ${(b.hitRate * 100).toFixed(0).padStart(3)}%  ` +
        `predicted ${(b.predictedAvg * 100).toFixed(0).padStart(3)}%`
      )
    }
    console.log()
  }

  console.log('Done. Adjust floors in lib/constants.ts based on bucket analysis.')
  console.log('Sweet spot: pick the EDGE bucket where actual hit rate first crosses')
  console.log('your target threshold (e.g. 70% for Tracked) and use that as the floor.\n')
}

function countDistinctDates(rows: SettledPickRow[]): number {
  return new Set(rows.map(r => r.date)).size
}

function bucketByEdge(rows: SettledPickRow[]): BucketStats[] {
  const ranges: Array<[string, (e: number) => boolean]> = [
    ['EDGE < 0.1', e => e < 0.1],
    ['0.1 ≤ EDGE < 0.3', e => e >= 0.1 && e < 0.3],
    ['0.3 ≤ EDGE < 0.6', e => e >= 0.3 && e < 0.6],
    ['0.6 ≤ EDGE < 1.0', e => e >= 0.6 && e < 1.0],
    ['EDGE ≥ 1.0', e => e >= 1.0],
  ]
  const buckets: BucketStats[] = []
  for (const [label, predicate] of ranges) {
    const inBucket = rows.filter(r => predicate(r.edge))
    if (inBucket.length === 0) continue
    const hits = inBucket.filter(r => r.outcome === 'HIT').length
    buckets.push({
      label,
      count: inBucket.length,
      hitRate: hits / inBucket.length,
      predictedAvg: inBucket.reduce((a, r) => a + r.p_matchup, 0) / inBucket.length,
    })
  }
  return buckets
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
