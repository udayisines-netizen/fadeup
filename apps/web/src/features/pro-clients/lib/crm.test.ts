import { describe, expect, it } from 'vitest'
import {
  DELETED_CUSTOMER_TOKEN,
  displayCustomerName,
  frequencyLabel,
  historyKindKey,
  historyStatusKey,
  isCustomerSegment,
  isMissingCustomer,
  lapsedSummary,
  noteRefusalMessageKey,
  overdueDays,
  parseCrmRefusal,
  parseNoteRefusal,
  totalPages,
} from './crm'

describe('frequencyLabel', () => {
  it('dit « jamais venu » et rien d’autre quand aucune prestation n’est terminée', () => {
    expect(frequencyLabel({ averageIntervalDays: null, daysSinceLast: null, completedCount: 0, lastCompletedAt: null })).toEqual([
      { key: 'pro.clients.row.never' },
    ])
  })

  it('n’invente pas de rythme sur un client venu une seule fois', () => {
    const parts = frequencyLabel({
      averageIntervalDays: null,
      daysSinceLast: 12,
      completedCount: 1,
      lastCompletedAt: '2026-08-30T10:00:00Z',
    })
    expect(parts).toEqual([
      { key: 'pro.clients.row.visits', params: { count: 1 } },
      { key: 'pro.clients.row.lastVisit', params: { days: 12 } },
    ])
    expect(parts.some((part) => part.key === 'pro.clients.row.cycle')).toBe(false)
  })

  it('ajoute le rythme dès que le serveur en observe un', () => {
    expect(
      frequencyLabel({
        averageIntervalDays: 21.4,
        daysSinceLast: 9,
        completedCount: 3,
        lastCompletedAt: '2026-09-02T10:00:00Z',
      }),
    ).toEqual([
      { key: 'pro.clients.row.visits', params: { count: 3 } },
      { key: 'pro.clients.row.lastVisit', params: { days: 9 } },
      { key: 'pro.clients.row.cycle', params: { days: 21 } },
    ])
  })

  it('dit « venu aujourd’hui » à zéro jour, jamais « il y a 0 j »', () => {
    const parts = frequencyLabel({
      averageIntervalDays: 14,
      daysSinceLast: 0,
      completedCount: 5,
      lastCompletedAt: '2026-09-11T08:00:00Z',
    })
    expect(parts[1]).toEqual({ key: 'pro.clients.row.lastVisitToday' })
  })

  it('omet la dernière visite quand le serveur ne donne pas l’écart', () => {
    const parts = frequencyLabel({
      averageIntervalDays: null,
      daysSinceLast: null,
      completedCount: 2,
      lastCompletedAt: '2026-07-01T10:00:00Z',
    })
    expect(parts).toEqual([{ key: 'pro.clients.row.visits', params: { count: 2 } }])
  })

  it('tait un rythme qui s’arrondirait à zéro jour', () => {
    const parts = frequencyLabel({
      averageIntervalDays: 0.2,
      daysSinceLast: 1,
      completedCount: 4,
      lastCompletedAt: '2026-09-10T10:00:00Z',
    })
    expect(parts.some((part) => part.key === 'pro.clients.row.cycle')).toBe(false)
  })
})

describe('overdueDays', () => {
  it('ne calcule rien quand le serveur ne déclare pas le client en retard', () => {
    expect(overdueDays({ daysSinceLast: 40, averageIntervalDays: 21, isLapsed: false })).toBeNull()
  })

  it('rend l’écart au rythme observé', () => {
    expect(overdueDays({ daysSinceLast: 40, averageIntervalDays: 21, isLapsed: true })).toBe(19)
  })

  it('arrondit un rythme fractionnaire', () => {
    expect(overdueDays({ daysSinceLast: 30, averageIntervalDays: 20.6, isLapsed: true })).toBe(9)
  })

  it('rend null sur un écart négatif ou nul', () => {
    expect(overdueDays({ daysSinceLast: 10, averageIntervalDays: 21, isLapsed: true })).toBeNull()
    expect(overdueDays({ daysSinceLast: 21, averageIntervalDays: 21, isLapsed: true })).toBeNull()
  })

  it('rend null sans rythme ou sans dernière visite', () => {
    expect(overdueDays({ daysSinceLast: 40, averageIntervalDays: null, isLapsed: true })).toBeNull()
    expect(overdueDays({ daysSinceLast: null, averageIntervalDays: 21, isLapsed: true })).toBeNull()
  })
})

describe('lapsedSummary', () => {
  it('reste muet tant que le compte serveur est inconnu', () => {
    expect(lapsedSummary({ segment: 'all', lapsedTotal: null })).toEqual({ visible: false, count: 0 })
  })

  it('reste muet à zéro — pas de rappel sans personne à rappeler', () => {
    expect(lapsedSummary({ segment: 'all', lapsedTotal: 0 })).toEqual({ visible: false, count: 0 })
  })

  it('se rend sur les autres segments avec le compte serveur', () => {
    expect(lapsedSummary({ segment: 'regular', lapsedTotal: 4 })).toEqual({ visible: true, count: 4 })
    expect(lapsedSummary({ segment: 'verified', lapsedTotal: 1 })).toEqual({ visible: true, count: 1 })
  })

  it('ne se rend pas sur le segment « non revenus » — on y est déjà', () => {
    expect(lapsedSummary({ segment: 'lapsed', lapsedTotal: 7 })).toEqual({ visible: false, count: 7 })
  })
})

describe('totalPages', () => {
  it('rend au moins une page, même vide', () => {
    expect(totalPages(0, 50)).toBe(1)
  })

  it('arrondit à la page supérieure', () => {
    expect(totalPages(50, 50)).toBe(1)
    expect(totalPages(51, 50)).toBe(2)
    expect(totalPages(123, 50)).toBe(3)
  })
})

describe('segments et libellés', () => {
  it('ferme l’union des segments', () => {
    expect(isCustomerSegment('lapsed')).toBe(true)
    expect(isCustomerSegment('vip')).toBe(false)
  })

  it('ne fabrique pas de libellé pour un état inconnu', () => {
    expect(historyStatusKey('completed')).toBe('pro.clients.detail.status.completed')
    expect(historyStatusKey('teleported')).toBeNull()
    expect(historyKindKey('queue')).toBe('pro.clients.detail.historyQueue')
    expect(historyKindKey('smoke_signal')).toBeNull()
  })
})

describe('refus nommés', () => {
  it('lit le code CRM dans error.details', () => {
    expect(parseCrmRefusal({ details: 'fadeup_crm_refusal=not_authorized' })).toBe('not_authorized')
    expect(parseCrmRefusal({ details: 'fadeup_crm_refusal=unknown_segment' })).toBe('unknown_segment')
    expect(parseCrmRefusal({ details: 'fadeup_crm_refusal=teapot' })).toBeNull()
    expect(parseCrmRefusal({ message: 'boom' })).toBeNull()
    expect(parseCrmRefusal(null)).toBeNull()
  })

  it('lit le code des notes et lui donne un message distinct', () => {
    expect(parseNoteRefusal({ details: 'fadeup_customer_notes_refusal=body_too_long' })).toBe('body_too_long')
    expect(noteRefusalMessageKey('body_too_long')).toBe('pro.clients.notes.tooLong')
    expect(noteRefusalMessageKey('not_authorized')).toBe('pro.clients.errors.noteForbidden')
    expect(noteRefusalMessageKey('empty_body')).toBe('pro.clients.notes.required')
    expect(noteRefusalMessageKey('anonymous')).toBe('errors.data.auth')
  })

  it('confond fiche refusée et fiche inexistante — un salon n’apprend rien d’un autre', () => {
    expect(isMissingCustomer({ code: '42501' })).toBe(true)
    expect(isMissingCustomer({ details: 'fadeup_crm_refusal=not_authorized' })).toBe(true)
    expect(isMissingCustomer({ code: 'PGRST116' })).toBe(true)
    expect(isMissingCustomer({ code: '23505' })).toBe(false)
    expect(isMissingCustomer(undefined)).toBe(false)
  })
})

describe('displayCustomerName', () => {
  it('reconnaît le jeton d’effacement B5, exactement', () => {
    expect(displayCustomerName(DELETED_CUSTOMER_TOKEN)).toEqual({ deleted: true })
    expect(displayCustomerName('[deleted]')).toEqual({ deleted: true })
  })

  it('traite l’absence de nom comme un effacement, jamais comme un nom vide', () => {
    expect(displayCustomerName(null)).toEqual({ deleted: true })
    expect(displayCustomerName('')).toEqual({ deleted: true })
    expect(displayCustomerName('   ')).toEqual({ deleted: true })
  })

  it('ne fait AUCUNE correspondance approximative', () => {
    expect(displayCustomerName('[Deleted]')).toEqual({ deleted: false, name: '[Deleted]' })
    expect(displayCustomerName('deleted')).toEqual({ deleted: false, name: 'deleted' })
    expect(displayCustomerName('Marc [deleted]')).toEqual({ deleted: false, name: 'Marc [deleted]' })
  })

  it('rend tout autre nom tel quel', () => {
    expect(displayCustomerName('Karim B.')).toEqual({ deleted: false, name: 'Karim B.' })
  })
})
