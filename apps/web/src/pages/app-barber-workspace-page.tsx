import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useOrgBarberWorkingHours } from '@/lib/queries/barber-working-hours'
import { useOrgBarberServices } from '@/lib/queries/barber-services'
import { useBarberAvailabilityExceptions } from '@/lib/queries/barber-availability-exceptions'
import { useOrgServices } from '@/lib/queries/services'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import type { MembershipRole } from '@/lib/types'
import { useTranslation } from 'react-i18next'

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])

/**
 * /app/team/:staffProfileId/workspace — "View Barber Workspace" for a shop
 * owner/manager (CLAUDE.md section 14). Owner/manager already has full
 * read access to their own org's data via existing RLS — this is a
 * dedicated view, not a new privilege, so unlike the platform's
 * cross-tenant version (Phase D) there is no session/audit mechanism to
 * build: `useCurrentOrg()` only ever resolves to the caller's OWN
 * organization, so a mismatched `:staffProfileId` from another
 * organization simply matches no row here — tenant isolation falls out of
 * the existing per-org RLS scoping, not an extra check in this file.
 */
export function AppBarberWorkspacePage() {
  const { t } = useTranslation()
  const { staffProfileId } = useParams<{ staffProfileId: string }>()
  const { currentMembership } = useCurrentOrg()
  const organizationId = currentMembership?.organizationId

  const staffProfilesQuery = useOrgStaffProfiles(organizationId)
  const barbersQuery = useOrgBarbers(organizationId)
  const workingHoursQuery = useOrgBarberWorkingHours(organizationId)
  const barberServicesQuery = useOrgBarberServices(organizationId)
  const servicesQuery = useOrgServices(organizationId)

  const staffProfile = staffProfilesQuery.data?.find((p) => p.id === staffProfileId)
  const barber = barbersQuery.data?.find((b) => b.staffProfileId === staffProfileId)

  const exceptionsQuery = useBarberAvailabilityExceptions(organizationId, barber?.id)

  const serviceNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const service of servicesQuery.data ?? []) map.set(service.id, service.name)
    return map
  }, [servicesQuery.data])

  if (!currentMembership || !MANAGING_ROLES.has(currentMembership.role)) {
    return (
      <Container size="md" className="py-8">
        <ErrorState title={t('app:workspace.onlyShopOwnersAndManagers')} />
      </Container>
    )
  }

  if (!staffProfileId) {
    return <Navigate to="/app/team" replace />
  }

  const isLoading = staffProfilesQuery.isPending || barbersQuery.isPending || workingHoursQuery.isPending

  if (isLoading) {
    return <PageSpinner label={t('app:workspace.loadingBarberWorkspace')} />
  }

  if (!staffProfile || !barber) {
    return (
      <Container size="md" className="py-8">
        <ErrorState title={t('app:workspace.barberNotFound')} />
      </Container>
    )
  }

  const myWorkingHours = (workingHoursQuery.data ?? [])
    .filter((wh) => wh.barberId === barber.id)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)

  const myServices = (barberServicesQuery.data ?? [])
    .filter((bs) => bs.barberId === barber.id)
    .map((bs) => serviceNameById.get(bs.serviceId) ?? 'Unknown service')

  return (
    <div>
      <div className="border-b border-warning-600 bg-warning-100">
        <Container size="md" className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
          <span className="font-medium text-warning-700">
            Viewing {staffProfile.displayName}&apos;s workspace as Shop Owner
          </span>
          <Link to="/app/team" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            {t('app:workspace.returnToOwnerDashboard')}
          </Link>
        </Container>
      </div>

      <Container size="md" className="py-8">
        <h1 className="text-xl font-semibold text-ink-950">{staffProfile.displayName}</h1>
        {staffProfile.title ? <p className="mt-1 text-sm text-ink-500">{staffProfile.title}</p> : null}

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t('common:entity.services')}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {myServices.length === 0 ? (
              <p className="text-sm text-ink-500">{t('app:workspace.noServicesAssigned')}</p>
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t('app:workspace.weeklyHours')}</h2>
          <div className="mt-3 flex flex-col gap-1">
            {myWorkingHours.length === 0 ? (
              <p className="text-sm text-ink-500">{t('app:workspace.noWorkingHoursSet')}</p>
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t('app:workspace.upcomingExceptions')}</h2>
          <div className="mt-3 flex flex-col gap-1">
            {exceptionsQuery.isPending ? (
              <p className="text-sm text-ink-500">{t('common:state.loadingEllipsis')}</p>
            ) : (exceptionsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-500">{t('app:workspace.noAvailabilityExceptionsOnFile')}</p>
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
    </div>
  )
}
