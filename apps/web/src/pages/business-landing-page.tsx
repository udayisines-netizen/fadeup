import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { Container } from '@/components/ui/container'
import { Reveal } from '@/components/marketing/motion'
import { BusinessModeProvider } from '@/components/for-business/business-mode'
import { BusinessTypeSelector } from '@/components/for-business/business-type-selector'
import { ProductFilm } from '@/components/for-business/product-film'
import { Scrollytelling } from '@/components/for-business/scrollytelling'
import { MigrationSection } from '@/components/for-business/migration'
import { PricingStage } from '@/components/for-business/pricing-stage'
import { CapabilityComparison } from '@/components/for-business/capability-comparison'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { cn } from '@/lib/cn'

/**
 * "/for-business" — FadeUp's professional acquisition page.
 *
 * The page it replaced answered the question "what features does FadeUp have?"
 * across fourteen near-identical scenes. This one answers "how does FadeUp help
 * me run my shop better?", which is the only question a barbershop owner is
 * actually asking, and it answers it in eight sections:
 *
 *   HERO        what FadeUp is, in one sentence
 *   FILM        what it looks like running, in ~34 silent seconds
 *   STAGES      four ways it changes the working day
 *   MIGRATION   what happens if you already use something else
 *   PRICING     which plan fits, once you know what you are buying
 *   FINAL CTA   the decision
 *
 * Colour carries the rhythm. Everything is FadeUp Night except Migration, which
 * is off-white: the one moment the reader needs reassurance rather than
 * atmosphere. Dark, dark, dark, light, dark reads as deliberate; dark
 * throughout reads as a tunnel.
 *
 * The business-type control (Independent / Barbershop / Multi-location) still
 * exists and still drives pricing, but it no longer opens the page. Asking
 * "which of these are you" before explaining the product makes a visitor
 * classify themselves for a system they cannot yet picture, so it now sits at
 * the top of Pricing, where the answer actually changes what they see.
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
        <HeroShowcase />
        <Scrollytelling />
        <MigrationSection />
        <PricingSection />
      </main>
    </BusinessModeProvider>
  )
}

/* -------------------------------------------------- hero + product showcase */

/**
 * The hero and the film are one composition, not two sections.
 *
 * Previously the page said what FadeUp is, ended, drew a section boundary,
 * announced "FadeUp in action", and only then showed the product. Three
 * gestures to do one thing. Here the headline states the promise, the two
 * calls to action sit directly under it, and the film rises into the same
 * dark ground immediately below, sharing the grid and the light source. The
 * reader should feel hero then product, not hero then a new page.
 *
 * The hero deliberately carries no product panel of its own any more. It used
 * to hold a Today mock beside the headline, which competed with the film for
 * the same job and made the first screen busy. The film does that job better,
 * so the hero gets to be typography and space.
 */
function HeroShowcase() {
  const { t } = useTranslation('landing')
  const reduced = useReducedMotion()

  return (
    <section className="relative overflow-hidden bg-[var(--pro-bg)]">
      {/*
        One light source for the whole composition, placed between the copy
        and the film so both sit inside the same pool of emerald rather than
        each having their own. This is what makes the two read as one surface.
      */}
      <div aria-hidden="true" className="pro-ambient inset-x-0 -top-32 h-[46rem]" />

      <Container size="xl" className="relative pt-14 sm:pt-20 lg:pt-24">
        <motion.div
          className="mx-auto max-w-3xl text-center"
          initial={reduced ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="pro-title text-[clamp(2.25rem,5vw,4rem)]">{t('business.hero.headline')}</h1>

          {/*
            One sentence, not a feature list. It says which parts of the day
            FadeUp actually covers, which the headline alone does not, and it
            is the last text before the product speaks for itself.
          */}
          <p className="pro-body mx-auto mt-6 max-w-2xl text-base sm:text-lg">
            {t('business.hero.support')}
          </p>

          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/pro/register" className={proPrimaryCta}>
              {t('business.hero.primary')}
            </Link>
            <Link to="/pro/login" className={proSecondaryCta}>
              {t('business.hero.secondary')}
            </Link>
          </div>
        </motion.div>

        {/*
          The film, close enough to the buttons to belong to them. No heading,
          no eyebrow, no divider: an introduction here would only delay the
          one thing this part of the page exists to do.
        */}
        <motion.div
          className="mx-auto mt-14 w-[min(100%,88rem)] sm:mt-16 lg:mt-20"
          initial={reduced ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
        >
          <ProductFilm />
        </motion.div>
      </Container>

      {/*
        The showcase runs off the bottom of the hero into the next section
        rather than stopping at a rule, so the scroll continues instead of
        stepping down.
      */}
      <div className="h-20 sm:h-28 lg:h-32" />
    </section>
  )
}

/* ---------------------------------------------------------------- pricing */

function PricingSection() {
  const { t } = useTranslation('landing')

  return (
    /* Named so it is a landmark: pricing is the section a returning visitor
       jumps to, and an unnamed <section> is not reachable as one. */
    <section
      id="pricing"
      aria-labelledby="pricing-eyebrow"
      className="relative overflow-hidden bg-[var(--pro-sunken)]"
    >
      {/*
        Pricing gets its own light, lower and softer than the hero's, sitting
        behind the plan rail rather than behind the heading. It is a different
        dark room from the one the page opened in, which is what stops the
        second half of the page reading as a repeat of the first.
      */}
      <div aria-hidden="true" className="pro-ambient inset-x-0 top-1/3 h-[40rem] opacity-70" />

      <Container size="lg" className="relative pb-32 pt-24 sm:pb-40 sm:pt-32">
        {/*
          A short way in. This used to be a label, a headline, a paragraph, a
          second heading and three tall type cards before a single price was
          visible. A visitor who scrolled this far has already been convinced
          by the product; what they want now is the number.
        */}
        <Reveal className="mx-auto max-w-xl text-center">
          <p id="pricing-eyebrow" className="pro-eyebrow">
            {t('business.pricing.eyebrow')}
          </p>
          <h2 className="pro-title mt-4 text-[clamp(1.75rem,3.4vw,2.5rem)]">
            {t('business.pricing.title')}
          </h2>
        </Reveal>

        <Reveal delay={0.06}>
          <BusinessTypeSelector className="mx-auto mt-10 max-w-xl" />
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-12">
            <PricingStage />
            <CapabilityComparison />
          </div>
        </Reveal>
      </Container>
    </section>
  )
}

/* --------------------------------------------------------------- CTA style */

/*
 * Both CTAs keep their existing destinations (/pro/register, /pro/login) and
 * their existing behaviour. Only the surface is new: emerald fill for the
 * commitment, hairline for the alternative, restrained radius per the charter.
 * Focus rings are explicit because the browser default disappears against a
 * dark ground.
 */
const proPrimaryCta = cn(
  'inline-flex min-h-[3.25rem] items-center justify-center rounded-[var(--pro-r-button)] px-8',
  'bg-[var(--pro-accent)] text-base font-medium text-[var(--pro-on-accent)]',
  'shadow-[0_10px_30px_-12px_color-mix(in_srgb,var(--pro-emerald)_70%,transparent)]',
  'transition-colors duration-200 hover:bg-[var(--pro-accent-hover)]',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pro-highlight)]',
)

/*
 * The secondary call to action is an alternative, not a second commitment, so
 * hovering it must not look like choosing it. Filling it with colour on hover
 * made the page briefly appear to have two primary buttons.
 *
 * Instead the surface stays where it is and the button simply sharpens: the
 * label brightens to full off-white, the tonal edge lifts slightly, and a very
 * soft outer halo appears. The message is focus, not commitment. Both the edge
 * and the halo are box-shadows rather than a border, so nothing shifts by a
 * pixel on hover and the page keeps its no-white-outline rule.
 */
const proSecondaryCta = cn(
  'inline-flex min-h-[3.25rem] items-center justify-center rounded-[var(--pro-r-button)] px-8',
  'bg-[color-mix(in_srgb,var(--pro-offwhite)_6%,transparent)] text-base font-medium',
  'text-[var(--pro-muted)]',
  'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--pro-sage)_18%,transparent)]',
  'transition-[color,box-shadow] duration-200',
  'hover:text-[var(--pro-text)]',
  'hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--pro-sage)_34%,transparent),0_0_24px_-8px_color-mix(in_srgb,var(--pro-mint)_28%,transparent)]',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pro-highlight)]',
)
