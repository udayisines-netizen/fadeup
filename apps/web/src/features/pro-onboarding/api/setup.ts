import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { entitlementKeys, organizationKeys, queueKeys, setupKeys } from '@/shared/data/keys'
import type { Json } from '@/shared/lib/database.types'

/**
 * L'installation en vingt minutes (F1 §6) — chaque étape est un ÉCRIT
 * SERVEUR via les RPC d'onboarding existantes (`complete_organization_
 * onboarding`, `ensure_owner_professional`, `apply_starter_services`,
 * `apply_weekly_hours`, `complete_onboarding`) : rien n'est reconstruit, et
 * un stagiaire interrompu reprend où la BASE en est, pas où un brouillon
 * local en était. `get_organization_readiness` est la source de reprise.
 */

export interface SetupReadiness {
  has_business_type: boolean
  has_currency: boolean
  has_location: boolean
  has_location_address: boolean
  has_service_area: boolean
  has_professional: boolean
  has_service: boolean
  has_service_at_location: boolean
  has_location_hours: boolean
  ready_to_book: boolean
  ready_to_publish: boolean
  is_published: boolean
  missing_requirements: string[]
}

export function useSetupReadiness(organizationId: string | null) {
  return useQuery({
    queryKey: setupKeys.readiness(organizationId ?? ''),
    queryFn: async (): Promise<SetupReadiness | null> => {
      const { data, error } = await getSupabase().rpc('get_organization_readiness', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      return (data?.[0] as SetupReadiness | undefined) ?? null
    },
    enabled: Boolean(organizationId),
    staleTime: 5_000,
  })
}

/** Détail du lieu — la position (géofence !) n'est pas dans la readiness. */
export function useSetupLocation(locationId: string | null) {
  return useQuery({
    queryKey: [...setupKeys.all, 'location', locationId ?? ''] as const,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('locations')
        .select('id, name, address_line1, city, postal_code, country, latitude, longitude, timezone')
        .eq('id', locationId ?? '')
        .single()
      if (error) throw error
      return data
    },
    enabled: Boolean(locationId),
    staleTime: 5_000,
  })
}

/** L'état de file du lieu, pour l'étape finale « file ouverte ». */
export function useSetupQueueState(locationId: string | null) {
  return useQuery({
    queryKey: [...setupKeys.all, 'queue-state', locationId ?? ''] as const,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_service_mode_state', {
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return (data ?? []).find((row) => row.scope === 'location') ?? null
    },
    enabled: Boolean(locationId),
    staleTime: 5_000,
  })
}

function useInvalidateSetup(organizationId: string | null) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: setupKeys.all })
    void queryClient.invalidateQueries({ queryKey: [...organizationKeys.all, 'pro-context'] })
    if (organizationId) {
      void queryClient.invalidateQueries({ queryKey: entitlementKeys.organization(organizationId) })
      void queryClient.invalidateQueries({ queryKey: queueKeys.all })
    }
  }
}

export interface CreateSalonInput {
  name: string
  slug: string
  locationName: string
  timezone: string
  businessType: 'barbershop' | 'solo_professional'
}

export function useCreateSalon() {
  const invalidate = useInvalidateSetup(null)
  return useMutation({
    mutationFn: async (input: CreateSalonInput) => {
      const supabase = getSupabase()
      const { data, error } = await supabase.rpc('complete_organization_onboarding', {
        p_org_name: input.name,
        p_org_slug: input.slug,
        p_location_name: input.locationName,
        p_timezone: input.timezone,
      })
      if (error) throw error
      const row = data?.[0]
      if (!row) throw new Error('complete_organization_onboarding returned no row')
      // Type d'activité + devise/pays du marché de lancement (Île-de-France).
      // La readiness les exige ; modifiables ensuite dans les réglages pro.
      const { error: profileError } = await supabase.rpc('save_business_profile', {
        p_organization_id: row.organization_id,
        p_business_type: input.businessType,
        p_currency: 'EUR',
        p_country_code: 'FR',
      })
      if (profileError) throw profileError
      return row
    },
    onSuccess: () => invalidate(),
  })
}

export function useEnsureOwnerBarber(organizationId: string | null) {
  const invalidate = useInvalidateSetup(organizationId)
  return useMutation({
    mutationFn: async (input: { locationId: string; displayName: string }) => {
      const { data, error } = await getSupabase().rpc('ensure_owner_professional', {
        p_organization_id: organizationId ?? '',
        p_location_id: input.locationId,
        p_display_name: input.displayName,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => invalidate(),
  })
}

export interface SaveAddressInput {
  locationId: string
  addressLine1: string
  postalCode: string
  city: string
  latitude: number | null
  longitude: number | null
}

export function useSaveAddress(organizationId: string | null) {
  const invalidate = useInvalidateSetup(organizationId)
  return useMutation({
    mutationFn: async (input: SaveAddressInput) => {
      const { data, error } = await getSupabase()
        .from('locations')
        .update({
          address_line1: input.addressLine1,
          postal_code: input.postalCode,
          city: input.city,
          country: 'FR',
          latitude: input.latitude,
          longitude: input.longitude,
        })
        .eq('id', input.locationId)
        .select('id, latitude, longitude')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidate(),
  })
}

export interface StarterService {
  name: string
  duration_minutes: number
  price_cents: number
}

export function useApplyServices(organizationId: string | null) {
  const invalidate = useInvalidateSetup(organizationId)
  return useMutation({
    mutationFn: async (input: { locationId: string; barberId: string | null; services: StarterService[] }) => {
      const { data, error } = await getSupabase().rpc('apply_starter_services', {
        p_organization_id: organizationId ?? '',
        p_location_id: input.locationId,
        // Le générateur de types réduit le jsonb à `Json` : la forme réelle
        // ({name, duration_minutes, price_cents}) est validée par la RPC.
        p_services: input.services as unknown as Json,
        p_barber_id: input.barberId ?? undefined,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => invalidate(),
  })
}

export interface WeeklyDay {
  day_of_week: number
  is_closed: boolean
  open_time?: string
  close_time?: string
}

export function useApplyHours(organizationId: string | null) {
  const invalidate = useInvalidateSetup(organizationId)
  return useMutation({
    mutationFn: async (input: { locationId: string; barberId: string | null; days: WeeklyDay[] }) => {
      // Lieu ET professionnel dans le même appel : la RPC accepte les deux
      // portées, et être réservable exige aussi les horaires du barber.
      const { data, error } = await getSupabase().rpc('apply_weekly_hours', {
        p_organization_id: organizationId ?? '',
        p_location_id: input.locationId,
        p_barber_id: input.barberId ?? undefined,
        p_days: input.days as unknown as Json,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => invalidate(),
  })
}

/**
 * Fin d'onboarding + essai 14 jours SANS carte (B3) : c'est l'essai qui
 * livre la capacité `liveQueue` — une organisation Free n'admet personne en
 * file (trigger `enforce_queue_service_mode`). « Essai déjà consommé » n'est
 * pas un échec de l'installation : on continue avec le plan en place.
 */
export function useActivateOrganization(organizationId: string | null) {
  const invalidate = useInvalidateSetup(organizationId)
  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabase()
      // p_publish: false — la file n'exige pas la visibilité marketplace, et
      // publier n'est pas un geste d'installation : c'est une décision du
      // patron, depuis l'éditeur de profil public (hors F1).
      const { error: completeError } = await supabase.rpc('complete_onboarding', {
        p_organization_id: organizationId ?? '',
        p_publish: false,
      })
      if (completeError) throw completeError
      const { error: trialError } = await supabase.rpc('start_organization_trial', {
        p_organization_id: organizationId ?? '',
      })
      if (trialError && !/already used its trial/i.test(trialError.message ?? '')) {
        throw trialError
      }
      return true
    },
    onSuccess: () => invalidate(),
  })
}

export function useOpenQueue(organizationId: string | null) {
  const invalidate = useInvalidateSetup(organizationId)
  return useMutation({
    mutationFn: async (input: { locationId: string }) => {
      const supabase = getSupabase()
      const { error: modeError } = await supabase.rpc('set_location_service_mode', {
        p_location_id: input.locationId,
        p_mode: 'hybrid',
      })
      if (modeError) throw modeError
      const { error: openError } = await supabase.rpc('set_location_queue_open', {
        p_location_id: input.locationId,
        p_queue_open: true,
      })
      if (openError) throw openError
      return true
    },
    onSuccess: () => invalidate(),
  })
}

/** Premier barber de l'organisation — pour rattacher services et horaires à la reprise. */
export function useSetupBarber(organizationId: string | null) {
  return useQuery({
    queryKey: [...setupKeys.all, 'barber', organizationId ?? ''] as const,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('barbers')
        .select('id')
        .eq('organization_id', organizationId ?? '')
        .limit(1)
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(organizationId),
    staleTime: 5_000,
  })
}

/** Le jeton QR du lieu, pour l'affiche finale. */
export function useSetupCheckIn(locationId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queueKeys.checkIn(locationId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_location_queue_check_in', {
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(locationId) && enabled,
    staleTime: 300_000,
    retry: false,
  })
}
