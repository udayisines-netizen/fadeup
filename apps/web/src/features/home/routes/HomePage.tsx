import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  rowAvailability,
  useProfessionalSearchSlice,
  useResultCurrencies,
  useResultServiceStates,
  type ProfessionalSearchRow,
  type ResultAvailability,
} from '@/shared/data/discovery'
import { rankResults } from '@/shared/lib/searchRanking'
import { discoveryKeys } from '@/shared/data/keys'
import { useDocumentMeta } from '@/shared/hooks/useDocumentMeta'
import { useNow } from '@/shared/hooks/useNow'
import { useSession } from '@/shared/hooks/useSession'
import { readLocalQueueEntry } from '@/shared/lib/localQueueEntry'
import {
  INVITE_MIN_VISITS,
  countHomeVisit,
  dismissInvite,
  isInviteDismissed,
  readRecentProfiles,
} from '@/shared/lib/recentlyViewed'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { IconButton } from '@/shared/ui/IconButton'
import { Input } from '@/shared/ui/Input'
import { ResultCard } from '@/shared/ui/ResultCard'
import { usePublicBookingCapabilities } from '@/shared/data/capability'
import { ResultSheet } from '@/shared/ui/ResultSheet'
import { Row } from '@/shared/ui/Row'
import { SkeletonCard } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconClose, IconSearch } from '@/shared/ui/icons'
import {
  activeQueueEntry,
  lastCompletedAppointment,
  nextAppointment,
  useAnonymousQueueTracking,
  useFollowedProfessionals,
  useMyAppointments,
  useMyQueueStatus,
} from '@/features/home/api/home'

/**
 * D1 §7 — l'accueil TABLEAU DE BORD. Trois blocs, dans cet ordre :
 *
 * 1. EN COURS — file active avec la position réelle, prochaine réservation,
 *    demande en attente avec son échéance. Toujours en haut quand il existe.
 * 2. CE QUE JE SUIS — les profils suivis (connecté). Sans compte, ce bloc
 *    devient « VOUS AVEZ CONSULTÉ » : les profils réellement ouverts,
 *    mémorisés LOCALEMENT (aucun suivi serveur — RGPD).
 * 3. AUTOUR DE MOI — découverte locale en cartes, feuille au tap.
 *
 * Première visite absolue : recherche en haut, découverte dessous, RIEN
 * d'autre — aucune section vide, aucun squelette permanent. L'invitation à
 * créer un compte apparaît après plusieurs visites, en bannière FERMABLE,
 * jamais une modale, jamais un mur.
 */

export function HomePage() {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const { session } = useSession()
  const now = useNow(30_000)
  useDocumentMeta({ title: null })

  /* --- Mémoire locale : profils consultés, visites, invitation. --------- */
  const [recentProfiles] = useState(() => readRecentProfiles())
  const [visits] = useState(() => countHomeVisit())
  const [inviteDismissed, setInviteDismissed] = useState(() => isInviteDismissed())
  const showInvite = !session && !inviteDismissed && visits >= INVITE_MIN_VISITS

  /* --- File active : connecté par get_my_queue_status, anonyme par la
         mémoire locale F1b + suivi public. --------------------------------- */
  const myQueue = useMyQueueStatus(Boolean(session))
  const [localEntry] = useState(() => readLocalQueueEntry())
  const anonymousTracking = useAnonymousQueueTracking(!session && localEntry ? localEntry.entryId : null)
  const activeEntry = activeQueueEntry(myQueue.data)
  const anonymousActive =
    !session &&
    localEntry &&
    anonymousTracking.data &&
    (anonymousTracking.data.status === 'waiting' ||
      anonymousTracking.data.status === 'called' ||
      anonymousTracking.data.status === 'in_service')
      ? anonymousTracking.data
      : null

  /* --- Récurrence : rendez-vous (confirmés ET demandes en attente). ------ */
  const appointments = useMyAppointments(Boolean(session))
  const next = nextAppointment(appointments.data, now)
  const lastCompleted = lastCompletedAppointment(appointments.data)
  const followed = useFollowedProfessionals(Boolean(session))

  /* --- Découverte locale : de vrais résultats, jamais du remplissage. ----- */
  const discoverArgs = useMemo(() => ({ p_limit: 6 }), [])
  const discover = useProfessionalSearchSlice(
    discoveryKeys.search({ surface: 'home', ...discoverArgs }),
    discoverArgs,
  )
  const discoverRows = useMemo(() => discover.data ?? [], [discover.data])
  const serviceStates = useResultServiceStates(
    useMemo(
      () => discoverRows.map((row) => ({ slug: row.organization_slug, locationId: row.location_id })),
      [discoverRows],
    ),
  )
  const currencies = useResultCurrencies(
    useMemo(() => discoverRows.map((row) => row.organization_id), [discoverRows]),
  )
  /* P1PRO §7 — la capacité en LOT : « Réservable » vs « Sur demande ». */
  const capabilities = usePublicBookingCapabilities(
    useMemo(() => discoverRows.map((row) => row.organization_slug), [discoverRows]),
  )
  const discoverAvailability = useMemo(() => {
    const map: Record<string, ResultAvailability> = {}
    for (const row of discoverRows) map[row.location_id] = rowAvailability(row, serviceStates)
    return map
  }, [discoverRows, serviceStates])
  /* Classé UNE FOIS les états résolus — jamais rebrassé sous le doigt. */
  const discoverReady = discover.isSuccess && serviceStates.settled
  const rankedDiscover = useMemo(
    () => rankResults(discoverRows, discoverAvailability, 'recommended', false),
    [discoverRows, discoverAvailability],
  )

  /* D1 §5 — la feuille de résultat, aussi depuis l'accueil. */
  const [openRow, setOpenRow] = useState<ProfessionalSearchRow | null>(null)

  const queueHref = (slug: string, locationId: string) =>
    `/q/${encodeURIComponent(slug)}?l=${encodeURIComponent(locationId)}`

  const hasCurrent = Boolean(activeEntry || anonymousActive || next)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-4 md:px-6">
      {/* ─── 1. EN COURS — toujours en haut quand il existe. ─────────────── */}
      {hasCurrent && (
        <section data-testid="home-current" aria-label={t('home.current.title')}>
          <h2 className="mb-2 text-fu-lg font-semibold">{t('home.current.title')}</h2>
          <div className="flex flex-col gap-3">
            {activeEntry && (
              <div
                aria-live="polite"
                data-testid="home-active-queue"
                className="rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-4 shadow-[var(--fu-shadow-card)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-fu-sm text-[var(--fu-text-secondary)]">
                      {t('home.queue.title', { organization: activeEntry.organization_name })}
                    </p>
                    {activeEntry.status === 'waiting' && activeEntry.queue_position !== null && (
                      <p className="mt-1 flex items-baseline gap-2">
                        <span
                          key={activeEntry.queue_position}
                          className="fu-number-in font-fu-mono text-fu-3xl font-semibold tabular-nums leading-none"
                          data-testid="home-queue-position"
                        >
                          {activeEntry.queue_position}
                        </span>
                        <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('home.queue.positionLabel')}</span>
                      </p>
                    )}
                    {activeEntry.status === 'called' && <StateBadge state="called" className="mt-1" />}
                    {activeEntry.status === 'in_service' && <StateBadge state="confirmed" className="mt-1" />}
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void navigate(queueHref(activeEntry.organization_slug, activeEntry.location_id))}
                    data-testid="home-queue-cta"
                  >
                    {t('home.queue.cta')}
                  </Button>
                </div>
              </div>
            )}

            {/* File active d'un client ANONYME (entrée locale F1b). */}
            {!activeEntry && anonymousActive && localEntry && (
              <div
                aria-live="polite"
                data-testid="home-active-queue-anonymous"
                className="rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-4 shadow-[var(--fu-shadow-card)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('home.queue.anonymousTitle')}</p>
                    {anonymousActive.status === 'waiting' && anonymousActive.queue_position !== null && (
                      <p className="mt-1 flex items-baseline gap-2">
                        <span className="font-fu-mono text-fu-3xl font-semibold tabular-nums leading-none">
                          {anonymousActive.queue_position}
                        </span>
                        <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('home.queue.positionLabel')}</span>
                      </p>
                    )}
                    {anonymousActive.status === 'called' && <StateBadge state="called" className="mt-1" />}
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void navigate(queueHref(localEntry.slug, localEntry.locationId))}
                  >
                    {t('home.queue.cta')}
                  </Button>
                </div>
              </div>
            )}

            {/* Prochaine réservation OU demande en attente, avec son échéance
                réelle — jamais une intention présentée comme confirmée. */}
            {next && (
              <div data-testid="home-next-appointment" className="overflow-hidden rounded-[var(--radius-card)] bg-[var(--fu-surface)] shadow-[var(--fu-shadow-card)]">
                <Row
                  as="link"
                  to="/bookings"
                  chevron
                  className="border-b-0"
                  title={next.service_name}
                  subtitle={`${next.organization_name} · ${next.barber_display_name}`}
                >
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-fu-sm text-[var(--fu-text-secondary)]">
                    <DateTime value={next.starts_at} timezone={next.location_timezone} format="datetime" />
                    {next.status === 'pending' && <StateBadge state="pending-request" size="sm" />}
                    {next.status === 'pending' && next.expires_at && (
                      <span data-testid="home-pending-deadline">
                        {t('home.pending.deadline')}{' '}
                        <DateTime value={next.expires_at} timezone={next.location_timezone} format="time" />
                      </span>
                    )}
                  </p>
                </Row>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── LA RECHERCHE — le geste principal. ──────────────────────────── */}
      <section data-testid="home-search">
        <h1 className="mb-2 text-fu-xl font-semibold">{t('home.search.title')}</h1>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            const value = new FormData(event.currentTarget).get('q')
            const query = typeof value === 'string' ? value.trim() : ''
            void navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search')
          }}
        >
          <Input
            name="q"
            type="search"
            label={t('home.search.label')}
            placeholder={t('home.search.placeholder')}
            iconStart={<IconSearch />}
            data-testid="home-search-input"
          />
        </form>
      </section>

      {/* Réserver à nouveau — préremplissage réel (tunnel F4). */}
      {lastCompleted && (
        <section data-testid="home-rebook">
          <h2 className="mb-2 text-fu-lg font-semibold">{t('home.rebook.title')}</h2>
          <div className="overflow-hidden rounded-[var(--radius-card)] bg-[var(--fu-surface)] shadow-[var(--fu-shadow-card)]">
            <Row
              as="link"
              to={`/book/${encodeURIComponent(lastCompleted.organization_slug)}?service=${encodeURIComponent(lastCompleted.service_id)}&barber=${encodeURIComponent(lastCompleted.barber_id)}`}
              chevron
              className="border-b-0"
              title={t('home.rebook.cta', { barber: lastCompleted.barber_display_name })}
              subtitle={`${lastCompleted.service_name} · ${lastCompleted.organization_name}`}
            />
          </div>
        </section>
      )}

      {/* ─── 2. CE QUE JE SUIS (connecté) ────────────────────────────────── */}
      {(followed.data ?? []).length > 0 && (
        <section data-testid="home-followed">
          <h2 className="mb-2 text-fu-lg font-semibold">{t('home.following.title')}</h2>
          <ul className="flex gap-4 overflow-x-auto pb-1">
            {(followed.data ?? []).map((profile) => (
              <li key={profile.id} className="shrink-0">
                <Link
                  to={`/pro/${encodeURIComponent(profile.handle)}`}
                  className="flex w-20 flex-col items-center gap-1.5 rounded-[var(--radius-control)] p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
                >
                  <Avatar name={profile.display_name} src={profile.avatar_url} size="lg" />
                  <span className="w-full truncate text-center text-fu-sm text-[var(--fu-text-secondary)]">
                    {profile.display_name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── 2bis. VOUS AVEZ CONSULTÉ (sans compte, dès la 2e visite) —
             donnée vraie, locale, qui ne quitte jamais l'appareil. ───────── */}
      {!session && recentProfiles.length > 0 && (
        <section data-testid="home-recent">
          <h2 className="mb-2 text-fu-lg font-semibold">{t('home.recent.title')}</h2>
          <ul className="flex gap-3 overflow-x-auto pb-1">
            {recentProfiles.map((profile) => (
              <li key={`${profile.kind}:${profile.key}`} className="w-36 shrink-0">
                <Link
                  to={profile.kind === 'pro' ? `/pro/${encodeURIComponent(profile.key)}` : `/shop/${encodeURIComponent(profile.key)}`}
                  className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-3 shadow-[var(--fu-shadow-card)] transition-shadow hover:shadow-[var(--fu-shadow-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
                >
                  <Avatar name={profile.name} src={profile.avatarUrl} size="lg" />
                  <span className="line-clamp-2 text-fu-sm font-medium leading-snug text-[var(--fu-text-primary)]">
                    {profile.name}
                  </span>
                  {profile.city && (
                    <span className="truncate text-fu-sm text-[var(--fu-text-secondary)]">{profile.city}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Invitation discrète — une bannière qu'on ferme, jamais une modale. */}
      {showInvite && (
        <section
          data-testid="home-invite"
          className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] bg-[var(--fu-surface-brand)] p-4"
        >
          <div className="min-w-0">
            <h2 className="text-fu-base font-semibold text-[var(--fu-text-primary)]">{t('home.invite.title')}</h2>
            <p className="mt-0.5 text-fu-sm text-[var(--fu-text-secondary)]">{t('home.invite.body')}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              data-testid="home-invite-cta"
              onClick={() => void navigate('/auth/signup')}
            >
              {t('home.invite.cta')}
            </Button>
          </div>
          <IconButton
            aria-label={t('home.invite.dismiss')}
            data-testid="home-invite-dismiss"
            onClick={() => {
              dismissInvite()
              setInviteDismissed(true)
            }}
          >
            <IconClose />
          </IconButton>
        </section>
      )}

      {/* ─── 3. AUTOUR DE MOI — cartes réelles, feuille au tap. ──────────── */}
      {discoverRows.length > 0 && (
        <section data-testid="home-discover">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-fu-lg font-semibold">{t('home.around.title')}</h2>
            <Link
              to="/search"
              className="text-fu-sm font-medium text-[var(--fu-text-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
            >
              {t('common.action.seeAll')}
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy={!discoverReady}>
            {discoverReady ? (
              /* Apparition décalée (D1 §8) — stagger CSS, reduced-motion sûr. */
              rankedDiscover.map((row, index) => (
                <div key={row.location_id} className="fu-rise-in" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
                  <ResultCard
                    row={row}
                    currencyByOrganization={currencies.data}
                    availability={discoverAvailability[row.location_id] ?? 'loading'}
                    bookingCapability={capabilities.data?.[row.organization_slug] ?? null}
                    onOpen={setOpenRow}
                  />
                </div>
              ))
            ) : (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}
          </div>
        </section>
      )}

      {openRow && (
        <ResultSheet
          row={openRow}
          currencyByOrganization={currencies.data}
          availability={discoverAvailability[openRow.location_id] ?? 'loading'}
          bookingCapability={capabilities.data?.[openRow.organization_slug] ?? null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setOpenRow(null)
          }}
        />
      )}
    </div>
  )
}
