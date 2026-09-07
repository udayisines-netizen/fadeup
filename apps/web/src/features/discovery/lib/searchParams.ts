import type { ProfessionalSearchArgs } from '@/shared/data/discovery'
import { SORT_OPTIONS, type SortOption } from '@/features/discovery/lib/ranking'

/**
 * F3 — L'ÉTAT DE LA RECHERCHE VIT DANS L'URL (MASTER_SPEC §3) : une recherche
 * se partage (« regarde, il y a ça près de chez toi »), survit au
 * rechargement, et le retour arrière du navigateur fonctionne. Ce module est
 * LA sérialisation, dans les deux sens, testée en aller-retour.
 *
 * Les défauts ne sont PAS écrits dans l'URL : `/search` nu reste propre, et
 * un lien partagé ne porte que ce que l'utilisateur a choisi.
 */

export interface SearchState {
  /** Texte libre : nom, style (fade, taper…), lieu. */
  query: string
  /** Recherche manuelle par ville — le chemin sans géolocalisation. */
  city: string
  /** Point de recherche (géolocalisation accordée, ou lien partagé). */
  latitude: number | null
  longitude: number | null
  /** Rayon en km — 10 par défaut en zone urbaine (MASTER_SPEC §8). */
  radiusKm: number
  openNow: boolean
  /** « Disponible maintenant » : peut servir dans les 60 min (file accessible). */
  availableNow: boolean
  /** Bornes de prix en EUROS ENTIERS dans l'URL (lisible, partageable). */
  minPrice: number | null
  maxPrice: number | null
  /** Type de service (coupe, barbe…) — colonne p_service_query. */
  service: string
  sort: SortOption
  view: 'list' | 'map'
}

export const DEFAULT_RADIUS_KM = 10
/** L'échelle d'élargissement progressif après zéro résultat dans la zone. */
export const WIDENING_RADII_KM = [25, 50] as const

export const DEFAULT_SEARCH_STATE: SearchState = {
  query: '',
  city: '',
  latitude: null,
  longitude: null,
  radiusKm: DEFAULT_RADIUS_KM,
  openNow: false,
  availableNow: false,
  minPrice: null,
  maxPrice: null,
  service: '',
  sort: 'recommended',
  view: 'list',
}

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseSearchState(params: URLSearchParams): SearchState {
  const latitude = parseNumber(params.get('lat'))
  const longitude = parseNumber(params.get('lng'))
  const hasPoint = latitude !== null && longitude !== null
  const radius = parseNumber(params.get('r'))
  const sortRaw = params.get('sort')
  const minPrice = parseNumber(params.get('pmin'))
  const maxPrice = parseNumber(params.get('pmax'))
  return {
    query: params.get('q') ?? '',
    city: params.get('city') ?? '',
    // Un point ne vaut que complet : lat sans lng (URL tronquée) = pas de point.
    latitude: hasPoint ? latitude : null,
    longitude: hasPoint ? longitude : null,
    radiusKm: radius !== null && radius > 0 ? radius : DEFAULT_RADIUS_KM,
    openNow: params.get('open') === '1',
    availableNow: params.get('avail') === '1',
    minPrice: minPrice !== null && minPrice >= 0 ? minPrice : null,
    maxPrice: maxPrice !== null && maxPrice >= 0 ? maxPrice : null,
    service: params.get('service') ?? '',
    sort: (SORT_OPTIONS as readonly string[]).includes(sortRaw ?? '') ? (sortRaw as SortOption) : 'recommended',
    view: params.get('view') === 'map' ? 'map' : 'list',
  }
}

export function serializeSearchState(state: SearchState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.query) params.set('q', state.query)
  if (state.city) params.set('city', state.city)
  if (state.latitude !== null && state.longitude !== null) {
    // 4 décimales ≈ 11 m : assez précis pour un rayon urbain, assez flou pour
    // ne pas publier une position au mètre dans un lien partagé.
    params.set('lat', state.latitude.toFixed(4))
    params.set('lng', state.longitude.toFixed(4))
    if (state.radiusKm !== DEFAULT_RADIUS_KM) params.set('r', String(state.radiusKm))
  }
  if (state.openNow) params.set('open', '1')
  if (state.availableNow) params.set('avail', '1')
  if (state.minPrice !== null) params.set('pmin', String(state.minPrice))
  if (state.maxPrice !== null) params.set('pmax', String(state.maxPrice))
  if (state.service) params.set('service', state.service)
  if (state.sort !== 'recommended') params.set('sort', state.sort)
  if (state.view !== 'list') params.set('view', state.view)
  return params
}

/**
 * L'état d'écran -> les arguments RPC. `p_entity_type: 'shop'` est ajouté par
 * la couche shared/data (loi produit, jamais optionnel ici).
 */
export function buildSearchArgs(state: SearchState): ProfessionalSearchArgs {
  const hasPoint = state.latitude !== null && state.longitude !== null
  return {
    p_query: state.query || undefined,
    p_city: state.city || undefined,
    p_service_query: state.service || undefined,
    p_latitude: hasPoint ? (state.latitude as number) : undefined,
    p_longitude: hasPoint ? (state.longitude as number) : undefined,
    p_radius_km: hasPoint ? state.radiusKm : undefined,
    p_min_price_cents: state.minPrice !== null ? Math.round(state.minPrice * 100) : undefined,
    p_max_price_cents: state.maxPrice !== null ? Math.round(state.maxPrice * 100) : undefined,
    p_open_now_only: state.openNow || undefined,
    p_sort: state.sort,
  }
}

/** Combien de filtres non par défaut sont actifs (pastille du bouton Filtres). */
export function activeFilterCount(state: SearchState): number {
  let count = 0
  if (state.openNow) count += 1
  if (state.availableNow) count += 1
  if (state.minPrice !== null || state.maxPrice !== null) count += 1
  if (state.service) count += 1
  if (state.latitude !== null && state.radiusKm !== DEFAULT_RADIUS_KM) count += 1
  return count
}
