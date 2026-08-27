import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { MapPin, Scissors, Users } from 'lucide-react'
import { FavoriteButton } from '@/components/customer/favorite-button'
import { FollowButton } from '@/components/customer/follow-button'
import { buttonVariants } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { Avatar } from '@/components/ui/avatar'
import { useMoney } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'

/**
 * A shop or an independent professional, as a card.
 *
 * ============================================================================
 * GRACEFUL DEGRADATION IS THE ENTIRE DESIGN OF THIS COMPONENT
 * ============================================================================
 *
 * The reference card carries a photograph, a star rating, a next-slot badge
 * and a promotional chip. FadeUp has NONE of those:
 *
 *   photo      no business image column exists
 *   rating     no reviews table exists
 *   next slot  the search RPCs do not return availability
 *   promo      no promotions exist
 *
 * Every one of them is the kind of thing a customer decides on, so faking any
 * of it would be the most damaging possible shortcut. What the search RPCs DO
 * return is real and useful — distance, city, starting price, open state and a
 * live queue count — and this card is composed around those instead.
 *
 * Where the reference has a photograph, this uses a deliberate branded panel:
 * the shop's initial on a tinted ground, tinted deterministically from the
 * name so a list of results is still visually distinguishable. That is a
 * design decision, not a placeholder waiting for images.
 *
 * ZERO IS NEVER SHOWN AS A VALUE. No queue means the chip is absent, not
 * "0 waiting". No price means no price line. `isOpenNow === null` means the
 * shop has not published hours, which is different from being closed, and is
 * rendered as nothing rather than as a negative.
 */
export function BusinessListingCard({
  result,
  currency,
  className,
}: {
  result: MarketplaceProfessionalResult
  currency: string | undefined
  className?: string
}) {
  const { t } = useTranslation()
  const money = useMoney()

  const isBarber = result.entityType === 'barber'
  const title = isBarber ? (result.barberDisplayName ?? result.organizationName) : result.organizationName
  const href = isBarber
    ? `/s/${result.organizationSlug}/barbers/${result.barberId}`
    : `/s/${result.organizationSlug}/profile`
  // Booking a specific professional carries them into the wizard, which then
  // skips the step it no longer needs to ask.
  const bookHref = isBarber
    ? `/s/${result.organizationSlug}?barber=${result.barberId}`
    : `/s/${result.organizationSlug}`

  const place = [result.city, result.country].filter(Boolean).join(', ')
  const distance =
    result.distanceKm !== null
      ? t('marketplace:card.distance', { distance: result.distanceKm.toFixed(1) })
      : null

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border border-border bg-paper-0',
        'transition-shadow duration-[--fu-duration-quick] hover:shadow-sm motion-reduce:transition-none',
        className,
      )}
    >
      {/* The visual panel. Not an <img> — there is no image. It carries the
          identity and the two overlays the reference puts on its photograph. */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-accent-100">
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-br from-accent-100 via-paper-100 to-paper-200"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          {isBarber && result.barberAvatarUrl ? (
            <img
              src={result.barberAvatarUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <Avatar name={title} size="xl" className="scale-125 shadow-sm" />
          )}
        </span>

        {result.isOpenNow !== null ? (
          <span className="absolute start-3 top-3">
            <StatusBadge tone={result.isOpenNow ? 'accent' : 'neutral'} size="sm" live={result.isOpenNow}>
              {result.isOpenNow ? t('marketplace:card.openNow') : t('marketplace:card.closedNow')}
            </StatusBadge>
          </span>
        ) : null}

        <span className="absolute end-2 top-2">
          {isBarber ? (
            result.professionalId ? (
              <FollowButton professionalId={result.professionalId} />
            ) : null
          ) : (
            <FavoriteButton
              organizationId={result.organizationId}
              favoriteLabel={t('marketplace:card.addFavorite')}
              unfavoriteLabel={t('marketplace:card.removeFavorite')}
            />
          )}
        </span>

        {result.queueWaitingCount > 0 ? (
          <span className="absolute bottom-3 end-3 inline-flex items-center gap-1.5 rounded-lg bg-ink-950/85 px-2.5 py-1.5 text-xs font-medium text-paper-0 backdrop-blur">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {t('marketplace:card.waiting', { count: result.queueWaitingCount })}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
        <h3 className="truncate text-base font-semibold text-ink-950">
          {/* Whole-card link: the heading anchor is stretched so the target is
              the card, while the accessible name stays the business name. */}
          <Link
            to={href}
            className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            {title}
          </Link>
        </h3>

        {isBarber && result.barberTitle ? (
          <p className="truncate text-sm text-ink-500">{result.barberTitle}</p>
        ) : null}

        {place || distance ? (
          <p className="flex min-w-0 items-center gap-1 text-sm text-ink-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{place}</span>
            {distance ? <span className="shrink-0 text-ink-300">· {distance}</span> : null}
          </p>
        ) : null}

        {isBarber && result.organizationName !== title ? (
          <p className="flex items-center gap-1 truncate text-xs text-ink-500">
            <Scissors className="h-3 w-3 shrink-0" aria-hidden="true" />
            {result.organizationName}
          </p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          {result.startingPriceCents !== null ? (
            <p className="min-w-0 text-sm text-ink-500">
              {t('marketplace:card.startingFrom', {
                price: money(result.startingPriceCents, currency, { trimWholeAmounts: true }),
              })}
            </p>
          ) : (
            <span />
          )}

          {/*
            `relative` lifts this above the heading's stretched overlay, which
            otherwise swallows every click inside the card. Without it, the
            one-tap route from a search result into the booking wizard — with
            the professional already preselected — silently becomes a second
            trip through the shop profile.
          */}
          <Link
            to={bookHref}
            className={buttonVariants({ variant: 'secondary', size: 'sm' }, 'relative shrink-0')}
          >
            {t('marketplace:card.book')}
          </Link>
        </div>
      </div>
    </article>
  )
}
