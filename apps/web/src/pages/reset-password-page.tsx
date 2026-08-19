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
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
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
    return <PageSpinner label={t('auth:resetPassword.checkingYourResetLink')} />
  }

  if (status === 'unavailable') {
    return (
      <AuthCard title={t('auth:resetPassword.resetLinkNotFound')}>
        <Alert variant="error">
          {t('auth:resetPassword.thisPasswordResetLinkIs')}
        </Alert>
        <div className="mt-6">
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
          >
            {t('auth:resetPassword.requestANewLink')}
          </Link>
        </div>
      </AuthCard>
    )
  }

  if (success) {
    return (
      <AuthCard title={t('auth:resetPassword.passwordUpdated')}>
        <Alert variant="success">{t('auth:resetPassword.yourPasswordHasBeenChanged')}</Alert>
        <Button className="mt-6 w-full" onClick={() => navigate('/app', { replace: true })}>
          {t('auth:resetPassword.continueToFadeup')}
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={t('auth:resetPassword.setANewPassword')}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <TextField
          label={t('auth:resetPassword.newPassword')}
          type="password"
          autoComplete="new-password"
          hint={t('auth:resetPassword.atLeast8Characters')}
          error={errors.password?.message}
          {...register('password')}
        />
        <TextField
          label={t('auth:resetPassword.confirmNewPassword')}
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          {t('auth:resetPassword.updatePassword')}
        </Button>
      </form>
    </AuthCard>
  )
}
