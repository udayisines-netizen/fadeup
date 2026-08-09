import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { TextField } from '@/components/ui/text-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { PageSpinner } from '@/components/ui/spinner'
import { getSupabaseClient } from '@/lib/supabase'

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

type RecoveryStatus = 'checking' | 'ready' | 'unavailable'

/**
 * Clicking a password-recovery email link lands the user here with Supabase
 * having already parsed recovery tokens from the URL and established a
 * session, emitting a `PASSWORD_RECOVERY` auth event. We treat either that
 * event or any already-active session as sufficient to show the "set new
 * password" form; if neither shows up, the link was missing/expired.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<RecoveryStatus>('checking')
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseClient()
    let isMounted = true
    let resolved = false

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return
      if (event === 'PASSWORD_RECOVERY' || session) {
        resolved = true
        setStatus('ready')
      }
    })

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted || resolved) return
      setStatus(data.session ? 'ready' : 'unavailable')
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({ resolver: zodResolver(resetPasswordSchema) })

  async function onSubmit(values: ResetPasswordFormValues) {
    setFormError(null)
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.updateUser({ password: values.password })

    if (error) {
      setFormError(error.message)
      return
    }

    setSuccess(true)
  }

  if (status === 'checking') {
    return <PageSpinner label="Checking your reset link" />
  }

  if (status === 'unavailable') {
    return (
      <AuthCard title="Reset link not found">
        <Alert variant="error">
          This password reset link is invalid or has expired. Request a new one to continue.
        </Alert>
        <div className="mt-6">
          <Link to="/forgot-password" className="text-sm font-medium text-neutral-900 underline">
            Request a new link
          </Link>
        </div>
      </AuthCard>
    )
  }

  if (success) {
    return (
      <AuthCard title="Password updated">
        <Alert variant="success">Your password has been changed.</Alert>
        <Button className="mt-6 w-full" onClick={() => navigate('/app', { replace: true })}>
          Continue to FadeUp
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Set a new password">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          error={errors.password?.message}
          {...register('password')}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          Update password
        </Button>
      </form>
    </AuthCard>
  )
}
