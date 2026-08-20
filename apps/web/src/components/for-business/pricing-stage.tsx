import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, Clock } from 'lucide-react'
import {
  hasRetentionSuite,
  liveCapabilities,
  plansForMode,
  type Plan,
} from '@/lib/commerce/plans'
import { useFadeUpPricing } from '@/lib/commerce/pricing-context'
import { useBusinessMode } from '@/components/for-business/business-mode'
import { cn } from '@/lib/cn'

/**
 * The pricing moment: the plans for THIS business, side by side.
 *
 * It used to be an accordion rail where one plan opened at a time. That kept
 * the first viewport short, but it also meant a visitor comparing two plans
 * had to open one, remember it, and open the other. Comparison is the entire
 * job of a pricing section, so the plans are now cards you read at once.
 *
 * The grid follows the data, never the layout. `plansForMode` returns what
 * that business type genuinely has: three for a shop, three for multi-location,
 * one for an independent barber. A single plan renders as a single centred
 * card rather than a lonely column padded out with two invented offers.
 *
 * Two invariants are repeated on every card, because they are the two things a
 * visitor most needs and most easily gets wrong:
 *
 *   Fade Passport is in EVERY plan. It is never the reason to upgrade.
 *   The Retention Suite is not built yet, so it is labelled as coming and
 *   never counted among what a plan includes today.
 *
 * Nothing about prices, currency, plan identity or CTA destinations is decided
 * here. All of it comes from lib/commerce exactly as before.
 */
export function PricingStage() {
  const { t } = useTranslation('landing')
  const { mode } = useBusinessMode()
  const { formatPlan, isResolved } = useFadeUpPricing()

  const plans = plansForMode(mode)

  return (
    <div>
      <ul
        className={cn(
          'grid gap-5',
          // Three real plans get three columns; one real plan gets one card,
          // centred, at a readable width.
          plans.length >= 3 ? 'lg:grid-cols-3' : 'mx-auto max-w-md',
        )}
      >
        {plans.map((plan) => (
          <li key={plan.id} className="flex">
            <PlanCard plan={plan} price={isResolved ? formatPlan(plan.id) : null} />
          </li>
        ))}
      </ul>

      <p className="mt-6 text-center text-sm text-[var(--pro-faint)]">
        {isResolved ? t('business.pricing.taxNote') : t('business.pricing.resolving')}
      </p>
    </div>
  )
}

function PlanCard({ plan, price }: { plan: Plan; price: string | null }) {
  const { t } = useTranslation('landing')
  const live = liveCapabilities(plan.id)
  const name = t(`business.plans.${plan.id}.name`)

  return (
    <div
      className={cn(
        'relative flex w-full flex-col p-7 sm:p-8',
        // The recommended plan is marked by its own light, not by an outline.
        // `plan.recommended` is existing product data: nothing is invented and
        // no "most popular" badge is fabricated where the catalog has none.
        plan.recommended ? 'pro-glass-elevated' : 'pro-glass-card',
      )}
    >
      {plan.recommended ? (
        <span className="mb-4 inline-flex w-fit rounded-full bg-[color-mix(in_srgb,var(--pro-emerald)_22%,transparent)] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--pro-highlight)]">
          {t('business.pricing.recommended')}
        </span>
      ) : null}

      <h3 className="text-xl font-semibold tracking-tight text-[var(--pro-text)]">{name}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--pro-muted)]">
        {t(`business.plans.${plan.id}.positioning`)}
      </p>

      {/* The price is the largest thing on the card, which is what a visitor came for. */}
      <div className="mt-7 flex items-baseline gap-2">
        <span className="font-mono text-5xl tabular-nums tracking-tight text-[var(--pro-text)]">
          {price ?? '·'}
        </span>
        <span className="text-xs uppercase tracking-[0.14em] text-[var(--pro-faint)]">
          {t('business.pricing.perMonth')}
        </span>
      </div>

      {plan.locationLimit !== null && plan.locationLimit > 1 ? (
        <p className="mt-2 text-sm text-[var(--pro-faint)]">
          {t('business.pricing.locationLimit', { count: plan.locationLimit })}
        </p>
      ) : null}

      <Link
        to={`/pro/register?plan=${plan.id}`}
        className={cn(
          'mt-7 inline-flex min-h-12 items-center justify-center rounded-[var(--pro-r-button)] px-6 text-base font-medium transition-colors duration-200',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pro-highlight)]',
          plan.recommended
            ? 'bg-[var(--pro-accent)] text-[var(--pro-on-accent)] hover:bg-[var(--pro-accent-hover)]'
            : 'bg-[color-mix(in_srgb,var(--pro-offwhite)_8%,transparent)] text-[var(--pro-text)] hover:bg-[color-mix(in_srgb,var(--pro-offwhite)_14%,transparent)]',
        )}
      >
        {t('business.pricing.choose', { name })}
      </Link>

      {/*
        Only capabilities that are actually shipped. `liveCapabilities()` filters
        by status, so an unbuilt feature cannot reach this list because someone
        forgot to check a flag here.
      */}
      <ul className="mt-8 flex-1 space-y-2.5">
        {live.map((id) => (
          <li key={id} className="flex items-start gap-2.5 text-sm text-[var(--pro-text)]">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--pro-highlight)]" aria-hidden="true" />
            <span>{t(`business.capabilities.${id}`)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-7 space-y-3 border-t border-[var(--pro-border)] pt-6">
        {/*
          Identical on every card, deliberately. Flicking between plans shows
          this line never changing, which is the fastest way to communicate
          "this is not the thing you upgrade for".
        */}
        <p className="text-sm text-[var(--pro-muted)]">
          <span className="font-medium text-[var(--pro-highlight)]">
            {t('business.capabilities.passport')}
          </span>{' '}
          {t('business.pricing.passportEveryPlan')}
        </p>

        <p className="flex items-start gap-2 text-sm text-[var(--pro-faint)]">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">{t('business.pricing.retentionSuite')}</span>{' '}
            {hasRetentionSuite(plan.id)
              ? t('business.pricing.retentionComingToPlan')
              : t('business.pricing.retentionNotInPlan')}
          </span>
        </p>
      </div>

      <p className="mt-5 text-xs text-[var(--pro-faint)]">{t('business.pricing.applicationNote')}</p>
    </div>
  )
}
