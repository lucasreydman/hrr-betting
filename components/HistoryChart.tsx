import type { HistoryResponse } from '@/app/api/history/route'

export function HistoryChart({ byDate }: { byDate: HistoryResponse['byDate'] }) {
  if (byDate.length === 0) {
    return <div className="text-ink-muted text-sm py-8 text-center">No settled history yet</div>
  }

  const W = 800
  const H = 200
  const barWidth = Math.max(2, Math.floor(W / byDate.length) - 2)
  const maxPicks = Math.max(...byDate.map(d => d.pickCount), 5)

  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full">
      {byDate.map((d, i) => {
        const x = i * (barWidth + 2)
        const totalH = (d.pickCount / maxPicks) * H
        const hitH = (d.hits / maxPicks) * H
        const missH = (d.miss / maxPicks) * H
        return (
          <g key={d.date}>
            <rect x={x} y={H - missH} width={barWidth} height={missH} className="fill-miss/60" />
            <rect x={x} y={H - missH - hitH} width={barWidth} height={hitH} className="fill-hit/80" />
            <rect x={x} y={H - totalH} width={barWidth} height={totalH - hitH - missH} className="fill-ink-muted/30" />
          </g>
        )
      })}
      <text x="0" y={H + 20} className="fill-ink-muted text-xs font-mono">{byDate[0]?.date.slice(5)}</text>
      <text x={W - 60} y={H + 20} className="fill-ink-muted text-xs font-mono">{byDate[byDate.length - 1]?.date.slice(5)}</text>
    </svg>
  )
}
