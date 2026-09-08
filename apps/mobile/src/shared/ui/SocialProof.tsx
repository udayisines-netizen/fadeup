import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import { color, spacing } from '@/shared/theme/tokens'

/**
 * Les CINQ métriques, distinctes, sur UNE ligne (modèle X — D1 §6) :
 * Followers · Verified Clients · Rating · Reviews · Likes. Jamais agrégées.
 *
 * La distinction F2, reprise telle quelle :
 *   - un zéro COMPTÉ (la base répond « zéro ligne ») s'affiche 0 ;
 *   - une donnée SANS CONTRAT public s'affiche « — » (null ici) ;
 *   - Rating null = « — » (jamais zéro étoile — `null` n'est pas zéro).
 */
export interface SocialProofValues {
  /** null = aucun contrat / pas encore chargé — « — ». */
  followers: number | null
  verifiedClients: number | null
  rating: number | null
  reviews: number | null
  likes: number | null
}

const ICONS = {
  followers: 'people-outline',
  verifiedClients: 'shield-checkmark-outline',
  rating: 'star-outline',
  reviews: 'chatbubble-ellipses-outline',
  likes: 'heart-outline',
} as const

export function SocialProof({ values }: { values: SocialProofValues }) {
  const { t, i18n } = useTranslation('v2')

  const compact = (n: number): string =>
    new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

  const render = (key: keyof SocialProofValues): string => {
    const value = values[key]
    if (value === null) return t('states.metric.noData')
    if (key === 'rating') return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value)
    if (key === 'followers') return compact(value)
    return new Intl.NumberFormat(i18n.language).format(value)
  }

  const label = (key: keyof SocialProofValues): string => t(`states.metric.${key}`)

  return (
    <View style={styles.row} accessibilityRole="summary">
      {(Object.keys(ICONS) as (keyof SocialProofValues)[]).map((key) => (
        <View
          key={key}
          style={styles.metric}
          accessibilityLabel={`${label(key)} : ${render(key)}`}
        >
          <View style={styles.valueRow}>
            <Ionicons name={ICONS[key]} size={14} color={color.textSecondary} />
            <MonoText size="sm" weight="medium">
              {render(key)}
            </MonoText>
          </View>
          <FuText variant="badge" tone="tertiary" numberOfLines={1}>
            {label(key)}
          </FuText>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing(1),
  },
  metric: { alignItems: 'center', gap: 2, minWidth: 56 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
})
