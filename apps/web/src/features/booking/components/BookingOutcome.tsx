import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNow } from '@/shared/hooks/useNow'
import { celebrateSuccess } from '@/shared/motion'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconCheck, IconPending } from '@/shared/ui/icons'
import { isExpired, remainingParts } from '@/features/booking/lib/deadline'
import type { BookAppointmentResult } from '@/features/booking/api/booking'
import { AlternativesSheet } from '@/features/booking/components/AlternativesSheet'

/**
 * Les DEUX issues du tunnel, et jamais l'une déguisée en l'autre (F4 §2) :
 *
 * - `is_request === false` → un RENDEZ-VOUS existe. C'est LE moment orchestré
 *   du produit (P1c « succès de réservation ») : la coche s'affirme, la suite
 *   suit en fondu. Brièvement, sans confettis.
 * - `is_request === true` → une DEMANDE est partie. Aucune célébration, aucun
 *   « Réservé » : le professionnel est prévenu, il a jusqu'à l'échéance
 *   (réelle, plafonnée par la base à least(24 h, heure demandée)) pour
 *   répondre. Ni triomphal, ni inquiétant : le client a fait ce qu'il
 *   fallait ; c'est au salon de répondre.
 *
 * `is_request` et `expires_at` sont LUS depuis la RPC — jamais déduits d'un
 * enum. La déduction est exactement l'endroit où un écran finit par mentir.
 */

export interface BookingOutcomeContext {
  organizationId: string
  organizationName: string
  organizationSlug: string
  serviceName: string
  barberName: string | null
  priceCents: number | null
  currency: string
  timezone: string
}

export function BookingOutcome({ result, context }: { result: BookAppointmentResult; context: BookingOutcomeContext }) {
  if (result.is_request) {
    return <RequestSent result={result} context={context} />
  }
  return <Confirmed result={result} context={context} />
}

function OutcomeRecap({ result, context }: { result: BookAppointmentResult; context: BookingOutcomeContext }) {
  const { t } = useTranslation('v2')
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
      <Row title={context.serviceName} subtitle={t('booking.summary.service')} />
      {context.barberName && <Row title={context.barberName} subtitle={t('booking.summary.professional')} />}
      <Row
        title={<DateTime value={result.starts_at} timezone={context.timezone} format="datetime" />}
        subtitle={t('booking.summary.when')}
      />
      {context.priceCents !== null && (
        <Row
          title={<Money cents={context.priceCents} currency={context.currency} />}
          subtitle={`${t('booking.summary.price')} — ${t('booking.summary.payOnSite')}`}
        />
      )}
    </div>
  )
}

function Confirmed({ result, context }: { result: BookAppointmentResult; context: BookingOutcomeContext }) {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const markRef = useRef<HTMLDivElement>(null)

  // LE moment orchestré de cet écran — et le seul (P1_MOTION_SYSTEM).
  useEffect(() => {
    if (markRef.current) celebrateSuccess(markRef.current)
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-28 pt-8 md:pb-10" data-testid="booking-confirmed">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          ref={markRef}
          className="flex size-14 items-center justify-center rounded-full bg-[var(--fu-accent)]"
        >
          <IconCheck aria-hidden="true" className="size-7 text-[var(--fu-accent-fg)]" />
        </div>
        <div className="fu-success-follow flex flex-col gap-1">
          <h1 className="text-fu-2xl font-semibold text-[var(--fu-text-primary)]">{t('booking.confirmed.title')}</h1>
          <p className="text-fu-base text-[var(--fu-text-secondary)]">{t('booking.confirmed.subtitle')}</p>
        </div>
      </div>
      <div className="fu-success-follow flex flex-col gap-6">
        <OutcomeRecap result={result} context={context} />
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" fullWidth onClick={() => void navigate('/bookings')}>
            {t('booking.confirmed.viewBookings')}
          </Button>
          <Button
            variant="tertiary"
            fullWidth
            onClick={() => void navigate(`/shop/${encodeURIComponent(context.organizationSlug)}`)}
          >
            {t('booking.confirmed.backToProfile')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function RequestSent({ result, context }: { result: BookAppointmentResult; context: BookingOutcomeContext }) {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const now = useNow(30_000)
  const [alternativesOpen, setAlternativesOpen] = useState(false)

  const expired = result.expires_at !== null && isExpired(result.expires_at, now)
  const remaining = result.expires_at !== null ? remainingParts(result.expires_at, now) : null

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-28 pt-8 md:pb-10" data-testid="booking-request-sent">
      {expired ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-fu-2xl font-semibold text-[var(--fu-text-primary)]">{t('booking.request.expiredTitle')}</h1>
          <p className="max-w-md text-fu-base text-[var(--fu-text-secondary)]">{t('booking.request.expiredBody')}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-[var(--fu-surface-subtle)]">
            <IconPending aria-hidden="true" className="size-7 text-[var(--fu-text-secondary)]" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-fu-2xl font-semibold text-[var(--fu-text-primary)]">{t('booking.request.title')}</h1>
            <StateBadge state="pending-request" />
            <p className="max-w-md text-fu-base text-[var(--fu-text-secondary)]">{t('booking.request.body')}</p>
            {result.expires_at && (
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">
                {t('booking.request.deadlineLabel')}{' '}
                <DateTime value={result.expires_at} timezone={context.timezone} format="datetime" />
              </p>
            )}
            {remaining && (
              <p className="font-fu-mono text-fu-sm tabular-nums text-[var(--fu-text-primary)]" data-testid="request-countdown">
                {t('booking.request.expiresIn', {
                  time:
                    remaining.hours > 0
                      ? t('booking.request.hoursMinutes', { hours: remaining.hours, minutes: remaining.minutes })
                      : t('booking.request.minutesOnly', { minutes: remaining.minutes }),
                })}
              </p>
            )}
          </div>
        </div>
      )}

      <OutcomeRecap result={result} context={context} />

      <div className="flex flex-col gap-2">
        {expired ? (
          <Button variant="primary" size="lg" fullWidth onClick={() => setAlternativesOpen(true)}>
            {t('booking.request.findAlternative')}
          </Button>
        ) : (
          <Button variant="secondary" size="lg" fullWidth onClick={() => setAlternativesOpen(true)}>
            {t('booking.request.findAlternative')}
          </Button>
        )}
        <Button variant="tertiary" fullWidth onClick={() => void navigate('/bookings')}>
          {t('booking.request.viewBookings')}
        </Button>
      </div>

      <AlternativesSheet
        open={alternativesOpen}
        onOpenChange={setAlternativesOpen}
        excludeOrganizationId={context.organizationId}
        serviceQuery={context.serviceName}
      />
    </div>
  )
}
