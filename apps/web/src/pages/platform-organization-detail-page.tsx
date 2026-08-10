import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useOrganization } from '@/lib/queries/platform'
import { useOrgLocations } from '@/lib/queries/locations'
import { useOrgMembers } from '@/lib/queries/memberships'
import { useOrgStaffProfiles, type StaffProfile } from '@/lib/queries/staff-profiles'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useSupportView } from '@/routes/platform-support-view-context'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import type { MembershipRole } from '@/lib/types'

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  receptionist: 'Receptionist',
  barber: 'Barber',
}

/** /platform/organizations/:organizationId — CLAUDE.md's tenant explorer: organization → locations → team → barber. */
export function PlatformOrganizationDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>()
  const { toast } = useToast()
  const { activeSession, enterSupportView, isEntering } = useSupportView()

  const organizationQuery = useOrganization(organizationId)
  const locationsQuery = useOrgLocations(organizationId)
  const membersQuery = useOrgMembers(organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(organizationId)
  const barbersQuery = useOrgBarbers(organizationId)

  const staffProfileByUserId = useMemo(() => {
    const map = new Map<string, StaffProfile>()
    for (const profile of staffProfilesQuery.data ?? []) map.set(profile.userId, profile)
    return map
  }, [staffProfilesQuery.data])

  const barberStaffProfileIds = useMemo(
    () => new Set((barbersQuery.data ?? []).filter((b) => b.isBookable).map((b) => b.staffProfileId)),
    [barbersQuery.data],
  )

  if (!organizationId) {
    return <Navigate to="/platform/organizations" replace />
  }

  const isLoading =
    organizationQuery.isPending || locationsQuery.isPending || membersQuery.isPending || staffProfilesQuery.isPending

  if (isLoading) {
    return <PageSpinner label="Loading organization" />
  }

  if (organizationQuery.isError) {
    return (
      <Container size="lg" className="py-8">
        <ErrorState title="Couldn't load organization" description={organizationQuery.error.message} />
      </Container>
    )
  }

  if (!organizationQuery.data) {
    return (
      <Container size="lg" className="py-8">
        <ErrorState title="Organization not found" />
      </Container>
    )
  }

  const organization = organizationQuery.data
  const isViewingThisOrg = activeSession?.organizationId === organizationId

  async function handleEnterSupportView() {
    try {
      await enterSupportView({ organizationId: organizationId!, targetType: 'organization' })
      toast({ title: `Entered support view for ${organization.name}` })
    } catch (error) {
      toast({ title: "Couldn't enter support view", description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <Container size="lg" className="py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/platform/organizations" className="text-sm text-ink-500 hover:text-ink-950">
            ← Organizations
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-ink-950">{organization.name}</h1>
          <p className="mt-1 text-sm text-ink-500">
            /{organization.slug} · Created {new Date(organization.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Button variant="secondary" isLoading={isEntering} disabled={isViewingThisOrg} onClick={() => void handleEnterSupportView()}>
          {isViewingThisOrg ? 'Currently in support view' : 'Enter support view'}
        </Button>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Locations</h2>
        <div className="mt-3">
          {locationsQuery.isError ? (
            <ErrorState title="Couldn't load locations" description={locationsQuery.error.message} />
          ) : (locationsQuery.data ?? []).length === 0 ? (
            <EmptyState title="No locations yet" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(locationsQuery.data ?? []).map((location) => (
                <Card key={location.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink-950">{location.name}</span>
                      {!location.isActive ? <Badge variant="neutral">Inactive</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-ink-500">
                      {[location.city, location.region, location.country].filter(Boolean).join(', ') || 'No address on file'}
                    </p>
                    <p className="mt-1 text-xs text-ink-300">{location.timezone}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Team</h2>
        <div className="mt-3">
          {membersQuery.isError ? (
            <ErrorState title="Couldn't load team" description={membersQuery.error.message} />
          ) : (membersQuery.data ?? []).length === 0 ? (
            <EmptyState title="No team members yet" />
          ) : (
            <Table label="Team">
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(membersQuery.data ?? []).length === 0 ? (
                  <TableStateRow colSpan={3}>
                    <EmptyState title="No team members yet" className="border-none" />
                  </TableStateRow>
                ) : (
                  (membersQuery.data ?? []).map((member) => {
                    const staffProfile = staffProfileByUserId.get(member.userId)
                    const isBarber = staffProfile ? barberStaffProfileIds.has(staffProfile.id) : false
                    return (
                      <TableRow key={member.membershipId}>
                        <TableCell className="font-medium text-ink-950">
                          {staffProfile?.displayName ?? `Member ${member.userId.slice(0, 8)}`}
                        </TableCell>
                        <TableCell>
                          <Badge variant="neutral">{ROLE_LABELS[member.role]}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {isBarber ? (
                            <Link
                              to={`/platform/organizations/${organizationId}/barbers/${member.userId}`}
                              className="text-sm font-medium text-accent-700 underline-offset-2 hover:underline"
                            >
                              View Barber Workspace
                            </Link>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </Container>
  )
}
