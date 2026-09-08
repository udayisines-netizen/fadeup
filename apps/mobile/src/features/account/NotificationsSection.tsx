import { Fragment } from 'react'
import { StyleSheet, Switch, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { NOTIF_PREF_KEYS, type NotifPrefKey } from '@/features/account/prefs'
import { Card, Divider, Section } from '@/features/account/parts'
import { useNotifPrefs } from '@/features/account/useNotifPrefs'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import { color, spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * Notifications — trois choix, gardés SUR L'APPAREIL (AsyncStorage). Le push
 * FadeUp n'existe pas encore : le texte le dit, et rien ici ne promet un
 * effet immédiat. Aucun contrat serveur de préférences n'existe (manque
 * déclaré) — on n'en invente pas un.
 */
const LABEL_KEY: Record<NotifPrefKey, string> = {
  queue: 'mobile.account.notifQueue',
  booking: 'mobile.account.notifBooking',
  social: 'mobile.account.notifSocial',
}

export function NotificationsSection() {
  const { t } = useTranslation('v2')
  const { prefs, toggle } = useNotifPrefs()

  return (
    <Section title={t('mobile.account.notifSection')}>
      <Card style={styles.card}>
        <FuText variant="sm" tone="secondary">
          {t('mobile.account.notifBody')}
        </FuText>
        {NOTIF_PREF_KEYS.map((key, index) => (
          <Fragment key={key}>
            {index === 0 ? <Divider /> : null}
            <View style={styles.row}>
              <FuText variant="body" style={styles.rowLabel}>
                {t(LABEL_KEY[key])}
              </FuText>
              {prefs === null ? (
                /* `null` n'est pas « désactivé » : on n'affirme pas un état
                   d'interrupteur avant d'avoir lu le stockage. */
                <Skeleton width={51} height={31} style={styles.switchSkeleton} />
              ) : (
                <Switch
                  value={prefs[key]}
                  onValueChange={(next) => toggle(key, next)}
                  accessibilityRole="switch"
                  accessibilityLabel={t(LABEL_KEY[key])}
                  trackColor={{ false: color.borderStrong, true: color.accent }}
                  ios_backgroundColor={color.surfaceSubtle}
                />
              )}
            </View>
            {index < NOTIF_PREF_KEYS.length - 1 ? <Divider /> : null}
          </Fragment>
        ))}
      </Card>
    </Section>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing(1) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(3),
    minHeight: touchTarget + 4,
  },
  rowLabel: { flex: 1 },
  switchSkeleton: { borderRadius: 16 },
})
