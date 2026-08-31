/**
 * FadeUp V3 — the public Landing.
 *
 * The brand's primary sales asset (FADEUP_VISUAL_V3_DIRECTION.md §13): an
 * editorial page that sells the haircut AND the certainty. Every operational
 * fact on it is real (live `search_public_professionals` rows, real prices,
 * real queue counts); every illustrative object wears a visible "example"
 * chip so a demonstration can never be mistaken for a marketplace record —
 * the truth rules in FADEUP_V3_PRODUCT_TRUTHS.md §N.
 *
 * Reuse ledger (nonvisual infrastructure only, per GREENFIELD import rules):
 *   - lib/queries/marketplace (search RPC + currencies)
 *   - customer-v3/hooks/use-customer-location — REUSE_LOGIC_ONLY logic
 *     carried over from the audited R5R location resolver
 *   - lib/intl useMoney, lib/use-document-meta, i18n changeLocale
 *   - components/brand FadeUpMark (brand charter, not an R5 design decision)
 */
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { FadeUpMark } from '@/components/brand/fadeup-mark'
import {
  useSearchPublicProfessionals,
  usePublicCurrencies,
  type MarketplaceProfessionalResult,
} from '@/lib/queries/marketplace'
import { useCustomerLocation } from '@/customer-v3/hooks/use-customer-location'
import { useMoney } from '@/lib/intl/use-intl'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { changeLocale } from '@/i18n'
import { SUPPORTED_LOCALES, LOCALE_LABELS, isSupportedLocale } from '@/lib/locale'
import { V3_ROUTES, v3ShopProfilePath } from '@/customer-v3/routes'

import '@/ui-v3/ui-v3.css'
import './landing.css'

import heroWide2048 from '@/assets/marketing/home/hero-editorial-2048.avif'
import heroWide1600 from '@/assets/marketing/home/hero-editorial-1600.avif'
import heroWide1080 from '@/assets/marketing/home/hero-editorial-1080.avif'
import heroWideWebp1600 from '@/assets/marketing/home/hero-editorial-1600.webp'
import heroMobile860 from '@/assets/marketing/home/hero-editorial-mobile-860.avif'
import heroMobile640 from '@/assets/marketing/home/hero-editorial-mobile-640.avif'
import heroMobileWebp640 from '@/assets/marketing/home/hero-editorial-mobile-640.webp'
import cultureCrop from '@/assets/marketing/home/hero-editorial-mobile-860.avif'

/** How many real results the landing asks for: 1 hero proof + 3 discovery. */
const PROOF_LIMIT = 4

export function LandingPage() {
  const { t } = useTranslation('v3')
  /* noIndex while this is a preview namespace; drops away at promotion. */
  useDocumentMeta({
    title: t('landing.meta.title'),
    description: t('landing.meta.description'),
    noIndex: true,
  })

  const location = useCustomerLocation()

  const search = useSearchPublicProfessionals(
    {
      country: location.isAnywhere ? null : location.countryCode,
      latitude: location.coordinates?.latitude ?? null,
      longitude: location.coordinates?.longitude ?? null,
      sort: location.coordinates ? 'nearest' : 'recommended',
      entityType: 'shop',
      limit: PROOF_LIMIT,
    },
    { keepPreviousData: true },
  )

  const results = search.data ?? []
  const heroResult = results[0] ?? null
  const discoveryResults = results.slice(0, 3)

  return (
    <div className="v3l-page" data-fu-v3>
      <LandingHeader />
      <Hero heroResult={heroResult} />
      <DiscoverySection results={discoveryResults} isError={search.isError} />
      <CultureSection />
      <BookingSection />
      <IndependentSection />
      <QueueSection />
      <PassportSection />
      <FollowSection />
      <ProSection />
      <LandingFooter />
    </div>
  )
}

/* ========================================================================== */

function LandingHeader() {
  const { t, i18n } = useTranslation('v3')

  return (
    <header className="v3l-header">
      <div className="v3l-measure v3l-header-inner">
        <Link to={V3_ROUTES.landing} className="v3l-brand">
          <FadeUpMark />
          FadeUp
        </Link>
        <nav className="v3l-header-nav" aria-label={t('landing.nav.label')}>
          <select
            className="v3l-lang"
            aria-label={t('landing.nav.language')}
            value={i18n.language}
            onChange={(event) => {
              const next = event.target.value
              if (isSupportedLocale(next)) void changeLocale(next)
            }}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </option>
            ))}
          </select>
          <a className="v3l-header-link v3l-header-link--pro" href="/pro/login">
            {t('landing.nav.pro')}
          </a>
          <a className="v3l-header-link" href="/login">
            {t('landing.nav.signIn')}
          </a>
        </nav>
      </div>
    </header>
  )
}

/* ========================================================================== */

function Hero({ heroResult }: { heroResult: MarketplaceProfessionalResult | null }) {
  const { t } = useTranslation('v3')

  return (
    <section className="v3l-hero" aria-labelledby="v3l-hero-title">
      <div className="v3l-hero-media">
        <picture>
          <source
            media="(max-width: 48rem)"
            type="image/avif"
            srcSet={`${heroMobile640} 640w, ${heroMobile860} 860w`}
          />
          <source media="(max-width: 48rem)" type="image/webp" srcSet={`${heroMobileWebp640} 640w`} />
          <source
            type="image/avif"
            srcSet={`${heroWide1080} 1080w, ${heroWide1600} 1600w, ${heroWide2048} 2048w`}
          />
          <img
            src={heroWideWebp1600}
            alt=""
            fetchPriority="high"
            decoding="async"
            width={2048}
            height={1152}
          />
        </picture>
      </div>

      <div className="v3l-measure v3l-hero-inner">
        <div className="v3l-hero-copy">
          <h1 id="v3l-hero-title" className="v3-display">
            {t('landing.hero.title')}
          </h1>
          <p className="v3l-hero-sub">{t('landing.hero.sub')}</p>
          <HeroSearch />
          <ul className="v3l-hero-facts">
            <li>{t('landing.hero.factPrices')}</li>
            <li>{t('landing.hero.factAvailability')}</li>
            <li>{t('landing.hero.factQueues')}</li>
          </ul>
        </div>
      </div>

      {heroResult ? (
        <div className="v3l-hero-proof v3-enter">
          <ResultCard result={heroResult} />
        </div>
      ) : null}
    </section>
  )
}

function HeroSearch() {
  const { t } = useTranslation('v3')
  const navigate = useNavigate()
  const [what, setWhat] = useState('')
  const [where, setWhere] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const params = new URLSearchParams()
    if (what.trim()) params.set('q', what.trim())
    if (where.trim()) params.set('city', where.trim())
    const query = params.toString()
    navigate(`${V3_ROUTES.marketplace}${query ? `?${query}` : ''}`)
  }

  return (
    <form className="v3l-search" role="search" onSubmit={submit}>
      <div className="v3l-search-bar">
        <div className="v3l-search-field">
          <label htmlFor="v3l-search-what">{t('landing.search.whatLabel')}</label>
          <input
            id="v3l-search-what"
            type="search"
            placeholder={t('landing.search.whatPlaceholder')}
            value={what}
            onChange={(event) => setWhat(event.target.value)}
          />
        </div>
        <div className="v3l-search-field">
          <label htmlFor="v3l-search-where">{t('landing.search.whereLabel')}</label>
          <input
            id="v3l-search-where"
            type="search"
            placeholder={t('landing.search.wherePlaceholder')}
            value={where}
            onChange={(event) => setWhere(event.target.value)}
          />
        </div>
        <button type="submit" className="v3-btn v3-btn--book v3-press v3l-search-submit">
          {t('landing.search.cta')}
        </button>
      </div>
    </form>
  )
}

/* ==========================================================================
   The real marketplace result grammar. Every line is data-gated: a null
   renders nothing (no default open state, no placeholder price, no fake
   photo frame). Queue count renders only when > 0.
   ========================================================================== */

function ResultCard({ result }: { result: MarketplaceProfessionalResult }) {
  const { t } = useTranslation('v3')
  const money = useMoney()
  const currencies = usePublicCurrencies([result.organizationId])
  const currency = currencies[result.organizationId] ?? null

  const supplyLabel =
    result.marketplaceSupplyType === 'independent'
      ? t('landing.result.independent')
      : result.marketplaceSupplyType === 'barbershop'
        ? t('landing.result.barbershop')
        : null

  const price =
    result.startingPriceCents != null && currency
      ? money(result.startingPriceCents, currency)
      : null

  return (
    <Link
      to={v3ShopProfilePath(result.organizationSlug, result.locationId)}
      className="v3l-result v3-float v3-press"
    >
      <div className="v3l-result-top">
        <span className="v3l-result-name">{result.locationName}</span>
        {result.isOpenNow === true ? (
          <span className="v3l-result-live">
            <span className="v3-live-dot" aria-hidden="true" />
            {t('landing.result.open')}
          </span>
        ) : null}
      </div>
      <p className="v3l-result-meta">
        {supplyLabel ? <span>{supplyLabel}</span> : null}
        {result.city ? <span>{result.city}</span> : null}
        {result.distanceKm != null ? (
          <span className="v3-num">{t('landing.result.distance', { km: result.distanceKm.toFixed(1) })}</span>
        ) : null}
      </p>
      <div className="v3l-result-ops">
        {price ? (
          <span className="v3l-result-price v3-num">{t('landing.result.from', { price })}</span>
        ) : (
          <span />
        )}
        {result.queueWaitingCount > 0 ? (
          <span className="v3l-result-live">
            {t('landing.result.waiting', { count: result.queueWaitingCount })}
          </span>
        ) : null}
      </div>
      <span className="v3-btn v3-btn--book">{t('landing.result.book')}</span>
    </Link>
  )
}

/* ==========================================================================
   DISCOVERY — real rows beside an honest coordinate field. The field plots
   the REAL coordinates of the listed results normalized onto an abstract
   canvas — no tiles, no fake pins; with no plottable result it collapses.
   ========================================================================== */

function DiscoverySection({
  results,
  isError,
}: {
  results: MarketplaceProfessionalResult[]
  isError: boolean
}) {
  const { t } = useTranslation('v3')

  const plottable = results.filter(
    (r): r is MarketplaceProfessionalResult & { latitude: number; longitude: number } =>
      r.latitude != null && r.longitude != null,
  )

  if (results.length === 0 && !isError) return null
  if (results.length === 0) return null

  return (
    <section className="v3l-section v3-bg-fog" aria-labelledby="v3l-discovery-title">
      <div className="v3l-measure">
        <p className="v3l-kicker-row v3-kicker v3-kicker--green">{t('landing.discovery.kicker')}</p>
        <h2 id="v3l-discovery-title" className="v3-display-s">
          {t('landing.discovery.title')}
        </h2>
        <div className="v3l-discovery-grid" data-has-field={plottable.length > 0}>
          <div className="v3l-discovery-list v3-rows">
            {results.map((result) => (
              <ResultCard key={result.locationId} result={result} />
            ))}
            <Link
              to={V3_ROUTES.marketplace}
              className="v3-btn v3-btn--quiet v3-press"
              style={{ marginBlockStart: '1.25rem', justifySelf: 'start' }}
            >
              {t('landing.discovery.viewAll')}
            </Link>
          </div>
          {plottable.length > 0 ? <CoordinateField results={plottable} /> : null}
        </div>
      </div>
    </section>
  )
}

function CoordinateField({
  results,
}: {
  results: Array<MarketplaceProfessionalResult & { latitude: number; longitude: number }>
}) {
  const { t } = useTranslation('v3')
  const money = useMoney()
  const currencies = usePublicCurrencies(results.map((r) => r.organizationId))

  /* Normalize real coordinates into the field with padded extents; a single
     point sits at a composed off-center position rather than dead center. */
  const positions = useMemo(() => {
    const lats = results.map((r) => r.latitude)
    const lngs = results.map((r) => r.longitude)
    const latSpan = Math.max(Math.max(...lats) - Math.min(...lats), 0.02)
    const lngSpan = Math.max(Math.max(...lngs) - Math.min(...lngs), 0.02)
    const latMin = Math.min(...lats) - latSpan * 0.35
    const lngMin = Math.min(...lngs) - lngSpan * 0.35
    return results.map((r) => ({
      key: r.locationId,
      x: ((r.longitude - lngMin) / (lngSpan * 1.7)) * 100,
      y: 100 - ((r.latitude - latMin) / (latSpan * 1.7)) * 100,
      label:
        r.startingPriceCents != null && currencies[r.organizationId]
          ? money(r.startingPriceCents, currencies[r.organizationId], { trimWholeAmounts: true })
          : r.locationName,
    }))
  }, [results, currencies, money])

  return (
    <div className="v3l-field" role="img" aria-label={t('landing.discovery.fieldLabel')}>
      <div className="v3l-field-grid" aria-hidden="true" />
      {positions.map((pin) => (
        <span
          key={pin.key}
          className="v3l-field-pin"
          style={{ insetInlineStart: `${pin.x}%`, insetBlockStart: `${pin.y}%` }}
        >
          {pin.label}
        </span>
      ))}
      <span className="v3l-field-note">{t('landing.discovery.fieldNote')}</span>
    </div>
  )
}

/* ========================================================================== */

function CultureSection() {
  const { t } = useTranslation('v3')

  return (
    <section className="v3l-section v3-bg-pearl v3-grain" aria-labelledby="v3l-culture-title">
      <div className="v3l-measure v3l-culture-grid">
        <div className="v3l-culture-copy">
          <p className="v3l-kicker-row v3-kicker v3-kicker--green">{t('landing.culture.kicker')}</p>
          <h2 id="v3l-culture-title" className="v3-display-s">
            {t('landing.culture.title')}
          </h2>
          <p className="v3l-body-lede">{t('landing.culture.body')}</p>
        </div>
        <div className="v3l-culture-media">
          <img src={cultureCrop} alt={t('landing.culture.imageAlt')} loading="lazy" decoding="async" width={922} height={1152} />
        </div>
      </div>
    </section>
  )
}

/* ==========================================================================
   BOOKING — the flow as a product demonstration, in the real V3 grammar,
   visibly labeled as an example.
   ========================================================================== */

function DemoChip() {
  const { t } = useTranslation('v3')
  return <span className="v3l-demo-chip">{t('landing.demo')}</span>
}

function BookingSection() {
  const { t } = useTranslation('v3')

  return (
    <section className="v3l-section v3-bg-canvas" aria-labelledby="v3l-booking-title">
      <div className="v3l-measure">
        <p className="v3l-kicker-row v3-kicker v3-kicker--green">{t('landing.booking.kicker')}</p>
        <h2 id="v3l-booking-title" className="v3-display-s">
          {t('landing.booking.title')}
        </h2>
        <p className="v3l-body-lede" style={{ marginBlockStart: '1.25rem' }}>
          {t('landing.booking.body')}
        </p>

        <div className="v3l-steps">
          <div className="v3l-step">
            <div className="v3l-step-head">
              <span className="v3l-step-title">{t('landing.booking.stepService')}</span>
              <DemoChip />
            </div>
            <div className="v3l-service-row" data-selected="true">
              <span>{t('landing.booking.demoService')}</span>
              <span className="v3-num">{t('landing.booking.demoServiceMeta')}</span>
            </div>
            <div className="v3l-service-row">
              <span>{t('landing.booking.demoService2')}</span>
              <span className="v3-num">{t('landing.booking.demoService2Meta')}</span>
            </div>
          </div>

          <div className="v3l-step">
            <div className="v3l-step-head">
              <span className="v3l-step-title">{t('landing.booking.stepTime')}</span>
              <DemoChip />
            </div>
            <div className="v3l-slot-group">
              <span className="v3l-slot-label">{t('landing.booking.morning')}</span>
              <div className="v3l-slots">
                <span className="v3l-slot">09:30</span>
                <span className="v3l-slot">10:15</span>
              </div>
            </div>
            <div className="v3l-slot-group">
              <span className="v3l-slot-label">{t('landing.booking.afternoon')}</span>
              <div className="v3l-slots">
                <span className="v3l-slot">14:00</span>
                <span className="v3l-slot" data-selected="true">
                  17:30
                </span>
              </div>
            </div>
          </div>

          <div className="v3l-step">
            <div className="v3l-step-head">
              <span className="v3l-step-title">{t('landing.booking.stepConfirm')}</span>
              <DemoChip />
            </div>
            <div className="v3l-confirm">
              <span className="v3l-confirm-check">✓ {t('landing.booking.confirmed')}</span>
              <span>{t('landing.booking.demoSummary')}</span>
            </div>
            <span className="v3-btn v3-btn--book" aria-hidden="true">
              {t('landing.booking.confirmCta')}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ========================================================================== */

function IndependentSection() {
  const { t } = useTranslation('v3')

  return (
    <section className="v3l-section v3-bg-atmosphere v3-grain" aria-labelledby="v3l-indep-title">
      <div className="v3l-measure v3l-indep-grid">
        <div>
          <p className="v3l-kicker-row v3-kicker v3-kicker--green">{t('landing.independent.kicker')}</p>
          <h2 id="v3l-indep-title" className="v3-display-s">
            {t('landing.independent.title')}
          </h2>
          <p className="v3l-body-lede" style={{ marginBlockStart: '1.25rem' }}>
            {t('landing.independent.body')}
          </p>
        </div>
        <div className="v3l-indep-card v3-float">
          <div className="v3l-step-head">
            <span className="v3l-identity">
              <span className="v3l-avatar" aria-hidden="true">
                <PersonGlyph />
              </span>
              <span>
                <span className="v3l-identity-name">{t('landing.independent.demoName')}</span>
                <br />
                <span className="v3l-identity-sub">{t('landing.independent.demoSub')}</span>
              </span>
            </span>
            <DemoChip />
          </div>
          <div className="v3l-cta-pair">
            <span className="v3-btn v3-btn--quiet" aria-hidden="true">
              {t('landing.follow.follow')}
            </span>
            <span className="v3-btn v3-btn--book" aria-hidden="true">
              {t('landing.result.book')}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.6-3.2 4-4.5 7-4.5s5.4 1.3 7 4.5" strokeLinecap="round" />
    </svg>
  )
}

/* ========================================================================== */

function QueueSection() {
  const { t } = useTranslation('v3')

  return (
    <section className="v3l-section v3-bg-spotlight v3-on-dark" aria-labelledby="v3l-queue-title">
      <div className="v3l-measure v3l-queue-grid">
        <div>
          <p className="v3l-kicker-row v3-kicker">{t('landing.queue.kicker')}</p>
          <h2 id="v3l-queue-title" className="v3-display-s">
            {t('landing.queue.title')}
          </h2>
          <p className="v3l-body-lede" style={{ marginBlockStart: '1.25rem', color: 'var(--v3-on-graphite-dim)' }}>
            {t('landing.queue.body')}
          </p>
        </div>
        <div className="v3l-ticket">
          <div className="v3l-step-head" style={{ justifyContent: 'center' }}>
            <DemoChip />
          </div>
          <span className="v3-kicker">{t('landing.queue.positionLabel')}</span>
          <span className="v3-num--display v3l-ticket-position">03</span>
          <span className="v3l-ticket-ahead">{t('landing.queue.ahead', { count: 2 })}</span>
          <hr className="v3l-ticket-rule" />
          <div className="v3l-ticket-venue">
            <strong>{t('landing.queue.demoVenue')}</strong>
            <span>{t('landing.queue.demoBarber')}</span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ========================================================================== */

function PassportSection() {
  const { t } = useTranslation('v3')

  return (
    <section className="v3l-section v3-bg-reveal v3-on-dark" aria-labelledby="v3l-passport-title">
      <div className="v3l-measure v3l-passport-grid">
        <div className="v3l-pass">
          <div className="v3l-pass-head">
            <span>{t('landing.passport.cardLabel')}</span>
            <DemoChip />
          </div>
          <span className="v3l-pass-name">{t('landing.passport.demoName')}</span>
          <div className="v3l-pass-rows">
            <div className="v3l-pass-row">
              <span>{t('landing.passport.demoCut')}</span>
            </div>
            <div className="v3l-pass-row">
              <span>{t('landing.passport.demoPreference')}</span>
            </div>
          </div>
          <span className="v3l-pass-qr" aria-hidden="true" />
        </div>
        <div>
          <p className="v3l-kicker-row v3-kicker">{t('landing.passport.kicker')}</p>
          <h2 id="v3l-passport-title" className="v3-display-s">
            {t('landing.passport.title')}
          </h2>
          <p className="v3l-body-lede" style={{ marginBlockStart: '1.25rem', color: 'var(--v3-on-graphite-dim)' }}>
            {t('landing.passport.body')}
          </p>
        </div>
      </div>
    </section>
  )
}

/* ========================================================================== */

function FollowSection() {
  const { t } = useTranslation('v3')

  return (
    <section className="v3l-section v3-bg-canvas" aria-labelledby="v3l-follow-title">
      <div className="v3l-measure v3l-follow-grid">
        <div>
          <p className="v3l-kicker-row v3-kicker v3-kicker--green">{t('landing.follow.kicker')}</p>
          <h2 id="v3l-follow-title" className="v3-display-s">
            {t('landing.follow.title')}
          </h2>
          <p className="v3l-body-lede" style={{ marginBlockStart: '1.25rem' }}>
            {t('landing.follow.body')}
          </p>
        </div>
        <div className="v3l-indep-card v3-float">
          <div className="v3l-step-head">
            <span className="v3l-identity">
              <span className="v3l-avatar" aria-hidden="true">
                <PersonGlyph />
              </span>
              <span>
                <span className="v3l-identity-name">{t('landing.follow.demoName')}</span>
                <br />
                <span className="v3l-identity-sub">{t('landing.follow.demoSub')}</span>
              </span>
            </span>
            <DemoChip />
          </div>
          <div className="v3l-cta-pair">
            <span className="v3-btn v3-btn--quiet" aria-hidden="true">
              {t('landing.follow.following')}
            </span>
            <span className="v3-btn v3-btn--book" aria-hidden="true">
              {t('landing.result.book')}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ========================================================================== */

function ProSection() {
  const { t } = useTranslation('v3')

  const outcomes: ReactNode[] = [
    t('landing.pro.outcome1'),
    t('landing.pro.outcome2'),
    t('landing.pro.outcome3'),
    t('landing.pro.outcome4'),
  ]

  return (
    <section className="v3l-section v3-bg-atmosphere v3-grain" aria-labelledby="v3l-pro-title">
      <div className="v3l-measure v3l-pro-grid">
        <div>
          <p className="v3l-kicker-row v3-kicker v3-kicker--green">{t('landing.pro.kicker')}</p>
          <h2 id="v3l-pro-title" className="v3-display-s">
            {t('landing.pro.title')}
          </h2>
          <ul className="v3l-pro-outcomes">
            {outcomes.map((outcome, index) => (
              <li key={index}>{outcome}</li>
            ))}
          </ul>
          <a className="v3-btn v3-btn--primary-ink v3-press" href="/pro/login">
            {t('landing.pro.cta')}
          </a>
        </div>
        {/* Product frame in the real V3 grammar; demonstrative content until
            the Phase V7 pro surfaces exist to be framed live. */}
        <div className="v3l-pro-frame">
          <div className="v3l-pro-frame-bar">
            <span>{t('landing.pro.frameTitle')}</span>
            <DemoChip />
          </div>
          <div className="v3l-pro-frame-list">
            <div className="v3l-pro-row">
              <time>10:30</time>
              <span>{t('landing.pro.frameRow1')}</span>
              <span data-status="now">{t('landing.pro.frameNow')}</span>
            </div>
            <div className="v3l-pro-row">
              <time>11:15</time>
              <span>{t('landing.pro.frameRow2')}</span>
              <span />
            </div>
            <div className="v3l-pro-row">
              <time>12:00</time>
              <span>{t('landing.pro.frameRow3')}</span>
              <span />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ========================================================================== */

function LandingFooter() {
  const { t } = useTranslation('v3')

  return (
    <footer className="v3l-footer v3-bg-canvas">
      <div className="v3l-measure v3l-footer-inner">
        <Link to={V3_ROUTES.landing} className="v3l-brand">
          <FadeUpMark />
          FadeUp
        </Link>
        <nav className="v3l-footer-nav" aria-label={t('landing.footer.label')}>
          <Link to={V3_ROUTES.marketplace}>{t('landing.footer.marketplace')}</Link>
          <a href="/pro/login">{t('landing.nav.pro')}</a>
          <a href="/login">{t('landing.nav.signIn')}</a>
        </nav>
        <span className="v3-meta">{t('landing.footer.tagline')}</span>
      </div>
    </footer>
  )
}
