import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { OTPInput } from '@/shared/ui/OTPInput'
import { Row } from '@/shared/ui/Row'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { Textarea } from '@/shared/ui/Textarea'
import { IconBack, IconInfo } from '@/shared/ui/icons'
import { requestBookingOtp, verifyBookingOtp } from '@/features/booking/api/lightAuth'
import {
  useBookingProfessionalByHandle,
  useCreateInterestRequest,
  InterestRefusedError,
  type InterestRequestResult,
} from '@/features/booking/api/booking'
import { interestRefusalMessageKey, type InterestRefusalCode } from '@/features/booking/lib/refusals'
import { deviceTimezone } from '@/shared/lib/format'

/**
 * La demande d'intérêt vers un profil NON revendiqué (F4 §6) — l'écran que
 * B2 réclamait en conclusion, celui qui ouvre l'acquisition.
 *
 * Il dit honnêtement ce qu'il est : ce professionnel n'est pas encore sur
 * FadeUp, vous manifestez votre intérêt, il sera prévenu. AUCUN rendez-vous
 * n'est promis : `preferred_starts_at` est la préférence du client, jamais
 * une offre du professionnel — aucun créneau n'existe à offrir.
 *
 * Un refus `do_not_contact` (B2) reçoit un message honnête, lu sur le code.
 * L'inscription légère OTP vit dans le flux (motif F1b) : la demande devient
 * suivable dans /bookings.
 */
export function InterestRequestPage() {
  const { t, i18n } = useTranslation('v2')
  const { handle = '' } = useParams()
  const navigate = useNavigate()
  const { session } = useSession()

  const professional = useBookingProfessionalByHandle(handle || null)

  const create = useCreateInterestRequest()

  const [serviceLabel, setServiceLabel] = useState('')
  const [when, setWhen] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ service?: string; when?: string; name?: string; email?: string }>({})
  const [phase, setPhase] = useState<'form' | 'otp'>('form')
  const [otpCode, setOtpCode] = useState('')
  const [otpIssue, setOtpIssue] = useState<'otp-failed' | 'email-send-failed' | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [refusal, setRefusal] = useState<InterestRefusalCode | null>(null)
  const [sent, setSent] = useState<InterestRequestResult | null>(null)

  const timezone = deviceTimezone()

  // Bornes honnêtes du champ : à venir, dans les 90 jours (contrat B2).
  const bounds = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const toLocal = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    const min = new Date(Date.now() + 3_600_000)
    const max = new Date(Date.now() + 90 * 86_400_000)
    return { min: toLocal(min), max: toLocal(max) }
  }, [])

  const submitRequest = async () => {
    if (!professional.data) return
    setRefusal(null)
    try {
      const result = await create.mutateAsync({
        professionalId: professional.data.id,
        customerName: name.trim(),
        serviceLabel: serviceLabel.trim(),
        preferredStartsAt: new Date(when).toISOString(),
        customerEmail: email.trim() || session?.user.email || undefined,
        notes: notes.trim() || undefined,
        locale: i18n.language.startsWith('en') ? 'en' : 'fr',
      })
      setSent(result)
    } catch (error) {
      if (error instanceof InterestRefusedError) setRefusal(error.code)
      else throw error
    }
  }

  const submitForm = async () => {
    const errors: typeof fieldErrors = {}
    if (serviceLabel.trim() === '') errors.service = t('booking.interest.serviceRequired')
    if (when === '') errors.when = t('booking.interest.whenRequired')
    if (name.trim() === '') errors.name = t('booking.summary.nameRequired')
    if (!session && email.trim() === '') errors.email = t('booking.summary.emailRequired')
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    if (!session) {
      setAuthBusy(true)
      setOtpIssue(null)
      const { ok } = await requestBookingOtp(email.trim())
      setAuthBusy(false)
      if (!ok) {
        setOtpIssue('email-send-failed')
        return
      }
      setPhase('otp')
      return
    }
    await submitRequest()
  }

  const submitOtp = async (code: string) => {
    setAuthBusy(true)
    setOtpIssue(null)
    const { ok } = await verifyBookingOtp(email.trim(), code)
    setAuthBusy(false)
    if (!ok) {
      setOtpIssue('otp-failed')
      setOtpCode('')
      return
    }
    await submitRequest()
  }

  if (professional.isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 py-8" aria-hidden="true">
        <SkeletonRect className="h-8 w-2/3" />
        <SkeletonRect className="h-12 w-full" />
        <SkeletonRect className="h-12 w-full" />
      </main>
    )
  }

  if (!professional.data || professional.data.claim_state === 'claimed') {
    // Un profil revendiqué a un vrai agenda : la demande d'intérêt n'a pas
    // d'objet, le tunnel réel est la bonne porte (garde miroir de B2).
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <EmptyState
          title={t('booking.flow.notFoundTitle')}
          description={
            professional.data?.claim_state === 'claimed'
              ? t('booking.interestRefusal.professional_is_claimed')
              : t('booking.flow.notFoundBody')
          }
          action={
            <Button variant="secondary" onClick={() => void navigate(-1)}>
              {t('booking.flow.back')}
            </Button>
          }
        />
      </main>
    )
  }

  const displayName = professional.data.display_name

  if (sent) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-28 pt-8 md:pb-10" data-testid="interest-sent">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-fu-2xl font-semibold text-[var(--fu-text-primary)]">{t('booking.interest.sentTitle')}</h1>
          <StateBadge state="pending-request" />
          <p className="max-w-md text-fu-base text-[var(--fu-text-secondary)]">
            {t('booking.interest.sentBody', { name: sent.professional_display_name })}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
          <Row title={serviceLabel.trim()} subtitle={t('booking.interest.serviceLabel')} />
          <Row
            title={<DateTime value={sent.preferred_starts_at} timezone={timezone} format="datetime" />}
            subtitle={`${t('booking.interest.preferenceLabel')} — ${t('booking.interest.preferenceNote')}`}
          />
        </div>
        <p className="text-fu-sm text-[var(--fu-text-secondary)]">
          {t('booking.interest.expiresLabel', {
            date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(sent.expires_at),
            ),
          })}
        </p>
        <Button variant="secondary" onClick={() => void navigate(`/pro/${encodeURIComponent(handle)}`)}>
          {t('booking.interest.backToProfile')}
        </Button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pb-28 pt-5 md:pb-10" data-testid="interest-request">
      <header className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t('booking.flow.back')}
          onClick={() => void navigate(-1)}
          className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--fu-text-primary)] hover:bg-[var(--fu-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
        >
          <IconBack aria-hidden="true" className="size-5 rtl:-scale-x-100" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-fu-xl font-semibold text-[var(--fu-text-primary)]">{t('booking.interest.title')}</h1>
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{displayName}</p>
        </div>
      </header>

      <p className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="interest-explainer">
        {t('booking.interest.explainer', { name: displayName })}
      </p>

      {phase === 'otp' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (otpCode.length === 6) void submitOtp(otpCode)
          }}
        >
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('booking.summary.otpSent', { email: email.trim() })}</p>
          <OTPInput
            label={t('booking.summary.otpLabel')}
            value={otpCode}
            onValueChange={setOtpCode}
            onComplete={(code) => void submitOtp(code)}
            error={otpIssue === 'otp-failed' ? t('booking.summary.issueOtpFailed') : undefined}
            disabled={authBusy || create.isPending}
            autoFocus
          />
          {refusal && (
            <p role="alert" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t(interestRefusalMessageKey(refusal))}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={authBusy || create.isPending} disabled={otpCode.length !== 6}>
            {t('booking.summary.confirmCode')}
          </Button>
          <Button variant="tertiary" onClick={() => setPhase('form')} disabled={authBusy || create.isPending}>
            {t('booking.summary.changeEmail')}
          </Button>
        </form>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submitForm()
          }}
        >
          <Input
            label={t('booking.interest.serviceLabel')}
            hint={t('booking.interest.serviceHint')}
            value={serviceLabel}
            onChange={(event) => setServiceLabel(event.target.value)}
            error={fieldErrors.service}
            required
          />
          <Input
            type="datetime-local"
            label={t('booking.interest.whenLabel')}
            hint={t('booking.interest.whenHint')}
            value={when}
            min={bounds.min}
            max={bounds.max}
            onChange={(event) => setWhen(event.target.value)}
            error={fieldErrors.when}
            required
          />
          <Input
            label={t('booking.summary.nameLabel')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={fieldErrors.name}
            autoComplete="name"
            required
          />
          {!session && (
            <Input
              type="email"
              label={t('booking.summary.emailLabel')}
              hint={t('booking.summary.emailHint')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={fieldErrors.email ?? (otpIssue === 'email-send-failed' ? t('booking.summary.issueEmailSendFailed') : undefined)}
              autoComplete="email"
              required
            />
          )}
          <Textarea
            label={t('booking.interest.notesLabel')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={280}
            rows={2}
          />
          {refusal && (
            <p role="alert" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]" data-testid="interest-refusal">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t(interestRefusalMessageKey(refusal))}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={authBusy || create.isPending} data-testid="interest-submit">
            {t('booking.interest.submit')}
          </Button>
        </form>
      )}
    </main>
  )
}

export default InterestRequestPage
