import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { usePlatformRole } from '@/routes/require-platform-role'
import {
  useAllPlatformMembers,
  useCreatePlatformInvitation,
  usePlatformInvitations,
  useRevokePlatformInvitation,
  type PlatformInvitation,
} from '@/lib/queries/platform'
import { TextField } from '@/components/ui/text-field'
import { SelectField } from '@/components/ui/select-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import type { PlatformRole } from '@/lib/types'

const ROLE_LABELS: Record<PlatformRole, string> = {
  platform_owner: 'Platform Owner',
  platform_admin: 'Platform Admin',
  platform_support: 'Platform Support',
}

const ROLE_BADGE_VARIANT: Record<PlatformRole, BadgeVariant> = {
  platform_owner: 'accent',
  platform_admin: 'info',
  platform_support: 'neutral',
}

// Matches create_platform_invitation's own authorization: platform_admin
// invites require platform_owner; platform_support invites require
// platform_owner OR platform_admin — never platform_owner via invitation at
// all (that's bootstrap/recovery-only).
const INVITABLE_ROLES_BY_CALLER: Record<PlatformRole, ('platform_admin' | 'platform_support')[]> = {
  platform_owner: ['platform_admin', 'platform_support'],
  platform_admin: ['platform_support'],
  platform_support: [],
}

const inviteSchema = z.object({
  role: z.enum(['platform_admin', 'platform_support']),
  invitedEmail: z.string(),
})

type InviteFormValues = z.infer<typeof inviteSchema>

/** /platform/team — platform staff roster + invitations. Only platform_owner/platform_admin can invite; every caller can view the full roster (RequirePlatformRole already gates entry to /platform to platform staff, so a platform_support caller landing here just sees no invite form). */
export function PlatformTeamPage() {
  const role = usePlatformRole()
  const { toast } = useToast()
  const membersQuery = useAllPlatformMembers()
  const invitationsQuery = usePlatformInvitations()
  const createInvitation = useCreatePlatformInvitation()
  const revokeInvitation = useRevokePlatformInvitation()
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdLink, setCreatedLink] = useState<string | null>(null)

  const invitableRoles = INVITABLE_ROLES_BY_CALLER[role]
  const pendingInvitations = (invitationsQuery.data ?? []).filter(
    (invitation) => !invitation.acceptedAt && !invitation.revokedAt,
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: invitableRoles[0] ?? 'platform_support', invitedEmail: '' },
  })

  async function onSubmit(values: InviteFormValues) {
    setCreateError(null)
    setCreatedLink(null)
    try {
      const { rawToken } = await createInvitation.mutateAsync({
        role: values.role,
        invitedEmail: values.invitedEmail.trim() || null,
      })
      setCreatedLink(`${window.location.origin}/platform/invite/${rawToken}`)
      toast({ title: 'Invitation created', variant: 'success' })
      reset({ role: values.role, invitedEmail: '' })
    } catch (error) {
      setCreateError(getErrorMessage(error) ?? 'Failed to create invitation.')
    }
  }

  function handleRevoke(invitation: PlatformInvitation) {
    revokeInvitation.mutate(invitation.id, {
      onSuccess: () => toast({ title: 'Invitation revoked' }),
      onError: (error) =>
        toast({ title: "Couldn't revoke invitation", description: getErrorMessage(error), variant: 'error' }),
    })
  }

  return (
    <Container size="md" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">Platform team</h1>
      <p className="mt-1 text-sm text-ink-500">Who has FadeUp platform access, and pending invitations.</p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-950">Members</h2>
        <div className="mt-3">
          {membersQuery.isPending ? (
            <RosterSkeleton />
          ) : membersQuery.isError ? (
            <ErrorState title="Couldn't load platform team" description={membersQuery.error.message} />
          ) : (
            <Table label="Platform team members">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(membersQuery.data ?? []).map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-mono text-xs text-ink-500">{member.userId}</TableCell>
                    <TableCell>
                      <Badge variant={ROLE_BADGE_VARIANT[member.role]}>{ROLE_LABELS[member.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-ink-500">{new Date(member.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-950">Pending invitations</h2>
        <div className="mt-3">
          {invitationsQuery.isPending ? (
            <RosterSkeleton />
          ) : invitationsQuery.isError ? (
            <ErrorState title="Couldn't load invitations" description={invitationsQuery.error.message} />
          ) : (
            <Table label="Pending platform invitations">
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  {invitableRoles.length > 0 ? (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.length === 0 ? (
                  <TableStateRow colSpan={invitableRoles.length > 0 ? 4 : 3}>
                    <EmptyState title="No pending invitations" className="border-none" />
                  </TableStateRow>
                ) : (
                  pendingInvitations.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell className="max-w-[16rem] truncate">{invitation.invitedEmail ?? 'Anyone with the link'}</TableCell>
                      <TableCell>
                        <Badge variant={ROLE_BADGE_VARIANT[invitation.role]}>{ROLE_LABELS[invitation.role]}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-500">
                        {new Date(invitation.expiresAt).toLocaleDateString()}
                      </TableCell>
                      {invitableRoles.length > 0 ? (
                        <TableCell className="text-right">
                          <Button
                            variant="danger"
                            size="sm"
                            isLoading={revokeInvitation.isPending && revokeInvitation.variables === invitation.id}
                            onClick={() => handleRevoke(invitation)}
                          >
                            Revoke
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {invitableRoles.length > 0 ? (
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
                      label="Email (optional)"
                      type="email"
                      hint="Leave blank to create a link anyone can use once."
                      autoComplete="off"
                      spellCheck={false}
                      {...register('invitedEmail')}
                    />
                  </div>
                  <div className="sm:w-56">
                    <SelectField
                      label="Role"
                      error={errors.role?.message}
                      options={invitableRoles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
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
      ) : null}
    </Container>
  )
}

function RosterSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
