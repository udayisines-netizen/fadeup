import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNow } from '@/shared/hooks/useNow'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { IconBack } from '@/shared/ui/icons'
import {
  useBookAppointment,
  useBookingServiceState,
  useEligibleBarbers,
  usePublicBarberServices,
  usePublicBookingCapability,
  usePublicLocations,
  usePublicOrganization,
  usePublicServices,
  BookingRefusedError,
  type BookAppointmentResult,
} from '@/features/booking/api/booking'
import { bookableDays, dateInTimezone, firstPopulatedPart, mergeSlotsAcrossBarbers, type PartOfDay } from '@/features/booking/lib/slots'
import { useAvailableSlotsPerBarber } from '@/features/booking/api/booking'
import { bookingRefusalIsSlotRelated, bookingRefusalMessageKey, type BookingRefusalCode } from '@/features/booking/lib/refusals'
import { DayStrip } from '@/features/booking/components/DayStrip'
import { TimeSlotGrid } from '@/features/booking/components/TimeSlotGrid'
import { BookingOutcome } from '@/features/booking/components/BookingOutcome'
import { SummaryStep } from '@/features/booking/components/SummaryStep'

/**
 * LE tunnel (F4 §4) : Profil → Réserver → Service → Barber si nécessaire →
 * Date et heure → Confirmé. Une seule route, l'état dans l'URL (`s`, `b`,
 * `d`, `t`) — le contexte d'entrée est préservé, jamais redemandé
 * (BOOKING_UX) : depuis un profil barber, `b` arrive prérempli et l'étape
 * barber n'existe pas.
 *
 * Lois tenues ici :
 * - aucun créneau inventé : `get_public_available_slots` répond, jour par
 *   jour, et un jour vide est un état vide honnête ;
 * - AUCUN optimisme : rien ne s'affiche comme acquis tant que la base n'a
 *   pas répondu, et un conflit est arbitré serveur (23P01 → message clair) ;
 * - chaque motif de refus a son message, lu sur le CODE ;
 * - pas de réservation anonyme : l'inscription légère (OTP) vit DANS le
 *   récapitulatif, sans quitter le tunnel (motif F1b) ;
 * - le récapitulatif annonce l'issue : « Confirmer la réservation » quand la
 *   capacité existe, « Envoyer la demande » sinon — et la vérité finale est
 *   `is_request`, lue de la réponse.
 */
export function BookingFlowPage() {
  const { t } = useTranslation('v2')
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { session } = useSession()
  const now = useNow(60_000)

  const serviceId = searchParams.get('s')
  const barberParam = searchParams.get('b') // uuid | 'any' | null
  const presetBarberId = barberParam && barberParam !== 'any' && barberParam !== '' ? barberParam : null

  const org = usePublicOrganization(slug)
  const locations = usePublicLocations(slug)
  const capability = usePublicBookingCapability(slug)

  const locationParam = searchParams.get('l')
  const location = useMemo(() => {
    const rows = locations.data ?? []
    if (locationParam) return rows.find((row) => row.id === locationParam) ?? null
    return rows[0] ?? null
  }, [locations.data, locationParam])
  const locationId = location?.id ?? null
  const timezone = location?.timezone ?? null

  const serviceState = useBookingServiceState(slug, locationId, presetBarberId)

  // Services : depuis un profil barber, SA liste ; sinon celle du lieu.
  const barberServices = usePublicBarberServices(slug, presetBarberId)
  const locationServices = usePublicServices(slug, presetBarberId ? null : locationId)
  const services = presetBarberId ? barberServices : locationServices
  const selectedService = useMemo(
    () => (services.data ?? []).find((row) => row.id === serviceId) ?? null,
    [services.data, serviceId],
  )

  // Les barbers APTES au service choisi — sert aussi à nommer le préréglé.
  const barbers = useEligibleBarbers(slug, locationId, serviceId)
  const barberChoice: 'any' | string | null = barberParam === 'any' ? 'any' : presetBarberId
  const chosenBarberName = useMemo(() => {
    if (barberChoice === 'any' || barberChoice === null) return null
    return (barbers.data ?? []).find((row) => row.barber_id === barberChoice)?.display_name ?? null
  }, [barbers.data, barberChoice])

  // Jour et créneaux.
  const day = searchParams.get('d') ?? (timezone ? dateInTimezone(now, timezone) : null)
  const days = useMemo(() => (timezone ? bookableDays(timezone, now) : []), [timezone, now])
  const slotBarberIds = useMemo(() => {
    if (barberChoice && barberChoice !== 'any') return [barberChoice]
    return (barbers.data ?? []).map((row) => row.barber_id)
  }, [barberChoice, barbers.data])
  const slotQueries = useAvailableSlotsPerBarber(slug, locationId, slotBarberIds, serviceId, barberChoice ? day : null)
  const slotsLoading = slotQueries.some((query) => query.isLoading)
  const mergedSlots = useMemo(
    () =>
      mergeSlotsAcrossBarbers(
        slotBarberIds.map((barberId, index) => ({ barberId, slots: slotQueries[index]?.data ?? [] })),
      ),
    [slotBarberIds, slotQueries],
  )

  const [part, setPart] = useState<PartOfDay | null>(null)
  const chosenSlotStart = searchParams.get('t')
  const chosenSlot = useMemo(
    () => mergedSlots.find((slot) => slot.slot_start === chosenSlotStart) ?? null,
    [mergedSlots, chosenSlotStart],
  )

  const book = useBookAppointment()
  const [outcome, setOutcome] = useState<BookAppointmentResult | null>(null)
  const [refusal, setRefusal] = useState<BookingRefusalCode | null>(null)
  const [bookedBarberName, setBookedBarberName] = useState<string | null>(null)

  const patchParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next, { replace: false })
  }

  /* ---------------- issues terminales et chargements ---------------- */

  if (org.isSuccess && !org.data) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <EmptyState
          title={t('booking.flow.notFoundTitle')}
          description={t('booking.flow.notFoundBody')}
          action={
            <Button variant="secondary" onClick={() => void navigate(-1)}>
              {t('booking.flow.back')}
            </Button>
          }
        />
      </main>
    )
  }

  if (outcome && org.data && location && selectedService) {
    return (
      <main>
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
      </main>
    )
  }

  const stateRow = serviceState.data
  const stateKnown = serviceState.isSuccess && stateRow
  // La porte du tunnel est le MODE (opposable aux demandes comme aux
  // réservations — B2 §2) ; la capacité ne décide que confirmed vs pending.
  const bookingOpen = stateKnown ? stateRow.mode_allows_booking : null

  if (serviceState.isError) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <EmptyState
          title={t('booking.flow.unknownTitle')}
          description={t('booking.flow.unknownBody')}
          action={
            <Button variant="secondary" onClick={() => void serviceState.refetch()}>
              {t('booking.flow.retry')}
            </Button>
          }
        />
      </main>
    )
  }

  if (bookingOpen === false) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <EmptyState
          title={t('booking.flow.closedTitle')}
          description={t('booking.flow.closedBody')}
          action={
            <Button variant="secondary" onClick={() => void navigate(`/shop/${encodeURIComponent(slug)}`)}>
              {t('booking.flow.closedProfile')}
            </Button>
          }
        />
      </main>
    )
  }

  const booting = org.isLoading || locations.isLoading || serviceState.isLoading || services.isLoading
  const step: 'service' | 'barber' | 'slot' | 'summary' = !serviceId
    ? 'service'
    : !barberChoice
      ? 'barber'
      : !chosenSlot
        ? 'slot'
        : 'summary'

  const stepBack = () => {
    if (step === 'summary' || step === 'slot') {
      if (chosenSlotStart) return patchParams({ t: null })
      if (!presetBarberId && barberChoice) return patchParams({ b: null, t: null })
      return patchParams({ s: null, b: presetBarberId ?? null, t: null })
    }
    if (step === 'barber') return patchParams({ s: null })
    return void navigate(-1)
  }

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
          // re-lue — rien n'a été envoyé, et l'écran le dit.
          patchParams({ t: null })
          for (const query of slotQueries) void query.refetch()
        }
      } else {
        throw error
      }
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pb-28 pt-5 md:pb-10" data-testid="booking-flow">
      <header className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t('booking.flow.back')}
          onClick={stepBack}
          className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--fu-text-primary)] hover:bg-[var(--fu-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
        >
          <IconBack aria-hidden="true" className="size-5 rtl:-scale-x-100" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-fu-xl font-semibold text-[var(--fu-text-primary)]">
            {t('booking.flow.title')}
            {org.data ? ` ${t('booking.flow.at', { name: org.data.name })}` : ''}
          </h1>
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">
            {step === 'service'
              ? t('booking.flow.stepService')
              : step === 'barber'
                ? t('booking.flow.stepBarber')
                : step === 'slot'
                  ? t('booking.flow.stepSlot')
                  : t('booking.flow.stepSummary')}
          </p>
        </div>
      </header>

      {refusal && !bookingRefusalIsSlotRelated(refusal) && step !== 'summary' && (
        <p role="alert" className="text-fu-sm text-[var(--fu-text-primary)]">
          {t(bookingRefusalMessageKey(refusal))}
        </p>
      )}

      {booting ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <SkeletonRect className="h-12 w-full" />
          <SkeletonRect className="h-12 w-full" />
          <SkeletonRect className="h-12 w-3/4" />
        </div>
      ) : step === 'service' ? (
        (services.data ?? []).length === 0 ? (
          <EmptyState
            title={t('booking.flow.noServicesTitle')}
            description={t('booking.flow.noServicesBody')}
            action={
              <Button variant="secondary" onClick={() => void navigate(`/shop/${encodeURIComponent(slug)}`)}>
                {t('booking.flow.closedProfile')}
              </Button>
            }
          />
        ) : (
          <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0" data-testid="service-step">
            {(services.data ?? []).map((service) => (
              <Row
                key={service.id}
                as="button"
                aria-label={t('booking.flow.serviceAria', { name: service.name })}
                onClick={() => patchParams({ s: service.id })}
                title={service.name}
                subtitle={<Duration minutes={service.duration_minutes} />}
                trailing={service.price_cents !== null ? <Money cents={service.price_cents} currency={org.data?.currency ?? 'EUR'} /> : undefined}
                chevron
              />
            ))}
          </div>
        )
      ) : step === 'barber' ? (
        barbers.isLoading ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <SkeletonRect className="h-12 w-full" />
            <SkeletonRect className="h-12 w-full" />
          </div>
        ) : (barbers.data ?? []).length === 0 ? (
          <EmptyState
            title={t('booking.flow.noBarbersTitle')}
            description={t('booking.flow.noBarbersBody')}
            action={
              <Button variant="secondary" onClick={() => patchParams({ s: null })}>
                {t('booking.flow.back')}
              </Button>
            }
          />
        ) : (
          <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0" data-testid="barber-step">
            <Row
              as="button"
              aria-label={t('booking.flow.anyBarber')}
              onClick={() => patchParams({ b: 'any' })}
              title={t('booking.flow.anyBarber')}
              subtitle={t('booking.flow.anyBarberHint')}
              chevron
            />
            {(barbers.data ?? []).map((barber) => (
              <Row
                key={barber.barber_id}
                as="button"
                aria-label={t('booking.flow.barberAria', { name: barber.display_name })}
                onClick={() => patchParams({ b: barber.barber_id })}
                title={barber.display_name}
                subtitle={barber.title ?? undefined}
                chevron
              />
            ))}
          </div>
        )
      ) : step === 'slot' ? (
        <div className="flex flex-col gap-4" data-testid="slot-step">
          {timezone && day && (
            <>
              <DayStrip days={days} value={day} onChange={(next) => patchParams({ d: next, t: null })} timeZone={timezone} />
              {slotsLoading ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-hidden="true">
                  <SkeletonRect className="h-11" />
                  <SkeletonRect className="h-11" />
                  <SkeletonRect className="h-11" />
                  <SkeletonRect className="h-11" />
                </div>
              ) : mergedSlots.length === 0 ? (
                <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--fu-border)] px-4 py-8 text-center text-fu-sm text-[var(--fu-text-secondary)]">
                  {t('booking.slots.noneDay')}
                </p>
              ) : (
                <TimeSlotGrid
                  slots={mergedSlots}
                  value={chosenSlotStart}
                  onChange={(slotStart) => patchParams({ t: slotStart })}
                  timeZone={timezone}
                  part={part ?? firstPopulatedPart(mergedSlots, timezone)}
                  onPartChange={setPart}
                />
              )}
            </>
          )}
        </div>
      ) : (
        org.data &&
        location &&
        selectedService &&
        chosenSlot && (
          <SummaryStep
            organizationName={org.data.name}
            currency={org.data.currency}
            serviceName={selectedService.name}
            durationMinutes={selectedService.duration_minutes}
            priceCents={selectedService.price_cents}
            barberName={
              (barbers.data ?? []).find((row) => row.barber_id === chosenSlot.barber_id)?.display_name ?? null
            }
            barberWasChosen={barberChoice !== 'any'}
            startsAt={chosenSlot.slot_start}
            timezone={timezone ?? 'UTC'}
            acceptsImmediateBooking={capability.data ?? null}
            busy={book.isPending}
            refusal={refusal}
            onEdit={(what) => {
              if (what === 'service') patchParams({ s: null, b: presetBarberId ?? null, t: null })
              else if (what === 'barber') patchParams({ b: null, t: null })
              else patchParams({ t: null })
            }}
            onSubmit={submitBooking}
          />
        )
      )}
    </main>
  )
}

export default BookingFlowPage
