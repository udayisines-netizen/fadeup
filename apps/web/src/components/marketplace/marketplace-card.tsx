
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, MapPin, Scissors, Users } from 'lucide-react'
import { usePublicOrganizationBarbers } from '@/lib/queries/public-barber'
import { FavoriteButton } from '@/components/customer/favorite-button'
import { Avatar } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { VerifiedBadge } from '@/components/ui/verified-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useMoney } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'

/**
 * ============================================================================
 * THE MARKETPLACE ROW THAT OPENS
 * ============================================================================
 *
 * §10: tapping a shop card should NOT necessarily navigate. It should expand,
 * spatially connected to the card the customer just touched, into the barbers
 * they can actually book — and from there straight into booking.
 *
 * WHY THIS IS A ROW AND NOT THE GRID TILE
 *
 * `BusinessListingCard` is a compact tile in a three-column grid, and it stays
 * exactly that on Discover, where the job is "show me six places at a glance".
 * Expansion inside a grid cell would stretch its whole row and shove unrelated
 * results down the page — the opposite of the spatial continuity §10 asks for.
 *
 * So the marketplace list is a single column of rows that grow in place. The
 * two components share every primitive (Avatar, StatusBadge, FavoriteButton,
 * the money formatter) and differ only in the shape the job needs. That is a
 * deliberate split, not the drift the V2 rebuild spent a lot of effort undoing.
 *
 * WHY THE EXPANSION USES A GRID AND NOT A HEIGHT
 *
 * Animating to a measured pixel height means measuring, which means a layout
 * read on every open and a wrong answer whenever the content reflows — a long
 * team list in German, a wrapped shop name at 320px. `grid-template-rows:
 * 0fr → 1fr` animates to the content's OWN height with no measurement at all,
 * and degrades to an instant open under `prefers-reduced-motion`.
 *
 * WHAT THE COLLAPSED ROW DELIBERATELY DOES NOT SAY
 *
 *   no rating          there is no reviews table
 *   no next slot       availability needs a service; see AvailabilityLabel
 *   no Follow          §9 is explicit: no Follow button on marketplace cards.
 *                      Follow belongs on a profile, where there is enough of a
 *                      person to follow. Favourite stays, because saving a
 *                      shop from a list is exactly what a list is for.
 */
export function MarketplaceCard({
  result,
  currency,
  expanded,
  onToggle,
  onSelectBarber,
  onOpenProfile,
}: {
  result: MarketplaceProfessionalResult
  currency: string | undefined
  expanded: boolean
  onToggle: () => void
  /** Chosen a professional — the caller opens the booking sheet. */
  onSelectBarber: (barber: { barberId: string; displayName: string }) => void
  /** Reported when the customer opens this result, for the search funnel. */
  onOpenProfile?: () => void
}) {
  const { t } = useTranslation('marketplace')
  const money = useMoney()

  const isBarber = result.entityType === 'barber'
  const title = isBarber ? (result.barberDisplayName ?? result.organizationName) : result.organizationName
  const profileHref = isBarber
    ? `/s/${result.organizationSlug}/barbers/${result.barberId}`
    : `/s/${result.organizationSlug}/profile`

  const place = [result.city, result.country].filter(Boolean).join(', ')
  const distance =
    result.distanceKm !== null ? t('card.distance', { distance: result.distanceKm.toFixed(1) }) : null

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-paper-0',
        'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
        expanded ? 'border-border-strong' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <Avatar name={title} src={isBarber ? result.barberAvatarUrl : null} size="lg" className="shrink-0" />

        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-center gap-1.5 text-base font-semibold text-ink-950">
            <Link
              to={profileHref}
              onClick={onOpenProfile}
              className="min-w-0 truncate rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 hover:underline"
            >
              {title}
            </Link>
            {/*
              A CLAIMED durable identity, and nothing more — see VerifiedBadge.
              A shop row has no professional_id and therefore never carries it,
              which is correct: FadeUp verifies people, not premises.
            */}
            <VerifiedBadge verified={isBarber && result.professionalId !== null} size="sm" withoutTooltip />
          </h3>

          {isBarber && result.barberTitle ? (
            <p className="truncate text-sm text-ink-500">{result.barberTitle}</p>
          ) : null}

          {/* WHERE they work. A professional result without their shop is a
              name with no address — the customer has to open the profile just
              to learn whether it is somewhere they would go. */}
          {isBarber && result.organizationName !== title ? (
            <p className="flex min-w-0 items-center gap-1 truncate text-caption text-ink-500">
              <Scissors className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{result.organizationName}</span>
            </p>
          ) : null}

          {place || distance ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-caption text-ink-500">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{place}</span>
              {distance ? <span className="shrink-0 text-ink-300">· {distance}</span> : null}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* `isOpenNow === null` means the shop published no hours, which is
                different from being closed and is rendered as nothing. */}
            {result.isOpenNow !== null ? (
              <StatusBadge tone={result.isOpenNow ? 'accent' : 'neutral'} size="sm" live={result.isOpenNow}>
                {result.isOpenNow ? t('card.openNow') : t('card.closedNow')}
              </StatusBadge>
            ) : null}

            {/* Zero is never shown as a value — no queue means no chip. */}
            {result.queueWaitingCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-paper-100 px-2 py-1 text-xs font-medium text-ink-700">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {t('card.waiting', { count: result.queueWaitingCount })}
              </span>
            ) : null}

            {result.startingPriceCents !== null ? (
              <span className="text-caption text-ink-500">
                {t('card.startingFrom', {
                  price: money(result.startingPriceCents, currency, { trimWholeAmounts: true }),
                })}
              </span>
            ) : null}
          </div>
        </div>

        <FavoriteButton organizationId={result.organizationId} className="-me-2 -mt-1 shrink-0" />
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        {isBarber ? (
          // An individual professional IS the choice. There is no team to open,
          // so the row books directly rather than expanding into itself.
          <Button
            variant="book"
            className="flex-1"
            onClick={() =>
              onSelectBarber({
                barberId: result.barberId!,
                displayName: result.barberDisplayName ?? result.organizationName,
              })
            }
          >
            {t('card.book')}
          </Button>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={buttonVariants({ variant: expanded ? 'secondary' : 'book' }, 'flex-1')}
          >
            {expanded ? t('expand.hideTeam') : t('expand.chooseProfessional')}
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform duration-[--fu-duration-quick] motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>
        )}

        <Link
          to={profileHref}
          onClick={onOpenProfile}
          className={buttonVariants({ variant: 'ghost' }, 'shrink-0')}
        >
          {t('card.viewProfile')}
        </Link>
      </div>

      {/*
        The expansion. `grid-template-rows` 0fr → 1fr animates to the content's
        own height without a single measurement, so a long team list, a wrapped
        name and a German label all just work. The inner div's overflow-hidden
        is what makes the 0fr row actually clip.
      */}
      {!isBarber ? (
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-[--fu-duration-settle] ease-[--fu-ease-out] motion-reduce:transition-none',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="overflow-hidden">
            {/* Mounted only once opened: a page of twenty results must not fire
                twenty team queries for the one card somebody might expand. */}
            {expanded ? (
              <TeamPanel
                organizationSlug={result.organizationSlug}
                locationId={result.locationId}
                onSelectBarber={onSelectBarber}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}

/**
 * The shop's real, bookable, public team — `list_public_organization_barbers`.
 *
 * There is deliberately NO "from HH:MM" against a name here. Availability is a
 * function of (location, professional, SERVICE, date), and no service has been
 * chosen yet; a time printed at this point would be true of one service and
 * silently presented as true of all of them. The booking sheet shows it the
 * moment it becomes a true statement.
 */
function TeamPanel({
  organizationSlug,
  locationId,
  onSelectBarber,
}: {
  organizationSlug: string
  locationId: string
  onSelectBarber: (barber: { barberId: string; displayName: string }) => void
}) {
  const { t } = useTranslation('marketplace')
  const barbersQuery = usePublicOrganizationBarbers(organizationSlug)

  if (barbersQuery.isPending) {
    return (
      <div className="flex flex-col gap-2 border-t border-border p-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    )
  }

  if (barbersQuery.isError) {
    return (
      <p role="status" className="border-t border-border p-4 text-sm text-ink-500">
        {t('expand.teamUnavailable')}
      </p>
    )
  }

  // Only professionals attached to the location this result is about. A shop
  // with three branches must not offer a barber who works across town under a
  // card whose address says otherwise.
  const team = barbersQuery.data.filter((barber) => barber.locationId === locationId)

  if (team.length === 0) {
    return (
      <p className="border-t border-border p-4 text-sm text-ink-500">{t('expand.noTeam')}</p>
    )
  }

  return (
    <ul className="flex flex-col gap-2 border-t border-border p-4">
      {team.map((barber) => (
        <li key={barber.barberId}>
          <button
            type="button"
            onClick={() => onSelectBarber({ barberId: barber.barberId, displayName: barber.displayName })}
            className={cn(
              'flex w-full min-h-[--fu-control-lg] items-center gap-3 rounded-xl border border-border bg-paper-0 px-3 py-2.5 text-start',
              'transition-colors duration-[--fu-duration-quick] hover:border-accent-200 hover:bg-accent-100/40',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 motion-reduce:transition-none',
            )}
          >
            <Avatar name={barber.displayName} src={barber.avatarUrl} size="sm" className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink-950">{barber.displayName}</span>
                <VerifiedBadge verified={barber.professionalId !== null} size="sm" withoutTooltip />
              </span>
              {barber.title ? <span className="block truncate text-xs text-ink-500">{barber.title}</span> : null}
            </span>
            <span className={buttonVariants({ variant: 'book', size: 'sm' }, 'pointer-events-none shrink-0')}>
              {t('card.book')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
