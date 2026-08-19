import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useOrganization } from '@/lib/queries/platform'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useOrgBarberWorkingHours } from '@/lib/queries/barber-working-hours'
import { useOrgBarberServices } from '@/lib/queries/barber-services'
import { useBarberAvailabilityExceptions } from '@/lib/queries/barber-availability-exceptions'
import { useOrgServices } from '@/lib/queries/services'
import { useSupportView } from '@/routes/platform-support-view-context'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { useTranslation } from 'react-i18next'

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * /platform/organizations/:organizationId/barbers/:barberId — "View Barber
 * Workspace" (CLAUDE.md section 10/29). `:barberId` in the URL is the
 * barber's user_id (consistent with platform_support_sessions.target_user_id
 * and every other member-identity lookup in /platform) — resolved here to
 * the actual `barbers.id` row for the services/working-hours/exceptions
 * queries, which key off that instead.
 *
 * This is a read-only SNAPSHOT of the barber's schedule/service data using
 * the same is_platform_admin() read access every /platform page already
 * relies on — not a simulation of the barber's own /app UI (that would mean
 * reusing app-shell routes never designed for a non-member viewer). Opening
 * this page does not by itself start a support-view session; the button
 * below does, explicitly.
 */
export function PlatformBarberWorkspacePage() {
  const { t } = useTranslation()
  const { organizationId, barberId: barberUserId } = useParams<{ organizationId: string; barberId: string }>()
  const { toast } = useToast()
  const { activeSession, enterSupportView, isEntering } = useSupportView()

  const organizationQuery = useOrganization(organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(organizationId)
  const barbersQuery = useOrgBarbers(organizationId)
  const workingHoursQuery = useOrgBarberWorkingHours(organizationId)
  const barberServicesQuery = useOrgBarberServices(organizationId)
  const servicesQuery = useOrgServices(organizationId)

  const staffProfile = staffProfilesQuery.data?.find((p) => p.userId === barberUserId)
  const barber = barbersQuery.data?.find((b) => b.staffProfileId === staffProfile?.id)

  const exceptionsQuery = useBarberAvailabilityExceptions(organizationId, barber?.id)

  const serviceNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const service of servicesQuery.data ?? []) map.set(service.id, service.name)
    return map
  }, [servicesQuery.data])

  if (!organizationId || !barberUserId) {
    return <Navigate to="/platform/organizations" replace />
  }

  const isLoading =
    organizationQuery.isPending || staffProfilesQuery.isPending || barbersQuery.isPending || workingHoursQuery.isPending

  if (isLoading) {
    return <PageSpinner label={t('platform:workspace.loadingBarberWorkspace')} />
  }

  if (!staffProfile || !barber) {
    return (
      <Container size="md" className="py-8">
        <ErrorState title={t('platform:workspace.barberNotFoundInThis')} />
      </Container>
    )
  }

  const myWorkingHours = (workingHoursQuery.data ?? [])
    .filter((wh) => wh.barberId === barber.id)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)

  const myServices = (barberServicesQuery.data ?? [])
    .filter((bs) => bs.barberId === barber.id)
    .map((bs) => serviceNameById.get(bs.serviceId) ?? 'Unknown service')

  const isViewingThisBarber = activeSession?.targetUserId === barberUserId

  async function handleEnterSupportView() {
    try {
      await enterSupportView({ organizationId: organizationId!, targetType: 'barber', targetUserId: barberUserId })
      toast({ title: `Entered support view for ${staffProfile!.displayName}` })
    } catch (error) {
      toast({ title: t('platform:workspace.couldntEnterSupportView'), description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <Container size="md" className="py-8">
      <Link
        to={`/platform/organizations/${organizationId}`}
        className="text-sm text-ink-500 hover:text-ink-950"
      >
        ← {organizationQuery.data?.name ?? 'Organization'}
      </Link>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">{staffProfile.displayName}</h1>
          {staffProfile.title ? <p className="mt-1 text-sm text-ink-500">{staffProfile.title}</p> : null}
        </div>
        <Button
          variant="secondary"
          isLoading={isEntering}
          disabled={isViewingThisBarber}
          onClick={() => void handleEnterSupportView()}
        >
          {isViewingThisBarber ? 'Currently in support view' : 'Enter support view'}
        </Button>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t('common:entity.services')}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {myServices.length === 0 ? (
            <p className="text-sm text-ink-500">{t('platform:workspace.noServicesAssigned')}</p>
          ) : (
            myServices.map((name) => (
              <Badge key={name} variant="neutral">
                {name}
              </Badge>
            ))
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t('platform:workspace.weeklyHours')}</h2>
        <div className="mt-3 flex flex-col gap-1">
          {myWorkingHours.length === 0 ? (
            <p className="text-sm text-ink-500">{t('platform:workspace.noWorkingHoursSet')}</p>
          ) : (
            myWorkingHours.map((wh) => (
              <div key={wh.id} className="flex items-center justify-between border-b border-border py-1.5 text-sm">
                <span className="text-ink-700">{DAY_LABELS[wh.dayOfWeek]}</span>
                <span className="text-ink-500">{wh.isOff ? 'Off' : `${wh.startTime} – ${wh.endTime}`}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t('platform:workspace.upcomingExceptions')}</h2>
        <div className="mt-3 flex flex-col gap-1">
          {exceptionsQuery.isPending ? (
            <p className="text-sm text-ink-500">{t('common:state.loadingEllipsis')}</p>
          ) : (exceptionsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-500">{t('platform:workspace.noAvailabilityExceptionsOnFile')}</p>
          ) : (
            (exceptionsQuery.data ?? []).map((exception) => (
              <div key={exception.id} className="flex items-center justify-between border-b border-border py-1.5 text-sm">
                <span className="text-ink-700">{new Date(exception.exceptionDate).toLocaleDateString()}</span>
                <span className="text-ink-500">
                  {exception.isUnavailable ? 'Unavailable' : `${exception.startTime} – ${exception.endTime}`}
                  {exception.reason ? ` · ${exception.reason}` : ''}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </Container>
  )
}
