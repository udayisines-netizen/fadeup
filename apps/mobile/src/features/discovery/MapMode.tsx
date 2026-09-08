import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import MapView, { Marker } from 'react-native-maps'
import type { ProfessionalSearchRow } from '@/shared/data/discovery'
import type { SearchPoint } from '@/features/discovery/searchState'
import { FuText } from '@/shared/ui/Text'
import { color, radius, spacing } from '@/shared/theme/tokens'

/**
 * La carte est un MODE, pas une colonne (M1a §8). Langage minimal hérité de
 * F3 (déclaré non ratifié, D1 §12.3) : marqueurs uniformes à la couleur
 * d'accent, AUCUN cluster, un tap ouvre la feuille de résultat. Une zone de
 * service est marquée à son CENTRE — aucune adresse inventée. Les lignes
 * sans position ne figurent pas sur la carte et leur compte est dit.
 *
 * Fond de carte : Apple Maps (le rendu par défaut d'iOS — aucun fournisseur
 * tiers, aucune clé). Expo Go le rend tel quel.
 */
export interface MapModeProps {
  rows: ProfessionalSearchRow[]
  point: SearchPoint | null
  onOpen: (row: ProfessionalSearchRow) => void
}

interface Located {
  row: ProfessionalSearchRow
  latitude: number
  longitude: number
}

const PARIS_FALLBACK = { latitude: 48.8566, longitude: 2.3522 }

export function MapMode({ rows, point, onOpen }: MapModeProps) {
  const { t } = useTranslation('v2')

  const located = useMemo<Located[]>(() => {
    const result: Located[] = []
    for (const row of rows) {
      const latitude = row.latitude ?? row.service_area_center_latitude
      const longitude = row.longitude ?? row.service_area_center_longitude
      if (latitude !== null && longitude !== null) {
        result.push({ row, latitude, longitude })
      }
    }
    return result
  }, [rows])

  const unlocatedCount = rows.length - located.length

  const region = useMemo(() => {
    const center = point ?? located[0] ?? PARIS_FALLBACK
    return {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: 0.12,
      longitudeDelta: 0.12,
    }
  }, [point, located])

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        accessibilityLabel={t('discovery.map.label')}
        showsPointsOfInterests={false}
      >
        {located.map(({ row, latitude, longitude }) => (
          <Marker
            key={`${row.organization_id}-${row.location_id}`}
            coordinate={{ latitude, longitude }}
            title={row.organization_name}
            description={
              row.location_kind === 'service_area'
                ? t('discovery.row.serviceArea', { city: row.city ?? '' })
                : (row.city ?? undefined)
            }
            pinColor={color.accent}
            onCalloutPress={() => onOpen(row)}
          />
        ))}
      </MapView>
      {rows.length === 0 ? (
        <View style={styles.note}>
          <FuText variant="sm" tone="secondary">
            {t('discovery.map.empty')}
          </FuText>
        </View>
      ) : unlocatedCount > 0 ? (
        <View style={styles.note}>
          <FuText variant="sm" tone="secondary">
            {t('discovery.map.unlocated', { count: unlocatedCount })}
          </FuText>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  note: {
    position: 'absolute',
    bottom: spacing(4),
    insetInlineStart: spacing(4),
    insetInlineEnd: spacing(4),
    backgroundColor: color.surface,
    borderRadius: radius.control,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
})
