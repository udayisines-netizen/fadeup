import { useTranslation } from 'react-i18next'
import { CalendarX2, Clock } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useDateTime } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * "À PARTIR DE 17:30"
 * ============================================================================
 *
 * WHY THE WORDING IS THE WHOLE COMPONENT
 *
 * A marketplace that prints a bare "17:30" on a shop card is making a promise
 * it cannot keep. Availability in FadeUp is a function of four things —
 * location, professional, SERVICE and date — because a slot is only free if
 * it is long enough for the service being booked. `get_public_available_slots`
 * takes all four, and it takes them because it has to.
 *
 * So "17:30" is never true of a shop. It is true of one professional doing one
 * service on one day. "From 17:30" is the honest reduction: it says the door
 * opens no earlier than this, which remains true when the customer then picks
 * a longer service and finds the real first slot is 18:15.
 *
 * WHY THERE IS AN `unknown` STATE AND WHY IT SHOWS NOTHING
 *
 * Before a service is chosen there is no availability to state, and the
 * temptation is to fill the gap — with the shop's opening time, with the first
 * slot for the cheapest service, with anything. Each of those is a different
 * number wearing the same label. `unknown` renders nothing, and the card says
 * what it does know instead.
 *
 * `none` is a real and common answer — a fully-booked Saturday — and is said
 * plainly rather than being folded into the empty state, because "this barber
 * is busy today" and "this barber does not exist" must not look alike.
 */

export type AvailabilityState =
  /** Still resolving. Renders a skeleton sized to the resolved label. */
  | { status: 'pending' }
  /** No service context yet, so no honest statement exists. Renders nothing. */
  | { status: 'unknown' }
  /** Resolved, and there is nothing free in the window that was asked about. */
  | { status: 'none' }
  /** Resolved. `from` is an ISO instant; `timeZone` is the BUSINESS's zone. */
  | { status: 'from'; from: string; timeZone: string }

export function AvailabilityLabel({
  state,
  size = 'md',
  className,
}: {
  state: AvailabilityState
  size?: 'sm' | 'md'
  className?: string
}) {
  const { t } = useTranslation('marketplace')
  const dt = useDateTime()

  const text = size === 'sm' ? 'text-xs' : 'text-caption'
  const icon = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'

  if (state.status === 'unknown') return null

  if (state.status === 'pending') {
    // Sized to the resolved string rather than to a generic bar, so the card
    // does not resize when the answer lands. Layout shift on a list of
    // twenty cards is the difference between a marketplace that feels fast
    // and one that feels like it is still loading after it has loaded.
    return <Skeleton className={cn('h-4 w-28 rounded', className)} />
  }

  if (state.status === 'none') {
    return (
      <p className={cn('flex items-center gap-1.5 text-ink-500', text, className)}>
        <CalendarX2 className={cn('shrink-0', icon)} aria-hidden="true" />
        {t('availability.noneToday')}
      </p>
    )
  }

  return (
    <p className={cn('flex items-center gap-1.5 font-medium text-accent-700', text, className)}>
      <Clock className={cn('shrink-0', icon)} aria-hidden="true" />
      {/*
        The time is formatted in the SHOP's timezone and the READER's locale —
        a customer in Paris looking at a Tokyo salon must see Tokyo's 17:30,
        written the way their own language writes a time.
      */}
      {t('availability.from', { time: dt.time(state.from, state.timeZone) })}
    </p>
  )
}

/**
 * The earliest slot in a list, or `none` when the list is empty.
 *
 * Lives here rather than at each call site because "earliest" has one correct
 * definition and three plausible wrong ones — the first element of an array
 * the RPC happens to return in order, the first element after a client-side
 * sort on a locale-formatted string, or the minimum of the slot ENDS. This
 * compares ISO instants, which sort lexicographically only because they are
 * all UTC with the same precision; it uses `<` on the parsed values so that
 * stays true if the format ever changes.
 */
export function earliestSlot<T extends { slotStart: string }>(slots: T[]): T | null {
  let earliest: T | null = null
  for (const slot of slots) {
    if (!earliest || new Date(slot.slotStart) < new Date(earliest.slotStart)) {
      earliest = slot
    }
  }
  return earliest
}

/** Folds a slot query's three outcomes into the one shape the label takes. */
export function availabilityFrom(
  slots: Array<{ slotStart: string }> | undefined,
  timeZone: string | null | undefined,
  { isPending, hasServiceContext }: { isPending: boolean; hasServiceContext: boolean },
): AvailabilityState {
  if (!hasServiceContext) return { status: 'unknown' }
  if (isPending) return { status: 'pending' }
  const earliest = slots ? earliestSlot(slots) : null
  // A missing timezone is not "no availability" — it is a shop whose location
  // did not resolve, and printing a time in the wrong zone is worse than
  // printing none.
  if (!earliest || !timeZone) return { status: 'none' }
  return { status: 'from', from: earliest.slotStart, timeZone }
}
