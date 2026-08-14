import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthCard } from '@/components/auth/auth-card'
import { SignupForm } from '@/components/auth/signup-form'

/**
 * /register — the canonical customer sign-up.
 *
 * Creating an account here never touches the professional approval
 * workflow: no application row, no review, straight into the customer app.
 * Professionals have their own entrance at /pro/register, linked below so
 * someone who took the wrong door can cross over in one tap rather than
 * being silently redirected.
 */
export function CustomerRegisterPage() {
  const { t } = useTranslation('auth')
  const [searchParams] = useSearchParams()
  const redirectParam = searchParams.get('redirect')
  const loginHref = `/login${redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : ''}`

  return (
    <AuthCard
      title={t('customer.registerTitle')}
      subtitle={t('customer.registerSubtitle')}
      footer={
        <div className="flex flex-col gap-1">
          <p>
            {t('customer.haveAccount')}{' '}
            <Link to={loginHref} className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800">
              {t('customer.logIn')}
            </Link>
          </p>
          <p className="text-ink-500">
            {t('customer.switchToPro')}{' '}
            <Link to="/pro/register" className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-950">
              {t('customer.switchToProCta')}
            </Link>
          </p>
        </div>
      }
    >
      <SignupForm signupIntent="customer" defaultRedirect="/app/customer" loginPath="/login" />
    </AuthCard>
  )
}
