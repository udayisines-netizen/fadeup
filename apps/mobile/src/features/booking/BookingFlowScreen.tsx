import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'

import { useIsOnline } from '@/shared/hooks/useIsOnline'
import { useNow } from '@/shared/hooks/useNow'
import { useSession } from '@/shared/data/auth'
import { color, spacing, touchTarget } from '@/shared/theme/tokens'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { OfflineBlock } from '@/shared/ui/OfflineBanner'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import {
  BookingRefusedError,
  useAvailableSlotsPerBarber,
  useBookAppointment,
  useBookingServiceState,
  useEligibleBarbers,
  usePublicBarberServices,
  usePublicBookingCapability,
  usePublicLocations,
  usePublicOrganization,
  usePublicServices,
  type BookAppointmentResult,
} from '@/features/booking/api/booking'
import { bookingRefusalIsSlotRelated, bookingRefusalMessageKey, type BookingRefusalCode } from '@/features/booking/lib/refusals'
import {
  bookableDays,
  dateInTimezone,
  firstPopulatedPart,
  mergeSlotsAcrossBarbers,
  type PartOfDay,
} from '@/features/booking/lib/slots'
import { BookingRow, CardList } from '@/features/booking/components/BookingCard'
import { BookingOutcome } from '@/features/booking/components/BookingOutcome'
import { DayStrip } from '@/features/booking/components/DayStrip'
import { SummaryStep } from '@/features/booking/components/SummaryStep'
import { TimeSlotGrid } from '@/features/booking/components/TimeSlotGrid'

/**
 * LE tunnel natif (F4 §4) : Profil → Réserver → Service → Professionnel si
 * nécessaire → Date et heure → Récapitulatif → l'issue réelle.
 *
 * L'état vit dans les PARAMÈTRES DE LA ROUTE (`s`, `b`, `d`, `t`, `l`) —
 * même contrat que le web : l'étape est DÉRIVÉE de ces paramètres, le
 * contexte d'entrée est préservé et jamais redemandé (depuis un profil
 * barber, `b` arrive prérempli et l'étape professionnel n'existe pas). C'est
 * aussi ce qui fait que l'inscription légère du récapitulatif ne perd rien :
 * la session arrive, la route n'a pas bougé.
 *
 * Lois tenues ici :
 * - la porte du tunnel est le MODE (`mode_allows_booking`), opposable aux
 *   demandes comme aux réservations ; la capacité ne décide que
 *   confirmé vs en attente ;
 * - aucun créneau inventé : `get_public_available_slots` répond jour par
 *   jour, et un jour vide est un état vide honnête ;
 * - AUCUN optimisme : rien ne s'affiche comme acquis tant que la base n'a
 *   pas répondu, et un conflit est arbitré serveur (23P01) ;
 * - chaque motif de refus a son message, lu sur le CODE — et un conflit de
 *   créneau se dit SUR l'étape créneau, là où le client atterrit.
 */

function normalize(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return raw !== undefined && raw !== '' ? raw : null
}

export function BookingFlowScreen() {
  const { t } = useTranslation('v2')
  const router = useRouter()
  const params = useLocalSearchParams<{ slug?: string; s?: string; b?: string; d?: string; t?: string; l?: string }>()
  const { session } = useSession()
  const online = useIsOnline()
  const now = useNow(60_000)

  const slug = normalize(params.slug) ?? ''
  const serviceId = normalize(params.s)
  const barberParam = normalize(params.b) // uuid | 'any' | null
  const presetBarberId = barberParam !== null && barberParam !== 'any' ? barberParam : null

  const org = usePublicOrganization(slug || null)
  const locations = usePublicLocations(slug || null)
  const capability = usePublicBookingCapability(slug || null)

  const locationParam = normalize(params.l)
  const location = useMemo(() => {
    const rows = locations.data ?? []
    if (locationParam) return rows.find((row) => row.id === locationParam) ?? null
    return rows[0] ?? null
  }, [locations.data, locationParam])
  const locationId = location?.id ?? null
  const timezone = location?.timezone ?? null

  const serviceState = useBookingServiceState(slug || null, locationId, presetBarberId)

  // Services : depuis un profil barber, SA liste ; sinon celle du lieu.
  const barberServices = usePublicBarberServices(slug || null, presetBarberId)
  const locationServices = usePublicServices(slug || null, presetBarberId ? null : locationId)
  const services = presetBarberId ? barberServices : locationServices
  const selectedService = useMemo(
    () => (services.data ?? []).find((row) => row.id === serviceId) ?? null,
    [services.data, serviceId],
  )

  // Les professionnels APTES au service choisi — la seule liste honnête.
  const barbers = useEligibleBarbers(slug || null, locationId, serviceId)
  const barberChoice: 'any' | string | null = barberParam === 'any' ? 'any' : presetBarberId
  const chosenBarberName = useMemo(() => {
    if (barberChoice === 'any' || barberChoice === null) return null
    return (barbers.data ?? []).find((row) => row.barber_id === barberChoice)?.display_name ?? null
  }, [barbers.data, barberChoice])

  // Jour et créneaux.
  const day = normalize(params.d) ?? (timezone ? dateInTimezone(now, timezone) : null)
  const days = useMemo(() => (timezone ? bookableDays(timezone, now) : []), [timezone, now])
  const slotBarberIds = useMemo(() => {
    if (barberChoice && barberChoice !== 'any') return [barberChoice]
    return (barbers.data ?? []).map((row) => row.barber_id)
  }, [barberChoice, barbers.data])
  const slotQueries = useAvailableSlotsPerBarber(slug || null, locationId, slotBarberIds, serviceId, barberChoice ? day : null)
  /* Écart au web, assumé : sur « premier disponible », la liste des
     professionnels aptes est encore en vol au premier rendu — sans cette
     garde, l'écran afficherait « aucun créneau » alors qu'il n'a encore
     posé AUCUNE question à la base. Un état vide doit être un fait. */
  const slotsLoading =
    (barberChoice === 'any' && barbers.isLoading) || slotQueries.some((query) => query.isLoading)
  /* Une lecture en échec n'est pas un jour sans créneau — l'écran le dira. */
  const slotsFailed = slotQueries.some((query) => query.isError)
  const mergedSlots = useMemo(
    () =>
      mergeSlotsAcrossBarbers(
        slotBarberIds.map((barberId, index) => ({ barberId, slots: slotQueries[index]?.data ?? [] })),
      ),
    [slotBarberIds, slotQueries],
  )

  const [part, setPart] = useState<PartOfDay | null>(null)
  const chosenSlotStart = normalize(params.t)
  const chosenSlot = useMemo(
    () => mergedSlots.find((slot) => slot.slot_start === chosenSlotStart) ?? null,
    [mergedSlots, chosenSlotStart],
  )

  const book = useBookAppointment()
  const [outcome, setOutcome] = useState<BookAppointmentResult | null>(null)
  const [refusal, setRefusal] = useState<BookingRefusalCode | null>(null)
  const [bookedBarberName, setBookedBarberName] = useState<string | null>(null)
  const scrollRef = useRef<ScrollView>(null)

  /** Un paramètre à `''` est absent — c'est la façon de « retirer » ici. */
  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(patch)) next[key] = value ?? ''
      router.setParams(next)
    },
    [router],
  )

  /* L'étape est DÉRIVÉE des paramètres — elle se calcule ici parce que le
     retour matériel et l'état hors connexion en dépendent. */
  const step: 'service' | 'barber' | 'slot' | 'summary' = !serviceId
    ? 'service'
    : !barberChoice
      ? 'barber'
      : !chosenSlot
        ? 'slot'
        : 'summary'

  const stepBack = useCallback(() => {
    if (step === 'summary' || step === 'slot') {
      if (chosenSlotStart) return patchParams({ t: null })
      if (!presetBarberId && barberChoice) return patchParams({ b: null, t: null })
      return patchParams({ s: null, b: presetBarberId, t: null })
    }
    if (step === 'barber') return patchParams({ s: null })
    if (router.canGoBack()) return router.back()
  }, [step, chosenSlotStart, presetBarberId, barberChoice, patchParams, router])

  /* Le profil est presque toujours l'écran D'EN DESSOUS (le tunnel s'ouvre
     depuis lui) : on y revient en dépilant, sans en empiler une copie. */
  const goToProfile = () => {
    if (router.canGoBack()) router.back()
    else router.replace(`/shop/${encodeURIComponent(slug)}` as never)
  }

  /* `setParams` ne crée AUCUNE entrée d'historique (contrairement au
     `setSearchParams` du web) : sans cela, le retour matériel Android
     quitterait le tunnel entier depuis l'étape créneau et jetterait
     service + professionnel + créneau. Il recule d'UNE étape. */
  useEffect(() => {
    if (step === 'service' || outcome !== null) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      stepBack()
      return true
    })
    return () => sub.remove()
  }, [step, outcome, stepBack])

  /* ---------------- issues terminales et chargements ---------------- */

  if (outcome && org.data && location && selectedService) {
    return (
      <BookingOutcome
        result={outcome}
        context={{
          organizationId: org.data.id,
          organizationName: org.data.name,
          organizationSlug: slug,
          serviceName: selectedService.name,
          barberName: bookedBarberName,
          priceCents: selectedService.price_cents,
          currency: org.data.currency,
          timezone: timezone ?? 'UTC',
        }}
      />
    )
  }

  /* Hors connexion, un écran de choix ne peut RIEN afficher d'à jour — on
     le dit. Le RÉCAPITULATIF fait exception, et c'est délibéré : le nom,
     l'e-mail et surtout le code à six chiffres déjà saisis vivent dans son
     état local ; les détruire pour une coupure de deux secondes ferait
     recommencer tout le parcours (et périmer le code reçu). Le bandeau
     global de la racine porte alors le message, et le serveur reste seul
     juge de l'envoi. */
  if (online === false && step !== 'summary') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <OfflineBlock />
        </View>
      </SafeAreaView>
    )
  }

  if (slug === '' || (org.isSuccess && !org.data)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <EmptyState
            title={t('booking.flow.notFoundTitle')}
            body={t('booking.flow.notFoundBody')}
            actionLabel={t('booking.flow.back')}
            onAction={() => {
              if (router.canGoBack()) router.back()
              else router.replace('/')
            }}
          />
        </View>
      </SafeAreaView>
    )
  }

  const stateRow = serviceState.data
  // La porte du tunnel est le MODE (opposable aux demandes comme aux
  // réservations) ; la capacité ne décide que confirmé vs en attente.
  const bookingOpen = serviceState.isSuccess && stateRow ? stateRow.mode_allows_booking : null

  if (serviceState.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <EmptyState
            title={t('booking.flow.unknownTitle')}
            body={t('booking.flow.unknownBody')}
            actionLabel={t('booking.flow.retry')}
            onAction={() => void serviceState.refetch()}
          />
        </View>
      </SafeAreaView>
    )
  }

  if (bookingOpen === false) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <EmptyState
            title={t('booking.flow.closedTitle')}
            body={t('booking.flow.closedBody')}
            actionLabel={t('booking.flow.closedProfile')}
            onAction={goToProfile}
          />
        </View>
      </SafeAreaView>
    )
  }

  const booting = org.isLoading || locations.isLoading || serviceState.isLoading || services.isLoading

  const submitBooking = async (input: { name: string; email: string | null; notes: string }) => {
    if (!locationId || !selectedService || !chosenSlot) return
    setRefusal(null)
    const barberId = chosenSlot.barber_id
    const barberName = (barbers.data ?? []).find((row) => row.barber_id === barberId)?.display_name ?? chosenBarberName
    try {
      const result = await book.mutateAsync({
        slug,
        locationId,
        barberId,
        serviceId: selectedService.id,
        startsAt: chosenSlot.slot_start,
        customerName: input.name,
        customerEmail: input.email ?? session?.user.email ?? undefined,
        notes: input.notes || undefined,
      })
      setBookedBarberName(barberName)
      setOutcome(result)
    } catch (error) {
      if (error instanceof BookingRefusedError) {
        setRefusal(error.code)
        if (bookingRefusalIsSlotRelated(error.code)) {
          // Le créneau n'est plus libre : retour à l'étape créneau, liste
          // re-lue — rien n'a été envoyé, et l'écran le dit LÀ. Le message
          // est en tête de la liste : on y remonte, sinon il s'affiche hors
          // champ et la grille semble s'être vidée toute seule.
          patchParams({ t: null })
          scrollRef.current?.scrollTo({ y: 0, animated: true })
          for (const query of slotQueries) void query.refetch()
        }
      } else {
        throw error
      }
    }
  }

  const stepLabel =
    step === 'service'
      ? t('booking.flow.stepService')
      : step === 'barber'
        ? t('booking.flow.stepBarber')
        : step === 'slot'
          ? t('booking.flow.stepSlot')
          : t('booking.flow.stepSummary')

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('booking.flow.back')}
          onPress={stepBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <FuText variant="title" numberOfLines={1}>
            {t('booking.flow.title')}
            {org.data ? ` ${t('booking.flow.at', { name: org.data.name })}` : ''}
          </FuText>
          <FuText variant="sm" tone="secondary">
            {stepLabel}
          </FuText>
        </View>
      </View>

      {/* Le clavier ne doit JAMAIS couvrir le CTA transactionnel : le
          récapitulatif porte trois champs et le geste de conversion. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Un refus se dit LÀ OÙ le client atterrit : un conflit de créneau
            le ramène à l'étape créneau et le message y reste lisible. */}
        {refusal && step !== 'summary' ? (
          <FuText variant="sm" accessibilityRole="alert">
            {t(bookingRefusalMessageKey(refusal))}
          </FuText>
        ) : null}

        {booting ? (
          <View style={styles.skeletons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Skeleton height={56} />
            <Skeleton height={56} />
            <Skeleton height={56} width="70%" />
          </View>
        ) : step === 'service' ? (
          (services.data ?? []).length === 0 ? (
            <EmptyState
              title={t('booking.flow.noServicesTitle')}
              body={t('booking.flow.noServicesBody')}
              actionLabel={t('booking.flow.closedProfile')}
              onAction={goToProfile}
            />
          ) : (
            <CardList>
              {(services.data ?? []).map((service) => (
                <BookingRow
                  key={service.id}
                  accessibilityLabel={t('booking.flow.serviceAria', { name: service.name })}
                  onPress={() => patchParams({ s: service.id })}
                  title={service.name}
                  subtitle={<Duration minutes={service.duration_minutes} />}
                  trailing={
                    service.price_cents !== null ? (
                      <Money cents={service.price_cents} currency={org.data?.currency ?? 'EUR'} />
                    ) : undefined
                  }
                  chevron
                />
              ))}
            </CardList>
          )
        ) : step === 'barber' ? (
          barbers.isLoading ? (
            <View style={styles.skeletons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Skeleton height={56} />
              <Skeleton height={56} />
            </View>
          ) : (barbers.data ?? []).length === 0 ? (
            <EmptyState
              title={t('booking.flow.noBarbersTitle')}
              body={t('booking.flow.noBarbersBody')}
              actionLabel={t('booking.flow.back')}
              onAction={() => patchParams({ s: null })}
            />
          ) : (
            <CardList>
              {[
                <BookingRow
                  key="any"
                  accessibilityLabel={t('booking.flow.anyBarber')}
                  onPress={() => patchParams({ b: 'any' })}
                  title={t('booking.flow.anyBarber')}
                  subtitle={t('booking.flow.anyBarberHint')}
                  chevron
                />,
                ...(barbers.data ?? []).map((barber) => (
                  <BookingRow
                    key={barber.barber_id}
                    accessibilityLabel={t('booking.flow.barberAria', { name: barber.display_name })}
                    onPress={() => patchParams({ b: barber.barber_id })}
                    title={barber.display_name}
                    subtitle={barber.title ?? undefined}
                    chevron
                  />
                )),
              ]}
            </CardList>
          )
        ) : step === 'slot' ? (
          <View style={styles.slotStep}>
            {timezone && day ? (
              <>
                <DayStrip days={days} value={day} onChange={(next) => patchParams({ d: next, t: null })} timeZone={timezone} />
                {slotsLoading ? (
                  <View style={styles.skeletons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Skeleton height={44} />
                    <Skeleton height={44} width="80%" />
                  </View>
                ) : slotsFailed ? (
                  /* « Aucun créneau » et « la lecture a échoué » ne sont
                     PAS la même phrase : une panne ne devient jamais une
                     absence de disponibilité (loi « aucune donnée
                     opérationnelle inventée »). */
                  <EmptyState
                    title={t('mobile.bookingx.loadFailedTitle')}
                    body={t('mobile.bookingx.loadFailedBody')}
                    actionLabel={t('common.action.retry')}
                    onAction={() => {
                      for (const query of slotQueries) void query.refetch()
                    }}
                  />
                ) : mergedSlots.length === 0 ? (
                  <View style={styles.emptyDay}>
                    <FuText variant="sm" tone="secondary" style={styles.center}>
                      {t('booking.slots.noneDay')}
                    </FuText>
                  </View>
                ) : (
                  <TimeSlotGrid
                    slots={mergedSlots}
                    value={chosenSlotStart}
                    onChange={(slotStart) => {
                      setRefusal(null)
                      patchParams({ t: slotStart })
                    }}
                    timeZone={timezone}
                    part={part ?? firstPopulatedPart(mergedSlots, timezone)}
                    onPartChange={setPart}
                  />
                )}
              </>
            ) : (
              <View style={styles.skeletons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Skeleton height={68} />
                <Skeleton height={44} />
              </View>
            )}
          </View>
        ) : org.data && location && selectedService && chosenSlot ? (
          <SummaryStep
            organizationName={org.data.name}
            currency={org.data.currency}
            serviceName={selectedService.name}
            durationMinutes={selectedService.duration_minutes}
            priceCents={selectedService.price_cents}
            barberName={(barbers.data ?? []).find((row) => row.barber_id === chosenSlot.barber_id)?.display_name ?? null}
            barberWasChosen={barberChoice !== 'any'}
            startsAt={chosenSlot.slot_start}
            timezone={timezone ?? 'UTC'}
            acceptsImmediateBooking={capability.data ?? null}
            busy={book.isPending}
            refusal={refusal}
            onEdit={(what) => {
              if (what === 'service') patchParams({ s: null, b: presetBarberId, t: null })
              else if (what === 'barber') patchParams({ b: null, t: null })
              else patchParams({ t: null })
            }}
            onSubmit={submitBooking}
          />
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  fill: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  back: {
    width: touchTarget,
    height: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: touchTarget / 2,
  },
  headerText: { flex: 1 },
  content: { padding: spacing(4), paddingTop: spacing(1), paddingBottom: spacing(10), gap: spacing(4) },
  skeletons: { gap: spacing(3) },
  slotStep: { gap: spacing(4) },
  emptyDay: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    borderRadius: 16,
    paddingVertical: spacing(8),
  },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.6 },
})

/** Le bouton « Réserver » des profils mène ici — jamais à un cul-de-sac. */
export default BookingFlowScreen
