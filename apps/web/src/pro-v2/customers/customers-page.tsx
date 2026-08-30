import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useOrgCustomers, type Customer } from '@/lib/queries/customers'
import { useCustomerAppointments } from '@/lib/queries/appointments'
import { useOrgServices } from '@/lib/queries/services'
import { SearchEntry } from '@/customer-v2/home/search-entry'
import { Notice } from '@/customer-v2/ui/notice'
import { useProScope } from '@/pro-v2/shell/pro-v2-shell'

/**
 * The customers CRM — a practical list/detail over the organization's real
 * customer records and their real appointment history.
 *
 * ============================================================================
 * EVERY DERIVED FACT IS ARITHMETIC ON REAL ROWS
 * ============================================================================
 *
 * VISITS — count of completed appointments. LAST VISIT — the newest completed
 * appointment's date. TYPICAL INTERVAL — the mean gap between completed
 * visits, shown only from two visits up because one visit has no interval.
 * All three are computed from the timeline the page already shows, so the
 * summary can never disagree with the history under it.
 *
 * WHAT IS NOT SHOWN: SPEND, and any price on history rows — appointment rows
 * carry no charged amount, and pricing a past visit at TODAY'S service price
 * misstates every visit that predates a price change (the same gap the
 * dashboard records for revenue). EXPECTED RETURN — a forecast with no
 * contract behind it. Both are backend gaps, not UI omissions.
 *
 * Tenant boundaries are RLS's: `useOrgCustomers`/`useCustomerAppointments`
 * are the same org-scoped reads the legacy CRM uses.
 */
export function ProV2CustomersPage() {
  const { t, i18n } = useTranslation()
  const scope = useProScope()

  const customers = useOrgCustomers(scope.organizationId)
  const services = useOrgServices(scope.organizationId)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected: Customer | null =
    (customers.data ?? []).find((entry) => entry.id === selectedId) ?? null

  const timeline = useCustomerAppointments(selected?.id)

  useDocumentMeta({
    title: t('app:v2pro.customers.documentTitle'),
    description: t('app:v2pro.customers.documentDescription'),
    noIndex: true,
  })

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

  /* Mean days between consecutive completed visits — needs at least two. */
  const typicalIntervalDays = useMemo(() => {
    if (completed.length < 2) return null
    const times = completed.map((entry) => new Date(entry.startsAt).getTime()).sort((a, b) => a - b)
    let total = 0
    for (let i = 1; i < times.length; i += 1) total += times[i] - times[i - 1]
    return Math.round(total / (times.length - 1) / 86_400_000)
  }, [completed])

  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  const serviceName = (serviceId: string) =>
    (services.data ?? []).find((entry) => entry.id === serviceId)?.name ?? null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
        {t('app:v2pro.nav.customers')}
      </h1>

      {customers.isError ? (
        <Notice
          tone="failure"
          title={t('customer-app:v2.discovery.errorTitle')}
          body={t('customer-app:v2.discovery.errorBody')}
          actionLabel={t('customer-app:v2.discovery.retry')}
          onAction={() => void customers.refetch()}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
          {/* ── List ─────────────────────────────────────────────────────── */}
          <section className={`v2-plate overflow-hidden ${selected ? 'hidden lg:block' : ''}`}>
            <div className="px-4 py-3">
              <SearchEntry
                value={query}
                onChange={setQuery}
                label={t('app:v2pro.customers.search')}
                placeholder={t('app:v2pro.customers.search')}
              />
            </div>
            {filtered.length > 0 ? (
              <ul>
                {filtered.map((customer) => (
                  <li key={customer.id} className="border-t border-v2-hairline">
                    <button
                      type="button"
                      onClick={() => setSelectedId(customer.id)}
                      aria-pressed={customer.id === selectedId}
                      className={`v2-press flex w-full flex-col items-start px-4 py-3 text-start hover:bg-v2-ground ${
                        customer.id === selectedId ? 'bg-v2-green-tint/40' : ''
                      }`}
                    >
                      <span className="w-full truncate text-v2-body font-medium text-v2-ink">
                        <bdi>{customer.name}</bdi>
                      </span>
                      {(customer.email ?? customer.phone) ? (
                        <span className="w-full truncate text-v2-meta text-v2-ink-soft">
                          {customer.email ?? customer.phone}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : customers.isPending ? (
              <div className="border-t border-v2-hairline px-4 py-4">
                <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
              </div>
            ) : (
              <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft">
                {query ? t('customer-app:v2.discovery.noMatchTitle') : t('app:v2pro.customers.empty')}
              </p>
            )}
          </section>

          {/* ── Detail ───────────────────────────────────────────────────── */}
          {selected ? (
            <section className="v2-plate overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-4 py-4 md:px-5">
                <div className="min-w-0">
                  <h2 className="truncate text-v2-title font-semibold text-v2-ink">
                    <bdi>{selected.name}</bdi>
                  </h2>
                  {selected.email ? (
                    <p className="truncate text-v2-meta text-v2-ink-soft">{selected.email}</p>
                  ) : null}
                  {selected.phone ? (
                    <p className="truncate text-v2-meta text-v2-ink-soft">{selected.phone}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="v2-press shrink-0 rounded-v2-1 text-v2-meta font-semibold text-v2-green hover:underline lg:hidden"
                >
                  {t('app:v2pro.customers.back')}
                </button>
              </div>

              {/* Derived facts, from the timeline below and nothing else. */}
              <dl className="grid grid-cols-3 gap-px border-t border-v2-hairline bg-v2-hairline">
                <div className="bg-v2-paper px-4 py-3">
                  <dt className="text-v2-caption text-v2-ink-soft">
                    {t('app:v2pro.customers.visits')}
                  </dt>
                  <dd className="mt-0.5 text-v2-lead font-semibold tabular-nums text-v2-ink">
                    {completed.length}
                  </dd>
                </div>
                <div className="bg-v2-paper px-4 py-3">
                  <dt className="text-v2-caption text-v2-ink-soft">
                    {t('app:v2pro.customers.lastVisit')}
                  </dt>
                  <dd className="mt-0.5 text-v2-body font-semibold text-v2-ink">
                    {lastVisit ? dateFormat.format(new Date(lastVisit)) : '—'}
                  </dd>
                </div>
                <div className="bg-v2-paper px-4 py-3">
                  <dt className="text-v2-caption text-v2-ink-soft">
                    {t('app:v2pro.customers.interval')}
                  </dt>
                  <dd className="mt-0.5 text-v2-body font-semibold tabular-nums text-v2-ink">
                    {typicalIntervalDays !== null
                      ? t('app:v2pro.customers.intervalDays', { count: typicalIntervalDays })
                      : '—'}
                  </dd>
                </div>
              </dl>

              {selected.notes ? (
                <p className="border-t border-v2-hairline px-4 py-3 text-v2-meta text-v2-ink-soft md:px-5">
                  {selected.notes}
                </p>
              ) : null}

              <h3 className="border-t border-v2-hairline px-4 py-3 text-v2-meta font-semibold uppercase tracking-[0.08em] text-v2-ink-soft md:px-5">
                {t('app:v2pro.customers.history')}
              </h3>

              {(timeline.data ?? []).length > 0 ? (
                <ul>
                  {(timeline.data ?? []).map((appointment) => (
                    <li
                      key={appointment.id}
                      className="flex items-baseline gap-3 border-t border-v2-hairline px-4 py-2.5 md:px-5"
                    >
                      <p className="w-24 shrink-0 text-v2-meta font-medium tabular-nums text-v2-ink">
                        {dateFormat.format(new Date(appointment.startsAt))}
                      </p>
                      <p className="min-w-0 flex-1 truncate text-v2-meta text-v2-ink">
                        {serviceName(appointment.serviceId) ?? '—'}
                      </p>
                      <p className="shrink-0 text-v2-caption font-medium text-v2-ink-mute">
                        {t(`app:v2pro.dashboard.status.${appointment.status}`)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : timeline.isPending ? (
                <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
                  <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
                </div>
              ) : (
                <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
                  {t('app:v2pro.customers.noHistory')}
                </p>
              )}
            </section>
          ) : (
            <section className="hidden items-center justify-center rounded-v2-3 border border-dashed border-v2-hairline p-10 text-v2-meta text-v2-ink-mute lg:flex">
              {t('app:v2pro.customers.selectHint')}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
