import { CalibrationTable } from '@/components/CalibrationTable'
import { HistoryChart } from '@/components/HistoryChart'
import { EmptyState } from '@/components/EmptyState'
import { SettledPicksTable } from '@/components/SettledPicksTable'
import { headers } from 'next/headers'
import Link from 'next/link'
import type { HistoryResponse } from './../api/history/route'

export const metadata = {
  title: 'History',
}

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

  const { allTime, byDate, recentPicks, totalSettledCount } = history
  const wins = allTime.overall.hits
  const losses = allTime.overall.total - allTime.overall.hits
  const olderCount = Math.max(0, totalSettledCount - recentPicks.length)
  const hasSettled = allTime.overall.total > 0

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader />

      {/* Headline result */}
      <section
        aria-labelledby="all-time-overall"
        className="rounded-lg border border-border bg-card/30 px-5 py-4 sm:px-7 sm:py-5"
      >
        <h2 id="all-time-overall" className="sr-only">All-time overall record</h2>
        {hasSettled ? (
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <dl className="flex flex-wrap items-end gap-x-8 gap-y-3 sm:gap-x-12">
              <Stat label="Record" value={`${wins}–${losses}`} size="lg" />
              <Stat
                label="Hit rate"
                value={`${(allTime.overall.rate * 100).toFixed(1)}%`}
              />
              <Stat label="Settled picks" value={`${allTime.overall.total}`} />
            </dl>
            <span className="text-[11px] uppercase tracking-wider text-ink-muted">
              All-time Tracked
            </span>
          </div>
        ) : (
          <EmptyState
            title="No settled picks yet"
            description="Once games complete and the daily settle cron writes them, your record fills in here."
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
          <CalibrationTable perRung={allTime.perRung} />
        </div>
        <dl className="grid gap-2 rounded-lg border border-border bg-card/10 p-3 text-xs sm:grid-cols-3 sm:p-4">
          <div className="space-y-0.5">
            <dt className="font-mono uppercase tracking-wider text-hit">accurate</dt>
            <dd className="text-ink-muted">
              Hit rate matches predicted within ±5pp. The model&apos;s probabilities can be
              trusted as-is.
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="font-mono uppercase tracking-wider text-sky-400">conservative</dt>
            <dd className="text-ink-muted">
              You&apos;re hitting more often than predicted. The model is under-rating the
              picks it surfaces.
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="font-mono uppercase tracking-wider text-warn">optimistic</dt>
            <dd className="text-ink-muted">
              You&apos;re hitting less often than predicted. The model is over-rating the
              picks it surfaces.
            </dd>
          </div>
        </dl>
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

      {/* Recent picks (last 3 slate days) */}
      <section aria-labelledby="recent-picks" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="recent-picks" className="text-xl font-semibold tracking-tight">
            Recent settled picks
          </h2>
          <p className="text-xs text-ink-muted">From the last 3 slate days.</p>
        </div>

        {recentPicks.length === 0 ? (
          <EmptyState
            title="Nothing settled in the last 3 days"
            description="Settled picks from the last 3 slate days will show here. The full archive is on the show-all page."
          />
        ) : (
          <SettledPicksTable picks={recentPicks} />
        )}

        {olderCount > 0 && (
          <div className="flex justify-end">
            <Link
              href="/history/all"
              className="inline-flex items-center gap-1 rounded border border-border bg-card/40 px-3 py-1.5 font-mono text-xs text-ink hover:bg-card/70"
            >
              View all {totalSettledCount} settled picks →
            </Link>
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
        All-time Tracked record, per-rung calibration, and recent settled picks.
      </p>
    </header>
  )
}

function Stat({
  label,
  value,
  size = 'md',
}: {
  label: string
  value: string
  size?: 'md' | 'lg'
}) {
  const valueClass =
    size === 'lg'
      ? 'text-4xl font-bold sm:text-5xl'
      : 'text-2xl sm:text-3xl'
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] uppercase tracking-wider text-ink-muted">
        {label}
      </dt>
      <dd className={`font-mono tabular-nums leading-none text-ink ${valueClass}`}>
        {value}
      </dd>
    </div>
  )
}
