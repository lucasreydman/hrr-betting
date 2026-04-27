import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** Short headline. Keep it specific (e.g. "No tracked picks yet"). */
  title: string
  /** Optional helper paragraph explaining why and what happens next. */
  description?: string
  /** Optional primary action — a link or button rendered to the right of the copy on wide screens. */
  action?: ReactNode
  /** Visual emphasis — neutral by default, `attention` for warmer/amber tone. */
  tone?: 'neutral' | 'attention' | 'error'
}

/**
 * Shared empty / informational placeholder. Used for "no picks for this rung",
 * "no settled history yet", and similar quiet states. Keeps copy and styling
 * consistent across the app.
 */
export function EmptyState({ title, description, action, tone = 'neutral' }: EmptyStateProps) {
  const toneClasses =
    tone === 'attention'
      ? 'border-tracked/30 bg-tracked/5 text-ink'
      : tone === 'error'
        ? 'border-miss/40 bg-miss/5 text-ink'
        : 'border-border bg-card/30 text-ink'

  return (
    <div
      className={
        'flex flex-col items-start gap-3 rounded-lg border px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 ' +
        toneClasses
      }
      role="status"
    >
      <div className="space-y-1">
        <p className="text-base font-medium">{title}</p>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
