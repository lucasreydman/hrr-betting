/**
 * One-shot cleanup: delete `locked_picks` rows whose snapshot values fail
 * the current 5-gate Tracked-tier floors.
 *
 * Why: floors were tightened retroactively on 2026-05-05 (added p̂ typical
 * + per-rung score gates). The lock cron uses the updated `classifyTier`
 * going forward, but rows that locked before the change were correctly
 * tracked under the *old* floors and would still be displayed via the
 * lock-overlay despite no longer passing the new bar. This script cleans
 * those out for a specific slate. `settled_picks` is left untouched (the
 * historical record is intact); only the live-board overlay is affected.
 *
 * Run: `npx tsx scripts/cleanup-failing-locked-picks.ts <YYYY-MM-DD>`
 *   Defaults to today's slate if no date passed.
 *   Pass --dry-run to preview what would be deleted without acting.
 *
 * Loads .env.local for SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same
 * pattern as scripts/recalibrate.ts).
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotEnvLocal(): void {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  const contents = readFileSync(path, 'utf8')
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx <= 0) continue
    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
loadDotEnvLocal()

import { getSupabase, isSupabaseAvailable } from '../lib/db'
import { slateDateString } from '../lib/date-utils'
import { classifyTier } from '../lib/ranker'
import type { LockedPickRow } from '../lib/db'
import type { Rung } from '../lib/types'

async function main(): Promise<void> {
  if (!isSupabaseAvailable()) {
    console.error('ERROR: Supabase is not configured. Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const datePositional = args.find(a => !a.startsWith('--'))
  const date = datePositional ?? slateDateString()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`ERROR: invalid date "${date}" — expected YYYY-MM-DD`)
    process.exit(1)
  }

  console.log(`Cleanup target: locked_picks for ${date} ${dryRun ? '(DRY RUN)' : ''}`)
  console.log('')

  const supabase = getSupabase()!
  const { data: rows, error } = await supabase
    .from('locked_picks')
    .select('*')
    .eq('date', date)
  if (error) {
    console.error(`Read failed: ${error.message}`)
    process.exit(1)
  }
  if (!rows || rows.length === 0) {
    console.log('No locked rows for this slate.')
    return
  }

  console.log(`Loaded ${rows.length} locked rows. Re-classifying against current floors…\n`)

  const failing: LockedPickRow[] = []
  for (const r of rows as LockedPickRow[]) {
    const tier = classifyTier({
      rung: r.rung as Rung,
      edge: r.edge,
      pMatchup: r.p_matchup,
      pTypical: r.p_typical,
      confidence: r.confidence,
      score: r.score,
    })
    if (tier !== 'tracked') failing.push(r)
  }

  if (failing.length === 0) {
    console.log('All locked rows still pass current floors. Nothing to delete.')
    return
  }

  console.log(`Failing rows (${failing.length}):`)
  for (const r of failing) {
    console.log(
      `  ${r.player_name.padEnd(20)} ${r.player_team} rung ${r.rung} | ` +
        `pT=${r.p_typical.toFixed(3)} pM=${r.p_matchup.toFixed(3)} ` +
        `e=${r.edge.toFixed(3)} c=${r.confidence.toFixed(3)} s=${r.score.toFixed(3)}`,
    )
  }
  console.log('')

  if (dryRun) {
    console.log('Dry run — no changes made. Re-run without --dry-run to delete.')
    return
  }

  // Delete by composite primary key tuples (date, game_id, player_id, rung)
  // — Supabase doesn't support multi-column IN clauses, so issue per-row
  // deletes inside a single Promise.all. Small N, fast enough.
  const deletions = await Promise.all(
    failing.map(r =>
      supabase
        .from('locked_picks')
        .delete()
        .eq('date', r.date)
        .eq('game_id', r.game_id)
        .eq('player_id', r.player_id)
        .eq('rung', r.rung),
    ),
  )
  const errs = deletions.map(d => d.error).filter(Boolean)
  if (errs.length) {
    console.error(`Some deletes failed:`, errs)
    process.exit(1)
  }

  console.log(`Deleted ${failing.length} rows from locked_picks.`)
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
