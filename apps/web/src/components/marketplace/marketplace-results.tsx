import { Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { List, Map as MapIcon } from 'lucide-react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { MarketplaceCard } from '@/components/marketplace/marketplace-card'
import {
  InlineBookingSheet,
  type InlineBookingTarget,
} from '@/components/marketplace/inline-booking-sheet'
import { MARKETPLACE_SORTS, type MarketplaceSort } from '@/lib/queries/marketplace'
import { useAnalytics } from '@/lib/analytics'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'

/**
 * maplibre is close to a megabyte before compression and the great majority of
 * marketplace sessions never leave the list. Loading it on demand is the whole
 * reason `ResultsMap` is a separate module (§35: keep map code out of the
 * initial bundle).
 */
const ResultsMap = lazy(async () => {
  const module = await import('@/components/marketplace/results-map')
  return { default: module.ResultsMap }
})

export type ResultsMode = 'list' | 'map'

/**
 * ============================================================================
 * ONE RESULT SET, TWO WAYS OF LOOKING AT IT
 * ============================================================================
 *
 * §12: list and map are two views of the SAME query, and switching between
 * them must not reset anything. That is why neither the mode nor the sort is
 * held here — both live in the URL, owned by `DiscoverySearch` alongside the
 * filters, so a mode switch is a render and never a refetch, and Back does
 * what a customer means by Back.
 *
 * On desktop the map does not replace the list, it sits beside it. A wide
 * viewport has room for both, and "I can see where it is AND read the row"
 * is the entire advantage a desktop marketplace has over a phone. On a phone
 * they are exclusive, because they are not both usable at 390px.
 *
 * ONE CARD OPEN AT A TIME. Two expanded cards means the second one pushes the
 * first off screen while the customer is reading it. Expansion state is a
 * single id rather than a set, which makes that impossible rather than merely
 * discouraged.
 */
export function MarketplaceResults({
  results,
  currencies,
  mode,
  onModeChange,
  sort,
  onSortChange,
  isPending,
  onOpenResult,
}: {
  results: MarketplaceProfessionalResult[]
  currencies: Record<string, string>
  mode: ResultsMode
  onModeChange: (mode: ResultsMode) => void
  sort: MarketplaceSort
  onSortChange: (sort: MarketplaceSort) => void
  isPending: boolean
  /** Reported when a customer opens a result, with its rank in the list. */
  onOpenResult?: (result: MarketplaceProfessionalResult, index: number) => void
}) {
  const { t } = useTranslation('marketplace')
  const analytics = useAnalytics()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [bookingTarget, setBookingTarget] = useState<InlineBookingTarget | null>(null)

  function keyOf(result: MarketplaceProfessionalResult): string {
    return `${result.entityType}-${result.organizationId}-${result.barberId ?? result.locationId}`
  }

  function startBooking(result: MarketplaceProfessionalResult, barber: { barberId: string; displayName: string }) {
    // A specific professional, chosen deliberately — which is exactly what
    // `any_available: false` means in this event's contract.
    analytics.track('booking_barber_selected', {
      properties: { any_available: false },
      context: { organizationId: result.organizationId, barberId: barber.barberId },
    })
    setBookingTarget({
      organizationSlug: result.organizationSlug,
      organizationName: result.organizationName,
      organizationId: result.organizationId,
      locationId: result.locationId,
      timeZone: result.timezone,
      currency: currencies[result.organizationId],
      barberId: barber.barberId,
      barberDisplayName: barber.displayName,
    })
  }

  const list = (
    <ul className="flex flex-col gap-3">
      {results.map((result, index) => (
        <li key={keyOf(result)} id={`marketplace-result-${keyOf(result)}`}>
          <MarketplaceCard
            result={result}
            currency={currencies[result.organizationId]}
            expanded={expandedId === keyOf(result)}
            onToggle={() => setExpandedId(expandedId === keyOf(result) ? null : keyOf(result))}
            onSelectBarber={(barber) => startBooking(result, barber)}
            onOpenProfile={() => onOpenResult?.(result, index)}
          />
        </li>
      ))}
    </ul>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<ResultsMode>
          options={[
            { value: 'list', label: t('mode.list'), icon: <List className="h-3.5 w-3.5" /> },
            { value: 'map', label: t('mode.map'), icon: <MapIcon className="h-3.5 w-3.5" /> },
          ]}
          value={mode}
          onChange={onModeChange}
          ariaLabel={t('mode.label')}
          size="sm"
        />

        {/*
          A native <select>. A custom listbox here would owe the user roving
          focus, type-ahead and a mobile treatment that does not fight the
          platform picker — and would buy nothing, because the options are five
          words each. The label is visually hidden rather than absent.
        */}
        <label className="flex items-center gap-2 text-caption text-ink-500">
          <span className="sr-only sm:not-sr-only">{t('sort.label')}</span>
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as MarketplaceSort)}
            aria-label={t('sort.label')}
            className="min-h-[--fu-control-md] rounded-lg border border-border bg-paper-0 px-3 text-sm text-ink-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            {MARKETPLACE_SORTS.map((option) => (
              <option key={option} value={option}>
                {t(`sort.${option}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      ) : mode === 'map' ? (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <Suspense fallback={<Skeleton className="h-[26rem] w-full rounded-2xl sm:h-[32rem]" />}>
            <ResultsMap
              results={results}
              onSelect={(result) => {
                // Selecting a pin expands its row. On a phone the list is
                // below the map, so this also scrolls it into view — the pin
                // and the row are the same object and should behave like it.
                setExpandedId(keyOf(result))
                document
                  .getElementById(`marketplace-result-${keyOf(result)}`)
                  ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
              }}
              className="lg:sticky lg:top-20"
            />
          </Suspense>
          <div id="marketplace-map-list">{list}</div>
        </div>
      ) : (
        list
      )}

      <InlineBookingSheet
        target={bookingTarget}
        onOpenChange={(open) => !open && setBookingTarget(null)}
        onBooked={() => setExpandedId(null)}
      />
    </div>
  )
}
