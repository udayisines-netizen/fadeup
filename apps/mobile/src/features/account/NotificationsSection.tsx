import { Fragment } from 'react'
import { Linking, StyleSheet, Switch, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  useNotificationPreferences,
  useSetNotificationPreference,
} from '@/features/notifications/api/devices'
import { PUSH_CATEGORIES, type PushCategory } from '@/features/notifications/api/pushClient'
import { usePushDevice } from '@/features/notifications/usePushDevice'
import { Card, Divider, Section } from '@/features/account/parts'
import { Button } from '@/shared/ui/Button'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import { color, spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * Notifications — quatre catégories, tenues EN BASE depuis M1c-a
 * (`notification_push_preferences`, RPC `get_my_notification_preferences` /
 * `set_my_notification_preference`). M1b gardait ces interrupteurs sur
 * l'appareil et le disait : aucun contrat serveur n'existait. Il existe.
 *
 * Ce que ces interrupteurs gouvernent, exactement : le PUSH. Couper l'appel de
 * file fait taire l'écran verrouillé ; la notification dans l'application et
 * l'e-mail transactionnel partent quoi qu'il arrive. Le texte de la section le
 * dit, parce qu'un client qui croit avoir coupé une confirmation de
 * rendez-vous ne la cherchera pas.
 *
 * L'état SYSTÈME prime sur tout : si iOS a refusé, aucun interrupteur ici ne
 * peut y changer quoi que ce soit — on le dit et on ouvre les Réglages, plutôt
 * que d'afficher quatre interrupteurs qui mentent.
 */
const LABEL_KEY: Record<PushCategory, string> = {
  queue_call: 'mobile.account.notifQueue',
  booking_response: 'mobile.account.notifBooking',
  appointment_reminder: 'mobile.account.notifReminder',
  social_post: 'mobile.account.notifSocial',
}

const HINT_KEY: Record<PushCategory, string> = {
  queue_call: 'mobile.account.notifQueueHint',
  booking_response: 'mobile.account.notifBookingHint',
  appointment_reminder: 'mobile.account.notifReminderHint',
  social_post: 'mobile.account.notifSocialHint',
}

export function NotificationsSection() {
  const { t } = useTranslation('v2')
  const preferences = useNotificationPreferences(true)
  const setPreference = useSetNotificationPreference()
  const { status } = usePushDevice()

  const systemDenied = status === 'denied'

  return (
    <Section title={t('mobile.account.notifSection')}>
      <Card style={styles.card}>
        <FuText variant="sm" tone="secondary">
          {t('mobile.account.notifBody')}
        </FuText>

        {systemDenied ? (
          /* Le système a tranché : aucun réglage ici ne peut le contredire.
             On le dit, et on propose le seul geste qui marche. */
          <View style={styles.denied}>
            <FuText variant="sm">{t('mobile.push.deniedHint')}</FuText>
            <Button
              label={t('mobile.push.openSettings')}
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          </View>
        ) : null}

        {preferences.isError ? (
          <View style={styles.denied}>
            <FuText variant="sm" tone="danger" accessibilityRole="alert">
              {t('errors.data.unknown')}
            </FuText>
            <Button
              label={t('common.action.retry')}
              variant="secondary"
              onPress={() => void preferences.refetch()}
            />
          </View>
        ) : null}

        {PUSH_CATEGORIES.map((category, index) => (
          <Fragment key={category}>
            {index === 0 ? <Divider /> : null}
            <View style={styles.row}>
              <View style={styles.rowLabels}>
                <FuText variant="body">{t(LABEL_KEY[category])}</FuText>
                <FuText variant="badge" tone="tertiary">
                  {t(HINT_KEY[category])}
                </FuText>
              </View>
              {preferences.data === undefined ? (
                /* `undefined` n'est pas « désactivé » : on n'affirme pas un
                   état d'interrupteur avant que le serveur ait répondu. */
                <Skeleton width={51} height={31} style={styles.switchSkeleton} />
              ) : (
                <Switch
                  value={preferences.data[category]}
                  disabled={systemDenied || setPreference.isPending}
                  onValueChange={(next) => setPreference.mutate({ category, enabled: next })}
                  accessibilityRole="switch"
                  accessibilityLabel={t(LABEL_KEY[category])}
                  trackColor={{ false: color.borderStrong, true: color.accent }}
                  ios_backgroundColor={color.surfaceSubtle}
                />
              )}
            </View>
            {index < PUSH_CATEGORIES.length - 1 ? <Divider /> : null}
          </Fragment>
        ))}
      </Card>
    </Section>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing(1) },
  denied: { gap: spacing(2), paddingVertical: spacing(1) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(3),
    minHeight: touchTarget + 4,
  },
  rowLabels: { flex: 1, gap: 2 },
  switchSkeleton: { borderRadius: 16 },
})
