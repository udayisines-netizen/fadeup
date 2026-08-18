import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { TextField } from '@/components/ui/text-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { getSupabaseClient } from '@/lib/supabase'
import { safeRedirectOr } from '@/lib/safe-redirect'
import { AuthDivider, SocialAuthButtons } from '@/components/auth/social-auth-buttons'
import type { AuthIntent } from '@/lib/oauth'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginFormValues = z.infer<typeof loginSchema>

/**
 * Shared sign-in form used by every login entry point (/login, /pro/login;
 * /platform/login has its own — platform staff should
 * never see customer/pro copy or a "forgot password" link styled the same
 * as the public ones). All entry points share one Supabase Auth system
 * (CLAUDE.md: never separate auth databases) — only the surrounding
 * copy/redirect default differs, which the caller supplies.
 *
 * Google and Apple sit above the email/password fields and authenticate
 * against that same single auth.users namespace. `intent` tells the shared
 * /auth/callback which door this was, so it can prefer the matching
 * workspace — it is a routing hint and grants nothing.
 *
 * Redirect validation moved to lib/safe-redirect: the old local helper
 * accepted '/\evil.example', which several browsers normalize to
 * '//evil.example' and follow off-site.
 */
export function LoginForm({ defaultRedirect, intent }: { defaultRedirect: string; intent: AuthIntent }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [formError, setFormError] = useState<string | null>(null)
  const redirectParam = searchParams.get('redirect')
  const redirectTo = safeRedirectOr(redirectParam, defaultRedirect)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values: LoginFormValues) {
    setFormError(null)
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    })

    if (error) {
      setFormError(error.message)
      return
    }

    navigate(redirectTo, { replace: true })
  }

  return (
    <div>
      <SocialAuthButtons intent={intent} next={redirectParam} />
      <AuthDivider />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError ? <Alert variant="error">{formError}</Alert> : null}

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
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="inline-flex min-h-11 items-center text-sm font-medium text-ink-500 underline underline-offset-2 hover:text-ink-950"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          Log in
        </Button>
      </form>
    </div>
  )
}
