import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { AuthCard } from '@/components/auth/auth-card'
import { TextField } from '@/components/ui/text-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { getSupabaseClient } from '@/lib/supabase'
import { useTranslation } from 'react-i18next'

const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
})

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [formError, setFormError] = useState<string | null>(null)
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({ resolver: zodResolver(forgotPasswordSchema) })

  async function onSubmit(values: ForgotPasswordFormValues) {
    setFormError(null)
    const supabase = getSupabaseClient()

    // NOTE: actually delivering this email depends on SMTP being configured
    // on the self-hosted Supabase stack, which may not be set up yet in
    // every environment — the request/redirect flow itself is still correct
    // regardless of whether the email arrives.
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) {
      setFormError(error.message)
      return
    }

    setSubmittedEmail(values.email)
  }

  if (submittedEmail) {
    return (
      <AuthCard title={t('auth:forgotPassword.checkYourEmail')}>
        <Alert variant="success">
          {t('auth:forgotPassword.ifAnAccountExistsFor')} <strong>{submittedEmail}</strong>, we&apos;ve sent a link to reset
          your password.
        </Alert>
        <div className="mt-6">
          <Link to="/login" className="text-sm font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800">
            {t('auth:forgotPassword.backToLogIn')}
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={t('auth:forgotPassword.resetYourPassword')}
      subtitle={t('auth:forgotPassword.wellEmailYouALink')}
      footer={
        <Link to="/login" className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800">
          {t('auth:forgotPassword.backToLogIn')}
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <TextField
          label={t('common:field.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          error={errors.email?.message}
          {...register('email')}
        />

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          {t('auth:forgotPassword.sendResetLink')}
        </Button>
      </form>
    </AuthCard>
  )
}
