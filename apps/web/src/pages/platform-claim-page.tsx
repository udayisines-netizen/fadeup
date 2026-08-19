import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuth } from '@/lib/auth-context'
import { useClaimPlatformOwnerBootstrap, useOwnPlatformRole } from '@/lib/queries/platform'
import { getErrorMessage } from '@/lib/get-error-message'
import { useTranslation } from 'react-i18next'

/**
 * /platform/claim/:token — the one-time bootstrap URL from CLAUDE.md's
 * platform-owner section. Deliberately unlinked from anywhere in the app;
 * only reachable by whoever the operator gave the raw token to
 * out-of-band. There is no "preview" lookup RPC for the token (unlike
 * /invite/:token's get_invitation_by_token) — public.platform_owner_
 * bootstrap_tokens has zero client-facing read path at all, by design, so
 * this page finds out whether the token is valid the same way the RPC
 * does: by actually attempting the claim.
 */
export function PlatformClaimPage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const roleQuery = useOwnPlatformRole(user?.id)
  const claimMutation = useClaimPlatformOwnerBootstrap()
  const [claimError, setClaimError] = useState<string | null>(null)

  if (!token) {
    return <Navigate to="/" replace />
  }

  if (authLoading || (user && roleQuery.isPending)) {
    return <PageSpinner label={t('common:state.loading')} />
  }

  // Already platform staff (e.g. re-visiting an old claim link after
  // bootstrapping successfully) — nothing left to claim.
  if (roleQuery.data) {
    return <Navigate to="/platform" replace />
  }

  const redirectPath = `/platform/claim/${token}`

  async function handleClaim() {
    setClaimError(null)
    try {
      await claimMutation.mutateAsync(token!)
      navigate('/platform', { replace: true })
    } catch (error) {
      setClaimError(getErrorMessage(error) ?? 'Failed to claim platform ownership.')
    }
  }

  return (
    <AuthCard
      title={t('platform:claim.claimFadeupPlatformOwnership')}
      subtitle={t('platform:claim.thisCanOnlyBeDone')}
    >
      <div className="flex flex-col gap-4">
        {claimError ? <Alert variant="error">{claimError}</Alert> : null}

        {!user ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-500">{t('platform:claim.logInOrCreateAn')}</p>
            <div className="flex gap-2">
              <Link
                to={`/login?redirect=${encodeURIComponent(redirectPath)}`}
                className={buttonVariants({ variant: 'secondary' }, 'flex-1')}
              >
                {t('common:auth.logIn')}
              </Link>
              <Link
                to={`/register?redirect=${encodeURIComponent(redirectPath)}`}
                className={buttonVariants({ variant: 'primary' }, 'flex-1')}
              >
                {t('common:auth.signUp')}
              </Link>
            </div>
          </div>
        ) : (
          <Button className="w-full" isLoading={claimMutation.isPending} onClick={() => void handleClaim()}>
            {t('platform:claim.claimPlatformOwnership')}
          </Button>
        )}
      </div>
    </AuthCard>
  )
}
