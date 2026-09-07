import { describe, expect, it } from 'vitest'
import { startingPrice, toResultAvailability } from '@/shared/data/discovery'
import { deriveProfileCta } from '@/shared/lib/serviceState'

describe('startingPrice — le minimum réel ou rien', () => {
  const currencies = { 'org-1': 'EUR' }

  it('prix publié + devise résolue : le montant part tel quel (centimes)', () => {
    expect(startingPrice({ starting_price_cents: 2500, organization_id: 'org-1' }, currencies)).toEqual({
      cents: 2500,
      currency: 'EUR',
    })
  })

  it('aucun prix publié : null — l’interface affiche « — », jamais une estimation', () => {
    expect(startingPrice({ starting_price_cents: null as unknown as number, organization_id: 'org-1' }, currencies)).toBeNull()
  })

  it('devise non résolue : null — pas de montant dans une devise devinée', () => {
    expect(startingPrice({ starting_price_cents: 2500, organization_id: 'org-2' }, currencies)).toBeNull()
    expect(startingPrice({ starting_price_cents: 2500, organization_id: 'org-1' }, undefined)).toBeNull()
  })

  it('un prix de 0 centime COMPTÉ s’affiche : zéro n’est pas une absence', () => {
    expect(startingPrice({ starting_price_cents: 0, organization_id: 'org-1' }, currencies)).toEqual({
      cents: 0,
      currency: 'EUR',
    })
  })
})

describe('toResultAvailability — « disponible maintenant » = servir dans les 60 min', () => {
  const state = (booking: boolean, queue: boolean) => ({
    booking_accepting_new_entries: booking,
    queue_accepting_new_entries: queue,
    effective_service_mode: 'hybrid' as const,
    mode_expires_at: null,
    mode_source: null,
  })

  it('file accessible : disponible maintenant (le seul chemin prouvable dans l’heure)', () => {
    expect(toResultAvailability(deriveProfileCta(state(false, true)))).toBe('available-now')
    // Même réservable : la file accessible reste la preuve « dans l’heure ».
    expect(toResultAvailability(deriveProfileCta(state(true, true)))).toBe('available-now')
  })

  it('réservation seule : « réservable », JAMAIS « disponible maintenant » (aucune preuve de créneau dans l’heure)', () => {
    expect(toResultAvailability(deriveProfileCta(state(true, false)))).toBe('bookable')
  })

  it('rien d’ouvert : fermé — être ouvert (horaires) ne suffit pas', () => {
    expect(toResultAvailability(deriveProfileCta(state(false, false)))).toBe('closed')
  })

  it('état en cours de chargement ou en échec : rien n’est affirmé', () => {
    expect(toResultAvailability(deriveProfileCta(undefined, { isLoading: true }))).toBe('loading')
    expect(toResultAvailability(deriveProfileCta(undefined, { isError: true }))).toBe('unknown')
  })
})
