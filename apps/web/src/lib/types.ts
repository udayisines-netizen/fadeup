/** Org-scoped role for a membership row. Mirrors public.membership_role in the database. */
export type MembershipRole = 'owner' | 'manager' | 'receptionist' | 'barber'

export const MEMBERSHIP_ROLES: readonly MembershipRole[] = [
  'owner',
  'manager',
  'receptionist',
  'barber',
]

export function isMembershipRole(value: string): value is MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(value)
}
