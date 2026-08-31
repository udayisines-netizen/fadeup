/**
 * FadeUp V3 — Retention, designed around action.
 *
 * WORTH A CALL is a worklist, not a report: customers whose last COMPLETED
 * visit is 60+ days old (180-day lookback, real appointment rows), excluded
 * the moment they hold any upcoming booking, each row carrying the
 * customer's own typical interval so "72 days" means something. Membership
 * plans present as products (name · price cadence · active members);
 * members list with the real staff transitions. Role gates mirror RLS:
 * plans owner/manager, enrollments owner/manager/receptionist. There is no
 * send button — no campaign contract exists — and no SMS, ever.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/lib/auth-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMoney, useOrganizationCurrency } from '@/lib/intl/use-intl'
import type { MembershipRole } from '@/lib/types'
import {
  useOrgMembershipPlans,
  useCreateMembershipPlan,
  useUpdateMembershipPlan,
  type BillingInterval,
  type MembershipPlan,
} from '@/lib/queries/membership-plans'
import {
  useOrgCustomerMemberships,
  useEnrollCustomerMembership,
  useUpdateCustomerMembershipStatus,
} from '@/lib/queries/customer-memberships'
import { useOrgCustomers } from '@/lib/queries/customers'
import { useOrgAppointmentsSince } from '@/lib/queries/appointments'
import { useProV3Scope } from '@/pro-v3/shell/pro-v3-shell'

const DAY_MS = 86_400_000
const LOOKBACK_DAYS = 180
const LAPSED_DAYS = 60
const PLAN_MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])
const ENROLLMENT_MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

export function ProV3RetentionPage() {
  const { t, i18n } = useTranslation('v3')
  const scope = useProV3Scope()
  const { user } = useAuth()
  const money = useMoney()
  const currency = useOrganizationCurrency(scope.organizationId)

  const canManagePlans = PLAN_MANAGING_ROLES.has(scope.role)
  const canManageEnrollments = ENROLLMENT_MANAGING_ROLES.has(scope.role)

  const plans = useOrgMembershipPlans(scope.organizationId)
  const enrollments = useOrgCustomerMemberships(scope.organizationId)
  const customers = useOrgCustomers(scope.organizationId)
  const since = useMemo(() => new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString(), [])
  const visits = useOrgAppointmentsSince(scope.organizationId, since)

  const enroll = useEnrollCustomerMembership()
  const updateStatus = useUpdateCustomerMembershipStatus()

  useDocumentMeta({ title: t('pro.retention.metaTitle'), description: t('pro.retention.metaDescription'), noIndex: true })

  /* Lapsed customers + their own typical interval — arithmetic on the same
     real rows, nothing invented. */
  const lapsed = useMemo(() => {
    const now = Date.now()
    const completed = new Map<string, number[]>()
    const hasUpcoming = new Set<string>()

    for (const appointment of visits.data ?? []) {
      if (!appointment.customerId) continue
      if (scope.locationId && appointment.locationId !== scope.locationId) continue
      const at = new Date(appointment.startsAt).getTime()
      if (at > now && appointment.status !== 'cancelled' && appointment.status !== 'no_show') {
        hasUpcoming.add(appointment.customerId)
      }
      if (appointment.status === 'completed') {
        const list = completed.get(appointment.customerId) ?? []
        list.push(at)
        completed.set(appointment.customerId, list)
      }
    }

    const rows: Array<{ id: string; name: string; contact: string | null; daysSince: number; interval: number | null }> = []
    for (const customer of customers.data ?? []) {
      const times = completed.get(customer.id)
      if (!times || hasUpcoming.has(customer.id)) continue
      times.sort((a, b) => a - b)
      const last = times[times.length - 1]
      const daysSince = Math.floor((now - last) / DAY_MS)
      if (daysSince < LAPSED_DAYS) continue
      let interval: number | null = null
      if (times.length >= 2) {
        let total = 0
        for (let i = 1; i < times.length; i += 1) total += times[i] - times[i - 1]
        interval = Math.round(total / (times.length - 1) / DAY_MS)
      }
      rows.push({
        id: customer.id,
        name: customer.name,
        contact: customer.phone ?? customer.email ?? null,
        daysSince,
        interval,
      })
    }
    rows.sort((a, b) => b.daysSince - a.daysSince)
    return rows
  }, [visits.data, customers.data, scope.locationId])

  const customerName = (customerId: string) =>
    (customers.data ?? []).find((customer) => customer.id === customerId)?.name ?? null
  const planName = (planId: string) => (plans.data ?? []).find((plan) => plan.id === planId)?.name ?? null
  const activeCount = (planId: string) =>
    (enrollments.data ?? []).filter((e) => e.planId === planId && e.status === 'active').length

  const [planFormOpen, setPlanFormOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })

  const openEnrollments = (enrollments.data ?? []).filter(
    (e) => e.status === 'active' || e.status === 'paused',
  )

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="v3pro-head">
        <h1 className="v3-h1">{t('pro.nav.retention')}</h1>
      </div>

      {/* ── Worth a call ─────────────────────────────────────────────────── */}
      <section className="v3pro-panel" aria-labelledby="v3rt-call">
        <h2 id="v3rt-call" className="v3pro-panel-title">
          {t('pro.retention.worthACall', { count: lapsed.length })}
        </h2>
        {visits.isPending || customers.isPending ? (
          <div className="v3-skeleton" style={{ blockSize: '2.5rem', margin: '0.5rem 1rem' }} aria-hidden="true" />
        ) : lapsed.length === 0 ? (
          <p className="v3pro-empty">{t('pro.retention.noneLapsed')}</p>
        ) : (
          lapsed.map((row) => (
            <div key={row.id} className="v3pro-row" style={{ gridTemplateColumns: '1fr auto' }}>
              <span style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <bdi style={{ fontWeight: 600 }}>{row.name}</bdi>
                {row.contact ? <span style={{ color: 'var(--v3-ink-soft)' }}> · {row.contact}</span> : null}
              </span>
              <span className="v3-num v3-meta">
                {t('pro.retention.daysSince', { count: row.daysSince })}
                {row.interval !== null ? ` · ${t('pro.retention.usuallyEvery', { count: row.interval })}` : ''}
              </span>
            </div>
          ))
        )}
      </section>

      {/* ── Plans as products ────────────────────────────────────────────── */}
      <section className="v3pro-panel" aria-labelledby="v3rt-plans">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBlockEnd: '1px solid var(--v3-hairline)' }}>
          <h2 id="v3rt-plans" className="v3pro-panel-title" style={{ borderBlockEnd: 0 }}>
            {t('pro.retention.plans')}
          </h2>
          {canManagePlans ? (
            <button
              type="button"
              className="v3a-section-link v3-press"
              style={{ paddingInlineEnd: '1rem', border: 0, background: 'transparent', cursor: 'pointer', font: 'inherit' }}
              onClick={() => {
                setEditingPlan(null)
                setPlanFormOpen((open) => !open)
              }}
            >
              {planFormOpen && !editingPlan ? t('pro.retention.close') : t('pro.retention.newPlan')}
            </button>
          ) : null}
        </div>

        {(plans.data ?? []).map((plan) => (
          <div key={plan.id} className="v3pro-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
            <span style={{ minInlineSize: 0 }}>
              <span style={{ fontWeight: 650 }}>
                <bdi>{plan.name}</bdi>
              </span>
              {!plan.isActive ? (
                <span className="v3-meta"> · {t('pro.retention.inactive')}</span>
              ) : null}
              <br />
              <span className="v3-meta v3-num">
                {money(plan.priceCents, currency)} / {t(`pro.retention.interval.${plan.billingInterval}`)} ·{' '}
                {t('pro.retention.activeMembers', { count: activeCount(plan.id) })}
              </span>
            </span>
            {canManagePlans ? (
              <button
                type="button"
                className="v3-btn v3-btn--quiet v3-press"
                style={{ minBlockSize: 44, paddingInline: '0.75rem', fontSize: '0.8125rem' }}
                onClick={() => {
                  setEditingPlan(plan)
                  setPlanFormOpen(true)
                }}
              >
                {t('pro.retention.edit')}
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {(plans.data ?? []).length === 0 && !plans.isPending ? (
          <p className="v3pro-empty">{t('pro.retention.noPlans')}</p>
        ) : null}

        {planFormOpen && canManagePlans ? (
          <PlanForm
            organizationId={scope.organizationId}
            currency={currency}
            plan={editingPlan}
            onClose={() => {
              setPlanFormOpen(false)
              setEditingPlan(null)
            }}
          />
        ) : null}
      </section>

      {/* ── Members ──────────────────────────────────────────────────────── */}
      <section className="v3pro-panel" aria-labelledby="v3rt-members">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBlockEnd: '1px solid var(--v3-hairline)' }}>
          <h2 id="v3rt-members" className="v3pro-panel-title" style={{ borderBlockEnd: 0 }}>
            {t('pro.retention.members')}
          </h2>
          {canManageEnrollments && (plans.data ?? []).some((plan) => plan.isActive) ? (
            <button
              type="button"
              className="v3a-section-link v3-press"
              style={{ paddingInlineEnd: '1rem', border: 0, background: 'transparent', cursor: 'pointer', font: 'inherit' }}
              onClick={() => setEnrollOpen((open) => !open)}
            >
              {enrollOpen ? t('pro.retention.close') : t('pro.retention.enroll')}
            </button>
          ) : null}
        </div>

        {openEnrollments.map((enrollment) => (
          <div key={enrollment.id} className="v3pro-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <span style={{ minInlineSize: 0 }}>
              <span style={{ fontWeight: 600 }}>
                <bdi>{customerName(enrollment.customerId) ?? '—'}</bdi>
              </span>
              <span className="v3-meta">
                {' · '}
                {planName(enrollment.planId) ?? '—'} ·{' '}
                {t('pro.retention.renews', { date: dateFormat.format(new Date(enrollment.currentPeriodEnd)) })}
                {enrollment.status === 'paused' ? ` · ${t('pro.retention.paused')}` : ''}
              </span>
            </span>
            {canManageEnrollments ? (
              <span style={{ display: 'flex', gap: '0.375rem' }}>
                <button
                  type="button"
                  className="v3-btn v3-btn--quiet v3-press"
                  style={{ minBlockSize: 44, paddingInline: '0.75rem', fontSize: '0.8125rem' }}
                  disabled={updateStatus.isPending}
                  onClick={() =>
                    updateStatus.mutate({
                      id: enrollment.id,
                      organizationId: scope.organizationId,
                      status: enrollment.status === 'paused' ? 'active' : 'paused',
                    })
                  }
                >
                  {enrollment.status === 'paused' ? t('pro.retention.resume') : t('pro.retention.pause')}
                </button>
                <button
                  type="button"
                  className="v3-btn v3-btn--quiet v3-press"
                  style={{ minBlockSize: 44, paddingInline: '0.75rem', fontSize: '0.8125rem', color: 'var(--v3-alert)' }}
                  disabled={updateStatus.isPending}
                  onClick={() =>
                    updateStatus.mutate({ id: enrollment.id, organizationId: scope.organizationId, status: 'cancelled' })
                  }
                >
                  {t('pro.retention.cancel')}
                </button>
              </span>
            ) : (
              <span />
            )}
          </div>
        ))}
        {openEnrollments.length === 0 && !enrollments.isPending ? (
          <p className="v3pro-empty">{t('pro.retention.noMembers')}</p>
        ) : null}

        {enrollOpen && canManageEnrollments ? (
          <EnrollForm
            organizationId={scope.organizationId}
            userId={user?.id ?? null}
            plans={(plans.data ?? []).filter((plan) => plan.isActive)}
            customers={(customers.data ?? []).map((customer) => ({ id: customer.id, name: customer.name }))}
            pending={enroll.isPending}
            error={enroll.isError}
            onSubmit={(input) => enroll.mutate(input, { onSuccess: () => setEnrollOpen(false) })}
          />
        ) : null}
      </section>
    </div>
  )
}

function PlanForm({
  organizationId,
  currency,
  plan,
  onClose,
}: {
  organizationId: string
  currency: string
  plan: MembershipPlan | null
  onClose: () => void
}) {
  const { t } = useTranslation('v3')
  const create = useCreateMembershipPlan()
  const update = useUpdateMembershipPlan()

  const [name, setName] = useState(plan?.name ?? '')
  const [price, setPrice] = useState(plan ? String(plan.priceCents / 100) : '')
  const [interval, setInterval] = useState<BillingInterval>(plan?.billingInterval ?? 'monthly')
  const [isActive, setIsActive] = useState(plan?.isActive ?? true)
  const pending = create.isPending || update.isPending

  return (
    <form
      className="v3b-form"
      onSubmit={(event) => {
        event.preventDefault()
        const priceCents = Math.round(Number(price.replace(',', '.')) * 100)
        if (!name.trim() || !Number.isFinite(priceCents) || priceCents <= 0) return
        const input = {
          organizationId,
          name: name.trim(),
          description: plan?.description ?? null,
          priceCents,
          billingInterval: interval,
          isActive,
        }
        if (plan) update.mutate({ ...input, id: plan.id }, { onSuccess: onClose })
        else create.mutate(input, { onSuccess: onClose })
      }}
    >
      <label className="v3b-field">
        <span>{t('pro.retention.planName')}</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
        <label className="v3b-field">
          <span>
            {t('pro.retention.planPrice')} ({currency})
          </span>
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" required dir="ltr" />
        </label>
        <label className="v3b-field">
          <span>{t('pro.retention.planInterval')}</span>
          <select
            value={interval}
            onChange={(event) => setInterval(event.target.value as BillingInterval)}
            style={{ minBlockSize: 48, borderRadius: 'var(--v3-radius-m)', border: '1px solid var(--v3-hairline)', font: 'inherit', paddingInline: '0.75rem' }}
          >
            {(['weekly', 'monthly', 'yearly'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`pro.retention.interval.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
        <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
        {t('pro.retention.planActive')}
      </label>
      {create.isError || update.isError ? (
        <p role="alert" className="v3a-error">
          {t('app.errors.load')}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '0.625rem' }}>
        <button type="submit" className="v3-btn v3-btn--book v3-press" disabled={pending}>
          {t('pro.retention.save')}
        </button>
        <button type="button" className="v3-btn v3-btn--quiet v3-press" onClick={onClose}>
          {t('pro.retention.cancel')}
        </button>
      </div>
    </form>
  )
}

function EnrollForm({
  organizationId,
  userId,
  plans,
  customers,
  pending,
  error,
  onSubmit,
}: {
  organizationId: string
  userId: string | null
  plans: MembershipPlan[]
  customers: Array<{ id: string; name: string }>
  pending: boolean
  error: boolean
  onSubmit: (input: {
    organizationId: string
    customerId: string
    planId: string
    currentPeriodEnd: string
    notes: string | null
    createdBy: string | null
  }) => void
}) {
  const { t } = useTranslation('v3')
  const [customerId, setCustomerId] = useState('')
  const [planId, setPlanId] = useState(plans[0]?.id ?? '')

  const selectStyle = {
    minBlockSize: 48,
    borderRadius: 'var(--v3-radius-m)',
    border: '1px solid var(--v3-hairline)',
    font: 'inherit',
    paddingInline: '0.75rem',
  } as const

  return (
    <form
      className="v3b-form"
      onSubmit={(event) => {
        event.preventDefault()
        const plan = plans.find((entry) => entry.id === planId)
        if (!customerId || !plan) return
        /* First period end from the plan's own cadence — a real derivation,
           the same one the audited flow used. */
        const end = new Date()
        if (plan.billingInterval === 'weekly') end.setDate(end.getDate() + 7)
        else if (plan.billingInterval === 'monthly') end.setMonth(end.getMonth() + 1)
        else end.setFullYear(end.getFullYear() + 1)
        onSubmit({
          organizationId,
          customerId,
          planId,
          currentPeriodEnd: end.toISOString(),
          notes: null,
          createdBy: userId,
        })
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
        <label className="v3b-field">
          <span>{t('pro.retention.customer')}</span>
          <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} required style={selectStyle}>
            <option value="">—</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="v3b-field">
          <span>{t('pro.retention.plan')}</span>
          <select value={planId} onChange={(event) => setPlanId(event.target.value)} required style={selectStyle}>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert" className="v3a-error">
          {t('pro.retention.enrollFailed')}
        </p>
      ) : null}
      <button type="submit" className="v3-btn v3-btn--book v3-press" disabled={pending}>
        {t('pro.retention.enroll')}
      </button>
    </form>
  )
}
