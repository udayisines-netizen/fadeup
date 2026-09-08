import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import {
  startingPrice,
  useSheetServices,
  type ProfessionalSearchRow,
  type ResultAvailability,
} from '@/shared/data/discovery'
import { demoBanner, resolveMediaSource } from '@/shared/lib/demoMedia'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge, LiveBadge } from '@/shared/ui/Badge'
import { BannerImage } from '@/shared/ui/BannerImage'
import { Button } from '@/shared/ui/Button'
import { ClaimBadge } from '@/shared/ui/ClaimBadge'
import { Duration } from '@/shared/ui/Duration'
import { FuText } from '@/shared/ui/Text'
import { Money } from '@/shared/ui/Money'
import { Sheet } from '@/shared/ui/Sheet'
import { Skeleton } from '@/shared/ui/Skeleton'
import { color, spacing } from '@/shared/theme/tokens'

/**
 * D1 §5 transposée — LA feuille de résultat, sur la primitive Sheet (une
 * seule feuille dans l'app). Un tap sur une carte l'ouvre ; la liste reste
 * dessous, sa position de défilement intacte par construction.
 *
 * Contenu : bannière + portrait + badges d'état → identité → revendication →
 * services principaux (≤ 4, prix réels, cache partagé avec le profil) →
 * LE CTA selon l'état réel → « Voir le profil complet ».
 * Aucun optimisme : un non revendiqué ne fabrique aucune capacité.
 */

const MAX_SHEET_SERVICES = 4

export interface ResultSheetProps {
  row: ProfessionalSearchRow | null
  currencyByOrganization: Record<string, string> | undefined
  availability: ResultAvailability
  onClose: () => void
}

export function ResultSheet({ row, currencyByOrganization, availability, onClose }: ResultSheetProps) {
  const { t } = useTranslation('v2')
  const router = useRouter()

  const slug = row?.organization_slug ?? null
  const services = useSheetServices(slug, row?.location_id ?? null)

  if (!row) return null

  const serviceRows = (services.data ?? []).slice(0, MAX_SHEET_SERVICES)
  const currency = currencyByOrganization?.[row.organization_id]
  const price = startingPrice(row, currencyByOrganization)
  const banner = demoBanner(slug ?? undefined)
  const isServiceArea = row.location_kind === 'service_area'
  const supplyLabel =
    row.marketplace_supply_type === 'independent'
      ? t('discovery.row.supplyIndependent')
      : row.marketplace_supply_type === 'barbershop'
        ? t('discovery.row.supplyBarbershop')
        : null

  const goTo = (path: string) => {
    onClose()
    router.push(path as never)
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={row.organization_name}
      hero={
        <View>
          <BannerImage src={banner} name={row.organization_name} height={128} watermarkSize={144} />
          <View style={styles.heroFooter}>
            <Avatar
              name={row.barber_display_name ?? row.organization_name}
              src={resolveMediaSource(row.barber_avatar_url)}
              size="xl"
              ringColor={color.surface}
            />
            <View style={styles.heroBadges}>
              {availability === 'available-now' && <LiveBadge label={t('states.booking.availableNow')} />}
              <Badge
                variant={row.is_open_now ? 'brand' : 'neutral'}
                label={row.is_open_now ? t('states.opening.open') : t('states.opening.closedShort')}
              />
            </View>
          </View>
        </View>
      }
    >
      <View style={styles.content}>
        <View>
          <FuText variant="title">{row.organization_name}</FuText>
          <View style={styles.metaRow}>
            {supplyLabel ? (
              <FuText variant="sm" tone="secondary">
                {supplyLabel}
              </FuText>
            ) : null}
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={13} color={color.textSecondary} />
              <FuText variant="sm" tone="secondary" style={styles.locationText}>
                {isServiceArea
                  ? t('discovery.row.serviceArea', { city: row.city ?? '' })
                  : [row.address_line1, row.city].filter(Boolean).join(', ')}
              </FuText>
            </View>
          </View>
          {!row.is_managed && (
            <View style={styles.claimRow}>
              <ClaimBadge />
            </View>
          )}
          {availability === 'available-now' && row.queue_waiting_count > 0 && (
            <FuText variant="sm" tone="secondary" style={styles.queueCount}>
              {t('discovery.row.queueCount', { count: row.queue_waiting_count })}
            </FuText>
          )}
        </View>

        {/* Services principaux — prix réels, jamais une estimation. */}
        <View accessibilityLabel={t('discovery.sheet.services')}>
          <FuText variant="smMedium" tone="secondary" style={styles.sectionTitle}>
            {t('discovery.sheet.services')}
          </FuText>
          {services.isPending ? (
            <View style={styles.skeletons} accessibilityElementsHidden>
              <Skeleton width="75%" />
              <Skeleton width="66%" />
              <Skeleton width="75%" />
            </View>
          ) : serviceRows.length > 0 ? (
            <View>
              {serviceRows.map((service, index) => (
                <View key={service.id} style={[styles.serviceRow, index > 0 && styles.serviceDivider]}>
                  <View style={styles.serviceInfo}>
                    <FuText variant="smMedium" numberOfLines={1}>
                      {service.name}
                    </FuText>
                    <Duration minutes={service.duration_minutes} />
                  </View>
                  {currency ? (
                    <Money cents={service.price_cents} currency={currency} />
                  ) : (
                    <FuText variant="sm" tone="secondary">
                      {t('states.metric.noData')}
                    </FuText>
                  )}
                </View>
              ))}
            </View>
          ) : (
            <FuText variant="sm" tone="secondary">
              {price ? '' : t('discovery.sheet.servicesEmpty')}
            </FuText>
          )}
          {!services.isPending && serviceRows.length === 0 && price ? (
            <Money cents={price.cents} currency={price.currency} from />
          ) : null}
        </View>

        {/* L'ÉTAT RÉEL conditionne LE CTA. La destination réelle (tunnel de
            réservation, file) est M1b : placeholder honnête, jamais un
            bouton qui ne fait rien. */}
        <View style={styles.ctaBlock}>
          {availability === 'bookable' ? (
            <Button
              label={t('common.action.book')}
              size="lg"
              fullWidth
              onPress={() => goTo(`/book/${encodeURIComponent(row.organization_slug)}`)}
            />
          ) : availability === 'available-now' ? (
            <Button
              label={t('profile.cta.joinQueue')}
              size="lg"
              fullWidth
              onPress={() => goTo(`/q/${encodeURIComponent(row.organization_slug)}`)}
            />
          ) : (
            <>
              <Button
                label={t('common.action.book')}
                size="lg"
                fullWidth
                disabled
                loading={availability === 'loading'}
              />
              {availability !== 'loading' && (
                <FuText variant="sm" tone="secondary" style={styles.ctaNote}>
                  {availability === 'unknown'
                    ? t('profile.cta.unknownNote')
                    : !row.is_managed
                      ? t('profile.unclaimed.bookingUnavailable')
                      : t('profile.cta.closedNote')}
                </FuText>
              )}
            </>
          )}
          <Button
            label={t('discovery.sheet.fullProfile')}
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => goTo(`/shop/${encodeURIComponent(row.organization_slug)}`)}
          />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(4),
    marginTop: -32,
  },
  heroBadges: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginBottom: spacing(1) },
  content: { gap: spacing(4), paddingBottom: spacing(2) },
  metaRow: { gap: 2, marginTop: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  locationText: { flexShrink: 1 },
  claimRow: { marginTop: spacing(2) },
  queueCount: { marginTop: spacing(1.5) },
  sectionTitle: { marginBottom: spacing(2) },
  skeletons: { gap: spacing(2) },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(3),
    paddingVertical: spacing(2.5),
  },
  serviceDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  serviceInfo: { flexShrink: 1, gap: 2 },
  ctaBlock: { gap: spacing(2) },
  ctaNote: { textAlign: 'center' },
})
