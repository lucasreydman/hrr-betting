import { EmptyState } from '@/components/EmptyState'
import { SettledPicksTable } from '@/components/SettledPicksTable'
import { headers } from 'next/headers'
import Link from 'next/link'
import type { HistoryAllResponse } from './../../api/history/all/route'

export const metadata = {
  title: 'All settled picks',
  description: 'Every Tracked pick the model has produced, newest-first.',
}

async function getAll(): Promise<HistoryAllResponse | null> {
  const headersList = await headers()
  const host = headersList.get('host') || 'localhost:3000'
  const proto = host.startsWith('localhost') ? 'http' : 'https'
  try {
    const res = await fetch(`${proto}://${host}/api/history/all`, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export default async function AllHistory() {
  const data = await getAll()

  if (!data) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <Header />
        <EmptyState
          title="Could not load picks"
          description="The history archive endpoint returned an error. Try refreshing in a few seconds."
        />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <Header />

      {data.picks.length === 0 ? (
        <EmptyState
          title="No settled picks yet"
          description="Once the daily settle cron writes its first row, the full archive shows up here."
        />
      ) : (
        <>
          <p className="font-mono text-xs text-ink-muted">
            {data.total} {data.total === 1 ? 'pick' : 'picks'}, newest first.
          </p>
          <SettledPicksTable picks={data.picks} />
        </>
      )}
    </main>
  )
}

function Header() {
  return (
    <header className="space-y-2">
      <Link
        href="/history"
        className="inline-flex items-center gap-1 font-mono text-xs text-ink-muted hover:text-ink"
      >
        ← Back to history
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">All settled picks</h1>
      <p className="text-sm text-ink-muted">
        Every Tracked pick the model has produced, newest first. The archive grows
        once per day after the settle cron runs.
      </p>
    </header>
  )
}
