/**
 * FadeUp V3 — Clients CRM: understanding a person, not editing a database
 * row.
 *
 * The client header answers Who / How often / When last / When NEXT in one
 * band; the timeline sits below it, and every derived fact is arithmetic on
 * the same real rows the timeline shows (so they can never disagree).
 * NEXT is new in V3 and real today: the earliest upcoming non-cancelled
 * appointment from the same contract. Still truthfully absent: spend and any
 * price on history rows (no charged-amount column), expected-return
 * forecasts (no contract).
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDocumentMeta } from '@/lib/use-document-meta'
import { useOrgCustomers, type Customer } from '@/lib/queries/customers'
import { useCustomerAppointments } from '@/lib/queries/appointments'
import { useOrgServices } from '@/lib/queries/services'
import { useProV3Scope } from '@/pro-v3/shell/pro-v3-shell'

export function ProV3CustomersPage() {
  const { t, i18n } = useTranslation('v3')
  const scope = useProV3Scope()

  const customers = useOrgCustomers(scope.organizationId)
  const services = useOrgServices(scope.organizationId)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected: Customer | null =
    (customers.data ?? []).find((entry) => entry.id === selectedId) ?? null
  const timeline = useCustomerAppointments(selected?.id)

  useDocumentMeta({ title: t('pro.crm.metaTitle'), description: t('pro.crm.metaDescription'), noIndex: true })

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = customers.data ?? []
    if (!needle) return rows
    return rows.filter((entry) =>
      [entry.name, entry.email ?? '', entry.phone ?? ''].join(' ').toLowerCase().includes(needle),
    )
  }, [customers.data, query])

  const completed = (timeline.data ?? []).filter((entry) => entry.status === 'completed')
  const lastVisit = completed[0]?.startsAt ?? null

  const nextVisit = useMemo(() => {
    const now = Date.now()
    return (
      (timeline.data ?? [])
        .filter(
          (entry) =>
            entry.status !== 'cancelled' &&
            entry.status !== 'no_show' &&
            new Date(entry.startsAt).getTime() > now,
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]?.startsAt ?? null
    )
  }, [timeline.data])

  const typicalIntervalDays = useMemo(() => {
    if (completed.length < 2) return null
    const times = completed.map((entry) => new Date(entry.startsAt).getTime()).sort((a, b) => a - b)
    let total = 0
    for (let i = 1; i < times.length; i += 1) total += times[i] - times[i - 1]
    return Math.round(total / (times.length - 1) / 86_400_000)
  }, [completed])

  const dateFormat = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
  const serviceName = (serviceId: string) =>
    (services.data ?? []).find((entry) => entry.id === serviceId)?.name ?? null

  return (
    <div>
      <div className="v3pro-head">
        <h1 className="v3-h1">{t('pro.nav.customers')}</h1>
      </div>

      {customers.isError ? (
        <p className="v3a-error" role="alert">
          {t('app.errors.load')}
        </p>
      ) : (
        <div className="v3crm-grid">
          <section className={`v3pro-panel${selected ? ' v3crm-list-collapsed' : ''}`}>
            <div style={{ padding: '0.75rem 1rem' }}>
              <label className="v3a-search" style={{ minBlockSize: 42 }}>
                <SearchIcon />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('pro.crm.search')}
                  aria-label={t('pro.crm.search')}
                />
              </label>
            </div>
            {filtered.length > 0 ? (
              filtered.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="v3crm-row v3-press"
                  aria-pressed={customer.id === selectedId}
                  onClick={() => setSelectedId(customer.id)}
                >
                  <span className="v3crm-row-name">
                    <bdi>{customer.name}</bdi>
                  </span>
                  {(customer.email ?? customer.phone) ? (
                    <span className="v3-meta">{customer.email ?? customer.phone}</span>
                  ) : null}
                </button>
              ))
            ) : customers.isPending ? (
              <div className="v3-skeleton" style={{ blockSize: '2.5rem', margin: '0.5rem 1rem' }} aria-hidden="true" />
            ) : (
              <p className="v3pro-empty">
                {query ? t('app.market.emptyTitle') : t('pro.crm.empty')}
              </p>
            )}
          </section>

          {selected ? (
            <section className="v3pro-panel">
              <div className="v3crm-head">
                <div style={{ minInlineSize: 0 }}>
                  <h2 className="v3-section-h">
                    <bdi>{selected.name}</bdi>
                  </h2>
                  <p className="v3-meta">
                    {[selected.phone, selected.email].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  className="v3a-section-link v3-press v3crm-back"
                  onClick={() => setSelectedId(null)}
                >
                  {t('pro.crm.back')}
                </button>
              </div>

              {/* The at-a-glance band — every fact from the timeline below. */}
              <p className="v3crm-band v3-num">
                {t('pro.crm.visits', { count: completed.length })}
                {typicalIntervalDays !== null
                  ? ` · ${t('pro.crm.every', { count: typicalIntervalDays })}`
                  : ''}
                {lastVisit ? ` · ${t('pro.crm.last', { date: dateFormat.format(new Date(lastVisit)) })}` : ''}
                {nextVisit ? ` · ${t('pro.crm.next', { date: dateFormat.format(new Date(nextVisit)) })}` : ''}
              </p>

              {selected.notes ? (
                <p className="v3-meta" style={{ padding: '0.625rem 1rem', borderBlockStart: '1px solid var(--v3-hairline)' }}>
                  {selected.notes}
                </p>
              ) : null}

              <h3 className="v3pro-panel-title" style={{ borderBlockStart: '1px solid var(--v3-hairline)' }}>
                {t('pro.crm.timeline')}
              </h3>
              {(timeline.data ?? []).length > 0 ? (
                (timeline.data ?? []).map((appointment) => (
                  <div key={appointment.id} className="v3pro-row" style={{ minBlockSize: 44 }}>
                    <time className="v3-num" style={{ fontSize: '0.8438rem' }} dateTime={appointment.startsAt}>
                      {dateFormat.format(new Date(appointment.startsAt))}
                    </time>
                    <span style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {serviceName(appointment.serviceId) ?? '—'}
                    </span>
                    <span data-status={undefined} className="v3-meta">
                      {t(`pro.status.${appointment.status}`)}
                    </span>
                  </div>
                ))
              ) : timeline.isPending ? (
                <div className="v3-skeleton" style={{ blockSize: '2.5rem', margin: '0.5rem 1rem' }} aria-hidden="true" />
              ) : (
                <p className="v3pro-empty">{t('pro.crm.noHistory')}</p>
              )}
            </section>
          ) : (
            <section className="v3crm-hint">
              <p className="v3-meta">{t('pro.crm.selectHint')}</p>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" strokeLinecap="round" />
    </svg>
  )
}
