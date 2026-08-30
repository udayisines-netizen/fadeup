import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useAuth } from '@/lib/auth-context'
import { useOrgCustomers } from '@/lib/queries/customers'
import { useOrgAppointmentsSince } from '@/lib/queries/appointments'
import {
  useCreateMembershipPlan,
  useOrgMembershipPlans,
  useUpdateMembershipPlan,
  type BillingInterval,
  type MembershipPlan,
} from '@/lib/queries/membership-plans'
import {
  useEnrollCustomerMembership,
  useOrgCustomerMemberships,
  useUpdateCustomerMembershipStatus,
  type CustomerMembershipStatus,
} from '@/lib/queries/customer-memberships'
import { useMoney, useOrganizationCurrency } from '@/lib/intl/use-intl'
import { toMajorUnits, toMinorUnits } from '@/lib/intl/money'
import { getErrorMessage } from '@/lib/get-error-message'
import type { MembershipRole } from '@/lib/types'
import { useProScope } from '@/pro-v2/shell/pro-v2-shell'

/**
 * Retention — the retention products FadeUp actually has, and nothing it
 * does not.
 *
 * ============================================================================
 * THREE REAL SURFACES
 * ============================================================================
 *
 * WIN-BACK — customers whose last COMPLETED visit is 60+ days old, computed
 * from real appointment rows over a 180-day lookback. A customer with any
 * upcoming non-cancelled booking is excluded — someone returning next week
 * is not lapsed, whatever their last visit date says. The panel shows the
 * customer's own recorded phone/email so the operator can reach out through
 * their own channel: FadeUp has no campaign or bulk-send contract, so this
 * page offers no "send" button it cannot honour (and no SMS, ever).
 *
 * MEMBERSHIP PLANS — the org's recurring plans, real rows from
 * `membership_plans`. Creating and editing is owner/manager work; the RLS
 * enforces that and the UI merely mirrors it.
 *
 * MEMBERS — real enrollments from `customer_memberships`. Pause/resume/
 * cancel are the staff transitions; a cancelled membership is never
 * reactivated in place (the table's one-open-per-customer constraint —
 * surfaced here as friendly copy when hit). Enrollment period end is start
 * plus one billing interval, the same derivation the legacy surface used.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY MISSING
 * ============================================================================
 *
 * PROMOTIONS / DISCOUNT CODES / CAMPAIGNS. No table, RPC or delivery
 * contract for any of them exists in the backend. Rendering a promotions
 * composer whose "publish" goes nowhere would be inventing capability, so
 * this page states memberships as the retention offer FadeUp truthfully
 * sells today — recorded as a backend gap, not a UI omission.
 */

const LOOKBACK_DAYS = 180
const LAPSED_DAYS = 60
const DAY_MS = 86_400_000
const WIN_BACK_SHOWN = 8

const PLAN_MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])
const ENROLLMENT_MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

const BILLING_INTERVALS: BillingInterval[] = ['weekly', 'monthly', 'yearly']

/** Enrollment periods start now and end one billing interval later — the same derivation the legacy surface used. */
function addInterval(billingInterval: BillingInterval): string {
  const now = new Date()
  if (billingInterval === 'weekly') now.setDate(now.getDate() + 7)
  else if (billingInterval === 'yearly') now.setFullYear(now.getFullYear() + 1)
  else now.setMonth(now.getMonth() + 1)
  return now.toISOString()
}

const planSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().min(0).finite(),
  billingInterval: z.enum(['weekly', 'monthly', 'yearly']),
  description: z.string().trim(),
})

type PlanForm = z.infer<typeof planSchema>

export function ProV2RetentionPage() {
  const { t, i18n } = useTranslation()
  const scope = useProScope()
  const { user } = useAuth()
  const money = useMoney()
  const currency = useOrganizationCurrency(scope.organizationId)

  const canManagePlans = PLAN_MANAGING_ROLES.has(scope.role)
  const canManageEnrollments = ENROLLMENT_MANAGING_ROLES.has(scope.role)

  const plans = useOrgMembershipPlans(scope.organizationId)
  const enrollments = useOrgCustomerMemberships(scope.organizationId)
  const customers = useOrgCustomers(scope.organizationId)

  const since = useMemo(
    () => new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString(),
    [],
  )
  const visits = useOrgAppointmentsSince(scope.organizationId, since)

  useDocumentMeta({
    title: t('app:v2pro.retention.documentTitle'),
    description: t('app:v2pro.retention.documentDescription'),
    noIndex: true,
  })

  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  // ── Win-back arithmetic on real rows ─────────────────────────────────────
  const lapsed = useMemo(() => {
    const now = Date.now()
    const lastCompleted = new Map<string, number>()
    const hasUpcoming = new Set<string>()

    for (const appointment of visits.data ?? []) {
      if (!appointment.customerId) continue
      if (scope.locationId && appointment.locationId !== scope.locationId) continue
      const at = new Date(appointment.startsAt).getTime()
      if (
        at > now &&
        appointment.status !== 'cancelled' &&
        appointment.status !== 'no_show'
      ) {
        hasUpcoming.add(appointment.customerId)
      }
      if (appointment.status === 'completed') {
        lastCompleted.set(
          appointment.customerId,
          Math.max(lastCompleted.get(appointment.customerId) ?? 0, at),
        )
      }
    }

    const rows = []
    for (const customer of customers.data ?? []) {
      const last = lastCompleted.get(customer.id)
      if (!last || hasUpcoming.has(customer.id)) continue
      const daysSince = Math.floor((now - last) / DAY_MS)
      if (daysSince >= LAPSED_DAYS) rows.push({ customer, daysSince, last })
    }
    rows.sort((a, b) => b.daysSince - a.daysSince)
    return rows
  }, [visits.data, customers.data, scope.locationId])

  const planName = (planId: string) =>
    (plans.data ?? []).find((plan) => plan.id === planId)?.name ?? null
  const customerName = (customerId: string) =>
    (customers.data ?? []).find((customer) => customer.id === customerId)?.name ?? null
  const activeCount = (planId: string) =>
    (enrollments.data ?? []).filter(
      (enrollment) => enrollment.planId === planId && enrollment.status === 'active',
    ).length

  // ── Plan form (create + edit share it) ───────────────────────────────────
  const [planFormOpen, setPlanFormOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const createPlan = useCreateMembershipPlan()
  const updatePlan = useUpdateMembershipPlan()

  const form = useForm<PlanForm>({
    resolver: zodResolver(planSchema),
    defaultValues: { name: '', price: 0, billingInterval: 'monthly', description: '' },
  })

  const openCreate = () => {
    setEditingPlan(null)
    form.reset({ name: '', price: 0, billingInterval: 'monthly', description: '' })
    setPlanError(null)
    setPlanFormOpen(true)
  }
  const openEdit = (plan: MembershipPlan) => {
    setEditingPlan(plan)
    form.reset({
      name: plan.name,
      price: toMajorUnits(plan.priceCents, currency),
      billingInterval: plan.billingInterval,
      description: plan.description ?? '',
    })
    setPlanError(null)
    setPlanFormOpen(true)
  }

  const submitPlan = form.handleSubmit((values) => {
    setPlanError(null)
    const input = {
      organizationId: scope.organizationId,
      name: values.name,
      description: values.description.length > 0 ? values.description : null,
      priceCents: toMinorUnits(values.price, currency),
      billingInterval: values.billingInterval,
      isActive: editingPlan ? editingPlan.isActive : true,
    }
    const done = {
      onSuccess: () => setPlanFormOpen(false),
      onError: (error: unknown) => setPlanError(getErrorMessage(error) ?? null),
    }
    if (editingPlan) updatePlan.mutate({ ...input, id: editingPlan.id }, done)
    else createPlan.mutate(input, done)
  })

  const togglePlanActive = (plan: MembershipPlan) => {
    updatePlan.mutate({
      id: plan.id,
      organizationId: plan.organizationId,
      name: plan.name,
      description: plan.description,
      priceCents: plan.priceCents,
      billingInterval: plan.billingInterval,
      isActive: !plan.isActive,
    })
  }

  // ── Enrollment ───────────────────────────────────────────────────────────
  const [enrollCustomerId, setEnrollCustomerId] = useState('')
  const [enrollPlanId, setEnrollPlanId] = useState('')
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const enroll = useEnrollCustomerMembership()
  const updateStatus = useUpdateCustomerMembershipStatus()

  const activePlans = (plans.data ?? []).filter((plan) => plan.isActive)

  const submitEnroll = () => {
    const plan = activePlans.find((candidate) => candidate.id === enrollPlanId)
    if (!plan || !enrollCustomerId) return
    setEnrollError(null)
    enroll.mutate(
      {
        organizationId: scope.organizationId,
        customerId: enrollCustomerId,
        planId: plan.id,
        currentPeriodEnd: addInterval(plan.billingInterval),
        notes: null,
        createdBy: user?.id ?? null,
      },
      {
        onSuccess: () => {
          setEnrollCustomerId('')
          setEnrollPlanId('')
        },
        onError: (error: unknown) => {
          const raw = getErrorMessage(error) ?? ''
          setEnrollError(
            raw.includes('customer_memberships_one_open_per_customer')
              ? t('app:v2pro.retention.alreadyEnrolled')
              : raw,
          )
        },
      },
    )
  }

  const transition = (id: string, status: CustomerMembershipStatus) =>
    updateStatus.mutate({ id, organizationId: scope.organizationId, status })

  const inputClass =
    'h-11 w-full rounded-v2-2 border border-v2-edge bg-v2-paper px-3 text-v2-body text-v2-ink'
  const smallButton =
    'v2-press flex min-h-11 items-center rounded-v2-1 px-2.5 text-v2-caption font-semibold text-v2-green hover:underline'

  const openEnrollments = (enrollments.data ?? []).filter(
    (enrollment) => enrollment.status === 'active' || enrollment.status === 'paused',
  )
  const closedEnrollments = (enrollments.data ?? []).filter(
    (enrollment) => enrollment.status === 'cancelled' || enrollment.status === 'expired',
  )

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
        {t('app:v2pro.nav.retention')}
      </h1>

      {/* ── Win-back ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2pro-winback" className="v2-plate overflow-hidden">
        <div className="px-4 py-3 md:px-5">
          <h2 id="v2pro-winback" className="text-v2-title font-semibold text-v2-ink">
            {t('app:v2pro.retention.winBackTitle')}
          </h2>
          <p className="mt-0.5 text-v2-meta text-v2-ink-soft">
            {t('app:v2pro.retention.winBackHint', { days: LAPSED_DAYS })}
          </p>
        </div>
        {visits.isPending || customers.isPending ? (
          <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
            <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
          </div>
        ) : visits.isError ? (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('customer-app:v2.discovery.errorTitle')}
          </p>
        ) : lapsed.length > 0 ? (
          <>
            <ul>
              {lapsed.slice(0, WIN_BACK_SHOWN).map(({ customer, daysSince }) => (
                <li
                  key={customer.id}
                  className="flex items-baseline gap-3 border-t border-v2-hairline px-4 py-2.5 md:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-v2-body font-medium text-v2-ink">
                      <bdi>{customer.name}</bdi>
                    </p>
                    {(customer.phone ?? customer.email) ? (
                      <p className="truncate text-v2-meta text-v2-ink-soft">
                        {customer.phone ?? customer.email}
                      </p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-v2-meta tabular-nums text-v2-ink-soft">
                    {t('app:v2pro.retention.daysAgo', { count: daysSince })}
                  </p>
                </li>
              ))}
            </ul>
            {lapsed.length > WIN_BACK_SHOWN ? (
              <p className="border-t border-v2-hairline px-4 py-2.5 text-v2-caption text-v2-ink-mute md:px-5">
                {t('app:v2pro.retention.moreLapsed', { count: lapsed.length - WIN_BACK_SHOWN })}
              </p>
            ) : null}
          </>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('app:v2pro.retention.winBackEmpty')}
          </p>
        )}
      </section>

      {/* ── Membership plans ─────────────────────────────────────────────── */}
      <section aria-labelledby="v2pro-plans" className="v2-plate overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
          <h2 id="v2pro-plans" className="text-v2-title font-semibold text-v2-ink">
            {t('app:v2pro.retention.plansTitle')}
          </h2>
          {canManagePlans && !planFormOpen ? (
            <button type="button" onClick={openCreate} className={smallButton}>
              {t('app:v2pro.retention.newPlan')}
            </button>
          ) : null}
        </div>

        {planFormOpen ? (
          <form
            onSubmit={(event) => void submitPlan(event)}
            className="flex flex-col gap-3 border-t border-v2-hairline px-4 py-4 md:px-5"
          >
            <label className="flex flex-col gap-1 text-v2-meta font-medium text-v2-ink">
              {t('app:v2pro.retention.planName')}
              <input {...form.register('name')} className={inputClass} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-v2-meta font-medium text-v2-ink">
                {t('app:v2pro.retention.planPrice', { currency })}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  {...form.register('price')}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-v2-meta font-medium text-v2-ink">
                {t('app:v2pro.retention.planInterval')}
                <select {...form.register('billingInterval')} className={inputClass}>
                  {BILLING_INTERVALS.map((interval) => (
                    <option key={interval} value={interval}>
                      {t(`app:v2pro.retention.interval.${interval}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-v2-meta font-medium text-v2-ink">
              {t('app:v2pro.retention.planDescription')}
              <input {...form.register('description')} className={inputClass} />
            </label>
            {form.formState.errors.name || form.formState.errors.price ? (
              <p className="text-v2-meta text-v2-alert">{t('app:v2pro.retention.planInvalid')}</p>
            ) : null}
            {planError ? <p className="text-v2-meta text-v2-alert">{planError}</p> : null}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createPlan.isPending || updatePlan.isPending}
                className="v2-press rounded-v2-2 bg-v2-green px-4 py-3 text-v2-body font-semibold text-white disabled:opacity-60"
              >
                {editingPlan
                  ? t('app:v2pro.retention.savePlan')
                  : t('app:v2pro.retention.createPlan')}
              </button>
              <button
                type="button"
                onClick={() => setPlanFormOpen(false)}
                className="v2-press rounded-v2-2 px-4 py-3 text-v2-body font-semibold text-v2-ink-soft"
              >
                {t('app:v2pro.retention.cancel')}
              </button>
            </div>
          </form>
        ) : null}

        {(plans.data ?? []).length > 0 ? (
          <ul>
            {(plans.data ?? []).map((plan) => (
              <li
                key={plan.id}
                className="flex items-center gap-3 border-t border-v2-hairline px-4 py-2.5 md:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-v2-body font-medium text-v2-ink">
                    <bdi>{plan.name}</bdi>
                    {!plan.isActive ? (
                      <span className="ms-2 text-v2-caption font-medium text-v2-ink-mute">
                        {t('app:v2pro.retention.inactive')}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-v2-meta text-v2-ink-soft">
                    {money(plan.priceCents, currency)} ·{' '}
                    {t(`app:v2pro.retention.per.${plan.billingInterval}`)} ·{' '}
                    {t('app:v2pro.retention.activeMembers', { count: activeCount(plan.id) })}
                  </p>
                </div>
                {canManagePlans ? (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => openEdit(plan)} className={smallButton}>
                      {t('app:v2pro.retention.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePlanActive(plan)}
                      className="v2-press flex min-h-11 items-center rounded-v2-1 px-2.5 text-v2-caption font-semibold text-v2-ink-soft hover:underline"
                    >
                      {plan.isActive
                        ? t('app:v2pro.retention.deactivate')
                        : t('app:v2pro.retention.activate')}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : plans.isPending ? (
          <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
            <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
          </div>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('app:v2pro.retention.plansEmpty')}
          </p>
        )}
      </section>

      {/* ── Members ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2pro-members" className="v2-plate overflow-hidden">
        <h2
          id="v2pro-members"
          className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5"
        >
          {t('app:v2pro.retention.membersTitle')}
        </h2>

        {canManageEnrollments && activePlans.length > 0 && (customers.data ?? []).length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-v2-hairline px-4 py-3 md:flex-row md:items-end md:px-5">
            <label className="flex flex-1 flex-col gap-1 text-v2-meta font-medium text-v2-ink">
              {t('app:v2pro.retention.enrollCustomer')}
              <select
                value={enrollCustomerId}
                onChange={(event) => setEnrollCustomerId(event.target.value)}
                className={inputClass}
              >
                <option value="">—</option>
                {(customers.data ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-v2-meta font-medium text-v2-ink">
              {t('app:v2pro.retention.enrollPlan')}
              <select
                value={enrollPlanId}
                onChange={(event) => setEnrollPlanId(event.target.value)}
                className={inputClass}
              >
                <option value="">—</option>
                {activePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={submitEnroll}
              disabled={!enrollCustomerId || !enrollPlanId || enroll.isPending}
              className="v2-press h-11 shrink-0 rounded-v2-2 bg-v2-green px-4 text-v2-body font-semibold text-white disabled:opacity-60"
            >
              {t('app:v2pro.retention.enroll')}
            </button>
          </div>
        ) : null}
        {enrollError ? (
          <p className="border-t border-v2-hairline px-4 py-2.5 text-v2-meta text-v2-alert md:px-5">
            {enrollError}
          </p>
        ) : null}

        {openEnrollments.length > 0 ? (
          <ul>
            {openEnrollments.map((enrollment) => (
              <li
                key={enrollment.id}
                className="flex items-center gap-3 border-t border-v2-hairline px-4 py-2.5 md:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-v2-body font-medium text-v2-ink">
                    <bdi>{customerName(enrollment.customerId) ?? '—'}</bdi>
                    <span className="text-v2-ink-soft"> · {planName(enrollment.planId) ?? '—'}</span>
                  </p>
                  <p className="truncate text-v2-meta text-v2-ink-soft">
                    {t(`app:v2pro.retention.status.${enrollment.status}`)} ·{' '}
                    {t('app:v2pro.retention.renews', {
                      date: dateFormat.format(new Date(enrollment.currentPeriodEnd)),
                    })}
                  </p>
                </div>
                {canManageEnrollments ? (
                  <div className="flex shrink-0 gap-2">
                    {enrollment.status === 'active' ? (
                      <button
                        type="button"
                        onClick={() => transition(enrollment.id, 'paused')}
                        className={smallButton}
                      >
                        {t('app:v2pro.retention.pause')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => transition(enrollment.id, 'active')}
                        className={smallButton}
                      >
                        {t('app:v2pro.retention.resume')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => transition(enrollment.id, 'cancelled')}
                      className="v2-press flex min-h-11 items-center rounded-v2-1 px-2.5 text-v2-caption font-semibold text-v2-alert hover:underline"
                    >
                      {t('app:v2pro.retention.cancelMembership')}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : enrollments.isPending ? (
          <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
            <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
          </div>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('app:v2pro.retention.membersEmpty')}
          </p>
        )}

        {closedEnrollments.length > 0 ? (
          <p className="border-t border-v2-hairline px-4 py-2.5 text-v2-caption text-v2-ink-mute md:px-5">
            {t('app:v2pro.retention.pastMembers', { count: closedEnrollments.length })}
          </p>
        ) : null}
      </section>
    </div>
  )
}
