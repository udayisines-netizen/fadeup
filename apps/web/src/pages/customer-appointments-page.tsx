import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarX } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyAppointments, useCancelMyAppointment, type AppointmentStatus, type MyAppointment } from '@/lib/queries/customer-app'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'

const CANCELLABLE_STATUSES = new Set<AppointmentStatus>(['pending', 'confirmed'])

const STATUS_VARIANT: Record<AppointmentStatus, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'accent',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

/** /app/customer/appointments — upcoming/past, cancel (reuses the existing pending/confirmed status machine), and rebook. */
export function CustomerAppointmentsPage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const toast = useToast()
  const appointmentsQuery = useMyAppointments(Boolean(user))
  const cancelAppointment = useCancelMyAppointment()
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const { upcoming, past } = useMemo(() => {
    const all = appointmentsQuery.data ?? []
    // Status alone is not enough to mean "upcoming". Public bookings are
    // created `pending` and only apply_appointment_no_show_rule moves
    // `confirmed` rows on, so a request a shop never got round to
    // confirming would otherwise sit here forever with a live Cancel
    // button — while Home, which does check the date, showed nothing
    // upcoming at all. Same predicate as customer-home-page.tsx.
    const isUpcoming = (a: MyAppointment) =>
      CANCELLABLE_STATUSES.has(a.status) && new Date(a.startsAt).getTime() > Date.now()
    return {
      upcoming: all.filter(isUpcoming).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      past: all.filter((a) => !isUpcoming(a)).sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    }
  }, [appointmentsQuery.data])

  const cancellingAppointment = upcoming.find((a) => a.id === cancellingId) ?? null

  async function handleConfirmCancel() {
    if (!cancellingAppointment) return
    try {
      await cancelAppointment.mutateAsync(cancellingAppointment.id)
      setCancellingId(null)
    } catch (error) {
      toast.toast({ variant: 'error', title: t('appointments.cancelError'), description: getErrorMessage(error) ?? undefined })
    }
  }

  if (appointmentsQuery.isPending) {
    return <PageSpinner label="Loading…" />
  }

  if (appointmentsQuery.isError) {
    return (
      <Container size="sm" className="py-10">
        <ErrorState
          title={t('appointments.errorTitle')}
          description={appointmentsQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void appointmentsQuery.refetch()}>
              Try again
            </Button>
          }
        />
      </Container>
    )
  }

  return (
    <Container size="sm" className="flex flex-col gap-4 py-6">
      <h1 className="text-2xl font-semibold text-ink-950">{t('appointments.title')}</h1>

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">{t('appointments.upcomingTab')}</TabsTrigger>
          <TabsTrigger value="past">{t('appointments.pastTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming">
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarX} title={t('appointments.emptyUpcomingTitle')} description={t('appointments.emptyUpcomingDescription')} />
          ) : (
            <div className="flex flex-col gap-3">
              {upcoming.map((appointment) => (
                <AppointmentCard key={appointment.id} appointment={appointment} onCancel={() => setCancellingId(appointment.id)} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="past">
          {past.length === 0 ? (
            <EmptyState icon={CalendarX} title={t('appointments.emptyPastTitle')} description={t('appointments.emptyPastDescription')} />
          ) : (
            <div className="flex flex-col gap-3">
              {past.map((appointment) => (
                <AppointmentCard key={appointment.id} appointment={appointment} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={cancellingAppointment !== null} onOpenChange={(open) => !open && setCancellingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('appointments.cancelConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('appointments.cancelConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t('appointments.cancelConfirmDismiss')}</Button>
            </DialogClose>
            <Button variant="danger" onClick={() => void handleConfirmCancel()} isLoading={cancelAppointment.isPending}>
              {t('appointments.cancelConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Container>
  )
}

function AppointmentCard({ appointment, onCancel }: { appointment: MyAppointment; onCancel?: () => void }) {
  const { t } = useTranslation('customer-app')
  const rebookHref =
    appointment.status === 'completed' && appointment.barberId && appointment.serviceId
      ? `/s/${appointment.organizationSlug}?barber=${appointment.barberId}&service=${appointment.serviceId}`
      : null

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink-950">{appointment.organizationName}</p>
          <p className="text-sm text-ink-500">
            {appointment.serviceName ?? ''}
            {appointment.barberDisplayName ? ` · ${appointment.barberDisplayName}` : ''}
          </p>
          <p className="mt-1 text-sm text-ink-700">{formatDateTime(appointment.startsAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={STATUS_VARIANT[appointment.status]}>{t(`appointments.status${capitalize(appointment.status)}`)}</Badge>
          {appointment.priceCents !== null ? <span className="text-sm font-medium text-ink-950">{formatPrice(appointment.priceCents)}</span> : null}
        </div>
      </div>

      {onCancel || rebookHref ? (
        <div className="mt-3 flex gap-2">
          {onCancel ? (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              {t('appointments.cancel')}
            </Button>
          ) : null}
          {rebookHref ? (
            <Link to={rebookHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              {t('appointments.rebook')}
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function capitalize(status: AppointmentStatus): string {
  // Maps status enum values to i18n key suffixes: pending -> Pending, no_show -> NoShow.
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}
