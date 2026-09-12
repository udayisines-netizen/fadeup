import { describe, expect, it } from 'vitest'
import { teamPermissions, type TeamPermissionTarget } from '@/features/pro-team/lib/permissions'

const target = (role: TeamPermissionTarget['role'], is_me = false): TeamPermissionTarget => ({ role, is_me })

describe('teamPermissions — le miroir exact des gardes SQL', () => {
  it('un owner gère les autres rôles', () => {
    const permissions = teamPermissions('owner', target('barber'))
    expect(permissions.canChangeRole).toBe(true)
    expect(permissions.canRemove).toBe(true)
    expect(permissions.canInviteOwner).toBe(true)
  })

  it('un owner qui se regarde lui-même n’a aucune action (self_role, self_removal)', () => {
    const permissions = teamPermissions('owner', target('owner', true))
    expect(permissions.canChangeRole).toBe(false)
    expect(permissions.canRemove).toBe(false)
    expect(permissions.canToggleRevenue).toBe(false)
    // Le dernier owner d'un salon est exactement ce cas : rien ne lui est
    // proposé, donc `last_owner` ne peut pas être déclenché depuis l'écran.
  })

  it('un manager face à un OWNER ne peut ni le rétrograder ni le retirer', () => {
    const permissions = teamPermissions('manager', target('owner'))
    expect(permissions.canChangeRole).toBe(false)
    expect(permissions.canRemove).toBe(false)
    expect(permissions.canInviteOwner).toBe(false)
  })

  it('un manager gère un manager, un réceptionniste et un barber', () => {
    for (const role of ['manager', 'receptionist', 'barber'] as const) {
      const permissions = teamPermissions('manager', target(role))
      expect(permissions.canChangeRole).toBe(true)
      expect(permissions.canRemove).toBe(true)
    }
  })

  it('un manager ne se change pas lui-même de rôle', () => {
    const permissions = teamPermissions('manager', target('manager', true))
    expect(permissions.canChangeRole).toBe(false)
    expect(permissions.canRemove).toBe(false)
  })

  it('le revenu : l’OWNER seul, et seulement sur une ligne barber', () => {
    expect(teamPermissions('owner', target('barber')).canToggleRevenue).toBe(true)
    expect(teamPermissions('owner', target('manager')).canToggleRevenue).toBe(false)
    expect(teamPermissions('owner', target('receptionist')).canToggleRevenue).toBe(false)
    expect(teamPermissions('manager', target('barber')).canToggleRevenue).toBe(false)
  })

  it('receptionist et barber ne gèrent rien (ils n’ont même pas l’écran)', () => {
    for (const viewer of ['receptionist', 'barber'] as const) {
      const permissions = teamPermissions(viewer, target('barber'))
      expect(permissions).toEqual({
        canChangeRole: false,
        canRemove: false,
        canToggleRevenue: false,
        canInviteOwner: false,
      })
    }
  })
})
