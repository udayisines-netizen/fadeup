import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { useProOrganization } from '@/shared/data/organization'
import { deviceTimezone } from '@/shared/lib/format'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { EmptyState } from '@/shared/ui/EmptyState'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { IconBack, IconClients } from '@/shared/ui/icons'
import { useOrganizationCustomer } from '@/features/pro-clients/api/clients'
import { ClientHistory } from '@/features/pro-clients/components/ClientHistory'
import { ClientNotes } from '@/features/pro-clients/components/ClientNotes'
import { displayCustomerName, isMissingCustomer } from '@/features/pro-clients/lib/crm'

/**
 * OS-2 — la fiche client. Régime AÉRÉ SOBRE (P1PRO §3) : des blocs bordés,
 * UN chiffre dominant (les prestations terminées), les secondaires dessous.
 *
 * Rien ne s'invente : un rythme que le serveur n'a pas observé s'écrit
 * « pas encore de rythme », une donnée absente s'écrit « — », et
 * `is_verified_client` est un FAIT serveur (identité FadeUp + prestation
 * délivrée, MASTER_SPEC §9) — jamais déduit d'un compteur de visites.
 *
 * Une fiche d'un autre salon est refusée par la base (42501) : elle mène au
 * même état vide qu'une fiche inexistante, pour ne rien apprendre à
 * personne sur les clients d'un autre.
 */

const panelClass = 'rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4 lg:p-5'

function Stat({ value, label, hint }: { value: React.ReactNode; label: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-fu-xl text-[var(--fu-text-primary)]">{value}</div>
      <p className="mt-0.5 text-fu-sm text-[var(--fu-text-secondary)]">{label}</p>
      {hint != null && <p className="mt-0.5 text-fu-xs text-[var(--fu-text-tertiary)]">{hint}</p>}
    </div>
  )
}

export function ProClientDetailPage() {
  const { t } = useTranslation('v2')
  const { customerId } = useParams<{ customerId: string }>()
  const { organization, loading: orgLoading } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const timezone = organization?.locations[0]?.timezone ?? deviceTimezone()
  const currency = organization?.currency ?? 'EUR'

  const customer = useOrganizationCustomer(organizationId, customerId ?? null)
  const loading = orgLoading || customer.isPending
  const missing =
    !customerId || (customer.isError && isMissingCustomer(customer.error)) || (customer.isSuccess && !customer.data)

  const backLink = (
    <Link
      to="/dashboard/clients"
      className="inline-flex min-h-11 items-center gap-2 self-start text-fu-sm text-[var(--fu-text-secondary)] hover:text-[var(--fu-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
    >
      <IconBack aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      {t('pro.clients.detail.back')}
    </Link>
  )

  if (missing) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24" data-testid="pro-client-detail">
        {backLink}
        <div className={panelClass}>
          <EmptyState
            icon={<IconClients aria-hidden="true" />}
            title={t('pro.clients.errors.notFound')}
            description={t('pro.clients.errors.notFoundHelp')}
            action={
              <Link
                to="/dashboard/clients"
                className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[var(--fu-border-strong)] px-4 text-fu-sm font-medium text-[var(--fu-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
              >
                {t('pro.clients.detail.back')}
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div
        className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24"
        data-testid="pro-client-detail"
        aria-busy="true"
        aria-label={t('common.a11y.loading')}
      >
        {backLink}
        <SkeletonRect className="h-24 w-full" />
        <SkeletonRect className="h-32 w-full" />
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5">
          <SkeletonRect className="h-64 w-full lg:col-span-2" />
          <SkeletonRect className="h-64 w-full lg:col-span-3" />
        </div>
      </div>
    )
  }

  if (customer.isError) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24" data-testid="pro-client-detail">
        {backLink}
        <div className={panelClass}>
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t(errorMessageKey(toAppError(customer.error)))}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void customer.refetch()}>
            {t('common.action.retry')}
          </Button>
        </div>
      </div>
    )
  }

  const row = customer.data
  if (!row) return null

  const cycleDays = row.average_interval_days === null ? null : Math.round(row.average_interval_days)
  const noData = t('states.metric.noData')
  /* B5 — identité effacée : un libellé honnête partout, y compris dans le
     monogramme de l'Avatar (« [deleted] » y afficherait « [ »). */
  const name = displayCustomerName(row.display_name)
  const displayName = name.deleted ? t('pro.clients.deletedCustomer') : name.name

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24" data-testid="pro-client-detail">
      {backLink}

      <section className={panelClass}>
        <div className="flex items-start gap-3">
          <Avatar name={displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)] lg:text-fu-2xl">
                {displayName}
              </h1>
              {row.is_verified_client && <Badge variant="brand">{t('pro.clients.badge.verified')}</Badge>}
              {row.is_lapsed && (
                <span className="inline-flex items-center rounded-[var(--radius-control)] border border-[var(--fu-state-warn)] px-2 py-0.5 text-fu-xs font-medium text-[var(--fu-state-warn)]">
                  {t('pro.clients.badge.lapsed')}
                </span>
              )}
            </div>
            {/* Le pourquoi de l'effacement — dit ici seulement, pas sur chaque
                rangée de la liste. */}
            {name.deleted && (
              <p className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]">
                {t('pro.clients.deletedCustomerHint')}
              </p>
            )}
            {/* Ce que « vérifié » veut dire — un fait, pas une récompense. */}
            {row.is_verified_client && (
              <p className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.clients.badge.verifiedHint')}</p>
            )}

            <p className="mt-3 text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.clients.detail.contactLabel')}</p>
            {/* Une identité effacée n'expose plus de coordonnées, même si une
                colonne en gardait une. */}
            {name.deleted || (row.phone === null && row.email === null) ? (
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.clients.detail.noContact')}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-fu-sm">
                {row.phone !== null && (
                  <a
                    href={`tel:${row.phone}`}
                    className="font-fu-mono tabular-nums text-[var(--fu-accent-text)] hover:underline"
                  >
                    {row.phone}
                  </a>
                )}
                {row.email !== null && (
                  <a href={`mailto:${row.email}`} className="truncate text-[var(--fu-accent-text)] hover:underline">
                    {row.email}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={panelClass} data-testid="pro-client-stats">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:gap-10">
          {/* LE chiffre dominant de l'écran (P1PRO §4), libellé dessous. */}
          <div className="shrink-0">
            <p
              className="font-fu-mono text-fu-3xl font-semibold tabular-nums text-[var(--fu-text-primary)] lg:text-fu-4xl"
              data-testid="pro-client-visits"
            >
              {row.completed_count}
            </p>
            <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.clients.detail.visitsLabel')}</p>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label={t('pro.clients.detail.lastVisitLabel')}
              value={
                row.last_completed_at === null ? (
                  <span className="font-fu-mono tabular-nums">{noData}</span>
                ) : (
                  <DateTime value={row.last_completed_at} timezone={timezone} format="date" />
                )
              }
            />
            <Stat
              label={t('pro.clients.detail.cycleLabel')}
              hint={cycleDays === null ? t('pro.clients.detail.cycleHint') : undefined}
              value={
                cycleDays === null ? (
                  /* Jamais de rythme inventé : on dit qu'il n'y en a pas. */
                  <span className="text-fu-sm text-[var(--fu-text-secondary)]">
                    {t('pro.clients.detail.cycleUnknown')}
                  </span>
                ) : (
                  <span className="font-fu-mono tabular-nums">
                    {t('pro.clients.detail.cycleValue', { days: cycleDays })}
                  </span>
                )
              }
            />
            {/* Le retour attendu n'existe que si le serveur en calcule un. */}
            {row.expected_return_at !== null && (
              <Stat
                label={t('pro.clients.detail.expectedLabel')}
                value={<DateTime value={row.expected_return_at} timezone={timezone} format="date" />}
              />
            )}
            <Stat
              label={t('pro.clients.detail.barberLabel')}
              value={
                row.usual_barber_name === null ? (
                  <span className="font-fu-mono tabular-nums">{noData}</span>
                ) : (
                  <span className="truncate">{row.usual_barber_name}</span>
                )
              }
            />
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:items-start">
        <div className="lg:col-span-2">
          <ClientNotes organizationId={organizationId} customerId={row.customer_id} />
        </div>
        <div className="lg:col-span-3">
          <ClientHistory
            organizationId={organizationId}
            customerId={row.customer_id}
            currency={currency}
            timezone={timezone}
          />
        </div>
      </div>
    </div>
  )
}
