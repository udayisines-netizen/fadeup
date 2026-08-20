import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Where you are in the booking, and what you have already decided.
 *
 * Two elements, and they answer different questions.
 *
 * PROGRESS answers "how much more of this is there?". V1 had no answer at
 * all: five screens that each looked like the last, with no way to tell
 * whether picking a professional was the end or the middle. That uncertainty
 * is what makes people abandon a flow they would otherwise have finished.
 *
 * CRUMBS answer "what did I choose?" — and, because each is a button, they
 * also answer "can I change it?" without a chain of Back taps. This is the
 * thing customers actually do: pick a time, then reconsider the service.
 *
 * Skipped steps are not rendered. A single-location shop with one eligible
 * professional genuinely has a three-step booking, and showing two greyed
 * cells the customer never sees would misrepresent the flow to make the
 * component's life easier.
 */

export interface BookingStep {
  key: string
  label: string
}

export function BookingStepRail({
  steps,
  currentIndex,
  className,
}: {
  steps: BookingStep[]
  currentIndex: number
  className?: string
}) {
  const { t } = useTranslation('booking')

  if (steps.length < 2) return null

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <ol className="flex items-center gap-1.5" aria-hidden="true">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
              index < currentIndex ? 'bg-accent-600' : index === currentIndex ? 'bg-accent-400' : 'bg-paper-200',
            )}
          />
        ))}
      </ol>

      {/* The visible label IS the live region: the bar above it is decoration
          a screen reader cannot use, and duplicating the sentence into a
          separate sr-only node would put the same text in the accessibility
          tree twice. */}
      <p className="text-xs font-medium text-ink-500" role="status">
        {t('steps.stepOf', { current: currentIndex + 1, total: steps.length, label: steps[currentIndex]?.label ?? '' })}
      </p>
    </div>
  )
}

export interface BookingCrumb {
  key: string
  label: string
  onEdit: () => void
}

export function BookingCrumbs({ crumbs, className }: { crumbs: BookingCrumb[]; className?: string }) {
  const { t } = useTranslation('booking')

  if (crumbs.length === 0) return null

  return (
    <div className={cn('fu-scroll-x -mx-4 flex gap-2 px-4 sm:mx-0 sm:flex-wrap sm:px-0', className)}>
      {crumbs.map((crumb) => (
        <button
          key={crumb.key}
          type="button"
          onClick={crumb.onEdit}
          className={cn(
            'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-paper-0 ps-3 pe-2.5 text-xs font-medium text-ink-700',
            'hover:border-accent-300 hover:text-ink-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
          )}
        >
          <Check className="h-3 w-3 text-accent-600" aria-hidden="true" />
          <span className="max-w-[12rem] truncate">{crumb.label}</span>
          {/* The visible chevron is decoration; the accessible name carries
              the intent, because "Fade" alone does not say it is editable. */}
          <span className="sr-only">— {t('crumbs.change')}</span>
          <ChevronRight className="h-3 w-3 text-ink-300 rtl:hidden" aria-hidden="true" />
          <ChevronLeft className="hidden h-3 w-3 text-ink-300 rtl:block" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
