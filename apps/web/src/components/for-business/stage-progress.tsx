import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/cn'

/**
 * Where you are in the four-stage story.
 *
 * Four marks, one elongated. The active one is a capsule rather than a bigger
 * dot because length reads as "you are here, and this is how long it lasts"
 * where size alone only reads as emphasis.
 *
 * Deliberately not wrapped in a card: it is an indicator, not a module, and
 * putting a glass panel around four small marks would be exactly the kind of
 * decorative rectangle the page is trying to shed.
 *
 * It is interactive, because a progress indicator a reader can see but not use
 * is a missed affordance: each mark is a real button that scrolls to its
 * stage, keyboard reachable and labelled with the stage title. The scroll is
 * `smooth` only when motion is welcome.
 */
export function StageProgress({
  count,
  active,
  titles,
  onSelect,
  className,
}: {
  count: number
  active: number
  /** Stage titles, used as the accessible name of each mark. */
  titles: string[]
  onSelect: (index: number) => void
  className?: string
}) {
  const { t } = useTranslation('landing')
  const reduced = useReducedMotion()

  return (
    <nav aria-label={t('business.stages.progressLabel')} className={className}>
      <ol className="flex flex-row gap-2 lg:flex-col lg:gap-2.5">
        {Array.from({ length: count }, (_, index) => {
          const isActive = index === active
          return (
            <li key={index}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={isActive ? 'step' : undefined}
                aria-label={titles[index] ?? String(index + 1)}
                className={cn(
                  'group block rounded-full',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pro-highlight)]',
                  // A comfortable hit area around a deliberately small mark.
                  'p-1.5',
                )}
              >
                <motion.span
                  className={cn(
                    'block rounded-full',
                    isActive ? 'bg-[var(--pro-highlight)]' : 'bg-[var(--pro-sage)]/35 group-hover:bg-[var(--pro-sage)]/60',
                  )}
                  initial={false}
                  animate={
                    isActive
                      ? { width: 'var(--w-active)', height: 'var(--h-active)' }
                      : { width: 'var(--w-idle)', height: 'var(--h-idle)' }
                  }
                  transition={reduced ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  /*
                   * The capsule grows along the scroll axis: vertically beside
                   * the story on desktop, horizontally under it on a phone.
                   * Driving that from CSS custom properties keeps one animation
                   * for both orientations.
                   */
                  style={
                    {
                      '--w-idle': '0.375rem',
                      '--h-idle': '0.375rem',
                      '--w-active': 'var(--progress-w-active, 0.375rem)',
                      '--h-active': 'var(--progress-h-active, 1.75rem)',
                    } as React.CSSProperties
                  }
                />
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
