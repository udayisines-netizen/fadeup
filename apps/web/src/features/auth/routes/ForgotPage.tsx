import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { emailOnlySchema, type EmailOnlyValues } from '@/features/auth/schema'
import { authErrorKey, sendPasswordReset } from '@/features/auth/api/auth'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'

export function ForgotPage() {
  const { t } = useTranslation('v2')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const form = useForm<EmailOnlyValues>({ resolver: zodResolver(emailOnlySchema) })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setErrorKey(null)
    try {
      await sendPasswordReset(values.email)
      setSentTo(values.email)
    } catch (error) {
      setErrorKey(authErrorKey(error))
    }
  })

  if (sentTo) {
    return (
      <AuthLayout title={t('auth.forgot.sentTitle')}>
        {/* Formulation anti-énumération : ne confirme jamais qu'un compte existe. */}
        <p className="text-fu-base text-[var(--fu-text-secondary)]">{t('auth.forgot.sentDescription', { email: sentTo })}</p>
        <Link to="/auth/login" className="text-fu-sm text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
          {t('auth.forgot.backToLogin')}
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
        <Input
          label={t('auth.forgot.email')}
          type="email"
          autoComplete="email"
          error={errors.email?.message ? t(errors.email.message) : undefined}
          {...form.register('email')}
        />
        {errorKey && (
          <p role="alert" className="text-fu-sm text-[var(--fu-danger)]">
            {t(errorKey)}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={isSubmitting}>
          {t('auth.forgot.submit')}
        </Button>
      </form>
      <Link to="/auth/login" className="text-fu-sm text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
        {t('auth.forgot.backToLogin')}
      </Link>
    </AuthLayout>
  )
}
