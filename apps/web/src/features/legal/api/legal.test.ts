import { describe, expect, it } from 'vitest'
import { parseProfessionalRef, parseWithdrawalRefusal } from './legal'

describe('parseProfessionalRef', () => {
  it('accepte le handle nu, @handle, et les espaces', () => {
    expect(parseProfessionalRef('demo.moussa.diakite')).toBe('demo.moussa.diakite')
    expect(parseProfessionalRef('@demo.moussa.diakite')).toBe('demo.moussa.diakite')
    expect(parseProfessionalRef('  demo.moussa.diakite  ')).toBe('demo.moussa.diakite')
  })

  it("accepte l'URL complète de la fiche, avec ou sans requête", () => {
    expect(parseProfessionalRef('https://fade-up.com/pro/demo.moussa.diakite')).toBe('demo.moussa.diakite')
    expect(parseProfessionalRef('fade-up.com/pro/demo.moussa.diakite?x=1#services')).toBe('demo.moussa.diakite')
  })

  it("accepte l'URL de la page d'information (?pro=…) portée par l'e-mail", () => {
    expect(parseProfessionalRef('https://fade-up.com/professionals-data?pro=demo.moussa.diakite&t=abc')).toBe(
      'demo.moussa.diakite',
    )
  })

  it("accepte l'uuid porté par l'e-mail d'une fiche sans handle", () => {
    expect(parseProfessionalRef('123e4567-e89b-12d3-a456-426614174000')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    )
  })

  it('décode le handle encodé dans une URL', () => {
    expect(parseProfessionalRef('https://fade-up.com/pro/demo%2Emoussa')).toBe('demo.moussa')
  })

  it('rend null pour le vide', () => {
    expect(parseProfessionalRef('')).toBeNull()
    expect(parseProfessionalRef('   ')).toBeNull()
    expect(parseProfessionalRef('@')).toBeNull()
  })
})

describe('parseWithdrawalRefusal', () => {
  it('lit le code sur DETAIL, jamais sur le texte', () => {
    expect(parseWithdrawalRefusal({ details: 'fadeup_withdrawal_refusal=professional_is_claimed' })).toBe(
      'professional_is_claimed',
    )
    expect(parseWithdrawalRefusal({ details: 'fadeup_withdrawal_refusal=profile_not_published' })).toBe(
      'profile_not_published',
    )
  })

  it('rend null pour un code inconnu ou une erreur quelconque', () => {
    expect(parseWithdrawalRefusal({ details: 'fadeup_withdrawal_refusal=quelque_chose' })).toBeNull()
    expect(parseWithdrawalRefusal({ message: 'boom' })).toBeNull()
    expect(parseWithdrawalRefusal(null)).toBeNull()
  })
})
