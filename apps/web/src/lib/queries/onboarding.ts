import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Professional onboarding — the data layer.
 *
 * Every mutation here wraps an RPC that is idempotent by construction, because
 * onboarding is resumable: someone closes the tab at step 6, comes back
 * tomorrow, and replays steps 1-6. Running the services step twice must
 * produce three services, not six. See
 * db/migrations/20260818220000_business_profile_and_onboarding.sql.
 *
 * Readiness is never computed here. `useOrganizationReadiness` reads the
 * single server-side evaluator, which inspects PERSISTED state rather than
 * wizard progress — so a step whose save silently failed shows as incomplete
 * instead of ticked, and a business configured entirely through the ordinary
 * admin screens (never touching this wizard) is correctly recognised as
 * ready.
 */

export type BusinessType =
  | 'solo_professional'
  | 'barbershop'
  | 'hair_salon'
  | 'mixed_salon'
  | 'multi_location'

export const BUSINESS_TYPES: BusinessType[] = [
  'solo_professional',
  'barbershop',
  'hair_salon',
  'mixed_salon',
  'multi_location',
]

/** Mirrors the missing_requirements[] values get_organization_readiness returns. */
export type ReadinessRequirement =
  | 'business_type'
  | 'currency'
  | 'location'
  /*
    B1 replaced 'location_address'. get_organization_readiness now accepts
    EITHER a complete postal address on a physical_address location OR an
    active service_area location, because MASTER_SPEC §8 makes the mobile
    professional legitimate and forbids inventing a street for them. The key
    was renamed rather than kept, so a wizard cannot go on telling a mobile
    barber to type an address they do not have.
  */
  | 'location_address_or_service_area'
  | 'timezone'
  | 'professional'
  | 'service'
  | 'service_at_location'
  | 'service_for_professional'
  | 'location_hours'
  | 'professional_hours'
  | 'public_profile'

export interface OrganizationReadiness {
  organizationId: string
  /** The chosen type itself, so the wizard can pick a template without a second query. */
  businessType: BusinessType | null
  currency: string | null
  hasBusinessType: boolean
  hasCurrency: boolean
  hasLocation: boolean
  /** A complete postal address on at least one active physical_address location. */
  hasLocationAddress: boolean
  /** At least one active service_area location — the mobile professional's answer to "where". */
  hasServiceArea: boolean
  hasTimezone: boolean
  hasProfessional: boolean
  hasService: boolean
  hasServiceAtLocation: boolean
  hasServiceForProfessional: boolean
  hasLocationHours: boolean
  hasProfessionalHours: boolean
  hasPublicProfile: boolean
  /** True means get_public_available_slots can genuinely return slots. */
  readyToBook: boolean
  readyToPublish: boolean
  isPublished: boolean
  missingRequirements: ReadinessRequirement[]
}

interface ReadinessRow {
  organization_id: string
  business_type: BusinessType | null
  currency: string | null
  has_business_type: boolean
  has_currency: boolean
  has_location: boolean
  has_location_address: boolean
  has_service_area: boolean
  has_timezone: boolean
  has_professional: boolean
  has_service: boolean
  has_service_at_location: boolean
  has_service_for_professional: boolean
  has_location_hours: boolean
  has_professional_hours: boolean
  has_public_profile: boolean
  ready_to_book: boolean
  ready_to_publish: boolean
  is_published: boolean
  missing_requirements: ReadinessRequirement[]
}

function mapReadiness(row: ReadinessRow): OrganizationReadiness {
  return {
    organizationId: row.organization_id,
    businessType: row.business_type,
    currency: row.currency,
    hasBusinessType: row.has_business_type,
    hasCurrency: row.has_currency,
    hasLocation: row.has_location,
    hasLocationAddress: row.has_location_address,
    hasServiceArea: row.has_service_area,
    hasTimezone: row.has_timezone,
    hasProfessional: row.has_professional,
    hasService: row.has_service,
    hasServiceAtLocation: row.has_service_at_location,
    hasServiceForProfessional: row.has_service_for_professional,
    hasLocationHours: row.has_location_hours,
    hasProfessionalHours: row.has_professional_hours,
    hasPublicProfile: row.has_public_profile,
    readyToBook: row.ready_to_book,
    readyToPublish: row.ready_to_publish,
    isPublished: row.is_published,
    missingRequirements: row.missing_requirements ?? [],
  }
}

export const readinessKey = (organizationId: string | undefined) =>
  ['organization-readiness', organizationId] as const

export function useOrganizationReadiness(organizationId: string | undefined) {
  return useQuery({
    queryKey: readinessKey(organizationId),
    queryFn: async (): Promise<OrganizationReadiness | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_organization_readiness', {
        p_organization_id: organizationId,
      })
      if (error) throw error
      const rows = (data ?? []) as ReadinessRow[]
      return rows.length > 0 ? mapReadiness(rows[0]) : null
    },
    enabled: Boolean(organizationId),
  })
}

/** Invalidates everything a completed onboarding step can have changed. */
function useOnboardingInvalidation(organizationId: string | undefined) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: readinessKey(organizationId) })
    void queryClient.invalidateQueries({ queryKey: ['services', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['locations', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['barbers', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['staff-profiles', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['location-hours', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['organization-marketplace', organizationId] })
  }
}

export interface BusinessProfileInput {
  organizationId: string
  businessType?: BusinessType | null
  currency?: string | null
  countryCode?: string | null
  name?: string | null
}

/**
 * Partial save. Every field is optional and undefined/null means "leave
 * unchanged" server-side, so going back a step and saving again never blanks
 * a value a later step set.
 */
export function useSaveBusinessProfile(organizationId: string | undefined) {
  const invalidate = useOnboardingInvalidation(organizationId)
  return useMutation({
    mutationFn: async (input: BusinessProfileInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('save_business_profile', {
        p_organization_id: input.organizationId,
        p_business_type: input.businessType ?? null,
        p_currency: input.currency ?? null,
        p_country_code: input.countryCode ?? null,
        p_name: input.name ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export interface OwnerProfessionalInput {
  organizationId: string
  locationId: string
  displayName?: string | null
  title?: string | null
  bio?: string | null
}

/** Returns the barber id, creating the staff profile and bookable record if needed. */
export function useEnsureOwnerProfessional(organizationId: string | undefined) {
  const invalidate = useOnboardingInvalidation(organizationId)
  return useMutation({
    mutationFn: async (input: OwnerProfessionalInput): Promise<string> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('ensure_owner_professional', {
        p_organization_id: input.organizationId,
        p_location_id: input.locationId,
        p_display_name: input.displayName ?? null,
        p_title: input.title ?? null,
        p_bio: input.bio ?? null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: invalidate,
  })
}

export interface StarterService {
  name: string
  durationMinutes: number
  priceCents: number
}

export interface StarterServicesInput {
  organizationId: string
  locationId: string
  services: StarterService[]
  /** When set, each service is also linked to this professional. */
  barberId?: string | null
}

export function useApplyStarterServices(organizationId: string | undefined) {
  const invalidate = useOnboardingInvalidation(organizationId)
  return useMutation({
    mutationFn: async (input: StarterServicesInput): Promise<number> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('apply_starter_services', {
        p_organization_id: input.organizationId,
        p_location_id: input.locationId,
        p_services: input.services.map((service) => ({
          name: service.name,
          duration_minutes: service.durationMinutes,
          price_cents: service.priceCents,
        })),
        p_barber_id: input.barberId ?? null,
      })
      if (error) throw error
      return (data as number) ?? 0
    },
    onSuccess: invalidate,
  })
}

export interface WeeklyDay {
  dayOfWeek: number
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
}

export interface WeeklyHoursInput {
  organizationId: string
  locationId?: string | null
  barberId?: string | null
  days: WeeklyDay[]
}

export function useApplyWeeklyHours(organizationId: string | undefined) {
  const invalidate = useOnboardingInvalidation(organizationId)
  return useMutation({
    mutationFn: async (input: WeeklyHoursInput): Promise<number> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('apply_weekly_hours', {
        p_organization_id: input.organizationId,
        p_location_id: input.locationId ?? null,
        p_barber_id: input.barberId ?? null,
        p_days: input.days.map((day) => ({
          day_of_week: day.dayOfWeek,
          is_closed: day.isClosed,
          open_time: day.isClosed ? null : day.openTime,
          close_time: day.isClosed ? null : day.closeTime,
        })),
      })
      if (error) throw error
      return (data as number) ?? 0
    },
    onSuccess: invalidate,
  })
}

export interface CompleteOnboardingResult {
  readyToBook: boolean
  readyToPublish: boolean
  isPublished: boolean
  missingRequirements: ReadinessRequirement[]
}

/**
 * Stamps completion when the business is genuinely bookable, and publishes it
 * when genuinely publishable. Never forces either — an incomplete business
 * gets its honest readiness report back. The publication gate is a trigger on
 * the table, so this cannot be routed around by writing the column directly.
 */
export function useCompleteOnboarding(organizationId: string | undefined) {
  const invalidate = useOnboardingInvalidation(organizationId)
  return useMutation({
    mutationFn: async (input: { organizationId: string; publish: boolean }): Promise<CompleteOnboardingResult> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('complete_onboarding', {
        p_organization_id: input.organizationId,
        p_publish: input.publish,
      })
      if (error) throw error
      const rows = (data ?? []) as {
        ready_to_book: boolean
        ready_to_publish: boolean
        is_published: boolean
        missing_requirements: ReadinessRequirement[]
      }[]
      const row = rows[0]
      return {
        readyToBook: row?.ready_to_book ?? false,
        readyToPublish: row?.ready_to_publish ?? false,
        isPublished: row?.is_published ?? false,
        missingRequirements: row?.missing_requirements ?? [],
      }
    },
    onSuccess: invalidate,
  })
}

/** Country -> currency/timezone suggestions, resolved server-side so one table drives both. */
export function useLocaleSuggestions(countryCode: string | null | undefined) {
  return useQuery({
    queryKey: ['locale-suggestions', countryCode],
    queryFn: async (): Promise<{ currency: string | null; timezone: string | null }> => {
      const supabase = getSupabaseClient()
      const [currency, timezone] = await Promise.all([
        supabase.rpc('suggested_currency_for_country', { p_country_code: countryCode }),
        supabase.rpc('suggested_timezone_for_country', { p_country_code: countryCode }),
      ])
      if (currency.error) throw currency.error
      if (timezone.error) throw timezone.error
      return {
        currency: (currency.data as string | null) ?? null,
        timezone: (timezone.data as string | null) ?? null,
      }
    },
    enabled: Boolean(countryCode && countryCode.length === 2),
    staleTime: Infinity,
  })
}
