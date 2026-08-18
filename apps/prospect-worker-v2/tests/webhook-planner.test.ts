import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  handleVerification,
  isOptOutMessage,
  parseWebhookPayload,
  verifySignature,
} from '../src/whatsapp/webhook.js'
import {
  assessSaturation,
  estimatedCostUsd,
  keywordVariantsFor,
  providerResultLimit,
  subdivideCell,
} from '../src/planner/partition.js'

const APP_SECRET = 'test-app-secret'

function sign(body: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`
}

describe('webhook verification challenge', () => {
  it('echoes the challenge for a correct token', () => {
    expect(handleVerification({ mode: 'subscribe', token: 'tok', challenge: '12345' }, 'tok')).toBe('12345')
  })

  it('rejects a wrong token', () => {
    expect(handleVerification({ mode: 'subscribe', token: 'wrong', challenge: '12345' }, 'tok')).toBeNull()
  })

  it('rejects a wrong mode', () => {
    expect(handleVerification({ mode: 'unsubscribe', token: 'tok', challenge: '12345' }, 'tok')).toBeNull()
  })

  it('rejects a missing challenge', () => {
    expect(handleVerification({ mode: 'subscribe', token: 'tok', challenge: null }, 'tok')).toBeNull()
  })
})

describe('verifySignature', () => {
  const body = JSON.stringify({ entry: [] })

  it('accepts a correct signature over the raw body', () => {
    expect(verifySignature(body, sign(body), APP_SECRET)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const signature = sign(body)
    expect(verifySignature(JSON.stringify({ entry: [{ evil: true }] }), signature, APP_SECRET)).toBe(false)
  })

  it('rejects a wrong secret', () => {
    expect(verifySignature(body, sign(body), 'different-secret')).toBe(false)
  })

  it('rejects a missing or malformed signature header', () => {
    expect(verifySignature(body, null, APP_SECRET)).toBe(false)
    expect(verifySignature(body, 'sha1=abc', APP_SECRET)).toBe(false)
    expect(verifySignature(body, 'garbage', APP_SECRET)).toBe(false)
  })

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch; the guard must handle it.
    expect(verifySignature(body, 'sha256=abcd', APP_SECRET)).toBe(false)
  })

  it('works on a Buffer body, as the HTTP layer supplies it', () => {
    expect(verifySignature(Buffer.from(body), sign(body), APP_SECRET)).toBe(true)
  })
})

describe('parseWebhookPayload', () => {
  it('parses delivery statuses', () => {
    const events = parseWebhookPayload({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '123' },
                statuses: [
                  {
                    id: 'wamid.ABC',
                    status: 'delivered',
                    timestamp: '1755000000',
                    recipient_id: '33600000000',
                    biz_opaque_callback_data: 'idem-1',
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('status')
    if (event.kind === 'status') {
      expect(event.providerMessageId).toBe('wamid.ABC')
      expect(event.status).toBe('delivered')
      expect(event.idempotencyKey).toBe('idem-1')
      // The event id is (message, status), so a redelivery is idempotent
      // but a LATER status for the same message is still processed.
      expect(event.providerEventId).toBe('wamid.ABC:delivered')
      expect(event.occurredAt.getUTCFullYear()).toBe(2025)
    }
  })

  it('parses a failed status with its error details', () => {
    const events = parseWebhookPayload({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.FAIL',
                    status: 'failed',
                    timestamp: '1755000000',
                    errors: [{ code: 131026, title: 'Message undeliverable' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const event = events[0]!
    expect(event.kind).toBe('status')
    if (event.kind === 'status') {
      expect(event.errorCode).toBe('131026')
      expect(event.errorMessage).toBe('Message undeliverable')
    }
  })

  it('parses inbound messages', () => {
    const events = parseWebhookPayload({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '999' },
                messages: [{ id: 'wamid.IN', from: '33612345678', timestamp: '1755000000', text: { body: 'Oui, intéressé' } }],
              },
            },
          ],
        },
      ],
    })

    const event = events[0]!
    expect(event.kind).toBe('inbound')
    if (event.kind === 'inbound') {
      expect(event.fromWaId).toBe('33612345678')
      expect(event.body).toBe('Oui, intéressé')
      expect(event.phoneNumberId).toBe('999')
    }
  })

  it('returns no events for a malformed payload instead of throwing', () => {
    // A 500 here would make Meta retry the same bad payload for days.
    expect(parseWebhookPayload(null)).toEqual([])
    expect(parseWebhookPayload({})).toEqual([])
    expect(parseWebhookPayload({ entry: 'not-an-array' })).toEqual([])
    expect(parseWebhookPayload({ entry: [{ changes: [{ value: {} }] }] })).toEqual([])
    expect(parseWebhookPayload({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] })).toEqual([])
  })

  it('ignores status values it does not model', () => {
    const events = parseWebhookPayload({
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'deleted' }] } }] }],
    })
    expect(events).toEqual([])
  })

  it('falls back to now() rather than 1970 for a missing timestamp', () => {
    const events = parseWebhookPayload({
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.T', status: 'sent' }] } }] }],
    })
    const event = events[0]!
    if (event.kind === 'status') {
      expect(event.occurredAt.getUTCFullYear()).toBeGreaterThan(2020)
    }
  })
})

describe('isOptOutMessage', () => {
  it('matches the bare STOP convention', () => {
    expect(isOptOutMessage('STOP')).toBe(true)
    expect(isOptOutMessage('stop')).toBe(true)
    expect(isOptOutMessage('Stop.')).toBe(true)
  })

  it('matches French opt-out phrasings, accented or not', () => {
    expect(isOptOutMessage('Ne plus me contacter svp')).toBe(true)
    expect(isOptOutMessage('arrêtez de m’écrire')).toBe(true)
    expect(isOptOutMessage('arretez')).toBe(true)
    expect(isOptOutMessage('désabonner')).toBe(true)
  })

  it('matches English opt-out phrasings', () => {
    expect(isOptOutMessage('please remove me')).toBe(true)
    expect(isOptOutMessage("don't contact me again")).toBe(true)
    expect(isOptOutMessage('UNSUBSCRIBE')).toBe(true)
  })

  it('does not treat an ordinary reply as an opt-out', () => {
    expect(isOptOutMessage('Oui, ça m’intéresse')).toBe(false)
    expect(isOptOutMessage('Yes please, tell me more')).toBe(false)
    expect(isOptOutMessage(null)).toBe(false)
    expect(isOptOutMessage('')).toBe(false)
  })

  it('does not classify sentiment — only opt-out is deterministic', () => {
    // A negative reply is NOT an opt-out; classifying it is a human
    // decision made in /platform (spec §34).
    expect(isOptOutMessage('Non merci, pas intéressé')).toBe(false)
  })
})

describe('search planner partitioning', () => {
  it('subdivides a cell into four overlapping children that cover the parent', () => {
    const parent = { centerLatitude: 48.8566, centerLongitude: 2.3522, radiusKm: 10 }
    const children = subdivideCell(parent)

    expect(children).toHaveLength(4)
    for (const child of children) {
      // Deliberate overlap: r*0.6 rather than r/2, because four r/2 circles
      // leave uncovered gaps near the parent's edge.
      expect(child.radiusKm).toBeCloseTo(6, 5)
      expect(Math.abs(child.centerLatitude - parent.centerLatitude)).toBeLessThan(1)
    }
    // The four centres must be distinct.
    expect(new Set(children.map((c) => `${c.centerLatitude},${c.centerLongitude}`)).size).toBe(4)
  })

  it('keeps subdivided cells inside valid coordinate bounds', () => {
    for (const child of subdivideCell({ centerLatitude: 89.9, centerLongitude: 179.9, radiusKm: 500 })) {
      expect(child.centerLatitude).toBeGreaterThanOrEqual(-90)
      expect(child.centerLatitude).toBeLessThanOrEqual(90)
      expect(child.centerLongitude).toBeGreaterThanOrEqual(-180)
      expect(child.centerLongitude).toBeLessThanOrEqual(180)
    }
  })

  it('is deterministic', () => {
    const cell = { centerLatitude: 45.75, centerLongitude: 4.85, radiusKm: 8 }
    expect(subdivideCell(cell)).toEqual(subdivideCell(cell))
  })
})

describe('assessSaturation', () => {
  it('does not saturate on an empty partition', () => {
    const verdict = assessSaturation({ rawResults: 0, providerResultLimit: 20, providerReportedMore: false, uniqueResults: 0 })
    expect(verdict.saturated).toBe(false)
    expect(verdict.shouldSubdivide).toBe(false)
  })

  it('does not saturate on a complete, under-limit result set', () => {
    const verdict = assessSaturation({ rawResults: 7, providerResultLimit: 20, providerReportedMore: false, uniqueResults: 7 })
    expect(verdict.saturated).toBe(false)
    expect(verdict.reason).toBe('complete_result_set')
  })

  it('saturates and subdivides at the provider result limit with good yield', () => {
    const verdict = assessSaturation({ rawResults: 20, providerResultLimit: 20, providerReportedMore: false, uniqueResults: 18 })
    expect(verdict.saturated).toBe(true)
    expect(verdict.shouldSubdivide).toBe(true)
  })

  it('saturates but REFUSES to subdivide a low-yield partition', () => {
    // The rule that stops a naive quadtree burning an entire API budget
    // re-discovering the same shops.
    const verdict = assessSaturation({ rawResults: 20, providerResultLimit: 20, providerReportedMore: false, uniqueResults: 1 })
    expect(verdict.saturated).toBe(true)
    expect(verdict.shouldSubdivide).toBe(false)
    expect(verdict.reason).toContain('low_yield')
  })

  it('saturates when the provider says more pages exist', () => {
    const verdict = assessSaturation({ rawResults: 5, providerResultLimit: 20, providerReportedMore: true, uniqueResults: 5 })
    expect(verdict.saturated).toBe(true)
    expect(verdict.shouldSubdivide).toBe(true)
  })
})

describe('provider limits, keywords and cost', () => {
  it('knows the documented per-response ceilings', () => {
    expect(providerResultLimit('google_places')).toBe(20)
    expect(providerResultLimit('geoapify')).toBe(100)
    // Overpass returns everything matching, so it never truncates.
    expect(providerResultLimit('osm')).toBeGreaterThan(1000)
  })

  it('returns locale-appropriate keyword variants', () => {
    expect(keywordVariantsFor('FR')).toContain('barbier')
    expect(keywordVariantsFor('GB')).toContain('barber')
    expect(keywordVariantsFor('DE')).toContain('herrenfriseur')
  })

  it('honours explicit keywords over the country defaults', () => {
    expect(keywordVariantsFor('FR', ['coiffeur afro'])).toEqual(['coiffeur afro'])
  })

  it('falls back to a sensible default for an unlisted country', () => {
    expect(keywordVariantsFor('ZZ').length).toBeGreaterThan(0)
  })

  it('estimates cost only where a price is actually published', () => {
    expect(estimatedCostUsd('google_places', 100)).toBeCloseTo(3.2, 5)
    // NULL, not 0 — an unknown price must not be reported as free.
    expect(estimatedCostUsd('osm', 100)).toBeNull()
    expect(estimatedCostUsd('geoapify', 100)).toBeNull()
  })
})
