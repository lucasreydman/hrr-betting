import { ClientShell } from '@/components/ClientShell'
import { rankPicks } from '@/lib/ranker'
import { slateDateString } from '@/lib/date-utils'

export const metadata = {
  // Absolute title — Next.js metadata templates only apply to *child*
  // segments, not to a page in the same segment as the layout that
  // defined the template. Spelling it out keeps the home tab consistent
  // with /history and /methodology which do get templated.
  title: { absolute: 'HRR Betting — Board' },
}

// Force dynamic rendering. The page reads upstream MLB data + per-player
// probTypical cache; on a cold cache, getPTypical() runs ~10s lazy-backfill
// sims per player, which would time out static-page generation during build.
// Dynamic rendering also means data is fresh on every request (the client
// still polls /api/picks every 60s on top).
export const dynamic = 'force-dynamic'

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
      cacheAges: { lineupMaxSec: 0, weatherMaxSec: 0, probableMaxSec: 0, typicalMaxSec: 0 },
    },
  }))

  return <ClientShell initialPicks={picks} />
}
