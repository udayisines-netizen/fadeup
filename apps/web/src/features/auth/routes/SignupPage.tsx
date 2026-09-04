import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { signupSchema, type SignupValues } from '@/features/auth/schema'
import { authErrorKey, hasOpenSession, resolveDestination, signUpWithPassword } from '@/features/auth/api/auth'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'

export function SignupPage() {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get('redirect')
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const form = useForm<SignupValues>({ resolver: zodResolver(signupSchema) })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setErrorKey(null)
    try {
      await signUpWithPassword(values.email, values.password, redirect)
      // ENABLE_EMAIL_AUTOCONFIRM=true : la session est ouverte immédiatement.
      if (await hasOpenSession()) {
        navigate(redirect ?? (await resolveDestination()), { replace: true })
      } else {
        navigate(`/auth/magic?email-sent=1`, { replace: true })
      }
    } catch (error) {
      setErrorKey(authErrorKey(error))
    }
  })

  return (
    <AuthLayout title={t('auth.signup.title')} subtitle={t('auth.signup.subtitle')}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
        <Input
          label={t('auth.signup.email')}
          type="email"
          autoComplete="email"
          error={errors.email?.message ? t(errors.email.message) : undefined}
          {...form.register('email')}
        />
        <Input
          label={t('auth.signup.password')}
          type="password"
          autoComplete="new-password"
          hint={t('auth.signup.passwordHint')}
          error={errors.password?.message ? t(errors.password.message) : undefined}
          {...form.register('password')}
        />
        {errorKey && (
          <p role="alert" className="text-fu-sm text-[var(--fu-danger)]">
            {t(errorKey)}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={isSubmitting}>
          {t('auth.signup.submit')}
        </Button>
      </form>
      <p className="text-fu-sm text-[var(--fu-text-secondary)]">
        {t('auth.signup.hasAccount')}{' '}
        <Link
          to={`/auth/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
          className="text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
        >
          {t('auth.signup.loginLink')}
        </Link>
      </p>
    </AuthLayout>
  )
}
