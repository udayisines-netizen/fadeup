import { Suspense, lazy, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  rowAvailability,
  useProfessionalSearch,
  useProfessionalSearchSlice,
  useResultCurrencies,
  useResultServiceStates,
  type ProfessionalSearchRow,
  type ResultAvailability,
} from '@/shared/data/discovery'
import { discoveryKeys } from '@/shared/data/keys'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { useDocumentMeta } from '@/shared/hooks/useDocumentMeta'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { ResultCard } from '@/shared/ui/ResultCard'
import { usePublicBookingCapabilities } from '@/shared/data/capability'
import { Sheet } from '@/shared/ui/Sheet'
import { SkeletonCard } from '@/shared/ui/Skeleton'
import { Spinner } from '@/shared/ui/Spinner'
import { Tabs } from '@/shared/ui/Tabs'
import { IconFilter, IconLocation, IconSearch } from '@/shared/ui/icons'
import { ResultSheet } from '@/shared/ui/ResultSheet'
import { FiltersPanel } from '@/features/discovery/components/FiltersPanel'
import { rankResults } from '@/shared/lib/searchRanking'
import {
  DEFAULT_SEARCH_STATE,
  WIDENING_RADII_KM,
  activeFilterCount,
  buildSearchArgs,
  parseSearchState,
  serializeSearchState,
  type SearchState,
} from '@/features/discovery/lib/searchParams'
import { useGeolocation } from '@/features/discovery/lib/useGeolocation'

/**
 * F3 — /search, l'onglet Recherche (MASTER_SPEC §3/§8).
 *
 * · LISTE d'abord ; la carte est un ONGLET (chunk paresseux, jamais imposée).
 * · L'état vit dans l'URL : partageable, rechargeable, retour arrière réel.
 * · Géolocalisation à la DEMANDE (« autour de moi »), jamais à l'ouverture ;
 *   le refus laisse la recherche par ville pleinement utilisable.
 * · Zéro résultat SE DIT, puis s'élargit progressivement (25 puis 50 km,
 *   sections étiquetées avec les distances réelles) — jamais un résultat
 *   hors sujet glissé dans une page vide. Une ligne SANS coordonnées ne
 *   compte pas comme « dans la zone » : elle s'affiche à part, étiquetée
 *   « distance inconnue » (revue F3, M3).
 * · Recherche par style : le texte libre passe par p_query (noms, villes) ;
 *   s'il ne rend rien, le MÊME texte est retenté comme nom de SERVICE
 *   (p_service_query — « fade », « taper » vivent dans les noms de services
 *   réels). Aucune taxonomie de styles n'existe en base : dit au rapport.
 * · Le classement vient de lib/ranking.ts, appliqué UNE FOIS les états de
 *   service résolus (revue F3, M1) — jamais un rebrassage sous le doigt.
 * · Le filtre « disponible maintenant » est un filtre CLIENT sur les pages
 *   chargées : tout ce qu'il affirme est borné aux résultats chargés, et
 *   « charger plus » reste accessible (revue F3, M2).
 */

const SearchMapView = lazy(() => import('@/features/discovery/components/SearchMapView'))

function flattenPages(pages: ProfessionalSearchRow[][] | undefined): ProfessionalSearchRow[] {
  return pages?.flat() ?? []
}

export function SearchPage() {
  const { t } = useTranslation('v2')
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useMemo(() => parseSearchState(searchParams), [searchParams])
  const [filtersOpen, setFiltersOpen] = useState(false)
  /* D1 §5 — un tap sur une carte ouvre la FEUILLE ; la liste reste dessous
     et sa position de défilement est préservée à la fermeture. */
  const [openRow, setOpenRow] = useState<ProfessionalSearchRow | null>(null)
  const geolocation = useGeolocation()

  useDocumentMeta({ title: t('discovery.meta.title') })

  const update = (partial: Partial<SearchState>, options: { replace?: boolean } = {}) => {
    void setSearchParams(serializeSearchState({ ...state, ...partial }), { replace: options.replace ?? false })
  }

  const hasPoint = state.latitude !== null && state.longitude !== null
  const args = useMemo(() => buildSearchArgs(state), [state])

  const search = useProfessionalSearch(args)
  const allRows = useMemo(() => flattenPages(search.data?.pages), [search.data])
  /* Une recherche PAR RAYON ne peut rien affirmer d'une ligne sans
     coordonnées (la RPC la conserve, « distance inconnue est gardée ») :
     elle sort de la zone et s'affiche à part, étiquetée. */
  const rows = useMemo(
    () => (hasPoint ? allRows.filter((row) => row.distance_km !== null) : allRows),
    [allRows, hasPoint],
  )
  const unlocatedRows = useMemo(
    () => (hasPoint ? allRows.filter((row) => row.distance_km === null) : []),
    [allRows, hasPoint],
  )
  const totalCount = search.data?.pages[0]?.[0]?.total_count ?? 0
  const isZero = search.isSuccess && rows.length === 0

  /* --- Repli « par service » : le texte libre comme style/service réel. --- */
  const serviceFallbackArgs = useMemo(
    () => ({ ...args, p_query: undefined, p_service_query: state.query, p_limit: 10 }),
    [args, state.query],
  )
  const serviceFallback = useProfessionalSearchSlice(
    discoveryKeys.serviceFallback(serviceFallbackArgs as Record<string, unknown>),
    serviceFallbackArgs,
    { enabled: isZero && state.query.trim() !== '' && state.service.trim() === '' },
  )
  const fallbackRows = serviceFallback.data ?? []

  /* --- Élargissement progressif autour d'un point : 25 puis 50 km. ------- */
  const widen25Args = useMemo(() => ({ ...args, p_radius_km: WIDENING_RADII_KM[0], p_limit: 10 }), [args])
  const widen50Args = useMemo(() => ({ ...args, p_radius_km: WIDENING_RADII_KM[1], p_limit: 10 }), [args])
  const widen25 = useProfessionalSearchSlice(
    discoveryKeys.widened(widen25Args as Record<string, unknown>),
    widen25Args,
    { enabled: isZero && hasPoint && fallbackRows.length === 0 },
  )
  const widen50 = useProfessionalSearchSlice(
    discoveryKeys.widened(widen50Args as Record<string, unknown>),
    widen50Args,
    { enabled: isZero && hasPoint && widen25.isSuccess && (widen25.data ?? []).length === 0 },
  )
  const pickWidened = (candidate: ProfessionalSearchRow[] | undefined) =>
    (candidate ?? []).filter((row) => row.distance_km !== null)
  const widened =
    pickWidened(widen25.data).length > 0
      ? { radiusKm: WIDENING_RADII_KM[0], rows: pickWidened(widen25.data) }
      : pickWidened(widen50.data).length > 0
        ? { radiusKm: WIDENING_RADII_KM[1], rows: pickWidened(widen50.data) }
        : null

  /* --- États de service et devises pour TOUT ce qui s'affiche. ----------- */
  const displayedRows = useMemo(
    () => [...rows, ...unlocatedRows, ...fallbackRows, ...(widened?.rows ?? [])],
    [rows, unlocatedRows, fallbackRows, widened],
  )
  const serviceStates = useResultServiceStates(
    useMemo(
      () => displayedRows.map((row) => ({ slug: row.organization_slug, locationId: row.location_id })),
      [displayedRows],
    ),
  )
  const currencies = useResultCurrencies(
    useMemo(() => displayedRows.map((row) => row.organization_id), [displayedRows]),
  )
  /* P1PRO §7 — la capacité en LOT : « Réservable » vs « Sur demande ». */
  const capabilities = usePublicBookingCapabilities(
    useMemo(() => displayedRows.map((row) => row.organization_slug), [displayedRows]),
  )

  const availabilityByLocation = useMemo(() => {
    const map: Record<string, ResultAvailability> = {}
    for (const row of displayedRows) map[row.location_id] = rowAvailability(row, serviceStates)
    return map
  }, [displayedRows, serviceStates])

  /* Classement client (sans point uniquement) appliqué quand les états sont
     RÉSOLUS ; entre-temps, le dernier ordre stable — jamais un rebrassage
     ligne à ligne sous le doigt (revue F3, M1). */
  const lastRankedIds = useRef<string[] | null>(null)
  const ranked = useMemo(() => {
    if (serviceStates.settled) {
      const result = rankResults(rows, availabilityByLocation, state.sort, hasPoint)
      lastRankedIds.current = result.map((row) => row.location_id)
      return result
    }
    const previous = lastRankedIds.current
    if (!previous) return rows
    const byId = new Map(rows.map((row) => [row.location_id, row]))
    const kept = previous.map((id) => byId.get(id)).filter((row): row is ProfessionalSearchRow => Boolean(row))
    const keptIds = new Set(previous)
    return [...kept, ...rows.filter((row) => !keptIds.has(row.location_id))]
  }, [rows, availabilityByLocation, state.sort, hasPoint, serviceStates.settled])

  const visibleRows = useMemo(
    () =>
      state.availableNow
        ? ranked.filter((row) => availabilityByLocation[row.location_id] === 'available-now')
        : ranked,
    [ranked, availabilityByLocation, state.availableNow],
  )
  /* Le filtre de disponibilité ne peut ni affirmer un vide ni afficher une
     liste sûre tant que les états ne sont pas résolus — mais une liste déjà
     affichée n'est jamais remplacée par des squelettes (revue F3, M2.4). */
  const availabilityResolving = state.availableNow && !serviceStates.settled
  const showSkeletons = search.isPending || (availabilityResolving && visibleRows.length === 0)

  const onNearMe = async () => {
    if (hasPoint) {
      update({ latitude: null, longitude: null })
      return
    }
    const point = await geolocation.request()
    if (point) update({ latitude: point.latitude, longitude: point.longitude })
  }

  /* D1 §8 — apparition DÉCALÉE des résultats (stagger CSS : fu-rise-in +
     délai par index ; neutralisé par prefers-reduced-motion via la règle
     globale de theme.css). */
  const renderRow = (row: ProfessionalSearchRow, index: number) => (
    <div
      key={`${row.location_id}`}
      className="fu-rise-in"
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <ResultCard
        row={row}
        currencyByOrganization={currencies.data}
        availability={availabilityByLocation[row.location_id] ?? 'loading'}
        bookingCapability={capabilities.data?.[row.organization_slug] ?? null}
        onOpen={setOpenRow}
      />
    </div>
  )
  /* D1 §4 — grille de cartes : une colonne en mobile, une grille COMPOSÉE
     dès 768 px (jamais une colonne étroite avec 400 px de vide). */
  const cardGrid = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'

  const searchControls = (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          const input = new FormData(event.currentTarget).get('q')
          update({ query: typeof input === 'string' ? input.trim() : '' })
        }}
      >
        <Input
          key={`q-${state.query}`}
          name="q"
          type="search"
          label={t('discovery.search.label')}
          placeholder={t('discovery.search.placeholder')}
          iconStart={<IconSearch />}
          defaultValue={state.query}
          data-testid="search-input"
        />
      </form>
      <div className="flex flex-wrap items-end gap-2">
        <Chip
          selected={hasPoint}
          onClick={() => void onNearMe()}
          disabled={geolocation.status === 'locating'}
          data-testid="near-me-chip"
        >
          <IconLocation aria-hidden="true" className="size-3.5" />
          {geolocation.status === 'locating' ? t('discovery.geo.locating') : t('discovery.geo.nearMe')}
        </Chip>
        <Input
          key={`city-${state.city}`}
          type="search"
          label={t('discovery.search.cityLabel')}
          placeholder={t('discovery.search.cityPlaceholder')}
          defaultValue={state.city}
          className="min-w-40 flex-1"
          data-testid="city-input"
          onBlur={(event) => {
            const city = event.target.value.trim()
            if (city !== state.city) update({ city })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              update({ city: (event.target as HTMLInputElement).value.trim() })
            }
          }}
        />
      </div>
      {/* Le refus n'est pas une erreur : le chemin manuel est complet. */}
      {(geolocation.status === 'denied' || geolocation.status === 'unavailable') && !hasPoint && (
        <p role="status" className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="geo-denied-note">
          {t('discovery.geo.denied')}
        </p>
      )}
      {/* D1 — les filtres passent en barre haute (chips + tiroir), à TOUTES
          les largeurs : le rail latéral de P1c est supprimé. */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip selected={state.openNow} onClick={() => update({ openNow: !state.openNow })}>
          {t('discovery.filters.openNow')}
        </Chip>
        <Chip
          selected={state.availableNow}
          onClick={() => update({ availableNow: !state.availableNow })}
          data-testid="available-now-chip"
        >
          {t('discovery.filters.availableNow')}
        </Chip>
        <Chip onClick={() => setFiltersOpen(true)} data-testid="filters-open">
          <IconFilter aria-hidden="true" className="size-3.5" />
          {activeFilterCount(state) > 0
            ? t('discovery.filters.buttonCount', { count: activeFilterCount(state) })
            : t('discovery.filters.button')}
        </Chip>
      </div>
    </div>
  )

  const emptyDescription = state.availableNow
    ? search.hasNextPage
      ? t('discovery.empty.descriptionAvailabilityPartial', { loaded: rows.length })
      : t('discovery.empty.descriptionAvailability')
    : hasPoint
      ? t('discovery.empty.descriptionRadius', { km: state.radiusKm })
      : state.city
        ? t('discovery.empty.descriptionCity', { city: state.city })
        : t('discovery.empty.description')

  const countLine = state.availableNow
    ? serviceStates.settled
      ? search.hasNextPage
        ? t('discovery.results.countAvailablePartial', { count: visibleRows.length, loaded: rows.length })
        : t('discovery.results.countAvailable', { count: visibleRows.length })
      : null
    : // Par rayon, le total serveur compte aussi les lignes sans coordonnées
      // (affichées à part) : quand tout est chargé, le compte de la zone est
      // le compte RÉEL de la liste.
      t('discovery.results.count', { count: hasPoint && !search.hasNextPage ? rows.length : totalCount })

  const listContent = (
    <div aria-busy={showSkeletons}>
      {!search.isPending && !search.isError && countLine !== null && (
        <p role="status" className="mb-2 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="result-count">
          {countLine}
        </p>
      )}
      <div className={cardGrid}>
        {showSkeletons ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : search.isError ? (
          <EmptyState
            className="col-span-full"
            title={t('errors.boundary.title')}
            description={t(errorMessageKey(toAppError(search.error)))}
            action={
              <Button variant="secondary" onClick={() => void search.refetch()}>
                {t('common.action.retry')}
              </Button>
            }
          />
        ) : visibleRows.length === 0 ? (
          <div data-testid="search-empty" className="col-span-full">
            <EmptyState
              title={t('discovery.empty.title')}
              description={emptyDescription}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {state.query && (
                    <Button variant="secondary" onClick={() => update({ query: '' })}>
                      {t('discovery.empty.clearQuery')}
                    </Button>
                  )}
                  {state.availableNow && (
                    <Button variant="secondary" onClick={() => update({ availableNow: false })}>
                      {t('discovery.empty.clearAvailability')}
                    </Button>
                  )}
                  {state.city && (
                    <Button variant="secondary" onClick={() => update({ city: '' })} data-testid="search-everywhere">
                      {t('discovery.empty.searchEverywhere')}
                    </Button>
                  )}
                  {!state.query && !state.city && !state.availableNow && (
                    <Button variant="secondary" onClick={() => update(DEFAULT_SEARCH_STATE)}>
                      {t('discovery.filters.reset')}
                    </Button>
                  )}
                </div>
              }
            />
          </div>
        ) : (
          visibleRows.map(renderRow)
        )}
      </div>

      {/* « Charger plus » reste accessible même quand le filtre de
          disponibilité vide la page courante (revue F3, M2.2). */}
      {search.hasNextPage && !showSkeletons && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            loading={search.isFetchingNextPage}
            onClick={() => void search.fetchNextPage()}
            data-testid="load-more"
          >
            {t('discovery.results.loadMore')}
          </Button>
        </div>
      )}

      {/* Repli par service : le style comme nom de service RÉEL. */}
      {isZero && fallbackRows.length > 0 && (
        <section className="mt-6" data-testid="service-fallback">
          <h2 className="mb-2 text-fu-base font-semibold">
            {t('discovery.fallback.title', { query: state.query })}
          </h2>
          <div className={cardGrid}>{fallbackRows.map(renderRow)}</div>
        </section>
      )}

      {/* Élargissement étiqueté : les distances réelles restent visibles. */}
      {isZero && fallbackRows.length === 0 && widened && (
        <section className="mt-6" data-testid="widened-results">
          <h2 className="mb-2 text-fu-base font-semibold">
            {t('discovery.widen.title', { km: widened.radiusKm })}
          </h2>
          <div className={cardGrid}>{widened.rows.map(renderRow)}</div>
        </section>
      )}

      {/* Lignes sans coordonnées lors d'une recherche par rayon : réelles,
          mais leur distance est INCONNUE — dites à part, jamais comptées
          comme « dans la zone » (revue F3, M3). */}
      {!search.isPending && unlocatedRows.length > 0 && (
        <section className="mt-6" data-testid="unlocated-results">
          <h2 className="mb-2 text-fu-base font-semibold">{t('discovery.unlocated.title')}</h2>
          <p className="mb-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('discovery.unlocated.note')}</p>
          <div className={cardGrid}>{unlocatedRows.map(renderRow)}</div>
        </section>
      )}
    </div>
  )

  const mapContent = (
    <Suspense
      fallback={
        <div className="flex h-[60dvh] items-center justify-center">
          <Spinner announce />
        </div>
      }
    >
      <SearchMapView
        rows={visibleRows}
        searchPoint={hasPoint ? { latitude: state.latitude as number, longitude: state.longitude as number } : null}
      />
    </Suspense>
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6">
      <h1 className="mb-3 text-fu-xl font-semibold">{t('discovery.title')}</h1>

      {/* D1 §4 — composition unique : barre de recherche et chips en HAUT,
          grille de cartes dessous. Le rail latéral (P1c) est révoqué ; les
          filtres complets vivent dans le tiroir à toutes les largeurs. */}
      <div className="flex flex-col gap-4">
        {searchControls}

        <Tabs
          label={t('discovery.view.label')}
          value={state.view}
          onValueChange={(view) => update({ view: view as SearchState['view'] }, { replace: true })}
          items={[
            { value: 'list', label: t('discovery.view.list'), content: listContent },
            { value: 'map', label: t('discovery.view.map'), content: mapContent },
          ]}
        />
      </div>

      {/* Filtres complets — tiroir (bas < 768, latéral au-dessus). */}
      <Sheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title={t('discovery.filters.title')}
      >
        <div className="flex flex-col gap-4">
          <FiltersPanel
            state={state}
            onChange={(partial) => update(partial)}
            onReset={() => update({ ...DEFAULT_SEARCH_STATE, view: state.view })}
          />
          <Button variant="primary" onClick={() => setFiltersOpen(false)} data-testid="filters-apply">
            {state.availableNow
              ? t('discovery.filters.showResultsPlain')
              : t('discovery.filters.showResults', { count: totalCount })}
          </Button>
        </div>
      </Sheet>

      {/* D1 §5 — la feuille de résultat ; la liste reste dessous. */}
      {openRow && (
        <ResultSheet
          row={openRow}
          currencyByOrganization={currencies.data}
          availability={availabilityByLocation[openRow.location_id] ?? 'loading'}
          bookingCapability={capabilities.data?.[openRow.organization_slug] ?? null}
          onOpenChange={(next) => {
            if (!next) setOpenRow(null)
          }}
        />
      )}
    </div>
  )
}
