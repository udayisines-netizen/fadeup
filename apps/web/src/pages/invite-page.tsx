import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2 } from 'lucide-react'
import { AuthCard } from '@/components/auth/auth-card'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuth } from '@/lib/auth-context'
import { useAcceptInvitation, useInvitationByToken } from '@/lib/queries/invitations'
import { setStoredOrganizationId } from '@/lib/current-organization'
import { getErrorMessage } from '@/lib/get-error-message'

/**
 * /invite/:token — an existing shop adding someone to ITS team.
 *
 * This is deliberately not the professional application flow. A barber
 * invited by Shop A is joining Shop A; they are not applying to open a
 * business, so this page must never route them through /pro/register, which
 * would file a professional_application, ask a platform reviewer to approve
 * them, and potentially create a second organization. Sign-in and account
 * creation here are the ordinary minimal ones, carrying the invitation back
 * in `redirect` so the person lands where they started.
 *
 * Everything that matters — organization, location, role — is derived
 * server-side by accept_invitation() from the token. Nothing on this page is
 * trusted to name them.
 */
export function InvitePage() {
  const { t } = useTranslation('auth')
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const invitationQuery = useInvitationByToken(token)
  const acceptMutation = useAcceptInvitation(token)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  const roleLabel = (role: string) => t(`roles.${role}`, { defaultValue: role })

  if (invitationQuery.isPending || authLoading) {
    return <PageSpinner label={t('invite.loading')} />
  }

  if (invitationQuery.isError) {
    return (
      <AuthCard title={t('invite.errorTitle')}>
        <Alert variant="error">{t('invite.errorBody')}</Alert>
      </AuthCard>
    )
  }

  const invitation = invitationQuery.data

  if (!invitation) {
    return (
      <AuthCard title={t('invite.notFoundTitle')}>
        <Alert variant="info">{t('invite.notFoundBody')}</Alert>
      </AuthCard>
    )
  }

  if (invitation.isRevoked) {
    return (
      <AuthCard title={t('invite.revokedTitle')}>
        <Alert variant="info">{t('invite.revokedBody', { organization: invitation.organizationName })}</Alert>
      </AuthCard>
    )
  }

  if (invitation.isAccepted) {
    return (
      <AuthCard title={t('invite.acceptedTitle')}>
        <Alert variant="info">{t('invite.acceptedBody')}</Alert>
        <div className="mt-6">
          <Link to="/login" className={buttonVariants({ variant: 'primary' }, 'w-full')}>
            {t('invite.signIn')}
          </Link>
        </div>
      </AuthCard>
    )
  }

  if (invitation.isExpired) {
    return (
      <AuthCard title={t('invite.expiredTitle')}>
        <Alert variant="info">{t('invite.expiredBody', { organization: invitation.organizationName })}</Alert>
      </AuthCard>
    )
  }

  const redirectPath = `/invite/${token}`
  const redirectQuery = `?redirect=${encodeURIComponent(redirectPath)}`
  const emailMismatch = Boolean(user && user.email && user.email.toLowerCase() !== invitation.email)

  async function handleAccept() {
    setAcceptError(null)
    try {
      const result = await acceptMutation.mutateAsync(undefined)
      setStoredOrganizationId(result.organizationId)
      navigate('/app', { replace: true })
    } catch (error) {
      setAcceptError(getErrorMessage(error) ?? t('invite.failed'))
    }
  }

  return (
    <AuthCard
      title={t('invite.title')}
      subtitle={t('invite.subtitle', {
        organization: invitation.organizationName,
        role: roleLabel(invitation.role),
      })}
    >
      <div className="flex flex-col gap-4">
        {acceptError ? <Alert variant="error">{acceptError}</Alert> : null}

        {/*
          Stated plainly, because the previous flow genuinely did send invited
          barbers into a new-business application: nothing here creates a shop.
        */}
        <p className="flex items-start gap-2 rounded-lg border border-border bg-paper-50 p-3 text-sm text-ink-700">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
          {t('invite.joinNote')}
        </p>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-500">{t('invite.organization')}</dt>
          <dd className="text-ink-950">{invitation.organizationName}</dd>
          <dt className="text-ink-500">{t('invite.role')}</dt>
          <dd className="text-ink-950">
            <Badge variant="accent">{roleLabel(invitation.role)}</Badge>
          </dd>
          <dt className="text-ink-500">{t('invite.invitedEmail')}</dt>
          <dd className="truncate text-ink-950">{invitation.email}</dd>
          {invitation.locationName ? (
            <>
              <dt className="text-ink-500">{t('invite.location')}</dt>
              <dd className="text-ink-950">{invitation.locationName}</dd>
            </>
          ) : null}
        </dl>

        {!user ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-500">{t('invite.authPrompt')}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {/*
                Ordinary sign-in and ordinary account creation — NOT
                /pro/login and /pro/register. Both carry the invitation back
                so the person returns here to accept.
              */}
              <Link to={`/login${redirectQuery}`} className={buttonVariants({ variant: 'secondary' }, 'flex-1')}>
                {t('invite.signIn')}
              </Link>
              <Link to={`/register${redirectQuery}`} className={buttonVariants({ variant: 'primary' }, 'flex-1')}>
                {t('invite.createAccount')}
              </Link>
            </div>
          </div>
        ) : emailMismatch ? (
          <Alert variant="error">
            {t('invite.mismatch', { invited: invitation.email, current: user.email })}
          </Alert>
        ) : (
          <Button className="w-full" isLoading={acceptMutation.isPending} onClick={() => void handleAccept()}>
            {t('invite.accept')}
          </Button>
        )}
      </div>
    </AuthCard>
  )
}
