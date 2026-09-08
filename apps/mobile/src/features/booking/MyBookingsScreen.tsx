import { useEffect, useMemo, useState } from 'react'
import { InteractionManager, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { useSession } from '@/shared/data/auth'
import { useIsOnline } from '@/shared/hooks/useIsOnline'
import { useNow } from '@/shared/hooks/useNow'
import { formatDateTime } from '@/shared/lib/format'
import { isExpired, remainingParts } from '@/shared/lib/deadline'
import { color, spacing } from '@/shared/theme/tokens'
import { AuthSheet } from '@/shared/ui/AuthSheet'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { OfflineBlock } from '@/shared/ui/OfflineBanner'
import { Sheet } from '@/shared/ui/Sheet'
import { Skeleton } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import {
  useAcceptCounterProposal,
  useDeclineCounterProposal,
  useMyAppointments,
  useMyInterestRequests,
  useMyQueueStatus,
  type MyAppointment,
} from '@/features/booking/api/booking'
import { partitionAppointments, resolutionLabelKey } from '@/features/booking/lib/partition'
import { countdownText } from '@/features/booking/lib/requestCopy'
import { AlternativesSheet } from '@/features/booking/components/AlternativesSheet'
import { BookingDetailSheet } from '@/features/booking/components/BookingDetailSheet'
import { BookingRow, CardList } from '@/features/booking/components/BookingCard'
import { CounterProposalCard } from '@/features/booking/components/CounterProposalCard'

/**
 * L'onglet Réservations (F4 §7, P1PRO §5). Les sections, DANS CET ORDRE —
 * l'ordre est la hiérarchie : ce qui attend MA réponse d'abord, ce qui est
 * fini en dernier.
 *
 *   1. contre-propositions (le salon propose un autre horaire) ;
 *   2. demandes en attente, avec l'échéance qui défile par ligne ;
 *   3. file active (position réelle, lien vers le suivi) ;
 *   4. à venir ;
 *   5. demandes d'intérêt (profils non revendiqués) ;
 *   6. historique, libellé par `resolution`.
 *
 * Une demande expirée n'est NI un no-show NI un refus : « La demande n'a pas
 * été confirmée à temps », puis les alternatives. « Réserver à nouveau »
 * renvoie dans le tunnel avec lieu, professionnel et service préremplis.
 *
 * L'écran exige une session — mais JAMAIS une navigation vers un écran de
 * connexion : la feuille d'auth se pose par-dessus et l'écran se remplit sur
 * place (M1b).
 */
export function MyBookingsScreen() {
  const { t, i18n } = useTranslation('v2')
  const router = useRouter()
  const { session, ready } = useSession()
  const online = useIsOnline()
  const now = useNow(30_000)

  const signedIn = Boolean(session)
  const appointments = useMyAppointments(signedIn)
  const queue = useMyQueueStatus(signedIn)
  const interests = useMyInterestRequests(signedIn)

  const [authOpen, setAuthOpen] = useState(false)
  const [detail, setDetail] = useState<MyAppointment | null>(null)
  const [alternativesFor, setAlternativesFor] = useState<MyAppointment | null>(null)
  const [pendingAlternatives, setPendingAlternatives] = useState<MyAppointment | null>(null)
  const [decliningCounter, setDecliningCounter] = useState<MyAppointment | null>(null)

  const partitioned = useMemo(() => partitionAppointments(appointments.data ?? [], now), [appointments.data, now])

  const acceptCounter = useAcceptCounterProposal()
  const declineCounter = useDeclineCounterProposal()

  /* Fermer une feuille et en ouvrir une autre DANS LE MÊME rendu est le
     mode d'échec classique d'iOS : la seconde peut ne jamais apparaître.
     Le détail se ferme d'abord ; les alternatives s'ouvrent une fois
     l'interaction terminée — sur le chemin même de la demande expirée. */
  useEffect(() => {
    if (pendingAlternatives === null || detail !== null) return
    const task = InteractionManager.runAfterInteractions(() => {
      setAlternativesFor(pendingAlternatives)
      setPendingAlternatives(null)
    })
    return () => task.cancel()
  }, [pendingAlternatives, detail])

  /* Pas de session : on le dit, on propose, et la feuille fait le reste. */
  if (ready && !signedIn) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <EmptyState
            title={t('booking.bookings.loginTitle')}
            body={t('booking.bookings.loginBody')}
            actionLabel={t('booking.bookings.loginAction')}
            onAction={() => setAuthOpen(true)}
          />
        </View>
        <AuthSheet open={authOpen} context="bookings" onClose={() => setAuthOpen(false)} />
      </SafeAreaView>
    )
  }

  if (online === false) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <OfflineBlock />
        </View>
      </SafeAreaView>
    )
  }

  const loading = !ready || appointments.isLoading
  const queueRows = queue.data ?? []
  const interestRows = interests.data ?? []
  const nothing =
    !loading &&
    partitioned.counters.length === 0 &&
    partitioned.requests.length === 0 &&
    partitioned.upcoming.length === 0 &&
    partitioned.history.length === 0 &&
    queueRows.length === 0 &&
    interestRows.length === 0

  const rebook = (row: MyAppointment) => {
    router.push(
      `/book/${encodeURIComponent(row.organization_slug)}?l=${encodeURIComponent(row.location_id)}&b=${encodeURIComponent(row.barber_id)}&s=${encodeURIComponent(row.service_id)}` as never,
    )
  }

  /** L'échéance d'une ligne : le décompte, ou la phrase de l'expiration. */
  const requestCountdown = (row: MyAppointment): string | null => {
    if (!row.expires_at) return null
    if (isExpired(row.expires_at, now)) return t('booking.bookings.resolutionExpired')
    return countdownText(t, remainingParts(row.expires_at, now))
  }

  const when = (iso: string, timezone: string, style: 'datetime' | 'date') =>
    formatDateTime(iso, timezone, style, i18n.language)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={appointments.isRefetching || queue.isRefetching || interests.isRefetching}
            onRefresh={() => {
              void appointments.refetch()
              void queue.refetch()
              void interests.refetch()
            }}
            tintColor={color.accentText}
          />
        }
      >
        <FuText variant="heading">{t('booking.bookings.title')}</FuText>

        {loading ? (
          <View style={styles.skeletons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} width="70%" />
          </View>
        ) : appointments.isError ? (
          /* « Vous n'avez rien » et « la lecture a échoué » ne sont pas la
             même phrase : un client qui a un rendez-vous demain ne doit
             JAMAIS lire un état vide parce qu'une RPC est tombée. */
          <EmptyState
            title={t('mobile.bookingx.loadFailedTitle')}
            body={t('mobile.bookingx.loadFailedBody')}
            actionLabel={t('common.action.retry')}
            onAction={() => void appointments.refetch()}
          />
        ) : nothing ? (
          <EmptyState
            title={t('booking.bookings.emptyTitle')}
            body={t('booking.bookings.emptyBody')}
            actionLabel={t('booking.bookings.emptyAction')}
            onAction={() => router.push('/search')}
          />
        ) : (
          <>
            {/* 1. Ce qui attend MA réponse. */}
            {partitioned.counters.length > 0 ? (
              <View style={styles.section}>
                <FuText variant="title">{t('booking.counter.sectionTitle')}</FuText>
                {partitioned.counters.map((row) => (
                  <CounterProposalCard
                    key={row.id}
                    row={row}
                    now={now}
                    accepting={acceptCounter.isPending && acceptCounter.variables === row.id}
                    acceptFailed={acceptCounter.isError && acceptCounter.variables === row.id}
                    declineDisabled={acceptCounter.isPending}
                    onAccept={() => acceptCounter.mutate(row.id)}
                    onDecline={() => setDecliningCounter(row)}
                  />
                ))}
              </View>
            ) : null}

            {/* 2. Les demandes en attente du salon. */}
            {partitioned.requests.length > 0 ? (
              <View style={styles.section}>
                <FuText variant="title">{t('booking.bookings.sectionRequests')}</FuText>
                <CardList>
                  {partitioned.requests.map((row) => {
                    const expired = row.expires_at !== null && isExpired(row.expires_at, now)
                    const countdown = requestCountdown(row)
                    return (
                      <BookingRow
                        key={row.id}
                        onPress={() => setDetail(row)}
                        accessibilityLabel={row.organization_name}
                        title={row.organization_name}
                        subtitle={`${row.service_name} · ${when(row.starts_at, row.location_timezone, 'datetime')}`}
                        // L'échéance a SA ligne : un sous-titre tronque.
                        footer={
                          countdown ? (
                            <MonoText size="sm" tone="secondary" style={styles.countdown}>
                              {countdown}
                            </MonoText>
                          ) : undefined
                        }
                        trailing={expired ? undefined : <StateBadge state="pending-request" />}
                        chevron
                      />
                    )
                  })}
                </CardList>
              </View>
            ) : null}

            {/* 3. La file active — position RÉELLE, jamais estimée ici. */}
            {queueRows.length > 0 ? (
              <View style={styles.section}>
                <FuText variant="title">{t('booking.bookings.sectionQueue')}</FuText>
                <CardList>
                  {queueRows.map((entry) => (
                    <BookingRow
                      key={entry.id}
                      accessibilityLabel={t('booking.bookings.queueRowAria', { name: entry.organization_name })}
                      onPress={() =>
                        router.push(
                          `/q/${encodeURIComponent(entry.organization_slug)}?l=${encodeURIComponent(entry.location_id)}` as never,
                        )
                      }
                      title={entry.organization_name}
                      subtitle={
                        entry.queue_position !== null
                          ? t('booking.bookings.queuePosition', { position: entry.queue_position })
                          : entry.location_name
                      }
                      trailing={
                        <FuText variant="sm" tone="accent">
                          {t('booking.bookings.viewQueue')}
                        </FuText>
                      }
                      chevron
                    />
                  ))}
                </CardList>
              </View>
            ) : null}

            {/* 4. À venir. */}
            {partitioned.upcoming.length > 0 ? (
              <View style={styles.section}>
                <FuText variant="title">{t('booking.bookings.sectionUpcoming')}</FuText>
                <CardList>
                  {partitioned.upcoming.map((row) => (
                    <BookingRow
                      key={row.id}
                      onPress={() => setDetail(row)}
                      accessibilityLabel={row.organization_name}
                      title={row.organization_name}
                      subtitle={`${row.service_name} · ${when(row.starts_at, row.location_timezone, 'datetime')}`}
                      trailing={
                        row.price_cents !== null ? <Money cents={row.price_cents} currency={row.currency} /> : undefined
                      }
                      chevron
                    />
                  ))}
                </CardList>
              </View>
            ) : null}

            {/* 5. Demandes d'intérêt — aucun créneau n'a jamais été retenu. */}
            {interestRows.length > 0 ? (
              <View style={styles.section}>
                <FuText variant="title">{t('booking.bookings.sectionInterest')}</FuText>
                <CardList>
                  {interestRows.map((row) => (
                    <BookingRow
                      key={row.id}
                      title={row.professional_display_name}
                      subtitle={
                        row.status === 'pending'
                          ? t('booking.bookings.interestPending', {
                              date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                                new Date(row.expires_at),
                              ),
                            })
                          : row.status === 'expired'
                            ? t('booking.bookings.interestExpired')
                            : t('booking.bookings.interestWithdrawn')
                      }
                      trailing={row.status === 'pending' ? <StateBadge state="pending-request" /> : undefined}
                    />
                  ))}
                </CardList>
              </View>
            ) : null}

            {/* 6. L'historique — ce qui s'est passé, dit par `resolution`. */}
            {partitioned.history.length > 0 ? (
              <View style={styles.section}>
                <FuText variant="title">{t('booking.bookings.sectionHistory')}</FuText>
                <CardList>
                  {partitioned.history.map((row) => {
                    const labelKey = resolutionLabelKey(row)
                    return (
                      <BookingRow
                        key={row.id}
                        title={row.organization_name}
                        subtitle={`${row.service_name} · ${when(row.starts_at, row.location_timezone, 'date')}${
                          labelKey ? ` · ${t(labelKey)}` : ''
                        }`}
                        footer={
                          <View style={styles.historyActions}>
                            {row.status === 'pending' && row.resolution === 'expired' ? (
                              <Button
                                label={t('booking.request.findAlternative')}
                                variant="ghost"
                                onPress={() => setAlternativesFor(row)}
                              />
                            ) : null}
                            <Button
                              label={t('booking.bookings.rebook')}
                              accessibilityLabel={t('booking.bookings.rebookAria', { service: row.service_name })}
                              variant="secondary"
                              onPress={() => rebook(row)}
                            />
                          </View>
                        }
                      />
                    )
                  })}
                </CardList>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {detail ? (
        <BookingDetailSheet
          appointment={detail}
          open
          onClose={() => setDetail(null)}
          onFindAlternative={() => {
            setPendingAlternatives(detail)
            setDetail(null)
          }}
        />
      ) : null}

      {/* Refuser une contre-proposition CLÔT la demande : dit AVANT le
          geste, jamais découvert après (P1PRO §5). */}
      {decliningCounter ? (
        <Sheet open onClose={() => setDecliningCounter(null)} title={t('booking.counter.declineTitle')}>
          <View style={styles.declineBody}>
            <FuText variant="title">{t('booking.counter.declineTitle')}</FuText>
            <FuText variant="sm" tone="secondary">
              {t('booking.counter.declineBody', { name: decliningCounter.organization_name })}
            </FuText>
            <Button
              label={t('booking.counter.declineConfirm')}
              size="lg"
              fullWidth
              loading={declineCounter.isPending}
              onPress={() => {
                declineCounter.mutate(decliningCounter.id, { onSettled: () => setDecliningCounter(null) })
              }}
            />
            <Button
              label={t('common.action.cancel')}
              variant="ghost"
              fullWidth
              disabled={declineCounter.isPending}
              onPress={() => setDecliningCounter(null)}
            />
          </View>
        </Sheet>
      ) : null}

      <AlternativesSheet
        open={alternativesFor !== null}
        onClose={() => setAlternativesFor(null)}
        excludeOrganizationId={alternativesFor?.organization_id ?? null}
        serviceQuery={alternativesFor?.service_name ?? null}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  centered: { flex: 1, justifyContent: 'center' },
  content: { padding: spacing(4), paddingBottom: spacing(10), gap: spacing(5) },
  section: { gap: spacing(2) },
  skeletons: { gap: spacing(3) },
  countdown: { marginTop: 2 },
  historyActions: {
    flexDirection: 'row',
    gap: spacing(2),
    marginTop: spacing(2),
    flexWrap: 'wrap',
  },
  declineBody: { gap: spacing(3), paddingBottom: spacing(2) },
})

export default MyBookingsScreen
