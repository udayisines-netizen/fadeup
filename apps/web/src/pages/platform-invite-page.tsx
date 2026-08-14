import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuth } from '@/lib/auth-context'
import { useAcceptPlatformInvitation, useOwnPlatformRole } from '@/lib/queries/platform'
import { getErrorMessage } from '@/lib/get-error-message'

/**
 * /platform/invite/:token — accepts a platform_admin/platform_support
 * invitation (see PlatformTeamPage). Separate from /platform/claim/:token:
 * that redeems a bootstrap token into platform_owner; this redeems an
 * invitation into whatever role the inviter chose. Same "no preview RPC"
 * shape as the claim page — platform_invitations has no read path for a
 * non-platform-staff caller, so this finds out validity by attempting the
 * accept, not by looking the token up first.
 */
export function PlatformInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const roleQuery = useOwnPlatformRole(user?.id)
  const acceptMutation = useAcceptPlatformInvitation()
  const [acceptError, setAcceptError] = useState<string | null>(null)

  if (!token) {
    return <Navigate to="/" replace />
  }

  if (authLoading || (user && roleQuery.isPending)) {
    return <PageSpinner label="Loading" />
  }

  if (roleQuery.data) {
    return <Navigate to="/platform" replace />
  }

  const redirectPath = `/platform/invite/${token}`

  async function handleAccept() {
    setAcceptError(null)
    try {
      await acceptMutation.mutateAsync(token!)
      navigate('/platform', { replace: true })
    } catch (error) {
      setAcceptError(getErrorMessage(error) ?? 'Failed to accept invitation.')
    }
  }

  return (
    <AuthCard title="Join the FadeUp platform team" subtitle="Accept this invitation to get platform access.">
      <div className="flex flex-col gap-4">
        {acceptError ? <Alert variant="error">{acceptError}</Alert> : null}

        {!user ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-500">Log in or create an account to continue.</p>
            <div className="flex gap-2">
              <Link
                to={`/login?redirect=${encodeURIComponent(redirectPath)}`}
                className={buttonVariants({ variant: 'secondary' }, 'flex-1')}
              >
                Log in
              </Link>
              <Link
                to={`/register?redirect=${encodeURIComponent(redirectPath)}`}
                className={buttonVariants({ variant: 'primary' }, 'flex-1')}
              >
                Sign up
              </Link>
            </div>
          </div>
        ) : (
          <Button className="w-full" isLoading={acceptMutation.isPending} onClick={() => void handleAccept()}>
            Accept invitation
          </Button>
        )}
      </div>
    </AuthCard>
  )
}
