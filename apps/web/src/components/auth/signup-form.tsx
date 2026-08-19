import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { TextField } from '@/components/ui/text-field'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { getSupabaseClient } from '@/lib/supabase'
import { safeInternalPath } from '@/lib/safe-redirect'
import { useAuth } from '@/lib/auth-context'
import { classifyAuthError, authErrorKey } from '@/lib/auth-errors'
import { AuthDivider, SocialAuthButtons } from '@/components/auth/social-auth-buttons'

const signupSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type SignupFormValues = z.infer<typeof signupSchema>

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
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const [formError, setFormError] = useState<string | null>(null)
  const [existingAccountEmail, setExistingAccountEmail] = useState<string | null>(null)
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)
  const redirectParam = searchParams.get('redirect')
  const redirectTo = safeInternalPath(redirectParam)

  /** Sign-in link that keeps whatever the visitor was on their way to. */
  const signInHref = redirectTo ? `${loginPath}?redirect=${encodeURIComponent(redirectTo)}` : loginPath

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
      // "User already registered" is a signpost, not a failure: this person
      // has a FadeUp identity and simply needs to sign in. Showing GoTrue's
      // raw string left them stuck mid-journey with no next action.
      const kind = classifyAuthError(error)
      if (kind === 'alreadyRegistered') {
        setExistingAccountEmail(values.email)
        return
      }
      const key = authErrorKey(kind)
      // `unknown` keeps the provider's own message — a wrong guess that
      // swallowed a real error would be worse than showing it.
      setFormError(key ? t(key) : error.message)
      return
    }

    if (!data.session) {
      setConfirmationEmail(values.email)
      return
    }

    navigate(redirectTo ?? defaultRedirect, { replace: true })
  }

  // Already signed in: there is nothing to create. FadeUp has one identity,
  // and becoming a professional never means a second account — so send them
  // where they were going instead of showing a create-account form they must
  // not use.
  if (!authLoading && user) {
    return <Navigate to={redirectTo ?? defaultRedirect} replace />
  }

  if (existingAccountEmail) {
    return (
      <div>
        <Alert variant="info">{t('errors.alreadyRegistered')}</Alert>
        <div className="mt-6 flex flex-col gap-3">
          <Link to={signInHref} className={buttonVariants({ variant: 'primary' }, 'w-full')}>
            {t('errors.alreadyRegisteredCta')}
          </Link>
          <button
            type="button"
            onClick={() => setExistingAccountEmail(null)}
            className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-ink-500 underline underline-offset-2 hover:text-ink-950"
          >
            {t('errors.useAnotherEmail')}
          </button>
        </div>
      </div>
    )
  }

  if (confirmationEmail) {
    return (
      <div>
        <Alert variant="success">
          {t('auth:signupForm.weSentAConfirmationLink')} <strong>{confirmationEmail}</strong>. Follow it to finish
          creating your account, then log in.
        </Alert>
        <div className="mt-6">
          <Link
            to={loginPath}
            className="text-sm font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
          >
            {t('auth:signupForm.backToLogIn')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/*
        Google/Apple sit above the form on signup too. Creating an account
        with a provider is the SAME act as creating one with a password: it
        produces one ordinary auth.users row with no memberships and no
        platform role. `signupIntent` is only carried by the password path
        because it lives in raw_user_meta_data at signUp() time; the provider
        path carries the equivalent hint through the callback's `intent`
        parameter instead. Neither is authorization.
      */}
      <SocialAuthButtons intent={signupIntent === 'pro' ? 'pro' : 'customer'} next={redirectParam} />
      <AuthDivider />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <TextField label={t('auth:signupForm.fullName')} autoComplete="name" error={errors.fullName?.message} {...register('fullName')} />
        <TextField
          label={t('common:field.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label={t('common:field.password')}
          type="password"
          autoComplete="new-password"
          hint={t('auth:signupForm.atLeast8Characters')}
          error={errors.password?.message}
          {...register('password')}
        />

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          {t('common:auth.signUp')}
        </Button>
      </form>
    </div>
  )
}
