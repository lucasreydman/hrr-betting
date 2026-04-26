import { NextResponse } from 'next/server'
import { settlePicks } from '@/lib/tracker'

export const maxDuration = 60

/**
 * Cron endpoint: 3 AM Pacific (10 AM UTC).
 * Settle the previous day's Tracked picks by pulling boxscores.
 */
export async function GET(): Promise<NextResponse> {
  // "Previous day" = yesterday in Pacific time
  const now = new Date()
  // Compute Pacific date — Vercel runs in UTC; PT is UTC-7 or -8
  // Use a simple offset (close enough for daily cron purposes)
  const pacificMs = now.getTime() - 8 * 60 * 60 * 1000
  const pacificDate = new Date(pacificMs)
  pacificDate.setUTCDate(pacificDate.getUTCDate() - 1)
  const yesterdayDate = pacificDate.toISOString().slice(0, 10)

  const result = await settlePicks(yesterdayDate)
  return NextResponse.json({ date: yesterdayDate, ...result })
}
