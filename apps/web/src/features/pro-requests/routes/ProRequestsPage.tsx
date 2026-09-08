import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNow } from '@/shared/hooks/useNow'
import { deviceTimezone } from '@/shared/lib/format'
import { isExpired, remainingMs, remainingParts } from '@/shared/lib/deadline'
import { useProEntitlements, useProOrganization } from '@/shared/data/organization'
import {
  useBookingRequestHistory,
  useBookingRequests,
  type BookingRequestHistoryRow,
  type BookingRequestRow,
} from '@/shared/data/proRequests'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Dialog } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { Textarea } from '@/shared/ui/Textarea'
import { IconClose } from '@/shared/ui/icons'
import { IconButton } from '@/shared/ui/IconButton'
import {
  RequestActionError,
  useConfirmRequest,
  useDeclineRequest,
  useProRequestsChannel,
  useStartTrial,
} from '@/features/pro-requests/api/requests'
import { CounterProposeSheet } from '@/features/pro-requests/components/CounterProposeSheet'

/**
 * P1PRO §10 — l'écran des demandes : le maillon manquant de la conversion.
 * Le pro arrive d'un e-mail, souvent en mobile — comprendre en trois
 * secondes, répondre en un geste.
 *
 * Régimes (contrat de design §3) : les demandes À TRAITER sont AÉRÉES (un
 * bloc par décision, échéance qui défile en mono), l'HISTORIQUE est DENSE
 * (rangées à filet fin). Accepter est le geste le plus facile ; refuser
 * demande confirmation — un client attend derrière. Un salon Free accepte
 * SANS mur : l'incitation (essai 14 j) vient APRÈS, fermable, jamais
 * bloquante.
 */

const panelClass = 'rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4'

function outcomeKey(row: BookingRequestHistoryRow): string {
  if (row.status === 'completed') return 'pro.requests.outcome.completed'
  if (row.status === 'no_show') return 'pro.requests.outcome.noShow'
  if (row.status === 'confirmed') {
    return row.counter_proposed_at ? 'pro.requests.outcome.acceptedCounter' : 'pro.requests.outcome.accepted'
  }
  switch (row.resolution) {
    case 'declined':
      return 'pro.requests.outcome.declined'
    case 'expired':
      return 'pro.requests.outcome.expired'
    case 'cancelled_by_customer':
      return row.counter_proposed_at
        ? 'pro.requests.outcome.counterDeclined'
        : 'pro.requests.outcome.customerCancelled'
    case 'cancelled_by_business':
      return 'pro.requests.outcome.businessCancelled'
    case 'rescheduled':
      return 'pro.requests.outcome.rescheduled'
    default:
      return 'pro.requests.outcome.closed'
  }
}

export function ProRequestsPage() {
  const { t } = useTranslation('v2')
  const now = useNow(1_000)

  const { organization } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const { entitlements } = useProEntitlements(organizationId)
  const hasBookingCapability = (entitlements?.liveCapabilities ?? []).includes('booking')

  const requests = useBookingRequests(organizationId)
  const history = useBookingRequestHistory(organizationId)
  const confirm = useConfirmRequest(organizationId)
  const decline = useDeclineRequest(organizationId)
  const trial = useStartTrial(organizationId)
  useProRequestsChannel(organizationId)

  const [declining, setDeclining] = useState<BookingRequestRow | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [countering, setCountering] = useState<BookingRequestRow | null>(null)
  /* L'incitation d'APRÈS acceptation (P1PRO §10) — jamais avant. */
  const [upsellOpen, setUpsellOpen] = useState(false)
  const [upsellDismissed, setUpsellDismissed] = useState(false)

  const timezoneOf = (row: { location_id: string }): string =>
    organization?.locations.find((location) => location.id === row.location_id)?.timezone ?? deviceTimezone()

  const allRows = useMemo(() => requests.data ?? [], [requests.data])
  /* Une échéance atteinte SORT de la liste entre deux balayages serveur :
     proposer « Accepter » sur une demande expirée serait un mensonge. */
  const fresh = useMemo(
    () => allRows.filter((row) => !(row.expires_at !== null && isExpired(row.expires_at, now))),
    [allRows, now],
  )
  const toAnswer = fresh.filter((row) => row.counter_proposed_at === null)
  const awaitingCustomer = fresh.filter((row) => row.counter_proposed_at !== null)
  const historyRows = history.data ?? []

  /* L'arrivée d'une NOUVELLE demande est un changement d'état réel : elle
     est animée (fu-rise-in) — le registre sobre du contrat §5. */
  const seenIds = useRef<Set<string>>(new Set())
  const isNew = (id: string) => !seenIds.current.has(id)
  useEffect(() => {
    for (const row of allRows) seenIds.current.add(row.id)
  }, [allRows])

  const countdown = (expiresAt: string | null): { label: string; urgent: boolean } | null => {
    if (!expiresAt) return null
    const parts = remainingParts(expiresAt, now)
    if (!parts) return null
    const urgent = remainingMs(expiresAt, now) < 15 * 60_000
    return {
      label:
        parts.hours > 0
          ? t('booking.request.hoursMinutes', { hours: parts.hours, minutes: parts.minutes })
          : t('booking.request.minutesOnly', { minutes: parts.minutes }),
      urgent,
    }
  }

  const accept = (row: BookingRequestRow) => {
    confirm.mutate(row.id, {
      onSuccess: () => {
        if (!hasBookingCapability && !upsellDismissed) setUpsellOpen(true)
      },
    })
  }

  const confirmError =
    confirm.error instanceof RequestActionError
      ? confirm.error.code === 'request_expired'
        ? t('pro.requests.errors.expired')
        : confirm.error.code === 'counter_pending'
          ? t('pro.requests.errors.counterPending')
          : t('pro.requests.errors.generic')
      : confirm.isError
        ? t('pro.requests.errors.generic')
        : null

  const loading = !organization || requests.isPending

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:px-8 lg:py-8" data-testid="pro-requests">
      <header className="mb-4 lg:mb-6">
        <p className="font-fu-mono text-fu-xs tracking-widest text-[var(--fu-text-secondary)]">
          {t('pro.requests.label').toLocaleUpperCase()}
        </p>
        <h1 className="mt-1 text-fu-xl font-semibold lg:text-fu-2xl">{t('pro.requests.title')}</h1>
      </header>

      {/* L'incitation d'APRÈS : le pro vient de gagner un client via FadeUp.
          Fermable, jamais bloquante, jamais avant le geste. */}
      {upsellOpen && !upsellDismissed && (
        <div
          className="fu-rise-in mb-4 flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--fu-accent)] bg-[var(--fu-surface-brand)] p-4"
          data-testid="free-upsell"
        >
          <div>
            <p className="text-fu-base font-semibold text-[var(--fu-text-primary)]">{t('pro.requests.upsell.title')}</p>
            <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.requests.upsell.body')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                data-testid="upsell-trial"
                loading={trial.isPending}
                onClick={() => trial.mutate()}
              >
                {t('pro.requests.upsell.cta')}
              </Button>
              {trial.isSuccess && <span className="text-fu-sm text-[var(--fu-accent-text)]">{t('pro.requests.upsell.started')}</span>}
              {trial.isError && <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.requests.upsell.unavailable')}</span>}
            </div>
          </div>
          <IconButton
            aria-label={t('common.action.dismiss')}
            data-testid="upsell-dismiss"
            onClick={() => {
              setUpsellOpen(false)
              setUpsellDismissed(true)
            }}
          >
            <IconClose />
          </IconButton>
        </div>
      )}

      {confirmError && (
        <p className="mb-3 text-fu-sm text-[var(--fu-danger)]" role="alert">
          {confirmError}
        </p>
      )}

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <SkeletonRect className="h-32 w-full" />
          <SkeletonRect className="h-32 w-full" />
        </div>
      ) : toAnswer.length === 0 && awaitingCustomer.length === 0 ? (
        <div className={panelClass} data-testid="requests-empty">
          <EmptyState
            title={t('pro.requests.empty.title')}
            description={t('pro.requests.empty.description')}
            action={
              organization ? (
                <Link
                  to={`/shop/${encodeURIComponent(organization.slug)}`}
                  className="text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
                >
                  {t('pro.requests.empty.action')}
                </Link>
              ) : (
                <span />
              )
            }
          />
        </div>
      ) : (
        <>
          {/* À TRAITER — le régime AÉRÉ : un bloc par décision. */}
          {toAnswer.length > 0 && (
            <section className="flex flex-col gap-3" data-testid="requests-pending" aria-label={t('pro.requests.title')}>
              {toAnswer.map((row) => {
                const timer = countdown(row.expires_at)
                const timezone = timezoneOf(row)
                return (
                  <article
                    key={row.id}
                    data-testid="request-card"
                    className={`${panelClass} ${isNew(row.id) ? 'fu-rise-in' : ''} lg:p-5`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">
                          {row.service_name ?? t('pro.requests.unknownService')}
                          {row.price_cents !== null && organization && (
                            <Money
                              cents={row.price_cents}
                              currency={organization.currency}
                              className="ms-3 align-baseline font-fu-mono text-fu-sm font-normal text-[var(--fu-text-secondary)]"
                            />
                          )}
                        </p>
                        <p className="mt-1 font-fu-mono text-fu-xl font-semibold tabular-nums" data-testid="request-slot">
                          <DateTime value={row.starts_at} timezone={timezone} format="datetime" />
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-fu-sm text-[var(--fu-text-secondary)]">
                          <span data-testid="request-customer">{row.customer_name}</span>
                          {row.barber_display_name && <span>{t('pro.requests.withBarber', { name: row.barber_display_name })}</span>}
                          {row.customer_phone && <span className="font-fu-mono tabular-nums">{row.customer_phone}</span>}
                        </p>
                        {row.notes && (
                          <p className="mt-2 rounded-[var(--radius-control)] bg-[var(--fu-surface-subtle)] px-3 py-2 text-fu-sm text-[var(--fu-text-secondary)]">
                            {row.notes}
                          </p>
                        )}
                      </div>
                      {timer && (
                        <p className="text-end">
                          <span className="block text-fu-xs text-[var(--fu-text-secondary)]">
                            {t('pro.requests.expiresLabel')}
                          </span>
                          <span
                            data-testid="request-countdown"
                            className={`font-fu-mono text-fu-lg font-semibold tabular-nums ${timer.urgent ? 'text-[var(--fu-state-warn)]' : 'text-[var(--fu-text-primary)]'}`}
                          >
                            {timer.label}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {/* Accepter : LE geste le plus facile — primary, la plus grande cible. */}
                      <Button
                        variant="primary"
                        size="lg"
                        className="flex-[2] basis-40"
                        data-testid="request-accept"
                        loading={confirm.isPending && confirm.variables === row.id}
                        onClick={() => accept(row)}
                      >
                        {t('pro.requests.accept')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="lg"
                        className="flex-1 basis-32"
                        data-testid="request-counter"
                        disabled={confirm.isPending}
                        onClick={() => setCountering(row)}
                      >
                        {t('pro.requests.counter')}
                      </Button>
                      <Button
                        variant="tertiary"
                        size="lg"
                        className="flex-1 basis-24 text-[color:var(--fu-danger)]"
                        data-testid="request-decline"
                        disabled={confirm.isPending}
                        onClick={() => {
                          setDeclineNote('')
                          setDeclining(row)
                        }}
                      >
                        {t('pro.requests.decline')}
                      </Button>
                    </div>
                  </article>
                )
              })}
            </section>
          )}

          {/* EN ATTENTE DU CLIENT — les contre-propositions envoyées. */}
          {awaitingCustomer.length > 0 && (
            <section className="mt-6 flex flex-col gap-2" data-testid="requests-awaiting">
              <h2 className="font-fu-mono text-fu-xs tracking-widest text-[var(--fu-text-secondary)]">
                {t('pro.requests.awaitingTitle').toLocaleUpperCase()}
              </h2>
              {awaitingCustomer.map((row) => {
                const timer = countdown(row.expires_at)
                const timezone = timezoneOf(row)
                return (
                  <article key={row.id} className={panelClass} data-testid="awaiting-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-fu-base font-semibold text-[var(--fu-text-primary)]">
                          {row.service_name ?? t('pro.requests.unknownService')}
                          <span className="ms-3 text-fu-sm font-normal text-[var(--fu-text-secondary)]">{row.customer_name}</span>
                        </p>
                        <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">
                          {row.counter_original_starts_at && (
                            <s className="me-2">
                              <DateTime value={row.counter_original_starts_at} timezone={timezone} format="datetime" />
                            </s>
                          )}
                          <span className="font-fu-mono font-medium tabular-nums text-[var(--fu-text-primary)]">
                            <DateTime value={row.starts_at} timezone={timezone} format="datetime" />
                          </span>
                        </p>
                        {row.counter_note && (
                          <p className="mt-1 text-fu-sm text-[var(--fu-text-tertiary)]">{row.counter_note}</p>
                        )}
                      </div>
                      <div className="text-end">
                        <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.requests.awaitingHint')}</p>
                        {timer && (
                          <p className={`mt-0.5 font-fu-mono text-fu-sm tabular-nums ${timer.urgent ? 'text-[var(--fu-state-warn)]' : 'text-[var(--fu-text-secondary)]'}`}>
                            {timer.label}
                          </p>
                        )}
                        <Button
                          variant="tertiary"
                          size="sm"
                          className="mt-1 text-[color:var(--fu-danger)]"
                          onClick={() => {
                            setDeclineNote('')
                            setDeclining(row)
                          }}
                        >
                          {t('pro.requests.decline')}
                        </Button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </section>
          )}
        </>
      )}

      {/* HISTORIQUE — le régime DENSE : la preuve de ce que FadeUp apporte. */}
      <section className="mt-8" data-testid="requests-history">
        <h2 className="font-fu-mono text-fu-xs tracking-widest text-[var(--fu-text-secondary)]">
          {t('pro.requests.historyTitle').toLocaleUpperCase()}
        </h2>
        {history.isPending ? (
          <SkeletonRect className="mt-3 h-20 w-full" />
        ) : historyRows.length === 0 ? (
          <p className="mt-3 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.requests.historyEmpty')}</p>
        ) : (
          <div className="mt-2 rounded-[var(--radius-card)] border border-[var(--fu-border)] px-4 [&>*:last-child]:border-b-0">
            {historyRows.map((row) => (
              <Row
                key={row.id}
                className="px-0"
                leading={
                  <span className="font-fu-mono text-fu-xs tabular-nums text-[var(--fu-text-secondary)]">
                    <DateTime value={row.starts_at} timezone={timezoneOf(row)} format="date" />
                  </span>
                }
                title={
                  <span className="text-fu-sm font-medium">
                    {row.customer_name}
                    <span className="ms-2 font-normal text-[var(--fu-text-secondary)]">{row.service_name}</span>
                  </span>
                }
                trailing={
                  <span className="flex items-center gap-3">
                    {row.price_cents !== null && row.status !== 'cancelled' && (
                      <Money cents={row.price_cents} currency={row.currency} className="font-fu-mono text-fu-sm tabular-nums" />
                    )}
                    <span
                      className={`text-fu-xs ${
                        row.status === 'confirmed' || row.status === 'completed'
                          ? 'text-[var(--fu-accent-text)]'
                          : 'text-[var(--fu-text-secondary)]'
                      }`}
                      data-testid="history-outcome"
                    >
                      {t(outcomeKey(row))}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Refuser demande CONFIRMATION — un client attend derrière. */}
      {declining && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setDeclining(null)
          }}
          title={t('pro.requests.declineTitle')}
          description={t('pro.requests.declineBody', { name: declining.customer_name })}
        >
          <div className="flex flex-col gap-3">
            <Textarea
              id="decline-note"
              label={t('pro.requests.declineNoteLabel')}
              value={declineNote}
              maxLength={280}
              onChange={(event) => setDeclineNote(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeclining(null)}>
                {t('common.action.cancel')}
              </Button>
              <Button
                variant="destructive"
                data-testid="decline-confirm"
                loading={decline.isPending}
                onClick={() => {
                  decline.mutate(
                    { appointmentId: declining.id, note: declineNote.trim() || undefined },
                    { onSettled: () => setDeclining(null) },
                  )
                }}
              >
                {t('pro.requests.declineConfirm')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {countering && organizationId && (
        <CounterProposeSheet
          request={countering}
          organizationId={organizationId}
          timezone={timezoneOf(countering)}
          onOpenChange={(next) => {
            if (!next) setCountering(null)
          }}
          onProposed={() => setCountering(null)}
        />
      )}
    </div>
  )
}

export default ProRequestsPage
