/**
 * OS-1 — la garde de permission de l'agenda, côté PRÉSENTATION. Elle
 * conditionne ce qui est rendu (contrat P1PRO §0bis : ce qu'un rôle ne doit
 * pas voir n'existe pas dans son DOM) ; l'autorisation reste en base (RLS,
 * private.can_manage_appointments, private.can_force_overlap,
 * private.can_view_revenue). Miroir exact des règles SQL d'OS-1.
 */

import type { ProMembershipRole } from '@/shared/data/organization'

export interface AgendaViewer {
  role: ProMembershipRole
  /** L'identité barber du compte connecté dans l'organisation, s'il en a une. */
  myBarberId: string | null
  /** memberships.can_view_revenue du compte (OS-1). */
  canViewRevenue: boolean
  /** Organisation sans équipe : aucun sélecteur, aucune entrée d'équipe. */
  isSolo: boolean
}

/** Voir tous les agendas, créer, déplacer, annuler : owner/manager/receptionist. */
export function canManageAgenda(viewer: Pick<AgendaViewer, 'role'>): boolean {
  return viewer.role === 'owner' || viewer.role === 'manager' || viewer.role === 'receptionist'
}

/**
 * Voir les agendas des AUTRES barbers (sélecteur, vue équipe) : le comptoir.
 * Un barber salarié voit le sien — « l'accès aux autres dépend du rôle »
 * (OS-1 §4) ; la RPC reçoit sa borne (p_barber_id) en plus du rendu.
 */
export function canViewTeamAgenda(viewer: Pick<AgendaViewer, 'role'>): boolean {
  return canManageAgenda(viewer)
}

/** Forcer un chevauchement : owner/manager seulement (tranché OS-1). */
export function canForceOverlap(viewer: Pick<AgendaViewer, 'role'>): boolean {
  return viewer.role === 'owner' || viewer.role === 'manager'
}

/** Régler qui voit le revenu : l'owner seul. */
export function canSetRevenueVisibility(viewer: Pick<AgendaViewer, 'role'>): boolean {
  return viewer.role === 'owner'
}

/**
 * Voir les montants : owner/manager toujours ; un barber si le patron l'a
 * autorisé ; le réceptionniste jamais (contrat P1PRO §8).
 */
export function canSeeRevenue(viewer: Pick<AgendaViewer, 'role' | 'canViewRevenue'>): boolean {
  if (viewer.role === 'owner' || viewer.role === 'manager') return true
  if (viewer.role === 'barber') return viewer.canViewRevenue
  return false
}

/** Marquer terminé / absent : le comptoir, ou le barber sur SON rendez-vous. */
export function canCloseAppointment(viewer: Pick<AgendaViewer, 'role' | 'myBarberId'>, barberId: string | null): boolean {
  if (canManageAgenda(viewer)) return true
  return viewer.myBarberId !== null && barberId === viewer.myBarberId
}

/** Bloquer du temps : le comptoir pour tous, un barber pour lui-même (RLS time_blocks). */
export function canBlockTimeFor(viewer: Pick<AgendaViewer, 'role' | 'myBarberId'>, barberId: string): boolean {
  if (canManageAgenda(viewer)) return true
  return viewer.myBarberId !== null && barberId === viewer.myBarberId
}

/** Déplacer (glisser) : le comptoir seulement — un barber ne déplace pas (RPC). */
export function canMoveAppointments(viewer: Pick<AgendaViewer, 'role'>): boolean {
  return canManageAgenda(viewer)
}

/**
 * Le barber sélectionné par défaut : un barber salarié voit SA journée ;
 * un rôle gestionnaire voit l'équipe (null = tous) ; une organisation solo
 * n'a qu'un fauteuil.
 */
export function defaultBarberSelection(viewer: AgendaViewer, barberIds: readonly string[]): string | null {
  if (viewer.isSolo) return barberIds[0] ?? null
  if (viewer.role === 'barber' && viewer.myBarberId && barberIds.includes(viewer.myBarberId)) return viewer.myBarberId
  return null
}
