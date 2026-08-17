import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Check, Clock } from 'lucide-react'
import {
  hasRetentionSuite,
  liveCapabilities,
  plansForMode,
  recommendedPlanFor,
  type Plan,
  type PlanId,
} from '@/lib/commerce/plans'
import { useFadeUpPricing } from '@/lib/commerce/pricing-context'
import { useBusinessMode } from '@/components/for-business/business-mode'
import { cn } from '@/lib/cn'

/**
 * The pricing moment — a plan rail, not a wall of identical cards.
 *
 * It obeys the same rule as everything above it: the page has already asked
 * what kind of business you run, so it shows the plans for THAT business and no
 * others. An independent barber never scrolls past six salon columns to find the
 * one line that applies to them.
 *
 * One plan is expanded at a time. Collapsed rows still show name and price —
 * enough to compare — while the expanded one shows what you actually get, which
 * keeps the first viewport readable instead of forty checkmarks deep.
 *
 * Two invariants are stated in every expansion, because they are the two things
 * a visitor most needs to understand and most easily gets wrong:
 *
 *   Fade Passport is in EVERY plan. It is never an upgrade.
 *   The Retention Suite is Pro-level, and is not built yet — so it is labelled
 *   as coming, never counted among what the plan includes today.
 */
export function PricingStage() {
  const { t } = useTranslation('landing')
  const { mode } = useBusinessMode()
  const { formatPlan, isResolved } = useFadeUpPricing()
  const reduced = useReducedMotion()

  const plans = plansForMode(mode)
  const recommended = recommendedPlanFor(mode)
  const [selected, setSelected] = useState<PlanId>(recommended.id)

  // Switching business mode mid-page must not leave a salon plan selected in the
  // independent rail. The recommended plan of the new mode is the honest reset.
  useEffect(() => {
    setSelected(recommendedPlanFor(mode).id)
  }, [mode])

  return (
    <div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-paper-0">
        {plans.map((plan) => (
          <li key={plan.id}>
            <PlanRow
              plan={plan}
              expanded={plan.id === selected}
              // A single-plan family is always open: there is nothing to choose
              // between, so making it collapsible would be a control that does
              // nothing.
              collapsible={plans.length > 1}
              price={isResolved ? formatPlan(plan.id) : null}
              onSelect={() => setSelected(plan.id)}
              reduced={reduced === true}
            />
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm text-ink-500">
        {isResolved ? t('business.pricing.taxNote') : t('business.pricing.resolving')}
      </p>
    </div>
  )
}

function PlanRow({
  plan,
  expanded,
  collapsible,
  price,
  onSelect,
  reduced,
}: {
  plan: Plan
  expanded: boolean
  collapsible: boolean
  price: string | null
  onSelect: () => void
  reduced: boolean
}) {
  const { t } = useTranslation('landing')
  const open = expanded || !collapsible

  const header = (
    <div className="flex w-full items-baseline gap-4 px-5 py-5 text-start sm:px-7">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-xl text-ink-950 sm:text-2xl">
            {t(`business.plans.${plan.id}.name`)}
          </span>
          {plan.recommended && collapsible ? (
            <span className="rounded-full bg-accent-100 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-accent-800">
              {t('business.pricing.recommended')}
            </span>
          ) : null}
        </div>
        {/*
          Wraps rather than truncates. This line is what distinguishes one plan
          from the next in the collapsed rail — "Run it live, and bring them
          b…" beside a price tells a phone reader nothing.
        */}
        <p className="mt-1 text-sm text-ink-500">{t(`business.plans.${plan.id}.positioning`)}</p>
      </div>

      <div className="shrink-0 text-end">
        <span className="font-mono text-2xl tabular-nums text-ink-950 sm:text-3xl">{price ?? '—'}</span>
        <span className="block text-[11px] uppercase tracking-[0.12em] text-ink-500">
          {t('business.pricing.perMonth')}
        </span>
      </div>
    </div>
  )

  return (
    <div className={cn(open && collapsible && 'bg-paper-50')}>
      {collapsible ? (
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={open}
          aria-controls={`plan-detail-${plan.id}`}
          className="w-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600"
        >
          {header}
        </button>
      ) : (
        header
      )}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={`plan-detail-${plan.id}`}
            key="detail"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <PlanDetail plan={plan} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function PlanDetail({ plan }: { plan: Plan }) {
  const { t } = useTranslation('landing')
  const live = liveCapabilities(plan.id)

  return (
    <div className="border-t border-border px-5 pb-7 pt-6 sm:px-7">
      <p className="max-w-lg text-base leading-relaxed text-ink-700">
        {t(`business.plans.${plan.id}.body`)}
      </p>

      {plan.locationLimit !== null && plan.locationLimit > 1 ? (
        <p className="mt-3 text-sm text-ink-500">
          {t('business.pricing.locationLimit', { count: plan.locationLimit })}
        </p>
      ) : null}

      {/*
        Only capabilities that are actually shipped. `liveCapabilities()` filters
        by status, so an unbuilt feature cannot reach this list by someone
        forgetting to check a flag here.
      */}
      <ul className="mt-6 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {live.map((id) => (
          <li key={id} className="flex items-start gap-2 text-sm text-ink-950">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden="true" />
            <span>{t(`business.capabilities.${id}`)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        {/*
          The Passport line is on EVERY plan's card, deliberately identical, so
          flicking between plans shows it never changing. That is the fastest way
          to communicate "this is not the thing you upgrade for".
        */}
        <p className="rounded-lg border border-accent-600/30 bg-accent-100/50 px-4 py-3 text-sm text-accent-800">
          <span className="font-medium">{t('business.capabilities.passport')}</span>
          <span className="mt-0.5 block text-accent-800/80">{t('business.pricing.passportEveryPlan')}</span>
        </p>

        <p
          className={cn(
            'rounded-lg border border-dashed px-4 py-3 text-sm',
            hasRetentionSuite(plan.id) ? 'border-border-strong text-ink-700' : 'border-border text-ink-500',
          )}
        >
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {t('business.pricing.retentionSuite')}
          </span>
          <span className="mt-0.5 block">
            {hasRetentionSuite(plan.id)
              ? t('business.pricing.retentionComingToPlan')
              : t('business.pricing.retentionNotInPlan')}
          </span>
        </p>
      </div>

      <Link
        to={`/pro/register?plan=${plan.id}`}
        className="group mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-accent-600 px-7 text-base font-medium text-on-accent transition-colors hover:bg-accent-700"
      >
        {t('business.pricing.choose', { name: t(`business.plans.${plan.id}.name`) })}
        <ArrowRight
          className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180"
          aria-hidden="true"
        />
      </Link>
      <p className="mt-3 text-sm text-ink-500">{t('business.pricing.applicationNote')}</p>
    </div>
  )
}
