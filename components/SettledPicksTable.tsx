import type { SettledPick } from '@/lib/tracker'

/**
 * Tabular list of settled picks. Used by both /history (last 3 days) and
 * /history/all (full archive). Identical render path on both surfaces so
 * column widths, formatting, and sort order stay consistent.
 */
export function SettledPicksTable({ picks }: { picks: SettledPick[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/20">
      <div className="overflow-x-auto">
        {/* min-w keeps the 6 columns readable on narrow viewports inside the
            horizontal-scroll wrapper. */}
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
            {picks.map((p, i) => (
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
  )
}
