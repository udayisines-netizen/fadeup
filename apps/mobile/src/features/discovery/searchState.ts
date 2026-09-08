import type { ProfessionalSearchArgs, ProfessionalSearchRow } from '@/shared/data/discovery'
import type { SortOption } from '@/shared/lib/searchRanking'

/**
 * F3 transposé — l'état de recherche ne vit PLUS dans l'URL (le changement
 * principal M1a §8) : il vit ici, en état local d'écran, et CE module le
 * traduit en arguments RPC. La traduction est pure et testée — c'est elle
 * qui portait les pièges côté web (euros→centimes, point tronqué, défauts
 * omis).
 *
 * `p_entity_type: 'shop'` n'apparaît pas ici : la couche partagée
 * shared/data/discovery.ts l'écrit dans CHAQUE appel (loi produit §2 —
 * jamais déléguée à un défaut distant).
 */

export interface SearchPoint {
  latitude: number
  longitude: number
}

export interface SearchState {
  query: string
  city: string
  /** Filtre « type de service » (p_service_query). */
  service: string
  /** Point de recherche — UNIQUEMENT après le geste « autour de moi ». */
  point: SearchPoint | null
  /** Rayon appliqué quand un point existe. */
  radiusKm: number
  priceMinCents: number | null
  priceMaxCents: number | null
  openNow: boolean
  /** Filtre CLIENT « disponible maintenant » — état réel, pages chargées. */
  availableNow: boolean
  sort: SortOption
}

export const DEFAULT_RADIUS_KM = 10
export const RADIUS_OPTIONS = [5, 10, 25, 50] as const
/** Élargissement progressif après zéro résultat (F3 §4) — 50 km, pas plus. */
export const WIDEN_STEPS_KM = [25, 50] as const

export const INITIAL_SEARCH_STATE: SearchState = {
  query: '',
  city: '',
  service: '',
  point: null,
  radiusKm: DEFAULT_RADIUS_KM,
  priceMinCents: null,
  priceMaxCents: null,
  openNow: false,
  availableNow: false,
  sort: 'recommended',
}

/** 4 décimales ≈ 11 m — jamais une position au mètre (décision F3 §5). */
export function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** L'état → les arguments RPC. Les défauts sont OMIS (pas envoyés). */
export function buildSearchArgs(state: SearchState): ProfessionalSearchArgs {
  const args: ProfessionalSearchArgs = {}
  const query = state.query.trim()
  const city = state.city.trim()
  const service = state.service.trim()
  if (query) args.p_query = query
  if (city) args.p_city = city
  if (service) args.p_service_query = service
  if (state.point) {
    args.p_latitude = roundCoordinate(state.point.latitude)
    args.p_longitude = roundCoordinate(state.point.longitude)
    args.p_radius_km = state.radiusKm
  }
  if (state.priceMinCents !== null) args.p_min_price_cents = state.priceMinCents
  if (state.priceMaxCents !== null) args.p_max_price_cents = state.priceMaxCents
  if (state.openNow) args.p_open_now_only = true
  if (state.sort !== 'recommended') args.p_sort = state.sort
  return args
}

/** Nombre de filtres actifs (pastille du bouton Filtres). */
export function activeFilterCount(state: SearchState): number {
  let count = 0
  if (state.service.trim()) count += 1
  if (state.priceMinCents !== null || state.priceMaxCents !== null) count += 1
  if (state.openNow) count += 1
  if (state.availableNow) count += 1
  if (state.point && state.radiusKm !== DEFAULT_RADIUS_KM) count += 1
  if (state.sort !== 'recommended') count += 1
  return count
}

/**
 * Une ligne est « dans la zone » d'une recherche par rayon SEULEMENT si sa
 * distance est connue (F3 §4.5 — revue M3) : une ligne sans coordonnées ne
 * remplit pas la zone, elle s'affiche à part (« à distance inconnue »), et
 * le zéro/l'élargissement se déclenchent.
 */
export function splitByDistance(rows: ProfessionalSearchRow[], hasPoint: boolean): {
  inZone: ProfessionalSearchRow[]
  unlocated: ProfessionalSearchRow[]
} {
  if (!hasPoint) return { inZone: rows, unlocated: [] }
  const inZone: ProfessionalSearchRow[] = []
  const unlocated: ProfessionalSearchRow[] = []
  for (const row of rows) {
    if (row.distance_km === null) unlocated.push(row)
    else inZone.push(row)
  }
  return { inZone, unlocated }
}

/** Euros entiers saisis → centimes ; vide/invalide → null (jamais deviné). */
export function eurosInputToCents(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const value = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}
