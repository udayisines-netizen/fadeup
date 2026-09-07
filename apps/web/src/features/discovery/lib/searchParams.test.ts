import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIUS_KM,
  DEFAULT_SEARCH_STATE,
  activeFilterCount,
  buildSearchArgs,
  parseSearchState,
  serializeSearchState,
  type SearchState,
} from '@/features/discovery/lib/searchParams'

describe('searchParams — l’état vit dans l’URL', () => {
  it('un /search nu donne l’état par défaut, avec le rayon urbain de 10 km', () => {
    const state = parseSearchState(new URLSearchParams())
    expect(state).toEqual(DEFAULT_SEARCH_STATE)
    expect(state.radiusKm).toBe(DEFAULT_RADIUS_KM)
  })

  it('aller-retour complet : tout état non par défaut survit à la sérialisation', () => {
    const state: SearchState = {
      query: 'burst fade',
      city: 'Levallois',
      latitude: 48.8566,
      longitude: 2.3522,
      radiusKm: 25,
      openNow: true,
      availableNow: true,
      minPrice: 15,
      maxPrice: 40,
      service: 'dégradé américain',
      sort: 'nearest',
      view: 'map',
    }
    const roundTripped = parseSearchState(serializeSearchState(state))
    expect(roundTripped).toEqual(state)
  })

  it('les défauts ne polluent pas l’URL : l’état par défaut sérialise vide', () => {
    expect(serializeSearchState(DEFAULT_SEARCH_STATE).toString()).toBe('')
  })

  it('un point tronqué (lat sans lng) n’est pas un point', () => {
    const state = parseSearchState(new URLSearchParams('lat=48.85'))
    expect(state.latitude).toBeNull()
    expect(state.longitude).toBeNull()
  })

  it('valeurs hostiles : tri inconnu, vue inconnue, nombres invalides retombent sur les défauts', () => {
    const state = parseSearchState(new URLSearchParams('sort=payant&view=3d&r=abc&pmin=-4&lat=x&lng=y'))
    expect(state.sort).toBe('recommended')
    expect(state.view).toBe('list')
    expect(state.radiusKm).toBe(DEFAULT_RADIUS_KM)
    expect(state.minPrice).toBeNull()
    expect(state.latitude).toBeNull()
  })

  it('le rayon ne sérialise qu’avec un point, et seulement hors défaut', () => {
    const withoutPoint = serializeSearchState({ ...DEFAULT_SEARCH_STATE, radiusKm: 50 })
    expect(withoutPoint.get('r')).toBeNull()
    const withPoint = serializeSearchState({
      ...DEFAULT_SEARCH_STATE,
      latitude: 48.85,
      longitude: 2.35,
      radiusKm: 50,
    })
    expect(withPoint.get('r')).toBe('50')
  })
})

describe('buildSearchArgs — l’état vers la RPC', () => {
  it('les prix passent d’euros (URL) en centimes (RPC)', () => {
    const args = buildSearchArgs({ ...DEFAULT_SEARCH_STATE, minPrice: 15, maxPrice: 40 })
    expect(args.p_min_price_cents).toBe(1500)
    expect(args.p_max_price_cents).toBe(4000)
  })

  it('sans point : ni latitude, ni longitude, ni rayon ne partent', () => {
    const args = buildSearchArgs({ ...DEFAULT_SEARCH_STATE, radiusKm: 25 })
    expect(args.p_latitude).toBeUndefined()
    expect(args.p_longitude).toBeUndefined()
    expect(args.p_radius_km).toBeUndefined()
  })

  it('avec un point : le rayon par défaut de 10 km part explicitement', () => {
    const args = buildSearchArgs({ ...DEFAULT_SEARCH_STATE, latitude: 48.85, longitude: 2.35 })
    expect(args.p_radius_km).toBe(DEFAULT_RADIUS_KM)
  })

  it('les chaînes vides deviennent absentes, jamais envoyées', () => {
    const args = buildSearchArgs(DEFAULT_SEARCH_STATE)
    expect(args.p_query).toBeUndefined()
    expect(args.p_city).toBeUndefined()
    expect(args.p_service_query).toBeUndefined()
    expect(args.p_open_now_only).toBeUndefined()
  })
})

describe('activeFilterCount', () => {
  it('compte les filtres hors défaut pour la pastille du bouton', () => {
    expect(activeFilterCount(DEFAULT_SEARCH_STATE)).toBe(0)
    expect(
      activeFilterCount({ ...DEFAULT_SEARCH_STATE, openNow: true, minPrice: 10, service: 'barbe' }),
    ).toBe(3)
  })
})
