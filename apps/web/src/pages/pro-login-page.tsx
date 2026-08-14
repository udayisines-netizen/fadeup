import { useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthCard } from '@/components/auth/auth-card'
import { LoginForm } from '@/components/auth/login-form'

/**
 * /pro/login — the professional entrance. Preserved from the original
 * implementation; what changed is the context around it (a "for
 * professionals" marker, an explicit route across to the client sign-in, and
 * a link to /pro/register rather than a generic signup).
 *
 * A pending or refused applicant authenticates here perfectly well — they
 * have a real account. Where they land afterwards is decided by
 * /workspace and RequireProAccess, which send them to their application
 * status rather than into a workspace they do not have.
 */
export function ProLoginPage() {
  const { t } = useTranslation('auth')
  const [searchParams] = useSearchParams()
  const redirectParam = searchParams.get('redirect')

  return (
    <AuthCard
      badge={t('pro.badge')}
      title={t('pro.loginTitle')}
      subtitle={t('pro.loginSubtitle')}
      footer={
        <div className="flex flex-col gap-1">
          <p>
            {t('pro.noAccount')}{' '}
            <Link
              to={`/pro/register${redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : ''}`}
              className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
            >
              {t('pro.applyCta')}
            </Link>
          </p>
          <p className="text-ink-500">
            {t('pro.switchToCustomer')}{' '}
            <Link to="/login" className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-950">
              {t('pro.switchToCustomerCta')}
            </Link>
          </p>
        </div>
      }
    >
      <LoginForm defaultRedirect="/workspace" />
    </AuthCard>
  )
}
