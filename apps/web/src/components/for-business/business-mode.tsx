import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { BUSINESS_MODES, cycleMode, type BusinessMode } from '@/lib/commerce/plans'

/**
 * The active business mode — global page state for /for-business.
 *
 * "What kind of barber business do you run?" is the first question the page
 * asks, and the answer changes everything after it: the hero, the product
 * world, which scenes are told, how complex the shop looks, and which plans the
 * pricing section offers. That is only possible if the answer lives in ONE
 * place rather than in each section's local state.
 *
 * Deliberately not in the URL. The mode is an exploratory gesture — a visitor
 * flicks through three shapes of business in the first five seconds — and
 * writing each flick into history would turn the browser Back button into an
 * undo button for a carousel, which is a well-known way to trap someone on a
 * landing page. Plan intent, which is a decision rather than a glance, IS
 * carried forward: see `/pro/register?plan=`.
 */

interface BusinessModeContextValue {
  mode: BusinessMode
  index: number
  total: number
  setMode: (mode: BusinessMode) => void
  /** Steps to the next/previous mode, wrapping at both ends. */
  step: (direction: 1 | -1) => void
}

const BusinessModeContext = createContext<BusinessModeContextValue | null>(null)

export function BusinessModeProvider({
  children,
  initialMode = 'barbershop',
}: {
  children: ReactNode
  initialMode?: BusinessMode
}) {
  /*
   * Barbershop is the default because it is the middle of the three in every
   * sense — it is FadeUp's core customer, and it sits between the other two on
   * the selector, so both neighbours are one step away in either direction.
   */
  const [mode, setMode] = useState<BusinessMode>(initialMode)

  const step = useCallback((direction: 1 | -1) => {
    setMode((current) => cycleMode(current, direction))
  }, [])

  const value = useMemo<BusinessModeContextValue>(
    () => ({
      mode,
      index: BUSINESS_MODES.indexOf(mode),
      total: BUSINESS_MODES.length,
      setMode,
      step,
    }),
    [mode, step],
  )

  return <BusinessModeContext.Provider value={value}>{children}</BusinessModeContext.Provider>
}

export function useBusinessMode(): BusinessModeContextValue {
  const ctx = useContext(BusinessModeContext)
  if (!ctx) throw new Error('useBusinessMode must be used within a BusinessModeProvider')
  return ctx
}
