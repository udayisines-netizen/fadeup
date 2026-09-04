import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { emailOnlySchema, type EmailOnlyValues } from '@/features/auth/schema'
import { authErrorKey, sendMagicLink } from '@/features/auth/api/auth'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'

/**
 * Lien magique — l'infrastructure de l'inscription ultra-légère du flux de
 * réservation (P2). L'e-mail GoTrue transporte lien ET code : après envoi,
 * l'utilisateur peut basculer sur /auth/otp avec la même adresse.
 */
export function MagicPage() {
  const { t } = useTranslation('v2')
  const [params] = useSearchParams()
  const redirect = params.get('redirect')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const form = useForm<EmailOnlyValues>({ resolver: zodResolver(emailOnlySchema) })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setErrorKey(null)
    try {
      await sendMagicLink(values.email, redirect)
      setSentTo(values.email)
    } catch (error) {
      setErrorKey(authErrorKey(error))
    }
  })

  if (sentTo) {
    return (
      <AuthLayout title={t('auth.magic.sentTitle')}>
        <p className="text-fu-base text-[var(--fu-text-secondary)]">{t('auth.magic.sentDescription', { email: sentTo })}</p>
        <div className="flex flex-col gap-2 text-fu-sm">
          <Link
            to={`/auth/otp?email=${encodeURIComponent(sentTo)}${redirect ? `&redirect=${encodeURIComponent(redirect)}` : ''}`}
            className="text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
          >
            {t('auth.magic.useOtp')}
          </Link>
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="self-start text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
          >
            {t('auth.magic.resend')}
          </button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.magic.title')} subtitle={t('auth.magic.subtitle')}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
        <Input
          label={t('auth.magic.email')}
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
          {t('auth.magic.submit')}
        </Button>
      </form>
      <p className="text-fu-sm text-[var(--fu-text-secondary)]">
        <Link to="/auth/login" className="text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
          {t('auth.forgot.backToLogin')}
        </Link>
      </p>
    </AuthLayout>
  )
}
