import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { organizationKeys, profileKeys } from '@/shared/data/keys'
import type { PublicServiceStateRow } from '@/shared/lib/serviceState'
import type { PostMedia } from '@/shared/data/postMedia'

/**
 * F2 transposée — la couche data du profil barber public (/pro/[handle]),
 * sous-ensemble M1a de apps/web/src/features/professional-profile/api :
 * les mutations (Suivre, revendication) exigent une session — la connexion
 * arrive en M1b, elles arriveront avec elle.
 *
 * Chaîne de résolution : `get_public_professional_by_handle` (identité
 * portable + claim_state) → `get_public_professional_workplace` (VIDE pour
 * un non revendiqué — décision B1) → `get_public_barber` +
 * `list_public_barber_services` → `get_public_service_state` (l'état RÉEL
 * du CTA). Portfolio : `get_professional_posts` (B4). Avis :
 * `get_public_reviews` / `get_public_reputation` (`rating_average` null
 * sans avis — JAMAIS zéro).
 */

/** Poll aligné sur la décision F1/F2 : la bascule de mode doit se voir. */
const STATE_POLL_MS = 30_000

export function useProfessionalByHandle(handle: string | null) {
  return useQuery({
    queryKey: profileKeys.publicByHandle(handle ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_professional_by_handle', {
        p_handle: handle ?? '',
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(handle),
    staleTime: 60_000,
  })
}

export interface Workplace {
  organization_id: string
  organization_name: string
  organization_slug: string
  /** 'independent' | 'barbershop' | null — le mapping B1, jamais business_type. */
  marketplace_supply_type: string | null
  barber_id: string
  location_id: string | null
  location_name: string | null
}

export function useWorkplace(professionalId: string | null) {
  return useQuery({
    queryKey: profileKeys.workplace(professionalId ?? ''),
    queryFn: async (): Promise<Workplace[]> => {
      const { data, error } = await getSupabase().rpc('get_public_professional_workplace', {
        p_professional_id: professionalId ?? '',
      })
      if (error) throw error
      return (data ?? []) as Workplace[]
    },
    enabled: Boolean(professionalId),
    staleTime: 60_000,
  })
}

/** L'organisation du lieu de travail — pour la devise réelle des prix. */
export function useWorkplaceOrganization(slug: string | null) {
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

export function usePublicBarber(slug: string | null, barberId: string | null) {
  return useQuery({
    queryKey: profileKeys.barber(slug ?? '', barberId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_barber', {
        p_organization_slug: slug ?? '',
        p_barber_id: barberId ?? '',
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(slug && barberId),
    staleTime: 60_000,
  })
}

export function useBarberServices(slug: string | null, barberId: string | null) {
  return useQuery({
    queryKey: profileKeys.barberServices(slug ?? '', barberId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_barber_services', {
        p_organization_slug: slug ?? '',
        p_barber_id: barberId ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug && barberId),
    staleTime: 60_000,
  })
}

export function useProfileServiceState(slug: string | null, locationId: string | null, barberId: string | null) {
  return useQuery({
    queryKey: profileKeys.serviceState(slug ?? '', locationId ?? '', barberId),
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
    refetchInterval: STATE_POLL_MS,
    staleTime: 30_000,
  })
}

export function usePublicLocations(slug: string | null) {
  return useQuery({
    // Même fabrique de clé que le profil salon : réponse identique, partagée.
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

export interface ProfessionalPost {
  post_id: string
  caption: string | null
  created_at: string
  like_count: number
  media: PostMedia[]
}

const POSTS_PAGE_SIZE = 30

/** Portfolio paginé par curseur temporel — première tranche de 30. */
export function useProfessionalPosts(handle: string | null) {
  return useInfiniteQuery({
    queryKey: profileKeys.posts(handle ?? ''),
    queryFn: async ({ pageParam }): Promise<ProfessionalPost[]> => {
      const { data, error } = await getSupabase().rpc('get_professional_posts', {
        p_handle: handle ?? '',
        p_cursor: pageParam ?? undefined,
        p_limit: POSTS_PAGE_SIZE,
      })
      if (error) throw error
      return (data ?? []).map((row) => ({
        post_id: row.post_id,
        caption: row.caption,
        created_at: row.created_at,
        like_count: row.like_count,
        media: (Array.isArray(row.media) ? row.media : []) as unknown as PostMedia[],
      }))
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length === POSTS_PAGE_SIZE ? (lastPage[lastPage.length - 1]?.created_at ?? null) : null,
    enabled: Boolean(handle),
    staleTime: 60_000,
  })
}

export interface PublicReview {
  review_id: string
  rating: number
  comment: string | null
  created_at: string
  reviewer_display_name: string | null
  reply_body: string | null
  replied_at: string | null
}

export function useProfessionalReviews(professionalId: string | null) {
  return useQuery({
    queryKey: profileKeys.reviews(professionalId ?? ''),
    queryFn: async (): Promise<PublicReview[]> => {
      const { data, error } = await getSupabase().rpc('get_public_reviews', {
        p_professional_id: professionalId ?? '',
        p_limit: 20,
      })
      if (error) throw error
      return (data ?? []) as PublicReview[]
    },
    enabled: Boolean(professionalId),
    staleTime: 60_000,
  })
}

export interface Reputation {
  /** null tant qu'aucun avis n'existe — JAMAIS zéro (B4, prouvé trois fois). */
  rating_average: number | null
  rating_count: number
}

export function useProfessionalReputation(professionalId: string | null) {
  return useQuery({
    queryKey: profileKeys.reputation(professionalId ?? ''),
    queryFn: async (): Promise<Reputation | null> => {
      const { data, error } = await getSupabase().rpc('get_public_reputation', {
        p_professional_id: professionalId ?? '',
      })
      if (error) throw error
      return (data?.[0] as Reputation | undefined) ?? null
    },
    enabled: Boolean(professionalId),
    staleTime: 60_000,
  })
}
