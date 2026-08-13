import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Anon-callable reads backing the Barber Passport page at
 * `/s/:slug/barbers/:barberId` (LOT 12) — wraps `get_public_barber` /
 * `list_public_barber_services` (see
 * db/migrations/20260809190000_public_barber_profile.sql). Same trust
 * boundary as the rest of `lib/queries/public-*.ts`: `staff_profiles`/
 * `barbers`/`services` have zero anon RLS access, these RPCs are the only
 * client-side surface, and both return zero rows (not an error) for a
 * private or unknown barber.
 */

export interface PublicBarberProfile {
  barberId: string
  displayName: string
  title: string | null
  bio: string | null
  avatarUrl: string | null
  locationId: string | null
}

interface PublicBarberProfileRow {
  barber_id: string
  display_name: string
  title: string | null
  bio: string | null
  avatar_url: string | null
  location_id: string | null
}

function mapPublicBarberProfile(row: PublicBarberProfileRow): PublicBarberProfile {
  return {
    barberId: row.barber_id,
    displayName: row.display_name,
    title: row.title,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    locationId: row.location_id,
  }
}

/** `null` once resolved with no match — a private, unbookable, or unknown barber_id (never an error). */
export function usePublicBarber(organizationSlug: string | undefined, barberId: string | undefined) {
  return useQuery({
    queryKey: ['public-barber', organizationSlug, barberId],
    queryFn: async (): Promise<PublicBarberProfile | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_public_barber', {
        p_organization_slug: organizationSlug,
        p_barber_id: barberId,
      })
      if (error) throw error
      const rows = (data ?? []) as PublicBarberProfileRow[]
      return rows[0] ? mapPublicBarberProfile(rows[0]) : null
    },
    enabled: Boolean(organizationSlug) && Boolean(barberId),
  })
}

export interface PublicBarberService {
  id: string
  name: string
  durationMinutes: number
  priceCents: number
}

interface PublicBarberServiceRow {
  id: string
  name: string
  duration_minutes: number
  price_cents: number
}

function mapPublicBarberService(row: PublicBarberServiceRow): PublicBarberService {
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
  }
}

/** The real, active services this barber performs — never a fabricated "specialties" list. */
export function usePublicBarberServices(organizationSlug: string | undefined, barberId: string | undefined) {
  return useQuery({
    queryKey: ['public-barber-services', organizationSlug, barberId],
    queryFn: async (): Promise<PublicBarberService[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_public_barber_services', {
        p_organization_slug: organizationSlug,
        p_barber_id: barberId,
      })
      if (error) throw error
      return ((data ?? []) as PublicBarberServiceRow[]).map(mapPublicBarberService)
    },
    enabled: Boolean(organizationSlug) && Boolean(barberId),
  })
}

/** One entry in a shop's public team roster — see list_public_organization_barbers. */
export interface PublicOrganizationBarber {
  barberId: string
  displayName: string
  title: string | null
  avatarUrl: string | null
  locationId: string | null
  locationName: string | null
}

interface PublicOrganizationBarberRow {
  barber_id: string
  display_name: string
  title: string | null
  avatar_url: string | null
  location_id: string | null
  location_name: string | null
}

function mapPublicOrganizationBarber(row: PublicOrganizationBarberRow): PublicOrganizationBarber {
  return {
    barberId: row.barber_id,
    displayName: row.display_name,
    title: row.title,
    avatarUrl: row.avatar_url,
    locationId: row.location_id,
    locationName: row.location_name,
  }
}

/** Every public, bookable barber on this shop's team — powers the shop profile's "browse team" screen. */
export function usePublicOrganizationBarbers(organizationSlug: string | undefined) {
  return useQuery({
    queryKey: ['public-organization-barbers', organizationSlug],
    queryFn: async (): Promise<PublicOrganizationBarber[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_public_organization_barbers', {
        p_organization_slug: organizationSlug,
      })
      if (error) throw error
      return ((data ?? []) as PublicOrganizationBarberRow[]).map(mapPublicOrganizationBarber)
    },
    enabled: Boolean(organizationSlug),
  })
}
