import { useEffect, useState, type ReactNode } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'
import { cn } from '@/lib/cn'

/**
 * The marketing pages' motion vocabulary — one system, built on `motion`,
 * which was already a dependency.
 *
 * Two rules hold everywhere below.
 *
 * Motion must explain a product behaviour. A queue entry moves because the
 * position changed; a card rises on entry because it just became relevant.
 * Nothing floats, pulses or glows for atmosphere.
 *
 * Reduced motion removes the movement, never the content. Every component
 * here renders exactly the same DOM either way — only the transform and the
 * timing are dropped — so the whole product story stays readable, and stays
 * in the accessibility tree, for someone who asked the OS for less movement.
 */

const EASE_OUT = [0.16, 1, 0.3, 1] as const

/** Rise-and-fade on entry. The default for editorial blocks. */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Component = 'div',
}: {
  children: ReactNode
  className?: string
  delay?: number
  as?: 'div' | 'section' | 'li' | 'p' | 'span'
}) {
  const reduced = useReducedMotion()
  const MotionComponent = motion[Component]

  return (
    <MotionComponent
      className={className}
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-12% 0px -12% 0px' }}
      transition={{ duration: 0.7, delay, ease: EASE_OUT }}
    >
      {children}
    </MotionComponent>
  )
}

/**
 * Staggers its children's entry. Used where a group arrives as a group —
 * a list of results, a row of states — rather than all at once.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.08,
  as: Component = 'div',
}: {
  children: ReactNode
  className?: string
  stagger?: number
  as?: 'div' | 'ul' | 'ol'
}) {
  const reduced = useReducedMotion()
  const MotionComponent = motion[Component]

  const variants: Variants = {
    hidden: {},
    shown: { transition: { staggerChildren: reduced ? 0 : stagger } },
  }

  return (
    <MotionComponent
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '-10% 0px -10% 0px' }}
    >
      {children}
    </MotionComponent>
  )
}

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT } },
}

const ITEM_VARIANTS_REDUCED: Variants = {
  hidden: { opacity: 1 },
  shown: { opacity: 1 },
}

export function RevealItem({
  children,
  className,
  as: Component = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'li'
}) {
  const reduced = useReducedMotion()
  const MotionComponent = motion[Component]

  return (
    <MotionComponent className={className} variants={reduced ? ITEM_VARIANTS_REDUCED : ITEM_VARIANTS}>
      {children}
    </MotionComponent>
  )
}

/**
 * Cycles through a set of states on a timer, pausing while off-screen and
 * settling on a chosen index when motion is reduced.
 *
 * This is how the product demonstrations animate: a queue advancing, a chair
 * filling. It returns an index rather than rendering anything, so the caller
 * decides what a state looks like.
 */
export function useDemoCycle(length: number, intervalMs = 2600, restIndex = 0): number {
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(reduced ? restIndex : 0)
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (reduced || !active || length <= 1) return
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % length), intervalMs)
    return () => window.clearInterval(timer)
  }, [reduced, active, length, intervalMs])

  // Only run while the tab is visible — a demo looping in a background tab is
  // pure battery cost.
  useEffect(() => {
    function onVisibility() {
      setActive(document.visibilityState === 'visible')
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return reduced ? restIndex : index
}

/**
 * Marks a block as a product illustration rather than live data.
 *
 * The marketing pages show what the product does using fixed, obviously
 * illustrative values. They must never be mistaken for a real search result
 * or a real queue, so every such surface carries this label — visible, not
 * just a code comment.
 */
export function DemoSurface({
  children,
  label,
  className,
}: {
  children: ReactNode
  label: string
  className?: string
}) {
  return (
    <figure className={cn('relative', className)}>
      {children}
      <figcaption className="mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-300">{label}</figcaption>
    </figure>
  )
}
