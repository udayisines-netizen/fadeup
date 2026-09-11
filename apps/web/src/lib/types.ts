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
export type PlatformRole =
  | 'platform_owner'
  | 'platform_admin'
  | 'platform_support'
  | 'platform_sales'
  | 'platform_moderator'
  | 'platform_intern'

export const PLATFORM_ROLES: readonly PlatformRole[] = [
  'platform_owner',
  'platform_admin',
  'platform_support',
  'platform_sales',
  'platform_moderator',
  'platform_intern',
]

/**
 * Les droits internes, tels que `public.platform_permissions` les nomme.
 *
 * LE FRONTEND CONDITIONNE, IL N'AUTORISE PAS. Cette liste sert à ne pas
 * RENDRE ce qu'un rôle ne peut pas faire — jamais à décider qu'il le peut.
 * Chaque RPC repose la question côté serveur, et une garde d'interface
 * n'existe pas (X3 l'a prouvé deux fois).
 */
export type PlatformPermission =
  | 'crm.read'
  | 'crm.write'
  | 'crm.zone_read'
  | 'crm.field_capture'
  | 'marketplace.publish'
  | 'marketplace.withdraw'
  | 'onboarding.review'
  | 'moderation.content'
  | 'appointment.cancel'
  | 'tenant.read'
  | 'tenant.read_detail'
  | 'internal_team.read'
  | 'commercial.plan_assign'
  | 'support_view.enter'
  | 'billing.manage'
  | 'audit.read'
  | 'internal_roles.manage'
  | 'barber.delete'
