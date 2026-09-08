import { describe, expect, it } from 'vitest'
import frQueue from '@/shared/i18n/locales/fr/queue.json'
import enQueue from '@/shared/i18n/locales/en/queue.json'
import {
  QUEUE_REFUSAL_CODES,
  parseQueueRefusal,
  refusalIsRetryable,
  refusalMessageKey,
} from '@/features/queue/lib/refusals'

describe('les motifs de refus nommés de la file (B1 + F1b)', () => {
  it('sont exactement quinze — huit du join, sept de F1b', () => {
    expect(QUEUE_REFUSAL_CODES).toHaveLength(15)
    // Les sept F1b, nommément : barber sans file, et les refus des RPC
    // quitter / suivre / changer.
    for (const code of [
      'barber_queue_disabled',
      'entry_not_found',
      'not_entry_owner',
      'entry_already_closed',
      'entry_in_service',
      'entry_not_waiting',
      'already_in_that_queue',
    ] as const) {
      expect(QUEUE_REFUSAL_CODES).toContain(code)
    }
  })

  it.each(QUEUE_REFUSAL_CODES)('extrait %s du champ details de PostgREST', (code) => {
    expect(parseQueueRefusal({ details: `fadeup_queue_refusal=${code}` })).toBe(code)
  })

  it('ignore une erreur sans code de refus', () => {
    expect(parseQueueRefusal({ details: 'permission denied' })).toBeNull()
    expect(parseQueueRefusal({ message: 'network' })).toBeNull()
    expect(parseQueueRefusal(null)).toBeNull()
    expect(parseQueueRefusal('boom')).toBeNull()
    expect(parseQueueRefusal({ details: 'fadeup_queue_refusal=not_a_real_code' })).toBeNull()
  })

  it('produit quinze clés de message DISTINCTES', () => {
    const keys = QUEUE_REFUSAL_CODES.map(refusalMessageKey)
    expect(new Set(keys).size).toBe(QUEUE_REFUSAL_CODES.length)
  })

  it.each(['fr', 'en'] as const)('a quinze messages traduits distincts en %s', (lng) => {
    const bundle = lng === 'fr' ? frQueue : enQueue
    const messages = QUEUE_REFUSAL_CODES.map((code) => (bundle.refusal as Record<string, string>)[code])
    for (const message of messages) {
      expect(message).toBeTruthy()
      expect(typeof message).toBe('string')
    }
    // « Trop loin » n'est pas « QR invalide » n'est pas « place d'un autre » :
    // quinze textes réellement différents, pas un générique dupliqué.
    expect(new Set(messages).size).toBe(QUEUE_REFUSAL_CODES.length)
  })

  it('distingue les refus corrigibles sur place des refus d’état du salon', () => {
    expect(refusalIsRetryable('too_far')).toBe(true)
    expect(refusalIsRetryable('position_required')).toBe(true)
    expect(refusalIsRetryable('invalid_check_in_token')).toBe(true)
    expect(refusalIsRetryable('queue_full')).toBe(false)
    expect(refusalIsRetryable('queue_closed')).toBe(false)
    expect(refusalIsRetryable('service_area_has_no_queue')).toBe(false)
    expect(refusalIsRetryable('already_in_queue')).toBe(false)
    expect(refusalIsRetryable('location_not_geolocated')).toBe(false)
    expect(refusalIsRetryable('barber_queue_disabled')).toBe(false)
    expect(refusalIsRetryable('entry_not_found')).toBe(false)
    expect(refusalIsRetryable('not_entry_owner')).toBe(false)
  })
})
