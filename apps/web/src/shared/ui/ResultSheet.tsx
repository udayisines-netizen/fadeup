import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ProfessionalSearchRow, ResultAvailability } from '@/shared/data/discovery'
import { startingPrice, useSheetServices } from '@/shared/data/discovery'
import { demoBanner } from '@/shared/lib/demoMedia'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { ClaimBadge } from '@/shared/ui/ClaimBadge'
import { Duration } from '@/shared/ui/Duration'
import { Money } from '@/shared/ui/Money'
import { Sheet } from '@/shared/ui/Sheet'
import { SkeletonText } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconLocation } from '@/shared/ui/icons'

/**
 * D1 §5 — LA feuille de résultat. Un tap sur une carte l'ouvre ; la liste
 * reste visible dessous (scrim), la position de défilement est préservée
 * (Radix verrouille puis restaure le scroll du body). Elle contient
 * l'essentiel — bannière, portrait, nom, l'état RÉEL, les services
 * principaux et leurs prix, LE CTA — plus le chemin vers le profil complet.
 *
 * Elle ne dit que des faits : l'état de réservation vient du même
 * get_public_service_state que la carte ; les services de la même RPC que le
 * profil (cache partagé). Un profil non revendiqué reste neutre et son CTA
 * ne fabrique aucune capacité.
 */

const MAX_SHEET_SERVICES = 4

export interface ResultSheetProps {
  row: ProfessionalSearchRow | null
  currencyByOrganization: Record<string, string> | undefined
  availability: ResultAvailability
  onOpenChange: (open: boolean) => void
}

export function ResultSheet({ row, currencyByOrganization, availability, onOpenChange }: ResultSheetProps) {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()

  const slug = row?.organization_slug ?? null
  const services = useSheetServices(slug, row?.location_id ?? null)
  const serviceRows = (services.data ?? []).slice(0, MAX_SHEET_SERVICES)
  const currency = row ? currencyByOrganization?.[row.organization_id] : undefined
  const price = row ? startingPrice(row, currencyByOrganization) : null
  const banner = demoBanner(slug ?? undefined)
  const isServiceArea = row?.location_kind === 'service_area'

  if (!row) return null

  const bookTo = `/book/${encodeURIComponent(row.organization_slug)}?l=${encodeURIComponent(row.location_id)}`
  const queueTo = `/q/${encodeURIComponent(row.organization_slug)}?l=${encodeURIComponent(row.location_id)}`
  const profileTo = `/shop/${encodeURIComponent(row.organization_slug)}`

  const supplyLabel =
    row.marketplace_supply_type === 'independent'
      ? t('discovery.row.supplyIndependent')
      : row.marketplace_supply_type === 'barbershop'
        ? t('discovery.row.supplyBarbershop')
        : null

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={row.organization_name}
      hideHeader
      hero={
        <div data-testid="result-sheet-hero">
          {/* Poignée de glissement — la feuille se referme vers le bas. */}
          <div aria-hidden="true" className="absolute inset-x-0 top-1.5 z-10 flex justify-center md:hidden">
            <span className="h-1 w-10 rounded-[var(--radius-avatar)] bg-[var(--fu-surface)]/90" />
          </div>
          <div className="h-32">
            {banner ? (
              <img src={banner} alt="" className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-end justify-end overflow-hidden bg-[var(--fu-surface-brand)]">
                <span aria-hidden="true" className="-mb-10 -me-4 select-none text-[9rem] font-bold leading-none text-[var(--fu-brand-watermark)]">
                  {row.organization_name.trim().charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <div className="relative -mt-8 flex items-end justify-between px-4">
            <Avatar
              name={row.barber_display_name ?? row.organization_name}
              src={row.barber_avatar_url}
              size="xl"
              /* D1 §8 — transition partagée : ce portrait GRANDIT vers celui
                 du profil (View Transitions ; nom absent sous reduce). */
              className="fu-vt-portrait ring-4 ring-[var(--fu-surface)]"
            />
            <div className="mb-1 flex items-center gap-1.5">
              {availability === 'available-now' && <StateBadge state="available-now" size="sm" />}
              <Badge variant={row.is_open_now ? 'brand' : 'neutral'}>
                {row.is_open_now ? t('states.opening.open') : t('states.opening.closedShort')}
              </Badge>
            </div>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-2" data-testid="result-sheet">
        <div>
          <h2 className="text-fu-lg font-semibold leading-snug text-[var(--fu-text-primary)]">{row.organization_name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-fu-sm text-[var(--fu-text-secondary)]">
            {supplyLabel && <span>{supplyLabel}</span>}
            <span className="inline-flex items-center gap-1">
              <IconLocation aria-hidden="true" className="size-3.5" />
              {isServiceArea ? t('discovery.row.serviceArea', { city: row.city ?? '' }) : [row.address_line1, row.city].filter(Boolean).join(', ')}
            </span>
          </p>
          {!row.is_managed && (
            <div className="mt-2">
              <ClaimBadge state="unclaimed" size="sm" />
            </div>
          )}
          {availability === 'available-now' && row.queue_waiting_count > 0 && (
            <p className="mt-1.5 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="sheet-queue-count">
              {t('discovery.row.queueCount', { count: row.queue_waiting_count })}
            </p>
          )}
        </div>

        {/* Services principaux — prix réels, jamais une estimation. */}
        <section aria-label={t('discovery.sheet.services')}>
          <h3 className="mb-2 text-fu-sm font-medium text-[var(--fu-text-secondary)]">
            {t('discovery.sheet.services')}
          </h3>
          {services.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <SkeletonText className="w-3/4" />
              <SkeletonText className="w-2/3" />
              <SkeletonText className="w-3/4" />
            </div>
          ) : serviceRows.length > 0 ? (
            <ul className="divide-y divide-[var(--fu-border)]">
              {serviceRows.map((service) => (
                <li key={service.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-fu-sm font-medium text-[var(--fu-text-primary)]">{service.name}</p>
                    <p className="text-fu-sm text-[var(--fu-text-secondary)]">
                      <Duration minutes={service.duration_minutes} />
                    </p>
                  </div>
                  {currency ? (
                    <Money cents={service.price_cents} currency={currency} className="shrink-0 text-fu-sm" />
                  ) : (
                    <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('states.metric.noData')}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">
              {price ? <Money cents={price.cents} currency={price.currency} from /> : t('discovery.sheet.servicesEmpty')}
            </p>
          )}
        </section>

        {/* L'ÉTAT RÉEL conditionne LE CTA — aucun optimisme, aucune capacité
            fabriquée sur un non revendiqué. */}
        <div className="flex flex-col gap-2">
          {availability === 'bookable' ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              data-testid="sheet-book-cta"
              aria-label={t('profile.cta.bookAria', { name: row.organization_name })}
              onClick={() => void navigate(bookTo)}
            >
              {t('common.action.book')}
            </Button>
          ) : availability === 'available-now' ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              data-testid="sheet-book-cta"
              onClick={() => void navigate(queueTo)}
            >
              {t('profile.cta.joinQueue')}
            </Button>
          ) : (
            <>
              <Button variant="primary" size="lg" fullWidth disabled data-testid="sheet-book-cta" loading={availability === 'loading'}>
                {t('common.action.book')}
              </Button>
              {availability !== 'loading' && (
                <p className="text-center text-fu-sm text-[var(--fu-text-secondary)]" data-testid="sheet-cta-note">
                  {availability === 'unknown'
                    ? t('profile.cta.unknownNote')
                    : !row.is_managed
                      ? t('profile.unclaimed.bookingUnavailable')
                      : t('profile.cta.closedNote')}
                </p>
              )}
            </>
          )}
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            data-testid="sheet-full-profile"
            onClick={() => void navigate(profileTo, { viewTransition: true })}
          >
            {t('discovery.sheet.fullProfile')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
