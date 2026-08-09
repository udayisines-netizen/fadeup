import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { TextField } from '@/components/ui/text-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { getSupabaseClient } from '@/lib/supabase'

const signupSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type SignupFormValues = z.infer<typeof signupSchema>

function safeRedirectTarget(target: string | null): string | null {
  if (target && target.startsWith('/') && !target.startsWith('//')) return target
  return null
}

export function SignupPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)
  const redirectTo = safeRedirectTarget(searchParams.get('redirect'))

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({ resolver: zodResolver(signupSchema) })

  async function onSubmit(values: SignupFormValues) {
    setFormError(null)
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { full_name: values.fullName } },
    })

    if (error) {
      setFormError(error.message)
      return
    }

    // Supabase may require email confirmation before a session is issued —
    // don't assume the account is immediately usable.
    if (!data.session) {
      setConfirmationEmail(values.email)
      return
    }

    // Brand-new account: it can't have any memberships yet, so onboarding is
    // the correct landing spot unless the signup came from an invite link.
    navigate(redirectTo ?? '/onboarding', { replace: true })
  }

  if (confirmationEmail) {
    return (
      <AuthCard title="Check your email">
        <Alert variant="success">
          We sent a confirmation link to <strong>{confirmationEmail}</strong>. Follow it to finish
          creating your account, then log in.
        </Alert>
        <div className="mt-6">
          <Link to="/login" className="text-sm font-medium text-neutral-900 underline">
            Back to log in
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Set up FadeUp for your barbershop."
      footer={
        <p>
          Already have an account?{' '}
          <Link
            to={`/login${redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ''}`}
            className="font-medium text-neutral-900 underline"
          >
            Log in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <TextField
          label="Full name"
          autoComplete="name"
          error={errors.fullName?.message}
          {...register('fullName')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          error={errors.password?.message}
          {...register('password')}
        />

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          Sign up
        </Button>
      </form>
    </AuthCard>
  )
}
