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

/**
 * FadeUp PLATFORM staff role — mirrors public.platform_role. Completely
 * distinct from MembershipRole above: a barbershop's owner/manager/
 * receptionist/barber is a role *within one tenant organization*; a
 * platform role is FadeUp's own internal staff, with no organization_id at
 * all. Never conflate the two in code, UI copy, or docs — see CLAUDE.md's
 * terminology section.
 */
export type PlatformRole = 'platform_owner' | 'platform_admin' | 'platform_support'

export const PLATFORM_ROLES: readonly PlatformRole[] = ['platform_owner', 'platform_admin', 'platform_support']
