import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { PlatformRole } from '@/lib/types'
import type { ProfessionalApplicationStatus } from '@/lib/queries/professional-applications'

/**
 * The authoritative post-authentication access snapshot — one round trip,
 * one source of truth, wrapping public.get_my_access().
 *
 * Every entry point uses this instead of assembling its own picture from
 * three separate queries, which is how three surfaces drift into three
 * subtly different ideas of who someone is.
 *
 * What it deliberately is NOT: a client-side authorization decision. Nothing
 * here gates access. `platformAvailable` says the database has a
 * platform_members row for this user; RequirePlatformRole still re-resolves
 * it, and every platform table's RLS re-resolves it again on every single
 * query. This exists so the UI can route someone sensibly, not so it can let
 * them in.
 *
 * Identically shaped whether the session came from a password, from Google
 * or from Apple — the resolver reads memberships and platform_members and
 * never looks at the provider.
 */

export interface MyAccess {
  userId: string
  /** From public.platform_members. Null for everyone who is not FadeUp staff. */
  platformRole: PlatformRole | null
  platformAvailable: boolean
  /** From public.memberships. */
  professionalAvailable: boolean
  organizationCount: number
  ownedOrganizationCount: number
  /** Every authenticated identity may use the customer experience. */
  customerAvailable: boolean
  customerProfileExists: boolean
  customerOnboardingCompleted: boolean
  applicationStatus: ProfessionalApplicationStatus | null
  /**
   * Which door this account originally signed up through. A ROUTING HINT
   * with no authorization meaning whatsoever — see the migration comment.
   */
  signupIntent: string | null
}

interface MyAccessRow {
  user_id: string
  platform_role: PlatformRole | null
  platform_available: boolean
  professional_available: boolean
  organization_count: number
  owned_organization_count: number
  customer_available: boolean
  customer_profile_exists: boolean
  customer_onboarding_completed: boolean
  application_status: ProfessionalApplicationStatus | null
  signup_intent: string | null
}

function mapAccess(row: MyAccessRow): MyAccess {
  return {
    userId: row.user_id,
    platformRole: row.platform_role,
    platformAvailable: row.platform_available,
    professionalAvailable: row.professional_available,
    organizationCount: row.organization_count,
    ownedOrganizationCount: row.owned_organization_count,
    customerAvailable: row.customer_available,
    customerProfileExists: row.customer_profile_exists,
    customerOnboardingCompleted: row.customer_onboarding_completed,
    applicationStatus: row.application_status,
    signupIntent: row.signup_intent,
  }
}

export const myAccessKey = (userId: string | undefined) => ['my-access', userId] as const

export function useMyAccess(userId: string | undefined) {
  return useQuery({
    queryKey: myAccessKey(userId),
    queryFn: async (): Promise<MyAccess | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_my_access')
      if (error) throw error
      const rows = (data ?? []) as MyAccessRow[]
      // Zero rows is the documented answer for an unauthenticated caller.
      return rows.length > 0 ? mapAccess(rows[0]) : null
    },
    enabled: Boolean(userId),
    // Roles change through invitations and platform grants, not through
    // anything this tab did — so don't serve a stale picture for long.
    staleTime: 30_000,
  })
}

/**
 * Where an authenticated identity should land, given where they came in and
 * what the database says they may do.
 *
 * Pure and exhaustively tested (see auth-callback-page.test.tsx) because it
 * is the one place three sign-in doors, three capability sets and a resume
 * target all meet. The ordering rule is: honour the door they chose ONLY if
 * the database backs it, otherwise fall back to what they genuinely have.
 */
export function resolveDestination(options: {
  access: MyAccess | null
  intent: 'customer' | 'pro' | 'platform' | null
  next: string | null
}): string {
  const { access, intent, next } = options

  if (!access) return '/login'

  // A platform sign-in that the database does not back must NEVER reach
  // /platform, however it was requested. It is not an error state for the
  // person — they may be a perfectly legitimate customer — so send them to
  // the workspace resolver rather than an authorization wall.
  if (intent === 'platform') {
    return access.platformAvailable ? '/platform' : '/workspace'
  }

  // An explicit internal return target wins for the two non-platform doors:
  // it is what the visitor was actually trying to reach. It has already been
  // origin-validated by the caller, and every destination re-checks its own
  // authorization on arrival.
  if (next) return next

  if (intent === 'pro') {
    if (access.professionalAvailable) return '/app'
    if (access.applicationStatus && access.applicationStatus !== 'approved') return '/pro/application'
    return '/workspace'
  }

  if (intent === 'customer') return '/app/customer'

  // No intent (a bare callback, or a link someone shared): let the existing
  // workspace selector decide, which it already does correctly for
  // single-context and multi-context identities alike.
  return '/workspace'
}
