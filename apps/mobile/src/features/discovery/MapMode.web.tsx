import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { MapModeProps } from '@/features/discovery/MapMode'
import { FuText } from '@/shared/ui/Text'
import { color, radius, spacing } from '@/shared/theme/tokens'

/**
 * Variante WEB du mode carte — la cible produit est iOS (Expo Go) ;
 * la sortie web d'Expo ne sert ici que de véhicule de QA sur cet hôte
 * Linux sans iPhone. `react-native-maps` n'a pas d'implémentation web :
 * ce remplaçant DIT l'absence au lieu de casser le bundle web.
 */
export function MapMode({ rows }: MapModeProps) {
  const { t } = useTranslation('v2')
  return (
    <View style={styles.frame}>
      <FuText variant="sm" tone="secondary" style={styles.center}>
        {t('discovery.map.label')} — iOS
      </FuText>
      <FuText variant="sm" tone="tertiary" style={styles.center}>
        {rows.length === 0 ? t('discovery.map.empty') : t('discovery.results.count', { count: rows.length })}
      </FuText>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    borderRadius: radius.card,
    backgroundColor: color.surfaceSubtle,
  },
  center: { textAlign: 'center' },
})
