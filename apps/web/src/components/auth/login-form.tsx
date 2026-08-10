import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { TextField } from '@/components/ui/text-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { getSupabaseClient } from '@/lib/supabase'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginFormValues = z.infer<typeof loginSchema>

function safeRedirectTarget(target: string | null, fallback: string): string {
  // Only ever redirect within the app — never to an absolute/external URL.
  if (target && target.startsWith('/') && !target.startsWith('//')) return target
  return fallback
}

/**
 * Shared sign-in form used by every login entry point (/login, /pro/login,
 * /customer/login, /platform/login has its own — platform staff should
 * never see customer/pro copy or a "forgot password" link styled the same
 * as the public ones). All entry points share one Supabase Auth system
 * (CLAUDE.md: never separate auth databases) — only the surrounding
 * copy/redirect default differs, which the caller supplies.
 */
export function LoginForm({ defaultRedirect }: { defaultRedirect: string }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [formError, setFormError] = useState<string | null>(null)
  const redirectTo = safeRedirectTarget(searchParams.get('redirect'), defaultRedirect)

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
          className="text-sm font-medium text-ink-500 underline underline-offset-2 hover:text-ink-950"
        >
          Forgot password?
        </Link>
      </div>

      <Button type="submit" isLoading={isSubmitting} className="w-full">
        Log in
      </Button>
    </form>
  )
}
