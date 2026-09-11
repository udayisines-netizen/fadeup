import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { useCustomerHistory } from '@/features/pro-clients/api/clients'
import { historyKindKey, historyStatusKey } from '@/features/pro-clients/lib/crm'

/**
 * OS-2 — l'historique des passages. Régime DENSE À L'INTÉRIEUR d'un bloc
 * aéré (P1PRO §3) : une rangée par passage, l'heure en mono.
 *
 * Le prix est celui du CATALOGUE aujourd'hui, pas un montant encaissé
 * (MASTER_SPEC §14 : « aucune saisie de montant encaissé »). Il est donc
 * libellé comme tel, jamais présenté comme « payé ».
 */

const META_SEPARATOR = '·'

interface ClientHistoryProps {
  organizationId: string | null
  customerId: string
  currency: string
  timezone: string
}

export function ClientHistory({ organizationId, customerId, currency, timezone }: ClientHistoryProps) {
  const { t } = useTranslation('v2')
  const history = useCustomerHistory(organizationId, customerId)
  const rows = history.data ?? []

  return (
    <section
      className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4 lg:p-5"
      data-testid="pro-client-history"
    >
      <h2 className="font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
        {t('pro.clients.detail.historyTitle').toLocaleUpperCase()}
      </h2>

      {history.isPending ? (
        <div className="mt-3" aria-busy="true" aria-label={t('common.a11y.loading')}>
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} className="px-0 last:border-b-0" />
          ))}
        </div>
      ) : history.error ? (
        <div className="mt-3">
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t(errorMessageKey(toAppError(history.error)))}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void history.refetch()}>
            {t('common.action.retry')}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.clients.detail.historyEmpty')}</p>
      ) : (
        <ul className="mt-3 [&>li:last-child>*]:border-b-0">
          {rows.map((row) => {
            const kindKey = historyKindKey(row.kind)
            const statusKey = historyStatusKey(row.status)
            const meta = [
              kindKey ? t(kindKey) : null,
              row.barber_name,
            ].filter((value): value is string => Boolean(value))

            return (
              <li key={`${row.kind}-${row.source_id}`} data-testid="pro-client-history-row">
                <Row
                  className="px-0"
                  title={
                    <span className="flex min-w-0 items-center gap-2">
                      {/* Une prestation supprimée du catalogue n'a plus de nom :
                          on dit l'origine du passage, on n'en invente pas un. */}
                      <span className="truncate">{row.service_name ?? (kindKey ? t(kindKey) : row.kind)}</span>
                      {statusKey && (
                        <Badge variant="outline" className="shrink-0">
                          {t(statusKey)}
                        </Badge>
                      )}
                    </span>
                  }
                  subtitle={
                    <span className="flex flex-wrap items-center gap-x-1.5">
                      <DateTime value={row.occurred_at} timezone={timezone} format="datetime" />
                      {meta.map((value) => (
                        <Fragment key={value}>
                          <span className="text-[var(--fu-text-tertiary)]">{META_SEPARATOR}</span>
                          <span>{value}</span>
                        </Fragment>
                      ))}
                    </span>
                  }
                  trailing={
                    row.price_cents === null ? null : (
                      <span className="flex flex-col items-end">
                        <span className="text-fu-xs text-[var(--fu-text-secondary)]">
                          {t('pro.clients.detail.catalogPrice')}
                        </span>
                        <Money cents={row.price_cents} currency={currency} className="text-fu-sm" />
                      </span>
                    )
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
