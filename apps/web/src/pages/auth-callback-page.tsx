import { useEffect } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import { useMyAccess, resolveDestination } from '@/lib/queries/access'
import { parseAuthIntent } from '@/lib/oauth'
import { safeInternalPath } from '@/lib/safe-redirect'
import { PageSpinner } from '@/components/ui/spinner'
import { AuthCard } from '@/components/auth/auth-card'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Link } from 'react-router-dom'

/**
 * /auth/callback — the single place every Google and Apple sign-in lands,
 * whichever door it started at.
 *
 * Deliberately ONE callback rather than three. Three would mean three
 * implementations of "who is this and where do they belong", which is
 * exactly how a platform door ends up with a weaker check than the customer
 * one. The routing decision itself lives in resolveDestination() so it can
 * be unit-tested exhaustively without a browser.
 *
 * The security-critical part is what this page does NOT do: it never reads
 * the provider, the email domain, or anything in user_metadata. It asks the
 * database, through get_my_access(), and routes on the answer. Someone who
 * signs in through /platform/login with a Google account that has no
 * platform_members row is sent to /workspace, not /platform — and even if
 * this file were wrong, RequirePlatformRole and the RLS on every platform
 * table would still refuse them.
 */
export function AuthCallbackPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading: authLoading } = useAuth()

  const intent = parseAuthIntent(searchParams.get('intent'))
  // Re-validated here, not merely trusted from the query string: this value
  // made a round trip through an external identity provider since we last
  // saw it.
  const next = safeInternalPath(searchParams.get('next'))

  // GoTrue reports a refused or failed authorization in the query string
  // (and, for the implicit flow, the hash). Read both.
  const hashParams = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '',
  )
  const providerError =
    searchParams.get('error_description') ??
    searchParams.get('error') ??
    hashParams.get('error_description') ??
    hashParams.get('error')

  const accessQuery = useMyAccess(user?.id)

  useEffect(() => {
    if (providerError || authLoading || !user) return
    if (accessQuery.isPending || accessQuery.isError) return

    navigate(resolveDestination({ access: accessQuery.data ?? null, intent, next }), { replace: true })
  }, [providerError, authLoading, user, accessQuery.isPending, accessQuery.isError, accessQuery.data, intent, next, navigate])

  if (providerError) {
    return (
      <AuthCard title={t('social.failedTitle')} subtitle={t('social.failedSubtitle')}>
        <Alert variant="error">{providerError}</Alert>
        <Link to={loginPathFor(intent)} className={buttonVariants({ variant: 'secondary' }, 'mt-6 w-full')}>
          {t('social.backToSignIn')}
        </Link>
      </AuthCard>
    )
  }

  // No session once Supabase has finished restoring one: the visitor opened
  // this URL directly, or the exchange failed silently. Send them back to
  // the door they came from rather than leaving them on a blank callback.
  if (!authLoading && !user) {
    return <Navigate to={loginPathFor(intent)} replace />
  }

  if (accessQuery.isError) {
    return (
      <AuthCard title={t('social.failedTitle')} subtitle={t('social.failedSubtitle')}>
        <Alert variant="error">{accessQuery.error.message}</Alert>
        <Link to="/workspace" className={buttonVariants({ variant: 'secondary' }, 'mt-6 w-full')}>
          {t('social.continueAnyway')}
        </Link>
      </AuthCard>
    )
  }

  return <PageSpinner label={t('social.signingIn')} />
}

function loginPathFor(intent: ReturnType<typeof parseAuthIntent>): string {
  if (intent === 'platform') return '/platform/login'
  if (intent === 'pro') return '/pro/login'
  return '/login'
}
