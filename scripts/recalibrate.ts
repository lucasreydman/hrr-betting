/**
 * Standalone audit tool for recalibrating Tracked tier floors.
 *
 * Reads `picks:settled:*` keys from KV (or filesystem dump) and reports:
 * - Per-rung Brier score
 * - Hit rate by EDGE bucket (< 0.1, 0.1-0.3, 0.3-0.6, 0.6-1.0, > 1.0)
 * - Hit rate by P_matchup bucket
 * - Suggested floor adjustments
 *
 * Run: `npx tsx scripts/recalibrate.ts` (after installing tsx, or compile first).
 *
 * NOTE: This is a manual tool, not a cron. Run it after ~30 days of settled history.
 */

import { kvGet } from '../lib/kv'
import type { SettledDay } from '../lib/tracker'
import type { Rung } from '../lib/types'

interface BucketStats {
  bucketLabel: string
  count: number
  hitRate: number
  predictedAvg: number
}

async function main() {
  console.log('HRR Betting — Recalibration Audit')
  console.log('================================\n')

  const today = new Date()
  const days: SettledDay[] = []
  for (let i = 0; i < 60; i++) {  // Look back 60 days
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
    const dateStr = d.toISOString().slice(0, 10)
    const day = await kvGet<SettledDay>(`picks:settled:${dateStr}`)
    if (day) days.push(day)
  }

  const totalDays = days.length
  console.log(`Loaded ${totalDays} settled days\n`)

  if (totalDays === 0) {
    console.log('No settled history found. Cannot recalibrate.')
    return
  }

  for (const rung of [1, 2, 3] as Rung[]) {
    console.log(`=== Rung ${rung}+ HRR ===`)
    const picks = days.flatMap(d => d.picks.filter(p => p.rung === rung && p.outcome !== 'PENDING'))
    if (picks.length === 0) {
      console.log('  No settled picks for this rung.\n')
      continue
    }

    const hits = picks.filter(p => p.outcome === 'HIT').length
    const total = picks.length
    const rate = hits / total
    const predicted = picks.reduce((a, p) => a + p.pMatchup, 0) / total
    const brier = picks.reduce((a, p) => a + Math.pow(p.pMatchup - (p.outcome === 'HIT' ? 1 : 0), 2), 0) / total

    console.log(`  Record: ${hits}-${total - hits} (${(rate * 100).toFixed(1)}%)`)
    console.log(`  Predicted avg: ${(predicted * 100).toFixed(1)}%`)
    console.log(`  Brier: ${brier.toFixed(3)}`)
    console.log(`  Calibration delta: ${((rate - predicted) * 100).toFixed(1)}pp ${rate - predicted > 0.05 ? '(underconfident)' : rate - predicted < -0.05 ? '(overconfident)' : '(good)'}`)

    // Bucket by EDGE
    const buckets: BucketStats[] = []
    const ranges: Array<[string, (e: number) => boolean]> = [
      ['EDGE < 0.1', e => e < 0.1],
      ['0.1 ≤ EDGE < 0.3', e => e >= 0.1 && e < 0.3],
      ['0.3 ≤ EDGE < 0.6', e => e >= 0.3 && e < 0.6],
      ['0.6 ≤ EDGE < 1.0', e => e >= 0.6 && e < 1.0],
      ['EDGE ≥ 1.0', e => e >= 1.0],
    ]
    for (const [label, predicate] of ranges) {
      const inBucket = picks.filter(p => predicate(p.edge))
      if (inBucket.length === 0) continue
      const bHits = inBucket.filter(p => p.outcome === 'HIT').length
      buckets.push({
        bucketLabel: label,
        count: inBucket.length,
        hitRate: bHits / inBucket.length,
        predictedAvg: inBucket.reduce((a, p) => a + p.pMatchup, 0) / inBucket.length,
      })
    }

    console.log('  Hit rate by EDGE bucket:')
    for (const b of buckets) {
      console.log(`    ${b.bucketLabel}: ${(b.hitRate * 100).toFixed(0)}% (n=${b.count}, predicted ${(b.predictedAvg * 100).toFixed(0)}%)`)
    }
    console.log()
  }

  console.log('Done. Adjust floors in lib/constants.ts based on bucket analysis.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
