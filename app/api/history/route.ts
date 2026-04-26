import { NextResponse } from 'next/server'
import { kvGet } from '@/lib/kv'
import type { Pick } from '@/lib/ranker'
import type { Rung } from '@/lib/types'

interface SettledPick extends Pick {
  rung: Rung
  outcome: 'HIT' | 'MISS' | 'PENDING'
  actualHRR?: number
}

interface SettledDay {
  date: string
  picks: SettledPick[]
}

export interface HistoryResponse {
  rolling30Day: {
    overall: { hits: number; total: number; rate: number }
    perRung: Record<Rung, { hits: number; total: number; rate: number; predictedAvg: number; brier: number }>
  }
  byDate: Array<{
    date: string
    pickCount: number
    hits: number
    miss: number
    pending: number
  }>
  recentPicks: SettledPick[]  // last ~50 settled picks for the per-pick log
}

export async function GET(): Promise<NextResponse> {
  const today = new Date()
  const days: SettledDay[] = []

  for (let i = 0; i < 30; i++) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
    const dateStr = d.toISOString().slice(0, 10)
    const day = await kvGet<SettledDay>(`picks:settled:${dateStr}`)
    if (day) days.push(day)
  }

  // Aggregate per-rung
  const perRung: Record<Rung, { hits: number; total: number; rate: number; predictedAvg: number; brier: number }> = {
    1: { hits: 0, total: 0, rate: 0, predictedAvg: 0, brier: 0 },
    2: { hits: 0, total: 0, rate: 0, predictedAvg: 0, brier: 0 },
    3: { hits: 0, total: 0, rate: 0, predictedAvg: 0, brier: 0 },
  }
  let allHits = 0, allTotal = 0
  const recentPicks: SettledPick[] = []

  for (const day of days) {
    for (const p of day.picks) {
      if (p.outcome === 'PENDING') continue
      const isHit = p.outcome === 'HIT'
      perRung[p.rung].total++
      if (isHit) perRung[p.rung].hits++
      perRung[p.rung].predictedAvg += p.pMatchup
      // Brier sum: (predicted - actual)^2
      perRung[p.rung].brier += Math.pow(p.pMatchup - (isHit ? 1 : 0), 2)

      allTotal++
      if (isHit) allHits++

      if (recentPicks.length < 50) recentPicks.push(p)
    }
  }

  // Compute rates and means
  for (const rung of [1, 2, 3] as Rung[]) {
    const r = perRung[rung]
    if (r.total > 0) {
      r.rate = r.hits / r.total
      r.predictedAvg = r.predictedAvg / r.total
      r.brier = r.brier / r.total
    }
  }

  // By-date summary for chart
  const byDate = days.reverse().map(day => {
    let hits = 0, miss = 0, pending = 0
    for (const p of day.picks) {
      if (p.outcome === 'HIT') hits++
      else if (p.outcome === 'MISS') miss++
      else pending++
    }
    return { date: day.date, pickCount: day.picks.length, hits, miss, pending }
  })

  return NextResponse.json({
    rolling30Day: {
      overall: { hits: allHits, total: allTotal, rate: allTotal > 0 ? allHits / allTotal : 0 },
      perRung,
    },
    byDate,
    recentPicks,
  })
}
