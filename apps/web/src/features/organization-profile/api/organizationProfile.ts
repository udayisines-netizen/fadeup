import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { organizationKeys } from '@/shared/data/keys'
import type { PublicQueueFile } from '@/shared/data/publicQueue'
import type { PublicLocationHoursRow } from '@/shared/lib/openingHours'
import type { PublicServiceStateRow } from '@/shared/lib/serviceState'
import type { PostMedia } from '@/shared/data/postMedia'

/**
 * F2 — la couche data du profil salon public (/shop/:slug).
 *
 * RPC publiques uniquement : `get_public_organization`,
 * `list_public_locations` (adresse OU zone de service, B1 — jamais d'adresse
 * inventée), `list_public_services`, `list_public_organization_barbers`,
 * `get_public_service_state`, `list_public_queues` (F1b),
 * `list_public_location_hours` + `get_public_organization_follower_count`
 * (F2), `get_public_reviews`/`get_public_reputation` et
 * `get_organization_posts` (B4).
 */

const STATE_POLL_MS = 30_000
/** La file du profil salon se rafraîchit comme /q/:slug (fait, pas décor). */
const QUEUE_POLL_MS = 6_000

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
 * Le handle public d'un membre revendiqué — pour le lien vers /pro/:handle
 * (le chemin inverse du rattachement, F2 §4). Une identité non revendiquée
 * n'a pas de professional_id public : pas de lien, rien d'inventé.
 */
export function useMemberHandle(professionalId: string | null) {
  return useQuery({
    queryKey: [...organizationKeys.all, 'member-handle', professionalId ?? ''] as const,
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
    // L'état du CTA dominant se rafraîchit (décision F1) ; les états par
    // membre de l'équipe se lisent à la demande, sans marteler Kong.
    refetchInterval: options.poll === false ? false : STATE_POLL_MS,
    staleTime: 30_000,
  })
}

/** Les files par barber (F1b) — même poll que /q/:slug, un FAIT pas un décor. */
export function useShopQueues(slug: string | null, locationId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: organizationKeys.queues(slug ?? '', locationId ?? ''),
    queryFn: async (): Promise<PublicQueueFile[]> => {
      const { data, error } = await getSupabase().rpc('list_public_queues', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return (data ?? []) as PublicQueueFile[]
    },
    enabled: Boolean(slug && locationId) && enabled,
    refetchInterval: QUEUE_POLL_MS,
    staleTime: 0,
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

export function useOrganizationReviews(organizationId: string | null) {
  return useQuery({
    queryKey: organizationKeys.reviews(organizationId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_reviews', {
        p_organization_id: organizationId ?? '',
        p_limit: 20,
      })
      if (error) throw error
      return data ?? []
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

export function useMyFollowedOrganizations(enabled: boolean) {
  return useQuery({
    queryKey: organizationKeys.myFollowed(),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_my_followed_organizations')
      if (error) throw error
      return data ?? []
    },
    enabled,
    staleTime: 60_000,
  })
}

export function useFollowOrganization(organizationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (next: 'follow' | 'unfollow') => {
      const rpc = next === 'follow' ? 'follow_organization' : 'unfollow_organization'
      const { error } = await getSupabase().rpc(rpc, { p_organization_id: organizationId ?? '' })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.myFollowed() })
      if (organizationId) {
        void queryClient.invalidateQueries({ queryKey: organizationKeys.followerCount(organizationId) })
      }
    },
  })
}
