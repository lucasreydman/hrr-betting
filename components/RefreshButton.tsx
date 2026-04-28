'use client'
import { useState, useTransition } from 'react'

export function RefreshButton(props: { onRefresh: () => Promise<void> }): React.ReactElement {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (isPending) return
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      try {
        await props.onRefresh()
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Refresh failed')
      }
    })
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        aria-busy={isPending}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-50"
      >
        {isPending ? 'Refreshing…' : 'Refresh now'}
      </button>
      {success && <span className="text-xs text-hit" role="status">Updated</span>}
      {error && <span className="text-xs text-miss" role="alert">{error}</span>}
    </div>
  )
}
