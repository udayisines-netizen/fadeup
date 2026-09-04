import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { resetSchema, type ResetValues } from '@/features/auth/schema'
import { authErrorKey, resolveDestination, updatePassword } from '@/features/auth/api/auth'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Spinner } from '@/shared/ui/Spinner'

/**
 * Arrivée du lien de récupération (session de recovery ouverte par GoTrue).
 * Sans session, le lien est mort : message explicite + retour vers /auth/forgot.
 */
export function ResetPage() {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const { session, loading } = useSession()
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const form = useForm<ResetValues>({ resolver: zodResolver(resetSchema) })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setErrorKey(null)
    try {
      await updatePassword(values.password)
      setDone(true)
    } catch (error) {
      setErrorKey(authErrorKey(error))
    }
  })

  if (loading) {
    return (
      <AuthLayout title={t('auth.reset.title')}>
        <div className="flex justify-center py-8">
          <Spinner size="lg" announce />
        </div>
      </AuthLayout>
    )
  }

  if (!session) {
    return (
      <AuthLayout title={t('auth.callback.failedTitle')} subtitle={t('auth.callback.failedDescription')}>
        <Button variant="primary" size="lg" fullWidth onClick={() => navigate('/auth/forgot')}>
          {t('auth.callback.failedAction')}
        </Button>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout title={t('auth.reset.successTitle')} subtitle={t('auth.reset.successDescription')}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => {
            void resolveDestination().then((destination) => navigate(destination, { replace: true }))
          }}
        >
          {t('common.action.continue')}
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.reset.title')}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
        <Input
          label={t('auth.reset.password')}
          type="password"
          autoComplete="new-password"
          hint={t('auth.reset.passwordHint')}
          error={errors.password?.message ? t(errors.password.message) : undefined}
          {...form.register('password')}
        />
        <Input
          label={t('auth.reset.confirm')}
          type="password"
          autoComplete="new-password"
          error={errors.confirm?.message ? t(errors.confirm.message) : undefined}
          {...form.register('confirm')}
        />
        {errorKey && (
          <p role="alert" className="text-fu-sm text-[var(--fu-danger)]">
            {t(errorKey)}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={isSubmitting}>
          {t('auth.reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
