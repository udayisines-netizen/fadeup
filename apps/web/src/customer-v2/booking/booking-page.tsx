import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMoney } from '@/lib/intl/use-intl'
import { downloadIcs } from '@/lib/calendar/ics'
import { storePendingClaimToken } from '@/lib/queries/customer-profile'
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
import { Notice } from '@/customer-v2/ui/notice'
import { V2_ROUTES } from '@/customer-v2/routes'

/**
 * The greenfield booking experience — one page that transforms, never a
 * wizard that navigates.
 *
 * ============================================================================
 * THE STEP ORDER, AND WHY IT DIFFERS FROM THE BLUEPRINT'S SHOP SKETCH
 * ============================================================================
 *
 * The blueprint sketches Shop booking as Service → Time → Professional. The
 * actual availability contract cannot answer in that order:
 * `get_public_available_slots` REQUIRES `p_barber_id` — a slot is a fact about
 * one professional's diary, and no contract aggregates slots across a team.
 * Presenting times before a barber would mean either improvising that
 * aggregation client-side (N round trips per day viewed, producing an answer
 * the server never promised) or inventing times. Both are forbidden.
 *
 * So the supported order is:
 *
 *   from a barber:  Service → Time → Details → Confirm     (barber known)
 *   from a shop:    Service → Barber → Time → Details → Confirm
 *
 * with the barber step AUTO-SKIPPED when the roster for the chosen service has
 * exactly one member. Time-before-barber remains a real product want; it needs
 * a backend aggregation contract and is recorded as a deferred gap, not
 * imitated.
 *
 * ============================================================================
 * CONTEXT ARRIVES IN THE URL AND IS NEVER ASKED FOR TWICE
 * ============================================================================
 *
 * `?location=` — every v2 Book CTA carries it, because the search RPC emits one
 * row per location and the customer already chose a branch. `?barber=` — a
 * barber-profile entry preselects its person; the flow never asks again.
 *
 * ============================================================================
 * PROGRESSIVE TRANSFORMATION
 * ============================================================================
 *
 * Completed steps collapse into one-line summaries with a Change control; the
 * active step renders in full underneath. Nothing navigates, no sheet stack —
 * MOTION_SYSTEM.md §8's "each state should feel like the previous state
 * transformed", implemented as layout rather than choreography.
 *
 * ============================================================================
 * ANONYMOUS BOOKING KEEPS ITS CLAIM
 * ============================================================================
 *
 * `book_public_appointment` returns a single-use claim token for an anonymous
 * booking. It goes straight into the existing pending-claim store, which the
 * shell already redeems after signup — R5R adds no second ownership mechanism.
 */

type Step = 'service' | 'barber' | 'time' | 'details'

const INITIAL_SLOTS_SHOWN = 3
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
  })
  const dates: Array<{ key: string; label: string }> = []
  const seen = new Set<string>()
  for (let i = 0; i < DAYS_SHOWN; i += 1) {
    const instant = new Date(Date.now() + i * 86_400_000)
    const key = formatKey.format(instant)
    if (seen.has(key)) continue
    seen.add(key)
    dates.push({ key, label: formatLabel.format(instant) })
  }
  return dates
}

export function CustomerV2BookingPage() {
  const { t, i18n } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const money = useMoney()

  const organization = usePublicOrganization(slug)
  const locations = usePublicLocations(slug)

  const requestedLocation = searchParams.get('location')
  const requestedBarber = searchParams.get('barber')

  const location = useMemo(() => {
    const all = locations.data ?? []
    return all.find((l) => l.id === requestedLocation) ?? all[0] ?? null
  }, [locations.data, requestedLocation])

  const services = usePublicServices(slug, location?.id)

  const [serviceId, setServiceId] = useState<string | null>(null)
  const [barberId, setBarberId] = useState<string | null>(requestedBarber)
  const [date, setDate] = useState<string | null>(null)
  const [slot, setSlot] = useState<{ start: string; end: string } | null>(null)
  const [allSlotsShown, setAllSlotsShown] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [booked, setBooked] = useState<BookedAppointment | null>(null)

  const service: PublicService | null =
    (services.data ?? []).find((entry) => entry.id === serviceId) ?? null

  const barbers = usePublicBarbers(slug, location?.id, serviceId ?? undefined)

  /*
    One bookable barber for this service means there is no choice to present —
    the step answers itself. A preselected `?barber=` answers it too.
  */
  const roster = barbers.data ?? []
  const effectiveBarberId =
    barberId ?? (serviceId && !barbers.isPending && roster.length === 1 ? roster[0].barberId : null)
  const barber = roster.find((entry) => entry.barberId === effectiveBarberId) ?? null

  const days = useMemo(
    () => (location ? shopDates(location.timezone, i18n.language) : []),
    [location, i18n.language],
  )
  const activeDate = date ?? days[0]?.key ?? null

  const slots = usePublicAvailableSlots(
    slug,
    location?.id,
    effectiveBarberId ?? undefined,
    serviceId ?? undefined,
    activeDate ?? undefined,
  )

  const book = useBookPublicAppointment()

  useDocumentMeta({
    title: t('customer-app:v2.booking.documentTitle'),
    description: t('customer-app:v2.booking.documentDescription'),
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

  const step: Step = !serviceId
    ? 'service'
    : !effectiveBarberId
      ? 'barber'
      : !slot
        ? 'time'
        : 'details'

  if (organization.isError || locations.isError) {
    return (
      <Notice
        tone="failure"
        title={t('customer-app:v2.discovery.errorTitle')}
        body={t('customer-app:v2.discovery.errorBody')}
        actionLabel={t('customer-app:v2.discovery.retry')}
        onAction={() => {
          void organization.refetch()
          void locations.refetch()
        }}
      />
    )
  }

  if (organization.data === null) {
    return (
      <Notice
        tone="empty"
        title={t('customer-app:v2.shopProfile.notFoundTitle')}
        body={t('customer-app:v2.shopProfile.notFoundBody')}
        actionLabel={null}
        onAction={null}
      />
    )
  }

  if (!organization.data || !location) {
    return <div className="min-h-64" />
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
      <div className="mx-auto max-w-[26rem]">
        <section className="v2-plate p-6 text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-v2-green-tint"
          >
            <Check className="h-6 w-6 text-v2-green" strokeWidth={2.5} />
          </span>

          <h1 className="mt-3 text-v2-lead font-semibold text-v2-ink">
            {t('customer-app:v2.booking.bookedTitle')}
          </h1>

          <p className="mt-2 text-v2-body font-medium text-v2-ink">
            {dayFormat.format(new Date(booked.startsAt))} ·{' '}
            {timeFormat.format(new Date(booked.startsAt))}
          </p>

          <p className="mt-1 text-v2-meta text-v2-ink-soft">
            {barber ? <bdi>{barber.displayName}</bdi> : null}
            {barber ? ' · ' : ''}
            <bdi>{placeName}</bdi>
          </p>

          <p className="mt-1 text-v2-meta text-v2-ink-soft">
            {service.name} · {money(service.priceCents, shop.currency)}
          </p>

          {address ? (
            <p className="mt-1 text-v2-meta text-v2-ink-mute">
              <bdi>{address}</bdi>
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
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
              className="v2-press inline-flex h-11 items-center justify-center rounded-v2-2 border border-v2-edge bg-v2-paper px-4 text-v2-meta font-semibold text-v2-ink hover:bg-v2-fill"
            >
              {t('customer-app:v2.booking.addToCalendar')}
            </button>

            {user ? (
              <Link
                to={V2_ROUTES.appointments}
                className="v2-press inline-flex h-11 items-center justify-center rounded-v2-2 border border-v2-edge bg-v2-paper px-4 text-v2-meta font-semibold text-v2-ink hover:bg-v2-fill"
              >
                {t('customer-app:v2.booking.viewBooking')}
              </Link>
            ) : null}

            <Link
              to={V2_ROUTES.home}
              className="v2-press inline-flex h-11 items-center justify-center rounded-v2-2 bg-v2-ink px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-ink/90"
            >
              {t('customer-app:v2.booking.done')}
            </Link>
          </div>

          {!user && booked.claimToken ? (
            <p className="mt-4 text-v2-caption text-v2-ink-mute">
              {t('customer-app:v2.booking.claimHint')}
            </p>
          ) : null}
        </section>
      </div>
    )
  }

  /* ─────────────────────────────── THE FLOW ─────────────────────────────── */

  const summaryRow = (label: string, value: string, onChange: () => void) => (
    <div className="flex items-center gap-3 border-t border-v2-hairline px-4 py-3 first:border-t-0 md:px-5">
      <p className="min-w-0 flex-1 truncate text-v2-meta text-v2-ink">
        <span className="text-v2-ink-soft">{label}</span>{' '}
        <span className="font-semibold">{value}</span>
      </p>
      <button
        type="button"
        onClick={onChange}
        className="v2-press shrink-0 rounded-v2-1 text-v2-meta font-semibold text-v2-green hover:underline"
      >
        {t('customer-app:v2.booking.change')}
      </button>
    </div>
  )

  const visibleSlots = allSlotsShown
    ? (slots.data ?? [])
    : (slots.data ?? []).slice(0, INITIAL_SLOTS_SHOWN)

  return (
    <div className="mx-auto max-w-[30rem]">
      <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
        {t('customer-app:v2.booking.title', { name: placeName })}
      </h1>
      {address ? (
        <p className="mt-0.5 text-v2-meta text-v2-ink-soft">
          <bdi>{address}</bdi>
        </p>
      ) : null}

      <div className="v2-plate mt-4 overflow-hidden">
        {/* Collapsed summaries of every decided step, in decision order. */}
        {service && step !== 'service'
          ? summaryRow(
              t('customer-app:v2.booking.serviceLabel'),
              `${service.name} · ${money(service.priceCents, shop.currency)}`,
              () => {
                setServiceId(null)
                setBarberId(requestedBarber)
                setSlot(null)
                setAllSlotsShown(false)
              },
            )
          : null}

        {barber && (step === 'time' || step === 'details') && !requestedBarber
          ? summaryRow(t('customer-app:v2.booking.barberLabel'), barber.displayName, () => {
              setBarberId(null)
              setSlot(null)
            })
          : null}

        {slot && step === 'details' && timeFormat
          ? summaryRow(
              t('customer-app:v2.booking.timeLabel'),
              `${days.find((d) => d.key === activeDate)?.label ?? ''} · ${timeFormat.format(new Date(slot.start))}`,
              () => setSlot(null),
            )
          : null}

        {/* ── Active step ── */}

        {step === 'service' ? (
          <div>
            <h2 className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5">
              {t('customer-app:v2.booking.chooseService')}
            </h2>
            {services.data && services.data.length > 0 ? (
              <ul>
                {services.data.map((entry) => (
                  <li key={entry.id} className="border-t border-v2-hairline">
                    <button
                      type="button"
                      onClick={() => setServiceId(entry.id)}
                      className="v2-press flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-v2-ground md:px-5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-v2-body font-medium text-v2-ink">
                          {entry.name}
                        </span>
                        <span className="block text-v2-meta text-v2-ink-soft">
                          {t('customer-app:v2.barberProfile.minutes', {
                            count: entry.durationMinutes,
                          })}
                        </span>
                      </span>
                      <span className="shrink-0 text-v2-body font-semibold tabular-nums text-v2-ink">
                        {money(entry.priceCents, shop.currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : services.isPending ? (
              <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
                <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
              </div>
            ) : (
              <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
                {t('customer-app:v2.barberProfile.noServices')}
              </p>
            )}
          </div>
        ) : null}

        {step === 'barber' ? (
          <div>
            <h2 className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5">
              {t('customer-app:v2.booking.chooseBarber')}
            </h2>
            {roster.length > 0 ? (
              <ul>
                {roster.map((entry) => (
                  <li key={entry.barberId} className="border-t border-v2-hairline">
                    <button
                      type="button"
                      onClick={() => setBarberId(entry.barberId)}
                      className="v2-press flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-v2-ground md:px-5"
                    >
                      <span className="min-w-0 flex-1 truncate text-v2-body font-medium text-v2-ink">
                        <bdi>{entry.displayName}</bdi>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : barbers.isPending ? (
              <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
                <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
              </div>
            ) : (
              <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
                {t('customer-app:v2.booking.noBarbersForService')}
              </p>
            )}
          </div>
        ) : null}

        {step === 'time' ? (
          <div>
            <h2 className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5">
              {t('customer-app:v2.booking.chooseTime')}
            </h2>

            {/* Horizontal day selector, in the SHOP's calendar. */}
            <div className="flex gap-2 overflow-x-auto border-t border-v2-hairline px-4 py-3 md:px-5">
              {days.map((day) => {
                const selected = day.key === activeDate
                return (
                  <button
                    key={day.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setDate(day.key)
                      setAllSlotsShown(false)
                    }}
                    className={
                      selected
                        ? 'v2-press inline-flex h-9 shrink-0 items-center rounded-v2-2 bg-v2-green-tint px-3 text-v2-meta font-semibold text-v2-green-ink'
                        : 'v2-press inline-flex h-9 shrink-0 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft'
                    }
                  >
                    {day.label}
                  </button>
                )
              })}
            </div>

            {slots.isPending ? (
              <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
                <div className="v2-skeleton h-11 w-full rounded-v2-2" />
              </div>
            ) : visibleSlots.length > 0 && timeFormat ? (
              <div className="border-t border-v2-hairline px-4 py-3 md:px-5">
                <div className="flex flex-wrap gap-2">
                  {visibleSlots.map((entry) => (
                    <button
                      key={entry.slotStart}
                      type="button"
                      onClick={() => setSlot({ start: entry.slotStart, end: entry.slotEnd })}
                      className="v2-press inline-flex h-11 items-center rounded-v2-2 border border-v2-edge bg-v2-paper px-4 text-v2-body font-semibold tabular-nums text-v2-ink hover:bg-v2-fill"
                    >
                      {timeFormat.format(new Date(entry.slotStart))}
                    </button>
                  ))}
                </div>
                {!allSlotsShown && (slots.data?.length ?? 0) > INITIAL_SLOTS_SHOWN ? (
                  <button
                    type="button"
                    onClick={() => setAllSlotsShown(true)}
                    className="v2-press mt-3 inline-flex h-9 items-center rounded-v2-1 text-v2-meta font-semibold text-v2-green hover:underline"
                  >
                    {t('customer-app:v2.booking.seeMoreTimes', {
                      count: (slots.data?.length ?? 0) - INITIAL_SLOTS_SHOWN,
                    })}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
                {t('customer-app:v2.booking.noSlots')}
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
                    setBooked(appointment)
                  },
                },
              )
            }}
          >
            <h2 className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5">
              {t('customer-app:v2.booking.yourDetails')}
            </h2>

            <div className="flex flex-col gap-3 border-t border-v2-hairline px-4 py-4 md:px-5">
              <label className="flex flex-col gap-1.5">
                <span className="text-v2-meta font-medium text-v2-ink">
                  {t('customer-app:v2.booking.nameLabel')}
                </span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  className="h-12 rounded-v2-2 border border-v2-edge bg-v2-paper px-3.5 text-v2-body text-v2-ink placeholder:text-v2-ink-mute"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-v2-meta font-medium text-v2-ink">
                  {t('customer-app:v2.booking.emailLabel')}
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  className="h-12 rounded-v2-2 border border-v2-edge bg-v2-paper px-3.5 text-v2-body text-v2-ink placeholder:text-v2-ink-mute"
                />
              </label>

              {book.isError ? (
                <p role="alert" className="text-v2-meta font-medium text-v2-alert">
                  {t('customer-app:v2.booking.failed')}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={book.isPending}
                className="v2-press inline-flex h-12 items-center justify-center rounded-v2-2 bg-v2-green px-5 text-v2-body font-semibold text-v2-paper hover:bg-v2-green-deep disabled:opacity-60"
              >
                {book.isPending
                  ? t('customer-app:v2.booking.booking')
                  : t('customer-app:v2.booking.confirm')}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}
