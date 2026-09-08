import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import {
  startingPrice,
  type ProfessionalSearchRow,
  type ResultAvailability,
} from '@/shared/data/discovery'
import { demoBanner, resolveMediaSource } from '@/shared/lib/demoMedia'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge, LiveBadge } from '@/shared/ui/Badge'
import { BannerImage } from '@/shared/ui/BannerImage'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import { Money } from '@/shared/ui/Money'
import { color, duration, radius, shadow, spacing } from '@/shared/theme/tokens'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'

/**
 * D1 §4 transposée — LA carte de résultat : mini-bannière (84 px), portrait
 * rond en surimpression décalé (ring surface), nom, type · ville · distance,
 * prix « à partir de » + UN badge d'état. Élévation réelle (ombre teintée
 * d'encre), rayon carte 16. ~200 px de haut — trois par écran.
 *
 * Toute la carte est LE bouton : un tap ouvre la FEUILLE, pas le profil.
 * Elle ne dit que des faits — prix minimum réel sinon « — », disponibilité
 * dérivée de get_public_service_state sinon rien d'affirmé.
 * Pression : scale .985 en 120 ms ; aucune sous réduction d'animations.
 */
export interface ResultCardProps {
  row: ProfessionalSearchRow
  currencyByOrganization: Record<string, string> | undefined
  availability: ResultAvailability
  onOpen: (row: ProfessionalSearchRow) => void
}

export function ResultCard({ row, currencyByOrganization, availability, onOpen }: ResultCardProps) {
  const { t, i18n } = useTranslation('v2')
  const reduced = usePrefersReducedMotion()
  const pressed = useSharedValue(0)

  const isServiceArea = row.location_kind === 'service_area'
  const price = startingPrice(row, currencyByOrganization)
  const banner = demoBanner(row.organization_slug)
  const supplyLabel =
    row.marketplace_supply_type === 'independent'
      ? t('discovery.row.supplyIndependent')
      : row.marketplace_supply_type === 'barbershop'
        ? t('discovery.row.supplyBarbershop')
        : null

  const pressStyle = useAnimatedStyle(() => ({
    transform: reduced ? [] : [{ scale: 1 - pressed.value * 0.015 }],
  }))

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('discovery.card.openAria', { name: row.organization_name })}
      onPress={() => onOpen(row)}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: duration.instant })
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: duration.instant })
      }}
    >
      {/* L'ombre iOS et overflow:hidden ne cohabitent pas sur la même vue :
          l'ombre vit sur l'enveloppe, le rognage sur l'intérieur. */}
      <Animated.View style={[styles.card, shadow.card, pressStyle]}>
        <View style={styles.cardInner}>
        <BannerImage src={banner} name={row.organization_name} height={84} />

        <View style={styles.portraitRow}>
          <Avatar
            name={row.barber_display_name ?? row.organization_name}
            src={resolveMediaSource(row.barber_avatar_url)}
            size="lg"
            ringColor={color.surface}
          />
          {!row.is_managed && (
            <View style={styles.claimHint}>
              <FuText variant="badge" tone="secondary">
                {t('states.claim.unclaimedShort')}
              </FuText>
            </View>
          )}
        </View>

        <View style={styles.body}>
          <FuText variant="bodySemibold" numberOfLines={1}>
            {row.organization_name}
          </FuText>
          <View style={styles.metaRow}>
            {supplyLabel ? (
              <>
                <FuText variant="sm" tone="secondary">
                  {supplyLabel}
                </FuText>
                <FuText variant="sm" tone="tertiary">
                  ·
                </FuText>
              </>
            ) : null}
            <Ionicons name="location-outline" size={13} color={color.textSecondary} />
            <FuText variant="sm" tone="secondary" numberOfLines={1} style={styles.city}>
              {isServiceArea ? t('discovery.row.serviceArea', { city: row.city ?? '' }) : (row.city ?? '')}
            </FuText>
            {row.distance_km !== null ? (
              <MonoText size="sm" tone="secondary">
                {new Intl.NumberFormat(i18n.language, {
                  style: 'unit',
                  unit: 'kilometer',
                  maximumFractionDigits: 1,
                }).format(row.distance_km)}
              </MonoText>
            ) : null}
          </View>

          <View style={styles.priceRow}>
            {price ? (
              <Money cents={price.cents} currency={price.currency} from weight="medium" />
            ) : (
              <FuText
                variant="sm"
                tone="secondary"
                accessibilityLabel={t('discovery.row.noPrice')}
              >
                {t('states.metric.noData')}
              </FuText>
            )}
            {availability === 'available-now' ? (
              <LiveBadge label={t('states.booking.availableNow')} />
            ) : (
              <Badge
                variant={row.is_open_now ? 'brand' : 'neutral'}
                label={row.is_open_now ? t('states.opening.open') : t('states.opening.closedShort')}
              />
            )}
          </View>
        </View>
        </View>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    backgroundColor: color.surface,
  },
  cardInner: {
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  portraitRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(4),
    marginTop: -28,
  },
  claimHint: {
    backgroundColor: color.surface,
    borderRadius: radius.control,
    paddingHorizontal: spacing(2),
    paddingVertical: 2,
    marginBottom: spacing(1),
    borderWidth: 1,
    borderColor: color.border,
  },
  body: { paddingHorizontal: spacing(4), paddingBottom: spacing(3.5), paddingTop: spacing(1.5) },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    marginTop: 2,
  },
  city: { flexShrink: 1 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing(2),
  },
})
