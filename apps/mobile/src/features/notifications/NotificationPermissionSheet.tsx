/**
 * M1c-a — LE moment. Un client accepte ou refuse ici, et sur iOS c'est pour
 * toujours : le système ne repose jamais la question.
 *
 * Ce que la feuille dit, et pourquoi : ce que LE CLIENT y gagne. Il vient de
 * rejoindre une file, il va attendre, et la seule chose qu'il veut savoir,
 * c'est quand c'est son tour — sans garder l'écran allumé dans sa main.
 * Rien sur nous, rien sur « restez informé », aucune promesse sur des posts
 * ou des offres : ce qui est demandé ici sert l'appel de la file, et les
 * autres catégories se règlent dans le compte.
 *
 * Un refus n'enlève rien : l'écran de suivi garde son comportement de M1b
 * (il reste éveillé, la position se rafraîchit). La feuille le dit.
 */
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'

import { color, radius, spacing } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { Sheet } from '@/shared/ui/Sheet'
import { FuText } from '@/shared/ui/Text'

export interface NotificationPermissionSheetProps {
  open: boolean
  busy?: boolean
  onClose: () => void
  onAccept: () => void
}

export function NotificationPermissionSheet({
  open,
  busy = false,
  onClose,
  onAccept,
}: NotificationPermissionSheetProps) {
  const { t } = useTranslation('v2')

  return (
    <Sheet open={open} onClose={onClose} title={t('mobile.push.permission.title')}>
      <View style={styles.body}>
        <View style={styles.badge} accessibilityElementsHidden>
          <Ionicons name="notifications-outline" size={22} color={color.accentText} />
        </View>

        <FuText variant="title">{t('mobile.push.permission.title')}</FuText>
        <FuText variant="body" tone="secondary">
          {t('mobile.push.permission.body')}
        </FuText>
        <FuText variant="sm" tone="tertiary">
          {t('mobile.push.permission.reassurance')}
        </FuText>

        <Button
          label={t('mobile.push.permission.accept')}
          size="lg"
          fullWidth
          loading={busy}
          onPress={onAccept}
        />
        <Button
          label={t('mobile.push.permission.later')}
          variant="ghost"
          fullWidth
          onPress={onClose}
        />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing(3), paddingBottom: spacing(2) },
  badge: {
    alignSelf: 'flex-start',
    width: 44,
    height: 44,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSubtle,
  },
})
