import { useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as Location from 'expo-location'

import { color, spacing } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { Money } from '@/shared/ui/Money'
import { Sheet } from '@/shared/ui/Sheet'
import { FuText } from '@/shared/ui/Text'
import { useBookingAlternatives, usePublicCurrencies } from '@/features/booking/api/booking'
import { BookingRow, CardList } from '@/features/booking/components/BookingCard'

/**
 * Les alternatives après une demande expirée (F4 §5) — construites par B2 :
 * elles excluent l'organisation d'origine, se trient par distance quand une
 * position existe, et portent `accepts_immediate_booking`.
 *
 * Ce champ vaut `false` presque partout aujourd'hui — c'est une information
 * VRAIE, pas un défaut : le CTA dit « Réserver » SEULEMENT quand la
 * confirmation est immédiate ; ailleurs il dit « Envoyer une demande ».
 * Personne n'est envoyé vers une seconde attente sous une promesse de
 * réservation.
 *
 * La géolocalisation n'est demandée QU'AU geste « trier par distance »
 * (MASTER_SPEC §8, loi M1a §3) — jamais à l'ouverture de la feuille. Un
 * refus se dit calmement, sans blocage.
 */
export function AlternativesSheet({
  open,
  onClose,
  excludeOrganizationId,
  serviceQuery,
}: {
  open: boolean
  onClose: () => void
  excludeOrganizationId: string | null
  serviceQuery: string | null
}) {
  const { t, i18n } = useTranslation('v2')
  const router = useRouter()
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null)
  const [geoDenied, setGeoDenied] = useState(false)
  const [locating, setLocating] = useState(false)

  const alternatives = useBookingAlternatives({
    excludeOrganizationId,
    serviceQuery,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    enabled: open,
  })

  const rows = alternatives.data ?? []
  const currencies = usePublicCurrencies(rows.map((alt) => alt.organization_id))
  const kmFormat = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 })

  const askLocation = async () => {
    setGeoDenied(false)
    setLocating(true)
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (!permission.granted) {
        setGeoDenied(true)
        return
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude })
    } catch {
      setGeoDenied(true)
    } finally {
      setLocating(false)
    }
  }

  const goToTunnel = (slug: string, locationId: string) => {
    onClose()
    router.push(`/book/${encodeURIComponent(slug)}?l=${encodeURIComponent(locationId)}` as never)
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('booking.alternatives.title')}>
      <View style={styles.body}>
        <View style={styles.header}>
          <FuText variant="title">{t('booking.alternatives.title')}</FuText>
          <FuText variant="sm" tone="secondary">
            {t('booking.alternatives.description')}
          </FuText>
        </View>

        {coords === null ? (
          <Button
            label={t('booking.alternatives.useLocation')}
            variant="secondary"
            fullWidth
            loading={locating}
            onPress={() => void askLocation()}
          />
        ) : null}
        {geoDenied ? (
          <FuText variant="sm" tone="secondary" accessibilityRole="alert">
            {t('booking.alternatives.geoDenied')}
          </FuText>
        ) : null}

        {alternatives.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.accentText} accessibilityLabel={t('common.loading.generic')} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.center}>
            <FuText variant="sm" tone="secondary" style={styles.centerText}>
              {t('booking.alternatives.empty')}
            </FuText>
            <Button
              label={t('booking.alternatives.emptyAction')}
              variant="secondary"
              onPress={() => {
                onClose()
                router.push('/search')
              }}
            />
          </View>
        ) : (
          <CardList>
            {rows.map((alt) => {
              const altCurrency = currencies.data?.[alt.organization_id] ?? null
              const subtitle = [
                alt.city ?? undefined,
                alt.distance_km !== null
                  ? t('booking.alternatives.distanceKm', { distance: kmFormat.format(alt.distance_km) })
                  : undefined,
                alt.is_open_now ? t('booking.alternatives.openNow') : undefined,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <BookingRow
                  key={alt.location_id}
                  title={alt.organization_name}
                  subtitle={subtitle.length > 0 ? subtitle : undefined}
                  footer={
                    <View style={styles.altActions}>
                      {/* `null` de devise n'est pas zéro : sans devise résolue,
                          aucun prix n'est affiché — jamais une estimation. */}
                      {alt.starting_price_cents !== null && altCurrency !== null ? (
                        <Money cents={alt.starting_price_cents} currency={altCurrency} from />
                      ) : (
                        <View />
                      )}
                      <Button
                        label={
                          alt.accepts_immediate_booking
                            ? t('booking.alternatives.book')
                            : t('booking.alternatives.sendRequest')
                        }
                        variant="secondary"
                        onPress={() => goToTunnel(alt.organization_slug, alt.location_id)}
                      />
                    </View>
                  }
                />
              )
            })}
          </CardList>
        )}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing(4), paddingBottom: spacing(2) },
  header: { gap: spacing(1) },
  center: { alignItems: 'center', gap: spacing(3), paddingVertical: spacing(6) },
  centerText: { textAlign: 'center' },
  altActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(3),
    marginTop: spacing(2),
  },
})
