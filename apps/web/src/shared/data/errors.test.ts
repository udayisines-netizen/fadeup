import { describe, expect, it } from 'vitest'
import { errorMessageKey, toAppError } from '@/shared/data/errors'

describe('toAppError', () => {
  it('42501 (RLS) → forbidden — un appel qui n’aurait pas dû partir', () => {
    expect(toAppError({ code: '42501', message: 'permission denied' })).toEqual({ kind: 'forbidden' })
  })

  it('23505 → conflict avec détail', () => {
    const error = toAppError({ code: '23505', message: 'duplicate', details: 'Key (x) exists' })
    expect(error.kind).toBe('conflict')
  })

  it('23514 → validation', () => {
    expect(toAppError({ code: '23514', message: 'check violation' }).kind).toBe('validation')
  })

  it('PGRST116 → not-found', () => {
    expect(toAppError({ code: 'PGRST116', message: 'no rows' })).toEqual({ kind: 'not-found' })
  })

  it('TypeError réseau → network', () => {
    expect(toAppError(new TypeError('Failed to fetch'))).toEqual({ kind: 'network' })
  })

  it('401 → auth', () => {
    expect(toAppError({ status: 401, message: 'JWT expired' })).toEqual({ kind: 'auth' })
  })

  it('inconnu → unknown en conservant le brut', () => {
    const raw = { weird: true }
    const error = toAppError(raw)
    expect(error.kind).toBe('unknown')
  })

  it('chaque erreur a une clé i18n — le texte brut ne remonte jamais', () => {
    for (const raw of [
      { code: '42501' },
      { code: '23505', details: 'x' },
      { code: '23514' },
      { code: 'PGRST116' },
      new TypeError('fetch failed'),
      { status: 401 },
      { nonsense: 1 },
    ]) {
      const key = errorMessageKey(toAppError(raw))
      expect(key).toMatch(/^errors\.data\./)
    }
  })
})
