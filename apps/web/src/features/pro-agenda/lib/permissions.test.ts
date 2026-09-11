import { describe, expect, it } from 'vitest'
import {
  canBlockTimeFor,
  canCloseAppointment,
  canForceOverlap,
  canManageAgenda,
  canMoveAppointments,
  canSeeRevenue,
  canSetRevenueVisibility,
  canViewTeamAgenda,
  defaultBarberSelection,
  type AgendaViewer,
} from './permissions'

const viewer = (partial: Partial<AgendaViewer>): AgendaViewer => ({
  role: 'barber',
  myBarberId: null,
  canViewRevenue: false,
  isSolo: false,
  ...partial,
})

describe('OS-1 permissions — miroir des règles SQL', () => {
  it('gérer l’agenda : owner, manager, réceptionniste ; pas le barber', () => {
    expect(canManageAgenda(viewer({ role: 'owner' }))).toBe(true)
    expect(canManageAgenda(viewer({ role: 'manager' }))).toBe(true)
    expect(canManageAgenda(viewer({ role: 'receptionist' }))).toBe(true)
    expect(canManageAgenda(viewer({ role: 'barber' }))).toBe(false)
    expect(canMoveAppointments(viewer({ role: 'barber' }))).toBe(false)
  })

  it('forcer : owner et manager seulement (le réceptionniste crée mais ne force pas)', () => {
    expect(canForceOverlap(viewer({ role: 'owner' }))).toBe(true)
    expect(canForceOverlap(viewer({ role: 'manager' }))).toBe(true)
    expect(canForceOverlap(viewer({ role: 'receptionist' }))).toBe(false)
    expect(canForceOverlap(viewer({ role: 'barber' }))).toBe(false)
  })

  it('revenu : défaut « ne voit pas » pour un barber ; réglé par l’owner seul ; jamais le réceptionniste', () => {
    expect(canSeeRevenue(viewer({ role: 'barber' }))).toBe(false)
    expect(canSeeRevenue(viewer({ role: 'barber', canViewRevenue: true }))).toBe(true)
    expect(canSeeRevenue(viewer({ role: 'receptionist', canViewRevenue: true }))).toBe(false)
    expect(canSeeRevenue(viewer({ role: 'owner' }))).toBe(true)
    expect(canSeeRevenue(viewer({ role: 'manager' }))).toBe(true)
    expect(canSetRevenueVisibility(viewer({ role: 'owner' }))).toBe(true)
    expect(canSetRevenueVisibility(viewer({ role: 'manager' }))).toBe(false)
  })

  it('terminer / absent : le comptoir, ou le barber sur SON rendez-vous', () => {
    expect(canCloseAppointment(viewer({ role: 'barber', myBarberId: 'b1' }), 'b1')).toBe(true)
    expect(canCloseAppointment(viewer({ role: 'barber', myBarberId: 'b1' }), 'b2')).toBe(false)
    expect(canCloseAppointment(viewer({ role: 'barber', myBarberId: null }), 'b1')).toBe(false)
    expect(canCloseAppointment(viewer({ role: 'receptionist' }), 'b2')).toBe(true)
    expect(canBlockTimeFor(viewer({ role: 'barber', myBarberId: 'b1' }), 'b1')).toBe(true)
    expect(canBlockTimeFor(viewer({ role: 'barber', myBarberId: 'b1' }), 'b2')).toBe(false)
  })

  it('sélection par défaut : un barber voit le sien, un gestionnaire voit l’équipe, un solo son seul fauteuil', () => {
    const ids = ['b1', 'b2']
    expect(defaultBarberSelection(viewer({ role: 'barber', myBarberId: 'b2' }), ids)).toBe('b2')
    expect(defaultBarberSelection(viewer({ role: 'barber', myBarberId: 'zz' }), ids)).toBeNull()
    expect(defaultBarberSelection(viewer({ role: 'owner' }), ids)).toBeNull()
    expect(defaultBarberSelection(viewer({ role: 'owner', isSolo: true }), ['solo'])).toBe('solo')
  })
})

describe('canViewTeamAgenda', () => {
  it('ouvre le sélecteur au comptoir seulement — un barber voit le sien', () => {
    expect(canViewTeamAgenda({ role: 'owner' })).toBe(true)
    expect(canViewTeamAgenda({ role: 'manager' })).toBe(true)
    expect(canViewTeamAgenda({ role: 'receptionist' })).toBe(true)
    expect(canViewTeamAgenda({ role: 'barber' })).toBe(false)
  })
})
