import { useTranslation } from 'react-i18next'
import { Container } from '@/components/ui/container'
import { Reveal, RevealGroup, RevealItem } from '@/components/marketing/motion'

/**
 * Migration: the page's single light section.
 *
 * Everything before and after this is FadeUp Night. A shop owner reading here
 * is not being sold to, they are being reassured, and the switch to off-white
 * carries that change of register better than a change of wording would. It is
 * also the page's breathing point between the product story and the price.
 *
 * The copy deliberately avoids the vocabulary the previous version used
 * ("your current stack", "migration pipeline"). The reader is a barber, not an
 * IT buyer, so the section is three plain sentences about what actually
 * happens, in the order it happens.
 *
 * Truthfulness matters more than reassurance here: there is no automatic
 * import from another product today, and the note says so rather than letting
 * "we prepare the move with you" be read as one-click migration. Promising a
 * capability that does not exist is the fastest way to lose a shop in week one.
 */
export function MigrationSection() {
  const { t } = useTranslation('landing')
  const steps = t('business.migration.steps', { returnObjects: true }) as string[]

  return (
    <section className="pro-light">
      <Container size="xl" className="py-24 sm:py-32">
        <Reveal className="max-w-3xl">
          <p className="pro-eyebrow">{t('business.migration.eyebrow')}</p>

          {/*
            Two lines, one heading: the question the visitor is already asking,
            then the answer. Splitting the answer into a <p> would let a screen
            reader lose the pairing, so the reassurance is part of the heading.
          */}
          <h2 className="pro-title mt-6 text-[clamp(1.875rem,4vw,3rem)]">
            {t('business.migration.title')}
            <span className="mt-3 block text-[var(--pro-highlight)]">
              {t('business.migration.lead')}
            </span>
          </h2>

          <p className="pro-body mt-7 max-w-2xl text-base sm:text-lg">
            {t('business.migration.body')}
          </p>
        </Reveal>

        {/*
          A sequence, not three cards. On desktop the steps sit on one
          horizontal line with the connector running through them, so the eye
          reads it as a path with a beginning and an end. On a phone that same
          connector becomes the vertical spine of a list.
        */}
        <RevealGroup as="ol" className="mt-16 grid gap-10 sm:gap-8 lg:grid-cols-3 lg:gap-12">
          {steps.map((step, index) => (
            <RevealItem as="li" key={step} className="relative">
              <div className="flex gap-5 lg:block">
                <div className="relative flex flex-col items-center lg:block">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--pro-emerald)_35%,transparent)] bg-[color-mix(in_srgb,var(--pro-emerald)_12%,transparent)] font-mono text-sm tabular-nums text-[var(--pro-highlight)]"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>

                  {/* Vertical spine on mobile, horizontal rule on desktop. */}
                  {index < steps.length - 1 ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="mt-2 w-px flex-1 bg-[var(--pro-border)] lg:hidden"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute left-[3.25rem] top-1/2 hidden h-px w-[calc(100%-1.5rem)] -translate-y-1/2 bg-[var(--pro-border)] lg:block"
                      />
                    </>
                  ) : null}
                </div>

                <p className="pro-glass-card mb-8 px-6 py-5 text-base leading-relaxed text-[var(--pro-text)] lg:mb-0 lg:mt-6">
                  {step}
                </p>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal delay={0.12}>
          <p className="mt-6 max-w-2xl border-s-2 border-[var(--pro-border-strong)] ps-4 text-sm text-[var(--pro-faint)]">
            {t('business.migration.note')}
          </p>
        </Reveal>
      </Container>
    </section>
  )
}
