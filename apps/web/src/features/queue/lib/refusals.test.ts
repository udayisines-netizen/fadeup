import { describe, expect, it } from 'vitest'
import frQueue from '@/shared/i18n/locales/fr/queue.json'
import enQueue from '@/shared/i18n/locales/en/queue.json'
import {
  QUEUE_REFUSAL_CODES,
  parseQueueRefusal,
  refusalIsRetryable,
  refusalMessageKey,
} from '@/features/queue/lib/refusals'

describe('les huit motifs de refus de join_public_queue', () => {
  it('sont exactement huit', () => {
    expect(QUEUE_REFUSAL_CODES).toHaveLength(8)
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

  it('produit huit clés de message DISTINCTES', () => {
    const keys = QUEUE_REFUSAL_CODES.map(refusalMessageKey)
    expect(new Set(keys).size).toBe(8)
  })

  it.each(['fr', 'en'] as const)('a huit messages traduits distincts en %s', (lng) => {
    const bundle = lng === 'fr' ? frQueue : enQueue
    const messages = QUEUE_REFUSAL_CODES.map((code) => bundle.refusal[code])
    for (const message of messages) {
      expect(message).toBeTruthy()
      expect(typeof message).toBe('string')
    }
    // « Trop loin » n'est pas « QR invalide » n'est pas « file pleine » :
    // huit textes réellement différents, pas un générique dupliqué.
    expect(new Set(messages).size).toBe(8)
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
  })
})
