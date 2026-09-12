import { useTranslation } from 'react-i18next'
import { Badge } from '@/shared/ui/Badge'
import { Duration } from '@/shared/ui/Duration'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import type { CatalogServiceRow } from '@/features/pro-catalog/api/catalog'

export interface ServiceRowProps {
  service: CatalogServiceRow
  currency: string
  /** Faux pour un réceptionniste, ou sur un archivé qu'on ne peut pas restaurer. */
  interactive: boolean
  onOpen: () => void
}

function Separator() {
  return <span aria-hidden="true" className="text-[var(--fu-text-tertiary)]">{'·'}</span>
}

/**
 * OS-2 — la rangée dense du catalogue (P1PRO §3 : le catalogue se BALAIE).
 *
 * Ce qu'elle ne fait jamais : afficher « 0 € » pour un service sans prix
 * (`price_pending` dit « Prix à définir »), ni annoncer une durée observée
 * quand la base n'a rien mesuré (`observed_minutes` à null ⇒ la ligne
 * n'existe pas ; l'explication complète est réservée à la feuille).
 */
export function ServiceRow({ service, currency, interactive, onOpen }: ServiceRowProps) {
  const { t } = useTranslation('v2')

  const badge =
    service.status === 'active' ? null : (
      <Badge
        variant="outline"
        className={
          service.status === 'draft'
            ? 'border-[var(--fu-state-warn)] text-[color:var(--fu-state-warn)]'
            : undefined
        }
      >
        {t(`pro.catalog.status.${service.status}`)}
      </Badge>
    )

  const meta = (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-fu-sm text-[var(--fu-text-secondary)]">
      <Duration minutes={service.duration_minutes} />
      <Separator />
      {service.price_pending ? (
        <span>{t('pro.catalog.meta.noPrice')}</span>
      ) : (
        <Money cents={service.price_cents} currency={currency} />
      )}
      <Separator />
      <span>
        {service.barber_count === 0
          ? t('pro.catalog.meta.everyone')
          : t('pro.catalog.meta.barbers', { count: service.barber_count })}
      </span>
      {service.observed_minutes !== null && (
        <>
          <Separator />
          <span className="font-fu-mono tabular-nums">
            {t('pro.catalog.meta.observed', {
              observed: Math.round(service.observed_minutes),
              count: service.sample_count,
            })}
          </span>
        </>
      )}
    </div>
  )

  if (!interactive) {
    return (
      <Row title={service.name} trailing={badge}>
        {meta}
      </Row>
    )
  }

  return (
    /* Pas d'aria-label : le nom accessible se compose du titre ET de la méta
       (durée, prix, affectation) — un label figé les effacerait. */
    <Row as="button" onClick={onOpen} title={service.name} trailing={badge} chevron>
      {meta}
    </Row>
  )
}
