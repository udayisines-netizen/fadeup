/**
 * M1b — la couche data de l'onglet Compte. Elle ne lit QUE des contrats
 * existants, tels qu'ils sont :
 *
 *  - `get_my_favorites` / `remove_favorite` : les favoris du client. V2 ne
 *    crée plus que des favoris SALON ; des favoris barber historiques
 *    existent en base et sont rendus tels quels (jamais réécrits).
 *  - `list_my_followed_professionals` / `unfollow_professional` : les pros
 *    suivis. Le désabonnement pose une PIERRE TOMBALE (migration
 *    20260826100300 §4) : il survit à une réservation ultérieure, seul un
 *    Suivre délibéré depuis le profil le renverse — l'écran le dit.
 *  - `list_my_followed_organizations` : ne rend QUE `organization_id` et
 *    `followed_at`. Pas de nom, pas de slug. MANQUE DE CONTRAT déclaré :
 *    l'écran affiche un compteur honnête, sans N+1 de résolution et sans
 *    inventer de nom.
 *  - `customer_profiles` en RLS directe owner-only : la ligne PEUT ne pas
 *    exister (état légitime) → `maybeSingle()` en lecture, `upsert` sur
 *    `user_id` en écriture (jamais `update`, comme profileSync).
 *
 * Clés : les deux familles de follows viennent de `@/shared/data/keys` (le
 * catalogue partagé avec le web, copie verbatim — on n'y ajoute rien) ;
 * favoris et profil client, absents de ce catalogue, ont leur fabrique
 * LOCALE ci-dessous — hiérarchique, comme le reste.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { organizationKeys, profileKeys } from '@/shared/data/keys'
import { getSupabase } from '@/shared/lib/supabase'

/** Fabrique locale — le catalogue partagé ne nomme ni favoris ni profil. */
export const accountKeys = {
  all: ['account'] as const,
  favorites: () => [...accountKeys.all, 'favorites'] as const,
  profile: (userId: string) => [...accountKeys.all, 'profile', userId] as const,
} as const

/**
 * Les colonnes sont typées non-null par le générateur ; la réalité d'un
 * favori barber historique ne l'est pas. On lit défensivement en `| null`.
 */
export interface MyFavorite {
  favorite_id: string
  organization_id: string | null
  organization_name: string | null
  organization_slug: string | null
  barber_id: string | null
  barber_display_name: string | null
  barber_avatar_url: string | null
  created_at: string | null
}

export interface FollowedProfessional {
  id: string
  display_name: string
  handle: string | null
  headline: string | null
  avatar_url: string | null
  followed_at: string | null
}

export interface FollowedOrganization {
  organization_id: string
  followed_at: string | null
}

export function useMyFavorites(enabled: boolean) {
  return useQuery({
    queryKey: accountKeys.favorites(),
    queryFn: async (): Promise<MyFavorite[]> => {
      const { data, error } = await getSupabase().rpc('get_my_favorites')
      if (error) throw error
      return (data ?? []) as MyFavorite[]
    },
    enabled,
  })
}

export function useRemoveFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (favoriteId: string) => {
      const { error } = await getSupabase().rpc('remove_favorite', { p_favorite_id: favoriteId })
      if (error) throw error
    },
    // Aucun optimisme : la liste ne bouge qu'au succès réel du serveur.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.favorites() })
    },
  })
}

export function useMyFollowedProfessionals(enabled: boolean) {
  return useQuery({
    queryKey: profileKeys.myFollowedProfessionals(),
    queryFn: async (): Promise<FollowedProfessional[]> => {
      const { data, error } = await getSupabase().rpc('list_my_followed_professionals')
      if (error) throw error
      return (data ?? []) as FollowedProfessional[]
    },
    enabled,
  })
}

export function useUnfollowProfessional() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (professionalId: string) => {
      const { error } = await getSupabase().rpc('unfollow_professional', {
        p_professional_id: professionalId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.myFollowedProfessionals() })
    },
  })
}

/** Compteur SEULEMENT — le contrat ne rend ni nom ni slug (manque déclaré). */
export function useMyFollowedOrganizations(enabled: boolean) {
  return useQuery({
    queryKey: organizationKeys.myFollowed(),
    queryFn: async (): Promise<FollowedOrganization[]> => {
      const { data, error } = await getSupabase().rpc('list_my_followed_organizations')
      if (error) throw error
      return (data ?? []) as FollowedOrganization[]
    },
    enabled,
  })
}

export interface CustomerProfile {
  display_name: string | null
}

/** `null` = aucune ligne — état LÉGITIME, jamais une erreur. */
export function useCustomerProfile(userId: string | null) {
  return useQuery({
    queryKey: accountKeys.profile(userId ?? ''),
    queryFn: async (): Promise<CustomerProfile | null> => {
      const { data, error } = await getSupabase()
        .from('customer_profiles')
        .select('display_name')
        .eq('user_id', userId ?? '')
        .maybeSingle()
      if (error) throw error
      return data ?? null
    },
    enabled: Boolean(userId),
  })
}

/**
 * `upsert` sur `user_id` : la ligne peut ne pas exister. Seule
 * `display_name` est écrite — les autres colonnes du profil (fréquence,
 * préférences) ne sont pas touchées par la liste de colonnes envoyée.
 */
export function useSaveDisplayName(userId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (displayName: string) => {
      if (!userId) throw new Error('no session')
      const { error } = await getSupabase()
        .from('customer_profiles')
        .upsert({ user_id: userId, display_name: displayName }, { onConflict: 'user_id' })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.profile(userId ?? '') })
    },
  })
}

/**
 * LES clés que l'onglet Compte possède — servent à deux choses :
 *
 *  - rafraîchir à la prise de focus (un favori posé depuis un profil, un
 *    Suivre depuis /pro, le prénom écrit par la synchro d'onboarding
 *    doivent se voir en revenant sur l'onglet) ;
 *  - VIDER le cache à la déconnexion : ces clés ne portent pas
 *    d'identifiant d'utilisateur (contrat partagé avec le web), sans ce
 *    retrait le compte suivant verrait un instant les données du précédent.
 */
export function accountQueryKeys() {
  return [accountKeys.all, profileKeys.myFollowedProfessionals(), organizationKeys.myFollowed()]
}
