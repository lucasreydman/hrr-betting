import Link from 'next/link'
import { CalibrationTable } from '@/components/CalibrationTable'
import { HistoryChart } from '@/components/HistoryChart'
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
      <main className="max-w-5xl mx-auto p-6">
        <h1 className="text-3xl font-semibold mb-4">History</h1>
        <p className="text-ink-muted">Unable to load history.</p>
      </main>
    )
  }

  const { rolling30Day, byDate, recentPicks } = history

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">History</h1>
        <p className="text-ink-muted text-sm mt-1">Rolling 30-day Tracked record</p>
      </header>

      <section className="space-y-2 p-6 border border-border rounded-lg bg-card/30">
        <div className="text-5xl font-bold font-mono">
          {rolling30Day.overall.total > 0 ? (
            <>
              {rolling30Day.overall.hits}-{rolling30Day.overall.total - rolling30Day.overall.hits}
              <span className="text-ink-muted text-2xl ml-3">→ {(rolling30Day.overall.rate * 100).toFixed(1)}%</span>
            </>
          ) : (
            <span className="text-ink-muted text-2xl">no settled picks yet</span>
          )}
        </div>
        <p className="text-ink-muted text-sm">overall Tracked hit rate (last 30 days)</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Per-rung calibration</h2>
        <div className="border border-border rounded-lg p-4 bg-card/20">
          <CalibrationTable perRung={rolling30Day.perRung} />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Daily activity</h2>
        <div className="border border-border rounded-lg p-4 bg-card/20">
          <HistoryChart byDate={byDate} />
          <div className="flex gap-4 text-xs text-ink-muted font-mono mt-2">
            <span><span className="inline-block w-3 h-3 bg-hit/80 mr-1"></span>hits</span>
            <span><span className="inline-block w-3 h-3 bg-miss/60 mr-1"></span>misses</span>
            <span><span className="inline-block w-3 h-3 bg-ink-muted/30 mr-1"></span>pending</span>
          </div>
        </div>
      </section>

      {recentPicks.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3">Recent settled picks</h2>
          <div className="border border-border rounded-lg overflow-hidden bg-card/20">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="border-b border-border bg-card/50 text-xs uppercase tracking-wider text-ink-muted">
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Player</th>
                  <th className="text-right p-2">Rung</th>
                  <th className="text-right p-2">Pred</th>
                  <th className="text-right p-2">Actual</th>
                  <th className="text-right p-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {recentPicks.slice(0, 30).map((p, i) => (
                  <tr key={`${p.gameId}-${p.player.playerId}-${p.rung}-${i}`} className="border-b border-border/50">
                    <td className="p-2 text-ink-muted">date</td>
                    <td className="p-2">{p.player.fullName}</td>
                    <td className="p-2 text-right">{p.rung}+</td>
                    <td className="p-2 text-right">{(p.pMatchup * 100).toFixed(0)}%</td>
                    <td className="p-2 text-right">{p.actualHRR ?? '—'}</td>
                    <td className={`p-2 text-right font-semibold ${p.outcome === 'HIT' ? 'text-hit' : p.outcome === 'MISS' ? 'text-miss' : 'text-ink-muted'}`}>
                      {p.outcome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="pt-8 text-center text-xs text-ink-muted">
        <Link href="/" className="hover:text-accent">← board</Link>
        <span className="mx-2">·</span>
        <a href="/methodology" className="hover:text-accent">methodology</a>
      </footer>
    </main>
  )
}
