import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useKeepAwake } from 'expo-keep-awake'
import * as Haptics from 'expo-haptics'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import type { PublicQueueFile } from '@/shared/data/publicQueue'
import type { QueueEntryTracking } from '@/features/queue/api/publicQueue'
import {
  deriveCalledCountdown,
  deriveTrackingView,
  displayableWaitMinutes,
  peopleAheadLabelKey,
} from '@/features/queue/lib/tracking'
import { QueueFileList, queueDisplayName } from '@/features/queue/components/QueueFileList'
import { MomentButton } from '@/features/queue/components/MomentButton'
import { useNow } from '@/shared/hooks/useNow'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'
import { color, duration, fontSize, radius, spacing } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { MonoText } from '@/shared/ui/MonoText'
import { Sheet } from '@/shared/ui/Sheet'
import { Skeleton } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { FuText } from '@/shared/ui/Text'

/**
 * Suivre sa place — LE moment sombre de l'app cliente (thème `moment`, D1
 * §9) : un écran qu'on garde ouvert, souvent debout dans le salon. Nourri par
 * `get_queue_entry_tracking` : position dans SA file, échéance d'appel
 * ABSOLUE calculée serveur, estimation, nature d'une éventuelle sortie.
 * JAMAIS l'identité des autres — un rang et un nombre, rien d'autre.
 *
 * Règles tenues ici (transposition de apps/web QueueTracking.tsx) :
 *  - le compte à rebours n'apparaît QUE si l'échéance existe ; dépassée, il
 *    bascule sur « le délai est écoulé » — jamais une valeur négative ;
 *  - l'appel est impossible à manquer : panneau vert PLEIN, texte encre,
 *    annonce d'accessibilité et retour haptique à la TRANSITION réelle
 *    (une fois, jamais rejoué à chaque poll) ;
 *  - l'écran reste éveillé tant qu'une place est suivie — c'est ce qui
 *    remplace le poll d'onglet caché du web, que le natif n'a pas ;
 *  - AUCUNE proposition automatique de changer de file : le bouton existe,
 *    il attend le client (F1b §2) ;
 *  - quitter demande confirmation, et le texte diffère si le client a déjà
 *    été appelé ;
 *  - un client déplacé PAR le salon le voit : bandeau `movedNotice`.
 */

export interface QueueTrackingProps {
  entry: QueueEntryTracking | null
  organizationName: string
  /** Les files du lieu, pour la feuille « Changer de barber ». */
  queues: PublicQueueFile[]
  busy: boolean
  onLeave: () => void
  onChangeBarber: (toBarberId: string | null) => void
  /** Sortie des états terminaux : on oublie la trace et on revoit la file. */
  onDismiss: () => void
}

/** L'écran reste allumé — monté UNIQUEMENT tant qu'une place est suivie. */
function KeepAwake() {
  useKeepAwake()
  return null
}

export function QueueTracking({
  entry,
  organizationName,
  queues,
  busy,
  onLeave,
  onChangeBarber,
  onDismiss,
}: QueueTrackingProps) {
  const { t } = useTranslation('v2')
  const now = useNow(1_000)
  const reduced = usePrefersReducedMotion()

  const [leaveOpen, setLeaveOpen] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  const [pickedQueue, setPickedQueue] = useState<PublicQueueFile | null>(null)
  const [movedTo, setMovedTo] = useState<{ name: string | null } | null>(null)

  const previousStatus = useRef<QueueEntryTracking['status'] | null>(null)
  /** `undefined` = file pas encore observée ; ensuite l'id (null = premier dispo). */
  const previousBarberId = useRef<string | null | undefined>(undefined)

  const view = deriveTrackingView(entry, false)
  const status = entry?.status ?? null

  // Passage à « appelé » : annonce + haptique, sur TRANSITION seulement.
  useEffect(() => {
    if (status === 'called' && previousStatus.current !== 'called') {
      AccessibilityInfo.announceForAccessibility(t('queue.track.called.title'))
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
    previousStatus.current = status
  }, [status, t])

  // Déplacement par le salon : la file de l'entrée change sans geste local.
  useEffect(() => {
    if (!entry || entry.status !== 'waiting') return
    if (previousBarberId.current !== undefined && previousBarberId.current !== entry.barber_id) {
      setMovedTo({ name: entry.barber_display_name })
    }
    previousBarberId.current = entry.barber_id
  }, [entry])

  // ---- Première réponse pas encore arrivée : rien n'est affirmé.
  if (view.kind === 'loading') {
    return (
      <View style={styles.centered} accessibilityElementsHidden>
        <Skeleton width={120} height={56} style={styles.darkSkeleton} />
        <Skeleton width={180} height={16} style={styles.darkSkeleton} />
      </View>
    )
  }

  // ---- États terminaux : un message honnête et une action, jamais un cul-de-sac.
  if (view.kind === 'ended') {
    return (
      <View style={styles.centered}>
        <FuText variant="title" style={[styles.center, { color: color.moment.textPrimary }]}>
          {t(`queue.track.ended.${view.key}.title`)}
        </FuText>
        <FuText variant="sm" style={[styles.center, { color: color.moment.textSecondary }]}>
          {t(`queue.track.ended.${view.key}.description`)}
        </FuText>
        <MomentButton label={t('queue.track.ended.action')} onPress={onDismiss} />
      </View>
    )
  }

  if (view.kind === 'in_service') {
    return (
      <View style={styles.centered}>
        <StateBadge state="confirmed" dark />
        <FuText variant="title" style={[styles.center, { color: color.moment.textPrimary }]}>
          {t('queue.track.inService.title')}
        </FuText>
      </View>
    )
  }

  // ---- L'appel : le seul vert PLEIN de l'écran.
  if (view.kind === 'called') {
    const countdown = deriveCalledCountdown(entry?.called_deadline_at ?? null, now)
    return (
      <>
        <KeepAwake />
        <CalledPanel
          reduced={reduced}
          organizationName={organizationName}
          countdown={countdown}
          busy={busy}
          onLeavePress={() => setLeaveOpen(true)}
        />
        <LeaveConfirmSheet
          open={leaveOpen}
          called
          busy={busy}
          onClose={() => setLeaveOpen(false)}
          onConfirm={() => {
            setLeaveOpen(false)
            onLeave()
          }}
        />
      </>
    )
  }

  // ---- En attente.
  const ahead = entry?.people_ahead ?? null
  const aheadKey = peopleAheadLabelKey(ahead)
  const waitMinutes = displayableWaitMinutes(entry?.estimated_wait_minutes ?? null, ahead)
  const queueLabel =
    entry?.barber_id == null
      ? t('queue.track.queueFirstAvailable')
      : t('queue.track.queueName', { name: entry.barber_display_name ?? '' })

  return (
    <View style={styles.waiting}>
      <KeepAwake />

      {movedTo ? (
        <View style={styles.movedNotice} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <FuText variant="sm" style={{ color: color.moment.textPrimary }}>
            {movedTo.name
              ? t('queue.track.movedNotice', { name: movedTo.name })
              : t('queue.track.movedNoticeFirstAvailable')}
          </FuText>
        </View>
      ) : null}

      <FuText variant="smMedium" style={{ color: color.moment.textSecondary }}>
        {t('queue.track.yourPosition')}
      </FuText>

      <PositionNumber value={entry?.queue_position ?? null} reduced={reduced} />

      <FuText variant="sm" style={[styles.center, { color: color.moment.textSecondary }]}>
        {queueLabel}
      </FuText>

      {aheadKey ? (
        <FuText variant="body" style={[styles.center, { color: color.moment.textPrimary }]}>
          {t(aheadKey, { count: ahead ?? 0 })}
        </FuText>
      ) : null}

      {waitMinutes !== null ? (
        <FuText variant="sm" style={[styles.center, { color: color.moment.textSecondary }]}>
          {t('queue.track.estimatedWait', { minutes: waitMinutes })}
        </FuText>
      ) : null}

      <View style={styles.actions}>
        {queues.length > 1 ? (
          <MomentButton
            label={t('queue.track.changeCta')}
            variant="outline"
            disabled={busy}
            onPress={() => setChangeOpen(true)}
          />
        ) : null}
        <MomentButton
          label={t('queue.track.leaveCta')}
          variant="quiet"
          disabled={busy}
          onPress={() => setLeaveOpen(true)}
        />
      </View>

      <FuText variant="badge" style={[styles.center, { color: color.moment.textTertiary }]}>
        {t('mobile.queuex.keptAwake')}
      </FuText>

      <LeaveConfirmSheet
        open={leaveOpen}
        called={false}
        busy={busy}
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => {
          setLeaveOpen(false)
          onLeave()
        }}
      />

      {/* Changer de file : l'AVERTISSEMENT vient AVANT tout choix, et la
          confirmation seulement après une sélection explicite (F1b §2). */}
      <Sheet
        open={changeOpen}
        onClose={() => {
          setChangeOpen(false)
          setPickedQueue(null)
        }}
        title={t('queue.track.changeSheet.title')}
      >
        <View style={styles.sheetBody}>
          <FuText variant="title">{t('queue.track.changeSheet.title')}</FuText>
          <FuText variant="sm" tone="secondary">
            {t('queue.track.changeSheet.warning')}
          </FuText>
          <QueueFileList
            queues={queues}
            excludeBarberId={entry?.barber_id ?? null}
            selectedBarberId={pickedQueue ? pickedQueue.barber_id : undefined}
            onPick={setPickedQueue}
          />
          {pickedQueue ? (
            <Button
              label={
                pickedQueue.barber_id === null
                  ? t('queue.track.changeSheet.confirmFirstAvailable')
                  : t('queue.track.changeSheet.confirm', { name: queueDisplayName(pickedQueue, t) })
              }
              size="lg"
              fullWidth
              loading={busy}
              onPress={() => {
                const target = pickedQueue.barber_id
                setChangeOpen(false)
                setPickedQueue(null)
                onChangeBarber(target)
              }}
            />
          ) : null}
        </View>
      </Sheet>
    </View>
  )
}

/**
 * LE chiffre. Mono tabulaire, énorme, vert clair du thème sombre — et il se
 * REJOUE à chaque changement de position (le client doit voir qu'il avance).
 * Sous réduction d'animations : un fondu court, aucune translation.
 */
function PositionNumber({ value, reduced }: { value: number | null; reduced: boolean }) {
  const opacity = useSharedValue(1)
  const translateY = useSharedValue(0)

  useEffect(() => {
    opacity.value = 0
    opacity.value = withTiming(1, { duration: reduced ? 90 : duration.state })
    if (!reduced) {
      translateY.value = 10
      translateY.value = withTiming(0, { duration: duration.state })
    } else {
      translateY.value = 0
    }
  }, [value, reduced, opacity, translateY])

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }))

  return (
    <Animated.View style={animated}>
      <MonoText size="display" weight="medium" style={styles.position}>
        {value ?? '—'}
      </MonoText>
    </Animated.View>
  )
}

/** Le panneau d'appel — vert plein, texte ENCRE, pleine largeur. */
function CalledPanel({
  reduced,
  organizationName,
  countdown,
  busy,
  onLeavePress,
}: {
  reduced: boolean
  organizationName: string
  countdown: ReturnType<typeof deriveCalledCountdown>
  busy: boolean
  onLeavePress: () => void
}) {
  const { t } = useTranslation('v2')
  const pulse = useSharedValue(1)

  useEffect(() => {
    if (reduced) return
    pulse.value = withRepeat(withTiming(1.012, { duration: 900 }), -1, true)
  }, [reduced, pulse])

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: reduced ? 1 : pulse.value }] }))

  return (
    <Animated.View
      style={[styles.calledPanel, animated]}
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
    >
      <FuText variant="heading" style={[styles.center, styles.ink]}>
        {t('queue.track.called.title')}
      </FuText>
      <FuText variant="body" style={[styles.center, styles.ink]}>
        {t('queue.track.called.description', { organization: organizationName })}
      </FuText>

      {countdown.kind === 'countdown' ? (
        <MonoText
          size="display"
          weight="medium"
          style={styles.countdown}
          accessibilityLabel={t('queue.track.deadlineCountdown', { time: countdown.label })}
        >
          {countdown.label}
        </MonoText>
      ) : null}
      {countdown.kind === 'passed' ? (
        <FuText variant="sm" style={[styles.center, styles.ink]}>
          {t('queue.track.deadlinePassed')}
        </FuText>
      ) : null}

      <MomentButton
        label={t('queue.track.leaveCta')}
        variant="onAccent"
        disabled={busy}
        onPress={onLeavePress}
      />
    </Animated.View>
  )
}

/**
 * Quitter est irréversible (retour en fin de file) : confirmation AVANT, avec
 * un texte différent quand le client a déjà été appelé. Registre secondaire —
 * jamais un vert plein : quitter n'est pas le CTA dominant de l'écran.
 */
function LeaveConfirmSheet({
  open,
  called,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  called: boolean
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation('v2')
  return (
    <Sheet open={open} onClose={onClose} title={t('queue.track.leaveConfirm.title')}>
      <View style={styles.sheetBody}>
        <FuText variant="title">{t('queue.track.leaveConfirm.title')}</FuText>
        <FuText variant="sm" tone="secondary">
          {called
            ? t('queue.track.leaveConfirm.calledDescription')
            : t('queue.track.leaveConfirm.description')}
        </FuText>
        <Button
          label={t('queue.track.leaveConfirm.confirm')}
          variant="secondary"
          size="lg"
          fullWidth
          loading={busy}
          onPress={onConfirm}
        />
        <Button
          label={t('queue.track.leaveConfirm.cancel')}
          variant="ghost"
          fullWidth
          onPress={onClose}
        />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    gap: spacing(3),
    paddingVertical: spacing(10),
    paddingHorizontal: spacing(4),
  },
  waiting: {
    alignItems: 'center',
    gap: spacing(2),
    paddingVertical: spacing(8),
    paddingHorizontal: spacing(4),
  },
  center: { textAlign: 'center' },
  ink: { color: color.moment.accentFg },
  darkSkeleton: { backgroundColor: color.moment.surface },
  position: {
    fontSize: fontSize.hero,
    lineHeight: 52,
    color: color.moment.accentText,
    textAlign: 'center',
  },
  movedNotice: {
    alignSelf: 'stretch',
    padding: spacing(3),
    borderRadius: radius.control,
    backgroundColor: color.moment.surface,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing(2),
    marginTop: spacing(3),
  },
  calledPanel: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing(3),
    marginTop: spacing(6),
    marginHorizontal: spacing(4),
    paddingVertical: spacing(10),
    paddingHorizontal: spacing(5),
    borderRadius: radius.card,
    backgroundColor: color.moment.accent,
  },
  countdown: {
    fontSize: fontSize.hero,
    lineHeight: 52,
    color: color.moment.accentFg,
    textAlign: 'center',
  },
  sheetBody: { gap: spacing(3), paddingBottom: spacing(2) },
})
