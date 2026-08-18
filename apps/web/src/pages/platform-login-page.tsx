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
import { safeInternalPathWithin } from '@/lib/safe-redirect'
import { AuthDivider, SocialAuthButtons } from '@/components/auth/social-auth-buttons'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginFormValues = z.infer<typeof loginSchema>

/**
 * Separate entry point from the customer/pro /login — same underlying
 * Supabase Auth (CLAUDE.md: "one secure Supabase Auth system"), but
 * intentionally not linked from public marketing navigation, and with no
 * "sign up" affordance: a platform account is never self-serve. It's
 * granted only via /platform/claim/:token (bootstrap) or a platform team
 * invitation — RequirePlatformRole enforces that server-side regardless of
 * what this page shows.
 *
 * Google and Apple are offered here, exactly as on the customer and
 * professional doors. That is not a loosening: pressing them proves an
 * identity and nothing more. Platform access is a public.platform_members
 * row, a table with no client-facing INSERT/UPDATE/DELETE grant at all,
 * writable only by claim_platform_owner_bootstrap()/
 * accept_platform_invitation() (both requiring an unguessable single-use
 * token) or an operator at the database. A Google account whose metadata
 * literally claims {"role":"platform_admin"} gets nothing — proven
 * behaviourally in supabase/VERIFY_LOTS_A_A5_B_2026_08_18.sql.
 *
 * Requiring a separate FadeUp password for staff would not add a factor; it
 * would just be a second password. Real step-up (MFA) is a later, deliberate
 * security lot and is not replaced by anything here.
 */
export function PlatformLoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [formError, setFormError] = useState<string | null>(null)
  const redirectParam = searchParams.get('redirect')
  // Constrained to /platform so a crafted link cannot steer a platform
  // sign-in into the customer or professional app. An anti-confusion
  // boundary, not the authorization one — RequirePlatformRole re-resolves
  // platform_members on arrival however someone got there.
  const redirectTo = safeInternalPathWithin(redirectParam, '/platform') ?? '/platform'

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
      {/*
        intent="platform" is a routing preference for /auth/callback, never a
        grant. The callback sends anyone without a platform_members row to
        /workspace instead of /platform — see resolveDestination().
      */}
      <SocialAuthButtons intent="platform" next={redirectParam} />
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

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthCard>
  )
}
