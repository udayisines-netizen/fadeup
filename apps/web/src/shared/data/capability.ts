import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { capabilityKeys } from '@/shared/data/keys'

/**
 * P1PRO — « Réservable » ou « Sur demande » ? La capacité commerciale
 * `booking` de l'organisation décide de l'ISSUE du tunnel (B2) : présente →
 * confirmation immédiate ; absente (non revendiqué OU plan Free) → une
 * DEMANDE part, sous échéance. Le client doit le savoir AVANT le tunnel,
 * pas à la dernière étape (P1PRO §7).
 *
 * `true` = confirme immédiatement · `false` = sur demande · `null` =
 * inconnu (organisation introuvable ou lecture en échec) — un `null`
 * n'affirme RIEN : les surfaces retombent sur leur comportement d'avant.
 */

export function usePublicBookingCapability(slug: string | null) {
  return useQuery({
    queryKey: capabilityKeys.organization(slug ?? ''),
    queryFn: async (): Promise<boolean | null> => {
      const { data, error } = await getSupabase().rpc('get_public_booking_capability', {
        p_organization_slug: slug ?? '',
      })
      if (error) throw error
      return data?.[0]?.accepts_immediate_booking ?? null
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

/**
 * La même vérité en LOT pour la découverte (`get_public_booking_capabilities`,
 * max 50 slugs) — une page de résultats ne fait pas un appel par carte.
 * Un slug absent de la réponse reste `undefined` (rien d'affirmé).
 */
export function usePublicBookingCapabilities(slugs: readonly string[]) {
  const sorted = [...new Set(slugs)].sort()
  return useQuery({
    queryKey: capabilityKeys.batch(sorted),
    queryFn: async (): Promise<Record<string, boolean>> => {
      const { data, error } = await getSupabase().rpc('get_public_booking_capabilities', {
        p_organization_slugs: sorted.slice(0, 50),
      })
      if (error) throw error
      return Object.fromEntries(
        (data ?? []).map((row) => [row.organization_slug, row.accepts_immediate_booking]),
      )
    },
    enabled: sorted.length > 0,
    staleTime: 60_000,
  })
}
