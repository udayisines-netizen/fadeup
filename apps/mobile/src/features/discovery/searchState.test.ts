import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIUS_KM,
  INITIAL_SEARCH_STATE,
  activeFilterCount,
  buildSearchArgs,
  eurosInputToCents,
  roundCoordinate,
  splitByDistance,
  type SearchState,
} from '@/features/discovery/searchState'
import type { ProfessionalSearchRow } from '@/shared/data/discovery'

/**
 * M1a §10 — la construction des paramètres de recherche : l'état local a
 * remplacé l'URL, CE module porte désormais la traduction état → RPC.
 */

const state = (overrides: Partial<SearchState> = {}): SearchState => ({
  ...INITIAL_SEARCH_STATE,
  ...overrides,
})

describe('buildSearchArgs — état local → arguments RPC', () => {
  it('état initial : AUCUN argument envoyé (les défauts sont omis)', () => {
    expect(buildSearchArgs(state())).toEqual({})
  })

  it('les textes sont trimés, les vides omis', () => {
    expect(buildSearchArgs(state({ query: '  kais ', city: '  ', service: '' }))).toEqual({
      p_query: 'kais',
    })
  })

  it('un point porte lat/lon arrondies à 4 décimales (~11 m) + le rayon', () => {
    const args = buildSearchArgs(
      state({ point: { latitude: 48.85661234, longitude: 2.35221999 }, radiusKm: 25 }),
    )
    expect(args.p_latitude).toBe(48.8566)
    expect(args.p_longitude).toBe(2.3522)
    expect(args.p_radius_km).toBe(25)
  })

  it('sans point : ni coordonnées ni rayon', () => {
    const args = buildSearchArgs(state({ radiusKm: 50 }))
    expect(args.p_latitude).toBeUndefined()
    expect(args.p_radius_km).toBeUndefined()
  })

  it('les prix passent en centimes entiers, null omis', () => {
    const args = buildSearchArgs(state({ priceMinCents: 1500, priceMaxCents: null }))
    expect(args.p_min_price_cents).toBe(1500)
    expect(args.p_max_price_cents).toBeUndefined()
  })

  it('le tri par défaut (recommended) est omis, un tri explicite est envoyé', () => {
    expect(buildSearchArgs(state()).p_sort).toBeUndefined()
    expect(buildSearchArgs(state({ sort: 'price' })).p_sort).toBe('price')
  })

  it("« disponible maintenant » est un filtre CLIENT : jamais dans les args RPC", () => {
    expect(buildSearchArgs(state({ availableNow: true }))).toEqual({})
  })
})

describe('eurosInputToCents — saisie utilisateur → centimes', () => {
  it('euros entiers et décimaux (virgule française comprise)', () => {
    expect(eurosInputToCents('25')).toBe(2500)
    expect(eurosInputToCents('12,50')).toBe(1250)
    expect(eurosInputToCents('12.5')).toBe(1250)
  })
  it('vide, hostile ou négatif → null, jamais deviné', () => {
    expect(eurosInputToCents('')).toBeNull()
    expect(eurosInputToCents('abc')).toBeNull()
    expect(eurosInputToCents('-5')).toBeNull()
  })
})

describe('roundCoordinate', () => {
  it('4 décimales exactement', () => {
    expect(roundCoordinate(48.856612345)).toBe(48.8566)
  })
})

describe('splitByDistance — une distance inconnue ne remplit pas la zone (F3 §4.5)', () => {
  const row = (distance: number | null): ProfessionalSearchRow =>
    ({ distance_km: distance, location_id: String(distance) }) as ProfessionalSearchRow

  it('avec point : les lignes sans distance sortent de la zone', () => {
    const { inZone, unlocated } = splitByDistance([row(2), row(null), row(9)], true)
    expect(inZone).toHaveLength(2)
    expect(unlocated).toHaveLength(1)
  })

  it('sans point : tout est « dans la zone », rien à part', () => {
    const { inZone, unlocated } = splitByDistance([row(null)], false)
    expect(inZone).toHaveLength(1)
    expect(unlocated).toHaveLength(0)
  })
})

describe('activeFilterCount', () => {
  it('état initial : zéro', () => {
    expect(activeFilterCount(state())).toBe(0)
  })
  it('compte service, prix, ouvert, disponible, rayon non défaut, tri', () => {
    expect(
      activeFilterCount(
        state({
          service: 'fade',
          priceMinCents: 1000,
          openNow: true,
          availableNow: true,
          point: { latitude: 48, longitude: 2 },
          radiusKm: 50,
          sort: 'price',
        }),
      ),
    ).toBe(6)
  })
  it('le rayon PAR DÉFAUT avec un point ne compte pas', () => {
    expect(
      activeFilterCount(state({ point: { latitude: 48, longitude: 2 }, radiusKm: DEFAULT_RADIUS_KM })),
    ).toBe(0)
  })
})
