/**
 * The V3 marketplace result grammar — ONE grammar at every width.
 *
 * A result is a row: identity, relationship line, operational line, Book.
 * Desktop changes the page around it, never re-houses it in a card. Every
 * line is data-gated (a null renders nothing): `isOpenNow === null` says
 * nothing, `queueWaitingCount` renders only above zero, no media frame
 * exists while no media contract exists.
 */
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'
import { useMoney } from '@/lib/intl/use-intl'
import { v3ShopProfilePath, v3BookingPath } from '@/customer-v3/routes'

export function ResultRow({
  result,
  currency,
  active,
  onHover,
}: {
  result: MarketplaceProfessionalResult
  /** The org's real currency, or undefined while unresolved — price waits. */
  currency: string | undefined
  active?: boolean
  onHover?: (locationId: string | null) => void
}) {
  const { t } = useTranslation('v3')
  const money = useMoney()

  const supplyLabel =
    result.marketplaceSupplyType === 'independent'
      ? t('landing.result.independent')
      : result.marketplaceSupplyType === 'barbershop'
        ? t('landing.result.barbershop')
        : null

  const price =
    result.startingPriceCents != null && currency
      ? money(result.startingPriceCents, currency, { trimWholeAmounts: true })
      : null

  return (
    <div
      className="v3a-row"
      data-active={active || undefined}
      onPointerEnter={onHover ? () => onHover(result.locationId) : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      <Link to={v3ShopProfilePath(result.organizationSlug, result.locationId)} className="v3a-row-link">
        <span className="v3a-row-name">{result.locationName}</span>
        <span className="v3a-row-meta">
          {supplyLabel ? <span>{supplyLabel}</span> : null}
          {result.city ? <span>{result.city}</span> : null}
          {result.distanceKm != null ? (
            <span className="v3-num">{t('landing.result.distance', { km: result.distanceKm.toFixed(1) })}</span>
          ) : null}
        </span>
        <span className="v3a-row-ops">
          {result.isOpenNow === true ? (
            <span className="v3a-open">
              <span className="v3-live-dot" aria-hidden="true" />
              {t('landing.result.open')}
            </span>
          ) : result.isOpenNow === false ? (
            <span className="v3a-closed">{t('app.market.closed')}</span>
          ) : null}
          {result.queueWaitingCount > 0 ? (
            <span className="v3a-queue">
              {t('landing.result.waiting', { count: result.queueWaitingCount })}
            </span>
          ) : null}
          {price ? (
            <span className="v3a-price v3-num">{t('landing.result.from', { price })}</span>
          ) : null}
        </span>
      </Link>
      <Link
        to={v3BookingPath(result.organizationSlug, { locationId: result.locationId })}
        className="v3-btn v3-btn--book v3-press v3a-row-book"
        aria-label={t('app.market.bookAt', { name: result.locationName })}
      >
        {t('landing.result.book')}
      </Link>
    </div>
  )
}
