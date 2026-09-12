/**
 * OS-2 — qui peut reprendre les rendez-vous d'un membre qu'on retire.
 *
 * Miroir exact de la garde `target_invalid` de `remove_team_member` : un
 * barber de CETTE organisation, actif et réservable — et jamais la personne
 * retirée (`target_is_self`). Aucune autre liste n'est proposée : un
 * réceptionniste ou un membre sans fauteuil ne peut pas recevoir un
 * rendez-vous.
 */

export interface ReassignableMember {
  membership_id: string
  /** `null` = pas de fauteuil (manager, réceptionniste) : jamais candidat. */
  barber_id: string | null
  display_name: string
  is_active: boolean
  is_bookable: boolean
}

export function reassignCandidates<T extends ReassignableMember>(
  members: readonly T[],
  removedMembershipId: string,
): T[] {
  return members.filter(
    (member) =>
      member.membership_id !== removedMembershipId &&
      member.barber_id !== null &&
      member.is_active &&
      member.is_bookable,
  )
}
