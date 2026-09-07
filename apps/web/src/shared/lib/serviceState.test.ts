import { describe, expect, it } from 'vitest'
import { deriveProfileCta, type PublicServiceStateRow } from '@/shared/lib/serviceState'

function row(overrides: Partial<PublicServiceStateRow> = {}): PublicServiceStateRow {
  return {
    booking_accepting_new_entries: false,
    queue_accepting_new_entries: false,
    effective_service_mode: 'hybrid',
    mode_expires_at: null,
    mode_source: null,
    ...overrides,
  }
}

describe('deriveProfileCta — le mappage F1/F2 des états de service', () => {
  it('RPC en échec => unknown : rien n’est affirmé, jamais un état inventé', () => {
    expect(deriveProfileCta(null, { isError: true }).kind).toBe('unknown')
  })

  it('pas encore de réponse => loading, PAS une panne (revue F2, B1)', () => {
    expect(deriveProfileCta(undefined).kind).toBe('loading')
    expect(deriveProfileCta(null, { isLoading: true }).kind).toBe('loading')
    // isError prime : une vraie panne reste une panne même « en cours ».
    expect(deriveProfileCta(null, { isLoading: true, isError: true }).kind).toBe('unknown')
  })

  it('réservation ouverte => bookable, la file reste visible', () => {
    const cta = deriveProfileCta(row({ booking_accepting_new_entries: true, queue_accepting_new_entries: true }))
    expect(cta.kind).toBe('bookable')
    expect(cta.queueOpen).toBe(true)
  })

  it('file seule ouverte => queue-only : l’alternative réelle', () => {
    const cta = deriveProfileCta(row({ queue_accepting_new_entries: true }))
    expect(cta.kind).toBe('queue-only')
  })

  it('rien d’ouvert => closed, le profil reste entier (décision d’écran)', () => {
    expect(deriveProfileCta(row()).kind).toBe('closed')
  })

  it('mode temporaire futur => l’échéance est portée', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const cta = deriveProfileCta(row({ booking_accepting_new_entries: true, mode_expires_at: future }))
    expect(cta.temporaryUntil).toBe(future)
  })

  it('échéance passée => ignorée (fenêtre morte vue par le poll)', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const cta = deriveProfileCta(row({ booking_accepting_new_entries: true, mode_expires_at: past }))
    expect(cta.temporaryUntil).toBeNull()
  })
})
