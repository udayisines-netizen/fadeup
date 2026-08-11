import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin, Scissors, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import type { MarketplaceSearchResult } from '@/lib/queries/marketplace'

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

/**
 * A single marketplace search result. No cover photo — organizations have
 * no image column in this schema yet (see marketplace migration comment),
 * so a monogram stands in rather than a stock/fabricated photo.
 */
export function MarketplaceResultCard({ result }: { result: MarketplaceSearchResult }) {
  const { t } = useTranslation('marketplace')
  const initial = result.organizationName.charAt(0).toUpperCase()

  return (
    <Card className="flex gap-4 p-4 sm:p-5">
      <div
        aria-hidden="true"
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-lg font-semibold text-accent-800 sm:h-16 sm:w-16"
      >
        {initial}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h3 className="truncate text-base font-semibold text-ink-950">{result.organizationName}</h3>
          {result.isOpenNow !== null ? (
            <Badge variant={result.isOpenNow ? 'success' : 'neutral'}>
              {result.isOpenNow ? t('card.openNow') : t('card.closedNow')}
            </Badge>
          ) : null}
        </div>

        <p className="flex items-center gap-1 text-sm text-ink-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {[result.locationName, result.city].filter(Boolean).join(' · ')}
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

        <Link
          to={`/s/${result.organizationSlug}`}
          className={buttonVariants({ variant: 'secondary', size: 'sm' }, 'mt-2 self-start')}
        >
          {t('card.viewProfile')}
        </Link>
      </div>
    </Card>
  )
}
