import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowRight, Check } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Reveal, RevealGroup, RevealItem } from '@/components/marketing/motion'
import { ProductStage, SCENE_IDS, type SceneId } from '@/components/marketing/product-stage'
import { useFadeUpPricing } from '@/lib/commerce/pricing-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { cn } from '@/lib/cn'

/**
 * "/for-business" — the professional story, told by scrolling through one
 * shop's day.
 *
 * The structure is deliberately not hero → logos → six cards → pricing. A
 * single product stage persists on the right while the narrative scrolls on
 * the left, and the stage changes to whatever the story is currently about:
 * the same customer walks in, waits, gets a chair, gets cut, becomes a
 * Passport, becomes a regular, and rebooks. The scroll IS the demo.
 *
 * Two compositions, one scene model:
 *
 *   lg and up — sticky stage beside a scrolling narrative column.
 *   below lg  — each scene stacks with its own compact stage inline, so a
 *               phone gets short scroll distances and no sticky trap, rather
 *               than a shrunken desktop layout.
 *
 * Accessibility and reduced motion: every scene is a real section with a real
 * heading and real prose. The stage is decorative (`aria-hidden`) because it
 * restates what the copy already says. Nothing is hidden until it animates —
 * remove the motion and the entire argument is still there, in order.
 */
export function BusinessLandingPage() {
  const { t } = useTranslation('landing')

  useDocumentMeta({
    title: t('business.meta.title'),
    description: t('business.meta.description'),
  })

  return (
    <main>
      <HeroScene />
      <ScrollStory />
      <LoopScene />
      <ExistingSoftwareScene />
      <BusinessTypesScene />
      <PricingScene />
      <FinalScene />
    </main>
  )
}

/* ------------------------------------------------------------------ B1 */

function HeroScene() {
  const { t } = useTranslation('landing')

  return (
    <section className="relative bg-ivory">
      <Container size="xl" className="py-20 sm:py-28 lg:py-36">
        <Reveal>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-500">
            {t('business.hero.eyebrow')}
          </p>
        </Reveal>

        <Reveal delay={0.06}>
          <h1 className="mt-6 max-w-4xl font-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.95] tracking-[-0.02em] text-ink-950">
            {t('business.hero.titleLead')}
          </h1>
        </Reveal>

        <Reveal delay={0.12}>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-700">{t('business.hero.subtitle')}</p>
        </Reveal>

        <Reveal delay={0.18}>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/pro/register"
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent-600 px-7 text-base font-medium text-on-accent transition-colors hover:bg-accent-700"
            >
              {t('business.hero.primary')}
            </Link>
            <Link
              to="/pro/login"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border-strong px-7 text-base font-medium text-ink-950 transition-colors hover:bg-paper-100"
            >
              {t('business.hero.secondary')}
            </Link>
          </div>
        </Reveal>

        <Reveal delay={0.26}>
          <p className="mt-16 inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-ink-500">
            {t('business.hero.scrollHint')}
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </p>
        </Reveal>
      </Container>
    </section>
  )
}

/* ---------------------------------------------------------- B2 … B14 */

/**
 * Tracks which narrative block is currently in the middle of the viewport, so
 * the sticky stage can show the matching scene.
 *
 * IntersectionObserver with a narrow band across the vertical centre, rather
 * than scroll-offset arithmetic: it survives variable-height copy, dynamic
 * font loading and zoom, none of which a hardcoded pixel schedule does.
 */
function useActiveScene(count: number): [number, (index: number) => (node: HTMLElement | null) => void] {
  const [active, setActive] = useState(0)
  const nodes = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const index = nodes.current.indexOf(entry.target as HTMLElement)
          if (index >= 0) setActive(index)
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )

    for (const node of nodes.current) {
      if (node) observer.observe(node)
    }
    return () => observer.disconnect()
  }, [count])

  const setNode = (index: number) => (node: HTMLElement | null) => {
    nodes.current[index] = node
  }

  return [active, setNode]
}

function ScrollStory() {
  const { t } = useTranslation('landing')
  const [active, setNode] = useActiveScene(SCENE_IDS.length)

  return (
    <section className="border-t border-border bg-paper-0">
      <Container size="xl">
        <div className="lg:grid lg:grid-cols-[1fr_1fr] lg:gap-16">
          {/* Narrative column — the whole story as ordinary prose. */}
          <div>
            {SCENE_IDS.map((scene, index) => (
              <SceneBlock
                key={scene}
                scene={scene}
                index={index}
                total={SCENE_IDS.length}
                ref={setNode(index)}
              />
            ))}
          </div>

          {/*
            The persistent stage. Sticky only from lg up: on a phone a sticky
            half-screen panel eats the viewport and turns scrolling into a
            fight, so mobile gets the inline stage inside each block instead.
          */}
          <div className="hidden lg:block">
            <div data-fu-stage className="sticky top-0 flex h-svh items-center">
              <div className="w-full">
                <ProductStage scene={SCENE_IDS[active]!} />
                <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-ink-300">
                  {t('business.demoLabel')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

/** React 19 passes `ref` as an ordinary prop — no forwardRef wrapper needed. */
function SceneBlock({
  scene,
  index,
  total,
  ref,
}: {
  scene: SceneId
  index: number
  total: number
  ref: (node: HTMLElement | null) => void
}) {
  const { t } = useTranslation('landing')

  return (
    <section
      ref={ref}
      className="flex flex-col justify-center border-b border-border py-16 last:border-b-0 sm:py-20 lg:min-h-[80svh] lg:border-b-0 lg:py-24"
    >
      <Reveal>
        {/*
          A counter, not decoration: thirteen scenes is a long read, and
          knowing where you are in the story is the difference between
          immersion and wondering how much is left.
        */}
        <p className="mb-6 hidden font-mono text-xs tabular-nums text-ink-300 lg:block">
          {String(index + 1).padStart(2, '0')} <span className="text-border-strong">/</span>{' '}
          {String(total).padStart(2, '0')}
        </p>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
          {t(`business.scenes.${scene}.eyebrow`)}
        </p>
        <h2 className="mt-4 max-w-lg font-display text-[clamp(1.875rem,4vw,3rem)] leading-[1.05] tracking-[-0.015em] text-ink-950">
          {t(`business.scenes.${scene}.title`)}
        </h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-ink-700">
          {t(`business.scenes.${scene}.body`)}
        </p>
      </Reveal>

      {/* The mobile composition: the stage travels with its own scene. */}
      <Reveal delay={0.08} className="mt-8 lg:hidden">
        <ProductStage scene={scene} />
        <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-300">
          {t('business.demoLabel')}
        </p>
      </Reveal>
    </section>
  )
}

/* ----------------------------------------------------------------- B15 */

function LoopScene() {
  const { t } = useTranslation('landing')
  const steps = t('business.loop.steps', { returnObjects: true }) as string[]

  return (
    <section className="border-t border-border bg-forest text-on-forest">
      <Container size="xl" className="py-24 sm:py-32">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-on-forest-dim">
            {t('business.loop.eyebrow')}
          </p>
          <h2 className="mt-5 font-display text-[clamp(2.25rem,5vw,4rem)] leading-[1] tracking-[-0.02em] text-on-forest">
            {t('business.loop.title')}
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-on-forest-dim">{t('business.loop.body')}</p>
        </Reveal>

        <RevealGroup as="ol" className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {steps.map((step, index) => (
            <RevealItem
              as="li"
              key={step}
              className="rounded-lg border border-white/10 bg-forest-soft px-4 py-5"
            >
              <span className="font-mono text-xs tabular-nums text-on-forest-dim">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-2 text-sm font-medium text-on-forest">{step}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </Container>
    </section>
  )
}

/* ----------------------------------------------------------------- B16 */

function ExistingSoftwareScene() {
  const { t } = useTranslation('landing')
  const additions = t('business.existing.add', { returnObjects: true }) as string[]

  return (
    <section className="border-t border-border bg-paper-0">
      <Container size="xl" className="py-20 sm:py-28">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
            {t('business.existing.eyebrow')}
          </p>
          <h2 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.02] tracking-[-0.015em] text-ink-950">
            {t('business.existing.title')}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink-700">{t('business.existing.body')}</p>
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start lg:gap-10">
          <Reveal>
            <div className="rounded-xl border border-border bg-paper-50 p-6 lg:w-64">
              <p className="text-[11px] uppercase tracking-[0.14em] text-ink-500">
                {t('business.existing.keepLabel')}
              </p>
              <p className="mt-3 font-display text-2xl text-ink-950">{t('business.existing.keep')}</p>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="rounded-xl border border-border p-6">
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent-700">
                {t('business.existing.addLabel')}
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {additions.map((item) => (
                  <li key={item} className="inline-flex items-center gap-2 text-base text-ink-950">
                    <Check className="h-4 w-4 shrink-0 text-accent-600" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>

        {/*
          Stated plainly rather than buried: there is no automatic migration
          today. Claiming one would be the fastest way to lose a shop's trust
          in the first week.
        */}
        <Reveal delay={0.14}>
          <p className="mt-8 max-w-2xl border-s-2 border-border-strong ps-4 text-sm text-ink-500">
            {t('business.existing.note')}
          </p>
        </Reveal>
      </Container>
    </section>
  )
}

/* ----------------------------------------------------------------- B17 */

const BUSINESS_TYPES = ['independent', 'studio', 'barbershop', 'multi'] as const

function BusinessTypesScene() {
  const { t } = useTranslation('landing')

  return (
    <section className="border-t border-border bg-ivory-deep">
      <Container size="xl" className="py-20 sm:py-28">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
            {t('business.types.eyebrow')}
          </p>
          <h2 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.02] tracking-[-0.015em] text-ink-950">
            {t('business.types.title')}
          </h2>
        </Reveal>

        {/*
          Chair counts, not icons: the difference between these shops is how
          many chairs are on the floor, so that is what changes.
        */}
        <RevealGroup as="ul" className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BUSINESS_TYPES.map((type, index) => (
            <RevealItem as="li" key={type} className="rounded-xl border border-border bg-paper-0 p-6">
              <div className="flex gap-1.5" aria-hidden="true">
                {Array.from({ length: index === 3 ? 4 : index * 3 + 1 }).map((_, chair) => (
                  <span
                    key={chair}
                    className={cn(
                      'h-8 w-2 rounded-sm',
                      index === 3 && chair > 0 ? 'bg-accent-600/40' : 'bg-accent-600',
                    )}
                  />
                ))}
              </div>
              <p className="mt-5 font-display text-xl text-ink-950">{t(`business.types.${type}.name`)}</p>
              <p className="mt-1.5 text-sm text-ink-500">{t(`business.types.${type}.detail`)}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </Container>
    </section>
  )
}

/* ----------------------------------------------------------------- B18 */

function PricingScene() {
  const { t } = useTranslation('landing')
  const { formattedMonthly, isResolved } = useFadeUpPricing()

  return (
    <section id="pricing" className="border-t border-border bg-paper-0">
      <Container size="md" className="py-24 text-center sm:py-32">
        <Reveal>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
            {t('business.pricing.eyebrow')}
          </p>
          <h2 className="mt-5 font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.98] tracking-[-0.02em] text-ink-950">
            {t('business.pricing.title')}
          </h2>
        </Reveal>

        {/*
          The amount and the currency come from the commercial pricing context,
          which resolves from the visitor's country — never from their language
          and never from a constant in this file.
        */}
        <Reveal delay={0.08}>
          <p className="mt-12 font-mono text-[clamp(3rem,10vw,6rem)] leading-none tabular-nums text-ink-950">
            {isResolved ? formattedMonthly : '—'}
          </p>
          <p className="mt-4 text-sm uppercase tracking-[0.14em] text-ink-500">
            {isResolved ? t('business.pricing.perMonth') : t('business.pricing.resolving')}
          </p>
          <p className="mx-auto mt-8 max-w-md text-base text-ink-700">{t('business.pricing.body')}</p>
        </Reveal>

        <Reveal delay={0.14}>
          <Link
            to="/pro/register"
            className="mt-10 inline-flex min-h-12 items-center justify-center rounded-lg bg-accent-600 px-8 text-base font-medium text-on-accent transition-colors hover:bg-accent-700"
          >
            {t('business.pricing.cta')}
          </Link>
          <p className="mt-4 text-sm text-ink-500">{t('business.pricing.note')}</p>
        </Reveal>
      </Container>
    </section>
  )
}

/* ----------------------------------------------------------------- B19 */

function FinalScene() {
  const { t } = useTranslation('landing')
  const lines = t('business.final.lines', { returnObjects: true }) as string[]

  return (
    <section className="border-t border-border bg-forest text-on-forest">
      <Container size="xl" className="py-28 sm:py-36">
        <RevealGroup className="max-w-3xl">
          {lines.map((line) => (
            <RevealItem key={line}>
              <p className="font-display text-[clamp(1.75rem,4vw,3rem)] leading-[1.15] text-on-forest-dim">
                {line}
              </p>
            </RevealItem>
          ))}
          <RevealItem>
            <p className="mt-4 font-display text-[clamp(1.75rem,4vw,3rem)] leading-[1.15] text-on-forest">
              {t('business.final.together')}
            </p>
          </RevealItem>
        </RevealGroup>

        <Reveal delay={0.1}>
          <h2 className="mt-16 max-w-4xl font-display text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.95] tracking-[-0.02em] text-on-forest">
            {t('business.final.title')}
          </h2>
        </Reveal>

        <Reveal delay={0.16}>
          <div className="mt-12 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/pro/register"
              className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-accent-600 px-7 text-base font-medium text-on-accent transition-colors hover:bg-accent-700"
            >
              {t('business.final.primary')}
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180"
                aria-hidden="true"
              />
            </Link>
            <Link
              to="/pro/login"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/20 px-7 text-base font-medium text-on-forest transition-colors hover:bg-white/5"
            >
              {t('business.final.secondary')}
            </Link>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
