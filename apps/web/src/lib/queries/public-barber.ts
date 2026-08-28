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
  professionalId: string | null
  displayName: string
  title: string | null
  bio: string | null
  avatarUrl: string | null
  locationId: string | null
}

interface PublicBarberProfileRow {
  barber_id: string
  professional_id: string | null
  display_name: string
  title: string | null
  bio: string | null
  avatar_url: string | null
  location_id: string | null
}

function mapPublicBarberProfile(row: PublicBarberProfileRow): PublicBarberProfile {
  return {
    barberId: row.barber_id,
    professionalId: row.professional_id,
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
  professionalId: string | null
  displayName: string
  title: string | null
  avatarUrl: string | null
  locationId: string | null
  locationName: string | null
}

interface PublicOrganizationBarberRow {
  barber_id: string
  professional_id: string | null
  display_name: string
  title: string | null
  avatar_url: string | null
  location_id: string | null
  location_name: string | null
}

function mapPublicOrganizationBarber(row: PublicOrganizationBarberRow): PublicOrganizationBarber {
  return {
    barberId: row.barber_id,
    professionalId: row.professional_id,
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

/**
 * The durable, shop-independent public identity behind a barber placement —
 * `get_public_professional` (20260826100900_public_projections.sql).
 *
 * Two things live here that the operational `get_public_barber` contract
 * deliberately does not carry, because they are facts about a PERSON rather
 * than about a chair at a shop:
 *
 *   follower_count   computed from the canonical follow edges rather than
 *                    materialized, and capped at 10000 inside the function, so
 *                    a very popular professional costs the same as any other.
 *   handle           the shop-independent address R6/R7 will route on. Read
 *                    here so the profile can show it; nothing links to it yet.
 *
 * Returns null — never an error — for an identity that is unclaimed, not
 * public, or absent. Those three cases are deliberately indistinguishable: "a
 * professional exists here but is hidden" is itself a disclosure.
 */
export interface PublicProfessionalIdentity {
  id: string
  displayName: string
  handle: string | null
  headline: string | null
  bio: string | null
  avatarUrl: string | null
  followerCount: number
}

interface PublicProfessionalIdentityRow {
  id: string
  display_name: string
  handle: string | null
  headline: string | null
  bio: string | null
  avatar_url: string | null
  follower_count: number
}

export function usePublicProfessionalIdentity(professionalId: string | null | undefined) {
  return useQuery({
    queryKey: ['public-professional', professionalId],
    queryFn: async (): Promise<PublicProfessionalIdentity | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_public_professional', {
        p_professional_id: professionalId,
      })
      if (error) throw error
      const rows = (data ?? []) as PublicProfessionalIdentityRow[]
      const row = rows[0]
      if (!row) return null
      return {
        id: row.id,
        displayName: row.display_name,
        handle: row.handle,
        headline: row.headline,
        bio: row.bio,
        avatarUrl: row.avatar_url,
        followerCount: row.follower_count,
      }
    },
    // Only asked for a CLAIMED identity. An unclaimed placement has no
    // professional_id to ask about, and asking anyway would be a round trip
    // guaranteed to return nothing.
    enabled: Boolean(professionalId),
  })
}
