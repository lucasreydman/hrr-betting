/**
 * Sanitize an env value: strip whitespace and matching surrounding quotes.
 *
 * Some hosting platforms (Vercel, .env files) wrap values in quotes. This
 * helper normalises them so callers always see the inner string. Returns
 * undefined for unset/empty values.
 *
 * Lives in its own module so both lib/db.ts and lib/kv.ts can import it
 * without creating a circular dependency.
 */
export function sanitizeEnvValue(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1).trim() || undefined
  }
  return trimmed
}
