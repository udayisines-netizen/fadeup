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

/**
 * Links every existing shop-owned customers row (across every organization)
 * matching the caller's own phone/email to their account — see
 * public.claim_customer_records. Best-effort: call after a booking or after
 * saving contact info in onboarding/profile; failures are non-fatal to
 * whatever the customer was actually trying to do.
 */
export function useClaimCustomerRecords() {
  return useMutation({
    mutationFn: async ({ phone, email }: { phone: string | null; email: string | null }): Promise<number> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('claim_customer_records', { p_phone: phone, p_email: email })
      if (error) throw error
      return (data as number) ?? 0
    },
  })
}
