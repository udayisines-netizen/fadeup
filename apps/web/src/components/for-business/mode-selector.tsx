import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { BUSINESS_MODES, type BusinessMode } from '@/lib/commerce/plans'
import { useBusinessMode } from '@/components/for-business/business-mode'
import { cn } from '@/lib/cn'

/**
 * The first interaction on /for-business: pick the shape of your business.
 *
 * Three ways in, all of them real controls, because a gesture that is the only
 * way to reach content is a gesture that excludes keyboard and screen-reader
 * users entirely:
 *
 *   - previous/next buttons (pointer, touch, and Enter/Space)
 *   - the progress dots, which are buttons that jump directly to a mode
 *   - arrow keys while the group has focus
 *
 * Swipe is added on top for phones, never as a substitute.
 *
 * RTL: the buttons are laid out in DOM order previous-then-next inside a
 * logical flex row, so Arabic mirrors the POSITIONS automatically while the
 * meanings stay attached to the right buttons. The chevrons rotate with the
 * direction; the underlying "previous" never silently becomes "next", which is
 * the usual bug when a carousel is mirrored mechanically.
 */

const SWIPE_THRESHOLD_PX = 48

export function ModeSelector({ className }: { className?: string }) {
  const { t, i18n } = useTranslation('landing')
  const { mode, index, total, setMode, step } = useBusinessMode()
  const reduced = useReducedMotion()
  const pointerStart = useRef<{ x: number; id: number } | null>(null)

  const isRtl = i18n.dir() === 'rtl'

  /**
   * Arrow keys follow READING direction, which is the opposite of what a naive
   * implementation does. In Arabic, "next" is to the left, so ArrowLeft must
   * advance — pressing the key that points at the next control should reach the
   * next control.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const forward = isRtl ? event.key === 'ArrowLeft' : event.key === 'ArrowRight'
      step(forward ? 1 : -1)
    },
    [isRtl, step],
  )

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return
    pointerStart.current = { x: event.clientX, id: event.pointerId }
  }, [])

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const start = pointerStart.current
      pointerStart.current = null
      if (!start || start.id !== event.pointerId) return
      const dx = event.clientX - start.x
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return
      // Dragging content leftwards reveals what is to its right: next.
      const forward = isRtl ? dx > 0 : dx < 0
      step(forward ? 1 : -1)
    },
    [isRtl, step],
  )

  return (
    <div
      className={cn('select-none', className)}
      role="group"
      aria-label={t('business.modes.groupLabel')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (pointerStart.current = null)}
    >
      {/*
        Capped width. The control appears twice — beside the hero's product
        world, and again at the pricing decision — and the second slot is a
        full-width card. Unconstrained, the two arrows drift to opposite edges
        of a 1000px box and stop reading as one control with a value between
        them.
      */}
      <div className="mx-auto flex max-w-sm items-center justify-center gap-2 sm:gap-5">
        <ArrowButton
          direction="prev"
          label={t('business.modes.previous')}
          onClick={() => step(-1)}
        />

        {/*
          Fixed minimum height: the three names are different lengths, and a
          container that resizes as you flick through them makes the whole page
          jump under the cursor.
        */}
        <div className="flex min-h-[4.5rem] min-w-0 flex-1 flex-col items-center justify-center sm:min-h-[5.5rem]">
          <span className="font-mono text-xs tabular-nums text-ink-500">
            {String(index + 1).padStart(2, '0')} <span className="text-border-strong">/</span>{' '}
            {String(total).padStart(2, '0')}
          </span>

          {/*
            Keyed remount, not an exit-then-enter crossfade: the name of the
            selected mode is the control's own value, and a control whose value
            is briefly blank after you press it feels broken.
          */}
          <motion.p
            key={mode}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="mt-1.5 text-center font-display text-[clamp(1.5rem,5vw,2.5rem)] uppercase leading-none tracking-[0.02em] text-ink-950"
          >
            {t(`business.modes.${mode}.name`)}
          </motion.p>
        </div>

        <ArrowButton
          direction="next"
          label={t('business.modes.next')}
          onClick={() => step(1)}
        />
      </div>

      {/*
        The dots are a control, not an ornament: three modes is few enough that
        jumping straight to yours beats stepping through the others, and on a
        phone they are the largest target on the screen.
      */}
      <div className="mx-auto mt-5 flex max-w-sm items-center justify-center gap-1">
        {BUSINESS_MODES.map((candidate) => (
          <ModeDot
            key={candidate}
            mode={candidate}
            active={candidate === mode}
            label={t(`business.modes.${candidate}.name`)}
            onSelect={setMode}
          />
        ))}
      </div>

      {/*
        Announced once, politely, so a screen-reader user who changes mode hears
        what changed instead of silence followed by a different page.
      */}
      <p aria-live="polite" className="sr-only">
        {t('business.modes.announce', { name: t(`business.modes.${mode}.name`) })}
      </p>
    </div>
  )
}

function ArrowButton({
  direction,
  label,
  onClick,
}: {
  direction: 'prev' | 'next'
  label: string
  onClick: () => void
}) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border-strong text-ink-700 transition-colors hover:bg-paper-100 hover:text-ink-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 sm:h-14 sm:w-14"
    >
      <Icon className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
    </button>
  )
}

function ModeDot({
  mode,
  active,
  label,
  onSelect,
}: {
  mode: BusinessMode
  active: boolean
  label: string
  onSelect: (mode: BusinessMode) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      // 44px hit area from the padding, a 2px rule as the visible mark. The
      // target is finger-sized; the indicator is not.
      className="group inline-flex h-11 w-14 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
    >
      <span
        className={cn(
          'h-0.5 w-full rounded-full transition-colors',
          active ? 'bg-accent-600' : 'bg-border-strong group-hover:bg-ink-300',
        )}
      />
    </button>
  )
}
