import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Compass, Sparkles, Users2, CalendarClock, Repeat2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import { useMyAppointments, useMyQueueStatus, type MyAppointment } from '@/lib/queries/customer-app'
import { computeFreshness } from '@/lib/personalization'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'

/**
 * /app/customer (index) — the contextual customer home. Priority per spec:
 * active queue state > upcoming appointment > rebooking context >
 * discovery. Every card here is backed by a real query result — no card
 * renders unless the data behind it actually exists (never a fabricated
 * "no appointments" dashboard or an invented freshness fact).
 */
export function CustomerHomePage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const profileQuery = useMyCustomerProfile(user?.id)
  const queueQuery = useMyQueueStatus(Boolean(user))
  const appointmentsQuery = useMyAppointments(Boolean(user))

  const isPending = profileQuery.isPending || queueQuery.isPending || appointmentsQuery.isPending
  const firstError = profileQuery.isError ? profileQuery.error : queueQuery.isError ? queueQuery.error : appointmentsQuery.isError ? appointmentsQuery.error : null

  const { nextAppointment, lastCompleted } = useMemo(() => {
    const appointments = appointmentsQuery.data ?? []
    const upcoming = appointments
      .filter((a) => (a.status === 'pending' || a.status === 'confirmed') && new Date(a.startsAt).getTime() > Date.now())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    const completed = appointments
      .filter((a) => a.status === 'completed')
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    return { nextAppointment: upcoming[0] ?? null, lastCompleted: completed[0] ?? null }
  }, [appointmentsQuery.data])

  if (isPending) {
    return <PageSpinner label={t('common:state.loadingEllipsis')} />
  }

  if (firstError) {
    return (
      <Container size="sm" className="py-10">
        <ErrorState title={t('customer-app:home.couldntLoadYourHome')} description={firstError.message} />
      </Container>
    )
  }

  const needsOnboarding = !profileQuery.data?.onboardingCompletedAt
  const activeQueueEntry = queueQuery.data?.[0] ?? null
  const freshness = computeFreshness(lastCompleted?.startsAt ?? null, profileQuery.data?.haircutFrequency ?? null)

  return (
    <Container size="sm" className="flex flex-col gap-4 py-6">
      {needsOnboarding ? (
        <Card elevated className="flex items-start gap-3 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink-950">{t('home.onboardingPromptTitle')}</h2>
            <p className="mt-1 text-sm text-ink-500">{t('home.onboardingPromptDescription')}</p>
            <Link to="/app/customer/onboarding" className={buttonVariants({ size: 'sm' }, 'mt-3')}>
              {t('home.onboardingPromptCta')}
            </Link>
          </div>
        </Card>
      ) : null}

      {activeQueueEntry ? (
        <Card elevated className="flex items-start gap-3 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700">
            <Users2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink-950">{t('home.queueTitle')}</h2>
            <p className="mt-1 text-sm text-ink-500">
              {activeQueueEntry.status === 'in_service'
                ? t('home.queueInService')
                : activeQueueEntry.status === 'called'
                  ? t('home.queueCalled')
                  : t('home.queuePosition', { count: Math.max(0, (activeQueueEntry.queuePosition ?? 1) - 1) })}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">{activeQueueEntry.organizationName}</p>
            <Link to={`/s/${activeQueueEntry.organizationSlug}/display`} className={buttonVariants({ size: 'sm' }, 'mt-3')}>
              {t('home.viewQueue')}
            </Link>
          </div>
        </Card>
      ) : nextAppointment ? (
        <Card elevated className="flex items-start gap-3 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700">
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink-950">{t('home.upcomingTitle')}</h2>
            <p className="mt-1 text-sm text-ink-500">
              {new Date(nextAppointment.startsAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {nextAppointment.barberDisplayName ? ` — ${t('home.upcomingWith', { barber: nextAppointment.barberDisplayName })}` : ''}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">{nextAppointment.organizationName}</p>
            <Link to="/app/customer/appointments" className={buttonVariants({ size: 'sm' }, 'mt-3')}>
              {t('home.viewAppointments')}
            </Link>
          </div>
        </Card>
      ) : lastCompleted ? (
        <RebookCard appointment={lastCompleted} daysSinceLastCut={freshness.daysSinceLastCut} isOverdue={freshness.isOverdue} />
      ) : null}

      <Card elevated className="p-6 text-center">
        <Compass className="mx-auto h-8 w-8 text-accent-600" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-semibold text-balance text-ink-950">{t('home.discoverTitle')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('home.discoverDescription')}</p>
        <Link to="/search" className={buttonVariants({ size: 'lg' }, 'mt-4 w-full')}>
          {t('home.discoverCta')}
        </Link>
      </Card>
    </Container>
  )
}

function RebookCard({ appointment, daysSinceLastCut, isOverdue }: { appointment: MyAppointment; daysSinceLastCut: number | null; isOverdue: boolean }) {
  const { t } = useTranslation('customer-app')
  const rebookHref =
    appointment.barberId && appointment.serviceId
      ? `/s/${appointment.organizationSlug}?barber=${appointment.barberId}&service=${appointment.serviceId}`
      : `/s/${appointment.organizationSlug}`

  return (
    <Card elevated className="flex items-start gap-3 p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700">
        <Repeat2 className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-ink-950">{isOverdue ? t('home.rebookOverdueTitle') : t('home.rebookTitle')}</h2>
        {daysSinceLastCut !== null ? (
          <p className="mt-1 text-sm text-ink-500">{t('home.lastCutDays', { count: daysSinceLastCut })}</p>
        ) : null}
        <Link to={rebookHref} className={buttonVariants({ size: 'sm' }, 'mt-3')}>
          {appointment.barberDisplayName ? t('home.rebookCta', { barber: appointment.barberDisplayName }) : t('home.discoverCta')}
        </Link>
      </div>
    </Card>
  )
}
