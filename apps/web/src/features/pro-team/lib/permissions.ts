import type { ProMembershipRole } from '@/shared/data/organization'

/**
 * OS-2 — le MIROIR EXACT des gardes SQL de `db/migrations/…_os2_team.sql`.
 *
 * Le frontend CONDITIONNE, il n'autorise pas (P1PRO §8) : chaque règle ici
 * a sa jumelle en base (`set_team_member_role`, `remove_team_member`,
 * `set_membership_revenue_visibility`, policies `memberships_update` /
 * `memberships_delete`). Si les deux divergent, c'est la base qui a raison —
 * ce module existe pour ne RIEN RENDRE de ce que la base refuserait
 * (« capacité ou rôle absent = non rendu », jamais grisé).
 */

/** Ce dont la décision dépend — un sous-ensemble structurel de `TeamMember`. */
export interface TeamPermissionTarget {
  role: ProMembershipRole
  is_me: boolean
}

export interface TeamPermissions {
  /** « Changer le rôle » (`set_team_member_role`). */
  canChangeRole: boolean
  /** « Retirer de l'équipe » (`remove_team_member`). */
  canRemove: boolean
  /** Le commutateur « Voit le revenu » (`set_membership_revenue_visibility`). */
  canToggleRevenue: boolean
  /** Proposer le rôle `owner` dans la feuille d'invitation. */
  canInviteOwner: boolean
}

/** owner et manager gèrent l'équipe ; receptionist et barber n'ont pas l'écran. */
function manages(viewerRole: ProMembershipRole): boolean {
  return viewerRole === 'owner' || viewerRole === 'manager'
}

export function teamPermissions(
  viewerRole: ProMembershipRole,
  target: TeamPermissionTarget,
): TeamPermissions {
  const isOwner = viewerRole === 'owner'
  const handles = manages(viewerRole)
  /* Un owner ne se touche que par un owner (policy `memberships_update`
     USING) ; personne n'agit sur soi-même (`self_role`, `self_removal`). */
  const actsOnTarget = handles && !target.is_me && (target.role !== 'owner' || isOwner)

  return {
    canChangeRole: actsOnTarget,
    canRemove: actsOnTarget,
    /* Le revenu est le chiffre du patron : l'owner SEUL le règle, et
       seulement sur un `barber` — les autres rôles voient (ou non) par leur
       rôle, la RPC refuse toute autre cible (22023). */
    canToggleRevenue: isOwner && target.role === 'barber' && !target.is_me,
    canInviteOwner: isOwner,
  }
}
