import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthCard } from '@/components/auth/auth-card'
import { SignupForm } from '@/components/auth/signup-form'

/**
 * /register — the canonical customer sign-up.
 *
 * Creating an account here never touches the professional approval
 * workflow: no application row, no review, straight into the customer app.
 *
 * No professional cross-link: this page presents ONE identity. Someone
 * signing up as a customer should not be asked to consider whether they are
 * really a business — professionals arrive through "For business", which is
 * where that question belongs and where it can be answered properly.
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
        <p>
          {t('customer.haveAccount')}{' '}
          <Link to={loginHref} className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800">
            {t('customer.logIn')}
          </Link>
        </p>
      }
    >
      <SignupForm signupIntent="customer" defaultRedirect="/app/customer" loginPath="/login" />
    </AuthCard>
  )
}
