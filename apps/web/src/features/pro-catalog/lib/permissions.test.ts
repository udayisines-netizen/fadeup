import { describe, expect, it } from 'vitest'
import { canCreateCategory, catalogPermissions } from './permissions'

describe('catalogPermissions', () => {
  it('owner et manager font tout', () => {
    for (const role of ['owner', 'manager'] as const) {
      expect(catalogPermissions(role)).toEqual({
        canWrite: true,
        canPrice: true,
        canArchive: true,
        canDelete: true,
        canAssign: true,
      })
    }
  })

  it('un barber écrit le catalogue mais jamais le prix', () => {
    expect(catalogPermissions('barber')).toEqual({
      canWrite: true,
      canPrice: false,
      canArchive: false,
      canDelete: false,
      canAssign: false,
    })
  })

  it("un réceptionniste n'écrit rien — il lit seulement", () => {
    expect(catalogPermissions('receptionist')).toEqual({
      canWrite: false,
      canPrice: false,
      canArchive: false,
      canDelete: false,
      canAssign: false,
    })
  })

  it('créer une catégorie reste réservé à owner/manager', () => {
    expect(canCreateCategory('owner')).toBe(true)
    expect(canCreateCategory('manager')).toBe(true)
    expect(canCreateCategory('barber')).toBe(false)
    expect(canCreateCategory('receptionist')).toBe(false)
  })
})
