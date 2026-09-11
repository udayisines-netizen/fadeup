import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'

/**
 * PLAT-2 — la face CLIENT du scan d'affiche. Deux RPC, pas une table.
 *
 * POURQUOI CE FICHIER EXISTE ALORS QUE `lib/queries/platform-plat2.ts` PORTE
 * LES MÊMES DEUX HOOKS. Le dépôt sépare volontairement deux mondes : la
 * console `/platform` (legacy, namespace i18n `platform`, client
 * `@/lib/supabase`) et la surface consumer V2 (`src/features`, namespace
 * `v2`, client `@/shared/lib/supabase`). La frontière est TENUE PAR ESLINT
 * (`boundaries/dependencies`) : une feature ne peut pas importer du legacy,
 * et c'est ce qui a empêché les deux mondes de se mélanger depuis P1b.
 *
 * Recopier dix lignes de hook est le PRIX de cette frontière, et c'est un
 * prix qu'on paie sciemment plutôt que de percer la règle pour un écran. Les
 * DEUX appellent la même RPC, et c'est la RPC qui décide — pas le hook.
 *
 * `getSupabase()` rend LA MÊME INSTANCE que `@/lib/supabase` : un seul client
 * GoTrue, une seule clé de stockage, aucune course au rafraîchissement de
 * jeton. La frontière est architecturale, pas runtime.
 */

export interface PosterAssignableLocation {
  location_id: string
  location_name: string
  city: string | null
  organization_id: string
  organization_name: string
  via: 'membership' | 'platform'
}

export interface PosterResolution {
  code: string | null
  state: 'free' | 'assigned' | 'revoked' | 'unknown'
  organization_slug?: string | null
  organization_name?: string | null
  location_id?: string | null
  location_name?: string | null
  can_assign?: boolean
  assignable_locations?: PosterAssignableLocation[]
  claim?: { professional_handle: string | null; display_name: string | null } | null
}

/**
 * `resolve_poster_code` est exécutable par `anon`, et c'est une décision :
 * un client qui scanne une affiche dans un salon n'a pas de compte, et lui
 * en demander un pour lire « cette affiche n'est pas encore active » serait
 * absurde. Ce qu'elle rend à un anonyme est exactement ce qui est déjà
 * public. `retry: false` : un code inconnu n'est pas une panne réseau.
 */
export function useResolvePosterCode(code: string | undefined) {
  return useQuery({
    queryKey: ['poster', 'resolve', code],
    enabled: Boolean(code),
    retry: false,
    queryFn: async (): Promise<PosterResolution> => {
      const { data, error } = await getSupabase().rpc('resolve_poster_code', { p_code: code ?? '' })
      if (error) throw error
      return data as unknown as PosterResolution
    },
  })
}

export function useAssignPoster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { code: string; locationId: string }) => {
      const { data, error } = await getSupabase().rpc('assign_poster', {
        p_code: input.code,
        p_location_id: input.locationId,
      })
      if (error) throw error
      return data as unknown as { code: string; state: string; organization_slug: string | null; location_id: string }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['poster', 'resolve'] }),
  })
}

/**
 * Le motif NOMMÉ d'un refus serveur (`fadeup_poster_refusal=…`), lu dans
 * `details` puis dans le message. Un message brut de PostgREST n'est pas une
 * phrase qu'on montre à un patron debout dans son salon.
 */
export function posterRefusalCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const record = error as { details?: unknown; message?: unknown }
  for (const field of [record.details, record.message]) {
    if (typeof field === 'string') {
      const match = /fadeup_poster_refusal=([a-z_]+)/.exec(field)
      if (match?.[1]) return match[1]
    }
  }
  return null
}
