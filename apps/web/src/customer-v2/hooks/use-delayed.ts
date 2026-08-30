import { useEffect, useRef, useState } from 'react'

/**
 * Timing helpers for the two loading problems that are actually different.
 *
 * MOTION_SYSTEM.md §17 asks for stable skeletons and preserved layout, and
 * DESIGN_SYSTEM.md warns against skeletons that make the product feel slower
 * than it is. Both are about the same thing: a placeholder that appears and
 * vanishes inside 120ms is a flash, and a flash reads as a bug.
 */

/**
 * True only once `active` has held for `delayMs`.
 *
 * A cached marketplace query resolves faster than a frame; showing skeletons
 * for it would be a flicker the customer registers as jank. Anything slower
 * than the delay is a real wait and deserves a real placeholder.
 */
export function useDelayedFlag(active: boolean, delayMs = 220): boolean {
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    if (!active) {
      setElapsed(false)
      return
    }
    const timer = setTimeout(() => setElapsed(true), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])

  return active && elapsed
}

/**
 * `value`, but only after it has stopped changing for `delayMs`.
 *
 * Home's search entry queries the real marketplace RPC. Firing on every
 * keystroke would mean a round trip per character and a results list that
 * reorders under the customer's thumb while they are still typing.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value)
  // Keeps the first render from waiting: an initial value is already settled.
  const isFirst = useRef(true)

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
