import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import {
  QueueJoinRefusedError,
  useChangeQueueBarber,
  useLeaveQueue,
  useMyQueueStatus,
  usePublicOrganizationName,
  usePublicQueueServiceState,
  usePublicQueues,
  usePublicQueueStatus,
  useQueueEntryTracking,
  useQueuePublicLocations,
  type JoinQueueResult,
  type PublicQueueFile,
} from '@/features/queue/api/publicQueue'
import { refusalMessageKey } from '@/features/queue/lib/refusals'
import { NotificationPermissionSheet } from '@/features/notifications/NotificationPermissionSheet'
import { decidePermissionMoment } from '@/features/notifications/lib/permissionMoment'
import { usePushDevice } from '@/features/notifications/usePushDevice'
import { JoinQueueSheet } from '@/features/queue/components/JoinQueueSheet'
import { QueueFileList } from '@/features/queue/components/QueueFileList'
import { QueueSummary, type PublicQueueState } from '@/features/queue/components/QueueSummary'
import { QueueTracking } from '@/features/queue/components/QueueTracking'
import { useSession } from '@/shared/data/auth'
import { useIsOnline } from '@/shared/hooks/useIsOnline'
import {
  clearLocalQueueEntry,
  readLocalQueueEntry,
  saveLocalQueueEntry,
  type LocalQueueEntry,
} from '@/shared/lib/localQueueEntry'
import { color, radius, shadow, spacing, touchTarget } from '@/shared/theme/tokens'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { OfflineBlock } from '@/shared/ui/OfflineBanner'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'

/**
 * /q/[slug] — l'écran que le client ouvre depuis son canapé OU en scannant le
 * QR du salon. Transposition native de apps/web PublicQueuePage.tsx (F1 +
 * F1b), lois produit inchangées :
 *
 *  - CONSULTER est libre : ni session, ni géolocalisation, ni jeton. La RPC
 *    publique répond en anonyme, et c'est tout ce qu'il faut ;
 *  - REJOINDRE exige le QR (jeton) et la position, demandés au geste — le
 *    serveur tranche seul (géofence mesurée en base) ;
 *  - SUIVRE sa place bascule l'écran en fond SOMBRE (thème `moment`) : c'est
 *    le seul moment de l'app cliente qui le fait ;
 *  - hors connexion, rien de périmé n'est montré : ni file, ni position.
 *
 * Le suivi est retrouvé par la trace locale (anonyme) ou par
 * `get_my_queue_status` (client connecté depuis un autre appareil).
 */
export function PublicQueueScreen() {
  const params = useLocalSearchParams<{ slug: string; l?: string; t?: string }>()
  const slug = typeof params.slug === 'string' ? params.slug : ''
  const urlLocationId = typeof params.l === 'string' ? params.l : null
  const urlToken = typeof params.t === 'string' ? params.t : null

  const { t } = useTranslation('v2')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { session } = useSession()
  const online = useIsOnline()

  const organization = usePublicOrganizationName(slug)
  const locations = useQueuePublicLocations(slug)

  /* Résolution du lieu : paramètre du QR, sinon choix du client, sinon lieu
     unique. Un salon multi-lieux ouvert sans paramètre demande d'abord où. */
  const [pickedLocationId, setPickedLocationId] = useState<string | null>(null)
  const resolvedLocation = useMemo(() => {
    const rows = locations.data ?? []
    const wanted = urlLocationId ?? pickedLocationId
    if (wanted) return rows.find((row) => row.id === wanted) ?? null
    if (rows.length === 1) return rows[0] ?? null
    return null
  }, [locations.data, urlLocationId, pickedLocationId])

  const locationId = resolvedLocation?.id ?? null
  const isServiceArea = resolvedLocation?.kind === 'service_area'

  const [joinOpen, setJoinOpen] = useState(false)
  const [joinTarget, setJoinTarget] = useState<PublicQueueFile | null>(null)
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null)

  /* M1c-a — la permission de notifier se demande ICI et nulle part ailleurs :
     juste après avoir rejoint une file, quand « on te prévient quand c'est ton
     tour » décrit un bénéfice que le client vient de demander. Sur iOS un refus
     est définitif — poser la question à l'ouverture, c'est perdre le canal. */
  const push = usePushDevice()
  const [pushSheetOpen, setPushSheetOpen] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushEntryId, setPushEntryId] = useState<string | null>(null)
  const [pushHintKey, setPushHintKey] = useState<string | null>(null)

  /* La trace locale d'une entrée — AsyncStorage, donc asynchrone : tant
     qu'elle n'a pas répondu, on n'affirme rien (ni suivi, ni son absence). */
  const [localEntry, setLocalEntry] = useState<LocalQueueEntry | null>(null)
  const [localEntryRead, setLocalEntryRead] = useState(false)
  useEffect(() => {
    let alive = true
    void readLocalQueueEntry().then((entry) => {
      if (!alive) return
      setLocalEntry(entry)
      setLocalEntryRead(true)
    })
    return () => {
      alive = false
    }
  }, [])

  // Une entrée locale d'un AUTRE salon ne concerne pas cet écran.
  const relevantLocal =
    localEntry && localEntry.slug === slug && localEntry.locationId === locationId ? localEntry : null

  const serviceState = usePublicQueueServiceState(slug, isServiceArea ? null : locationId)
  const queues = usePublicQueues(slug, isServiceArea ? null : locationId, {
    pollInBackground: Boolean(relevantLocal),
  })
  // Le tableau public reste la source du compte global (résumé solo).
  const queueStatus = usePublicQueueStatus(slug, isServiceArea ? null : locationId, {})
  const myQueue = useMyQueueStatus(Boolean(session))

  /* L'identifiant de MA place : trace locale d'abord (elle survit à la
     déconnexion), sinon la file active du compte sur ce lieu. */
  const trackedEntryId =
    relevantLocal?.entryId ??
    (session ? ((myQueue.data ?? []).find((entry) => entry.location_id === locationId)?.id ?? null) : null)

  const tracking = useQueueEntryTracking(trackedEntryId)
  const leave = useLeaveQueue()
  const change = useChangeQueueBarber()

  /* « Disparue » = le serveur ne connaît plus cette entrée (entry_not_found),
     ou elle appartient à un autre compte (session changée sur l'appareil). */
  const trackedGone = Boolean(
    trackedEntryId && tracking.isError && tracking.error instanceof QueueJoinRefusedError,
  )

  const handleJoined = useCallback(
    (entry: JoinQueueResult, authenticated: boolean) => {
      if (!locationId) return
      const record: LocalQueueEntry = { entryId: entry.id, slug, locationId, joinedAt: entry.created_at }
      // Même connecté, on garde la trace locale : le suivi survit à une
      // déconnexion et la RPC de suivi répond sans session.
      void saveLocalQueueEntry(record)
      setLocalEntry(record)
      setActionErrorKey(null)
      if (authenticated) void myQueue.refetch()

      /* Le moment de la permission. `decidePermissionMoment` tranche sur ce
         que le SYSTÈME répond et sur ce qu'on a déjà demandé — jamais deux
         fois, jamais après un refus. Si la permission existe déjà, on
         rattache silencieusement l'appareil à CETTE place : c'est ce qui rend
         « c'est votre tour » possible pour un client anonyme. */
      setPushEntryId(entry.id)
      const decision = decidePermissionMoment({
        system: push.status ?? 'undetermined',
        alreadyAsked: push.alreadyAsked ?? false,
        justJoinedQueue: true,
      })
      if (decision.ask) {
        setPushSheetOpen(true)
      } else if (decision.reason === 'already_granted') {
        void push.ensureRegistered(entry.id)
      }
    },
    [locationId, slug, myQueue, push],
  )

  const dismissTracking = useCallback(() => {
    void clearLocalQueueEntry()
    setLocalEntry(null)
    setActionErrorKey(null)
  }, [])

  const surfaceQueueError = useCallback((error: unknown) => {
    setActionErrorKey(
      error instanceof QueueJoinRefusedError ? refusalMessageKey(error.code) : 'errors.data.unknown',
    )
  }, [])

  const handleLeave = useCallback(() => {
    if (!trackedEntryId) return
    setActionErrorKey(null)
    leave.mutate(trackedEntryId, { onError: surfaceQueueError })
  }, [trackedEntryId, leave, surfaceQueueError])

  const handleChangeBarber = useCallback(
    (toBarberId: string | null) => {
      if (!trackedEntryId || !locationId) return
      setActionErrorKey(null)
      change.mutate(
        { entryId: trackedEntryId, toBarberId },
        {
          onSuccess: (row) => {
            // L'entrée a été RÉINSÉRÉE : nouvel identifiant, nouvelle trace.
            const record: LocalQueueEntry = {
              entryId: row.id,
              slug,
              locationId,
              joinedAt: row.created_at,
            }
            void saveLocalQueueEntry(record)
            setLocalEntry(record)
          },
          onError: surfaceQueueError,
        },
      )
    },
    [trackedEntryId, locationId, change, slug, surfaceQueueError],
  )

  const queueFiles = queues.data ?? []
  // Un salon à UN barber garde l'expérience F1 : un résumé, un geste.
  const barberFiles = queueFiles.filter((file) => file.barber_id !== null)
  const multiBarber = barberFiles.length > 1
  const firstAvailable = queueFiles.find((file) => file.barber_id === null) ?? null

  const waitingCount = (queueStatus.data ?? []).filter((entry) => entry.status === 'waiting').length
  const state = serviceState.data
  const queueState: PublicQueueState = serviceState.isError
    ? 'unknown'
    : state
      ? state.queue_accepting_new_entries
        ? 'open'
        : 'closed'
      : 'unknown'

  const isTracking = Boolean((trackedEntryId && !tracking.isError) || trackedGone)
  const offline = online === false
  const canJoin = queueState === 'open' && !isTracking && !isServiceArea && !offline && Boolean(locationId)

  /* D1 §9 — le SUIVI est un moment SOMBRE. La consultation reste claire, et
     une place « disparue » ou une coupure réseau aussi : le fond sombre
     appartient à la position VIVANTE, jamais à un écran qui n'a rien à
     montrer. */
  const dark = isTracking && !trackedGone && !offline

  const openJoin = useCallback((target: PublicQueueFile | null) => {
    setJoinTarget(target)
    setJoinOpen(true)
  }, [])

  const locationRows = locations.data ?? []
  const notFound = organization.isSuccess && !organization.data

  const body = (() => {
    if (notFound) {
      return (
        <EmptyState
          title={t('queue.public.notFound.title')}
          body={t('queue.public.notFound.description')}
          actionLabel={t('common.action.back')}
          onAction={() => router.back()}
        />
      )
    }

    /* Hors connexion : un état honnête, jamais de vieux chiffres. */
    if (offline) {
      return <OfflineBlock body={isTracking ? t('mobile.offline.queueBlockedBody') : undefined} />
    }

    if (isTracking) {
      if (trackedGone) {
        return (
          <EmptyState
            title={t('queue.track.gone.title')}
            body={t('queue.track.gone.description')}
            actionLabel={t('queue.track.gone.action')}
            onAction={dismissTracking}
          />
        )
      }
      return (
        <QueueTracking
          entry={tracking.data ?? null}
          organizationName={organization.data?.name ?? ''}
          queues={queueFiles}
          busy={leave.isPending || change.isPending}
          onLeave={handleLeave}
          onChangeBarber={handleChangeBarber}
          onDismiss={dismissTracking}
        />
      )
    }

    if (locations.isPending || !localEntryRead) {
      return (
        <View style={styles.loading} accessibilityElementsHidden>
          <Skeleton width={120} height={56} />
          <Skeleton width={180} height={16} />
        </View>
      )
    }

    /* Salon multi-lieux ouvert sans paramètre : choisir le lieu d'abord. */
    if (!resolvedLocation && locationRows.length > 1) {
      return (
        <View style={styles.locationPicker}>
          <FuText variant="sm" tone="secondary">
            {t('queue.public.pickLocation')}
          </FuText>
          {locationRows.map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={row.name}
              onPress={() => setPickedLocationId(row.id)}
              style={styles.locationRow}
            >
              <View style={styles.locationLabels}>
                <FuText variant="bodyMedium">{row.name}</FuText>
                {row.city ? (
                  <FuText variant="sm" tone="secondary">
                    {row.city}
                  </FuText>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={color.textTertiary} />
            </Pressable>
          ))}
        </View>
      )
    }

    /* Zone de service : pas de salle d'attente — l'état RÉEL, avec une sortie. */
    if (isServiceArea) {
      return (
        <EmptyState
          title={t('queue.public.serviceArea.title')}
          body={t('queue.public.serviceArea.description')}
          actionLabel={t('queue.public.serviceArea.action')}
          onAction={() => router.push(`/shop/${encodeURIComponent(slug)}` as never)}
        />
      )
    }

    if (!resolvedLocation) {
      return (
        <EmptyState
          title={t('queue.public.error.title')}
          body={t('queue.public.error.description')}
          actionLabel={t('common.action.retry')}
          onAction={() => void locations.refetch()}
        />
      )
    }

    if (queueStatus.isPending || serviceState.isPending || queues.isPending) {
      return (
        <View style={styles.loading} accessibilityElementsHidden>
          <Skeleton width={120} height={56} />
          <Skeleton width={180} height={16} />
        </View>
      )
    }

    if (queueStatus.isError) {
      return (
        <EmptyState
          title={t('queue.public.error.title')}
          body={t('queue.public.error.description')}
          actionLabel={t('common.action.retry')}
          onAction={() => void queueStatus.refetch()}
        />
      )
    }

    return (
      <View>
        {multiBarber ? (
          /* F1b : les files du salon — « premier disponible » en tête, puis
             les barbers dans l'ordre du serveur. Toucher une file ouvre le
             geste « rejoindre » sur CETTE file. */
          <View accessibilityLabel={t('queue.public.queuesLabel')}>
            <QueueSummary
              waitingCount={waitingCount}
              queueState={queueState}
              estimatedWaitMinutes={null}
            />
            <QueueFileList queues={queueFiles} onPick={canJoin ? openJoin : undefined} />
          </View>
        ) : (
          <QueueSummary
            waitingCount={waitingCount}
            queueState={queueState}
            /* Salon solo : l'estimation de la file « premier disponible »
               vient de l'estimateur F1b — null tant qu'elle n'est pas fiable,
               et alors RIEN n'est affiché. */
            estimatedWaitMinutes={firstAvailable?.estimated_wait_minutes ?? null}
          />
        )}

        {queueState === 'closed' ? (
          <FuText variant="sm" tone="secondary" style={styles.center}>
            {t('queue.public.closedHint')}
          </FuText>
        ) : null}

        <FuText variant="sm" tone="tertiary" style={[styles.center, styles.consultNote]}>
          {t('mobile.queuex.consultFromAnywhere')}
        </FuText>
      </View>
    )
  })()

  return (
    <View style={[styles.root, { backgroundColor: dark ? color.moment.canvas : color.canvas }]}>
      {/* L'écran sombre exige une barre d'état claire. */}
      {dark ? <StatusBar style="light" /> : null}
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackButton onPress={() => router.back()} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <FuText
              variant="heading"
              style={dark ? { color: color.moment.textPrimary } : undefined}
              numberOfLines={2}
            >
              {organization.data?.name ?? (organization.isPending ? '…' : slug)}
            </FuText>
            {resolvedLocation && locationRows.length > 1 ? (
              <View style={styles.locationLine}>
                <Ionicons
                  name="location-outline"
                  size={14}
                  color={dark ? color.moment.textSecondary : color.textSecondary}
                />
                <FuText
                  variant="sm"
                  tone="secondary"
                  style={dark ? { color: color.moment.textSecondary } : undefined}
                >
                  {resolvedLocation.name}
                </FuText>
              </View>
            ) : null}
            {!isTracking ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('queue.public.viewProfile')}
                onPress={() => router.push(`/shop/${encodeURIComponent(slug)}` as never)}
                style={styles.profileLink}
              >
                <Ionicons name="storefront-outline" size={16} color={color.accentText} />
                <FuText variant="smMedium" tone="accent">
                  {t('queue.public.viewProfile')}
                </FuText>
              </Pressable>
            ) : null}
          </View>

          {pushHintKey ? (
            <View
              style={[styles.actionError, dark && styles.actionErrorDark]}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <FuText variant="sm" style={dark ? { color: color.moment.textPrimary } : undefined}>
                {t(pushHintKey)}
              </FuText>
            </View>
          ) : null}

          {actionErrorKey ? (
            <View
              style={[styles.actionError, dark && styles.actionErrorDark]}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <FuText variant="sm" style={dark ? { color: color.moment.textPrimary } : undefined}>
                {t(actionErrorKey)}
              </FuText>
            </View>
          ) : null}

          {body}
        </ScrollView>
      </SafeAreaView>

      {/* Le CTA collant rejoint « premier disponible » : beaucoup de clients
          veulent juste être servis. Le choix d'un barber reste possible dans
          la liste des files. */}
      {canJoin ? (
        <View style={[styles.sticky, shadow.sticky, { paddingBottom: insets.bottom + spacing(3) }]}>
          <Button
            label={t('queue.public.joinCta')}
            size="lg"
            fullWidth
            onPress={() => openJoin(firstAvailable)}
          />
        </View>
      ) : null}

      {/* M1c-a — le moment de la permission, jamais à l'ouverture. */}
      <NotificationPermissionSheet
        open={pushSheetOpen}
        busy={pushBusy}
        onClose={() => setPushSheetOpen(false)}
        onAccept={() => {
          setPushBusy(true)
          void push.requestAndRegister(pushEntryId).then((attempt) => {
            setPushBusy(false)
            setPushSheetOpen(false)
            /* Honnêteté : on ne dit quelque chose QUE si le client peut agir
               (refus système, réseau). Une indisponibilité technique — Expo Go,
               projet Expo non configuré — est notre problème, pas le sien, et
               l'écran de suivi garde son comportement de M1b. */
            if (!attempt.registered && attempt.reason === 'permission_denied') {
              setPushHintKey('mobile.push.deniedHint')
            } else if (!attempt.registered && attempt.reason === 'network') {
              setPushHintKey('mobile.push.networkHint')
            }
          })
        }}
      />

      {locationId ? (
        <JoinQueueSheet
          open={joinOpen}
          onClose={() => {
            setJoinOpen(false)
            setJoinTarget(null)
          }}
          slug={slug}
          locationId={locationId}
          initialToken={urlToken}
          targetQueue={joinTarget}
          queues={queueFiles}
          onJoined={handleJoined}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: { paddingTop: spacing(14), paddingBottom: spacing(24) },
  header: { paddingHorizontal: spacing(4), gap: spacing(1) },
  locationLine: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  profileLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    minHeight: touchTarget,
    alignSelf: 'flex-start',
  },
  loading: { alignItems: 'center', gap: spacing(3), paddingVertical: spacing(10) },
  locationPicker: { paddingHorizontal: spacing(4), paddingTop: spacing(4), gap: spacing(1) },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    minHeight: touchTarget + 12,
    paddingHorizontal: spacing(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  locationLabels: { flex: 1, gap: 2 },
  center: { textAlign: 'center' },
  consultNote: { paddingHorizontal: spacing(6), marginTop: spacing(2) },
  actionError: {
    marginHorizontal: spacing(4),
    marginTop: spacing(3),
    padding: spacing(3),
    borderRadius: radius.control,
    backgroundColor: color.surfaceSubtle,
  },
  actionErrorDark: { backgroundColor: color.moment.surface },
  sticky: {
    position: 'absolute',
    bottom: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    backgroundColor: color.surface,
    paddingHorizontal: spacing(4),
    paddingTop: spacing(3),
  },
})
