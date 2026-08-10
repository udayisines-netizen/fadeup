import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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

/**
 * Shared account-creation form for every signup entry point. One Supabase
 * Auth system underneath (CLAUDE.md: never separate auth databases) — a
 * "customer" and a "professional" account are the same kind of row in
 * auth.users, distinguished only by `signupIntent`, stashed in
 * raw_user_meta_data (same mechanism already used for full_name) so
 * post-login routing (see WorkspaceSelectorPage) can tell a brand-new
 * zero-membership customer apart from a brand-new zero-membership
 * professional without a database migration. This is a routing hint only —
 * it grants no authorization by itself, and a user can still end up with
 * memberships that don't match their original intent (e.g. a "customer"
 * later gets invited to staff a shop), which is fine: actual authorization
 * everywhere else still resolves through memberships/platform_members, never
 * this field.
 */
export function SignupForm({
  signupIntent,
  defaultRedirect,
  loginPath,
}: {
  signupIntent: 'pro' | 'customer'
  defaultRedirect: string
  loginPath: string
}) {
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
      options: { data: { full_name: values.fullName, signup_intent: signupIntent } },
    })

    if (error) {
      setFormError(error.message)
      return
    }

    if (!data.session) {
      setConfirmationEmail(values.email)
      return
    }

    navigate(redirectTo ?? defaultRedirect, { replace: true })
  }

  if (confirmationEmail) {
    return (
      <div>
        <Alert variant="success">
          We sent a confirmation link to <strong>{confirmationEmail}</strong>. Follow it to finish
          creating your account, then log in.
        </Alert>
        <div className="mt-6">
          <Link
            to={loginPath}
            className="text-sm font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
          >
            Back to log in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      {formError ? <Alert variant="error">{formError}</Alert> : null}

      <TextField label="Full name" autoComplete="name" error={errors.fullName?.message} {...register('fullName')} />
      <TextField
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        spellCheck={false}
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
  )
}
