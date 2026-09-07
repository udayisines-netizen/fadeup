import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { discoveryKeys, organizationKeys } from '@/shared/data/keys'
import { deriveProfileCta, type ProfileCtaState, type PublicServiceStateRow } from '@/shared/lib/serviceState'
import type { Database } from '@/shared/lib/database.types'

/**
 * F3 — LE contrat de la recherche marketplace, partagé entre /search
 * (features/discovery) et l'accueil (features/home) : `features/X` n'importe
 * jamais `features/Y`, la couche vit donc ici, comme publicQueue (F2).
 *
 * LOI PRODUIT (MASTER_SPEC §2, V6) : l'offre marketplace = Independent +
 * Barbershop, exactement. `p_entity_type: 'shop'` est TOUJOURS passé,
 * explicitement — B1 a inversé le défaut en base (NULL signifie déjà 'shop'),
 * mais une surface marketplace ne repose pas sur un défaut distant pour une
 * loi produit (P1 §17). Un barber salarié n'est jamais un résultat autonome.
 */

/** La ligne de résultat — les 31 colonnes du contrat B1 + F3 (is_managed). */
export type ProfessionalSearchRow =
  Database['public']['Functions']['search_public_professionals']['Returns'][number]

/** Le sous-ensemble d'arguments que les surfaces consumer utilisent. */
export interface ProfessionalSearchArgs {
  p_query?: string
  p_city?: string
  p_service_query?: string
  p_latitude?: number
  p_longitude?: number
  p_radius_km?: number
  p_min_price_cents?: number
  p_max_price_cents?: number
  p_open_now_only?: boolean
  p_sort?: string
  p_limit?: number
}

export const SEARCH_PAGE_SIZE = 20

async function fetchSearchPage(
  args: ProfessionalSearchArgs,
  offset: number,
): Promise<ProfessionalSearchRow[]> {
  const { data, error } = await getSupabase().rpc('search_public_professionals', {
    ...args,
    // La restriction marketplace, EXPLICITE — jamais déléguée au défaut.
    p_entity_type: 'shop',
    p_limit: args.p_limit ?? SEARCH_PAGE_SIZE,
    p_offset: offset,
  })
  if (error) throw error
  return data ?? []
}

/** La recherche paginée de /search — « charger plus », total exact du serveur. */
export function useProfessionalSearch(args: ProfessionalSearchArgs, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: discoveryKeys.search(args as Record<string, unknown>),
    queryFn: ({ pageParam }) => fetchSearchPage(args, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const total = lastPage[0]?.total_count ?? 0
      const loaded = allPages.reduce((n, page) => n + page.length, 0)
      return loaded < total && lastPage.length > 0 ? loaded : undefined
    },
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  })
}

/** Une tranche unique (accueil « à découvrir », élargissements, replis). */
export function useProfessionalSearchSlice(
  key: readonly unknown[],
  args: ProfessionalSearchArgs,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: key,
    queryFn: () => fetchSearchPage(args, 0),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  })
}

/**
 * Devise par organisation, en UNE lecture groupée (`get_public_currencies`).
 * Sans devise résolue, un prix ne s'affiche pas : formater un montant dans
 * une devise devinée serait une donnée fabriquée.
 */
export function useResultCurrencies(organizationIds: readonly string[]) {
  const sorted = [...new Set(organizationIds)].sort()
  return useQuery({
    queryKey: discoveryKeys.currencies(sorted),
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await getSupabase().rpc('get_public_currencies', {
        p_organization_ids: sorted as string[],
      })
      if (error) throw error
      return Object.fromEntries((data ?? []).map((row) => [row.organization_id, row.currency]))
    },
    enabled: sorted.length > 0,
    staleTime: 5 * 60_000,
  })
}

/**
 * « Disponible maintenant » = l'entité peut réellement servir dans les 60
 * prochaines minutes, par créneau ou par file ACCESSIBLE (MASTER_SPEC §8).
 * Être ouvert ne suffit pas. La seule preuve publique dont un écran de liste
 * dispose est `get_public_service_state` : une file qui accepte = on peut s'y
 * mettre maintenant. Une réservation qui accepte ne prouve PAS un créneau
 * dans l'heure (aucune lecture groupée de créneaux n'existe) : elle se dit
 * « réservable », jamais « disponible maintenant ».
 */
export type ResultAvailability = 'loading' | 'unknown' | 'available-now' | 'bookable' | 'closed'

export function toResultAvailability(cta: ProfileCtaState): ResultAvailability {
  if (cta.kind === 'loading') return 'loading'
  if (cta.kind === 'unknown') return 'unknown'
  if (cta.queueOpen) return 'available-now'
  if (cta.kind === 'bookable') return 'bookable'
  return 'closed'
}

export interface ResultServiceStates {
  /** location_id -> disponibilité dérivée de l'état de service réel. */
  byLocation: Record<string, ResultAvailability>
  /** Toutes les réponses de la page sont arrivées (succès ou échec dit). */
  settled: boolean
}

/**
 * L'état de service de chaque lieu affiché — mêmes clés de cache que le
 * profil salon (organizationKeys.serviceState), donc arriver sur un profil
 * depuis la recherche part d'un état déjà chaud. Sans poll : une liste de
 * vingt lieux ne martèle pas Kong ; le profil, lui, poll (décision F1/F2).
 */
export function useResultServiceStates(
  locations: ReadonlyArray<{ slug: string; locationId: string }>,
): ResultServiceStates {
  const unique = [...new Map(locations.map((l) => [l.locationId, l])).values()]
  return useQueries({
    queries: unique.map((l) => ({
      queryKey: organizationKeys.serviceState(l.slug, l.locationId, null),
      queryFn: async (): Promise<PublicServiceStateRow | null> => {
        const { data, error } = await getSupabase().rpc('get_public_service_state', {
          p_organization_slug: l.slug,
          p_location_id: l.locationId,
        })
        if (error) throw error
        return (data?.[0] as PublicServiceStateRow | undefined) ?? null
      },
      staleTime: 30_000,
    })),
    combine: (results) => ({
      byLocation: Object.fromEntries(
        results.map((result, index) => [
          unique[index]?.locationId ?? '',
          toResultAvailability(
            deriveProfileCta(result.data, { isError: result.isError, isLoading: result.isPending }),
          ),
        ]),
      ),
      settled: results.every((result) => !result.isPending),
    }),
  })
}

/**
 * Le prix « à partir de » d'une rangée : le minimum RÉEL des services actifs
 * du lieu (calculé serveur), dans la devise de l'organisation. Sans prix
 * publié ou sans devise résolue : absent — l'interface affiche « — », jamais
 * une estimation (loi produit §2).
 */
export function startingPrice(
  row: Pick<ProfessionalSearchRow, 'starting_price_cents' | 'organization_id'>,
  currencyByOrganization: Record<string, string> | undefined,
): { cents: number; currency: string } | null {
  const currency = currencyByOrganization?.[row.organization_id]
  if (row.starting_price_cents === null || row.starting_price_cents === undefined || !currency) return null
  return { cents: row.starting_price_cents, currency }
}
