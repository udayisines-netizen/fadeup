import { Suspense, lazy, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  useProfessionalSearch,
  useProfessionalSearchSlice,
  useResultCurrencies,
  useResultServiceStates,
  type ProfessionalSearchRow,
} from '@/shared/data/discovery'
import { discoveryKeys } from '@/shared/data/keys'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { useDocumentMeta } from '@/shared/hooks/useDocumentMeta'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { SearchResultRow } from '@/shared/ui/SearchResultRow'
import { Sheet } from '@/shared/ui/Sheet'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { Spinner } from '@/shared/ui/Spinner'
import { Tabs } from '@/shared/ui/Tabs'
import { IconFilter, IconLocation, IconSearch } from '@/shared/ui/icons'
import { FiltersPanel } from '@/features/discovery/components/FiltersPanel'
import { rankResults } from '@/features/discovery/lib/ranking'
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
 *   hors sujet glissé dans une page vide.
 * · Recherche par style : le texte libre passe par p_query (noms, villes) ;
 *   s'il ne rend rien, le MÊME texte est retenté comme nom de SERVICE
 *   (p_service_query — « fade », « taper » vivent dans les noms de services
 *   réels). Aucune taxonomie de styles n'existe en base : dit au rapport.
 * · Le classement vient de lib/ranking.ts — les poids n'habitent pas ici.
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
  const geolocation = useGeolocation()

  useDocumentMeta({ title: t('discovery.meta.title') })

  const update = (partial: Partial<SearchState>, options: { replace?: boolean } = {}) => {
    void setSearchParams(serializeSearchState({ ...state, ...partial }), { replace: options.replace ?? false })
  }

  const hasPoint = state.latitude !== null && state.longitude !== null
  const args = useMemo(() => buildSearchArgs(state), [state])

  const search = useProfessionalSearch(args)
  const rows = useMemo(() => flattenPages(search.data?.pages), [search.data])
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
  const widened =
    (widen25.data ?? []).length > 0
      ? { radiusKm: WIDENING_RADII_KM[0], rows: widen25.data ?? [] }
      : (widen50.data ?? []).length > 0
        ? { radiusKm: WIDENING_RADII_KM[1], rows: widen50.data ?? [] }
        : null

  /* --- États de service et devises pour TOUT ce qui s'affiche. ----------- */
  const displayedRows = useMemo(
    () => [...rows, ...fallbackRows, ...(widened?.rows ?? [])],
    [rows, fallbackRows, widened],
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

  const ranked = useMemo(
    () => rankResults(rows, serviceStates.byLocation, state.sort, hasPoint),
    [rows, serviceStates.byLocation, state.sort, hasPoint],
  )
  // « Disponible maintenant » filtre sur l'état RÉEL — tant que les états de
  // la page ne sont pas résolus, on montre l'attente, pas une liste affirmée.
  const visibleRows = state.availableNow
    ? ranked.filter((row) => serviceStates.byLocation[row.location_id] === 'available-now')
    : ranked
  const availabilityFilterPending = state.availableNow && !serviceStates.settled

  const onNearMe = async () => {
    if (hasPoint) {
      update({ latitude: null, longitude: null })
      return
    }
    const point = await geolocation.request()
    if (point) update({ latitude: point.latitude, longitude: point.longitude })
  }

  const renderRow = (row: ProfessionalSearchRow) => (
    <SearchResultRow
      key={`${row.location_id}`}
      row={row}
      currencyByOrganization={currencies.data}
      availability={serviceStates.byLocation[row.location_id] ?? 'loading'}
    />
  )

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
      <div className="flex flex-wrap items-center gap-2 lg:hidden">
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

  const emptyDescription = hasPoint
    ? t('discovery.empty.descriptionRadius', { km: state.radiusKm })
    : state.city
      ? t('discovery.empty.descriptionCity', { city: state.city })
      : t('discovery.empty.description')

  const listContent = (
    <div aria-busy={search.isPending || availabilityFilterPending}>
      {!search.isPending && !search.isError && (
        <p role="status" className="mb-2 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="result-count">
          {t('discovery.results.count', { count: state.availableNow && serviceStates.settled ? visibleRows.length : totalCount })}
        </p>
      )}
      <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]">
        {search.isPending || availabilityFilterPending ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : search.isError ? (
          <EmptyState
            title={t('errors.boundary.title')}
            description={t(errorMessageKey(toAppError(search.error)))}
            action={
              <Button variant="secondary" onClick={() => void search.refetch()}>
                {t('common.action.retry')}
              </Button>
            }
          />
        ) : visibleRows.length === 0 ? (
          <div data-testid="search-empty">
          <EmptyState
            title={t('discovery.empty.title')}
            description={state.availableNow ? t('discovery.empty.descriptionAvailability') : emptyDescription}
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

      {search.hasNextPage && visibleRows.length > 0 && (
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
          <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]">
            {fallbackRows.map(renderRow)}
          </div>
        </section>
      )}

      {/* Élargissement étiqueté : les distances réelles restent visibles. */}
      {isZero && fallbackRows.length === 0 && widened && (
        <section className="mt-6" data-testid="widened-results">
          <h2 className="mb-2 text-fu-base font-semibold">
            {t('discovery.widen.title', { km: widened.radiusKm })}
          </h2>
          <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]">
            {widened.rows.map(renderRow)}
          </div>
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
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6">
      <h1 className="mb-3 text-fu-xl font-semibold">{t('discovery.title')}</h1>

      {/* ≥1024 : composition desktop — rail (recherche + filtres) + liste. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="flex flex-col gap-5 lg:sticky lg:top-20">
          {searchControls}
          <div className="hidden lg:block">
            <FiltersPanel
              state={state}
              onChange={(partial) => update(partial)}
              onReset={() => update({ ...DEFAULT_SEARCH_STATE, view: state.view })}
            />
          </div>
        </div>

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

      {/* < 1024 : les filtres en feuille (bas < 768, latérale au-dessus). */}
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
            {t('discovery.filters.showResults', { count: state.availableNow && serviceStates.settled ? visibleRows.length : totalCount })}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
