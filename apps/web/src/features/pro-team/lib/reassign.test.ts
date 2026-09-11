import { describe, expect, it } from 'vitest'
import { reassignCandidates, type ReassignableMember } from '@/features/pro-team/lib/reassign'

const member = (over: Partial<ReassignableMember> & { membership_id: string }): ReassignableMember => ({
  barber_id: `barber-${over.membership_id}`,
  display_name: over.membership_id,
  is_active: true,
  is_bookable: true,
  ...over,
})

describe('reassignCandidates — le miroir de la garde target_invalid', () => {
  const removed = member({ membership_id: 'm1' })
  const active = member({ membership_id: 'm2' })
  const noSeat = member({ membership_id: 'm3', barber_id: null })
  const inactive = member({ membership_id: 'm4', is_active: false })
  const notBookable = member({ membership_id: 'm5', is_bookable: false })
  const all = [removed, active, noSeat, inactive, notBookable]

  it('ne garde que les barbers actifs et réservables', () => {
    expect(reassignCandidates(all, 'm1')).toEqual([active])
  })

  it('exclut toujours la personne retirée (target_is_self)', () => {
    expect(reassignCandidates(all, 'm2').map((row) => row.membership_id)).not.toContain('m2')
  })

  it('un membre sans fauteuil n’est jamais candidat', () => {
    expect(reassignCandidates([noSeat], 'm1')).toEqual([])
  })

  it('aucun candidat possible reste une liste vide, pas un repli inventé', () => {
    expect(reassignCandidates([removed], 'm1')).toEqual([])
  })
})
