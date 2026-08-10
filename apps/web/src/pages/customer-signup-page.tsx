import { useSearchParams, Link } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { SignupForm } from '@/components/auth/signup-form'

/**
 * /customer/signup — a plain Supabase Auth account with no memberships and
 * signup_intent='customer' (see SignupForm), landing on /app/customer via
 * /workspace's role-aware routing. There is no shop-creation step here —
 * that's /pro/signup.
 */
export function CustomerSignupPage() {
  const [searchParams] = useSearchParams()
  const redirectParam = searchParams.get('redirect')

  return (
    <AuthCard
      title="Create your account"
      subtitle="Book faster and keep track of your appointments."
      footer={
        <p>
          Already have an account?{' '}
          <Link
            to={`/customer/login${redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : ''}`}
            className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
          >
            Log in
          </Link>
        </p>
      }
    >
      <SignupForm signupIntent="customer" defaultRedirect="/workspace" loginPath="/customer/login" />
    </AuthCard>
  )
}
