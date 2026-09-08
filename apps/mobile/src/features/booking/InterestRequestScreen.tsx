import { useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'

import { useNow } from '@/shared/hooks/useNow'
import { useSession } from '@/shared/data/auth'
import { deviceTimezone, formatDateTime } from '@/shared/lib/format'
import { color, radius, spacing, touchTarget } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Skeleton } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import { requestBookingOtp, verifyBookingOtp } from '@/features/booking/api/lightAuth'
import {
  InterestRefusedError,
  useBookingProfessionalByHandle,
  useCreateInterestRequest,
  type InterestRequestResult,
} from '@/features/booking/api/booking'
import { interestRefusalMessageKey, type InterestRefusalCode } from '@/features/booking/lib/refusals'
import { BOOKING_WINDOW_DAYS, bookableDays } from '@/features/booking/lib/slots'
import { BookingRow, CardList } from '@/features/booking/components/BookingCard'
import { DayStrip } from '@/features/booking/components/DayStrip'
import { FormField } from '@/features/booking/components/FormField'

/**
 * La demande d'intérêt vers un profil NON revendiqué (F4 §6, B2) — l'écran
 * qui ouvre l'acquisition.
 *
 * Il dit honnêtement ce qu'il est : ce professionnel n'est pas encore sur
 * FadeUp, vous manifestez votre intérêt, il sera prévenu. AUCUN rendez-vous
 * n'est promis : `preferred_starts_at` est la PRÉFÉRENCE du client, jamais
 * une offre du professionnel — aucun créneau n'existe à offrir, et l'écran
 * de confirmation le redit.
 *
 * Écart natif ASSUMÉ au web : le champ `datetime-local` n'existe pas en
 * React Native, et aucune dépendance de sélecteur n'est ajoutée par ce lot.
 * La préférence se compose donc d'un JOUR (la même bande que le tunnel —
 * proposer un jour n'affirme rien) et d'une HEURE choisie dans une rangée de
 * puces, dans un registre visuel DIFFÉRENT de la grille de créneaux réels,
 * sous l'étiquette « votre préférence — pas un créneau garanti ». Les bornes
 * du contrat B2 sont tenues côté client (à venir, dans les 90 jours) ; la
 * base reste seule juge (`too_far_ahead`, `past_time`).
 */

/** Heures proposables — une amplitude large, jamais une disponibilité. */
const PREFERENCE_HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']

/** Le contrat B2 : la préférence est à venir (marge d'une heure). */
const MIN_LEAD_MS = 3_600_000

function instantFor(day: string, time: string): Date | null {
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  if (year === undefined || month === undefined || dayOfMonth === undefined || hour === undefined || minute === undefined) {
    return null
  }
  // Heure LOCALE de l'appareil : le fuseau de la préférence est celui du
  // client — aucun lieu n'existe encore côté professionnel non revendiqué.
  return new Date(year, month - 1, dayOfMonth, hour, minute, 0, 0)
}

export function InterestRequestScreen({ handle }: { handle: string }) {
  const { t, i18n } = useTranslation('v2')
  const router = useRouter()
  const { session } = useSession()
  const now = useNow(60_000)

  const professional = useBookingProfessionalByHandle(handle || null)
  const create = useCreateInterestRequest()

  const timezone = deviceTimezone()
  const days = useMemo(() => bookableDays(timezone, now), [timezone, now])

  const [serviceLabel, setServiceLabel] = useState('')
  const [day, setDay] = useState<string | null>(null)
  const [time, setTime] = useState<string | null>(null)
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

  /* Bornes honnêtes : à venir (marge d'une heure), dans les 90 jours.
     L'HEURE s'affiche par Intl comme partout ailleurs (12 h en `en`). */
  const availableHours = useMemo(() => {
    if (!day) return []
    const min = now.getTime() + MIN_LEAD_MS
    const max = now.getTime() + BOOKING_WINDOW_DAYS * 86_400_000
    return PREFERENCE_HOURS.flatMap((hour) => {
      const at = instantFor(day, hour)
      if (!at || at.getTime() < min || at.getTime() > max) return []
      return [{ value: hour, label: formatDateTime(at, timezone, 'time', i18n.language) }]
    })
  }, [day, now, timezone, i18n.language])

  const chosenInstant = day && time ? instantFor(day, time) : null

  const submitRequest = async () => {
    if (!professional.data || !chosenInstant) return
    setRefusal(null)
    try {
      const result = await create.mutateAsync({
        professionalId: professional.data.id,
        customerName: name.trim(),
        serviceLabel: serviceLabel.trim(),
        preferredStartsAt: chosenInstant.toISOString(),
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
    if (chosenInstant === null) errors.when = t('booking.interest.whenRequired')
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
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.skeletons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Skeleton height={28} width="66%" />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </View>
      </SafeAreaView>
    )
  }

  /* Un profil revendiqué a un vrai agenda : la demande d'intérêt n'a pas
     d'objet, le tunnel réel est la bonne porte (garde miroir de B2). */
  if (!professional.data || professional.data.claim_state === 'claimed') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <EmptyState
            title={t('booking.flow.notFoundTitle')}
            body={
              professional.data?.claim_state === 'claimed'
                ? t('booking.interestRefusal.professional_is_claimed')
                : t('booking.flow.notFoundBody')
            }
            actionLabel={t('booking.flow.back')}
            onAction={() => {
              if (router.canGoBack()) router.back()
              else router.replace('/')
            }}
          />
        </View>
      </SafeAreaView>
    )
  }

  const displayName = professional.data.display_name

  if (sent) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.sentHero}>
            <FuText variant="heading" style={styles.center}>
              {t('booking.interest.sentTitle')}
            </FuText>
            <StateBadge state="pending-request" />
            <FuText variant="body" tone="secondary" style={styles.center}>
              {t('booking.interest.sentBody', { name: sent.professional_display_name })}
            </FuText>
          </View>
          <CardList>
            <BookingRow title={serviceLabel.trim()} subtitle={t('booking.interest.serviceLabel')} />
            <BookingRow
              title={
                <MonoText size="base" weight="medium">
                  {formatDateTime(sent.preferred_starts_at, timezone, 'datetime', i18n.language)}
                </MonoText>
              }
              subtitle={`${t('booking.interest.preferenceLabel')} — ${t('booking.interest.preferenceNote')}`}
            />
          </CardList>
          <FuText variant="sm" tone="secondary">
            {t('booking.interest.expiresLabel', {
              date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(sent.expires_at),
              ),
            })}
          </FuText>
          <Button
            label={t('booking.interest.backToProfile')}
            variant="secondary"
            fullWidth
            onPress={() => router.replace(`/pro/${encodeURIComponent(handle)}` as never)}
          />
        </ScrollView>
      </SafeAreaView>
    )
  }

  const refusalLine = refusal ? (
    <View style={styles.notice} accessibilityRole="alert">
      <Ionicons name="information-circle-outline" size={16} color={color.textPrimary} style={styles.noticeIcon} />
      <FuText variant="sm" style={styles.noticeText}>
        {t(interestRefusalMessageKey(refusal))}
      </FuText>
    </View>
  ) : null

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('booking.flow.back')}
          onPress={() => {
            if (router.canGoBack()) router.back()
            else router.replace('/')
          }}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <FuText variant="title" numberOfLines={1}>
            {t('booking.interest.title')}
          </FuText>
          <FuText variant="sm" tone="secondary" numberOfLines={1}>
            {displayName}
          </FuText>
        </View>
      </View>

      {/* Cinq champs et un CTA : le clavier ne doit couvrir ni l'un ni l'autre. */}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <FuText variant="sm" tone="secondary">
          {t('booking.interest.explainer', { name: displayName })}
        </FuText>

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
              editable={!authBusy && !create.isPending}
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
              loading={authBusy || create.isPending}
              disabled={otpCode.length !== 6}
              onPress={() => void submitOtp(otpCode)}
            />
            <Button
              label={t('booking.summary.changeEmail')}
              variant="ghost"
              fullWidth
              disabled={authBusy || create.isPending}
              onPress={() => setPhase('form')}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <FormField
              label={t('booking.interest.serviceLabel')}
              hint={t('booking.interest.serviceHint')}
              value={serviceLabel}
              onChangeText={setServiceLabel}
              error={fieldErrors.service}
              returnKeyType="next"
            />

            <View style={styles.whenBlock}>
              <FuText variant="smMedium">{t('booking.interest.whenLabel')}</FuText>
              <FuText variant="sm" tone="secondary">
                {t('booking.interest.whenHint')}
              </FuText>
              <DayStrip
                days={days}
                value={day}
                onChange={(next) => {
                  setDay(next)
                  setTime(null)
                }}
                timeZone={timezone}
              />
              {day && availableHours.length === 0 ? (
                /* Un jour épuisé (choisi tard, ou le 90e) ne doit pas être
                   un vide muet — on dit pourquoi et quoi faire. */
                <FuText variant="sm" tone="secondary">
                  {t('mobile.bookingx.noPreferenceHours')}
                </FuText>
              ) : null}
              {day ? (
                <View style={styles.hourRow}>
                  {availableHours.map((hour) => {
                    const selected = time === hour.value
                    return (
                      <Pressable
                        key={hour.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={hour.label}
                        onPress={() => setTime(hour.value)}
                        style={({ pressed }) => [styles.hour, selected && styles.hourSelected, pressed && styles.pressed]}
                      >
                        <MonoText size="sm" weight="medium">
                          {hour.label}
                        </MonoText>
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}
              {fieldErrors.when ? (
                <FuText variant="sm" tone="danger" accessibilityRole="alert">
                  {fieldErrors.when}
                </FuText>
              ) : null}
            </View>

            <FormField
              label={t('booking.summary.nameLabel')}
              value={name}
              onChangeText={setName}
              error={fieldErrors.name}
              autoComplete="name"
              returnKeyType="next"
            />
            {!session ? (
              <FormField
                label={t('booking.summary.emailLabel')}
                hint={t('booking.summary.emailHint')}
                value={email}
                onChangeText={setEmail}
                error={fieldErrors.email ?? (otpIssue === 'email-send-failed' ? t('booking.summary.issueEmailSendFailed') : undefined)}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                returnKeyType="next"
              />
            ) : null}
            <FormField
              label={t('booking.interest.notesLabel')}
              value={notes}
              onChangeText={setNotes}
              maxLength={280}
              multiline
              numberOfLines={2}
              style={styles.notesInput}
            />
            {refusalLine}
            <Button
              label={t('booking.interest.submit')}
              size="lg"
              fullWidth
              loading={authBusy || create.isPending}
              onPress={() => void submitForm()}
            />
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  fill: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  back: {
    width: touchTarget,
    height: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: touchTarget / 2,
  },
  headerText: { flex: 1 },
  content: { padding: spacing(4), paddingTop: spacing(1), paddingBottom: spacing(10), gap: spacing(4) },
  form: { gap: spacing(4) },
  whenBlock: { gap: spacing(2) },
  hourRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  hour: {
    minWidth: 76,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(3),
    borderRadius: radius.avatar,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surfaceSubtle,
  },
  hourSelected: { borderColor: color.accent, backgroundColor: color.accentSoft },
  sentHero: { alignItems: 'center', gap: spacing(2), paddingTop: spacing(4) },
  skeletons: { padding: spacing(4), gap: spacing(3) },
  notice: { flexDirection: 'row', gap: spacing(2) },
  noticeIcon: { marginTop: 3 },
  noticeText: { flex: 1 },
  codeInput: { letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.6 },
})

export default InterestRequestScreen
