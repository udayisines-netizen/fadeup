/**
 * Deterministic geographic partitioning + saturation detection.
 *
 * Pure functions, no I/O — this is the part of the planner that must be
 * reproducible and unit-testable. Given the same inputs it always produces
 * the same partition tree, which is what makes a search auditable and a
 * benchmark comparable across runs.
 */

export interface GeoCell {
  centerLatitude: number
  centerLongitude: number
  radiusKm: number
}

export interface PartitionSpec extends GeoCell {
  sourceKey: string
  query: string | null
  country: string
  region: string | null
  city: string | null
  postalCode: string | null
  depth: number
}

/**
 * Splits a circular cell into four smaller circles that together cover it.
 *
 * The children are placed at the corners of the inscribed square and given
 * a radius of r * 0.6 rather than r/2: four circles of exactly r/2 centred
 * on quadrant midpoints leave uncovered gaps near the parent's edge, and a
 * discovery gap is a silently-missed barbershop. The ~20% overlap is
 * deliberate — duplicates are cheap (identity resolution collapses them),
 * missed businesses are not.
 */
export function subdivideCell(cell: GeoCell): GeoCell[] {
  const childRadiusKm = cell.radiusKm * 0.6
  // Offset from the parent centre to each child centre.
  const offsetKm = cell.radiusKm * 0.5

  const latDeltaDeg = kmToLatitudeDegrees(offsetKm)
  const lonDeltaDeg = kmToLongitudeDegrees(offsetKm, cell.centerLatitude)

  return [
    { centerLatitude: cell.centerLatitude + latDeltaDeg, centerLongitude: cell.centerLongitude - lonDeltaDeg, radiusKm: childRadiusKm },
    { centerLatitude: cell.centerLatitude + latDeltaDeg, centerLongitude: cell.centerLongitude + lonDeltaDeg, radiusKm: childRadiusKm },
    { centerLatitude: cell.centerLatitude - latDeltaDeg, centerLongitude: cell.centerLongitude - lonDeltaDeg, radiusKm: childRadiusKm },
    { centerLatitude: cell.centerLatitude - latDeltaDeg, centerLongitude: cell.centerLongitude + lonDeltaDeg, radiusKm: childRadiusKm },
  ].map(clampCell)
}

/** ~111.32 km per degree of latitude, everywhere. */
function kmToLatitudeDegrees(km: number): number {
  return km / 111.32
}

/** Longitude degrees shrink with latitude; at 60°N a degree is half as wide as at the equator. */
function kmToLongitudeDegrees(km: number, atLatitude: number): number {
  const scale = Math.cos((atLatitude * Math.PI) / 180)
  // Near the poles the scale collapses toward zero and the conversion
  // explodes; clamp so a pathological input cannot produce an absurd cell.
  return km / (111.32 * Math.max(scale, 0.01))
}

function clampCell(cell: GeoCell): GeoCell {
  return {
    centerLatitude: Math.max(-90, Math.min(90, cell.centerLatitude)),
    centerLongitude: normalizeLongitude(cell.centerLongitude),
    radiusKm: Math.max(0.1, cell.radiusKm),
  }
}

function normalizeLongitude(lon: number): number {
  let value = lon
  while (value > 180) value -= 360
  while (value < -180) value += 360
  return value
}

export interface SaturationInput {
  /** How many raw results the provider returned for this partition. */
  rawResults: number
  /**
   * The provider's per-query result ceiling. When rawResults reaches it,
   * results were almost certainly truncated.
   */
  providerResultLimit: number
  /** Whether the provider explicitly signalled more pages are available. */
  providerReportedMore: boolean
  /** How many of the raw results were NEW (not already seen in this search). */
  uniqueResults: number
}

export interface SaturationVerdict {
  saturated: boolean
  /** Whether the planner should actually spend budget subdividing. */
  shouldSubdivide: boolean
  reason: string
}

/**
 * The saturation heuristic.
 *
 * A partition is SATURATED when the provider probably truncated its answer
 * — that is the only case where subdividing recovers businesses we would
 * otherwise never see.
 *
 * Crucially, a saturated partition is not automatically subdivided: if
 * almost everything it returned was already known, splitting it four ways
 * spends four times the API budget to re-discover the same businesses.
 * That is the "a low-yield partition must not keep subdividing
 * unnecessarily" rule from spec §7, and it is where a naive quadtree
 * crawler burns an entire Google Places budget.
 */
export function assessSaturation(input: SaturationInput): SaturationVerdict {
  const { rawResults, providerResultLimit, providerReportedMore, uniqueResults } = input

  if (rawResults === 0) {
    return { saturated: false, shouldSubdivide: false, reason: 'empty_partition' }
  }

  const atLimit = rawResults >= providerResultLimit
  const saturated = atLimit || providerReportedMore

  if (!saturated) {
    return { saturated: false, shouldSubdivide: false, reason: 'complete_result_set' }
  }

  const uniqueRatio = uniqueResults / rawResults

  // Saturated, but nearly everything was a duplicate: the neighbouring
  // partitions already covered this ground. Splitting further is spend
  // without discovery.
  if (uniqueRatio < 0.15) {
    return { saturated: true, shouldSubdivide: false, reason: `saturated_but_low_yield(unique=${uniqueResults}/${rawResults})` }
  }

  return {
    saturated: true,
    shouldSubdivide: true,
    reason: providerReportedMore
      ? 'provider_reported_more_pages'
      : `hit_provider_result_limit(${rawResults}>=${providerResultLimit})`,
  }
}

/**
 * Category/keyword variants to fan a search across. Deterministic and
 * locale-aware: searching "barbier" in France and "barber shop" in the UK
 * finds materially different sets, and running every variant everywhere
 * wastes budget on terms with no local usage.
 */
const KEYWORD_VARIANTS_BY_COUNTRY: Record<string, string[]> = {
  FR: ['barbier', 'barbershop', 'coiffeur homme', 'salon de coiffure homme'],
  BE: ['barbier', 'barbershop', 'coiffeur homme', 'herenkapper'],
  GB: ['barber', 'barber shop', 'mens hairdresser', 'turkish barber'],
  US: ['barber', 'barber shop', 'mens haircut', 'fade barbershop'],
  ES: ['barberia', 'barber shop', 'peluqueria hombre'],
  IT: ['barbiere', 'barber shop', 'parrucchiere uomo'],
  DE: ['barbier', 'barbershop', 'herrenfriseur'],
  NL: ['barbier', 'barbershop', 'herenkapper'],
}

const DEFAULT_KEYWORD_VARIANTS = ['barber', 'barbershop', 'mens hairdresser']

/** Keyword variants for a country, or a sensible default. Never derived from a business name. */
export function keywordVariantsFor(country: string, explicitKeywords?: string[]): string[] {
  if (explicitKeywords && explicitKeywords.length > 0) return [...new Set(explicitKeywords)]
  return KEYWORD_VARIANTS_BY_COUNTRY[country.toUpperCase()] ?? DEFAULT_KEYWORD_VARIANTS
}

/**
 * Per-provider result ceilings, used by assessSaturation. These are the
 * documented single-response limits, not guesses: exceeding them is the
 * signal that a result set was truncated.
 */
export const PROVIDER_RESULT_LIMITS: Record<string, number> = {
  // Places API (New) searchText/searchNearby return at most 20 per page.
  google_places: 20,
  // Geoapify's `limit` parameter maxes out at 500; we request 100.
  geoapify: 100,
  // Overpass has no fixed cap — it returns everything matching. It
  // therefore never saturates in the truncation sense, and this high
  // value encodes that.
  osm: 100_000,
  // Sirene's paged API returns 1000 per page at most.
  sirene: 1000,
  competitor_directory: 100,
}

export function providerResultLimit(sourceKey: string): number {
  return PROVIDER_RESULT_LIMITS[sourceKey] ?? 50
}

/**
 * Per-request cost in USD, where a provider actually publishes one.
 * Everything else is deliberately absent (not zero) so cost reporting says
 * "not measurable" rather than inventing a figure — see spec §7.
 */
export const PROVIDER_COST_USD_PER_REQUEST: Record<string, number | null> = {
  // Places API (New) Text Search Essentials, list price at time of writing.
  google_places: 0.032,
  geoapify: null,
  osm: null,
  sirene: null,
  website: null,
  instagram: null,
  competitor_directory: null,
}

export function estimatedCostUsd(sourceKey: string, requests: number): number | null {
  const perRequest = PROVIDER_COST_USD_PER_REQUEST[sourceKey]
  if (perRequest === null || perRequest === undefined) return null
  return Number((perRequest * requests).toFixed(6))
}
