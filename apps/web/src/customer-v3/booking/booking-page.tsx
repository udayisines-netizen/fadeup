/**
 * FadeUp V3 — booking: one page that transforms, never a wizard that
 * navigates.
 *
 * The decision machine is carried over intact from the audited R5R flow —
 * it encodes product law, not styling:
 *
 *  - Step order Service → Barber → Time → Details, because
 *    `get_public_available_slots` REQUIRES `p_barber_id`; Fresha's
 *    Service → Time → Staff needs an aggregation contract that does not
 *    exist and is never faked.
 *  - `?location&barber&service` arrive in the URL and are never re-asked;
 *    the barber step auto-answers itself when the roster has one member.
 *  - Availability landing: with no chosen date the flow walks forward to
 *    the first day that actually has free times.
 *  - Slot-conflict recovery: a failed booking refreshes availability, drops
 *    the stale slot and lands back on the time step with the message.
 *  - A signed-in customer never retypes what FadeUp knows; an anonymous
 *    booking's claim token goes into the existing pending-claim store.
 *  - Multi-location deep links without ?location= get an explicit branch
 *    choice, never a silent first location.
 *
 * What V3 changes is the grammar: decided steps collapse into green context
 * CHIPS (tap to change), the date rail and day-part slot groups render in
 * the V3 system, and confirmation is the Apple-calm scene.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/lib/auth-context'
import { useAnalytics, useTrackView } from '@/lib/analytics'
import { useMyCustomerProfile, storePendingClaimToken } from '@/lib/queries/customer-profile'
import { MY_APPOINTMENTS_KEY } from '@/lib/queries/customer-app'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMoney } from '@/lib/intl/use-intl'
import { downloadIcs } from '@/lib/calendar/ics'
import {
  useBookPublicAppointment,
  usePublicAvailableSlots,
  usePublicBarbers,
  usePublicLocations,
  usePublicOrganization,
  usePublicServices,
  type BookedAppointment,
  type PublicService,
} from '@/lib/queries/public-booking'
import { V3_ROUTES } from '@/customer-v3/routes'

type Step = 'service' | 'barber' | 'time' | 'details'

const INITIAL_SLOTS_SHOWN = 6
const DAYS_SHOWN = 14

/** The next N dates as the SHOP sees them — `p_date` is shop-local. */
function shopDates(timezone: string, language: string) {
  const formatKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const formatLabel = new Intl.DateTimeFormat(language, {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const formatWeekday = new Intl.DateTimeFormat(language, { timeZone: timezone, weekday: 'short' })
  const formatDay = new Intl.DateTimeFormat(language, { timeZone: timezone, day: 'numeric' })
  const dates: Array<{ key: string; label: string; weekday: string; day: string }> = []
  const seen = new Set<string>()
  for (let i = 0; i < DAYS_SHOWN; i += 1) {
    const instant = new Date(Date.now() + i * 86_400_000)
    const key = formatKey.format(instant)
    if (seen.has(key)) continue
    seen.add(key)
    dates.push({
      key,
      label: formatLabel.format(instant),
      weekday: formatWeekday.format(instant),
      day: formatDay.format(instant),
    })
  }
  return dates
}

export function CustomerV3BookingPage() {
  const { t, i18n } = useTranslation('v3')
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const money = useMoney()

  const organization = usePublicOrganization(slug)
  const locations = usePublicLocations(slug)

  const requestedLocation = searchParams.get('location')
  const requestedBarber = searchParams.get('barber')
  const requestedService = searchParams.get('service')

  const [locationChoice, setLocationChoice] = useState<string | null>(null)

  const location = useMemo(() => {
    const all = locations.data ?? []
    const explicit = all.find((l) => l.id === (requestedLocation ?? locationChoice))
    if (explicit) return explicit
    return all.length === 1 ? all[0] : null
  }, [locations.data, requestedLocation, locationChoice])

  const services = usePublicServices(slug, location?.id)

  const [serviceId, setServiceId] = useState<string | null>(requestedService)
  const [barberId, setBarberId] = useState<string | null>(requestedBarber)
  const [date, setDate] = useState<string | null>(null)
  const [slot, setSlot] = useState<{ start: string; end: string } | null>(null)
  const [allSlotsShown, setAllSlotsShown] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [booked, setBooked] = useState<BookedAppointment | null>(null)
  const [bookFailed, setBookFailed] = useState(false)
  const [autoDate, setAutoDate] = useState<string | null>(null)

  const service: PublicService | null =
    (services.data ?? []).find((entry) => entry.id === serviceId) ?? null

  const barbers = usePublicBarbers(slug, location?.id, serviceId ?? undefined)

  const roster = barbers.data ?? []
  const effectiveBarberId =
    barberId ?? (serviceId && !barbers.isPending && roster.length === 1 ? roster[0].barberId : null)
  const barber = roster.find((entry) => entry.barberId === effectiveBarberId) ?? null

  const days = useMemo(
    () => (location ? shopDates(location.timezone, i18n.language) : []),
    [location, i18n.language],
  )
  const activeDate = date ?? autoDate ?? days[0]?.key ?? null

  const slots = usePublicAvailableSlots(
    slug,
    location?.id,
    effectiveBarberId ?? undefined,
    serviceId ?? undefined,
    activeDate ?? undefined,
  )

  const book = useBookPublicAppointment()
  const queryClient = useQueryClient()
  const analytics = useAnalytics()
  const myProfile = useMyCustomerProfile(user?.id)

  /* A retired/foreign ?service= id falls back to the service step. */
  useEffect(() => {
    if (!serviceId || !services.data) return
    if (!services.data.some((entry) => entry.id === serviceId)) setServiceId(null)
  }, [serviceId, services.data])

  /* A signed-in customer never retypes what FadeUp already knows. */
  useEffect(() => {
    if (!myProfile.data) return
    const known = myProfile.data
    setName((current) => current || (known.displayName ?? ''))
    setEmail((current) => current || (known.email ?? user?.email ?? ''))
  }, [myProfile.data, user?.email])

  /* Availability landing: walk to the first day with free times. */
  useEffect(() => {
    if (date) return
    if (!serviceId || !effectiveBarberId || slot) return
    if (slots.isPending || slots.isError) return
    if ((slots.data ?? []).length > 0) return
    const index = days.findIndex((day) => day.key === activeDate)
    if (index >= 0 && index < days.length - 1) setAutoDate(days[index + 1].key)
  }, [date, serviceId, effectiveBarberId, slot, slots.isPending, slots.isError, slots.data, days, activeDate])

  useTrackView(
    'booking_started',
    { properties: {}, context: { organizationId: organization.data?.id } },
    Boolean(organization.data?.id),
  )

  useDocumentMeta({
    title: t('booking.metaTitle'),
    description: t('booking.metaDescription'),
    noIndex: true,
  })

  const timeFormat = useMemo(
    () =>
      location
        ? new Intl.DateTimeFormat(i18n.language, {
            timeZone: location.timezone,
            hour: '2-digit',
            minute: '2-digit',
          })
        : null,
    [location, i18n.language],
  )

  const step: Step = !serviceId ? 'service' : !effectiveBarberId ? 'barber' : !slot ? 'time' : 'details'

  if (organization.isError || locations.isError) {
    return (
      <p className="v3a-error" role="alert">
        {t('app.errors.load')}
      </p>
    )
  }

  if (organization.data === null) {
    return (
      <div className="v3a-empty">
        <p className="v3a-empty-title">{t('profile.shop.notFoundTitle')}</p>
        <p className="v3-meta">{t('profile.shop.notFoundBody')}</p>
      </div>
    )
  }

  /* Multi-location deep link without ?location= — explicit branch choice. */
  if (organization.data && !location && (locations.data ?? []).length > 1) {
    return (
      <div className="v3b-page">
        <header className="v3a-page-head">
          <h1 className="v3-h1">{t('booking.title', { name: organization.data.name })}</h1>
        </header>
        <div className="v3b-panel">
          <h2 className="v3b-step-title">{t('booking.chooseLocation')}</h2>
          {(locations.data ?? []).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="v3b-option v3-press"
              onClick={() => setLocationChoice(entry.id)}
            >
              <span className="v3b-option-info">
                <span className="v3b-option-name">
                  <bdi>{entry.name}</bdi>
                </span>
                {(entry.addressLine1 ?? entry.city) ? (
                  <span className="v3b-option-meta">
                    <bdi>{[entry.addressLine1, entry.city].filter(Boolean).join(' · ')}</bdi>
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (!organization.data || !location) {
    return <div style={{ minBlockSize: '16rem' }} aria-hidden="true" />
  }

  const shop = organization.data
  const placeName = location.name !== shop.name ? location.name : shop.name
  const address = [location.addressLine1, location.city].filter(Boolean).join(' · ')

  /* ────────────────────────────── CONFIRMED ─────────────────────────────── */

  if (booked && service && timeFormat) {
    const dayFormat = new Intl.DateTimeFormat(i18n.language, {
      timeZone: location.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })

    return (
      <div className="v3b-confirmed v3-enter">
        <span className="v3b-check" aria-hidden="true">
          <CheckGlyph />
        </span>
        <h1 className="v3b-confirmed-title">{t('booking.bookedTitle')}</h1>
        <p className="v3b-confirmed-when v3-num">
          {dayFormat.format(new Date(booked.startsAt))} · {timeFormat.format(new Date(booked.startsAt))}
        </p>
        <p className="v3b-confirmed-meta">
          {barber ? <bdi>{barber.displayName}</bdi> : null}
          {barber ? ' · ' : ''}
          <bdi>{placeName}</bdi>
        </p>
        <p className="v3b-confirmed-meta">
          {service.name} · {money(service.priceCents, shop.currency)}
        </p>
        {address ? (
          <p className="v3b-confirmed-meta">
            <bdi>{address}</bdi>
          </p>
        ) : null}

        <div className="v3b-confirmed-actions">
          <button
            type="button"
            className="v3-btn v3-btn--quiet v3-press"
            onClick={() =>
              downloadIcs({
                title: `${service.name} · ${placeName}`,
                description: [barber?.displayName, service.name].filter(Boolean).join(' · '),
                location: address || placeName,
                startsAt: booked.startsAt,
                endsAt: booked.endsAt,
                uid: booked.id,
              })
            }
          >
            {t('booking.addToCalendar')}
          </button>
          {user ? (
            <Link to={V3_ROUTES.appointments} className="v3-btn v3-btn--quiet v3-press">
              {t('booking.viewBooking')}
            </Link>
          ) : null}
          <Link to={V3_ROUTES.home} className="v3-btn v3-btn--primary-ink v3-press">
            {t('booking.done')}
          </Link>
        </div>

        {!user && booked.claimToken ? <p className="v3-meta">{t('booking.claimHint')}</p> : null}
      </div>
    )
  }

  /* ─────────────────────────────── THE FLOW ─────────────────────────────── */

  const contextChip = (label: string, onChange: (() => void) | null) => (
    <button type="button" className="v3b-chip v3-press" disabled={!onChange} onClick={onChange ?? undefined}>
      <bdi>{label}</bdi>
      {onChange ? <PencilGlyph /> : null}
    </button>
  )

  const visibleSlots = allSlotsShown ? (slots.data ?? []) : (slots.data ?? []).slice(0, INITIAL_SLOTS_SHOWN)

  const showServiceChip = Boolean(service) && step !== 'service'
  const showBarberChip =
    Boolean(barber) && (step === 'time' || step === 'details') && !requestedBarber
  const showTimeChip = Boolean(slot) && step === 'details'

  return (
    <div className="v3b-page">
      <header className="v3a-page-head">
        <h1 className="v3-h1">{t('booking.title', { name: placeName })}</h1>
        {address ? (
          <p className="v3-meta">
            <bdi>{address}</bdi>
          </p>
        ) : null}
      </header>

      {/* Decided steps as compact context chips, in decision order. */}
      {showServiceChip || showBarberChip || showTimeChip ? (
        <div className="v3b-context">
          {showServiceChip && service
            ? contextChip(`${service.name} · ${money(service.priceCents, shop.currency, { trimWholeAmounts: true })}`, () => {
                setServiceId(null)
                setBarberId(requestedBarber)
                setSlot(null)
                setAllSlotsShown(false)
                setAutoDate(null)
                setBookFailed(false)
              })
            : null}
          {showBarberChip && barber
            ? contextChip(
                barber.displayName,
                roster.length > 1
                  ? () => {
                      setBarberId(null)
                      setSlot(null)
                      setAutoDate(null)
                    }
                  : null,
              )
            : null}
          {showTimeChip && slot && timeFormat
            ? contextChip(
                `${days.find((d) => d.key === activeDate)?.label ?? ''} · ${timeFormat.format(new Date(slot.start))}`,
                () => setSlot(null),
              )
            : null}
        </div>
      ) : null}

      <div className="v3b-panel">
        {step === 'service' ? (
          <div>
            <h2 className="v3b-step-title">{t('booking.chooseService')}</h2>
            {services.data && services.data.length > 0 ? (
              services.data.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="v3b-option v3-press"
                  onClick={() => {
                    analytics.track('booking_service_selected', {
                      properties: { service_id: entry.id },
                      context: { organizationId: shop.id, locationId: location.id },
                    })
                    setServiceId(entry.id)
                  }}
                >
                  <span className="v3b-option-info">
                    <span className="v3b-option-name">{entry.name}</span>
                    <span className="v3b-option-meta">
                      {t('profile.minutes', { count: entry.durationMinutes })}
                    </span>
                  </span>
                  <span className="v3b-option-price v3-num">{money(entry.priceCents, shop.currency)}</span>
                </button>
              ))
            ) : services.isPending ? (
              <div style={{ padding: '1rem 1.125rem' }} aria-hidden="true">
                <div className="v3-skeleton" style={{ blockSize: '2.5rem' }} />
              </div>
            ) : (
              <p className="v3-meta" style={{ padding: '1rem 1.125rem' }}>
                {t('profile.shop.noServices')}
              </p>
            )}
          </div>
        ) : null}

        {step === 'barber' ? (
          <div>
            <h2 className="v3b-step-title">{t('booking.chooseBarber')}</h2>
            {roster.length > 0 ? (
              roster.map((entry) => (
                <button
                  key={entry.barberId}
                  type="button"
                  className="v3b-option v3-press"
                  onClick={() => {
                    analytics.track('booking_barber_selected', {
                      properties: { any_available: false },
                      context: { organizationId: shop.id, locationId: location.id, barberId: entry.barberId },
                    })
                    setBarberId(entry.barberId)
                  }}
                >
                  <span className="v3b-option-info">
                    <span className="v3b-option-name">
                      <bdi>{entry.displayName}</bdi>
                    </span>
                    {entry.title ? <span className="v3b-option-meta">{entry.title}</span> : null}
                  </span>
                </button>
              ))
            ) : barbers.isPending ? (
              <div style={{ padding: '1rem 1.125rem' }} aria-hidden="true">
                <div className="v3-skeleton" style={{ blockSize: '2.5rem' }} />
              </div>
            ) : (
              <p className="v3-meta" style={{ padding: '1rem 1.125rem' }}>
                {t('booking.noBarbersForService')}
              </p>
            )}
          </div>
        ) : null}

        {step === 'time' ? (
          <div>
            <h2 className="v3b-step-title">{t('booking.chooseTime')}</h2>

            {bookFailed ? (
              <p role="alert" className="v3a-error" style={{ margin: '0 1.125rem 0.75rem' }}>
                {t('booking.failed')}
              </p>
            ) : null}

            <div className="v3b-days">
              {days.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  className="v3b-day v3-press"
                  aria-pressed={day.key === activeDate}
                  aria-label={day.label}
                  onClick={() => {
                    setDate(day.key)
                    setAllSlotsShown(false)
                  }}
                >
                  <span aria-hidden="true">{day.weekday}</span>
                  <span aria-hidden="true">{day.day}</span>
                </button>
              ))}
            </div>

            {slots.isPending ? (
              <div className="v3b-slot-region" aria-hidden="true">
                <div className="v3-skeleton" style={{ blockSize: '2.75rem' }} />
              </div>
            ) : visibleSlots.length > 0 && timeFormat ? (
              <div className="v3b-slot-region">
                {autoDate && !date ? (
                  <p className="v3-meta" style={{ paddingBlockEnd: '0.5rem' }}>
                    {t('booking.firstFreeDay', {
                      day: days.find((entry) => entry.key === activeDate)?.label ?? '',
                    })}
                  </p>
                ) : null}
                {(() => {
                  const hourFormat = new Intl.DateTimeFormat('en-GB', {
                    timeZone: location.timezone,
                    hour: 'numeric',
                    hour12: false,
                  })
                  const hourOf = (iso: string) => Number(hourFormat.format(new Date(iso)))
                  const groups = [
                    { id: 'morning', label: t('booking.morning'), slots: visibleSlots.filter((s) => hourOf(s.slotStart) < 12) },
                    {
                      id: 'afternoon',
                      label: t('booking.afternoon'),
                      slots: visibleSlots.filter((s) => {
                        const hour = hourOf(s.slotStart)
                        return hour >= 12 && hour < 17
                      }),
                    },
                    { id: 'evening', label: t('booking.evening'), slots: visibleSlots.filter((s) => hourOf(s.slotStart) >= 17) },
                  ].filter((group) => group.slots.length > 0)

                  return groups.map((group) => (
                    <div key={group.id}>
                      <p className="v3b-slot-label">{group.label}</p>
                      <div className="v3b-slots">
                        {group.slots.map((entry) => (
                          <button
                            key={entry.slotStart}
                            type="button"
                            className="v3b-slot v3-press"
                            onClick={() => {
                              analytics.track('booking_slot_selected', {
                                properties: {
                                  lead_time_minutes: Math.max(
                                    0,
                                    Math.round((new Date(entry.slotStart).getTime() - Date.now()) / 60_000),
                                  ),
                                },
                                context: { organizationId: shop.id, locationId: location.id },
                              })
                              setBookFailed(false)
                              setSlot({ start: entry.slotStart, end: entry.slotEnd })
                            }}
                          >
                            {timeFormat.format(new Date(entry.slotStart))}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                })()}
                {!allSlotsShown && (slots.data?.length ?? 0) > INITIAL_SLOTS_SHOWN ? (
                  <button type="button" className="v3b-more v3-press" onClick={() => setAllSlotsShown(true)}>
                    {t('booking.seeMoreTimes', { count: (slots.data?.length ?? 0) - INITIAL_SLOTS_SHOWN })}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="v3-meta" style={{ padding: '1rem 1.125rem' }}>
                {t('booking.noSlots')}
              </p>
            )}
          </div>
        ) : null}

        {step === 'details' && service && slot ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim() || !effectiveBarberId) return
              book.mutate(
                {
                  organizationSlug: slug ?? '',
                  locationId: location.id,
                  barberId: effectiveBarberId,
                  serviceId: service.id,
                  startsAt: slot.start,
                  customerName: name.trim(),
                  customerEmail: email.trim() || null,
                },
                {
                  onSuccess: (appointment) => {
                    if (appointment.claimToken) storePendingClaimToken(appointment.claimToken)
                    void queryClient.invalidateQueries({ queryKey: MY_APPOINTMENTS_KEY })
                    setBooked(appointment)
                  },
                  onError: () => {
                    void queryClient.invalidateQueries({
                      queryKey: ['public-available-slots', slug, location.id],
                    })
                    setSlot(null)
                    setAllSlotsShown(true)
                    setBookFailed(true)
                  },
                },
              )
            }}
          >
            <h2 className="v3b-step-title">{t('booking.yourDetails')}</h2>
            <div className="v3b-form">
              <label className="v3b-field">
                <span>{t('booking.nameLabel')}</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </label>
              <label className="v3b-field">
                <span>{t('booking.emailLabel')}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>

              {book.isError ? (
                <p role="alert" className="v3a-error">
                  {t('booking.failed')}
                </p>
              ) : null}

              <button type="submit" className="v3-btn v3-btn--book v3-press" disabled={book.isPending}>
                {book.isPending
                  ? t('booking.booking')
                  : t('booking.confirmWithPrice', {
                      price: money(service.priceCents, shop.currency, { trimWholeAmounts: true }),
                    })}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PencilGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 7.5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
