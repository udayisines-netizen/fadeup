import { describe, expect, it } from 'vitest'
import { formatMinimalName } from '@/features/pro-queue/lib/minimalName'

describe('minimisation B2 côté pro — prénom et initiale seulement', () => {
  it('réduit un nom complet à prénom + initiale', () => {
    expect(formatMinimalName('Karim Benzema')).toBe('Karim B.')
    expect(formatMinimalName('  Sofiane   El Amrani ')).toBe('Sofiane E.')
  })

  it('un prénom seul reste tel quel', () => {
    expect(formatMinimalName('Karim')).toBe('Karim')
  })

  it('ne rend jamais le nom de famille complet', () => {
    expect(formatMinimalName('Jean Dupont')).not.toContain('Dupont')
  })

  it('vide reste vide', () => {
    expect(formatMinimalName('   ')).toBe('')
  })
})
