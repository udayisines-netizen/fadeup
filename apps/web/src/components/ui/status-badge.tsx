import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * State, readable without colour.
 *
 * Every status in FadeUp carries THREE signals: a word, a dot shape, and a
 * tint. That redundancy is not decoration — a barber reads this on a tablet in
 * a mirrored, brightly-lit room, and roughly one man in twelve cannot reliably
 * separate the red and green that most scheduling software relies on.
 *
 * `live` adds a slow pulse for genuinely in-progress states only. It is the
 * one animation allowed to loop, and it stops entirely under reduced motion.
 */

const TONES = {
  neutral: { chip: 'bg-paper-100 text-ink-700', dot: 'bg-ink-300' },
  accent: { chip: 'bg-accent-100 text-accent-800', dot: 'bg-accent-600' },
  success: { chip: 'bg-success-100 text-success-700', dot: 'bg-success-600' },
  warning: { chip: 'bg-warning-100 text-warning-700', dot: 'bg-warning-600' },
  danger: { chip: 'bg-danger-100 text-danger-700', dot: 'bg-danger-600' },
  info: { chip: 'bg-info-100 text-info-700', dot: 'bg-info-600' },
} as const

export type StatusTone = keyof typeof TONES

export function StatusBadge({
  children,
  tone = 'neutral',
  live,
  size = 'md',
  className,
}: {
  children: ReactNode
  tone?: StatusTone
  live?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  const { chip, dot } = TONES[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        chip,
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        {live ? (
          <span
            className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-70', dot)}
            style={{ animationDuration: '2s' }}
          />
        ) : null}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', dot)} />
      </span>
      {children}
    </span>
  )
}

/**
 * A bare dot, for places where the word is already adjacent — a timeline rail,
 * or a row whose label says "Open" right beside it.
 */
export function StatusDot({
  tone = 'neutral',
  live,
  className,
}: {
  tone?: StatusTone
  live?: boolean
  className?: string
}) {
  const { dot } = TONES[tone]
  return (
    <span className={cn('relative flex h-2 w-2', className)} aria-hidden="true">
      {live ? (
        <span
          className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-70', dot)}
          style={{ animationDuration: '2s' }}
        />
      ) : null}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', dot)} />
    </span>
  )
}
