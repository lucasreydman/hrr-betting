import { CalibrationTable } from '@/components/CalibrationTable'
import { HistoryChart } from '@/components/HistoryChart'
import { EmptyState } from '@/components/EmptyState'
import { headers } from 'next/headers'
import type { HistoryResponse } from './../api/history/route'

async function getHistory(): Promise<HistoryResponse | null> {
  // Use absolute URL for server-side fetch in Vercel
  const headersList = await headers()
  const host = headersList.get('host') || 'localhost:3000'
  const proto = host.startsWith('localhost') ? 'http' : 'https'
  try {
    const res = await fetch(`${proto}://${host}/api/history`, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export const revalidate = 300  // 5 min

export default async function HistoryPage() {
  const history = await getHistory()

  if (!history) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <PageHeader />
        <EmptyState
          tone="error"
          title="Couldn't load history"
          description="The history API didn't respond. Try again in a moment, or check Vercel logs if this persists."
        />
      </main>
    )
  }

  const { rolling30Day, byDate, recentPicks } = history
  const wins = rolling30Day.overall.hits
  const losses = rolling30Day.overall.total - rolling30Day.overall.hits
  const hasSettled = rolling30Day.overall.total > 0

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader />

      {/* Headline result */}
      <section
        aria-labelledby="rolling-overall"
        className="rounded-lg border border-border bg-card/30 p-6 sm:p-8"
      >
        <h2 id="rolling-overall" className="sr-only">Rolling 30-day overall record</h2>
        {hasSettled ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-mono text-5xl font-bold tracking-tight text-ink sm:text-6xl">
                {wins}–{losses}
              </span>
              <span className="font-mono text-2xl text-ink-muted">
                {(rolling30Day.overall.rate * 100).toFixed(1)}%
              </span>
            </div>
            <p className="text-sm text-ink-muted">
              Tracked picks settled in the last 30 days
            </p>
          </div>
        ) : (
          <EmptyState
            title="No settled picks yet"
            description="Once games complete and the 3 AM cron settles them, the rolling record fills in here."
          />
        )}
      </section>

      {/* Per-rung calibration */}
      <section aria-labelledby="rung-calibration" className="space-y-3">
        <div>
          <h2 id="rung-calibration" className="text-xl font-semibold tracking-tight">
            Per-rung calibration
          </h2>
          <p className="text-sm text-ink-muted">
            Hit rate vs predicted average for each rung. Brier score is mean squared error
            (lower is better).
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card/20">
          <CalibrationTable perRung={rolling30Day.perRung} />
        </div>
      </section>

      {/* Daily activity chart */}
      <section aria-labelledby="daily-activity" className="space-y-3">
        <div>
          <h2 id="daily-activity" className="text-xl font-semibold tracking-tight">
            Daily activity
          </h2>
          <p className="text-sm text-ink-muted">
            Volume and outcome of Tracked picks per day, oldest on the left.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card/20 p-4 sm:p-6">
          <HistoryChart byDate={byDate} />
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted font-mono">
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-hit/80" aria-hidden="true" />
              hits
            </li>
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-miss/60" aria-hidden="true" />
              misses
            </li>
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-ink-muted/30" aria-hidden="true" />
              pending
            </li>
          </ul>
        </div>
      </section>

      {/* Recent picks */}
      <section aria-labelledby="recent-picks" className="space-y-3">
        <h2 id="recent-picks" className="text-xl font-semibold tracking-tight">
          Recent settled picks
        </h2>

        {recentPicks.length === 0 ? (
          <EmptyState
            title="Nothing settled yet"
            description="The most recent 30 settled picks will show here as soon as the daily 3 AM cron runs."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card/20">
            <div className="overflow-x-auto">
              {/* min-w keeps the 6 columns readable on narrow viewports inside
                  the horizontal-scroll wrapper. */}
              <table className="w-full min-w-[640px] text-sm font-mono">
                <thead>
                  <tr className="border-b border-border bg-card/50 text-xs uppercase tracking-wider text-ink-muted">
                    <th scope="col" className="px-3 py-2 text-left">Date</th>
                    <th scope="col" className="px-3 py-2 text-left">Player</th>
                    <th scope="col" className="px-3 py-2 text-right">Rung</th>
                    <th scope="col" className="px-3 py-2 text-right">Pred</th>
                    <th scope="col" className="px-3 py-2 text-right">Actual</th>
                    <th scope="col" className="px-3 py-2 text-right">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPicks.slice(0, 30).map((p, i) => (
                    <tr
                      key={`${p.gameId}-${p.player.playerId}-${p.rung}-${i}`}
                      className="border-b border-border/50 last:border-b-0 hover:bg-card/40"
                    >
                      <td className="px-3 py-2 text-ink-muted whitespace-nowrap">{p.date}</td>
                      <td className="px-3 py-2 text-ink">{p.player.fullName}</td>
                      <td className="px-3 py-2 text-right">{p.rung}+</td>
                      <td className="px-3 py-2 text-right">{(p.pMatchup * 100).toFixed(0)}%</td>
                      <td className="px-3 py-2 text-right">{p.actualHRR ?? '—'}</td>
                      <td
                        className={
                          'px-3 py-2 text-right font-semibold ' +
                          (p.outcome === 'HIT'
                            ? 'text-hit'
                            : p.outcome === 'MISS'
                              ? 'text-miss'
                              : 'text-ink-muted')
                        }
                      >
                        {/* Glyph + label so the outcome is legible without colour
                            (red/green colour-blindness affects ~8% of men). */}
                        <span aria-hidden="true" className="mr-1">
                          {p.outcome === 'HIT' ? '✓' : p.outcome === 'MISS' ? '✗' : '·'}
                        </span>
                        {p.outcome}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

function PageHeader() {
  return (
    <header className="space-y-1">
      <h1 className="text-3xl font-semibold tracking-tight">History</h1>
      <p className="text-sm text-ink-muted">
        Rolling 30-day Tracked record, per-rung calibration, and recent settled picks.
      </p>
    </header>
  )
}
