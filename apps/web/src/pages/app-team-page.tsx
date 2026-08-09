import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgMembers } from '@/lib/queries/memberships'
import { useOwnProfile } from '@/lib/queries/profile'
import {
  useCreateInvitation,
  useOrgInvitations,
  useRevokeInvitation,
  type OrgInvitation,
} from '@/lib/queries/invitations'
import { TextField } from '@/components/ui/text-field'
import { SelectField } from '@/components/ui/select-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
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

export function AppTeamPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership || !MANAGING_ROLES.has(currentMembership.role)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Alert variant="info">
          Team management is only available to shop owners and managers.{' '}
          <Link to="/app" className="font-medium underline">
            Back to home
          </Link>
        </Alert>
      </main>
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
  const membersQuery = useOrgMembers(organizationId)
  const invitationsQuery = useOrgInvitations(organizationId)
  const ownProfileQuery = useOwnProfile(user?.id)
  const createInvitation = useCreateInvitation()
  const revokeInvitation = useRevokeInvitation(organizationId)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdLink, setCreatedLink] = useState<string | null>(null)

  const assignableRoles = useMemo(
    () => (role === 'owner' ? MEMBERSHIP_ROLES : MEMBERSHIP_ROLES.filter((r) => r !== 'owner')),
    [role],
  )

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
      reset({ email: '', role: values.role })
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('duplicate')) {
        setCreateError('There is already a pending invitation for that email.')
        return
      }
      setCreateError(error instanceof Error ? error.message : 'Failed to create invitation.')
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold text-neutral-900">Team</h1>
      <p className="mt-1 text-sm text-neutral-500">Manage members and pending invitations.</p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Members</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {membersQuery.isPending ? (
            <div className="flex justify-center p-6">
              <Spinner label="Loading members" />
            </div>
          ) : membersQuery.isError ? (
            <div className="p-4">
              <Alert variant="error">Couldn&apos;t load members: {membersQuery.error.message}</Alert>
            </div>
          ) : membersQuery.data.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No members yet" />
            </div>
          ) : (
            <ul>
              {membersQuery.data.map((member) => {
                const isSelf = member.userId === user?.id
                return (
                  <li
                    key={member.membershipId}
                    className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 last:border-b-0"
                  >
                    <span className="text-sm text-neutral-900">
                      {isSelf ? (ownProfileQuery.data ?? 'You') : `Member ${member.userId.slice(0, 8)}`}
                      {isSelf ? <span className="ml-2 text-xs text-neutral-400">(you)</span> : null}
                    </span>
                    <span className="text-sm text-neutral-500">{ROLE_LABELS[member.role]}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {!membersQuery.isPending && !membersQuery.isError && membersQuery.data.length > 0 ? (
          <p className="mt-2 text-xs text-neutral-400">
            Teammate display names aren&apos;t visible across the organization yet — a later lot adds
            org-scoped staff profiles.
          </p>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Pending invitations</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {invitationsQuery.isPending ? (
            <div className="flex justify-center p-6">
              <Spinner label="Loading invitations" />
            </div>
          ) : invitationsQuery.isError ? (
            <div className="p-4">
              <Alert variant="error">
                Couldn&apos;t load invitations: {invitationsQuery.error.message}
              </Alert>
            </div>
          ) : invitationsQuery.data.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No pending invitations" />
            </div>
          ) : (
            <ul>
              {invitationsQuery.data.map((invitation) => (
                <PendingInvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  onRevoke={() => revokeInvitation.mutate(invitation.id)}
                  isRevoking={revokeInvitation.isPending && revokeInvitation.variables === invitation.id}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Invite someone</h2>
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="mt-3 flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4"
        >
          {createError ? <Alert variant="error">{createError}</Alert> : null}
          {createdLink ? (
            <Alert variant="success">
              Invitation created. Share this link with them:{' '}
              <a href={createdLink} className="break-all font-medium underline">
                {createdLink}
              </a>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex-1">
              <TextField
                label="Email"
                type="email"
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
      </section>
    </main>
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
    <li className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm text-neutral-900">{invitation.email}</p>
        <p className="text-xs text-neutral-500">
          {ROLE_LABELS[invitation.role]} · expires {new Date(invitation.expiresAt).toLocaleDateString()}
        </p>
      </div>
      <Button variant="danger" isLoading={isRevoking} onClick={onRevoke}>
        Revoke
      </Button>
    </li>
  )
}
