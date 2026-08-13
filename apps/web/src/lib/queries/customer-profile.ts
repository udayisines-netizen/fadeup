import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * The signed-in customer's own portable identity — see
 * public.customer_profiles (db/migrations/20260813120000_customer_identity.sql).
 * Reads/writes go through direct PostgREST calls, not an RPC: RLS on this
 * table is a strict `user_id = auth.uid()` owner-only policy with zero
 * cross-tenant surface, so there's nothing an RPC would add here (unlike
 * shop-internal tables, where a broad policy would risk exposing
 * staff-only data).
 */
export type HaircutFrequency = 'weekly' | 'every_2_weeks' | 'every_3_weeks' | 'monthly' | 'less_often' | 'depends'
export type StylePreference = 'fade' | 'taper' | 'crop' | 'buzz' | 'afro' | 'curly' | 'long' | 'beard_focus' | 'other'
export type AppointmentPreference = 'appointment' | 'walk_in' | 'either'

export interface CustomerProfile {
  id: string
  userId: string
  displayName: string | null
  phone: string | null
  email: string | null
  haircutFrequency: HaircutFrequency | null
  stylePreference: StylePreference | null
  styleNotes: string | null
  appointmentPreference: AppointmentPreference | null
  onboardingCompletedAt: string | null
}

interface CustomerProfileRow {
  id: string
  user_id: string
  display_name: string | null
  phone: string | null
  email: string | null
  haircut_frequency: HaircutFrequency | null
  style_preference: StylePreference | null
  style_notes: string | null
  appointment_preference: AppointmentPreference | null
  onboarding_completed_at: string | null
}

function mapCustomerProfile(row: CustomerProfileRow): CustomerProfile {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    haircutFrequency: row.haircut_frequency,
    stylePreference: row.style_preference,
    styleNotes: row.style_notes,
    appointmentPreference: row.appointment_preference,
    onboardingCompletedAt: row.onboarding_completed_at,
  }
}

export const customerProfileQueryKey = (userId: string | undefined) => ['customer-profile', userId] as const

/** `null` once resolved if the customer has never saved a profile yet (a legitimate, normal first-use state). */
export function useMyCustomerProfile(userId: string | undefined) {
  return useQuery({
    queryKey: customerProfileQueryKey(userId),
    queryFn: async (): Promise<CustomerProfile | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('customer_profiles')
        .select('id, user_id, display_name, phone, email, haircut_frequency, style_preference, style_notes, appointment_preference, onboarding_completed_at')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data ? mapCustomerProfile(data as CustomerProfileRow) : null
    },
    enabled: Boolean(userId),
  })
}

export interface CustomerProfileInput {
  userId: string
  displayName?: string | null
  phone?: string | null
  email?: string | null
  haircutFrequency?: HaircutFrequency | null
  stylePreference?: StylePreference | null
  styleNotes?: string | null
  appointmentPreference?: AppointmentPreference | null
  markOnboardingComplete?: boolean
}

/** Upserts the caller's own profile (RLS enforces user_id = auth.uid() regardless of what's passed). */
export function useUpsertMyCustomerProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CustomerProfileInput): Promise<CustomerProfile> => {
      const supabase = getSupabaseClient()
      const payload: Record<string, unknown> = { user_id: input.userId }
      if (input.displayName !== undefined) payload.display_name = input.displayName
      if (input.phone !== undefined) payload.phone = input.phone
      if (input.email !== undefined) payload.email = input.email
      if (input.haircutFrequency !== undefined) payload.haircut_frequency = input.haircutFrequency
      if (input.stylePreference !== undefined) payload.style_preference = input.stylePreference
      if (input.styleNotes !== undefined) payload.style_notes = input.styleNotes
      if (input.appointmentPreference !== undefined) payload.appointment_preference = input.appointmentPreference
      if (input.markOnboardingComplete) payload.onboarding_completed_at = new Date().toISOString()

      const { data, error } = await supabase
        .from('customer_profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('id, user_id, display_name, phone, email, haircut_frequency, style_preference, style_notes, appointment_preference, onboarding_completed_at')
        .single()
      if (error) throw error
      return mapCustomerProfile(data as CustomerProfileRow)
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(customerProfileQueryKey(profile.userId), profile)
    },
  })
}

export interface RedeemedClaim {
  claimed: boolean
  organizationName: string | null
  startsAt: string | null
}

/**
 * Attaches an appointment booked anonymously to the account the customer
 * just created, using the single-use token issued at booking time — see
 * public.redeem_appointment_claim.
 *
 * This deliberately replaced an earlier `claim_customer_records(phone,
 * email)` RPC, which treated CALLER-SUPPLIED contact details as proof of
 * ownership and therefore let anyone take over a stranger's unlinked shop
 * record by guessing their email (see
 * db/migrations/20260813150000_appointment_ownership_hardening.sql).
 * Possession of the booking token is the only ownership claim accepted
 * now; it is never derived from anything the customer types.
 */
export function useRedeemAppointmentClaim() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string): Promise<RedeemedClaim> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('redeem_appointment_claim', { p_token: token })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as
        | { claimed: boolean; organization_name: string | null; starts_at: string | null }
        | undefined
      return {
        claimed: row?.claimed ?? false,
        organizationName: row?.organization_name ?? null,
        startsAt: row?.starts_at ?? null,
      }
    },
    onSuccess: (result) => {
      if (result.claimed) void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
    },
  })
}

/**
 * Where a claim token waits between "booked anonymously" and "finished
 * creating an account". sessionStorage, not localStorage: it is a
 * short-lived, single-use credential for the tab that made the booking, and
 * should not outlive the browsing session on a shared device.
 */
export const PENDING_CLAIM_STORAGE_KEY = 'fadeup.pendingAppointmentClaim'

export function storePendingClaimToken(token: string) {
  try {
    window.sessionStorage.setItem(PENDING_CLAIM_STORAGE_KEY, token)
  } catch {
    // Private-browsing modes can refuse sessionStorage. The booking itself
    // already succeeded, so this must never surface as an error.
  }
}

export function takePendingClaimToken(): string | null {
  try {
    const token = window.sessionStorage.getItem(PENDING_CLAIM_STORAGE_KEY)
    if (token) window.sessionStorage.removeItem(PENDING_CLAIM_STORAGE_KEY)
    return token
  } catch {
    return null
  }
}
