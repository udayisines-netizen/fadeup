import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * "THIS JUST CHANGED", WITHOUT LOOKING LIKE AN ERROR
 * ============================================================================
 *
 * §20: a realtime change must be VISIBLE. A number that silently becomes a
 * different number is the worst of both worlds — the screen is live and the
 * person watching it cannot tell, so they either miss the update or stop
 * trusting the screen.
 *
 * The rule §20 sets is equally clear about the other failure: no flashing, no
 * aggressive green pulse. A dashboard is open for eight hours in a room with
 * mirrors; anything that draws the eye repeatedly stops being information and
 * becomes a distraction someone eventually covers with a sticky note.
 *
 * So: the value briefly takes a tinted ground and settles back. One
 * transition, ~1.2 seconds, on a background colour only. No motion, no scale,
 * nothing that moves the layout — which also means there is nothing to disable
 * under `prefers-reduced-motion` beyond the transition itself, and the
 * highlight remains meaningful when it is.
 *
 * ============================================================================
 * WHAT COUNTS AS A CHANGE
 * ============================================================================
 *
 * The FIRST value is never highlighted. A page that lights up every number on
 * arrival has taught the viewer that the highlight means nothing, and by the
 * time a real change arrives they have stopped seeing it.
 *
 * `value` is the comparison key, kept separate from `children` on purpose:
 * children is formatted output ("€1,240.00", "3 waiting") and comparing
 * formatted strings makes a locale change or a re-render look like new data.
 */
export function RealtimeValue({
  value,
  children,
  className,
  /** Announced politely when the value changes. Omit for purely decorative numbers. */
  announce,
}: {
  value: string | number
  children: ReactNode
  className?: string
  announce?: string
}) {
  const previousRef = useRef(value)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    if (previousRef.current === value) return
    previousRef.current = value
    setChanged(true)
    const timer = setTimeout(() => setChanged(false), 1200)
    return () => clearTimeout(timer)
  }, [value])

  return (
    <span
      data-realtime-changed={changed ? 'true' : undefined}
      className={cn(
        'rounded-md transition-colors duration-[--fu-duration-settle] ease-[--fu-ease-out] motion-reduce:transition-none',
        // A tint, not a pulse. `-mx-1 px-1` so the ground extends slightly
        // past the glyphs instead of clipping them, without the surrounding
        // layout shifting when it appears.
        changed ? '-mx-1 bg-accent-100 px-1' : '',
        className,
      )}
    >
      {/*
        The visible value is not itself a live region: making it one would
        re-announce the whole number on every unrelated re-render. A separate
        polite message fires only on a real change, and only when the caller
        says this number is worth interrupting for.
      */}
      {announce && changed ? (
        <span role="status" className="sr-only">
          {announce}
        </span>
      ) : null}
      {children}
    </span>
  )
}
