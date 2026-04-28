import { ClientShell } from '@/components/ClientShell'
import { rankPicks } from '@/lib/ranker'
import { slateDateString } from '@/lib/date-utils'

// Revalidate the page every 60 s so the SSR'd HTML doesn't go stale faster
// than the auto-refreshing client. The client also polls /api/picks every
// 60 s and refetches on visibility change for true near-live updates.
export const revalidate = 60

export default async function Home() {
  // Single source of truth: ET 3AM-rollover slate date. The client doesn't
  // navigate between dates — today's slate is the only view.
  const date = slateDateString()
  const picks = await rankPicks(date).catch(() => ({
    date,
    refreshedAt: new Date().toISOString(),
    rung1: [],
    rung2: [],
    rung3: [],
    meta: {
      gamesTotal: 0,
      fromCache: false,
      gameStates: { scheduled: 0, inProgress: 0, final: 0, postponed: 0 },
    },
  }))

  return <ClientShell initialPicks={picks} />
}
