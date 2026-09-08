import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { organizationKeys } from '@/shared/data/keys'
import type { PublicLocationHoursRow } from '@/shared/lib/openingHours'
import type { PublicServiceStateRow } from '@/shared/lib/serviceState'
import type { PostMedia } from '@/shared/data/postMedia'

/**
 * F2 transposée — la couche data du profil salon public (/shop/[slug]),
 * sous-ensemble M1a de apps/web/src/features/organization-profile/api :
 * les mutations (Suivre) et la file en direct (F1b) attendent M1b — la
 * première exige une session, la seconde appartient au lot file.
 */

const STATE_POLL_MS = 30_000

export function usePublicOrganization(slug: string | null) {
  return useQuery({
    queryKey: organizationKeys.publicBySlug(slug ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_organization', { p_slug: slug ?? '' })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

export function useOrganizationLocations(slug: string | null) {
  return useQuery({
    queryKey: organizationKeys.locations(slug ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_locations', {
        p_organization_slug: slug ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

export function useOrganizationServices(slug: string | null, locationId: string | null) {
  return useQuery({
    queryKey: organizationKeys.services(slug ?? '', locationId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_services', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug && locationId),
    staleTime: 60_000,
  })
}

export interface TeamMember {
  barber_id: string
  /** Non null SEULEMENT pour une identité revendiquée (décision B1). */
  professional_id: string | null
  display_name: string
  title: string | null
  avatar_url: string | null
  location_id: string | null
  location_name: string | null
}

export function useOrganizationTeam(slug: string | null) {
  return useQuery({
    queryKey: organizationKeys.team(slug ?? ''),
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await getSupabase().rpc('list_public_organization_barbers', {
        p_organization_slug: slug ?? '',
      })
      if (error) throw error
      return (data ?? []) as TeamMember[]
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

/**
 * Le handle public d'un membre revendiqué — pour le lien vers /pro/[handle].
 * Une identité non revendiquée n'a pas de professional_id public : pas de
 * lien, rien d'inventé.
 */
export function useMemberHandle(professionalId: string | null) {
  return useQuery({
    queryKey: organizationKeys.memberHandle(professionalId ?? ''),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await getSupabase().rpc('get_public_professional', {
        p_professional_id: professionalId ?? '',
      })
      if (error) throw error
      return data?.[0]?.handle ?? null
    },
    enabled: Boolean(professionalId),
    staleTime: 300_000,
  })
}

export function useShopServiceState(
  slug: string | null,
  locationId: string | null,
  barberId: string | null = null,
  options: { poll?: boolean } = {},
) {
  return useQuery({
    queryKey: organizationKeys.serviceState(slug ?? '', locationId ?? '', barberId),
    queryFn: async (): Promise<PublicServiceStateRow | null> => {
      const { data, error } = await getSupabase().rpc('get_public_service_state', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
        p_barber_id: barberId ?? undefined,
      })
      if (error) throw error
      return (data?.[0] as PublicServiceStateRow | undefined) ?? null
    },
    enabled: Boolean(slug && locationId),
    refetchInterval: options.poll === false ? false : STATE_POLL_MS,
    staleTime: 30_000,
  })
}

export function useLocationHours(slug: string | null, locationId: string | null) {
  return useQuery({
    queryKey: organizationKeys.hours(slug ?? '', locationId ?? ''),
    queryFn: async (): Promise<PublicLocationHoursRow[]> => {
      const { data, error } = await getSupabase().rpc('list_public_location_hours', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return (data ?? []) as PublicLocationHoursRow[]
    },
    enabled: Boolean(slug && locationId),
    staleTime: 5 * 60_000,
  })
}

export function useOrganizationFollowerCount(organizationId: string | null) {
  return useQuery({
    queryKey: organizationKeys.followerCount(organizationId ?? ''),
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await getSupabase().rpc('get_public_organization_follower_count', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      return typeof data === 'number' ? data : null
    },
    enabled: Boolean(organizationId),
    staleTime: 60_000,
  })
}

export function useOrganizationReputation(organizationId: string | null) {
  return useQuery({
    queryKey: organizationKeys.reputation(organizationId ?? ''),
    queryFn: async (): Promise<{ rating_average: number | null; rating_count: number } | null> => {
      const { data, error } = await getSupabase().rpc('get_public_reputation', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(organizationId),
    staleTime: 60_000,
  })
}

export interface OrganizationReview {
  review_id: string
  rating: number
  comment: string | null
  created_at: string
  reviewer_display_name: string | null
  reply_body: string | null
  replied_at: string | null
}

export function useOrganizationReviews(organizationId: string | null) {
  return useQuery({
    queryKey: organizationKeys.reviews(organizationId ?? ''),
    queryFn: async (): Promise<OrganizationReview[]> => {
      const { data, error } = await getSupabase().rpc('get_public_reviews', {
        p_organization_id: organizationId ?? '',
        p_limit: 20,
      })
      if (error) throw error
      return (data ?? []) as OrganizationReview[]
    },
    enabled: Boolean(organizationId),
    staleTime: 60_000,
  })
}

export interface OrganizationPost {
  post_id: string
  caption: string | null
  created_at: string
  like_count: number
  professional_display_name: string | null
  professional_handle: string | null
  media: PostMedia[]
}

/** Les réalisations du lieu (B4) — première tranche seulement sur le profil. */
export function useOrganizationPosts(slug: string | null) {
  return useQuery({
    queryKey: organizationKeys.posts(slug ?? ''),
    queryFn: async (): Promise<OrganizationPost[]> => {
      const { data, error } = await getSupabase().rpc('get_organization_posts', {
        p_slug: slug ?? '',
        p_limit: 12,
      })
      if (error) throw error
      return (data ?? []).map((row) => ({
        post_id: row.post_id,
        caption: row.caption,
        created_at: row.created_at,
        like_count: row.like_count,
        professional_display_name: row.professional_display_name,
        professional_handle: row.professional_handle,
        media: (Array.isArray(row.media) ? row.media : []) as unknown as PostMedia[],
      }))
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}
