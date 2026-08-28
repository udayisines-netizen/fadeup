import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { DiscoverySearch } from '@/components/customer/discovery-search'
import { PageHeader } from '@/components/ui/page-header'
import { useGeoSuggestion } from '@/lib/intl/geo'
import { useDocumentMeta } from '@/lib/use-document-meta'

/**
 * `/app/customer/search` — the marketplace, for a signed-in customer.
 *
 * A separate DESTINATION from Discover, and still the same SEARCH: the whole
 * screen is `DiscoverySearch`, shared verbatim with the public `/search`. Two
 * implementations of one search was the largest source of drift in V1, and
 * splitting the tab back out must not reintroduce it — so what differs between
 * the three surfaces is the shell and the analytics surface, never the search.
 *
 * Search state stays in the URL. That is what makes a result list shareable,
 * makes Back mean what a customer means by Back, and — the reason it matters
 * for R5 specifically — lets the list/map mode and the active filters survive
 * a mode switch without anything having to hold them in memory.
 */
export function CustomerSearchPage() {
  const { t } = useTranslation('marketplace')
  const [searchParams] = useSearchParams()
  const geo = useGeoSuggestion()

  const city = searchParams.get('city') ?? ''
  const hasCoords = searchParams.has('lat') && searchParams.has('lng')
  const locationLabel = city || (hasCoords ? t('searchForm.currentLocation') : '')

  useDocumentMeta({
    title: locationLabel ? t('meta.searchTitleWithLocation', { location: locationLabel }) : t('meta.searchTitle'),
    description: t('meta.searchDescription'),
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('hero.title')} subtitle={t('hero.subtitle')} />
      <DiscoverySearch suggestedCountry={geo.countryCode} analyticsSurface="marketplace" />
    </div>
  )
}
