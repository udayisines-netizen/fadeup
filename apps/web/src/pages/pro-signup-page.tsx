import { useSearchParams, Link } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { SignupForm } from '@/components/auth/signup-form'

/** /pro/signup — creates a shop-owner account, landing in onboarding to create their shop (unless redirected elsewhere, e.g. an invite link). */
export function ProSignupPage() {
  const [searchParams] = useSearchParams()
  const redirectParam = searchParams.get('redirect')

  return (
    <AuthCard
      title="Start your shop on FadeUp"
      subtitle="Set up FadeUp for your barbershop."
      footer={
        <p>
          Already have an account?{' '}
          <Link
            to={`/pro/login${redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : ''}`}
            className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
          >
            Log in
          </Link>
        </p>
      }
    >
      <SignupForm signupIntent="pro" defaultRedirect="/onboarding" loginPath="/pro/login" />
    </AuthCard>
  )
}
