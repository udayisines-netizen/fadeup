import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin, Scissors, Store, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

/**
 * A single marketplace result — either a shop or an individual barber
 * (`result.entityType`). Individual barbers are first-class here, not a
 * shop-only card: a barber row gets its own photo/name/title and links
 * straight to that barber's profile, not the shop's. No cover photo for
 * shops — organizations have no image column in this schema yet — so a
 * monogram stands in rather than a stock/fabricated photo.
 */
export function ProfessionalResultCard({ result }: { result: MarketplaceProfessionalResult }) {
  const { t } = useTranslation('marketplace')
  const isBarber = result.entityType === 'barber'
  const title = isBarber ? (result.barberDisplayName ?? result.organizationName) : result.organizationName
  const initial = title.charAt(0).toUpperCase()
  const profileHref = isBarber ? `/s/${result.organizationSlug}/barbers/${result.barberId}` : `/s/${result.organizationSlug}`

  const subtitleParts = isBarber
    ? [result.organizationName, result.barberTitle, result.city].filter(Boolean)
    : [result.locationName, result.city].filter(Boolean)

  return (
    <Card className="flex gap-4 p-4 sm:p-5">
      {isBarber && result.barberAvatarUrl ? (
        <img
          src={result.barberAvatarUrl}
          alt=""
          className="h-14 w-14 shrink-0 rounded-full object-cover sm:h-16 sm:w-16"
        />
      ) : (
        <div
          aria-hidden="true"
          className={
            isBarber
              ? 'flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-100 text-lg font-semibold text-accent-800 sm:h-16 sm:w-16'
              : 'flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-lg font-semibold text-accent-800 sm:h-16 sm:w-16'
          }
        >
          {initial}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-base font-semibold text-ink-950">{title}</h3>
            <Badge variant="neutral" className="shrink-0">
              {isBarber ? (
                <Scissors className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Store className="h-3 w-3" aria-hidden="true" />
              )}
              <span>{isBarber ? t('card.entityBarber') : t('card.entityShop')}</span>
            </Badge>
          </div>
          {result.isOpenNow !== null ? (
            <Badge variant={result.isOpenNow ? 'success' : 'neutral'}>
              {result.isOpenNow ? t('card.openNow') : t('card.closedNow')}
            </Badge>
          ) : null}
        </div>

        <p className="flex items-center gap-1 text-sm text-ink-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {subtitleParts.join(' · ')}
            {result.distanceKm !== null ? ` — ${t('card.distance', { distance: result.distanceKm.toFixed(1) })}` : ''}
          </span>
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-700">
          {result.startingPriceCents !== null ? (
            <span className="flex items-center gap-1">
              <Scissors className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
              {t('card.startingFrom', { price: formatPrice(result.startingPriceCents) })}
            </span>
          ) : null}
          {result.queueWaitingCount > 0 ? (
            <span className="flex items-center gap-1 font-medium text-accent-700">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {t('card.waiting', { count: result.queueWaitingCount })}
            </span>
          ) : null}
        </div>

        <Link to={profileHref} className={buttonVariants({ variant: 'secondary', size: 'sm' }, 'mt-2 self-start')}>
          {t('card.viewProfile')}
        </Link>
      </div>
    </Card>
  )
}
