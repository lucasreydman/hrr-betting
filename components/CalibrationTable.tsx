import type { HistoryResponse } from '@/app/api/history/route'

export function CalibrationTable({ perRung }: { perRung: HistoryResponse['rolling30Day']['perRung'] }) {
  return (
    <table className="w-full text-sm font-mono">
      <thead>
        <tr className="border-b border-border text-xs uppercase tracking-wider text-ink-muted">
          <th className="text-left py-2">Rung</th>
          <th className="text-right">Record</th>
          <th className="text-right">Hit %</th>
          <th className="text-right">Predicted Avg</th>
          <th className="text-right">Brier</th>
          <th className="text-right">Calibration</th>
        </tr>
      </thead>
      <tbody>
        {([1, 2, 3] as const).map(rung => {
          const r = perRung[rung]
          const calibrationDelta = r.total > 0 ? r.rate - r.predictedAvg : 0
          const calibrationLabel = r.total === 0 ? 'no data' :
            Math.abs(calibrationDelta) < 0.05 ? 'good' :
            calibrationDelta > 0 ? 'underconfident' :
            'overconfident'
          return (
            <tr key={rung} className="border-b border-border/50">
              <td className="py-3 text-base">{rung}+ HRR</td>
              <td className="text-right">{r.hits}-{r.total - r.hits}</td>
              <td className="text-right">{(r.rate * 100).toFixed(1)}%</td>
              <td className="text-right">{(r.predictedAvg * 100).toFixed(1)}%</td>
              <td className="text-right">{r.brier.toFixed(3)}</td>
              <td className={`text-right text-xs ${
                calibrationLabel === 'good' ? 'text-hit' :
                calibrationLabel === 'no data' ? 'text-ink-muted' :
                'text-amber-500'
              }`}>{calibrationLabel}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
