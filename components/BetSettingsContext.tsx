'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * User-controlled bet sizing settings, persisted to localStorage so they
 * survive page reloads and apply across every PickRow on the board.
 *
 * Bankroll is dollars; kellyMultiplier is a fraction in (0, 1] applied to
 * the full Kelly fraction computed by lib/bet-sizing.ts. Default values
 * (bankroll $500, ¼ Kelly) match the safe-pro convention — quarter Kelly
 * survives moderate model miscalibration without giving up too much
 * theoretical EV. Users can adjust both at the top of the board.
 *
 * Hydration note: localStorage isn't available during SSR, so the provider
 * starts with the defaults on first paint, then swaps to the persisted
 * values on mount. This causes a one-frame flicker if the user has
 * non-default settings — acceptable, and the alternative (NoSSR wrapping
 * the entire board) is heavier.
 */

export interface BetSettings {
  bankroll: number
  kellyMultiplier: number
}

const DEFAULTS: BetSettings = {
  bankroll: 500,
  kellyMultiplier: 0.25,
}

const STORAGE_KEY_BANKROLL = 'hrr:bet:bankroll'
const STORAGE_KEY_KELLY = 'hrr:bet:kelly'

interface BetSettingsContextValue extends BetSettings {
  setBankroll: (n: number) => void
  setKellyMultiplier: (n: number) => void
}

const BetSettingsContext = createContext<BetSettingsContextValue | null>(null)

export function BetSettingsProvider({ children }: { children: ReactNode }) {
  const [bankroll, setBankrollState] = useState(DEFAULTS.bankroll)
  const [kellyMultiplier, setKellyState] = useState(DEFAULTS.kellyMultiplier)

  // Hydrate from localStorage after mount. We can't read it during render
  // (SSR has no localStorage); reading inside useEffect runs only on the
  // client. Wrapped in try/catch because some browsers (private mode in
  // older Safari) throw on localStorage access.
  useEffect(() => {
    try {
      const b = localStorage.getItem(STORAGE_KEY_BANKROLL)
      if (b !== null) {
        const parsed = Number(b)
        if (Number.isFinite(parsed) && parsed >= 0) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage on mount; SSR has no localStorage so this can't happen earlier
          setBankrollState(parsed)
        }
      }
      const k = localStorage.getItem(STORAGE_KEY_KELLY)
      if (k !== null) {
        const parsed = Number(k)
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) {
          setKellyState(parsed)
        }
      }
    } catch {
      // ignore — fall back to defaults
    }
  }, [])

  const setBankroll = (n: number) => {
    setBankrollState(n)
    try {
      localStorage.setItem(STORAGE_KEY_BANKROLL, String(n))
    } catch {
      // ignore
    }
  }

  const setKellyMultiplier = (n: number) => {
    setKellyState(n)
    try {
      localStorage.setItem(STORAGE_KEY_KELLY, String(n))
    } catch {
      // ignore
    }
  }

  return (
    <BetSettingsContext.Provider
      value={{ bankroll, kellyMultiplier, setBankroll, setKellyMultiplier }}
    >
      {children}
    </BetSettingsContext.Provider>
  )
}

export function useBetSettings(): BetSettingsContextValue {
  const ctx = useContext(BetSettingsContext)
  if (!ctx) {
    // The provider is mounted at the board root. If a component reads
    // the context outside of that subtree it's a wiring bug — fail loudly
    // instead of silently using defaults that drift from the board's UI.
    throw new Error('useBetSettings must be used inside BetSettingsProvider')
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Per-pick line storage (separate from the settings above).
// One row per (date, gameId, playerId, rung). Lines stick around so a
// reload mid-slate doesn't lose them, and so settled-day boards still show
// the lines you bet at.
// ---------------------------------------------------------------------------

export function lineStorageKey(args: {
  date: string  // YYYY-MM-DD or full ISO; we only key on the day part
  gameId: number
  playerId: number
  rung: 1 | 2 | 3
}): string {
  const day = args.date.slice(0, 10)
  return `hrr:bet:line:${day}:${args.gameId}:${args.playerId}:${args.rung}`
}

/** Read a stored line input (raw string the user typed). null if unset. */
export function readStoredLine(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Write a line. Empty string deletes the entry. */
export function writeStoredLine(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return
    if (value === '') {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // ignore
  }
}
