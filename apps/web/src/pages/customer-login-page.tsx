import { useSearchParams, Link } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { LoginForm } from '@/components/auth/login-form'

/** /customer/login — separate entry point from /pro/login per CLAUDE.md section 15; same underlying Supabase Auth. */
export function CustomerLoginPage() {
  const [searchParams] = useSearchParams()
  const redirectParam = searchParams.get('redirect')

  return (
    <AuthCard
      title="Log in"
      subtitle="Manage your bookings and account."
      footer={
        <p>
          Don&apos;t have an account?{' '}
          <Link
            to={`/customer/signup${redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : ''}`}
            className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
          >
            Sign up
          </Link>
        </p>
      }
    >
      <LoginForm defaultRedirect="/workspace" />
    </AuthCard>
  )
}
