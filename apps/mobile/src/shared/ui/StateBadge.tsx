/**
 * M1b — transposition native du StateBadge web (shared/ui/StateBadge.tsx) :
 * chaque état a un libellé traduit, une forme (icône ou point) et un ton —
 * JAMAIS la couleur seule.
 *
 * `pending-request` ne suggère JAMAIS une confirmation : « En attente de
 * confirmation », pas « Réservé » (garde de langue F4, reprise en natif).
 *
 * Le web change de palette par thème CSS ; en natif le composant reçoit
 * `dark` sur les moments sombres (suivi de file, confirmation) et lit alors
 * les tokens `moment`.
 */
import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { color, radius, spacing } from '@/shared/theme/tokens'
import { FuText } from '@/shared/ui/Text'

export type FadeUpState =
  | 'bookable'
  | 'on-request'
  | 'not-bookable'
  | 'available'
  | 'available-now'
  | 'unavailable'
  | 'pending-request'
  | 'confirmed'
  | 'queue-open'
  | 'queue-full'
  | 'queue-closed'
  | 'called'
  | 'missed'
  | 'offline'
  | 'reconnecting'
  | 'partial-data'

type Tone = 'neutral' | 'positive' | 'attention' | 'danger' | 'brand' | 'live'

interface StateSpec {
  labelKey: string
  tone: Tone
  icon: keyof typeof Ionicons.glyphMap
}

const SPECS: Record<FadeUpState, StateSpec> = {
  bookable: { labelKey: 'states.booking.bookable', tone: 'positive', icon: 'checkmark' },
  'on-request': { labelKey: 'states.booking.onRequest', tone: 'neutral', icon: 'time-outline' },
  'not-bookable': { labelKey: 'states.booking.notBookable', tone: 'neutral', icon: 'close' },
  available: { labelKey: 'states.booking.available', tone: 'positive', icon: 'checkmark' },
  'available-now': { labelKey: 'states.booking.availableNow', tone: 'live', icon: 'people-outline' },
  unavailable: { labelKey: 'states.booking.unavailable', tone: 'neutral', icon: 'close' },
  'pending-request': { labelKey: 'states.booking.pendingRequest', tone: 'attention', icon: 'time-outline' },
  confirmed: { labelKey: 'states.booking.confirmed', tone: 'positive', icon: 'checkmark' },
  'queue-open': { labelKey: 'states.queue.open', tone: 'live', icon: 'people-outline' },
  'queue-full': { labelKey: 'states.queue.full', tone: 'attention', icon: 'people-outline' },
  'queue-closed': { labelKey: 'states.queue.closed', tone: 'neutral', icon: 'people-outline' },
  called: { labelKey: 'states.queue.called', tone: 'brand', icon: 'checkmark' },
  missed: { labelKey: 'states.queue.missed', tone: 'danger', icon: 'alert-circle-outline' },
  offline: { labelKey: 'states.connection.offline', tone: 'neutral', icon: 'cloud-offline-outline' },
  reconnecting: { labelKey: 'states.connection.reconnecting', tone: 'attention', icon: 'cloud-offline-outline' },
  'partial-data': { labelKey: 'states.connection.partialData', tone: 'attention', icon: 'information-circle-outline' },
}

export interface StateBadgeProps {
  state: FadeUpState
  /** Palette `moment` pour les écrans sombres (suivi de file, confirmation). */
  dark?: boolean
}

export function StateBadge({ state, dark = false }: StateBadgeProps) {
  const { t } = useTranslation('v2')
  const spec = SPECS[state]
  const p = dark ? color.moment : color

  const toneStyle: Record<Tone, { border: string; bg?: string; text: string }> = {
    neutral: { border: p.border, text: p.textSecondary },
    positive: { border: 'transparent', bg: p.accentSoft, text: p.textPrimary },
    attention: { border: p.borderStrong, text: p.textPrimary },
    danger: { border: p.danger, text: p.textPrimary },
    // « called » est un moment de marque : vert plein, texte encre (8,30:1).
    brand: { border: 'transparent', bg: p.accent, text: p.accentFg },
    live: { border: p.borderStrong, text: p.textPrimary },
  }
  const tone = toneStyle[spec.tone]

  return (
    <View
      style={[
        styles.badge,
        { borderColor: tone.border, backgroundColor: tone.bg ?? 'transparent' },
      ]}
      accessibilityRole="text"
    >
      {spec.tone === 'live' ? (
        <View style={[styles.liveDot, { backgroundColor: p.accent }]} />
      ) : (
        <Ionicons name={spec.icon} size={13} color={tone.text} />
      )}
      <FuText variant="badge" style={{ color: tone.text }}>
        {t(spec.labelKey)}
      </FuText>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing(1.5),
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(0.5),
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
