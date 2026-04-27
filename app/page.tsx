import { ClientShell } from '@/components/ClientShell'
import { rankPicks } from '@/lib/ranker'
import { pacificDateString } from '@/lib/date-utils'

export const revalidate = 60

export default async function Home() {
  // Use Pacific (slate) date so the server-rendered initial state matches
  // the client's first request — otherwise late-night PT users would see UTC's
  // tomorrow flash on hydration before the client refetches.
  const date = pacificDateString()
  const picks = await rankPicks(date).catch(() => ({
    date,
    refreshedAt: new Date().toISOString(),
    rung1: [],
    rung2: [],
    rung3: [],
    meta: { gamesTotal: 0, gamesWithSim: 0, gamesWithoutSim: [], fromCache: false },
  }))

  return <ClientShell initialPicks={picks} />
}
