import type { HistoryResponse } from '@/app/api/history/route'

type CalibrationLabel = 'accurate' | 'conservative' | 'optimistic' | 'no data'

function classify(rate: number, predictedAvg: number, total: number): CalibrationLabel {
  if (total === 0) return 'no data'
  const delta = rate - predictedAvg
  if (Math.abs(delta) < 0.05) return 'accurate'
  // delta > 0 = hit rate above forecast → model under-predicted = conservative
  // delta < 0 = hit rate below forecast → model over-predicted = optimistic
  return delta > 0 ? 'conservative' : 'optimistic'
}

// Distinct colours for the three meaningful verdicts so the table reads at a
// glance. Accurate stays green (the "we're calibrated" signal); conservative
// uses sky-blue (over-performance is positive news for the bettor); optimistic
// uses amber/warn (under-performance is a caution signal).
const LABEL_TONE: Record<CalibrationLabel, string> = {
  accurate: 'text-hit',
  conservative: 'text-sky-400',
  optimistic: 'text-warn',
  'no data': 'text-ink-muted',
}

export function CalibrationTable({ perRung }: { perRung: HistoryResponse['rolling30Day']['perRung'] }) {
  return (
    <div className="overflow-x-auto">
      {/* min-w keeps every column readable inside the scroll container; without
          it, a 320 px viewport crushes the "conservative" / "optimistic" labels
          into 3-line wrapping. */}
      <table className="w-full min-w-[520px] text-sm font-mono">
        <thead>
          <tr className="border-b border-border bg-card/50 text-xs uppercase tracking-wider text-ink-muted">
            <th scope="col" className="px-3 py-2 text-left">Rung</th>
            <th scope="col" className="px-3 py-2 text-right">Record</th>
            <th scope="col" className="px-3 py-2 text-right">Hit %</th>
            <th scope="col" className="px-3 py-2 text-right">Predicted</th>
            <th scope="col" className="px-3 py-2 text-right">Brier</th>
            <th scope="col" className="px-3 py-2 text-right">Calibration</th>
          </tr>
        </thead>
        <tbody>
          {([1, 2, 3] as const).map(rung => {
            const r = perRung[rung]
            const label = classify(r.rate, r.predictedAvg, r.total)
            return (
              <tr
                key={rung}
                className="border-b border-border/50 last:border-b-0 hover:bg-card/40"
              >
                <th scope="row" className="px-3 py-3 text-left text-base font-semibold text-ink">
                  {rung}+ HRR
                </th>
                <td className="px-3 py-3 text-right text-ink">
                  {r.hits}–{r.total - r.hits}
                </td>
                <td className="px-3 py-3 text-right text-ink">
                  {r.total > 0 ? `${(r.rate * 100).toFixed(1)}%` : '—'}
                </td>
                <td className="px-3 py-3 text-right text-ink-muted">
                  {r.total > 0 ? `${(r.predictedAvg * 100).toFixed(1)}%` : '—'}
                </td>
                <td className="px-3 py-3 text-right text-ink-muted">
                  {r.total > 0 ? r.brier.toFixed(3) : '—'}
                </td>
                <td className={`px-3 py-3 text-right text-[11px] uppercase tracking-wider ${LABEL_TONE[label]}`}>
                  {label}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
