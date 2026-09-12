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
 *  - `list_my_followed_organizations` : depuis B5, rend nom, slug, ville et
 *    pays — exactement ce qu'un profil public expose déjà en anonyme, et
 *    rien de plus (pas d'imagerie : aucune colonne n'existe en base). Le
 *    compteur honnête de M1b cède donc la place à la vraie liste.
 *  - `customer_profiles` en RLS directe owner-only : la ligne PEUT ne pas
 *    exister (état légitime) → `maybeSingle()` en lecture, `upsert` sur
 *    `user_id` en écriture (jamais `update`, comme profileSync). B5 y ajoute
 *    `gender` (colonne neuve) à côté de `haircut_frequency` : deux
 *    préférences de recommandation, optionnelles, modifiables et EFFAÇABLES
 *    (NULL) depuis cet écran. Aucune surface publique ne les lit.
 *  - `delete_my_account` / `export_my_data` (B5) : la suppression de compte
 *    en libre-service qu'exige le MASTER_SPEC §16, et l'export qui
 *    l'accompagne. La suppression est IMMÉDIATE ET DÉFINITIVE, sans fenêtre
 *    d'annulation — l'écran doit donc confirmer. La RPC refuse tant qu'il
 *    reste une photo en stockage (`media_not_purged`) : on l'appelle
 *    D'ABORD, et on ne purge le média que si c'est le SEUL obstacle
 *    restant (voir `eraseAccount`).
 *
 * Clés : les deux familles de follows viennent de `@/shared/data/keys` (le
 * catalogue partagé avec le web, copie verbatim — on n'y ajoute rien) ;
 * favoris et profil client, absents de ce catalogue, ont leur fabrique
 * LOCALE ci-dessous — hiérarchique, comme le reste.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { organizationKeys, profileKeys } from '@/shared/data/keys'
import type { Database } from '@/shared/lib/database.types'
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
  organization_name: string
  organization_slug: string
  city: string | null
  country_code: string | null
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

/** Liste réelle depuis B5 : nom, slug, ville. Plus de compteur muet. */
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

export type CustomerGender = Database['public']['Enums']['customer_gender']
export type HaircutFrequency = Database['public']['Enums']['customer_haircut_frequency']

export interface CustomerProfile {
  display_name: string | null
  gender: CustomerGender | null
  haircut_frequency: HaircutFrequency | null
}

/** `null` = aucune ligne — état LÉGITIME, jamais une erreur. */
export function useCustomerProfile(userId: string | null) {
  return useQuery({
    queryKey: accountKeys.profile(userId ?? ''),
    queryFn: async (): Promise<CustomerProfile | null> => {
      const { data, error } = await getSupabase()
        .from('customer_profiles')
        .select('display_name, gender, haircut_frequency')
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
 * Les deux préférences de recommandation, écrites ENSEMBLE parce qu'elles se
 * modifient ensemble à l'écran. `null` est une valeur à part entière : il
 * EFFACE la réponse, et l'`upsert` l'envoie explicitement — un `undefined`
 * laisserait la colonne intacte, ce qui rendrait l'effacement impossible.
 */
export function useSaveRecommendationPreferences(userId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (prefs: {
      gender: CustomerGender | null
      haircutFrequency: HaircutFrequency | null
    }) => {
      if (!userId) throw new Error('no session')
      const { error } = await getSupabase()
        .from('customer_profiles')
        .upsert(
          {
            user_id: userId,
            gender: prefs.gender,
            haircut_frequency: prefs.haircutFrequency,
          },
          { onConflict: 'user_id' },
        )
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.profile(userId ?? '') })
    },
  })
}

/** Le périmètre chiffré que la RPC rend — des nombres, aucun identifiant. */
export interface AccountErasureReceipt {
  erasure_id: string
  erased_at: string
  scope: Record<string, number>
}

/**
 * LE refus nommé, lu sur le CODE et jamais sur le statut HTTP — motif
 * F1/F4/M1b verbatim. Les quatre valeurs sont celles que la RPC émet ;
 * `unknown` couvre tout le reste sans jamais montrer le texte brut.
 */
export type ErasureRefusal =
  | 'not_authenticated'
  | 'business_account'
  | 'active_commitments'
  | 'media_not_purged'
  | 'unknown'

export function erasureRefusalOf(message: string | null | undefined): ErasureRefusal {
  const found = /fadeup_erasure_refusal=([a-z_]+)/.exec(message ?? '')?.[1]
  switch (found) {
    case 'not_authenticated':
    case 'business_account':
    case 'active_commitments':
    case 'media_not_purged':
      return found
    default:
      return 'unknown'
  }
}

/**
 * La suppression de compte. IRRÉVERSIBLE : aucune fenêtre d'annulation
 * n'existe côté serveur, donc la confirmation est entièrement la
 * responsabilité de cet écran.
 *
 * Les objets de stockage sont supprimés AVANT l'appel, par l'API Storage —
 * la seule qui efface le FICHIER et pas seulement sa ligne. La RPC refuse
 * (`media_not_purged`) tant qu'il en reste un : l'échec est FERMÉ, jamais un
 * compte effacé dont les photos survivent.
 */
/**
 * Vide les trois seaux de l'utilisateur, SANS plafond et SANS supposer que
 * l'arborescence est plate.
 *
 * La première écriture listait `{ limit: 1000 }` une seule fois et ne
 * regardait pas les sous-dossiers. Au-delà de mille fichiers, ou le jour où un
 * chemin devient `{uid}/dossier/fichier`, la purge serait incomplète — et
 * comme la RPC refuse tant qu'il RESTE un objet, le compte deviendrait
 * indélébile depuis l'application, sans que rien ne le dise. Les chemins sont
 * plats aujourd'hui ; la pagination et la descente d'un niveau coûtent dix
 * lignes et retirent la bombe.
 */
async function purgeOwnMedia(
  supabase: Pick<ReturnType<typeof getSupabase>, 'storage'>,
  userId: string,
): Promise<void> {
  const PAGE = 100

  const removeUnder = async (bucket: string, prefix: string): Promise<void> => {
    for (let offset = 0; ; offset += PAGE) {
      const { data: entries, error: listError } = await supabase.storage
        .from(bucket)
        .list(prefix, { limit: PAGE, offset })
      if (listError) throw listError
      if (!entries || entries.length === 0) return

      // `id` nul = dossier, pas fichier : on y descend au lieu de le supprimer.
      const files = entries.filter((entry) => entry.id !== null)
      const folders = entries.filter((entry) => entry.id === null)

      if (files.length > 0) {
        const { error: removeError } = await supabase.storage
          .from(bucket)
          .remove(files.map((file) => `${prefix}/${file.name}`))
        if (removeError) throw removeError
      }
      for (const folder of folders) {
        await removeUnder(bucket, `${prefix}/${folder.name}`)
      }

      if (entries.length < PAGE) return
      // Les fichiers supprimés quittent la liste : on repart du début, sinon
      // l'offset saute au-dessus de ce qui vient de remonter d'un cran.
      if (files.length > 0) offset = -PAGE
    }
  }

  for (const bucket of ['passport-photos', 'review-photos', 'post-media'] as const) {
    await removeUnder(bucket, userId)
  }
}

/**
 * L'effacement, extrait du hook pour être TESTABLE.
 *
 * L'ORDRE EST LA PROTECTION, et il est l'inverse de l'intuition.
 *
 * `delete_my_account()` REFUSE tant qu'il reste un objet de stockage à
 * l'appelant (`media_not_purged`) : c'est une précondition, conçue pour que
 * l'effacement des photos soit VÉRIFIABLE. Purger d'abord et appeler ensuite
 * ouvre l'échec exactement là où le serveur l'avait fermé : si la RPC refuse
 * pour une AUTRE raison — un compte professionnel, une file en cours — les
 * photos du Passport sont déjà détruites DÉFINITIVEMENT et le compte, lui,
 * existe toujours. L'utilisateur lit « vous avez une file en cours », renonce,
 * et ne récupère jamais ses photos.
 *
 * Donc : on appelle d'ABORD. Le serveur énumère ses refus. On ne détruit le
 * média que s'il est le SEUL obstacle restant, puis on rappelle.
 */
export async function eraseAccount(
  supabase: Pick<ReturnType<typeof getSupabase>, 'rpc' | 'storage'>,
  userId: string,
): Promise<AccountErasureReceipt> {
  const call = () => supabase.rpc('delete_my_account')

  let { data, error } = await call()

  if (error && erasureRefusalOf(error.message) === 'media_not_purged') {
    await purgeOwnMedia(supabase, userId)
    ;({ data, error } = await call())
  }

  if (error) throw error
  const row = (data ?? [])[0]
  if (!row) throw new Error('no receipt')
  return row as AccountErasureReceipt
}

export function useDeleteMyAccount(userId: string | null) {
  return useMutation({
    mutationFn: async (): Promise<AccountErasureReceipt> => {
      if (!userId) throw new Error('no session')
      return eraseAccount(getSupabase(), userId)
    },
  })
}

/** L'export du §16 : ce que FadeUp détient, en un objet JSON lisible. */
export function useExportMyData() {
  return useMutation({
    mutationFn: async (): Promise<unknown> => {
      const { data, error } = await getSupabase().rpc('export_my_data')
      if (error) throw error
      return data
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
