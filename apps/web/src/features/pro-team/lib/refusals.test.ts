import { describe, expect, it } from 'vitest'
import { parseTeamRefusal, teamErrorKey } from '@/features/pro-team/lib/refusals'

describe('parseTeamRefusal — on branche sur le CODE, jamais sur le texte', () => {
  it('lit le motif dans le DETAIL PostgREST', () => {
    expect(parseTeamRefusal({ details: 'fadeup_team_refusal=already_member' })).toEqual({
      code: 'already_member',
      count: null,
    })
  })

  it('lit le compte de has_future_appointments — le nombre vient de la base', () => {
    expect(parseTeamRefusal({ details: 'fadeup_team_refusal=has_future_appointments count=3' })).toEqual({
      code: 'has_future_appointments',
      count: 3,
    })
  })

  it('ignore un motif inconnu et une erreur sans motif', () => {
    expect(parseTeamRefusal({ details: 'fadeup_team_refusal=zzz' })).toBeNull()
    expect(parseTeamRefusal({ code: '23505', message: 'duplicate key' })).toBeNull()
    expect(parseTeamRefusal(null)).toBeNull()
  })
})

describe('teamErrorKey', () => {
  it('traduit les refus nommés vers les clés de l’écran', () => {
    expect(teamErrorKey({ details: 'fadeup_team_refusal=reassign_conflict' })).toBe(
      'pro.team.errors.reassignConflict',
    )
    expect(teamErrorKey({ details: 'fadeup_team_refusal=last_owner' })).toBe('pro.team.errors.lastOwner')
  })

  it('n’expose jamais la policy : un refus d’autorisation devient « pas d’accès »', () => {
    expect(teamErrorKey({ code: '42501', details: 'fadeup_team_refusal=not_authorized' })).toBe(
      'errors.data.forbidden',
    )
  })

  it('un P0001 sans motif nommé est le refus de CAPACITÉ du plan', () => {
    expect(teamErrorKey({ code: 'P0001', message: 'the independent plan covers 1 professional(s)' })).toBe(
      'pro.team.errors.capacity',
    )
  })

  it('retombe sur la traduction générique pour le reste', () => {
    expect(teamErrorKey({ code: '42501' })).toBe('errors.data.forbidden')
    expect(teamErrorKey(new TypeError('Failed to fetch'))).toBe('errors.data.network')
    expect(teamErrorKey({})).toBe('errors.data.unknown')
  })
})
