import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { Sheet } from '@/shared/ui/Sheet'
import { Spinner } from '@/shared/ui/Spinner'
import { useBookingAlternatives, usePublicCurrencies } from '@/features/booking/api/booking'

/**
 * Les alternatives après une demande expirée (F4 §5) — construites par B2 :
 * elles excluent l'organisation d'origine, se trient par distance quand une
 * position existe, et portent `accepts_immediate_booking`.
 *
 * Ce champ vaut `false` presque partout aujourd'hui — c'est une information
 * VRAIE, pas un défaut : l'écran ne dit « Réserver » que là où la
 * confirmation est immédiate ; ailleurs le CTA dit « Envoyer une demande »,
 * jamais « réservez ici » vers une seconde attente.
 *
 * La géolocalisation n'est demandée QU'AU geste « trier par distance »
 * (MASTER_SPEC §8), jamais à l'ouverture.
 */
export function AlternativesSheet({
  open,
  onOpenChange,
  excludeOrganizationId,
  serviceQuery,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  excludeOrganizationId: string | null
  serviceQuery: string | null
}) {
  const { t, i18n } = useTranslation('v2')
  const navigate = useNavigate()
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null)
  const [geoDenied, setGeoDenied] = useState(false)

  const alternatives = useBookingAlternatives({
    excludeOrganizationId,
    serviceQuery,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    enabled: open,
  })

  const askLocation = () => {
    setGeoDenied(false)
    navigator.geolocation.getCurrentPosition(
      (position) => setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => setGeoDenied(true),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    )
  }

  const kmFormat = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 })
  const currencies = usePublicCurrencies((alternatives.data ?? []).map((alt) => alt.organization_id))

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('booking.alternatives.title')} description={t('booking.alternatives.description')}>
      <div className="flex flex-col gap-4" data-testid="booking-alternatives">
        {coords === null && (
          <Button variant="secondary" onClick={askLocation}>
            {t('booking.alternatives.useLocation')}
          </Button>
        )}
        {geoDenied && (
          <p role="status" className="text-fu-sm text-[var(--fu-text-secondary)]">
            {t('booking.alternatives.geoDenied')}
          </p>
        )}

        {alternatives.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner announce />
          </div>
        ) : (alternatives.data ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('booking.alternatives.empty')}</p>
            <Button variant="secondary" onClick={() => void navigate('/search')}>
              {t('booking.alternatives.emptyAction')}
            </Button>
          </div>
        ) : (
          <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
            {(alternatives.data ?? []).map((alt) => {
              const altCurrency = currencies.data?.[alt.organization_id] ?? null
              const subtitleParts = [
                alt.city ?? undefined,
                alt.distance_km !== null
                  ? t('booking.alternatives.distanceKm', { distance: kmFormat.format(alt.distance_km) })
                  : undefined,
                alt.is_open_now ? t('booking.alternatives.openNow') : undefined,
              ].filter(Boolean)
              return (
                <Row
                  key={alt.location_id}
                  title={alt.organization_name}
                  subtitle={subtitleParts.join(' · ')}
                  trailing={
                    <span className="flex items-center gap-3">
                      {alt.starting_price_cents !== null && altCurrency !== null && (
                        <Money cents={alt.starting_price_cents} currency={altCurrency} from />
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          void navigate(`/book/${encodeURIComponent(alt.organization_slug)}?l=${alt.location_id}`)
                        }
                      >
                        {alt.accepts_immediate_booking ? t('booking.alternatives.book') : t('booking.alternatives.sendRequest')}
                      </Button>
                    </span>
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </Sheet>
  )
}
