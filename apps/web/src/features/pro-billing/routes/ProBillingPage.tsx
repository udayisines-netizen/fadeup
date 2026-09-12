import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProEntitlements, useProOrganization } from '@/shared/data/organization'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { deviceTimezone } from '@/shared/lib/format'
import { useIsDesktop } from '@/shared/hooks/useMediaQuery'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Dialog } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { Select } from '@/shared/ui/Select'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { useToast } from '@/shared/ui/Toast'
import { IconBilling } from '@/shared/ui/icons'
import {
  useBillingCatalog,
  useBillingState,
  useCancelSubscription,
  useChangePlan,
  useOpenPortal,
  useRequestQuote,
  useStartCheckout,
  useStartTrial,
} from '@/features/pro-billing/api/billing'
import {
  annualMonthsFree,
  billingSituation,
  canStartTrial,
  intervalAvailable,
  needsQuote,
  parseBillingRefusal,
  plansFor,
  priceFor,
  tierFor,
  type BillingInterval,
} from '@/features/pro-billing/lib/billing'

/**
 * OS-3 §5 — l'abonnement du professionnel. Régime AÉRÉ mais SOBRE (P1PRO §3).
 *
 * PROPRIÉTAIRE SEUL. Ce n'est pas une décision d'écran : `organization_billing`
 * a une RLS `owner`-seulement et chaque RPC d'écriture commence par
 * `private.assert_not_in_support_view` puis `private.assert_billing_owner`
 * (B3, cinq refus de manager testés). L'écran ne rend donc rien d'utile à un
 * autre rôle — pas un cadenas, une phrase.
 *
 * CE QUE FADEUP N'A PAS, ET NE PRÉTEND PAS AVOIR : le moyen de paiement et
 * les factures ne sont PAS en base. Ils vivent chez Stripe, et le portail
 * client est le seul endroit où les lire. L'écran le dit.
 *
 * LA GRÂCE DE SEPT JOURS est annoncée sans dramatiser : les capacités sont
 * conservées jusqu'à l'échéance, la phrase donne la date et le chemin de
 * correction.
 *
 * TOUT EST EN MODE TEST STRIPE. Le passage en réel est une décision du
 * fondateur (B3 §14) ; rien ici ne le déclenche.
 */

function PanelTitle({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
      {icon}
      {label.toLocaleUpperCase()}
    </h2>
  )
}

const panelClass = 'rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4 lg:p-5'

export function ProBillingPage() {
  const { t } = useTranslation('v2')
  const { toast } = useToast()
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()

  const { organization, loading: orgLoading } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const timezone = organization?.locations[0]?.timezone ?? deviceTimezone()
  const isOwner = organization?.role === 'owner'

  const { entitlements } = useProEntitlements(organizationId)
  const establishments = entitlements?.usedEstablishments ?? 1

  const state = useBillingState(organizationId, isOwner)
  const catalog = useBillingCatalog()
  const [interval, setInterval] = useState<BillingInterval>('month')
  const [confirmCancel, setConfirmCancel] = useState(false)

  const checkout = useStartCheckout(organizationId)
  const portal = useOpenPortal(organizationId)
  const changePlan = useChangePlan(organizationId)
  const cancel = useCancelSubscription(organizationId)
  const trial = useStartTrial(organizationId)
  const quote = useRequestQuote(organizationId)

  const now = useMemo(() => new Date(), [])
  const situation = billingSituation(state.data?.billing ?? null, state.data?.trial ?? null, now)
  const plans = useMemo(() => plansFor(catalog.data ?? [], establishments), [catalog.data, establishments])
  const currentTier = useMemo(() => tierFor(catalog.data ?? [], establishments), [catalog.data, establishments])
  const beyondGrid = needsQuote(catalog.data ?? [], establishments)

  // Retour de Checkout : Stripe renvoie sur cet écran avec un drapeau. Les
  // webhooks sont traités par le scheduler, donc l'état peut arriver une
  // seconde plus tard — on le dit, et on rafraîchit.
  const checkoutFlag = searchParams.get('checkout')
  useEffect(() => {
    if (checkoutFlag === null) return
    if (checkoutFlag === 'success') {
      toast({ tone: 'success', title: t('pro.billing.checkout.successTitle'), description: t('pro.billing.checkout.successBody') })
      void state.refetch()
    } else {
      toast({ tone: 'neutral', title: t('pro.billing.checkout.cancelled') })
    }
    const next = new URLSearchParams(searchParams)
    next.delete('checkout')
    setSearchParams(next, { replace: true })
    /* Le drapeau SEUL commande cet effet, et il est retiré juste après : le
       lister avec `state`, `searchParams` et `t` — qui changent d'identité à
       chaque rendu — relancerait le toast en boucle. Le garde-fou est que
       l'effet se termine par la suppression du drapeau qui l'a déclenché. */
  }, [checkoutFlag])

  const refusalFor = (error: unknown) => {
    const named = parseBillingRefusal(error)
    if (named !== null) {
      return t(`pro.billing.refusal.${named}`, { defaultValue: t('pro.billing.refusal.unknown') })
    }
    return t(errorMessageKey(toAppError(error)))
  }

  const goToUrl = (url: string) => {
    window.location.assign(url)
  }

  if (!orgLoading && !isOwner) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-5 lg:px-8 lg:py-8" data-testid="pro-billing">
        <div className={panelClass} data-testid="pro-billing-forbidden">
          <EmptyState
            icon={<IconBilling aria-hidden="true" />}
            title={t('pro.billing.forbidden.title')}
            description={t('pro.billing.forbidden.description')}
            action={
              <Link
                to="/dashboard"
                className="inline-flex min-h-11 items-center text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
              >
                {t('pro.billing.forbidden.action')}
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  const loading = orgLoading || state.isPending

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 lg:px-8 lg:py-8" data-testid="pro-billing">
      <header className="mb-4 lg:mb-6">
        <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)] lg:text-fu-2xl">
          {t('pro.billing.title')}
        </h1>
        <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.billing.subtitle')}</p>
      </header>

      {loading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t('common.a11y.loading')}>
          <SkeletonRect className="h-32 w-full" />
          <SkeletonRect className="h-48 w-full" />
        </div>
      ) : state.error ? (
        <div className={panelClass} data-testid="pro-billing-error">
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{refusalFor(state.error)}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void state.refetch()}>
            {t('common.action.retry')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:gap-5">
          {/* LA GRÂCE — annoncée clairement, sans dramatiser, avec le chemin. */}
          {situation.kind === 'grace' && (
            <section
              className={`${panelClass} border-[var(--fu-state-warn)]`}
              data-testid="pro-billing-grace"
            >
              <PanelTitle label={t('pro.billing.grace.label')} />
              <p className="mt-2 text-fu-base text-[var(--fu-text-primary)]">
                {situation.graceUntil === ''
                  ? t('pro.billing.grace.bodyNoDate')
                  : t('pro.billing.grace.body', { count: situation.daysLeft })}
              </p>
              {situation.graceUntil !== '' && (
                <p className="mt-1 font-fu-mono text-fu-sm tabular-nums text-[var(--fu-state-warn)]">
                  <DateTime value={situation.graceUntil} timezone={timezone} format="date" />
                </p>
              )}
              <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.billing.grace.kept')}</p>
              <Button
                variant="primary"
                className="mt-3"
                loading={portal.isPending}
                onClick={() => portal.mutate(undefined, { onSuccess: (result) => goToUrl(result.url) })}
                data-testid="pro-billing-grace-fix"
              >
                {t('pro.billing.grace.action')}
              </Button>
            </section>
          )}

          {/* L'ÉTAT de l'abonnement. */}
          <section className={panelClass} data-testid="pro-billing-state">
            <PanelTitle label={t('pro.billing.stateLabel')} icon={<IconBilling aria-hidden="true" className="size-3.5" />} />
            <p className="mt-2 text-fu-xl font-semibold text-[var(--fu-text-primary)]" data-testid="pro-billing-plan">
              {catalog.data?.find((plan) => plan.plan_key === (state.data?.billing?.plan_key ?? entitlements?.planKey))
                ?.display_name ?? t('pro.billing.planFree')}
            </p>
            <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="pro-billing-situation">
              {situation.kind === 'trial'
                ? t('pro.billing.situation.trial', { count: situation.daysLeft })
                : situation.kind === 'trial-expired'
                  ? t('pro.billing.situation.trialExpired')
                  : situation.kind === 'active'
                    ? t(
                        situation.interval === 'year'
                          ? 'pro.billing.situation.activeYear'
                          : 'pro.billing.situation.activeMonth',
                      )
                    : situation.kind === 'cancelling'
                      ? t('pro.billing.situation.cancelling')
                      : situation.kind === 'canceled'
                        ? t('pro.billing.situation.canceled')
                        : situation.kind === 'grace'
                          ? t('pro.billing.situation.grace')
                          : t('pro.billing.situation.free')}
            </p>

            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-[var(--fu-border)] pt-3">
              {state.data?.billing?.current_period_end && (
                <div>
                  <dt className="text-fu-xs text-[var(--fu-text-secondary)]">
                    {state.data.billing.cancel_at_period_end
                      ? t('pro.billing.endsAt')
                      : t('pro.billing.renewsAt')}
                  </dt>
                  <dd className="font-fu-mono text-fu-lg tabular-nums" data-testid="pro-billing-period-end">
                    <DateTime value={state.data.billing.current_period_end} timezone={timezone} format="date" />
                  </dd>
                </div>
              )}
              {situation.kind === 'trial' && (
                <div>
                  <dt className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.billing.trialEndsAt')}</dt>
                  <dd className="font-fu-mono text-fu-lg tabular-nums" data-testid="pro-billing-trial-end">
                    <DateTime value={situation.endsAt} timezone={timezone} format="date" />
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.billing.establishments')}</dt>
                <dd className="font-fu-mono text-fu-lg tabular-nums">{establishments}</dd>
              </div>
            </dl>

            {/* Un changement de plan déjà PROGRAMMÉ (descente en fin de
                période, ou bascule de palier annoncée par B3). */}
            {state.data?.billing?.scheduled_plan_key && state.data.billing.scheduled_effective_at && (
              <p className="mt-3 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="pro-billing-scheduled">
                {t('pro.billing.scheduled', {
                  plan:
                    catalog.data?.find((plan) => plan.plan_key === state.data?.billing?.scheduled_plan_key)
                      ?.display_name ?? state.data.billing.scheduled_plan_key,
                })}{' '}
                <DateTime value={state.data.billing.scheduled_effective_at} timezone={timezone} format="date" />
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {canStartTrial(state.data?.trial ?? null, situation) && (
                <Button
                  variant="primary"
                  loading={trial.isPending}
                  onClick={() =>
                    trial.mutate(undefined, {
                      onSuccess: () => toast({ tone: 'success', title: t('pro.billing.trial.started') }),
                      onError: (error) => toast({ tone: 'error', title: refusalFor(error) }),
                    })
                  }
                  data-testid="pro-billing-start-trial"
                >
                  {t('pro.billing.trial.action')}
                </Button>
              )}
              {state.data?.billing?.stripe_customer_id && (
                <Button
                  variant="secondary"
                  loading={portal.isPending}
                  onClick={() =>
                    portal.mutate(undefined, {
                      onSuccess: (result) => goToUrl(result.url),
                      onError: (error) => toast({ tone: 'error', title: refusalFor(error) }),
                    })
                  }
                  data-testid="pro-billing-portal"
                >
                  {t('pro.billing.portal.action')}
                </Button>
              )}
              {(situation.kind === 'active' || situation.kind === 'grace') && !state.data?.billing?.cancel_at_period_end && (
                <Button variant="tertiary" onClick={() => setConfirmCancel(true)} data-testid="pro-billing-cancel">
                  {t('pro.billing.cancel.action')}
                </Button>
              )}
            </div>

            {/* Moyen de paiement et factures : chez Stripe, et on le DIT. */}
            <p className="mt-3 text-fu-xs text-[var(--fu-text-secondary)]" data-testid="pro-billing-portal-note">
              {t('pro.billing.portal.note')}
            </p>
          </section>

          {/* LA GRILLE, lue en base. */}
          <section className={panelClass} data-testid="pro-billing-plans">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <PanelTitle label={t('pro.billing.plansLabel')} />
              {isDesktop ? (
                <SegmentedControl
                  label={t('pro.billing.intervalLabel')}
                  options={[
                    { value: 'month', label: t('pro.billing.interval.month') },
                    { value: 'year', label: t('pro.billing.interval.year') },
                  ]}
                  value={interval}
                  onValueChange={(value) => setInterval(value as BillingInterval)}
                />
              ) : (
                <Select
                  label={t('pro.billing.intervalLabel')}
                  options={[
                    { value: 'month', label: t('pro.billing.interval.month') },
                    { value: 'year', label: t('pro.billing.interval.year') },
                  ]}
                  value={interval}
                  onValueChange={(value) => setInterval(value as BillingInterval)}
                  className="w-full"
                />
              )}
            </div>

            {catalog.isPending ? (
              <div className="mt-3" aria-busy="true">
                <SkeletonRect className="h-28 w-full" />
              </div>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                {plans.map((plan) => {
                  const price = priceFor(plan, interval)
                  const isCurrent = plan.plan_key === (state.data?.billing?.plan_key ?? entitlements?.planKey)
                  const available = intervalAvailable(plan, interval) && price !== null
                  const hasSubscription = Boolean(state.data?.billing?.stripe_subscription_id ?? state.data?.billing?.stripe_customer_id)
                  return (
                    <div
                      key={plan.plan_key}
                      className={`rounded-[var(--radius-card)] border p-4 ${isCurrent ? 'border-[var(--fu-accent)]' : 'border-[var(--fu-border)]'}`}
                      data-testid={`pro-billing-plan-${plan.plan_key}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-fu-base font-semibold text-[var(--fu-text-primary)]">
                          {plan.display_name}
                        </h3>
                        {isCurrent && <Badge variant="brand">{t('pro.billing.current')}</Badge>}
                      </div>
                      <p className="mt-2 font-fu-mono text-fu-xl font-semibold tabular-nums text-[var(--fu-text-primary)]">
                        {price === null ? '—' : <Money cents={price} currency={plan.price_currency} />}
                      </p>
                      <p className="mt-0.5 text-fu-xs text-[var(--fu-text-secondary)]">
                        {interval === 'year'
                          ? t('pro.billing.perYear', { free: annualMonthsFree(plan) })
                          : t('pro.billing.perMonth')}
                      </p>
                      {plan.commercial_family === 'multi_salon' && (
                        <p className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]">
                          {t('pro.billing.tierRange', {
                            min: plan.min_establishments,
                            max: plan.max_establishments,
                          })}
                        </p>
                      )}
                      {!isCurrent && available && (
                        <Button
                          variant="secondary"
                          className="mt-3"
                          fullWidth
                          loading={checkout.isPending || changePlan.isPending}
                          onClick={() => {
                            const input = { planKey: plan.plan_key, interval }
                            if (hasSubscription) {
                              changePlan.mutate(input, {
                                onSuccess: (result) =>
                                  toast({
                                    tone: 'success',
                                    title: t(
                                      result.decision === 'immediate'
                                        ? 'pro.billing.change.immediate'
                                        : 'pro.billing.change.scheduled',
                                    ),
                                  }),
                                onError: (error) => toast({ tone: 'error', title: refusalFor(error) }),
                              })
                            } else {
                              checkout.mutate(input, {
                                onSuccess: (result) => goToUrl(result.url),
                                onError: (error) => toast({ tone: 'error', title: refusalFor(error) }),
                              })
                            }
                          }}
                          data-testid={`pro-billing-choose-${plan.plan_key}`}
                        >
                          {hasSubscription ? t('pro.billing.change.action') : t('pro.billing.subscribe')}
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Les paliers multi-établissements : jamais un blocage. */}
            {establishments >= 2 && currentTier !== null && (
              <p className="mt-3 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="pro-billing-tier">
                {t('pro.billing.tierCurrent', { plan: currentTier.display_name, count: establishments })}
              </p>
            )}
            {beyondGrid && (
              <div
                className="mt-3 rounded-[var(--radius-card)] border border-[var(--fu-border-strong)] p-3"
                data-testid="pro-billing-quote"
              >
                <p className="text-fu-sm text-[var(--fu-text-primary)]">
                  {t('pro.billing.quote.body', { count: establishments })}
                </p>
                {state.data?.openQuote ? (
                  <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="pro-billing-quote-open">
                    {t('pro.billing.quote.pending')}{' '}
                    <DateTime value={state.data.openQuote.created_at} timezone={timezone} format="date" />
                  </p>
                ) : (
                  <Button
                    variant="secondary"
                    className="mt-2"
                    loading={quote.isPending}
                    onClick={() =>
                      quote.mutate(
                        { establishments },
                        {
                          onSuccess: () => toast({ tone: 'success', title: t('pro.billing.quote.sent') }),
                          onError: (error) => toast({ tone: 'error', title: refusalFor(error) }),
                        },
                      )
                    }
                    data-testid="pro-billing-request-quote"
                  >
                    {t('pro.billing.quote.action')}
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Résilier : derrière une confirmation, et jamais destructeur — le
          profil, la réputation et l'historique restent (B3). */}
      <Dialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('pro.billing.cancel.confirmTitle')}
        description={t('pro.billing.cancel.confirmBody')}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            loading={cancel.isPending}
            onClick={() =>
              cancel.mutate(undefined, {
                onSuccess: () => {
                  setConfirmCancel(false)
                  toast({ tone: 'success', title: t('pro.billing.cancel.done') })
                },
                onError: (error) => toast({ tone: 'error', title: refusalFor(error) }),
              })
            }
            data-testid="pro-billing-cancel-confirm"
          >
            {t('pro.billing.cancel.confirmAction')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
            {t('common.action.cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
