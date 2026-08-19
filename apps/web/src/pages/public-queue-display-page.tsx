import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CircleCheckBig, Scissors } from 'lucide-react'
import { usePublicLocations, usePublicOrganization } from '@/lib/queries/public-booking'
import { usePublicQueueStatus, type PublicQueueEntry } from '@/lib/queries/public-queue'
import { Container } from '@/components/ui/container'
import { buttonVariants } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useTranslation } from 'react-i18next'

/**
 * Unattended TV/kiosk display for one shop location's live walk-in queue —
 * meant to run for hours on a screen mounted in the shop, read from across
 * the room. Deliberately distinct visual language from the rest of the app:
 * full-bleed dark surface, oversized type, no interactive controls beyond
 * navigation links (nothing here assumes anyone is holding the device).
 *
 * Still renders inside `PublicBookingLayout`'s slim header rather than a
 * dedicated chromeless layout — the header is small enough not to compete
 * with the display, and adding a second public layout for one route wasn't
 * worth the added routing surface for this first pass. A header-free layout
 * would be a clean follow-up if this becomes the primary way shops run it.
 */
export function PublicQueueDisplayPage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const requestedLocationId = searchParams.get('location')

  const organizationQuery = usePublicOrganization(slug)
  const locationsQuery = usePublicLocations(slug)

  const resolvedLocationId = useMemo(() => {
    if (requestedLocationId) return requestedLocationId
    return locationsQuery.data?.[0]?.id ?? null
  }, [requestedLocationId, locationsQuery.data])

  const resolvedLocation = useMemo(
    () => locationsQuery.data?.find((location) => location.id === resolvedLocationId) ?? null,
    [locationsQuery.data, resolvedLocationId],
  )

  const queueQuery = usePublicQueueStatus(slug, resolvedLocationId ?? undefined)

  useDocumentMeta({
    title: organizationQuery.data ? `Queue — ${organizationQuery.data.name} — FadeUp` : 'Queue — FadeUp',
    description: 'Live walk-in queue status.',
  })

  if (organizationQuery.isPending || locationsQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center bg-ink-950 py-24">
        <Spinner className="h-8 w-8 text-on-accent" label={t('booking:queueDisplay.loadingQueue')} />
      </div>
    )
  }

  if (organizationQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState title={t('booking:queueDisplay.couldntLoadThisDisplay')} description={organizationQuery.error.message} />
      </Container>
    )
  }

  if (!organizationQuery.data) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('booking:queueDisplay.weCouldntFindThisShop')}
          description={t('booking:queueDisplay.thisDisplayLinkMayBe')}
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              {t('booking:queueDisplay.goToFadeup')}
            </Link>
          }
        />
      </Container>
    )
  }

  if (locationsQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState title={t('booking:queueDisplay.couldntLoadLocations')} description={locationsQuery.error.message} />
      </Container>
    )
  }

  if (!resolvedLocationId) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('booking:queueDisplay.noLocationToDisplay')}
          description={t('booking:queueDisplay.thisShopDoesntHaveAny')}
        />
      </Container>
    )
  }

  return (
    <div className="flex flex-1 flex-col bg-ink-950 text-on-accent">
      <Container size="xl" className="flex flex-1 flex-col py-8 sm:py-12">
        <div className="mb-8 text-center sm:mb-12">
          <p className="text-sm font-medium uppercase tracking-widest text-accent-200">{t('booking:queueDisplay.liveQueue')}</p>
          <h1 className="mt-2 text-4xl font-semibold text-balance sm:text-5xl">{organizationQuery.data.name}</h1>
          {resolvedLocation ? <p className="mt-2 text-lg text-on-accent/60">{resolvedLocation.name}</p> : null}
        </div>

        {queueQuery.isPending ? (
          <div className="grid flex-1 grid-cols-1 gap-8 lg:grid-cols-2" aria-hidden="true">
            <Skeleton className="h-64 w-full bg-paper-0/10" />
            <Skeleton className="h-64 w-full bg-paper-0/10" />
          </div>
        ) : queueQuery.isError ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-lg text-on-accent/70">Couldn&apos;t refresh the queue — trying again shortly…</p>
          </div>
        ) : (
          <QueueBoard entries={queueQuery.data} />
        )}
      </Container>
    </div>
  )
}

function QueueBoard({ entries }: { entries: PublicQueueEntry[] }) {
  const { t } = useTranslation()
  const nowServing = entries.filter((entry) => entry.status === 'in_service' || entry.status === 'called')
  const waiting = entries
    .filter((entry) => entry.status === 'waiting')
    .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0))

  if (nowServing.length === 0 && waiting.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <CircleCheckBig className="h-16 w-16 text-accent-200" aria-hidden="true" />
        <p className="text-3xl font-semibold text-balance sm:text-4xl">{t('booking:queueDisplay.noOneIsCurrentlyWaiting')}</p>
        <p className="text-lg text-on-accent/60">{t('booking:queueDisplay.walkRightUpABarber')}</p>
      </div>
    )
  }

  return (
    <div className="grid flex-1 grid-cols-1 gap-8 lg:grid-cols-2">
      <section aria-labelledby="now-serving-heading">
        <h2 id="now-serving-heading" className="mb-4 text-xl font-semibold uppercase tracking-wide text-accent-200">
          {t('booking:queueDisplay.nowServing')}
        </h2>
        {nowServing.length === 0 ? (
          <p className="text-lg text-on-accent/50">{t('booking:queueDisplay.noOneIsBeingServed')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {nowServing.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-paper-0/10 bg-paper-0/5 px-6 py-6"
              >
                <div className="min-w-0">
                  <p className="truncate text-3xl font-semibold sm:text-4xl">{entry.displayName}</p>
                  {entry.barberDisplayName ? (
                    <p className="mt-1 flex items-center gap-1.5 text-base text-on-accent/60">
                      <Scissors className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {entry.barberDisplayName}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full bg-accent-600 px-4 py-1.5 text-sm font-semibold uppercase tracking-wide">
                  {entry.status === 'in_service' ? 'In chair' : 'Called'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="up-next-heading">
        <h2 id="up-next-heading" className="mb-4 text-xl font-semibold uppercase tracking-wide text-on-accent/60">
          {t('booking:queueDisplay.upNext')}
        </h2>
        {waiting.length === 0 ? (
          <p className="text-lg text-on-accent/50">{t('booking:queueDisplay.noOneIsWaiting')}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {waiting.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-4 rounded-xl border border-paper-0/10 px-5 py-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-0/10 text-lg font-semibold">
                  {entry.queuePosition ?? '–'}
                </span>
                <span className="truncate text-2xl font-medium">{entry.displayName}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
