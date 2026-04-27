import type { HistoryResponse } from '@/app/api/history/route'

export function HistoryChart({ byDate }: { byDate: HistoryResponse['byDate'] }) {
  if (byDate.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-ink-muted">
        No settled history yet.
      </div>
    )
  }

  const W = 800
  const H = 200
  const PAD_X = 16
  const PAD_BOTTOM = 24
  const drawW = W - PAD_X * 2
  const drawH = H - PAD_BOTTOM
  const barWidth = Math.max(2, Math.floor(drawW / byDate.length) - 2)
  const maxPicks = Math.max(...byDate.map(d => d.pickCount), 5)

  // Pick a small set of human-readable labels rather than crowding the axis.
  const firstDate = byDate[0]?.date ?? ''
  const lastDate = byDate[byDate.length - 1]?.date ?? ''
  const midDate = byDate[Math.floor(byDate.length / 2)]?.date ?? ''

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Bar chart of Tracked picks over ${byDate.length} day${byDate.length === 1 ? '' : 's'}`}
    >
      {/* Subtle baseline */}
      <line
        x1={PAD_X}
        x2={W - PAD_X}
        y1={drawH}
        y2={drawH}
        className="stroke-border"
        strokeWidth={1}
      />

      {byDate.map((d, i) => {
        const x = PAD_X + i * (barWidth + 2)
        const totalH = (d.pickCount / maxPicks) * drawH
        const hitH = (d.hits / maxPicks) * drawH
        const missH = (d.miss / maxPicks) * drawH
        const pendingH = Math.max(0, totalH - hitH - missH)
        return (
          <g key={d.date}>
            {/* Hover/tap title surfaces the date + counts in browser tooltip. */}
            <title>{`${d.date} · ${d.hits} hit / ${d.miss} miss / ${d.pending} pending`}</title>
            <rect x={x} y={drawH - missH} width={barWidth} height={missH} className="fill-miss/60" />
            <rect x={x} y={drawH - missH - hitH} width={barWidth} height={hitH} className="fill-hit/80" />
            <rect x={x} y={drawH - totalH} width={barWidth} height={pendingH} className="fill-ink-muted/30" />
          </g>
        )
      })}

      {/* Three labeled ticks (start / middle / end) — easier to read than two corner labels. */}
      <text x={PAD_X} y={H - 6} className="fill-ink-muted text-[10px] font-mono">
        {firstDate.slice(5)}
      </text>
      {byDate.length > 2 && (
        <text x={W / 2} y={H - 6} textAnchor="middle" className="fill-ink-muted text-[10px] font-mono">
          {midDate.slice(5)}
        </text>
      )}
      {byDate.length > 1 && (
        <text x={W - PAD_X} y={H - 6} textAnchor="end" className="fill-ink-muted text-[10px] font-mono">
          {lastDate.slice(5)}
        </text>
      )}
    </svg>
  )
}
