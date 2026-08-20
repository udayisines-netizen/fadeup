import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgMembers, type OrgMember } from '@/lib/queries/memberships'
import { useOwnProfile } from '@/lib/queries/profile'
import { useOrgStaffProfiles, useUpdateStaffProfile, type StaffProfile } from '@/lib/queries/staff-profiles'
import { useOrgBarbers, useSetBarberBookable, type Barber } from '@/lib/queries/barbers'
import { useOrgLocations } from '@/lib/queries/locations'
import {
  useCreateInvitation,
  useOrgInvitations,
  useRevokeInvitation,
  type OrgInvitation,
} from '@/lib/queries/invitations'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { SelectField } from '@/components/ui/select-field'
import { Switch } from '@/components/ui/switch'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { MEMBERSHIP_ROLES, type MembershipRole } from '@/lib/types'
import { getErrorMessage } from '@/lib/get-error-message'
import { useTranslation } from 'react-i18next'

/*
 * The words come from i18n, not a constant: a `Record<Role, string>` is built
 * before any language is known, so it can only ever be English. `app:roles.*`
 * already existed and was already translated — this map was a duplicate that
 * quietly bypassed it.
 */

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])

const inviteSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  role: z.enum(['owner', 'manager', 'receptionist', 'barber']),
  locationId: z.string(),
})

type InviteFormValues = z.infer<typeof inviteSchema>

const NO_LOCATION_VALUE = ''

const profileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
  title: z.string(),
  bio: z.string(),
  locationId: z.string(),
  avatarUrl: z.string(),
  isPublic: z.boolean(),
})

type ProfileFormValues = z.infer<typeof profileSchema>

interface TeamRow {
  member: OrgMember
  staffProfile: StaffProfile | undefined
  barber: Barber | undefined
}

export function AppTeamPage() {
  const { t } = useTranslation()
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership || !MANAGING_ROLES.has(currentMembership.role)) {
    return (
      <Alert variant="info">
        {t('app:team.onlyOwnersAndManagers')}{' '}
        <Link to="/app" className="font-medium underline underline-offset-2">
          {t('app:team.backToHome')}
        </Link>
      </Alert>
    )
  }

  return <TeamManagement organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function TeamManagement({
  organizationId,
  role,
}: {
  organizationId: string
  role: MembershipRole
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { toast } = useToast()
  const membersQuery = useOrgMembers(organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(organizationId)
  const barbersQuery = useOrgBarbers(organizationId)
  const locationsQuery = useOrgLocations(organizationId)
  const invitationsQuery = useOrgInvitations(organizationId)
  const ownProfileQuery = useOwnProfile(user?.id)
  const createInvitation = useCreateInvitation()
  const revokeInvitation = useRevokeInvitation(organizationId)
  const setBarberBookable = useSetBarberBookable()
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdLink, setCreatedLink] = useState<string | null>(null)
  const [editingRow, setEditingRow] = useState<TeamRow | null>(null)

  const assignableRoles = useMemo(
    () => (role === 'owner' ? MEMBERSHIP_ROLES : MEMBERSHIP_ROLES.filter((r) => r !== 'owner')),
    [role],
  )

  const locationNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const location of locationsQuery.data ?? []) map.set(location.id, location.name)
    return map
  }, [locationsQuery.data])

  const staffProfileByUserId = useMemo(() => {
    const map = new Map<string, StaffProfile>()
    for (const profile of staffProfilesQuery.data ?? []) {
      map.set(profile.userId, profile)
    }
    return map
  }, [staffProfilesQuery.data])

  const barberByStaffProfileId = useMemo(() => {
    const map = new Map<string, Barber>()
    for (const barber of barbersQuery.data ?? []) {
      map.set(barber.staffProfileId, barber)
    }
    return map
  }, [barbersQuery.data])

  const isLoading = membersQuery.isPending || staffProfilesQuery.isPending || barbersQuery.isPending
  const loadError = membersQuery.error ?? staffProfilesQuery.error ?? barbersQuery.error
  const isError = membersQuery.isError || staffProfilesQuery.isError || barbersQuery.isError

  const teamRows: TeamRow[] = (membersQuery.data ?? []).map((member) => ({
    member,
    staffProfile: staffProfileByUserId.get(member.userId),
    barber: barberByStaffProfileId.get(staffProfileByUserId.get(member.userId)?.id ?? ''),
  }))

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'barber', locationId: NO_LOCATION_VALUE },
  })

  async function onSubmit(values: InviteFormValues) {
    setCreateError(null)
    setCreatedLink(null)

    if (!user) return

    try {
      const { token } = await createInvitation.mutateAsync({
        organizationId,
        email: values.email,
        role: values.role,
        invitedBy: user.id,
        locationId: values.locationId || null,
      })
      setCreatedLink(`${window.location.origin}/invite/${token}`)
      toast({ title: t('app:team.invitationCreated'), description: `Sent to ${values.email}.`, variant: 'success' })
      reset({ email: '', role: values.role, locationId: values.locationId })
    } catch (error) {
      if (getErrorMessage(error)?.toLowerCase().includes('duplicate')) {
        setCreateError('There is already a pending invitation for that email.')
        return
      }
      setCreateError(getErrorMessage(error) ?? 'Failed to create invitation.')
    }
  }

  function handleRevoke(invitation: OrgInvitation) {
    revokeInvitation.mutate(invitation.id, {
      onSuccess: () => {
        toast({ title: t('app:team.invitationRevoked'), description: `${invitation.email} can no longer accept it.` })
      },
      onError: (error) => {
        toast({
          title: t('app:team.couldnTRevokeInvitation'),
          description: getErrorMessage(error),
          variant: 'error',
        })
      },
    })
  }

  function handleToggleBarber(row: TeamRow, isBookable: boolean) {
    if (!row.staffProfile) return
    setBarberBookable.mutate(
      {
        organizationId,
        staffProfileId: row.staffProfile.id,
        barberId: row.barber?.id ?? null,
        isBookable,
      },
      {
        onSuccess: () => {
          toast({
            title: isBookable ? 'Marked as a barber' : 'Removed barber status',
            description: row.staffProfile?.displayName,
            variant: 'success',
          })
        },
        onError: (error) => {
          toast({
            title: t('app:team.couldntUpdateBarberStatus'),
            description: getErrorMessage(error),
            variant: 'error',
          })
        },
      },
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title={t('common:entity.team')} subtitle={t('app:team.manageMembersAndPendingInvitations')} />

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-950">{t('common:entity.members')}</h2>
        <div className="mt-3">
          {isLoading ? (
            <MembersSkeleton />
          ) : isError ? (
            <ErrorState title={t('app:team.couldntLoadMembers')} description={loadError?.message} />
          ) : (
            <Table label={t('common:entity.members')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:entity.member')}</TableHead>
                  <TableHead>{t('common:field.role')}</TableHead>
                  <TableHead>{t('common:field.title')}</TableHead>
                  <TableHead>{t('common:entity.barber')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common:action.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamRows.length === 0 ? (
                  <TableStateRow colSpan={5}>
                    <EmptyState title={t('app:team.noMembersYet')} className="border-none" />
                  </TableStateRow>
                ) : (
                  teamRows.map((row) => {
                    const isSelf = row.member.userId === user?.id
                    const displayName =
                      row.staffProfile?.displayName ??
                      (isSelf ? (ownProfileQuery.data ?? 'You') : `Member ${row.member.userId.slice(0, 8)}`)
                    const isBookable = row.barber?.isBookable ?? false

                    return (
                      <TableRow key={row.member.membershipId}>
                        <TableCell>
                          <span className="min-w-0 truncate">{displayName}</span>
                          {isSelf ? <span className="ml-2 text-xs text-ink-300">(you)</span> : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="neutral">{t(`app:roles.${row.member.role}`)}</Badge>
                        </TableCell>
                        <TableCell className="text-ink-500">{row.staffProfile?.title || '—'}</TableCell>
                        <TableCell>
                          <Switch
                            label={`${displayName} is a bookable barber`}
                            hideLabel
                            checked={isBookable}
                            disabled={!row.staffProfile || setBarberBookable.isPending}
                            onChange={(event) => handleToggleBarber(row, event.target.checked)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {isBookable && row.staffProfile ? (
                              <Link
                                to={`/app/team/${row.staffProfile.id}/workspace`}
                                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                              >
                                {t('app:team.workspace')}
                              </Link>
                            ) : null}
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!row.staffProfile}
                              onClick={() => setEditingRow(row)}
                            >
                              {t('common:action.edit')}
                            </Button>
                          </div>
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

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-950">{t('app:team.pendingInvitations')}</h2>
        <div className="mt-3">
          {invitationsQuery.isPending ? (
            <MembersSkeleton />
          ) : invitationsQuery.isError ? (
            <ErrorState title={t('app:team.couldntLoadInvitations')} description={invitationsQuery.error.message} />
          ) : (
            <Table label={t('app:team.pendingInvitations')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:field.email')}</TableHead>
                  <TableHead>{t('common:field.role')}</TableHead>
                  <TableHead>{t('common:entity.location')}</TableHead>
                  <TableHead>{t('common:field.expires')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common:action.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitationsQuery.data.length === 0 ? (
                  <TableStateRow colSpan={5}>
                    <EmptyState title={t('app:team.noPendingInvitations')} className="border-none" />
                  </TableStateRow>
                ) : (
                  invitationsQuery.data.map((invitation) => (
                    <PendingInvitationRow
                      key={invitation.id}
                      invitation={invitation}
                      locationName={invitation.locationId ? locationNameById.get(invitation.locationId) : undefined}
                      onRevoke={() => handleRevoke(invitation)}
                      isRevoking={revokeInvitation.isPending && revokeInvitation.variables === invitation.id}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-950">{t('app:team.inviteSomeone')}</h2>
        <Card className="mt-3">
          <CardContent className="p-4 pt-4">
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
              {createError ? <Alert variant="error">{createError}</Alert> : null}
              {createdLink ? (
                <Alert variant="success">
                  Share this link with them:{' '}
                  <a href={createdLink} className="break-all font-medium underline underline-offset-2">
                    {createdLink}
                  </a>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex-1">
                  <TextField
                    label={t('common:field.email')}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    spellCheck={false}
                    error={errors.email?.message}
                    {...register('email')}
                  />
                </div>
                <div className="sm:w-48">
                  <SelectField
                    label={t('common:field.role')}
                    error={errors.role?.message}
                    options={assignableRoles.map((role) => ({ value: role, label: t(`app:roles.${role}`) }))}
                    {...register('role')}
                  />
                </div>
                <div className="sm:w-56">
                  <SelectField
                    label={t('app:team.locationOptional')}
                    options={[
                      { value: NO_LOCATION_VALUE, label: 'No specific location' },
                      ...(locationsQuery.data ?? []).map((location) => ({ value: location.id, label: location.name })),
                    ]}
                    {...register('locationId')}
                  />
                </div>
              </div>

              <Button type="submit" isLoading={isSubmitting} className="sm:self-start">
                {t('app:team.sendInvitation')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      {editingRow?.staffProfile ? (
        <StaffProfileFormDialog
          key={editingRow.staffProfile.id}
          organizationId={organizationId}
          staffProfile={editingRow.staffProfile}
          locations={locationsQuery.data ?? []}
          onClose={() => setEditingRow(null)}
          onSaved={() => {
            toast({ title: t('app:team.profileUpdated'), variant: 'success' })
            setEditingRow(null)
          }}
        />
      ) : null}
    </div>
  )
}

function StaffProfileFormDialog({
  organizationId,
  staffProfile,
  locations,
  onClose,
  onSaved,
}: {
  organizationId: string
  staffProfile: StaffProfile
  locations: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const updateStaffProfile = useUpdateStaffProfile()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: staffProfile.displayName,
      title: staffProfile.title ?? '',
      bio: staffProfile.bio ?? '',
      locationId: staffProfile.locationId ?? NO_LOCATION_VALUE,
      avatarUrl: staffProfile.avatarUrl ?? '',
      isPublic: staffProfile.isPublic,
    },
  })

  async function onSubmit(values: ProfileFormValues) {
    setFormError(null)
    try {
      await updateStaffProfile.mutateAsync({
        id: staffProfile.id,
        organizationId,
        displayName: values.displayName,
        title: values.title || null,
        bio: values.bio || null,
        locationId: values.locationId || null,
        avatarUrl: values.avatarUrl.trim() || null,
        isPublic: values.isPublic,
      })
      onSaved()
    } catch (error) {
      setFormError(getErrorMessage(error) ?? 'Something went wrong.')
    }
  }

  const locationOptions = [
    { value: NO_LOCATION_VALUE, label: 'No primary location' },
    ...locations.map((location) => ({ value: location.id, label: location.name })),
  ]

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('app:team.editTeamMember')}</DialogTitle>
          <DialogDescription>Update {staffProfile.displayName}&apos;s profile.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField label={t('app:team.displayName')} error={errors.displayName?.message} {...register('displayName')} />
          <TextField label={t('common:field.title')} hint={t('app:team.eGMasterBarber')} {...register('title')} />
          <Textarea label={t('app:team.bio')} rows={3} {...register('bio')} />
          <TextField
            label={t('app:team.photoUrl')}
            type="url"
            hint={t('app:team.aLinkToASquare')}
            {...register('avatarUrl')}
          />
          <SelectField label={t('app:team.primaryLocation')} options={locationOptions} {...register('locationId')} />
          <Switch
            label={t('app:team.publicProfile')}
            description={t('app:team.visibleInPublicBookingAnd')}
            {...register('isPublic')}
          />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t('common:action.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              {t('app:team.saveChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PendingInvitationRow({
  invitation,
  locationName,
  onRevoke,
  isRevoking,
}: {
  invitation: OrgInvitation
  locationName: string | undefined
  onRevoke: () => void
  isRevoking: boolean
}) {
  const { t } = useTranslation()
  return (
    <TableRow>
      <TableCell className="max-w-[16rem] truncate">{invitation.email}</TableCell>
      <TableCell>
        <Badge variant="neutral">{t(`app:roles.${invitation.role}`)}</Badge>
      </TableCell>
      <TableCell className="text-ink-500">{locationName ?? '—'}</TableCell>
      <TableCell className="whitespace-nowrap text-ink-500">
        {new Date(invitation.expiresAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="danger" size="sm" isLoading={isRevoking} onClick={onRevoke}>
          {t('app:team.revoke')}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function MembersSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
