import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { DiscoverySearch } from '@/components/customer/discovery-search'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useGeoSuggestion } from '@/lib/intl/geo'

/**
 * "/search" — the public marketplace.
 *
 * The search itself is `DiscoverySearch`, shared verbatim with the signed-in
 * customer home. Two implementations of the same search was the single
 * largest source of drift in V1: filters, empty states and card design were
 * subtly different depending on whether you happened to be logged in.
 *
 * This page therefore owns only what is genuinely page-level — the document
 * metadata and the `<h1>`. Search state lives in the URL (shareable links,
 * correct back/forward), which is why the params are read here as well: the
 * title has to name the place the customer is actually looking at.
 */
export function MarketplaceSearchPage() {
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
    <main>
      <Container size="lg" className="flex flex-col gap-6 py-8 sm:py-10">
        <PageHeader title={t('hero.title')} subtitle={t('hero.subtitle')} />
        <DiscoverySearch suggestedCountry={geo.countryCode} headingAs="h2" />
      </Container>
    </main>
  )
}
