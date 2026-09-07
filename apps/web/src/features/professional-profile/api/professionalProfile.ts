import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { organizationKeys, profileKeys } from '@/shared/data/keys'
import type { PublicServiceStateRow } from '@/shared/lib/serviceState'
import type { PostMedia } from '@/shared/data/postMedia'
import type { PublicQueueFile } from '@/shared/data/publicQueue'

/**
 * F2 — la couche data du profil barber public (/pro/:handle).
 *
 * Tout vient des RPC publiques du contrat V2 (aucune table) :
 * `get_public_professional_by_handle` (identité portable + claim_state, B1),
 * `get_public_professional_workplace` (résolution inverse vers le lieu de
 * travail, F2 — vide pour une identité non revendiquée, décision B1
 * conservée), `get_public_barber` + `list_public_barber_services` (la face
 * staff), `get_public_service_state` (l'état RÉEL du CTA, réparée par B1),
 * `get_professional_posts` (portfolio B4), `get_public_reviews` +
 * `get_public_reputation` (avis B4, `rating_average` null sans avis — jamais
 * zéro).
 */

/** Poll aligné sur la décision F1 : la bascule de mode du pro doit se voir. */
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
  visibility: string
  posted_at_organization_id: string | null
  posted_at_organization_name: string | null
  posted_at_organization_slug: string | null
  created_at: string
  like_count: number
  liked_by_me: boolean
  media: PostMedia[]
  services: unknown[]
}

const POSTS_PAGE_SIZE = 30

/**
 * Portfolio paginé par curseur temporel — première tranche de 30 (MASTER_SPEC
 * §9 : pas de plafond arbitraire, chargement paresseux).
 */
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
        ...row,
        media: (Array.isArray(row.media) ? row.media : []) as unknown as PostMedia[],
        services: (Array.isArray(row.services) ? row.services : []) as unknown[],
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
  photo_storage_path: string | null
  professional_id: string | null
  organization_id: string | null
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

/**
 * Les files du lieu (F1b) — pour le signal opérationnel RÉEL « n en file »
 * du barber. Même fabrique de clé que le profil salon : cache partagé.
 * Interrogée seulement quand la file accepte (enabled).
 */
export function useLocationQueues(slug: string | null, locationId: string | null, enabled: boolean) {
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
    refetchInterval: 30_000,
    staleTime: 0,
  })
}

/** Mes follows pro — l'état du bouton Suivre (session requise). */
export function useMyFollowedProfessionals(enabled: boolean) {
  return useQuery({
    queryKey: profileKeys.myFollowedProfessionals(),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_my_followed_professionals')
      if (error) throw error
      return data ?? []
    },
    enabled,
    staleTime: 60_000,
  })
}

/**
 * Suivre / ne plus suivre. Autorisé sur un profil non revendiqué (moteur
 * d'acquisition, MASTER_SPEC §5). Pas d'écriture optimiste ici : le compteur
 * public vient du serveur, l'invalidation suffit et reste honnête.
 */
export function useFollowProfessional(professionalId: string | null, handle: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (next: 'follow' | 'unfollow') => {
      const rpc = next === 'follow' ? 'follow_professional' : 'unfollow_professional'
      const { error } = await getSupabase().rpc(rpc, { p_professional_id: professionalId ?? '' })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.myFollowedProfessionals() })
      // Le follower_count vit dans la réponse by_handle : invalidation
      // CIBLÉE — pas tout profileKeys.all (le portfolio n'a pas changé).
      if (handle) {
        void queryClient.invalidateQueries({ queryKey: profileKeys.publicByHandle(handle) })
      }
    },
  })
}

/**
 * Le chemin de revendication (F2 §5) : « c'est moi ». RPC B1 — la validation
 * est humaine ou automatique côté plateforme, jamais « dernier arrivé gagne ».
 */
export function useSubmitClaim(professionalId: string | null) {
  return useMutation({
    mutationFn: async (evidence: string) => {
      const { data, error } = await getSupabase().rpc('submit_professional_claim', {
        p_professional_id: professionalId ?? '',
        p_evidence: evidence.trim() || undefined,
      })
      if (error) throw error
      return data
    },
  })
}
