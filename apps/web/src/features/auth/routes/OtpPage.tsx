import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { authErrorKey, resolveDestination, sendMagicLink, verifyEmailOtp } from '@/features/auth/api/auth'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { Button } from '@/shared/ui/Button'
import { OTPInput } from '@/shared/ui/OTPInput'

/** Code à usage unique — six chiffres reçus dans le même e-mail que le lien. */
export function OtpPage() {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const redirect = params.get('redirect')
  const [code, setCode] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const verify = async (value: string) => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    try {
      await verifyEmailOtp(email, value)
      navigate(redirect ?? (await resolveDestination()), { replace: true })
    } catch (error) {
      setErrorKey(authErrorKey(error))
    } finally {
      setBusy(false)
    }
  }

  // Sans adresse, l'écran n'a pas d'objet — retour au lien magique.
  if (!email) {
    return (
      <AuthLayout title={t('auth.otp.title')}>
        <Link to="/auth/magic" className="text-fu-sm text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
          {t('auth.magic.title')}
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.otp.title')} subtitle={t('auth.otp.subtitle', { email })}>
      <div className="flex flex-col gap-4">
        <OTPInput
          label={t('auth.otp.code')}
          value={code}
          onValueChange={setCode}
          onComplete={(value) => void verify(value)}
          error={errorKey ? t(errorKey) : undefined}
          disabled={busy}
          autoFocus
        />
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          disabled={code.length !== 6}
          onClick={() => void verify(code)}
        >
          {t('auth.otp.submit')}
        </Button>
        <div className="flex flex-col gap-2 text-fu-sm">
          <button
            type="button"
            onClick={() => {
              setErrorKey(null)
              void sendMagicLink(email, redirect).catch((error: unknown) => setErrorKey(authErrorKey(error)))
            }}
            className="self-start text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
          >
            {t('auth.otp.resend')}
          </button>
          <Link to="/auth/magic" className="text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
            {t('auth.otp.changeEmail')}
          </Link>
        </div>
      </div>
    </AuthLayout>
  )
}
