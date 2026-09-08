import { useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'

import { signInWithGoogle, useSession } from '@/shared/data/auth'
import { formatDateTime } from '@/shared/lib/format'
import { color, spacing } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { Duration } from '@/shared/ui/Duration'
import { Money } from '@/shared/ui/Money'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import { requestBookingOtp, verifyBookingOtp } from '@/features/booking/api/lightAuth'
import { currentSessionEmail } from '@/features/booking/api/sessionEmail'
import { bookingRefusalMessageKey, type BookingRefusalCode } from '@/features/booking/lib/refusals'
import { BookingRow, CardList } from '@/features/booking/components/BookingCard'
import { FormField } from '@/features/booking/components/FormField'

/**
 * Récapitulatif et confirmation (F4 §4) : service, professionnel, date et
 * heure, prix attendu — RÉGLÉ SUR PLACE. Aucun écran de paiement n'existe
 * nulle part dans FadeUp, et aucune mention de carte non plus.
 *
 * L'inscription légère vit ICI, sans quitter le tunnel (motif OTP F1b) :
 * sans session, l'e-mail est demandé, un code à six chiffres arrive, la
 * phase code s'affiche SUR LE MÊME ÉCRAN — le créneau choisi reste dans les
 * paramètres de la route, et la réservation part AUSSITÔT le code validé.
 * C'est la preuve que le parcours reprend exactement où il était. Google est
 * proposé en option secondaire sous l'e-mail (M1b) ; il pose la session par
 * le navigateur système et l'envoi part de la même façon.
 *
 * Le CTA annonce l'issue RÉELLE avant le geste : « Confirmer la
 * réservation » quand l'organisation confirme immédiatement, « Envoyer la
 * demande » sinon. La vérité FINALE reste `is_request`, lue de la réponse.
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
  /** `null` = capacité inconnue (RPC en vol/échec) : le CTA reste neutre. */
  acceptsImmediateBooking: boolean | null
  busy: boolean
  refusal: BookingRefusalCode | null
  onEdit: (what: 'service' | 'barber' | 'slot') => void
  onSubmit: (input: { name: string; email: string | null; notes: string }) => void | Promise<void>
}) {
  const { t, i18n } = useTranslation('v2')
  const { session } = useSession()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const [emailError, setEmailError] = useState<string | undefined>(undefined)
  const [phase, setPhase] = useState<'form' | 'otp'>('form')
  const [otpCode, setOtpCode] = useState('')
  const [otpIssue, setOtpIssue] = useState<'otp-failed' | 'email-send-failed' | 'google-failed' | null>(null)
  const [authBusy, setAuthBusy] = useState(false)

  const isRequest = acceptsImmediateBooking === false
  const submitLabel = isRequest ? t('booking.summary.sendRequest') : t('booking.summary.confirmBook')

  const requireName = (): string | null => {
    if (name.trim() === '') {
      setNameError(t('booking.summary.nameRequired'))
      return null
    }
    setNameError(undefined)
    return name.trim()
  }

  const submitForm = async () => {
    const trimmedName = requireName()
    if (trimmedName === null) return
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
    await onSubmit({ name: trimmedName, email: null, notes: notes.trim() })
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

  /** Google — même promesse : la session arrive, l'envoi part sur place. */
  const submitGoogle = async () => {
    const trimmedName = requireName()
    if (trimmedName === null) return
    setAuthBusy(true)
    setOtpIssue(null)
    try {
      const { ok } = await signInWithGoogle()
      if (!ok) {
        setOtpIssue('google-failed')
        return
      }
      // La session vient d'être posée : l'état React ne la connaît pas
      // encore — l'e-mail se lit au client, pas au rendu périmé.
      const mail = await currentSessionEmail()
      await onSubmit({ name: trimmedName, email: mail, notes: notes.trim() })
    } catch {
      setOtpIssue('google-failed')
    } finally {
      setAuthBusy(false)
    }
  }

  const refusalLine = refusal ? (
    <View style={styles.notice} accessibilityRole="alert">
      <Ionicons name="information-circle-outline" size={16} color={color.textPrimary} style={styles.noticeIcon} />
      <FuText variant="sm" style={styles.noticeText}>
        {t(bookingRefusalMessageKey(refusal))}
      </FuText>
    </View>
  ) : null

  return (
    <View style={styles.root}>
      <CardList>
        <BookingRow
          title={serviceName}
          subtitle={
            durationMinutes !== null ? (
              <View style={styles.inlineSubtitle}>
                <FuText variant="sm" tone="secondary">
                  {t('booking.summary.service')}
                </FuText>
                <Duration minutes={durationMinutes} />
              </View>
            ) : (
              t('booking.summary.service')
            )
          }
          trailing={<Button label={t('booking.flow.edit')} variant="ghost" onPress={() => onEdit('service')} />}
        />
        <BookingRow
          title={barberWasChosen && barberName ? barberName : t('booking.flow.anyBarber')}
          subtitle={t('booking.summary.professional')}
          trailing={<Button label={t('booking.flow.edit')} variant="ghost" onPress={() => onEdit('barber')} />}
        />
        <BookingRow
          title={
            <MonoText size="base" weight="medium">
              {formatDateTime(startsAt, timezone, 'datetime', i18n.language)}
            </MonoText>
          }
          subtitle={t('booking.summary.when')}
          trailing={<Button label={t('booking.flow.edit')} variant="ghost" onPress={() => onEdit('slot')} />}
        />
        {priceCents !== null ? (
          <BookingRow
            title={<Money cents={priceCents} currency={currency} size="base" weight="medium" />}
            subtitle={`${t('booking.summary.price')} — ${t('booking.summary.payOnSite')}`}
          />
        ) : null}
      </CardList>

      {phase === 'otp' ? (
        <View style={styles.form}>
          <FuText variant="sm" tone="secondary">
            {t('booking.summary.otpSent', { email: email.trim() })}
          </FuText>
          <FormField
            label={t('booking.summary.otpLabel')}
            value={otpCode}
            onChangeText={(value) => setOtpCode(value.replace(/[^0-9]/g, '').slice(0, 6))}
            error={otpIssue === 'otp-failed' ? t('booking.summary.issueOtpFailed') : undefined}
            editable={!authBusy && !busy}
            autoFocus
            keyboardType="number-pad"
            inputMode="numeric"
            textContentType="oneTimeCode"
            autoComplete={Platform.OS === 'ios' ? 'one-time-code' : 'sms-otp'}
            returnKeyType="done"
            placeholder="000000"
            onSubmitEditing={() => {
              if (otpCode.length === 6) void submitOtp(otpCode)
            }}
            style={styles.codeInput}
          />
          {refusalLine}
          <Button
            label={t('booking.summary.confirmCode')}
            size="lg"
            fullWidth
            loading={authBusy || busy}
            disabled={otpCode.length !== 6}
            onPress={() => void submitOtp(otpCode)}
          />
          <Button
            label={t('booking.summary.changeEmail')}
            variant="ghost"
            fullWidth
            disabled={authBusy || busy}
            onPress={() => setPhase('form')}
          />
        </View>
      ) : (
        <View style={styles.form}>
          <FormField
            label={t('booking.summary.nameLabel')}
            value={name}
            onChangeText={setName}
            error={nameError}
            autoComplete="name"
            returnKeyType="next"
          />
          {!session ? (
            <>
              <FormField
                label={t('booking.summary.emailLabel')}
                hint={t('booking.summary.emailHint')}
                value={email}
                onChangeText={setEmail}
                error={emailError ?? (otpIssue === 'email-send-failed' ? t('booking.summary.issueEmailSendFailed') : undefined)}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                returnKeyType="next"
              />
              {/* Le tunnel ne se perd pas : la session arrive ICI, sans
                  navigation, et le créneau choisi reste dans la route. */}
              <FuText variant="sm" tone="secondary">
                {t('mobile.bookingx.resumeNotice')}
              </FuText>
            </>
          ) : null}
          <FormField
            label={t('booking.summary.notesLabel')}
            hint={t('booking.summary.notesHint')}
            value={notes}
            onChangeText={setNotes}
            maxLength={280}
            multiline
            numberOfLines={2}
            style={styles.notesInput}
          />
          {isRequest ? (
            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={16} color={color.textSecondary} style={styles.noticeIcon} />
              <FuText variant="sm" tone="secondary" style={styles.noticeText}>
                {t('booking.summary.requestNotice')}
              </FuText>
            </View>
          ) : null}
          {refusalLine}
          <Button
            label={submitLabel}
            accessibilityLabel={`${submitLabel} — ${organizationName}`}
            size="lg"
            fullWidth
            loading={authBusy || busy}
            onPress={() => void submitForm()}
          />
          {!session ? (
            <>
              <View style={styles.orRow} accessibilityElementsHidden>
                <View style={styles.orLine} />
                <FuText variant="sm" tone="tertiary">
                  {t('mobile.auth.or')}
                </FuText>
                <View style={styles.orLine} />
              </View>
              <Button
                label={t('mobile.auth.google')}
                variant="secondary"
                size="lg"
                fullWidth
                disabled={authBusy || busy}
                onPress={() => void submitGoogle()}
              />
              {otpIssue === 'google-failed' ? (
                <FuText variant="sm" tone="danger" accessibilityRole="alert">
                  {t('mobile.auth.googleFailed')}
                </FuText>
              ) : null}
            </>
          ) : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: spacing(5) },
  form: { gap: spacing(4) },
  inlineSubtitle: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  notice: { flexDirection: 'row', gap: spacing(2) },
  noticeIcon: { marginTop: 3 },
  noticeText: { flex: 1 },
  codeInput: { letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.border },
})
