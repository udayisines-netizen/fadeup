import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowRight, Check } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Reveal, RevealGroup, RevealItem } from '@/components/marketing/motion'
import { BusinessModeProvider, useBusinessMode } from '@/components/for-business/business-mode'
import { ModeSelector } from '@/components/for-business/mode-selector'
import { ProductStage } from '@/components/for-business/product-stage'
import { PricingStage } from '@/components/for-business/pricing-stage'
import { CapabilityComparison } from '@/components/for-business/capability-comparison'
import { scenesForMode, sceneCopyKeys, type Scene } from '@/components/for-business/scenes'
import type { BusinessMode } from '@/lib/commerce/plans'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { cn } from '@/lib/cn'

/**
 * "/for-business" — FadeUp's professional acquisition experience.
 *
 * The page asks one question first, and everything after it is the answer.
 *
 *   1. What kind of barber business do you run?      (the mode selector)
 *   2. Watch FadeUp become that business.            (the world morphs)
 *   3. Scroll, and see how FadeUp runs it.           (the product story)
 *   4. See how it remembers every customer.          (Passport)
 *   5. Understand what Pro turns that memory into.   (Retention)
 *   6. Choose the plan that fits your operation.     (the plan rail)
 *
 * The structure is deliberately not hero → logos → six cards → pricing. A single
 * product stage persists while the narrative scrolls beside it, and the stage
 * shows whatever the story is currently about: the same customer walks in,
 * waits, gets a chair, gets cut, becomes a Passport, becomes a regular, rebooks.
 * The scroll IS the demo.
 *
 * Two compositions, one scene model:
 *
 *   lg and up — sticky stage beside a scrolling narrative column.
 *   below lg  — each scene stacks with its own compact stage inline, so a phone
 *               gets short scroll distances and no sticky trap, rather than a
 *               shrunken desktop layout.
 *
 * Accessibility and reduced motion: every scene is a real section with a real
 * heading and real prose. The stage is decorative (`aria-hidden`) because it
 * restates what the copy already says. Nothing is hidden until it animates —
 * remove the motion and the entire argument is still there, in order. Scrolling
 * is never hijacked: no pinned section holds the viewport hostage, and every
 * sticky element releases at the end of its own section.
 */
export function BusinessLandingPage() {
  const { t } = useTranslation('landing')

  useDocumentMeta({
    title: t('business.meta.title'),
    description: t('business.meta.description'),
  })

  return (
    <BusinessModeProvider>
      <main>
        <HeroScene />
        <ScrollStory />
        <LoopScene />
        <ExistingSoftwareScene />
        <PricingSection />
        <FinalScene />
      </main>
    </BusinessModeProvider>
  )
}

/* ------------------------------------------------------------------- hero */

function HeroScene() {
  const { t } = useTranslation('landing')
  const { mode } = useBusinessMode()
  const reduced = useReducedMotion()

  const lines = t(`business.modes.${mode}.lines`, { returnObjects: true }) as string[]

  return (
    <section className="relative overflow-hidden bg-ivory">
      <Container size="xl" className="py-14 sm:py-20 lg:py-24">
        {/*
          Two compositions from one DOM order, via grid placement.

          Phone: statement, then the product world with its selector, then the
          CTAs. The selector has to be inside the first screenful — "which of
          these is my business" is the question the page is built around, and a
          control a thumb never reaches may as well not exist. Putting the
          buttons above it pushed it off a 390x844 screen entirely.

          Desktop: statement top-left, CTAs bottom-left, product world and
          selector filling the right column across both rows.
        */}
        <div className="flex flex-col lg:grid lg:grid-cols-[1.05fr_1fr] lg:grid-rows-[auto_auto] lg:items-center lg:gap-x-16">
          {/* --- the argument --- */}
          <div className="order-1 lg:col-start-1 lg:row-start-1 lg:self-end">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-500">
              {t('business.hero.eyebrow')}
            </p>

            {/*
              The headline changes with the mode. Not decoration: "Run the whole
              shop" is the wrong promise to make to somebody who works alone, and
              seeing the sentence itself change is the clearest possible signal
              that the page adapted to them.

              It is a keyed remount rather than an exit-then-enter crossfade: the
              headline must exist the instant the mode changes, or the page's
              largest text is missing for a third of a second after a click.
            */}
            <h1 className="mt-5 font-display text-[clamp(2.5rem,7vw,5rem)] leading-[0.95] tracking-[-0.02em] text-ink-950">
              <motion.span
                key={mode}
                className="block"
                initial={reduced ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                {t(`business.modes.${mode}.headline`)}
              </motion.span>
            </h1>

            {/*
              Short declarative lines instead of a paragraph: they are the
              operations of an actual shop, and the set of them changes per mode,
              which does more to explain the product than a sentence would.
            */}
            <ul className="mt-7 flex flex-wrap gap-x-3 gap-y-1.5 text-lg text-ink-700 sm:text-xl">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

          </div>

          {/* --- the product world, and the control that changes it --- */}
          <div className="order-2 mt-12 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
            {/*
              A fixed box for the world. Independent draws one lane and
              Multi-location draws five plus a location strip, so without a
              floor the hero would grow and shrink by ~300px as you flick
              through the modes — the selector jumping away from under the
              cursor. The panel is centred in the box instead, and the empty space
              left over in Independent is the point rather than a gap.
            */}
            <div className="mx-auto flex w-full max-w-md flex-col justify-center lg:min-h-[27rem]">
              <MorphingStage />
              <p className="mt-3 text-center text-[11px] uppercase tracking-[0.14em] text-ink-300">
                {t('business.demoLabel')}
              </p>
            </div>

            <ModeSelector className="mt-8" />
          </div>

          {/* --- what to do about it --- */}
          <div className="order-3 mt-10 lg:col-start-1 lg:row-start-2 lg:mt-9 lg:self-start">
            <div className="flex flex-col gap-3 sm:flex-row">
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

            <p className="mt-10 inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-ink-500">
              {t('business.hero.scrollHint')}
              <ArrowDown className="h-3.5 w-3.5 motion-safe:animate-bounce" aria-hidden="true" />
            </p>
          </div>
        </div>
      </Container>
    </section>
  )
}

/**
 * The hero's product world: the shop's Today view, morphing between modes.
 *
 * Same component, same barber lanes, different arrangement — one barber becomes
 * three becomes five across two locations. The lanes carry layout identities, so
 * the ones that survive a mode change animate into their new position instead of
 * being replaced.
 */
function MorphingStage() {
  const { mode } = useBusinessMode()
  return <ProductStage scene="today" mode={mode} />
}

/* ---------------------------------------------------------- the story */

/**
 * Tracks which narrative block is in the middle of the viewport, so the sticky
 * stage shows the matching scene.
 *
 * IntersectionObserver with a narrow band across the vertical centre, rather
 * than scroll-offset arithmetic: it survives variable-height copy, dynamic font
 * loading and zoom, none of which a hardcoded pixel schedule does. It is also
 * the reason this page needs no scroll engine — one observer, no work per frame,
 * and no React render storm per scroll tick.
 */
function useActiveScene(
  count: number,
): [number, (index: number) => (node: HTMLElement | null) => void, React.RefObject<(HTMLElement | null)[]>] {
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

  return [active, setNode, nodes]
}

function ScrollStory() {
  const { t } = useTranslation('landing')
  const { mode } = useBusinessMode()
  const scenes = scenesForMode(mode)
  const [active, setNode, nodes] = useActiveScene(scenes.length)

  /*
   * Changing mode mid-story changes which scenes exist, which changes the height
   * of everything below the viewport — and the reader ends up somewhere they did
   * not scroll to. Re-anchoring on the scene they were already reading keeps
   * their narrative position across the switch. Only when the story is actually
   * on screen: doing this from the hero would yank someone down the page for
   * pressing an arrow.
   */
  const previousMode = useRef<BusinessMode>(mode)
  useLayoutEffect(() => {
    if (previousMode.current === mode) return
    previousMode.current = mode

    const node = nodes.current[active]
    if (!node) return

    /*
     * "Is the reader actually reading this scene", not "is it anywhere on
     * screen". The looser test fired from the hero — scene 01 begins just below
     * the fold, so pressing a mode arrow at the top of the page threw the
     * visitor down into the story. The centre band matches the one the
     * IntersectionObserver uses to choose `active`, so re-anchoring only ever
     * happens for the scene that is genuinely being read.
     */
    const box = node.getBoundingClientRect()
    const middle = window.innerHeight / 2
    if (box.top < middle && box.bottom > middle) {
      node.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
  }, [mode, active, nodes])

  return (
    <section id="product" className="border-t border-border bg-paper-0">
      <Container size="xl">
        <div className="lg:grid lg:grid-cols-[1fr_1fr] lg:gap-16">
          {/* Narrative column — the whole story as ordinary prose. */}
          <div>
            {scenes.map((scene, index) => (
              <SceneBlock
                key={scene.id}
                scene={scene}
                mode={mode}
                index={index}
                total={scenes.length}
                ref={setNode(index)}
              />
            ))}
          </div>

          {/*
            The persistent stage. Sticky only from lg up: on a phone a sticky
            half-screen panel eats the viewport and turns scrolling into a fight,
            so mobile gets the inline stage inside each block instead.
          */}
          <div className="hidden lg:block">
            <div className="sticky top-0 flex h-svh flex-col justify-center py-16">
              <ProductStage scene={scenes[active]?.id ?? scenes[0]!.id} mode={mode} />

              <div className="mt-5 flex items-center gap-4">
                <StoryProgress current={active} total={scenes.length} />
                <p className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-ink-300">
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

/** How far through the story you are. Decorative — the per-scene counter is the accessible version. */
function StoryProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="h-0.5 flex-1 rounded-full bg-border" aria-hidden="true">
      <motion.div
        className="h-full rounded-full bg-accent-600"
        initial={false}
        animate={{ width: `${((current + 1) / total) * 100}%` }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  )
}

/** React 19 passes `ref` as an ordinary prop — no forwardRef wrapper needed. */
function SceneBlock({
  scene,
  mode,
  index,
  total,
  ref,
}: {
  scene: Scene
  mode: BusinessMode
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
          A counter, not decoration: fourteen scenes is a long read, and knowing
          where you are in the story is the difference between immersion and
          wondering how much is left.
        */}
        <p className="mb-6 hidden font-mono text-xs tabular-nums text-ink-300 lg:block">
          {String(index + 1).padStart(2, '0')} <span className="text-border-strong">/</span>{' '}
          {String(total).padStart(2, '0')}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
            {t(sceneCopyKeys(scene.id, mode, 'eyebrow'))}
          </p>
          {/*
            An unbuilt beat is marked in the story itself, not only in the
            pricing table. A visitor should never reach the plan rail and
            discover that something they just watched is not there yet.
          */}
          {scene.status === 'planned' ? (
            <span className="rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-ink-500">
              {t('business.roadmapBadge')}
            </span>
          ) : null}
        </div>

        <h2 className="mt-4 max-w-lg font-display text-[clamp(1.875rem,4vw,3rem)] leading-[1.05] tracking-[-0.015em] text-ink-950">
          {t(sceneCopyKeys(scene.id, mode, 'title'))}
        </h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-ink-700">
          {t(sceneCopyKeys(scene.id, mode, 'body'))}
        </p>
      </Reveal>

      {/* The mobile composition: the stage travels with its own scene. */}
      <Reveal delay={0.08} className="mt-8 lg:hidden">
        <ProductStage scene={scene.id} mode={mode} />
        <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-300">
          {t('business.demoLabel')}
        </p>
      </Reveal>
    </section>
  )
}

/* ------------------------------------------------------------- the loop */

function LoopScene() {
  const { t } = useTranslation('landing')
  const steps = t('business.loop.steps', { returnObjects: true }) as string[]

  return (
    <section id="how" className="border-t border-border bg-forest text-on-forest">
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
            <RevealItem as="li" key={step} className="rounded-lg border border-white/10 bg-forest-soft px-4 py-5">
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

/* --------------------------------------------------- already have software */

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
          today. Claiming one would be the fastest way to lose a shop's trust in
          the first week.
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

/* ---------------------------------------------------------------- pricing */

function PricingSection() {
  const { t } = useTranslation('landing')
  const { mode } = useBusinessMode()

  return (
    /* Named so it is a landmark: "pricing" is the section a returning visitor
       jumps to, and an unnamed <section> is not reachable as one. */
    <section id="pricing" aria-labelledby="pricing-eyebrow" className="border-t border-border bg-ivory-deep">
      <Container size="lg" className="py-20 sm:py-28">
        <Reveal className="max-w-2xl">
          <p id="pricing-eyebrow" className="text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
            {t('business.pricing.eyebrow')}
          </p>
          <h2 className="mt-4 font-display text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.02] tracking-[-0.02em] text-ink-950">
            {t('business.pricing.title')}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink-700">
            {t(`business.pricing.for.${mode}`)}
          </p>
        </Reveal>

        {/*
          The selector again, at the decision point. Somebody who has scrolled
          the whole story and now disagrees with the mode they started in should
          not have to scroll back to the top to change the plans they are shown.
        */}
        <Reveal delay={0.06}>
          <div className="mt-10 rounded-xl border border-border bg-paper-0 px-4 py-6 sm:px-8">
            <ModeSelector />
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-8">
            <PricingStage />
            <CapabilityComparison />
          </div>
        </Reveal>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ final */

function FinalScene() {
  const { t } = useTranslation('landing')
  const { mode } = useBusinessMode()
  const lines = t(`business.modes.${mode}.lines`, { returnObjects: true }) as string[]

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
              className={cn(
                'group inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-accent-600 px-7',
                'text-base font-medium text-on-accent transition-colors hover:bg-accent-700',
              )}
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
