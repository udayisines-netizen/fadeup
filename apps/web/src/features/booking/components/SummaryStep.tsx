import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Duration } from '@/shared/ui/Duration'
import { Input } from '@/shared/ui/Input'
import { Money } from '@/shared/ui/Money'
import { OTPInput } from '@/shared/ui/OTPInput'
import { Row } from '@/shared/ui/Row'
import { Textarea } from '@/shared/ui/Textarea'
import { IconInfo } from '@/shared/ui/icons'
import { requestBookingOtp, verifyBookingOtp } from '@/features/booking/api/lightAuth'
import { bookingRefusalMessageKey, type BookingRefusalCode } from '@/features/booking/lib/refusals'

/**
 * Récapitulatif et confirmation (F4 §4) : service, barber, date et heure,
 * prix attendu (réglé SUR PLACE — aucun écran de paiement n'existe nulle
 * part), note courte optionnelle.
 *
 * L'inscription légère vit ICI, sans quitter le tunnel (motif OTP F1b) :
 * sans session, l'e-mail est demandé, un code à six chiffres arrive, GoTrue
 * pose la session dans le même onglet et la réservation part — le contexte
 * n'est jamais perdu. Pas de réservation anonyme.
 *
 * Le CTA annonce l'issue RÉELLE : « Confirmer la réservation » quand
 * l'organisation confirme immédiatement, « Envoyer la demande » sinon — pas
 * de fausse attente, pas de fausse confirmation (F4 §3).
 */
export function SummaryStep({
  organizationName,
  currency,
  serviceName,
  durationMinutes,
  priceCents,
  barberName,
  barberWasChosen,
  startsAt,
  timezone,
  acceptsImmediateBooking,
  busy,
  refusal,
  onEdit,
  onSubmit,
}: {
  organizationName: string
  currency: string
  serviceName: string
  durationMinutes: number | null
  priceCents: number | null
  barberName: string | null
  barberWasChosen: boolean
  startsAt: string
  timezone: string
  /** null = capacité inconnue (RPC en vol/échec) : le CTA reste neutre, la vérité viendra de is_request. */
  acceptsImmediateBooking: boolean | null
  busy: boolean
  refusal: BookingRefusalCode | null
  onEdit: (what: 'service' | 'barber' | 'slot') => void
  onSubmit: (input: { name: string; email: string | null; notes: string }) => void | Promise<void>
}) {
  const { t } = useTranslation('v2')
  const { session } = useSession()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const [emailError, setEmailError] = useState<string | undefined>(undefined)
  const [phase, setPhase] = useState<'form' | 'otp'>('form')
  const [otpCode, setOtpCode] = useState('')
  const [otpIssue, setOtpIssue] = useState<'otp-failed' | 'email-send-failed' | null>(null)
  const [authBusy, setAuthBusy] = useState(false)

  const isRequest = acceptsImmediateBooking === false
  const submitLabel = isRequest ? t('booking.summary.sendRequest') : t('booking.summary.confirmBook')

  const submitForm = async () => {
    if (name.trim() === '') {
      setNameError(t('booking.summary.nameRequired'))
      return
    }
    setNameError(undefined)
    if (!session) {
      if (email.trim() === '') {
        setEmailError(t('booking.summary.emailRequired'))
        return
      }
      setEmailError(undefined)
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
    await onSubmit({ name: name.trim(), email: null, notes: notes.trim() })
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
    // La session est posée : la réservation part immédiatement, même écran.
    await onSubmit({ name: name.trim(), email: email.trim(), notes: notes.trim() })
  }

  return (
    <div className="flex flex-col gap-5" data-testid="summary-step">
      <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
        <Row
          title={serviceName}
          subtitle={
            durationMinutes !== null ? (
              <span className="flex items-center gap-1.5">
                <span>{t('booking.summary.service')}</span>
                <Duration minutes={durationMinutes} />
              </span>
            ) : (
              t('booking.summary.service')
            )
          }
          trailing={
            <Button variant="tertiary" size="sm" onClick={() => onEdit('service')}>
              {t('booking.flow.edit')}
            </Button>
          }
        />
        <Row
          title={barberWasChosen && barberName ? barberName : t('booking.flow.anyBarber')}
          subtitle={t('booking.summary.professional')}
          trailing={
            <Button variant="tertiary" size="sm" onClick={() => onEdit('barber')}>
              {t('booking.flow.edit')}
            </Button>
          }
        />
        <Row
          title={<DateTime value={startsAt} timezone={timezone} format="datetime" />}
          subtitle={t('booking.summary.when')}
          trailing={
            <Button variant="tertiary" size="sm" onClick={() => onEdit('slot')}>
              {t('booking.flow.edit')}
            </Button>
          }
        />
        {priceCents !== null && (
          <Row
            title={<Money cents={priceCents} currency={currency} />}
            subtitle={`${t('booking.summary.price')} — ${t('booking.summary.payOnSite')}`}
          />
        )}
      </div>

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
            disabled={authBusy || busy}
            autoFocus
          />
          {refusal && (
            <p role="alert" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]" data-testid="booking-refusal">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t(bookingRefusalMessageKey(refusal))}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={authBusy || busy} disabled={otpCode.length !== 6}>
            {t('booking.summary.confirmCode')}
          </Button>
          <Button variant="tertiary" onClick={() => setPhase('form')} disabled={authBusy || busy}>
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
            label={t('booking.summary.nameLabel')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={nameError}
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
              error={emailError ?? (otpIssue === 'email-send-failed' ? t('booking.summary.issueEmailSendFailed') : undefined)}
              autoComplete="email"
              required
            />
          )}
          <Textarea
            label={t('booking.summary.notesLabel')}
            hint={t('booking.summary.notesHint')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={280}
            rows={2}
          />
          {isRequest && (
            <p className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="request-notice">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t('booking.summary.requestNotice')}
            </p>
          )}
          {refusal && (
            <p role="alert" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]" data-testid="booking-refusal">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t(bookingRefusalMessageKey(refusal))}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={authBusy || busy}
            aria-label={`${submitLabel} — ${organizationName}`}
            data-testid="booking-submit"
          >
            {submitLabel}
          </Button>
        </form>
      )}
    </div>
  )
}
