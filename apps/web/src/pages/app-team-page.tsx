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
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
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

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  receptionist: 'Receptionist',
  barber: 'Barber',
}

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])

const inviteSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  role: z.enum(['owner', 'manager', 'receptionist', 'barber']),
})

type InviteFormValues = z.infer<typeof inviteSchema>

const NO_LOCATION_VALUE = ''

const profileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
  title: z.string(),
  bio: z.string(),
  locationId: z.string(),
})

type ProfileFormValues = z.infer<typeof profileSchema>

interface TeamRow {
  member: OrgMember
  staffProfile: StaffProfile | undefined
  barber: Barber | undefined
}

export function AppTeamPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership || !MANAGING_ROLES.has(currentMembership.role)) {
    return (
      <Container size="md" className="py-8">
        <Alert variant="info">
          Team management is only available to shop owners and managers.{' '}
          <Link to="/app" className="font-medium underline underline-offset-2">
            Back to home
          </Link>
        </Alert>
      </Container>
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
    defaultValues: { role: 'barber' },
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
      })
      setCreatedLink(`${window.location.origin}/invite/${token}`)
      toast({ title: 'Invitation created', description: `Sent to ${values.email}.`, variant: 'success' })
      reset({ email: '', role: values.role })
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('duplicate')) {
        setCreateError('There is already a pending invitation for that email.')
        return
      }
      setCreateError(error instanceof Error ? error.message : 'Failed to create invitation.')
    }
  }

  function handleRevoke(invitation: OrgInvitation) {
    revokeInvitation.mutate(invitation.id, {
      onSuccess: () => {
        toast({ title: 'Invitation revoked', description: `${invitation.email} can no longer accept it.` })
      },
      onError: (error) => {
        toast({
          title: 'Couldn’t revoke invitation',
          description: error instanceof Error ? error.message : undefined,
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
            title: "Couldn't update barber status",
            description: error instanceof Error ? error.message : undefined,
            variant: 'error',
          })
        },
      },
    )
  }

  return (
    <Container size="md" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">Team</h1>
      <p className="mt-1 text-sm text-ink-500">Manage members and pending invitations.</p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-950">Members</h2>
        <div className="mt-3">
          {isLoading ? (
            <MembersSkeleton />
          ) : isError ? (
            <ErrorState title="Couldn't load members" description={loadError?.message} />
          ) : (
            <Table label="Members">
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Barber</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamRows.length === 0 ? (
                  <TableStateRow colSpan={5}>
                    <EmptyState title="No members yet" className="border-none" />
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
                          <Badge variant="neutral">{ROLE_LABELS[row.member.role]}</Badge>
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
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!row.staffProfile}
                            onClick={() => setEditingRow(row)}
                          >
                            Edit
                          </Button>
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
        <h2 className="text-sm font-semibold text-ink-950">Pending invitations</h2>
        <div className="mt-3">
          {invitationsQuery.isPending ? (
            <MembersSkeleton />
          ) : invitationsQuery.isError ? (
            <ErrorState title="Couldn't load invitations" description={invitationsQuery.error.message} />
          ) : (
            <Table label="Pending invitations">
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitationsQuery.data.length === 0 ? (
                  <TableStateRow colSpan={4}>
                    <EmptyState title="No pending invitations" className="border-none" />
                  </TableStateRow>
                ) : (
                  invitationsQuery.data.map((invitation) => (
                    <PendingInvitationRow
                      key={invitation.id}
                      invitation={invitation}
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
        <h2 className="text-sm font-semibold text-ink-950">Invite someone</h2>
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
                    label="Email"
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
                    label="Role"
                    error={errors.role?.message}
                    options={assignableRoles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                    {...register('role')}
                  />
                </div>
              </div>

              <Button type="submit" isLoading={isSubmitting} className="sm:self-start">
                Send invitation
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
            toast({ title: 'Profile updated', variant: 'success' })
            setEditingRow(null)
          }}
        />
      ) : null}
    </Container>
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
      })
      onSaved()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Something went wrong.')
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
          <DialogTitle>Edit team member</DialogTitle>
          <DialogDescription>Update {staffProfile.displayName}&apos;s profile.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField label="Display name" error={errors.displayName?.message} {...register('displayName')} />
          <TextField label="Title" hint='e.g. "Master Barber"' {...register('title')} />
          <Textarea label="Bio" rows={3} {...register('bio')} />
          <SelectField label="Primary location" options={locationOptions} {...register('locationId')} />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PendingInvitationRow({
  invitation,
  onRevoke,
  isRevoking,
}: {
  invitation: OrgInvitation
  onRevoke: () => void
  isRevoking: boolean
}) {
  return (
    <TableRow>
      <TableCell className="max-w-[16rem] truncate">{invitation.email}</TableCell>
      <TableCell>
        <Badge variant="neutral">{ROLE_LABELS[invitation.role]}</Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-ink-500">
        {new Date(invitation.expiresAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="danger" size="sm" isLoading={isRevoking} onClick={onRevoke}>
          Revoke
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
