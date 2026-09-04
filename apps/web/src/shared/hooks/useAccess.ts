import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { accessKeys } from '@/shared/data/keys'
import { toAppError, type AppError } from '@/shared/data/errors'
import { useSession } from '@/shared/hooks/useSession'

/**
 * Camel-cased mirror of one `get_my_access` row — the single routing
 * authority for "is this user a customer, a professional, platform staff".
 * Roles gate UI only; authorization stays in RLS and the RPCs.
 */
export interface MyAccess {
  userId: string
  platformRole: string | null
  platformAvailable: boolean
  professionalAvailable: boolean
  organizationCount: number
  ownedOrganizationCount: number
  customerAvailable: boolean
  customerProfileExists: boolean
  customerOnboardingCompleted: boolean
  applicationStatus: string | null
  signupIntent: string | null
}

export interface AccessState {
  access: MyAccess | null
  loading: boolean
  error: AppError | null
}

async function fetchMyAccess(): Promise<MyAccess | null> {
  const { data, error } = await getSupabase().rpc('get_my_access')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
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

/** `get_my_access`, cached per session. Null access while signed out. */
export function useAccess(): AccessState {
  const { session, loading: sessionLoading } = useSession()

  const query = useQuery({
    queryKey: accessKeys.me(),
    queryFn: fetchMyAccess,
    enabled: Boolean(session),
    staleTime: 60_000,
  })

  if (!session) {
    return { access: null, loading: sessionLoading, error: null }
  }

  return {
    access: query.data ?? null,
    loading: sessionLoading || query.isPending,
    error: query.isError ? toAppError(query.error) : null,
  }
}

/** Post-login destination: pro accounts land on their OS, everyone else on home. */
export function defaultDestination(access: MyAccess | null): string {
  if (access?.professionalAvailable) return '/dashboard'
  return '/'
}
