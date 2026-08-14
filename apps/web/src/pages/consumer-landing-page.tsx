import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CalendarCheck, Clock3, MapPin, Radio, Scissors } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { HeroSearch } from '@/components/marketing/hero-search'
import { Reveal, RevealGroup, RevealItem, useDemoCycle } from '@/components/marketing/motion'
import { useSearchPublicProfessionals } from '@/lib/queries/marketplace'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { cn } from '@/lib/cn'

/**
 * "/" — the consumer entrance.
 *
 * One job: help someone find a barber. It is deliberately short, and it does
 * not explain FadeUp as software — that is what /for-business is for. The
 * search bar is the hero, the barbers shown are real, and the emotional
 * centre is Fade Passport, because "it remembers your cut" is the thing a
 * customer actually feels after the second visit.
 *
 * Editorial rather than SaaS: a display serif carries the headlines, the
 * ground is warm ivory rather than white, and there is not a single feature
 * grid on the page.
 */
export function ConsumerLandingPage() {
  const { t } = useTranslation('landing')

  useDocumentMeta({
    title: t('consumer.meta.title'),
    description: t('consumer.meta.description'),
  })

  return (
    <main>
      <HeroScene />
      <DiscoverScene />
      <BookOrQueueScene />
      <PassportScene />
      <RebookScene />
      <FinalScene />
    </main>
  )
}

/* ------------------------------------------------------------------ A1 */

function HeroScene() {
  const { t } = useTranslation('landing')

  return (
    <section className="relative overflow-hidden bg-ivory">
      {/*
        A single hairline rule under the fold rather than a gradient wash —
        the warmth comes from the ivory ground itself, not from decoration.
      */}
      <Container size="xl" className="relative py-20 sm:py-28 lg:py-36">
        <div className="max-w-4xl">
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-500">
              {t('consumer.hero.eyebrow')}
            </p>
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="mt-6 font-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.95] tracking-[-0.02em] text-ink-950">
              {t('consumer.hero.titleLead')}{' '}
              <em className="italic text-accent-700">{t('consumer.hero.titleEmphasis')}</em>
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-700">
              {t('consumer.hero.subtitle')}
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.18} className="mt-10 max-w-3xl">
          <HeroSearch />
        </Reveal>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ A2 */

/**
 * Real barbers, from the real marketplace source of truth.
 *
 * Nothing here is invented: the rows come from search_public_professionals,
 * which only ever returns organizations that opted into being listed. If no
 * shop near the visitor has published yet, the section says so honestly
 * instead of filling the space with plausible-looking strangers.
 */
function DiscoverScene() {
  const { t } = useTranslation('landing')
  const query = useSearchPublicProfessionals({ limit: 6 })
  const results = query.data ?? []

  return (
    <section className="border-t border-border bg-paper-0">
      <Container size="xl" className="py-20 sm:py-28">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <Reveal className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
              {t('consumer.discover.eyebrow')}
            </p>
            <h2 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.02] tracking-[-0.015em] text-ink-950">
              {t('consumer.discover.title')}
            </h2>
            <p className="mt-4 max-w-lg text-base text-ink-700">{t('consumer.discover.body')}</p>
          </Reveal>

          <Reveal delay={0.08}>
            <Link
              to="/search"
              className="group inline-flex min-h-11 items-center gap-2 text-sm font-medium text-ink-950 underline-offset-4 hover:underline"
            >
              {t('consumer.discover.seeAll')}
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </Reveal>
        </div>

        {query.isPending ? (
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-44 animate-pulse rounded-xl border border-border bg-paper-50" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <Reveal className="mt-12 border-t border-border pt-10">
            <p className="font-display text-2xl text-ink-950">{t('consumer.discover.emptyTitle')}</p>
            <p className="mt-2 max-w-md text-base text-ink-500">{t('consumer.discover.emptyBody')}</p>
          </Reveal>
        ) : (
          /*
            Separate bordered tiles with a real gap, not a 1px-gap grid over a
            border-coloured background. The grid trick looks precise with a
            full row and broken with one result — and one result is a genuine
            state while FadeUp opens city by city.
          */
          <RevealGroup as="ul" className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((result) => (
              <RevealItem
                as="li"
                key={`${result.entityType}-${result.barberId ?? result.locationId}`}
                className="rounded-xl border border-border bg-paper-0"
              >
                <ProfessionalTile result={result} />
              </RevealItem>
            ))}
          </RevealGroup>
        )}
      </Container>
    </section>
  )
}

type SearchResult = ReturnType<typeof useSearchPublicProfessionals>['data'] extends (infer T)[] | undefined
  ? T
  : never

/** A barber reads as a person; a shop reads as a place. Same tile, different emphasis. */
function ProfessionalTile({ result }: { result: SearchResult }) {
  const { t } = useTranslation('landing')
  const isBarber = result.entityType === 'barber'
  const name = isBarber ? (result.barberDisplayName ?? result.organizationName) : result.organizationName
  const place = [result.city, result.country].filter(Boolean).join(', ')

  return (
    <Link
      to={`/s/${result.organizationSlug}/profile`}
      className="group flex h-full flex-col justify-between gap-6 rounded-xl p-6 transition-colors hover:bg-paper-50"
    >
      <div className="flex items-start gap-4">
        <span
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            isBarber ? 'bg-accent-100 text-accent-800' : 'bg-paper-100 text-ink-700',
          )}
          aria-hidden="true"
        >
          {isBarber ? initialsOf(name) : <Scissors className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-xl leading-tight text-ink-950">{name}</p>
          <p className="mt-1 truncate text-sm text-ink-500">
            {isBarber
              ? (result.barberTitle ?? result.organizationName)
              : (result.locationName ?? t('consumer.discover.independent'))}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        {place ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{place}</span>
          </span>
        ) : (
          <span />
        )}
        <span className="inline-flex shrink-0 items-center gap-1 font-medium text-ink-950 opacity-0 transition-opacity group-hover:opacity-100">
          {t('consumer.discover.viewProfile')}
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/* ------------------------------------------------------------------ A3 */

/**
 * The one thing a customer must understand before searching: there are two
 * ways into a chair, and FadeUp shows both. Two panels, not six cards.
 */
function BookOrQueueScene() {
  const { t } = useTranslation('landing')

  return (
    <section className="border-t border-border bg-ivory-deep">
      <Container size="xl" className="py-20 sm:py-28">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
            {t('consumer.book.eyebrow')}
          </p>
          <h2 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.02] tracking-[-0.015em] text-ink-950">
            {t('consumer.book.title')}
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          <Reveal>
            <article className="flex h-full flex-col rounded-xl border border-border bg-paper-0 p-7">
              <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-500">
                <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                {t('consumer.book.appointment.label')}
              </p>
              <h3 className="mt-5 font-display text-2xl text-ink-950">{t('consumer.book.appointment.title')}</h3>
              <p className="mt-3 text-base text-ink-700">{t('consumer.book.appointment.body')}</p>
              <SlotStrip className="mt-8" />
              <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-ink-300">
                {t('consumer.demoLabel')}
              </p>
            </article>
          </Reveal>

          <Reveal delay={0.08}>
            <article className="flex h-full flex-col rounded-xl border border-border bg-paper-0 p-7">
              <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-accent-700">
                <Radio className="h-4 w-4" aria-hidden="true" />
                {t('consumer.book.queue.label')}
              </p>
              <h3 className="mt-5 font-display text-2xl text-ink-950">{t('consumer.book.queue.title')}</h3>
              <p className="mt-3 text-base text-ink-700">{t('consumer.book.queue.body')}</p>
              <QueueStrip className="mt-8" />
              <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-ink-300">
                {t('consumer.demoLabel')}
              </p>
            </article>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}

const SLOTS = ['09:30', '10:00', '10:30', '11:00'] as const

/** Illustrative slots — a picture of choosing a time, not a live availability feed. */
function SlotStrip({ className }: { className?: string }) {
  const active = useDemoCycle(SLOTS.length, 2200, 1)

  return (
    <div className={cn('mt-auto', className)}>
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        {SLOTS.map((slot, index) => (
          <span
            key={slot}
            className={cn(
              'rounded-md border px-3.5 py-2 font-mono text-sm tabular-nums transition-colors duration-500',
              index === active
                ? 'border-accent-600 bg-accent-600 text-on-accent'
                : 'border-border-strong bg-paper-0 text-ink-700',
            )}
          >
            {slot}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * The queue advancing. The number changing IS the explanation — it is what
 * the product does, so the animation carries the meaning rather than
 * decorating it.
 */
function QueueStrip({ className }: { className?: string }) {
  const { t } = useTranslation('landing')
  const step = useDemoCycle(3, 2400, 0)
  const positions = [3, 2, 1] as const
  const etas = [22, 14, 0] as const
  const position = positions[step]
  const eta = etas[step]

  return (
    <div className={cn('mt-auto', className)}>
      <div className="flex items-center gap-4 rounded-lg border border-border bg-paper-50 px-5 py-4">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-600 font-mono text-lg font-semibold tabular-nums text-on-accent transition-all duration-500"
          aria-hidden="true"
        >
          {position}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-950">
            {position === 1 ? t('consumer.book.queueNext') : t('consumer.book.queuePosition', { position })}
          </p>
          {eta > 0 ? (
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-ink-500">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('consumer.book.queueEta', { minutes: eta })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ A4 */

/**
 * Fade Passport — the emotional centre of the page, and the only deep-dark
 * section. It is presented as something the customer OWNS, not as a record a
 * shop keeps about them.
 */
function PassportScene() {
  const { t } = useTranslation('landing')

  const rows = [
    { label: t('consumer.passport.fade'), value: t('consumer.passport.demoFade') },
    { label: t('consumer.passport.top'), value: t('consumer.passport.demoTop') },
    { label: t('consumer.passport.beard'), value: t('consumer.passport.demoBeard') },
    { label: t('consumer.passport.lastCut'), value: t('consumer.passport.demoLastCut') },
    { label: t('consumer.passport.barber'), value: t('consumer.passport.demoBarber') },
  ]

  return (
    <section className="border-t border-border bg-forest text-on-forest">
      <Container size="xl" className="py-24 sm:py-32">
        <div className="grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-20">
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-on-forest-dim">
              {t('consumer.passport.eyebrow')}
            </p>
            <h2 className="mt-5 font-display text-[clamp(2.25rem,5vw,4rem)] leading-[1] tracking-[-0.02em] text-on-forest">
              {t('consumer.passport.title')}
            </h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-on-forest-dim">
              {t('consumer.passport.body')}
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <figure className="rounded-xl border border-white/10 bg-forest-soft p-7 sm:p-8">
              <dl className="divide-y divide-white/10">
                {rows.map((row) => (
                  <div key={row.label} className="flex items-baseline justify-between gap-6 py-4 first:pt-0 last:pb-0">
                    <dt className="text-xs font-medium uppercase tracking-[0.14em] text-on-forest-dim">
                      {row.label}
                    </dt>
                    <dd className="text-end text-base text-on-forest">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <figcaption className="mt-6 text-[11px] uppercase tracking-[0.14em] text-on-forest-dim/70">
                {t('consumer.demoLabel')}
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ A5 */

function RebookScene() {
  const { t } = useTranslation('landing')

  return (
    <section className="border-t border-border bg-paper-0">
      <Container size="xl" className="py-20 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-20">
          <Reveal className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
              {t('consumer.rebook.eyebrow')}
            </p>
            <h2 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.02] tracking-[-0.015em] text-ink-950">
              {t('consumer.rebook.title')}
            </h2>
            <p className="mt-4 text-base text-ink-700">{t('consumer.rebook.body')}</p>
          </Reveal>

          <Reveal delay={0.08}>
            <figure className="w-full rounded-xl border border-border bg-ivory p-6 sm:min-w-[22rem]">
              <p className="text-sm text-ink-500">{t('consumer.rebook.daysSince')}</p>
              <div className="mt-4 flex flex-col gap-2">
                <span className="inline-flex items-center gap-2 text-base text-ink-950">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-600" aria-hidden="true" />
                  {t('consumer.rebook.sameBarber')}
                </span>
                <span className="inline-flex items-center gap-2 text-base text-ink-950">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-600" aria-hidden="true" />
                  {t('consumer.rebook.sameCut')}
                </span>
              </div>
              <p className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-ink-950 px-5 py-3 text-sm font-medium text-paper-0">
                {t('consumer.rebook.cta')}
              </p>
              <figcaption className="mt-4 text-[11px] uppercase tracking-[0.14em] text-ink-300">
                {t('consumer.demoLabel')}
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ A6 */

function FinalScene() {
  const { t } = useTranslation('landing')

  return (
    <section className="border-t border-border bg-ivory">
      <Container size="xl" className="py-24 text-center sm:py-32">
        <Reveal>
          <h2 className="mx-auto max-w-3xl font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.98] tracking-[-0.02em] text-ink-950">
            {t('consumer.final.title')}
          </h2>
          <p className="mx-auto mt-5 max-w-md text-base text-ink-700">{t('consumer.final.subtitle')}</p>
        </Reveal>

        <Reveal delay={0.1} className="mx-auto mt-10 max-w-3xl text-start">
          <HeroSearch />
        </Reveal>
      </Container>
    </section>
  )
}
