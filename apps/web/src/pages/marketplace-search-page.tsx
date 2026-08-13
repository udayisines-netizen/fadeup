import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SearchX } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Switch } from '@/components/ui/switch'
import { TextField } from '@/components/ui/text-field'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useSearchPublicProfessionals } from '@/lib/queries/marketplace'
import { ProfessionalResultCard } from '@/components/marketplace/professional-result-card'
import { MarketplaceSearchForm, type MarketplaceSearchValues } from '@/components/marketplace/search-form'

type EntityFilter = 'all' | 'shop' | 'barber'

/**
 * "/search" — marketplace results. Search state lives in the URL (shareable
 * links, correct back/forward — spec section 69). Filters (service, open
 * now, shop-vs-barber) are real query params sent to
 * search_public_professionals — server-side, not a client-side re-filter of
 * an already-fetched page — so a filtered "no results" state is honest
 * about what the database actually has, not just what happened to load.
 */
export function MarketplaceSearchPage() {
  const { t } = useTranslation('marketplace')
  const [searchParams, setSearchParams] = useSearchParams()

  const query = searchParams.get('q') ?? ''
  const city = searchParams.get('city') ?? ''
  const latParam = searchParams.get('lat')
  const lngParam = searchParams.get('lng')
  const latitude = latParam ? Number(latParam) : null
  const longitude = lngParam ? Number(lngParam) : null
  const serviceQuery = searchParams.get('service') ?? ''
  const openNowOnly = searchParams.get('openNow') === '1'
  const entityFilter = (searchParams.get('type') as EntityFilter | null) ?? 'all'

  const hasActiveFilters = Boolean(serviceQuery) || openNowOnly || entityFilter !== 'all'

  const resultsQuery = useSearchPublicProfessionals({
    query: query || null,
    city: city || null,
    latitude,
    longitude,
    radiusKm: latitude != null ? 25 : null,
    serviceQuery: serviceQuery || null,
    openNowOnly,
    entityType: entityFilter === 'all' ? null : entityFilter,
  })

  const locationLabel = city || (latitude != null ? t('searchForm.currentLocation') : '')

  useDocumentMeta({
    title: locationLabel ? t('meta.searchTitleWithLocation', { location: locationLabel }) : t('meta.searchTitle'),
    description: t('meta.searchDescription'),
  })

  const results = useMemo(() => resultsQuery.data ?? [], [resultsQuery.data])

  function updateParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams)
    mutate(params)
    setSearchParams(params)
  }

  function handleRefine(values: MarketplaceSearchValues) {
    const params = new URLSearchParams()
    if (values.query) params.set('q', values.query)
    if (values.city) params.set('city', values.city)
    if (values.latitude != null && values.longitude != null) {
      params.set('lat', values.latitude.toString())
      params.set('lng', values.longitude.toString())
    }
    // Filters are independent of the what/where search — preserve them.
    if (serviceQuery) params.set('service', serviceQuery)
    if (openNowOnly) params.set('openNow', '1')
    if (entityFilter !== 'all') params.set('type', entityFilter)
    setSearchParams(params)
  }

  function handleClearFilters() {
    updateParams((params) => {
      params.delete('service')
      params.delete('openNow')
      params.delete('type')
    })
  }

  return (
    <main>
      <Container size="lg" className="py-8 sm:py-10">
        <div className="rounded-xl border border-border bg-paper-0 p-4 sm:p-5">
          <MarketplaceSearchForm compact initialValues={{ query, city, latitude, longitude }} onSubmit={handleRefine} />
        </div>

        <div className="mt-8 flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-ink-950">
                {locationLabel ? t('results.headingWithLocation', { location: locationLabel }) : t('results.headingGeneric')}
              </h1>
              {resultsQuery.isSuccess ? (
                <p className="text-sm text-ink-500">{t('results.resultCount', { count: results.length })}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('results.filters.typeGroupLabel')}>
              {(['all', 'shop', 'barber'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={entityFilter === option}
                  onClick={() => updateParams((params) => (option === 'all' ? params.delete('type') : params.set('type', option)))}
                  className={
                    entityFilter === option
                      ? 'rounded-full bg-accent-700 px-3 py-1 text-sm font-medium text-on-accent'
                      : 'rounded-full border border-border-strong px-3 py-1 text-sm text-ink-700 hover:bg-paper-100'
                  }
                >
                  {t(`results.filters.type${option === 'all' ? 'All' : option === 'shop' ? 'Shops' : 'Barbers'}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-paper-0 p-3 sm:flex-row sm:items-end sm:gap-4">
            <TextField
              label={t('results.filters.serviceLabel')}
              placeholder={t('results.filters.servicePlaceholder')}
              value={serviceQuery}
              onChange={(event) => updateParams((params) => (event.target.value ? params.set('service', event.target.value) : params.delete('service')))}
              className="flex-1"
            />
            <Switch
              label={t('results.filters.openNowLabel')}
              checked={openNowOnly}
              onChange={(event) => updateParams((params) => (event.target.checked ? params.set('openNow', '1') : params.delete('openNow')))}
              className="sm:w-auto"
            />
          </div>
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
          ) : results.length === 0 ? (
            hasActiveFilters ? (
              <EmptyState
                icon={SearchX}
                title={t('results.emptyTitle')}
                description={t('results.emptyDescription')}
                action={
                  <button type="button" onClick={handleClearFilters} className="text-sm font-medium text-accent-700 hover:text-accent-800">
                    {t('results.clearFilters')}
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={SearchX}
                title={t('results.emptyNoneAtAllTitle')}
                description={t('results.emptyNoneAtAllDescription')}
              />
            )
          ) : (
            results.map((result) => (
              <ProfessionalResultCard key={`${result.entityType}-${result.organizationId}-${result.barberId ?? result.locationId}`} result={result} />
            ))
          )}
        </div>
      </Container>
    </main>
  )
}
