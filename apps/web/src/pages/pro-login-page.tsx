import { AuthCard } from '@/components/auth/auth-card'
import { LoginForm } from '@/components/auth/login-form'
import { useSearchParams, Link } from 'react-router-dom'

/** /pro/login — barbers, receptionists, managers and shop owners. Separate entry point from /customer/login per CLAUDE.md section 15; same underlying Supabase Auth. */
export function ProLoginPage() {
  const [searchParams] = useSearchParams()
  const redirectParam = searchParams.get('redirect')

  return (
    <AuthCard
      title="Professional sign in"
      subtitle="For barbers, shop owners and staff."
      footer={
        <p>
          Don&apos;t have an account?{' '}
          <Link
            to={`/pro/signup${redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : ''}`}
            className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
          >
            Start free
          </Link>
        </p>
      }
    >
      <LoginForm defaultRedirect="/workspace" />
    </AuthCard>
  )
}
