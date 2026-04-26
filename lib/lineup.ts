/**
 * lib/lineup.ts
 *
 * Higher-level lineup composition layer.
 *
 * fetchLineup (the API call + 3-tier fallback) lives in lib/mlb-api.ts.
 * This module re-exports it for downstream convenience and adds lineupHash —
 * a deterministic 12-char SHA1 digest used as a sim cache-invalidation key.
 *
 * Cache semantics:
 *  - Same lineup contents and status → same hash → sim cache hits
 *  - Any slot-order or player-ID change → different hash → sim cache misses
 *  - 'estimated' → 'confirmed' upgrade → different hash (status is part of input)
 */

import { createHash } from 'crypto'
import type { Lineup } from './types'

/**
 * Produce a deterministic 12-character hex digest for `lineup`.
 *
 * The canonical form is:
 *   "<status>|<slot>:<playerId>|<slot>:<playerId>|..."
 * where entries are sorted ascending by slot before serialisation.
 *
 * Properties:
 *  - Deterministic: identical inputs always produce the same hash.
 *  - Slot-order sensitive: swapping two players' slots changes the hash.
 *  - Player-ID sensitive: changing any player ID changes the hash.
 *  - Status sensitive: estimated vs confirmed produce different hashes.
 */
export function lineupHash(lineup: Lineup): string {
  const canonical = lineup.entries
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map(e => `${e.slot}:${e.player.playerId}`)
    .join('|')
  return createHash('sha1')
    .update(`${lineup.status}|${canonical}`)
    .digest('hex')
    .slice(0, 12)
}

export { fetchLineup } from './mlb-api'
