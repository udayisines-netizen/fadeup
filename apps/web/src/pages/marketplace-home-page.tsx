import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Radio, Scissors, Search } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { MarketplaceSearchForm, type MarketplaceSearchValues } from '@/components/marketplace/search-form'

const STEPS = [
  { icon: Search, key: 'discover' },
  { icon: Scissors, key: 'book' },
  { icon: Radio, key: 'queue' },
] as const

/**
 * "/" — the public marketplace homepage. This is the FIRST thing a visitor
 * sees; the job it does is "help someone find a barber," not pitch FadeUp
 * as software (that's /for-business — see routes/router.tsx). Search
 * submits into /search with the query encoded in the URL (shareable, see
 * spec section 69).
 */
export function MarketplaceHomePage() {
  const { t } = useTranslation('marketplace')
  const navigate = useNavigate()

  useDocumentMeta({
    title: t('meta.title'),
    description: t('meta.description'),
  })

  function handleSearch(values: MarketplaceSearchValues) {
    const params = new URLSearchParams()
    if (values.query) params.set('q', values.query)
    if (values.city) params.set('city', values.city)
    if (values.latitude != null && values.longitude != null) {
      params.set('lat', values.latitude.toString())
      params.set('lng', values.longitude.toString())
    }
    navigate(`/search?${params.toString()}`)
  }

  return (
    <main>
      <section className="border-b border-border bg-paper-50">
        <Container size="lg" className="flex flex-col items-center gap-8 py-16 text-center sm:py-24">
          <div>
            <p className="text-sm font-medium text-accent-700">{t('hero.eyebrow')}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-ink-950 sm:text-5xl">
              {t('hero.title')}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-lg text-ink-500">{t('hero.subtitle')}</p>
          </div>

          <div className="w-full max-w-2xl rounded-xl border border-border bg-paper-0 p-4 text-left shadow-sm sm:p-6">
            <MarketplaceSearchForm onSubmit={handleSearch} />
          </div>
        </Container>
      </section>

      <section>
        <Container size="lg" className="py-14 sm:py-16">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.key} className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-800">
                  {index + 1}
                </div>
                <step.icon className="h-5 w-5 text-accent-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-ink-950">{t(`steps.${step.key}.title`)}</h2>
                <p className="text-sm text-ink-500">{t(`steps.${step.key}.description`)}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </main>
  )
}
