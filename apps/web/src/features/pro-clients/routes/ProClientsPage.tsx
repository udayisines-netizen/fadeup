import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { cn } from '@/shared/lib/cn'
import { useProEntitlements, useProOrganization } from '@/shared/data/organization'
import { useIsDesktop } from '@/shared/hooks/useMediaQuery'
import { deviceTimezone, formatDateTime } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { Pagination } from '@/shared/ui/Pagination'
import { Row } from '@/shared/ui/Row'
import { Select } from '@/shared/ui/Select'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { IconClients, IconPending, IconSearch } from '@/shared/ui/icons'
import {
  CUSTOMERS_PAGE_SIZE,
  useLapsedCustomerCount,
  useOrganizationCustomers,
  type CustomerListRow,
} from '@/features/pro-clients/api/clients'
import {
  CUSTOMER_SEGMENTS,
  displayCustomerName,
  frequencyLabel,
  lapsedSummary,
  overdueDays,
  totalPages,
  type CustomerSegment,
} from '@/features/pro-clients/lib/crm'

/**
 * OS-2 — la liste des clients. Régime DENSE (P1PRO §3) : on BALAIE une série
 * d'objets homogènes pour en trouver un. Rangées à filet fin, méta en
 * secondaire, aucun espace décoratif, aucun chiffre dominant.
 *
 * La seule chose qui « décide » sur cet écran est le rappel des clients non
 * revenus : un bloc d'appel sobre, en ambre, dont le compte vient d'une
 * requête SERVEUR bornée au segment `lapsed` — jamais d'une déduction sur
 * les lignes déjà chargées.
 */

/* Séparateur de méta — un caractère, pas une chaîne à traduire. */
const META_SEPARATOR = '·'

export function ProClientsPage() {
  const { t, i18n } = useTranslation('v2')
  const { organization, loading: orgLoading } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const timezone = organization?.locations[0]?.timezone ?? deviceTimezone()
  const isDesktop = useIsDesktop()
  const { entitlements } = useProEntitlements(organizationId)
  const capabilities = entitlements?.liveCapabilities ?? []

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [segment, setSegment] = useState<CustomerSegment>('all')
  const [page, setPage] = useState(0)

  /* Recherche débouncée : une frappe n'est pas une requête. */
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 250)
    return () => window.clearTimeout(id)
  }, [searchInput])

  /* Changer de recherche ou de segment repart de la première page — sinon on
     atterrit sur un offset qui n'existe plus. */
  useEffect(() => {
    setPage(0)
  }, [search, segment])

  const list = useOrganizationCustomers(organizationId, { search, segment, page })
  const lapsedCount = useLapsedCustomerCount(organizationId)

  const rows = useMemo(() => list.data?.rows ?? [], [list.data])
  const totalCount = list.data?.totalCount ?? 0
  const pages = totalPages(totalCount, CUSTOMERS_PAGE_SIZE)
  const callout = lapsedSummary({ segment, lapsedTotal: lapsedCount.data ?? null })

  const loading = orgLoading || list.isPending
  const error = list.error

  const segmentOptions = CUSTOMER_SEGMENTS.map((value) => ({
    value,
    label: t(`pro.clients.segment.${value}`),
  }))

  const renderRow = (row: CustomerListRow) => {
    const parts = frequencyLabel({
      averageIntervalDays: row.average_interval_days,
      daysSinceLast: row.days_since_last,
      completedCount: row.completed_count,
      lastCompletedAt: row.last_completed_at,
    })
    const overdue = overdueDays({
      daysSinceLast: row.days_since_last,
      averageIntervalDays: row.average_interval_days,
      isLapsed: row.is_lapsed,
    })

    /* B5 — une identité effacée ne s'affiche pas brute (« [deleted] ») :
       l'historique reste au salon, l'identité non. */
    const name = displayCustomerName(row.display_name)

    let trailing: React.ReactNode = null
    if (overdue !== null) {
      trailing = (
        <span className="font-fu-mono text-fu-xs tabular-nums text-[var(--fu-state-warn)]">
          {t('pro.clients.row.overdue', { days: overdue })}
        </span>
      )
    } else if (row.upcoming_at) {
      trailing = (
        <span className="text-end">
          {/* Le lecteur d'écran entend la phrase entière, l'œil lit la date
              compacte : la colonne de fin reste tenable à 390 px. */}
          <span className="sr-only">
            {t('pro.clients.row.upcoming', {
              date: formatDateTime(row.upcoming_at, timezone, 'date', i18n.language),
            })}
          </span>
          <span aria-hidden="true">
            <DateTime
              value={row.upcoming_at}
              timezone={timezone}
              format="date"
              className="text-fu-xs text-[var(--fu-text-secondary)]"
            />
          </span>
        </span>
      )
    }

    return (
      <li key={row.customer_id} data-testid="pro-client-row">
        <Row
          as="link"
          to={`/dashboard/clients/${row.customer_id}`}
          chevron
          title={
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn('truncate', name.deleted && 'text-[var(--fu-text-secondary)] italic')}>
                {name.deleted ? t('pro.clients.deletedCustomer') : name.name}
              </span>
              {row.is_verified_client && (
                <Badge variant="brand" className="shrink-0">
                  {t('pro.clients.badge.verified')}
                </Badge>
              )}
              {row.is_lapsed && (
                <span className="inline-flex shrink-0 items-center rounded-[var(--radius-control)] border border-[var(--fu-state-warn)] px-2 py-0.5 text-fu-xs font-medium text-[var(--fu-state-warn)]">
                  {t('pro.clients.badge.lapsed')}
                </span>
              )}
            </span>
          }
          subtitle={
            <span className="font-fu-mono tabular-nums">
              {parts.map((part, index) => (
                <Fragment key={part.key}>
                  {index > 0 && <span className="px-1.5 text-[var(--fu-text-tertiary)]">{META_SEPARATOR}</span>}
                  {t(part.key, part.params)}
                </Fragment>
              ))}
            </span>
          }
          trailing={trailing}
        />
      </li>
    )
  }

  const emptyState = () => {
    if (search) {
      return (
        <EmptyState
          icon={<IconSearch aria-hidden="true" />}
          title={t('pro.clients.emptySearch.title')}
          description={t('pro.clients.emptySearch.description')}
          action={
            <Button variant="secondary" onClick={() => setSearchInput('')}>
              {t('pro.clients.emptySearch.action')}
            </Button>
          }
        />
      )
    }
    if (segment !== 'all') {
      return (
        <EmptyState
          icon={<IconClients aria-hidden="true" />}
          title={t('pro.clients.emptySegment.title')}
          /* La bonne nouvelle « personne en retard » ne vaut que pour le
             segment des non revenus ; ailleurs, on dit simplement le fait. */
          description={t(
            segment === 'lapsed' ? 'pro.clients.emptySegment.description' : 'pro.clients.emptySegment.descriptionGeneric',
          )}
          action={
            <Button variant="secondary" onClick={() => setSegment('all')}>
              {t('pro.clients.emptySegment.action')}
            </Button>
          }
        />
      )
    }
    /* L'action d'un CRM vide mène là où naissent les fiches — et JAMAIS
       vers une route que la capacité du salon ferait rebondir vers
       l'accueil (capacité absente = non rendue, P1PRO §0bis). */
    const destination = capabilities.includes('liveQueue')
      ? { to: '/dashboard/queue', label: t('pro.clients.empty.action') }
      : capabilities.includes('booking')
        ? { to: '/dashboard/agenda', label: t('pro.clients.empty.actionAgenda') }
        : { to: '/dashboard', label: t('common.action.goHome') }

    return (
      <EmptyState
        icon={<IconClients aria-hidden="true" />}
        title={t('pro.clients.empty.title')}
        description={t('pro.clients.empty.description')}
        action={
          <Link
            to={destination.to}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[var(--fu-border-strong)] px-4 text-fu-sm font-medium text-[var(--fu-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
          >
            {destination.label}
          </Link>
        }
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24" data-testid="pro-clients">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)] lg:text-fu-2xl">
            {t('pro.clients.title')}
          </h1>
          <p className="mt-0.5 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.clients.subtitle')}</p>
        </div>
        {!loading && !error && (
          <p className="font-fu-mono text-fu-xs tabular-nums tracking-widest text-[var(--fu-text-secondary)]">
            {t('pro.clients.count', { count: totalCount })}
          </p>
        )}
      </header>

      {callout.visible && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--fu-state-warn)] bg-[var(--fu-surface)] p-4"
          data-testid="pro-clients-lapsed-callout"
        >
          <p className="flex items-center gap-2 text-fu-sm text-[var(--fu-text-primary)]">
            <IconPending aria-hidden="true" className="size-4 shrink-0 text-[var(--fu-state-warn)]" />
            {t('pro.clients.lapsedCallout', { count: callout.count })}
          </p>
          <Button variant="tertiary" size="sm" onClick={() => setSegment('lapsed')}>
            {t('pro.clients.lapsedCalloutAction')}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <Input
          type="search"
          label={t('pro.clients.search')}
          placeholder={t('pro.clients.searchPlaceholder')}
          iconStart={<IconSearch aria-hidden="true" />}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className="md:max-w-sm md:flex-1"
          data-testid="pro-clients-search"
        />
        {isDesktop ? (
          <SegmentedControl
            label={t('pro.clients.segment.label')}
            options={segmentOptions}
            value={segment}
            onValueChange={(value) => setSegment(value as CustomerSegment)}
            className="self-start md:self-auto"
          />
        ) : (
          <Select
            label={t('pro.clients.segment.label')}
            options={segmentOptions}
            value={segment}
            onValueChange={(value) => setSegment(value as CustomerSegment)}
          />
        )}
      </div>

      {loading ? (
        <div
          className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--fu-border)]"
          aria-busy="true"
          aria-label={t('common.a11y.loading')}
        >
          {[0, 1, 2, 3, 4].map((index) => (
            <SkeletonRow key={index} className="last:border-b-0" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4">
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t(errorMessageKey(toAppError(error)))}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void list.refetch()}>
            {t('common.action.retry')}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]">
          {emptyState()}
        </div>
      ) : (
        <>
          <ul
            className={cn(
              'overflow-hidden rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>li:last-child>*]:border-b-0',
              // Page suivante / recherche affinée : la liste précédente reste
              // lisible, atténuée — pas de saut de mise en page.
              'transition-opacity duration-[var(--fu-dur-instant)]',
              list.isPlaceholderData && 'opacity-60',
            )}
            aria-busy={list.isPlaceholderData || undefined}
            data-testid="pro-clients-list"
          >
            {rows.map(renderRow)}
          </ul>
          {pages > 1 && (
            <Pagination page={page + 1} totalPages={pages} onPageChange={(next) => setPage(next - 1)} />
          )}
        </>
      )}
    </div>
  )
}
