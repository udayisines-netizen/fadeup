/**
 * M1b — le bandeau hors connexion, décision fondateur (prompt §3) : discret,
 * honnête, permanent tant que le réseau manque. Il n'affirme rien d'autre que
 * l'absence de réseau — les écrans qui dépendent du réseau portent en plus
 * leur propre état « rien de périmé n'est montré ».
 */
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useIsOnline } from '@/shared/hooks/useIsOnline'
import { color, spacing } from '@/shared/theme/tokens'
import { FuText } from '@/shared/ui/Text'

export function OfflineBanner() {
  const { t } = useTranslation('v2')
  const online = useIsOnline()
  const insets = useSafeAreaInsets()
  // `null` = pas encore mesuré : pas de bandeau fugace au lancement.
  if (online !== false) return null
  return (
    <View style={[styles.banner, { paddingTop: insets.top + spacing(1.5) }]} accessibilityRole="alert">
      <View style={styles.dot} />
      <FuText variant="sm" tone="secondary">
        {t('mobile.offline.banner')}
      </FuText>
    </View>
  )
}

/**
 * L'état plein-écran des surfaces qui refusent d'afficher du périmé
 * (suivi de file en tête). Toujours avec l'explication, jamais un spinner.
 */
export function OfflineBlock({ body }: { body?: string }) {
  const { t } = useTranslation('v2')
  return (
    <View style={styles.block}>
      <FuText variant="title" style={styles.center}>
        {t('mobile.offline.blockedTitle')}
      </FuText>
      <FuText variant="sm" tone="secondary" style={styles.center}>
        {body ?? t('mobile.offline.blockedBody')}
      </FuText>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    /* Survol absolu : un frère du navigateur (Stack) casse la mise en page
       de react-native-screens (constaté en QA M1b) — le bandeau se pose
       PAR-DESSUS, discret, sans toucher l'arbre du navigateur. */
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(4),
    backgroundColor: color.surfaceSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.textTertiary,
  },
  block: {
    alignItems: 'center',
    gap: spacing(2),
    paddingVertical: spacing(10),
    paddingHorizontal: spacing(6),
  },
  center: { textAlign: 'center' },
})
