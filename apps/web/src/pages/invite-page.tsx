import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuth } from '@/lib/auth-context'
import { useAcceptInvitation, useInvitationByToken } from '@/lib/queries/invitations'
import { setStoredOrganizationId } from '@/lib/current-organization'
import { getErrorMessage } from '@/lib/get-error-message'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  receptionist: 'Receptionist',
  barber: 'Barber',
}

export function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const invitationQuery = useInvitationByToken(token)
  const acceptMutation = useAcceptInvitation(token)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  if (invitationQuery.isPending || authLoading) {
    return <PageSpinner label="Loading invitation" />
  }

  if (invitationQuery.isError) {
    return (
      <AuthCard title="Something went wrong">
        <Alert variant="error">
          We couldn&apos;t load this invitation: {invitationQuery.error.message}
        </Alert>
      </AuthCard>
    )
  }

  const invitation = invitationQuery.data

  if (!invitation) {
    return (
      <AuthCard title="Invitation not found">
        <Alert variant="info">
          This invitation link doesn&apos;t exist. Ask whoever invited you for a new link.
        </Alert>
      </AuthCard>
    )
  }

  if (invitation.isRevoked) {
    return (
      <AuthCard title="Invitation revoked">
        <Alert variant="info">
          This invitation to join <strong>{invitation.organizationName}</strong> has been revoked.
        </Alert>
      </AuthCard>
    )
  }

  if (invitation.isAccepted) {
    return (
      <AuthCard title="Already accepted">
        <Alert variant="info">
          This invitation has already been accepted.{' '}
          <Link to="/pro/login" className="font-medium underline">
            Log in
          </Link>{' '}
          to continue.
        </Alert>
      </AuthCard>
    )
  }

  if (invitation.isExpired) {
    return (
      <AuthCard title="Invitation expired">
        <Alert variant="info">
          This invitation to join <strong>{invitation.organizationName}</strong> has expired. Ask for a
          new one.
        </Alert>
      </AuthCard>
    )
  }

  const redirectPath = `/invite/${token}`
  const emailMismatch = Boolean(user && user.email && user.email.toLowerCase() !== invitation.email)

  async function handleAccept() {
    setAcceptError(null)
    try {
      const result = await acceptMutation.mutateAsync(undefined)
      setStoredOrganizationId(result.organizationId)
      navigate('/app', { replace: true })
    } catch (error) {
      setAcceptError(getErrorMessage(error) ?? 'Failed to accept invitation.')
    }
  }

  return (
    <AuthCard
      title="You've been invited"
      subtitle={`Join ${invitation.organizationName} as ${ROLE_LABELS[invitation.role] ?? invitation.role}.`}
    >
      <div className="flex flex-col gap-4">
        {acceptError ? <Alert variant="error">{acceptError}</Alert> : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-500">Organization</dt>
          <dd className="text-ink-950">{invitation.organizationName}</dd>
          <dt className="text-ink-500">Role</dt>
          <dd className="text-ink-950">
            <Badge variant="accent">{ROLE_LABELS[invitation.role] ?? invitation.role}</Badge>
          </dd>
          <dt className="text-ink-500">Invited email</dt>
          <dd className="truncate text-ink-950">{invitation.email}</dd>
          {invitation.locationName ? (
            <>
              <dt className="text-ink-500">Location</dt>
              <dd className="text-ink-950">{invitation.locationName}</dd>
            </>
          ) : null}
        </dl>

        {!user ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-500">Log in or create an account to accept.</p>
            <div className="flex gap-2">
              <Link
                to={`/pro/login?redirect=${encodeURIComponent(redirectPath)}`}
                className={buttonVariants({ variant: 'secondary' }, 'flex-1')}
              >
                Log in
              </Link>
              <Link
                to={`/pro/signup?redirect=${encodeURIComponent(redirectPath)}`}
                className={buttonVariants({ variant: 'primary' }, 'flex-1')}
              >
                Sign up
              </Link>
            </div>
          </div>
        ) : emailMismatch ? (
          <Alert variant="error">
            This invitation was sent to <strong>{invitation.email}</strong>, but you&apos;re logged in as{' '}
            <strong>{user.email}</strong>. Log in with the invited email to accept.
          </Alert>
        ) : (
          <Button
            className="w-full"
            isLoading={acceptMutation.isPending}
            onClick={() => void handleAccept()}
          >
            Accept invitation
          </Button>
        )}
      </div>
    </AuthCard>
  )
}
