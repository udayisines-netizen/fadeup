import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SearchX } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Switch } from '@/components/ui/switch'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useSearchPublicOrganizations } from '@/lib/queries/marketplace'
import { MarketplaceResultCard } from '@/components/marketplace/result-card'
import { MarketplaceSearchForm, type MarketplaceSearchValues } from '@/components/marketplace/search-form'

/**
 * "/search" — marketplace results. Search state lives in the URL (shareable
 * links, correct back/forward — spec section 69). "Open now" is filtered
 * client-side over the fetched page for this first version — result sets
 * per city are small; move server-side (extend search_public_organizations
 * with p_open_now) if that stops being true.
 */
export function MarketplaceSearchPage() {
  const { t } = useTranslation('marketplace')
  const [searchParams, setSearchParams] = useSearchParams()
  const [openNowOnly, setOpenNowOnly] = useState(false)

  const query = searchParams.get('q') ?? ''
  const city = searchParams.get('city') ?? ''
  const latParam = searchParams.get('lat')
  const lngParam = searchParams.get('lng')
  const latitude = latParam ? Number(latParam) : null
  const longitude = lngParam ? Number(lngParam) : null

  const resultsQuery = useSearchPublicOrganizations({
    query: query || null,
    city: city || null,
    latitude,
    longitude,
    radiusKm: latitude != null ? 25 : null,
  })

  const locationLabel = city || (latitude != null ? t('searchForm.currentLocation') : '')

  useDocumentMeta({
    title: locationLabel ? t('meta.searchTitleWithLocation', { location: locationLabel }) : t('meta.searchTitle'),
    description: t('meta.searchDescription'),
  })

  const allResults = useMemo(() => resultsQuery.data ?? [], [resultsQuery.data])
  const visibleResults = useMemo(
    () => (openNowOnly ? allResults.filter((result) => result.isOpenNow) : allResults),
    [allResults, openNowOnly],
  )

  function handleRefine(values: MarketplaceSearchValues) {
    const params = new URLSearchParams()
    if (values.query) params.set('q', values.query)
    if (values.city) params.set('city', values.city)
    if (values.latitude != null && values.longitude != null) {
      params.set('lat', values.latitude.toString())
      params.set('lng', values.longitude.toString())
    }
    setSearchParams(params)
  }

  return (
    <main>
      <Container size="lg" className="py-8 sm:py-10">
        <div className="rounded-xl border border-border bg-paper-0 p-4 sm:p-5">
          <MarketplaceSearchForm compact initialValues={{ query, city, latitude, longitude }} onSubmit={handleRefine} />
        </div>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink-950">
              {locationLabel ? t('results.headingWithLocation', { location: locationLabel }) : t('results.headingGeneric')}
            </h1>
            {resultsQuery.isSuccess ? (
              <p className="text-sm text-ink-500">{t('results.resultCount', { count: visibleResults.length })}</p>
            ) : null}
          </div>

          <Switch
            label={t('results.filters.openNowLabel')}
            checked={openNowOnly}
            onChange={(event) => setOpenNowOnly(event.target.checked)}
            className="sm:w-auto"
          />
        </div>

        <div className="mt-6 flex flex-col gap-3">
          {resultsQuery.isPending ? (
            <>
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </>
          ) : resultsQuery.isError ? (
            <ErrorState title={t('results.errorTitle')} description={resultsQuery.error.message} />
          ) : allResults.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t('results.emptyNoneAtAllTitle')}
              description={t('results.emptyNoneAtAllDescription')}
            />
          ) : visibleResults.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t('results.emptyTitle')}
              description={t('results.emptyDescription')}
              action={
                <button
                  type="button"
                  onClick={() => setOpenNowOnly(false)}
                  className="text-sm font-medium text-accent-700 hover:text-accent-800"
                >
                  {t('results.clearFilters')}
                </button>
              }
            />
          ) : (
            visibleResults.map((result) => <MarketplaceResultCard key={`${result.organizationId}-${result.locationId}`} result={result} />)
          )}
        </div>
      </Container>
    </main>
  )
}
