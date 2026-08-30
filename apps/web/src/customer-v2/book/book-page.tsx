import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMyAppointments, type MyAppointment } from '@/lib/queries/customer-app'
import { useCustomerLocation } from '@/customer-v2/hooks/use-customer-location'
import { useHomeDiscovery } from '@/customer-v2/hooks/use-home-discovery'
import { ProfessionalResult } from '@/customer-v2/home/professional-result'
import { IdentityTile } from '@/customer-v2/home/identity-tile'
import { V2_ROUTES, v2BookingPath } from '@/customer-v2/routes'

/**
 * The Book tab — the shortest path from intent to a confirmed time.
 *
 * ============================================================================
 * TWO REAL SOURCES, NOTHING RECOMMENDED
 * ============================================================================
 *
 * BOOK AGAIN — the customer's own appointment history, deduplicated to one
 * card per (shop, barber) pair, newest first. Each card opens the booking flow
 * with that context preselected, so a regular's repeat visit is service + time
 * and nothing else. This is backend-supported context, not a recommendation
 * engine: the list is literally who cut this customer before.
 *
 * ELIGIBLE SUPPLY — the same real marketplace query Home runs (one cache entry
 * between them), so someone with no history still has a direct entry into
 * booking. There is no "recommended for you" heading over it because nothing
 * ranks anyone; it is the supply that exists, in the ordering the RPC already
 * defines.
 *
 * Signed out, the page is the supply list plus a search hand-off to the
 * Marketplace — a working entry point, not a login wall.
 */
export function CustomerV2BookPage() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const location = useCustomerLocation()
  const appointments = useMyAppointments(Boolean(user), user?.id)
  const discovery = useHomeDiscovery({ location, query: '', openNowOnly: false })

  useDocumentMeta({
    title: t('customer-app:v2.book.documentTitle'),
    description: t('customer-app:v2.book.documentDescription'),
    noIndex: true,
  })

  /* One rebook card per (shop, barber), newest first — real history only. */
  const rebookContexts = useMemo(() => {
    const seen = new Set<string>()
    const contexts: MyAppointment[] = []
    const rows = [...(appointments.data ?? [])].sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    for (const appointment of rows) {
      const key = `${appointment.organizationId}|${appointment.barberId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      contexts.push(appointment)
      if (contexts.length >= 4) break
    }
    return contexts
  }, [appointments.data])

  return (
    <div className="mx-auto flex max-w-[36rem] flex-col gap-4">
      <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
        {t('customer-app:v2.book.title')}
      </h1>

      {rebookContexts.length > 0 ? (
        <section aria-labelledby="v2-book-again" className="v2-plate overflow-hidden">
          <h2 id="v2-book-again" className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5">
            {t('customer-app:v2.appointments.bookAgain')}
          </h2>
          <ul className="border-t border-v2-hairline">
            {rebookContexts.map((appointment) => (
              <li
                key={`${appointment.organizationId}-${appointment.barberId ?? 'shop'}`}
                className="border-t border-v2-hairline first:border-t-0"
              >
                <Link
                  to={v2BookingPath(appointment.organizationSlug, {
                    locationId: appointment.locationId,
                    barberId: appointment.barberId,
                  })}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-v2-ground md:px-5"
                >
                  <IdentityTile
                    src={null}
                    alt=""
                    kind={appointment.barberDisplayName ? 'barber' : 'shop'}
                    className="h-12 w-12 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-v2-body font-medium text-v2-ink">
                      <bdi>{appointment.barberDisplayName ?? appointment.organizationName}</bdi>
                    </span>
                    {appointment.barberDisplayName ? (
                      <span className="block truncate text-v2-meta text-v2-ink-soft">
                        <bdi>{appointment.organizationName}</bdi>
                      </span>
                    ) : null}
                  </span>
                  <span className="v2-press inline-flex h-9 shrink-0 items-center rounded-v2-2 bg-v2-green px-3.5 text-v2-meta font-semibold text-v2-paper">
                    {t('customer-app:v2.result.book')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Search is a hand-off to the Marketplace, which owns the full controls. */}
      <Link
        to={V2_ROUTES.marketplace}
        className="v2-press inline-flex h-12 items-center justify-center rounded-v2-2 border border-v2-edge bg-v2-paper px-4 text-v2-body font-semibold text-v2-ink hover:bg-v2-fill"
      >
        {t('customer-app:v2.book.searchSomeoneElse')}
      </Link>

      {discovery.listings.length > 0 ? (
        <section aria-labelledby="v2-book-supply" className="v2-plate overflow-hidden">
          <h2 id="v2-book-supply" className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5">
            {t('customer-app:v2.discovery.nearYou')}
          </h2>
          <ul className="border-t border-v2-hairline">
            {discovery.listings.slice(0, 6).map((listing, index) => (
              <li
                key={listing.result.locationId}
                className="border-t border-v2-hairline first:border-t-0"
              >
                <ProfessionalResult
                  result={listing.result}
                  supplyType={listing.supplyType}
                  currency={discovery.currencyByOrganization[listing.result.organizationId]}
                  index={index}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
