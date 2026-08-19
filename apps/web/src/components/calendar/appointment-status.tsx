import { Badge, type BadgeVariant } from '@/components/ui/badge'
import type { AppointmentResolution, CalendarAppointmentStatus } from '@/lib/queries/calendar'

/**
 * How an appointment's state reads on screen, in one place.
 *
 * Status is NEVER communicated by colour alone. Every badge carries its own
 * word, and the calendar additionally varies border weight and fill, because a
 * shop floor is exactly where someone is colour-blind, the tablet is in
 * sunlight, or the screen is being read from three metres away.
 */

export const STATUS_LABELS: Record<CalendarAppointmentStatus, string> = {
  pending: 'Awaiting your answer',
  confirmed: 'Confirmed',
  completed: 'Done',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

/** The compact form, for a calendar block where there is no room for a sentence. */
export const STATUS_SHORT_LABELS: Record<CalendarAppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Done',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

const STATUS_VARIANTS: Record<CalendarAppointmentStatus, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
}

/**
 * Why a cancelled appointment ended.
 *
 * `cancelled` covers five genuinely different events, and which one it was
 * changes what the shop should do next — chase the customer, or nothing at
 * all. LOT C recorded the distinction; this is where it becomes visible.
 */
const RESOLUTION_LABELS: Record<AppointmentResolution, string> = {
  declined: 'Declined',
  expired: 'Expired unanswered',
  cancelled_by_customer: 'Cancelled by customer',
  cancelled_by_business: 'Cancelled by the shop',
  rescheduled: 'Moved to another time',
}

export function statusLabel(
  status: CalendarAppointmentStatus,
  resolution: AppointmentResolution | null,
): string {
  if (status === 'cancelled' && resolution) return RESOLUTION_LABELS[resolution]
  return STATUS_LABELS[status]
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
  return (
    <Badge variant={STATUS_VARIANTS[status]}>
      {short ? STATUS_SHORT_LABELS[status] : statusLabel(status, resolution ?? null)}
    </Badge>
  )
}

/** Statuses that still occupy the barber's chair. Everything else is history. */
export function isLive(status: CalendarAppointmentStatus): boolean {
  return status === 'pending' || status === 'confirmed'
}
