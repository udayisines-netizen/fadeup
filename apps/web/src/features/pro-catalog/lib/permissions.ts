/**
 * OS-2 — la garde de permission du catalogue, côté PRÉSENTATION. Miroir
 * EXACT de `private.assert_catalog_author` et des gardes `has_org_role` des
 * RPC d'archivage/suppression/affectation (migration
 * `20260911110100_os2_service_catalog.sql`).
 *
 * Elle CONDITIONNE ce qui est rendu (P1PRO §0bis : une capacité absente
 * n'existe pas dans le DOM, elle n'est ni grisée ni cadenassée) ; elle
 * n'autorise rien. L'autorité reste la base : chaque RPC refuse avec un
 * motif nommé, et l'écran affiche ce refus.
 */

import type { ProMembershipRole } from '@/shared/data/organization'

export interface CatalogPermissions {
  /** Créer et modifier un service : owner/manager et barber. */
  canWrite: boolean
  /** Fixer un prix : owner/manager SEULEMENT (garde serveur qui refuse). */
  canPrice: boolean
  /** Archiver / restaurer : owner/manager. */
  canArchive: boolean
  /** Supprimer définitivement (et seulement sans historique) : owner/manager. */
  canDelete: boolean
  /** Choisir qui réalise le service : owner/manager. */
  canAssign: boolean
}

/**
 * `role` à `null` = organisation pas encore résolue. On ne DEVINE pas : tant
 * qu'on ne sait pas, rien n'est permis, donc rien n'est rendu. Deviner
 * « barber » afficherait « Créer un service » à un réceptionniste pendant le
 * chargement, et la RPC le refuserait ensuite.
 */
export function catalogPermissions(role: ProMembershipRole | null): CatalogPermissions {
  const isManager = role === 'owner' || role === 'manager'
  // Le réceptionniste LIT le catalogue (list_organization_services accepte
  // tout membre) mais n'écrit rien : ce n'est pas son métier.
  const isBarber = role === 'barber'
  return {
    canWrite: isManager || isBarber,
    canPrice: isManager,
    canArchive: isManager,
    canDelete: isManager,
    canAssign: isManager,
  }
}

/**
 * `create_service_category` exige owner/manager (même garde `has_org_role`).
 * Un barber classe donc son service dans une catégorie EXISTANTE, il n'en
 * crée pas : l'option « Nouvelle catégorie… » ne lui est pas rendue.
 */
export function canCreateCategory(role: ProMembershipRole | null): boolean {
  return role === 'owner' || role === 'manager'
}
