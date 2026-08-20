import { useTranslation } from 'react-i18next'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import type { AppointmentResolution, CalendarAppointmentStatus } from '@/lib/queries/calendar'

/**
 * How an appointment's state reads on screen, in one place.
 *
 * Status is NEVER communicated by colour alone. Every badge carries its own
 * word, and the calendar additionally varies border weight and fill, because a
 * shop floor is exactly where someone is colour-blind, the tablet is in
 * sunlight, or the screen is being read from three metres away.
 *
 * ============================================================================
 * THE WORDS ARE TRANSLATED NOW
 * ============================================================================
 *
 * They were exported `Record<Status, string>` constants of English sentences —
 * "Awaiting your answer", "Cancelled by the shop" — rendered on every badge of
 * the Professional calendar, the dashboard and the agenda, in a product that
 * ships in ten languages.
 *
 * The audit tool built in LOT E did not catch them because it looks for text
 * in JSX, and these were values in an object literal one file away from where
 * they were rendered. That is exactly why they survived: they are invisible in
 * a review of the file that displays them.
 *
 * They are now hooks. A constant map cannot be translated — that is the whole
 * point — so `useAppointmentStatus()` is the only way to get a label, and
 * there is no non-hook export left to reach for by accident.
 */

const STATUS_VARIANTS: Record<CalendarAppointmentStatus, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
}

export function useAppointmentStatus() {
  const { t } = useTranslation('app')

  return {
    /**
     * The full form. A cancelled appointment says WHY where the reason is
     * recorded — `cancelled` covers five genuinely different events, and which
     * one it was changes whether the shop should chase the customer or do
     * nothing at all. LOT C recorded the distinction; this is where it becomes
     * visible.
     */
    label(status: CalendarAppointmentStatus, resolution: AppointmentResolution | null): string {
      if (status === 'cancelled' && resolution) return t(`appointmentResolution.${resolution}`)
      return t(`appointmentStatus.${status}`)
    },
    /** The compact form, for a calendar block with no room for a sentence. */
    shortLabel(status: CalendarAppointmentStatus): string {
      return t(`appointmentStatusShort.${status}`)
    },
    variant(status: CalendarAppointmentStatus): BadgeVariant {
      return STATUS_VARIANTS[status]
    },
  }
}

export function AppointmentStatusBadge({
  status,
  resolution,
  short,
}: {
  status: CalendarAppointmentStatus
  resolution?: AppointmentResolution | null
  short?: boolean
}) {
  const appointmentStatus = useAppointmentStatus()

  return (
    <Badge variant={appointmentStatus.variant(status)}>
      {short ? appointmentStatus.shortLabel(status) : appointmentStatus.label(status, resolution ?? null)}
    </Badge>
  )
}

/** Statuses that still occupy the barber's chair. Everything else is history. */
export function isLive(status: CalendarAppointmentStatus): boolean {
  return status === 'pending' || status === 'confirmed'
}
