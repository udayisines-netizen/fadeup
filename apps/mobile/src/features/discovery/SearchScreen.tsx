import { useCallback, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import {
  rowAvailability,
  useProfessionalSearch,
  useProfessionalSearchSlice,
  useResultCurrencies,
  useResultServiceStates,
  type ProfessionalSearchRow,
} from '@/shared/data/discovery'
import { discoveryKeys } from '@/shared/data/keys'
import { rankResults } from '@/shared/lib/searchRanking'
import {
  WIDEN_STEPS_KM,
  activeFilterCount,
  buildSearchArgs,
  splitByDistance,
  type SearchState,
  INITIAL_SEARCH_STATE,
} from '@/features/discovery/searchState'
import { useNearMe } from '@/features/discovery/useNearMe'
import { ResultCard } from '@/shared/ui/ResultCard'
import { ResultSheet } from '@/shared/ui/ResultSheet'
import { FiltersSheet } from '@/features/discovery/FiltersSheet'
import { MapMode } from '@/features/discovery/MapMode'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FuText } from '@/shared/ui/Text'
import { Skeleton } from '@/shared/ui/Skeleton'
import { color, font, fontSize, radius, spacing, touchTarget } from '@/shared/theme/tokens'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'

/**
 * F3 transposée — /search en natif. Liste PAR DÉFAUT, carte en MODE ;
 * l'état vit en état local (plus d'URL) ; la géolocalisation se demande au
 * geste « Autour de moi » ; zéro résultat = élargissement 25/50 km en
 * sections ÉTIQUETÉES, jamais un résultat inventé ; un tap ouvre la FEUILLE,
 * la liste reste dessous, sa position préservée.
 */

const STAGGER_MS = 45
const STAGGER_CAP = 8

export function SearchScreen() {
  const { t } = useTranslation('v2')
  const reduced = usePrefersReducedMotion()

  const [state, setState] = useState<SearchState>(INITIAL_SEARCH_STATE)
  const [mode, setMode] = useState<'list' | 'map'>('list')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState<ProfessionalSearchRow | null>(null)

  const { status: geoStatus, locate } = useNearMe(
    useCallback((point) => setState((s) => ({ ...s, point, city: '' })), []),
  )

  const args = useMemo(() => buildSearchArgs(state), [state])
  const search = useProfessionalSearch(args)
  const rows = useMemo(() => (search.data?.pages ?? []).flat(), [search.data])
  const totalCount = search.data?.pages[0]?.[0]?.total_count ?? 0
  const hasPoint = state.point !== null

  const { inZone, unlocated } = useMemo(() => splitByDistance(rows, hasPoint), [rows, hasPoint])

  /* Élargissement progressif — seulement après un zéro RÉEL dans la zone. */
  const zeroInZone = search.isSuccess && inZone.length === 0
  const widen25 = useProfessionalSearchSlice(
    discoveryKeys.widened({ ...args, p_radius_km: WIDEN_STEPS_KM[0] }),
    { ...args, p_radius_km: WIDEN_STEPS_KM[0] },
    { enabled: hasPoint && zeroInZone },
  )
  const widen25Rows = useMemo(
    () => splitByDistance(widen25.data ?? [], true).inZone,
    [widen25.data],
  )
  const widen50 = useProfessionalSearchSlice(
    discoveryKeys.widened({ ...args, p_radius_km: WIDEN_STEPS_KM[1] }),
    { ...args, p_radius_km: WIDEN_STEPS_KM[1] },
    { enabled: hasPoint && zeroInZone && widen25.isSuccess && widen25Rows.length === 0 },
  )
  const widen50Rows = useMemo(
    () => splitByDistance(widen50.data ?? [], true).inZone,
    [widen50.data],
  )
  const widened = useMemo(
    () =>
      widen25Rows.length > 0
        ? { km: WIDEN_STEPS_KM[0], rows: widen25Rows }
        : widen50Rows.length > 0
          ? { km: WIDEN_STEPS_KM[1], rows: widen50Rows }
          : null,
    [widen25Rows, widen50Rows],
  )

  /* Repli style→service — le MÊME texte retenté comme nom de service,
     section DÉCLARÉE (F3 §3). Zéro résultat seulement, jamais en parallèle. */
  const fallbackArgs = useMemo(() => {
    const { p_query: _q, ...rest } = args
    return { ...rest, p_service_query: state.query.trim() }
  }, [args, state.query])
  const fallbackEnabled =
    search.isSuccess && rows.length === 0 && state.query.trim().length > 0 && state.service.trim().length === 0
  const fallback = useProfessionalSearchSlice(discoveryKeys.serviceFallback(fallbackArgs), fallbackArgs, {
    enabled: fallbackEnabled,
  })
  const fallbackRows = useMemo(() => fallback.data ?? [], [fallback.data])

  /* Devises et états de service — pour TOUTES les rangées affichables. */
  const allRows = useMemo(
    () => [...rows, ...(widened?.rows ?? []), ...fallbackRows],
    [rows, widened, fallbackRows],
  )
  const currencies = useResultCurrencies(allRows.map((row) => row.organization_id))
  const serviceStates = useResultServiceStates(
    allRows.map((row) => ({ slug: row.organization_slug, locationId: row.location_id })),
  )

  /* Classement client — UNE FOIS les états résolus, jamais rebrassé sous le
     doigt (F3, correctif M1) ; ne réordonne jamais un tri serveur. */
  const availabilityByLocation = useMemo(
    () =>
      Object.fromEntries(
        inZone.map((row) => [row.location_id, rowAvailability(row, serviceStates)]),
      ),
    [inZone, serviceStates],
  )
  const ranked = useMemo(
    () =>
      serviceStates.settled
        ? rankResults(inZone, availabilityByLocation, state.sort, hasPoint)
        : inZone,
    [inZone, serviceStates.settled, availabilityByLocation, state.sort, hasPoint],
  )

  /* Filtre CLIENT « disponible maintenant » — état réel, pages chargées,
     honnêteté bornée (F3, correctif M2). */
  const displayed = useMemo(
    () =>
      state.availableNow
        ? ranked.filter((row) => rowAvailability(row, serviceStates) === 'available-now')
        : ranked,
    [ranked, state.availableNow, serviceStates],
  )

  const availability = useCallback(
    (row: ProfessionalSearchRow) => rowAvailability(row, serviceStates),
    [serviceStates],
  )

  const openSheet = useCallback((row: ProfessionalSearchRow) => setSelected(row), [])

  const filterCount = activeFilterCount(state)
  const loadedAll = rows.length >= totalCount

  const renderCard = useCallback(
    ({ item, index }: { item: ProfessionalSearchRow; index: number }) => (
      <Animated.View
        entering={
          reduced
            ? FadeIn.duration(90)
            : FadeInDown.duration(220).delay(Math.min(index, STAGGER_CAP) * STAGGER_MS)
        }
        style={styles.cardWrap}
      >
        <ResultCard
          row={item}
          currencyByOrganization={currencies.data}
          availability={availability(item)}
          onOpen={openSheet}
        />
      </Animated.View>
    ),
    [reduced, currencies.data, availability, openSheet],
  )

  const header = (
    <View style={styles.controls}>
      <View style={styles.searchField}>
        <Ionicons name="search-outline" size={18} color={color.textSecondary} />
        <TextInput
          value={state.query}
          onChangeText={(query) => setState((s) => ({ ...s, query }))}
          placeholder={t('discovery.search.placeholder')}
          placeholderTextColor={color.textTertiary}
          accessibilityLabel={t('discovery.search.label')}
          returnKeyType="search"
          style={styles.searchInput}
        />
      </View>

      <View style={styles.secondRow}>
        <View style={[styles.searchField, styles.cityField]}>
          <Ionicons name="location-outline" size={16} color={color.textSecondary} />
          <TextInput
            value={state.city}
            onChangeText={(city) => setState((s) => ({ ...s, city, point: null }))}
            placeholder={t('discovery.search.cityPlaceholder')}
            placeholderTextColor={color.textTertiary}
            accessibilityLabel={t('discovery.search.cityLabel')}
            returnKeyType="search"
            style={styles.searchInput}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('discovery.geo.nearMe')}
          onPress={() => void locate()}
          style={[styles.nearMe, hasPoint && styles.nearMeActive]}
        >
          <Ionicons
            name="navigate-outline"
            size={16}
            color={hasPoint ? color.accentText : color.textSecondary}
          />
          <FuText variant="smMedium" tone={hasPoint ? 'accent' : 'secondary'}>
            {geoStatus === 'locating' ? t('discovery.geo.locating') : t('discovery.geo.nearMe')}
          </FuText>
        </Pressable>
      </View>

      {geoStatus === 'denied' || geoStatus === 'error' ? (
        <FuText variant="sm" tone="secondary">
          {t('discovery.geo.denied')}
        </FuText>
      ) : null}

      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('discovery.filters.button')}
          onPress={() => setFiltersOpen(true)}
          style={styles.filtersButton}
        >
          <Ionicons name="options-outline" size={16} color={color.textPrimary} />
          <FuText variant="smMedium">
            {filterCount > 0
              ? t('discovery.filters.buttonCount', { count: filterCount })
              : t('discovery.filters.button')}
          </FuText>
        </Pressable>

        <View style={styles.modeToggle} accessibilityLabel={t('discovery.view.label')}>
          {(['list', 'map'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === value }}
              onPress={() => setMode(value)}
              style={[styles.modeOption, mode === value && styles.modeOptionActive]}
            >
              <FuText variant="smMedium" tone={mode === value ? 'primary' : 'secondary'}>
                {t(`discovery.view.${value}`)}
              </FuText>
            </Pressable>
          ))}
        </View>
      </View>

      {search.isSuccess ? (
        <FuText variant="sm" tone="secondary">
          {state.availableNow
            ? loadedAll
              ? t('discovery.results.countAvailable', { count: displayed.length })
              : t('discovery.results.countAvailablePartial', {
                  count: displayed.length,
                  loaded: rows.length,
                })
            : t('discovery.results.count', { count: totalCount })}
        </FuText>
      ) : null}
    </View>
  )

  const emptyBlock =
    search.isSuccess && displayed.length === 0 ? (
      <View>
        <EmptyState
          title={t('discovery.empty.title')}
          body={
            state.availableNow
              ? loadedAll
                ? t('discovery.empty.descriptionAvailability')
                : t('discovery.empty.descriptionAvailabilityPartial', { loaded: rows.length })
              : hasPoint
                ? t('discovery.empty.descriptionRadius', { km: state.radiusKm })
                : state.city.trim()
                  ? t('discovery.empty.descriptionCity', { city: state.city.trim() })
                  : t('discovery.empty.description')
          }
        />
        <View style={styles.emptyActions}>
          {state.query.trim() ? (
            <Button
              label={t('discovery.empty.clearQuery')}
              variant="secondary"
              onPress={() => setState((s) => ({ ...s, query: '' }))}
            />
          ) : null}
          {state.availableNow ? (
            <Button
              label={t('discovery.empty.clearAvailability')}
              variant="secondary"
              onPress={() => setState((s) => ({ ...s, availableNow: false }))}
            />
          ) : null}
          {!hasPoint && state.city.trim() ? (
            <Button
              label={t('discovery.empty.searchEverywhere')}
              variant="secondary"
              onPress={() => setState((s) => ({ ...s, city: '' }))}
            />
          ) : null}
        </View>
      </View>
    ) : null

  const footer = (
    <View style={styles.footer}>
      {emptyBlock}

      {/* Élargissement — sections séparées, étiquetées, distances réelles. */}
      {zeroInZone && widened ? (
        <View style={styles.section}>
          <FuText variant="smMedium" tone="secondary">
            {t('discovery.widen.title', { km: widened.km })}
          </FuText>
          {widened.rows.map((row) => (
            <View key={row.location_id} style={styles.cardWrap}>
              <ResultCard
                row={row}
                currencyByOrganization={currencies.data}
                availability={availability(row)}
                onOpen={openSheet}
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* Lignes sans coordonnées — à part, jamais « dans la zone ». */}
      {unlocated.length > 0 ? (
        <View style={styles.section}>
          <FuText variant="smMedium" tone="secondary">
            {t('discovery.unlocated.title')}
          </FuText>
          <FuText variant="sm" tone="tertiary">
            {t('discovery.unlocated.note')}
          </FuText>
          {unlocated.map((row) => (
            <View key={row.location_id} style={styles.cardWrap}>
              <ResultCard
                row={row}
                currencyByOrganization={currencies.data}
                availability={availability(row)}
                onOpen={openSheet}
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* Repli par service — section déclarée (F3 §3). */}
      {fallbackEnabled && fallbackRows.length > 0 ? (
        <View style={styles.section}>
          <FuText variant="smMedium" tone="secondary">
            {t('discovery.fallback.title', { query: state.query.trim() })}
          </FuText>
          {fallbackRows.map((row) => (
            <View key={row.location_id} style={styles.cardWrap}>
              <ResultCard
                row={row}
                currencyByOrganization={currencies.data}
                availability={availability(row)}
                onOpen={openSheet}
              />
            </View>
          ))}
        </View>
      ) : null}

      {search.hasNextPage ? (
        <Button
          label={t('discovery.results.loadMore')}
          variant="secondary"
          fullWidth
          loading={search.isFetchingNextPage}
          onPress={() => void search.fetchNextPage()}
        />
      ) : null}

      {search.isPending ? (
        <View style={styles.skeletons} accessibilityElementsHidden>
          <Skeleton height={200} />
          <Skeleton height={200} />
          <Skeleton height={200} />
        </View>
      ) : null}

      {search.isError ? (
        <EmptyState
          title={t('errors.boundary.title')}
          body={t('errors.data.network')}
          actionLabel={t('common.action.retry')}
          onAction={() => void search.refetch()}
        />
      ) : null}
    </View>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {mode === 'map' ? (
        <View style={styles.mapContainer}>
          {header}
          <MapMode rows={[...displayed, ...unlocated]} point={state.point} onOpen={openSheet} />
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={(row) => row.location_id}
          renderItem={renderCard}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage()
          }}
        />
      )}

      <ResultSheet
        row={selected}
        currencyByOrganization={currencies.data}
        availability={selected ? availability(selected) : 'loading'}
        onClose={() => setSelected(null)}
      />
      <FiltersSheet
        open={filtersOpen}
        state={state}
        onApply={setState}
        onClose={() => setFiltersOpen(false)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  listContent: { paddingHorizontal: spacing(4), paddingBottom: spacing(6) },
  controls: { gap: spacing(2.5), paddingTop: spacing(2), paddingBottom: spacing(3) },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    minHeight: touchTarget + 4,
    paddingHorizontal: spacing(3),
    borderRadius: radius.control + 4,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    color: color.textPrimary,
    paddingVertical: 0,
  },
  secondRow: { flexDirection: 'row', gap: spacing(2) },
  cityField: { flex: 1, minHeight: touchTarget },
  nearMe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    paddingHorizontal: spacing(3),
    borderRadius: radius.control + 4,
    borderWidth: 1.5,
    borderColor: color.border,
    backgroundColor: color.surface,
    minHeight: touchTarget,
  },
  nearMeActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filtersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    minHeight: touchTarget,
    paddingHorizontal: spacing(3),
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  modeToggle: {
    flexDirection: 'row',
    borderRadius: radius.control,
    backgroundColor: color.surfaceSubtle,
    padding: 3,
  },
  modeOption: {
    paddingHorizontal: spacing(3.5),
    minHeight: touchTarget - 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control - 2,
  },
  modeOptionActive: { backgroundColor: color.surface },
  cardWrap: { marginBottom: spacing(3) },
  footer: { gap: spacing(4) },
  section: { gap: spacing(2.5) },
  emptyActions: { gap: spacing(2), alignItems: 'center' },
  skeletons: { gap: spacing(3) },
  mapContainer: { flex: 1, paddingHorizontal: spacing(4) },
})
