import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { useNow } from '@/shared/hooks/useNow'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'
import { formatDateTime } from '@/shared/lib/format'
import { isExpired, remainingParts } from '@/shared/lib/deadline'
import { color, radius, spacing } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { Money } from '@/shared/ui/Money'
import { StateBadge } from '@/shared/ui/StateBadge'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import type { BookAppointmentResult } from '@/features/booking/api/booking'
import { requestSentCopy } from '@/features/booking/lib/requestCopy'
import { AlternativesSheet } from '@/features/booking/components/AlternativesSheet'
import { BookingRow, CardList } from '@/features/booking/components/BookingCard'

/**
 * Les DEUX issues du tunnel, et jamais l'une déguisée en l'autre (F4 §2) :
 *
 * - `is_request === false` → un RENDEZ-VOUS existe. C'est LE moment orchestré
 *   du produit (D1 §9), composé en SOMBRE (tokens `color.moment`) : la coche
 *   s'affirme en ressort, la suite monte en décalé. Brièvement, sans
 *   confettis.
 * - `is_request === true` → une DEMANDE est partie. Aucune célébration,
 *   aucun « Réservé » : le professionnel est prévenu, il a jusqu'à
 *   l'échéance pour répondre. Ni triomphal, ni inquiétant.
 *
 * `is_request` et `expires_at` sont LUS de la RPC — jamais déduits d'un
 * enum. La déduction est exactement l'endroit où un écran finit par mentir.
 *
 * TOUTE la copie de l'écran « demande envoyée » vient de
 * `lib/requestCopy.ts`, que la garde de langue (`requestCopy.test.ts`)
 * inspecte en fr et en : le test porte donc sur le texte réellement rendu.
 */

export interface BookingOutcomeContext {
  organizationId: string
  organizationName: string
  organizationSlug: string
  serviceName: string
  barberName: string | null
  priceCents: number | null
  currency: string
  timezone: string
}

export function BookingOutcome({
  result,
  context,
}: {
  result: BookAppointmentResult
  context: BookingOutcomeContext
}) {
  if (result.is_request) return <RequestSent result={result} context={context} />
  return <Confirmed result={result} context={context} />
}

/** Le récapitulatif commun aux deux issues — les mêmes faits, deux tons. */
function OutcomeRecap({
  result,
  context,
  labels,
  dark,
}: {
  result: BookAppointmentResult
  context: BookingOutcomeContext
  labels: { service: string; professional: string | null; when: string; price: string | null }
  dark: boolean
}) {
  const { i18n } = useTranslation('v2')
  const p = dark ? color.moment : color
  return (
    <CardList dark={dark}>
      <BookingRow dark={dark} title={context.serviceName} subtitle={labels.service} />
      {context.barberName && labels.professional ? (
        <BookingRow dark={dark} title={context.barberName} subtitle={labels.professional} />
      ) : null}
      <BookingRow
        dark={dark}
        title={
          <MonoText size="base" weight="medium" style={{ color: p.textPrimary }}>
            {formatDateTime(result.starts_at, context.timezone, 'datetime', i18n.language)}
          </MonoText>
        }
        subtitle={labels.when}
      />
      {context.priceCents !== null && labels.price ? (
        <BookingRow
          dark={dark}
          title={
            <Money
              cents={context.priceCents}
              currency={context.currency}
              size="base"
              weight="medium"
              style={{ color: p.textPrimary }}
            />
          }
          subtitle={labels.price}
        />
      ) : null}
    </CardList>
  )
}

/**
 * D1 §9 — LE moment fort du produit, en fond SOMBRE composé (#071310) :
 * coche en ressort (stiffness 320 / damping 16), apparitions décalées,
 * barre d'état claire. Sous réduction d'animations : fondus purs (< 100 ms),
 * AUCUNE translation ni échelle.
 */
function Confirmed({ result, context }: { result: BookAppointmentResult; context: BookingOutcomeContext }) {
  const { t } = useTranslation('v2')
  const router = useRouter()
  const reduced = usePrefersReducedMotion()

  const scale = useSharedValue(reduced ? 1 : 0.45)
  const opacity = useSharedValue(0)

  useEffect(() => {
    if (reduced) {
      opacity.value = withTiming(1, { duration: 90 })
      scale.value = 1
      return
    }
    opacity.value = withTiming(1, { duration: 120 })
    scale.value = withSpring(1, { stiffness: 320, damping: 16, mass: 1 })
  }, [reduced, opacity, scale])

  const checkStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: reduced ? [] : [{ scale: scale.value }],
  }))

  const follow = (delay: number) =>
    reduced ? FadeIn.duration(90) : FadeInDown.delay(delay).springify().damping(26).stiffness(260)

  return (
    <View style={styles.momentRoot}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.momentSafe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.momentContent} showsVerticalScrollIndicator={false}>
          <View style={styles.momentHero}>
            <Animated.View style={[styles.check, checkStyle]}>
              <Ionicons name="checkmark" size={44} color={color.moment.accentFg} />
            </Animated.View>
            <Animated.View entering={follow(180)} style={styles.momentTitles}>
              <FuText variant="heading" style={[styles.center, { color: color.moment.textPrimary }]}>
                {t('booking.confirmed.title')}
              </FuText>
              <FuText variant="body" style={[styles.center, { color: color.moment.textSecondary }]}>
                {t('booking.confirmed.subtitle')}
              </FuText>
            </Animated.View>
          </View>

          <Animated.View entering={follow(300)} style={styles.momentBody}>
            <OutcomeRecap
              result={result}
              context={context}
              dark
              labels={{
                service: t('booking.summary.service'),
                professional: t('booking.summary.professional'),
                when: t('booking.summary.when'),
                price: `${t('booking.summary.price')} — ${t('booking.summary.payOnSite')}`,
              }}
            />
            <View style={styles.actions}>
              <Button
                label={t('booking.confirmed.viewBookings')}
                size="lg"
                fullWidth
                onPress={() => router.replace('/bookings')}
              />
              <Button
                label={t('booking.confirmed.backToProfile')}
                variant="ghost"
                fullWidth
                onPress={() => router.replace(`/shop/${encodeURIComponent(context.organizationSlug)}` as never)}
              />
            </View>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

function RequestSent({ result, context }: { result: BookAppointmentResult; context: BookingOutcomeContext }) {
  const { t, i18n } = useTranslation('v2')
  const router = useRouter()
  const now = useNow(30_000)
  const [alternativesOpen, setAlternativesOpen] = useState(false)

  // `expires_at` est LU de la RPC (plafonné en base par least(TTL, starts_at)) :
  // le client ne recalcule rien, il constate.
  const expired = result.expires_at !== null && isExpired(result.expires_at, now)
  const copy = requestSentCopy({
    t,
    expired,
    deadlineAbsolute:
      result.expires_at !== null
        ? formatDateTime(result.expires_at, context.timezone, 'datetime', i18n.language)
        : null,
    remaining: result.expires_at !== null ? remainingParts(result.expires_at, now) : null,
    hasBarber: context.barberName !== null,
    hasPrice: context.priceCents !== null,
  })

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.requestHero}>
          {!expired ? (
            <View style={styles.pendingIcon}>
              <Ionicons name="time-outline" size={28} color={color.textSecondary} />
            </View>
          ) : null}
          <FuText variant="heading" style={styles.center}>
            {copy.title}
          </FuText>
          {copy.badgeLabel !== null ? <StateBadge state="pending-request" /> : null}
          {copy.body !== null ? (
            <FuText variant="body" tone="secondary" style={styles.center}>
              {copy.body}
            </FuText>
          ) : null}
          {/* L'échéance, DEUX fois : absolue (fuseau du lieu) et relative. */}
          {copy.deadlineLabel !== null && copy.deadlineValue !== null ? (
            <FuText variant="sm" tone="secondary" style={styles.center}>
              {copy.deadlineLabel} {copy.deadlineValue}
            </FuText>
          ) : null}
          {copy.countdown !== null ? (
            <MonoText size="sm" weight="medium">
              {copy.countdown}
            </MonoText>
          ) : null}
        </View>

        {/* Expirée : appeler le salon D'ABORD règle souvent la question — et
            le texte reconnaît qu'aucun numéro n'est publié dans FadeUp. */}
        {copy.expiredCallFirstTitle !== null && copy.expiredCallFirstBody !== null ? (
          <View style={styles.callFirst}>
            <FuText variant="bodyMedium">{copy.expiredCallFirstTitle}</FuText>
            <FuText variant="sm" tone="secondary">
              {copy.expiredCallFirstBody}
            </FuText>
          </View>
        ) : null}

        <OutcomeRecap
          result={result}
          context={context}
          dark={false}
          labels={{
            service: copy.recapServiceLabel,
            professional: copy.recapProfessionalLabel,
            when: copy.recapWhenLabel,
            price: copy.recapPriceLabel,
          }}
        />

        <View style={styles.actions}>
          <Button
            label={copy.findAlternative}
            variant={expired ? 'primary' : 'secondary'}
            size="lg"
            fullWidth
            onPress={() => setAlternativesOpen(true)}
          />
          <Button
            label={copy.viewBookings}
            variant="ghost"
            fullWidth
            onPress={() => router.replace('/bookings')}
          />
        </View>
      </ScrollView>

      <AlternativesSheet
        open={alternativesOpen}
        onClose={() => setAlternativesOpen(false)}
        excludeOrganizationId={context.organizationId}
        serviceQuery={context.serviceName}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  content: { padding: spacing(4), paddingBottom: spacing(10), gap: spacing(6) },
  requestHero: { alignItems: 'center', gap: spacing(2), paddingTop: spacing(4) },
  pendingIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSubtle,
  },
  callFirst: {
    gap: spacing(1),
    padding: spacing(4),
    borderRadius: radius.card,
    backgroundColor: color.surfaceSubtle,
  },
  actions: { gap: spacing(2) },
  center: { textAlign: 'center' },

  /* Le moment sombre — le seul écran du tunnel qui bascule de palette. */
  momentRoot: { flex: 1, backgroundColor: color.moment.canvas },
  momentSafe: { flex: 1 },
  momentContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing(4),
    paddingBottom: spacing(10),
    gap: spacing(6),
  },
  momentHero: { alignItems: 'center', gap: spacing(4) },
  momentTitles: { alignItems: 'center', gap: spacing(1) },
  momentBody: { gap: spacing(6) },
  check: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.moment.accent,
  },
})
