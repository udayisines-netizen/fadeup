import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import {
  startingPrice,
  type ProfessionalSearchRow,
  type ResultAvailability,
} from '@/shared/data/discovery'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/Badge'
import { ClaimBadge } from '@/shared/ui/ClaimBadge'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconLocation } from '@/shared/ui/icons'

/**
 * F3 — LA rangée de résultat de la recherche (et de la découverte accueil).
 * Direction A : rangée à filet fin, pas carte à ombre — la composition
 * raffinée par P1c sur une file de six résultats en 390 px (prix et état DANS
 * la colonne de contenu, vignette compacte, nom clampé sur 2 lignes).
 *
 * Elle est PURE : tout état vient des props — la page possède les requêtes.
 * Elle ne dit que des faits :
 *   · distance réelle calculée serveur, sinon rien ;
 *   · prix « à partir de » = minimum réel, sinon « — » ;
 *   · disponibilité dérivée de get_public_service_state, sinon rien d'affirmé ;
 *   · zone de service SANS adresse (jamais de fausse adresse) ;
 *   · badge de revendication neutre quand l'établissement n'est pas géré
 *     (is_managed, contrat F3) — le cas le plus fréquent au lancement.
 *
 * Toute la rangée est le lien vers le profil (lien étendu par ::after) : le
 * CTA transactionnel dominant vit sur le PROFIL, pas vingt fois dans une
 * liste (P1 §9 — un seul CTA dominant par surface).
 */

export interface SearchResultRowProps {
  row: ProfessionalSearchRow
  /** Devises par organisation (get_public_currencies) — absent = prix « — ». */
  currencyByOrganization: Record<string, string> | undefined
  availability: ResultAvailability
  className?: string
}

export function SearchResultRow({ row, currencyByOrganization, availability, className }: SearchResultRowProps) {
  const { t, i18n } = useTranslation('v2')
  const isServiceArea = row.location_kind === 'service_area'
  const price = startingPrice(row, currencyByOrganization)
  const supplyLabel =
    row.marketplace_supply_type === 'independent'
      ? t('discovery.row.supplyIndependent')
      : row.marketplace_supply_type === 'barbershop'
        ? t('discovery.row.supplyBarbershop')
        : null

  return (
    <Row
      clampTitle
      className={cn('relative', className)}
      leading={
        /* Aucun contrat d'imagerie d'établissement n'existe dans la
           recherche : l'avatar à initiales déterministes (P1 §13) — jamais
           une colonne de cadres « pas de photo » répétée vingt fois. */
        <Avatar name={row.organization_name} size="lg" />
      }
      title={
        <Link
          to={`/shop/${encodeURIComponent(row.organization_slug)}`}
          data-testid="result-link"
          className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--fu-focus)]"
        >
          {row.organization_name}
        </Link>
      }
    >
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-fu-sm text-[var(--fu-text-secondary)]">
        {supplyLabel && <span>{supplyLabel}</span>}
        <span className="inline-flex items-center gap-1" data-testid="result-location">
          <IconLocation aria-hidden="true" className="size-3.5" />
          {/* Zone de service : la zone se DIT, aucune adresse n'est inventée. */}
          {isServiceArea ? t('discovery.row.serviceArea', { city: row.city ?? '' }) : row.city}
        </span>
        {row.distance_km !== null && (
          <span className="font-fu-mono tabular-nums" data-testid="result-distance">
            {new Intl.NumberFormat(i18n.language, {
              style: 'unit',
              unit: 'kilometer',
              maximumFractionDigits: 1,
            }).format(row.distance_km)}
          </span>
        )}
      </div>

      <div
        className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"
        data-availability={availability}
        data-org={row.organization_slug}
      >
        {price ? (
          <Money cents={price.cents} currency={price.currency} from className="text-fu-sm" />
        ) : (
          /* Pas de minimum réel publié (ou devise non résolue) : « — », jamais
             une estimation — et un lecteur d'écran entend l'absence. */
          <span
            aria-label={t('discovery.row.noPrice')}
            className="text-fu-sm text-[var(--fu-text-secondary)]"
            data-testid="result-no-price"
          >
            {t('states.metric.noData')}
          </span>
        )}
        <Badge variant={row.is_open_now ? 'brand' : 'neutral'}>
          {row.is_open_now ? t('states.opening.open') : t('states.opening.closed')}
        </Badge>
        {availability === 'available-now' && (
          <StateBadge state="available-now" size="sm" />
        )}
        {availability === 'available-now' && row.queue_waiting_count > 0 && (
          <span className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="result-queue-count">
            {t('discovery.row.queueCount', { count: row.queue_waiting_count })}
          </span>
        )}
        {availability === 'bookable' && <StateBadge state="bookable" size="sm" />}
        {/* closed / unknown / loading : rien d'affirmé sur la rangée — le
            profil dit l'état complet ; l'ouverture reste dite par le badge
            d'horaires ci-dessus. */}
        {!row.is_managed && <ClaimBadge state="unclaimed" size="sm" />}
      </div>
    </Row>
  )
}
