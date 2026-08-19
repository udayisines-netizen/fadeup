import { Link } from 'react-router-dom'
import { Check, Minus } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/cn'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useTranslation } from 'react-i18next'

interface Tier {
  name: string
  tagline: string
  scope: string
  highlights: string[]
  featured?: boolean
}

const TIERS: Tier[] = [
  {
    name: 'Starter',
    tagline: 'One shop, getting started.',
    scope: 'Up to 1 location',
    highlights: ['Online booking', 'Live queue & walk-ins', 'Chair Mode', 'Customer CRM'],
  },
  {
    name: 'Growth',
    tagline: 'An established shop that wants more control.',
    scope: 'Up to 1 location, unlimited chairs',
    highlights: ['Everything in Starter', 'Barber Passport', 'Memberships', 'Team roles & permissions'],
    featured: true,
  },
  {
    name: 'Multi-Location',
    tagline: 'Running more than one shop.',
    scope: 'Unlimited locations',
    highlights: ['Everything in Growth', 'Cross-location analytics', 'Organization-wide team management'],
  },
]

interface ComparisonRow {
  feature: string
  tiers: [boolean, boolean, boolean]
}

const COMPARISON_ROWS: ComparisonRow[] = [
  { feature: 'Online booking', tiers: [true, true, true] },
  { feature: 'Live queue & wait estimates', tiers: [true, true, true] },
  { feature: 'Walk-in handling', tiers: [true, true, true] },
  { feature: 'Chair Mode', tiers: [true, true, true] },
  { feature: 'Customer CRM & timeline', tiers: [true, true, true] },
  { feature: 'Barber Passport', tiers: [false, true, true] },
  { feature: 'Memberships', tiers: [false, true, true] },
  { feature: 'Team roles & permissions', tiers: [false, true, true] },
  { feature: 'Multi-location support', tiers: [false, false, true] },
  { feature: 'Cross-location analytics', tiers: [false, false, true] },
]

const FAQ = [
  {
    question: 'Is this final pricing?',
    answer:
      'No. FadeUp is in early access, and the tiers above describe the intended plan structure — how features are expected to be grouped — not committed dollar amounts or a locked billing schedule.',
  },
  {
    question: 'Do I need a credit card to start?',
    answer:
      'No. Signing up creates your organization and takes you straight into onboarding — billing isn’t wired up yet.',
  },
  {
    question: 'Which tier is my shop on today?',
    answer:
      'Every organization gets the same product today while FadeUp is in early access. Tier-based limits and billing are part of what pricing being "final" will mean.',
  },
]

export function PricingPage() {
  const { t } = useTranslation()
  useDocumentMeta({
    title: 'Pricing — FadeUp',
    description:
      'FadeUp plan tiers by location count and feature set — Starter, Growth and Multi-Location. Illustrative structure; FadeUp is in early access and final pricing isn’t set.',
  })

  return (
    <main>
      <section className="border-b border-border bg-paper-50">
        <Container size="xl" className="py-16 text-center sm:py-20">
          <Badge variant="accent">{t('common:nav.pricing')}</Badge>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold text-balance text-ink-950 sm:text-5xl">
            {t('landing:pricingPage.plansThatScaleWithYour')}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-500">
            {t('landing:pricingPage.fadeupIsInEarlyAccess')}
          </p>
        </Container>
      </section>

      {/* Tier cards */}
      <section>
        <Container size="xl" className="py-16 sm:py-20">
          <div className="grid gap-6 lg:grid-cols-3">
            {TIERS.map((tier) => (
              <Card
                key={tier.name}
                elevated={tier.featured}
                className={cn('flex flex-col', tier.featured && 'border-accent-600')}
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{tier.name}</CardTitle>
                    {tier.featured ? <Badge variant="accent">{t('landing:pricingPage.mostCommon')}</Badge> : null}
                  </div>
                  <CardDescription>{tier.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col pt-0">
                  <p className="text-sm font-medium text-ink-950">{tier.scope}</p>
                  <ul className="mt-4 flex flex-1 flex-col gap-2">
                    {tier.highlights.map((highlight) => (
                      <li key={highlight} className="flex items-start gap-2 text-sm text-ink-700">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden="true" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/pro/register"
                    className={buttonVariants({ variant: tier.featured ? 'primary' : 'secondary' }, 'mt-6 w-full')}
                  >
                    {t('common:auth.startFree')}
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-ink-500">
            Illustrative structure — final plan pricing hasn&apos;t been announced.
          </p>
        </Container>
      </section>

      {/* Feature comparison */}
      <section className="border-t border-border bg-paper-50">
        <Container size="xl" className="py-16 sm:py-20">
          <h2 className="text-2xl font-semibold text-balance text-ink-950 sm:text-3xl">
            {t('landing:pricingPage.comparePlanFeatures')}
          </h2>
          <div className="mt-8">
            <Table label={t('landing:pricingPage.featureComparisonByPlan')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('landing:pricingPage.feature')}</TableHead>
                  {TIERS.map((tier) => (
                    <TableHead key={tier.name} className="text-center">
                      {tier.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {COMPARISON_ROWS.map((row) => (
                  <TableRow key={row.feature}>
                    <TableCell className="font-medium text-ink-950">{row.feature}</TableCell>
                    {row.tiers.map((included, index) => (
                      <TableCell key={TIERS[index].name} className="text-center">
                        {included ? (
                          <Check className="mx-auto h-4 w-4 text-success-600" aria-label={t('landing:pricingPage.included')} />
                        ) : (
                          <Minus className="mx-auto h-4 w-4 text-ink-300" aria-label={t('landing:pricingPage.notIncluded')} />
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="border-t border-border">
        <Container size="lg" className="py-16 sm:py-20">
          <h2 className="text-2xl font-semibold text-balance text-ink-950 sm:text-3xl">
            {t('landing:pricingPage.pricingQuestions')}
          </h2>
          <dl className="mt-8 flex flex-col gap-6">
            {FAQ.map((item) => (
              <div key={item.question}>
                <dt className="text-base font-medium text-ink-950">{item.question}</dt>
                <dd className="mt-1 text-sm text-ink-500">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border bg-paper-50">
        <Container size="xl" className="flex flex-col items-center gap-4 py-16 text-center sm:py-20">
          <h2 className="text-3xl font-semibold text-balance text-ink-950">
            {t('landing:pricingPage.setUpYourShopOn')}
          </h2>
          <Link to="/pro/register" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            {t('common:auth.startFree')}
          </Link>
        </Container>
      </section>
    </main>
  )
}
