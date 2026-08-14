import { useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthCard } from '@/components/auth/auth-card'
import { LoginForm } from '@/components/auth/login-form'

/**
 * /login — the canonical customer sign-in.
 *
 * Professionals sign in at /pro/login instead; the cross-link below makes
 * that obvious rather than leaving someone stuck on the wrong form. Both
 * entry points share one Supabase Auth system (CLAUDE.md: never separate
 * auth databases) — only the surrounding context differs.
 */
export function CustomerLoginPage() {
  const { t } = useTranslation('auth')
  const [searchParams] = useSearchParams()
  const redirectParam = searchParams.get('redirect')

  return (
    <AuthCard
      title={t('customer.loginTitle')}
      subtitle={t('customer.loginSubtitle')}
      footer={
        <p>
          {t('customer.noAccount')}{' '}
          <Link
            to={`/register${redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : ''}`}
            className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
          >
            {t('customer.signUp')}
          </Link>
        </p>
      }
    >
      <LoginForm defaultRedirect="/workspace" />
    </AuthCard>
  )
}
