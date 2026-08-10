import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { TextField } from '@/components/ui/text-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { getSupabaseClient } from '@/lib/supabase'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginFormValues = z.infer<typeof loginSchema>

function safeRedirectTarget(target: string | null): string {
  // Only ever redirect within /platform — never to an absolute/external URL
  // or into the ordinary customer/pro app.
  if (target && target.startsWith('/platform') && !target.startsWith('//')) return target
  return '/platform'
}

/**
 * Separate entry point from the customer/pro /login — same underlying
 * Supabase Auth (CLAUDE.md: "one secure Supabase Auth system"), but
 * intentionally not linked from public marketing navigation, and with no
 * "sign up" affordance: a platform account is never self-serve. It's
 * granted only via /platform/claim/:token (bootstrap) or a platform team
 * invitation — RequirePlatformRole enforces that server-side regardless of
 * what this page shows.
 */
export function PlatformLoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [formError, setFormError] = useState<string | null>(null)
  const redirectTo = safeRedirectTarget(searchParams.get('redirect'))

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
    <AuthCard title="Platform sign in" subtitle="FadeUp platform staff only.">
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

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthCard>
  )
}
