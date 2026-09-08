import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import {
  startingPrice,
  type ProfessionalSearchRow,
  type ResultAvailability,
} from '@/shared/data/discovery'
import { demoBanner } from '@/shared/lib/demoMedia'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/Badge'
import { Money } from '@/shared/ui/Money'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconLocation } from '@/shared/ui/icons'

/**
 * D1 — LA carte de résultat. Remplace la rangée à filet fin (SearchResultRow,
 * révoquée par D1 §4) sur /search et sur la découverte de l'accueil.
 *
 * Composition : mini-bannière (image réelle ou repli composé — jamais un
 * carré gris), portrait en surimpression décalé, nom, type · ville, prix
 * « à partir de », UN badge d'état. Environ 180 px de haut — trois par
 * écran en 390 px.
 *
 * Hiérarchie des badges (D1 : « l'essentiel sur la carte, le reste dans la
 * feuille ») : la carte porte le prix réel + le badge le plus utile
 * (disponible maintenant > ouvert/fermé) + la revendication quand elle
 * manque. File d'attente, zone de service détaillée, état de réservation
 * complet : la FEUILLE les dit.
 *
 * Elle reste PURE (tout état vient des props) et ne dit que des faits :
 * prix = minimum réel sinon « — », disponibilité dérivée de
 * get_public_service_state sinon rien d'affirmé, aucune adresse inventée.
 *
 * Un tap n'ouvre plus le profil : il ouvre la feuille de résultat (D1 §5),
 * la liste reste dessous. Toute la carte est le bouton.
 */

export interface ResultCardProps {
  row: ProfessionalSearchRow
  /** Devises par organisation (get_public_currencies) — absent = prix « — ». */
  currencyByOrganization: Record<string, string> | undefined
  availability: ResultAvailability
  /**
   * P1PRO §7 — la capacité commerciale de l'organisation
   * (`get_public_booking_capabilities`) : `true` = confirme immédiatement
   * (« Réservable »), `false` = une demande sous échéance (« Sur demande »),
   * `undefined`/`null` = inconnu (rien d'affirmé, comportement d'avant).
   */
  bookingCapability?: boolean | null
  onOpen: (row: ProfessionalSearchRow) => void
  className?: string
}

/** Repli de bannière : une composition, pas un carré gris — monogramme
 *  décoratif sur la surface douce de marque (aucune fausse image). */
function BannerFallback({ name }: { name: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || '•'
  return (
    <div aria-hidden="true" className="flex size-full items-end justify-end overflow-hidden bg-[var(--fu-surface-brand)]">
      <span className="-mb-8 -me-3 select-none font-fu-sans text-[7rem] font-bold leading-none text-[var(--fu-brand-watermark)]">
        {letter}
      </span>
    </div>
  )
}

export function ResultCard({
  row,
  currencyByOrganization,
  availability,
  bookingCapability,
  onOpen,
  className,
}: ResultCardProps) {
  const { t, i18n } = useTranslation('v2')
  const isServiceArea = row.location_kind === 'service_area'
  const price = startingPrice(row, currencyByOrganization)
  const banner = demoBanner(row.organization_slug)
  // P1PRO §7 — le badge dit l'ISSUE réelle du geste quand la réservation
  // accepte : « Sur demande » (pas de capacité commerciale) ou
  // « Réservable » (confirmation immédiate). « Sur demande » dit déjà que le
  // compte n'est pas géré : la mention de revendication devient redondante
  // sur la CARTE (elle reste sur la feuille et le profil).
  const onRequest = availability === 'bookable' && bookingCapability === false
  const confirmedBookable = availability === 'bookable' && bookingCapability === true
  const supplyLabel =
    row.marketplace_supply_type === 'independent'
      ? t('discovery.row.supplyIndependent')
      : row.marketplace_supply_type === 'barbershop'
        ? t('discovery.row.supplyBarbershop')
        : null

  return (
    <article
      data-testid="result-card"
      data-org={row.organization_slug}
      data-availability={availability}
      className={cn(
        'fu-card group relative overflow-hidden rounded-[var(--radius-card)] bg-[var(--fu-surface)]',
        'shadow-[var(--fu-shadow-card)] transition-[box-shadow,transform] duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)]',
        'hover:shadow-[var(--fu-shadow-card-hover)] motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.985]',
        'focus-within:ring-2 focus-within:ring-[var(--fu-focus)]',
        className,
      )}
    >
      {/* Toute la carte est LE bouton : il ouvre la feuille, pas le profil. */}
      <button
        type="button"
        data-testid="result-open"
        aria-label={t('discovery.card.openAria', { name: row.organization_name })}
        onClick={() => onOpen(row)}
        className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none"
      />

      {/* Mini-bannière — image de démonstration marquée, ou repli composé. */}
      <div className="relative h-[5.25rem]">
        {banner ? (
          <img src={banner} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <BannerFallback name={row.organization_name} />
        )}
      </div>

      {/* Portrait en surimpression, décalé à gauche. */}
      <div className="relative -mt-7 flex items-end justify-between px-4">
        <Avatar
          name={row.barber_display_name ?? row.organization_name}
          src={row.barber_avatar_url}
          size="lg"
          className="ring-4 ring-[var(--fu-surface)]"
        />
        {!row.is_managed && !onRequest && <ClaimHint />}
      </div>

      <div className="px-4 pb-3.5 pt-1.5">
        <h3 className="truncate text-fu-base font-semibold text-[var(--fu-text-primary)]">
          {row.organization_name}
        </h3>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-fu-sm text-[var(--fu-text-secondary)]">
          {supplyLabel && <span className="shrink-0">{supplyLabel}</span>}
          {supplyLabel && <span aria-hidden="true" className="shrink-0 text-[var(--fu-text-tertiary)]">·</span>}
          <span className="inline-flex min-w-0 items-center gap-1" data-testid="result-location">
            <IconLocation aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">
              {isServiceArea ? t('discovery.row.serviceArea', { city: row.city ?? '' }) : row.city}
            </span>
          </span>
          {row.distance_km !== null && (
            <span className="shrink-0 font-fu-mono tabular-nums" data-testid="result-distance">
              {new Intl.NumberFormat(i18n.language, {
                style: 'unit',
                unit: 'kilometer',
                maximumFractionDigits: 1,
              }).format(row.distance_km)}
            </span>
          )}
        </p>

        <div className="mt-2 flex items-center justify-between gap-2">
          {price ? (
            <Money cents={price.cents} currency={price.currency} from className="text-fu-sm font-medium" />
          ) : (
            <span
              aria-label={t('discovery.row.noPrice')}
              className="text-fu-sm text-[var(--fu-text-secondary)]"
              data-testid="result-no-price"
            >
              {t('states.metric.noData')}
            </span>
          )}
          {/* UN badge : le fait le plus utile. Disponible maintenant (vivant)
              prime ; puis l'issue réelle du geste — « Sur demande » ou
              « Réservable » ; sinon l'ouverture. Le reste vit dans la feuille. */}
          {availability === 'available-now' ? (
            <StateBadge state="available-now" size="sm" />
          ) : onRequest ? (
            <StateBadge state="on-request" size="sm" />
          ) : confirmedBookable ? (
            <StateBadge state="bookable" size="sm" />
          ) : (
            <Badge variant={row.is_open_now ? 'brand' : 'neutral'}>
              {row.is_open_now ? t('states.opening.open') : t('states.opening.closedShort')}
            </Badge>
          )}
        </div>
      </div>
    </article>
  )
}

/** Revendication manquante — dite sobrement, sans alerte (loi produit). */
function ClaimHint() {
  const { t } = useTranslation('v2')
  return (
    <span
      data-state="unclaimed"
      className="mb-1 inline-flex items-center rounded-[var(--radius-control)] bg-[var(--fu-surface)] px-2 py-0.5 text-fu-xs font-medium text-[var(--fu-text-secondary)] shadow-[var(--fu-shadow-card)]"
    >
      {t('states.claim.unclaimedShort')}
    </span>
  )
}
