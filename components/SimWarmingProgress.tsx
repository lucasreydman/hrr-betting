'use client'

import type { PicksResponse } from '@/lib/ranker'

interface Props {
  meta: PicksResponse['meta']
  /** Server-side timestamp when the picks payload was assembled (ISO string). */
  refreshedAt: string
}

/**
 * Sim-warming progress banner. Renders **only** when at least one game on the
 * slate doesn't yet have a sim cache entry. Hidden once everything is warmed.
 *
 * Visual:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Warming sims · 7 of 15 remaining                       53%   │
 *   │ Picks for these games will appear automatically as the       │
 *   │ simulations complete (typically within a minute or two).     │
 *   │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  next refresh 27 s │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The countdown is computed from `refreshedAt + 60 s` so it stays consistent
 * with the actual poll interval in ClientShell. Computed in a useEffect so
 * server / client renders don't disagree on the current second.
 */
// Phase 8: sim warming is removed — picks are now generated via closed-form
// computeProbToday, so every game on the slate produces picks on the first
// request. This component is kept as a no-op stub so existing imports in
// ClientShell continue to compile without changes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SimWarmingProgress({ meta, refreshedAt }: Props) {
  return null
}
