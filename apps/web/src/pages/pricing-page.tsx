import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Clock, Minus } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/cn'
import { useDocumentMeta } from '@/lib/use-document-meta'
import {
  CAPABILITIES,
  FREE_PLAN,
  PLANS,
  PLAN_IDS,
  plansForFamily,
  type CapabilityGroup,
  type CapabilityId,
  type CommercialFamily,
  type Plan,
} from '@/lib/commerce/plans'
import { useFadeUpPricing } from '@/lib/commerce/pricing-context'

/**
 * /pricing — the complete commercial offer, rendered from the ONE catalog.
 *
 * WHAT THIS PAGE USED TO BE, AND WHY IT HAD TO CHANGE
 *
 * Until R2 this page carried its own hardcoded tiers — Starter, Growth and
 * Multi-Location — with "Unlimited locations", its own ten-row feature table,
 * and a ✓ against Chair Mode. None of that was true: the catalog has never had
 * a plan called Starter, no plan has ever been unlimited, and `plans.ts` marks
 * Chair Mode `planned` because it is not built. Meanwhile /for-business showed
 * the real plans at the real prices. A product with two pricing pages has one
 * pricing page too many, and the wrong one was the one named /pricing.
 *
 * So every number, every plan and every checkmark here now comes from
 * `lib/commerce` — the same catalog the database mirrors, which
 * `catalog.test.ts` proves cannot drift from it. Nothing on this page can say
 * something the product does not do, because there is nowhere left to type it.
 *
 * THREE CELL STATES IN THE COMPARISON, AND THE THIRD IS THE POINT
 *
 *   ✓        included and shipped today
 *   Coming   packaged in this plan, not built yet — never a checkmark
 *   —        not in this plan
 *
 * A checkmark that means "we intend to build this" is a lie a pricing table
 * tells very efficiently, which is why `CAPABILITIES[id].status` decides the
 * cell rather than plan membership alone.
 *
 * The design language is unchanged: this is the light marketing surface
 * (paper/ink tokens, Container, Card, Table), not the Pro workspace's dark
 * system. R2 changes what the page SAYS, not what FadeUp looks like.
 */

const FAMILY_ORDER: CommercialFamily[] = ['independent', 'salon', 'multi_salon']

/**
 * Which existing translated label names each family.
 *
 * Reuses `business.pricing.types.*`, which the /for-business selector already
 * uses in ten languages, rather than introducing a second set of family names
 * that would need translating twice and could then disagree with the first.
 */
const FAMILY_LABEL_KEY: Record<CommercialFamily, string> = {
  free: 'business.pricing.types.independent',
  independent: 'business.pricing.types.independent',
  salon: 'business.pricing.types.barbershop',
  multi_salon: 'business.pricing.types.multi_location',
}

const GROUP_ORDER: CapabilityGroup[] = ['foundation', 'floor', 'retention', 'scale']

export function PricingPage() {
  const { t } = useTranslation()
  const { formatPlan, isResolved } = useFadeUpPricing()

  useDocumentMeta({
    title: `${t('common:nav.pricing')} — FadeUp`,
    description: t('landing:pricingPage.fadeupIsInEarlyAccess'),
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

      {/*
        Free comes first and sits on its own, because it is not a fourth column
        competing with the paid plans — it is the network everyone is already
        on. A legitimate state, never an expiry or a failed trial.
      */}
      <section className="border-b border-border">
        <Container size="xl" className="py-10">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-paper-50 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="max-w-2xl">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-500">
                {t('landing:pricingPage.freeEyebrow')}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-ink-950">
                {t('landing:business.plans.free.name')} ·{' '}
                <span className="font-mono tabular-nums">{isResolved ? formatPlan('free') : '·'}</span>
              </h2>
              <p className="mt-2 text-ink-700">{t('landing:business.plans.free.positioning')}</p>
              <p className="mt-1 text-sm text-ink-500">{t('landing:business.plans.free.body')}</p>
            </div>
            <Link
              to="/pro/register?plan=free"
              className={buttonVariants({ variant: 'secondary' }, 'shrink-0')}
            >
              {t('landing:pricingPage.freeCta')}
            </Link>
          </div>
        </Container>
      </section>

      {/* One section per commercial family, in the order a business grows. */}
      {FAMILY_ORDER.map((family) => (
        <FamilySection key={family} family={family} />
      ))}

      <section className="border-t border-border bg-paper-50">
        <Container size="xl" className="py-16 sm:py-20">
          <h2 className="text-2xl font-semibold text-balance text-ink-950 sm:text-3xl">
            {t('landing:pricingPage.comparePlanFeatures')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-500">{t('landing:business.compare.plannedNote')}</p>
          <CapabilityMatrix />
        </Container>
      </section>

      <section className="border-t border-border">
        <Container size="lg" className="py-16 sm:py-20">
          <h2 className="text-2xl font-semibold text-balance text-ink-950 sm:text-3xl">
            {t('landing:pricingPage.pricingQuestions')}
          </h2>
          <dl className="mt-8 flex flex-col gap-6">
            {(['final', 'team', 'locations', 'downgrade'] as const).map((key) => (
              <div key={key}>
                <dt className="text-base font-medium text-ink-950">
                  {t(`landing:pricingPage.faq.${key}.q`)}
                </dt>
                <dd className="mt-1 text-sm text-ink-500">{t(`landing:pricingPage.faq.${key}.a`)}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

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

function FamilySection({ family }: { family: CommercialFamily }) {
  const { t } = useTranslation()
  const plans = plansForFamily(family)
  if (plans.length === 0) return null

  return (
    <section className="border-b border-border">
      <Container size="xl" className="py-14 sm:py-16">
        <h2 className="text-2xl font-semibold text-ink-950">
          {t(`landing:${FAMILY_LABEL_KEY[family]}.label`)}
        </h2>
        <p className="mt-1 text-sm text-ink-500">{t(`landing:${FAMILY_LABEL_KEY[family]}.hint`)}</p>

        <div
          className={cn(
            'mt-8 grid gap-6',
            // One plan renders as a single readable card rather than a lonely
            // column padded out with two invented offers.
            plans.length >= 3 ? 'lg:grid-cols-3' : 'mx-auto max-w-md',
          )}
        >
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      </Container>
    </section>
  )
}

function PlanCard({ plan }: { plan: Plan }) {
  const { t } = useTranslation()
  const { formatPlan, isResolved } = useFadeUpPricing()
  const name = t(`landing:business.plans.${plan.id}.name`)

  return (
    <Card elevated={plan.recommended} className={cn('flex flex-col', plan.recommended && 'border-accent-600')}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{name}</CardTitle>
          {plan.recommended ? (
            <Badge variant="accent">{t('landing:business.pricing.recommended')}</Badge>
          ) : null}
        </div>
        <CardDescription>{t(`landing:business.plans.${plan.id}.positioning`)}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col pt-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-4xl tabular-nums tracking-tight text-ink-950">
            {isResolved ? formatPlan(plan.id) : '·'}
          </span>
          <span className="text-xs uppercase tracking-[0.14em] text-ink-500">
            {t('landing:business.pricing.perMonth')}
          </span>
        </div>

        {/* The supporting sentence sits under the price, where the visitor is. */}
        <p className="mt-3 text-sm leading-relaxed text-ink-700">
          {t(`landing:business.plans.${plan.id}.body`)}
        </p>

        <ul className="mt-4 flex flex-col gap-1 text-sm text-ink-500">
          {/*
            The establishment cap, only where the number IS the offer. A
            single-salon plan announcing "up to 1 location" reads as a
            restriction on a product that was never about several.
          */}
          {plan.maxEstablishments > 1 ? (
            <li>{t('landing:business.pricing.locationLimit', { count: plan.maxEstablishments })}</li>
          ) : null}
          {/*
            Driven by the commercial fact — null means unlimited in the catalog,
            the same null the database stores — rather than by a hardcoded plan
            list. FadeUp never charges per barber.
          */}
          {plan.maxOperationalProfessionals === null ? (
            <li>{t('landing:business.pricing.teamIncluded')}</li>
          ) : null}
        </ul>

        <div className="flex-1" />

        <Link
          to={`/pro/register?plan=${plan.id}`}
          className={buttonVariants(
            { variant: plan.recommended ? 'primary' : 'secondary' },
            'mt-6 w-full',
          )}
        >
          {t('landing:business.pricing.choose', { name })}
        </Link>
      </CardContent>
    </Card>
  )
}

/**
 * Every capability against every plan, including Free.
 *
 * Rendered from the catalog rather than from a hand-written row list, so a
 * capability cannot be listed here without existing, and cannot exist without
 * being listed.
 */
function CapabilityMatrix() {
  const { t } = useTranslation()
  const rows = (Object.keys(CAPABILITIES) as CapabilityId[]).sort(
    (a, b) => GROUP_ORDER.indexOf(CAPABILITIES[a].group) - GROUP_ORDER.indexOf(CAPABILITIES[b].group),
  )
  const columns = [FREE_PLAN, ...PLAN_IDS.filter((id) => id !== 'free').map((id) => PLANS[id])]

  return (
    <div className="relative mt-8 overflow-x-auto rounded-xl border border-border">
      <Table label={t('landing:business.compare.caption')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('landing:business.compare.feature')}</TableHead>
            {columns.map((plan) => (
              <TableHead key={plan.id} className="text-center">
                {t(`landing:business.plans.${plan.id}.name`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((capabilityId) => (
            <TableRow key={capabilityId}>
              <TableCell className="font-medium text-ink-950">
                {t(`landing:business.capabilities.${capabilityId}`)}
              </TableCell>
              {columns.map((plan) => (
                <TableCell key={plan.id} className="text-center">
                  <MatrixCell plan={plan} capabilityId={capabilityId} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function MatrixCell({ plan, capabilityId }: { plan: Plan; capabilityId: CapabilityId }) {
  const { t } = useTranslation()

  if (!plan.capabilities.includes(capabilityId)) {
    return (
      <Minus className="mx-auto h-4 w-4 text-ink-300" aria-label={t('landing:business.compare.notIncluded')} />
    )
  }

  // Packaged but not built. Never a checkmark, however much the plan costs.
  if (CAPABILITIES[capabilityId].status === 'planned') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-500">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {t('landing:business.compare.coming')}
      </span>
    )
  }

  return (
    <Check className="mx-auto h-4 w-4 text-success-600" aria-label={t('landing:business.compare.included')} />
  )
}
