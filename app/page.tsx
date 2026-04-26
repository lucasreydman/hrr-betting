import { ClientShell } from '@/components/ClientShell'
import { rankPicks } from '@/lib/ranker'

export const revalidate = 60

export default async function Home() {
  const date = new Date().toISOString().slice(0, 10)
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
