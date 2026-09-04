import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { loginSchema, type LoginValues } from '@/features/auth/schema'
import { authErrorKey, resolveDestination, signInWithPassword } from '@/features/auth/api/auth'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'

export function LoginPage() {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get('redirect')
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setErrorKey(null)
    try {
      await signInWithPassword(values.email, values.password)
      navigate(redirect ?? (await resolveDestination()), { replace: true })
    } catch (error) {
      setErrorKey(authErrorKey(error))
    }
  })

  return (
    <AuthLayout title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
        <Input
          label={t('auth.login.email')}
          type="email"
          autoComplete="email"
          error={errors.email?.message ? t(errors.email.message) : undefined}
          {...form.register('email')}
        />
        <Input
          label={t('auth.login.password')}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message ? t(errors.password.message) : undefined}
          {...form.register('password')}
        />
        {errorKey && (
          <p role="alert" className="text-fu-sm text-[var(--fu-danger)]">
            {t(errorKey)}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={isSubmitting}>
          {t('auth.login.submit')}
        </Button>
      </form>
      <div className="flex flex-col gap-2 text-fu-sm">
        <Link to={`/auth/magic${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
          {t('auth.login.magicLink')}
        </Link>
        <Link to="/auth/forgot" className="text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
          {t('auth.login.forgotLink')}
        </Link>
        <p className="text-[var(--fu-text-secondary)]">
          {t('auth.login.noAccount')}{' '}
          <Link
            to={`/auth/signup${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
            className="text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
          >
            {t('auth.login.signupLink')}
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
