import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { postMediaKeys } from '@/shared/data/keys'

/**
 * Médias de posts B4 — partagés entre les deux profils publics (barber et
 * salon), qui ne peuvent pas s'importer l'un l'autre. Le bucket `post-media`
 * n'est PAS public : chaque chemin se signe via l'API Storage, et la policy
 * `post_media_objects_select_visible` autorise l'anonyme à signer le média
 * d'un post public (contrat B4).
 *
 * (Précédent : shared/data/organization.ts, déplacé par F1 pour la même
 * raison d'architecture — le client Supabase y est déjà consommé.)
 */

export interface PostMedia {
  id: string
  storage_path: string
  media_type: string
  width: number | null
  height: number | null
  duration_ms: number | null
  position: number
}

const SIGNED_URL_TTL_SECONDS = 3600

/**
 * Signe une tranche de chemins. Un chemin qui échoue est simplement ABSENT de
 * la carte retournée : le MediaFrame rend alors son état « média manquant »
 * de première classe — jamais une fausse image.
 */
export function useSignedPostMedia(paths: readonly string[]) {
  const sorted = [...paths].sort()
  return useQuery({
    queryKey: postMediaKeys.signed(sorted),
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await getSupabase()
        .storage.from('post-media')
        .createSignedUrls(sorted, SIGNED_URL_TTL_SECONDS)
      if (error) throw error
      const map: Record<string, string> = {}
      for (const entry of data ?? []) {
        if (entry.signedUrl && entry.path) map[entry.path] = entry.signedUrl
      }
      return map
    },
    enabled: sorted.length > 0,
    // Les URL expirent à 1 h : on re-signe bien avant.
    staleTime: 45 * 60_000,
  })
}
