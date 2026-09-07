import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { queueKeys } from '@/shared/data/keys'
import { parseQueueRefusal, type QueueRefusalCode } from '@/features/queue/lib/refusals'

/**
 * Face client de la Live Queue — RPC publiques uniquement, AUCUNE table.
 *
 * Vérification bloquante F1 §2, constatée dans le schéma : la CONSULTATION
 * (`get_public_queue_status`, `get_public_service_state`) n'exige ni
 * proximité, ni jeton, ni authentification. Seul `join_public_queue` exige
 * le QR du salon et des coordonnées dans la géofence — mesurées SERVEUR.
 *
 * Realtime anonyme : `anon` n'a aucun SELECT sur `queue_entries`, donc pas
 * de Postgres Changes — le POLL est le contrat (V2_DATA_CONTRACT §4) :
 * 6 s pour la file, 120 s pour l'état de service. `refetchIntervalInBackground`
 * reste false : un onglet caché ne marteler pas Kong.
 */

const QUEUE_POLL_MS = 6_000
/**
 * Le contrat V2 documente 120 s pour l'état de service ; F1 exige que la
 * bascule de mode du pro se répercute côté client « en temps réel, sans
 * rafraîchir » (§9), et `anon` n'a pas de Postgres Changes. 30 s est le
 * compromis retenu : lecture STABLE légère via Kong, latence perceptible
 * mais bornée. Décision consignée au rapport F1.
 */
const STATE_POLL_MS = 30_000

export interface PublicQueueEntry {
  id: string
  display_name: string
  status: 'waiting' | 'called' | 'in_service' | 'completed' | 'cancelled' | 'no_show'
  queue_position: number | null
  barber_display_name: string | null
}

export function usePublicQueueStatus(
  slug: string | null,
  locationId: string | null,
  options: {
    /**
     * Continuer le poll quand l'onglet est caché. FAUX par défaut (un badaud
     * qui regarde la file ne martèle pas Kong depuis un onglet oublié) ;
     * VRAI dès que le client SUIT SA PLACE : l'appel doit être impossible à
     * manquer (F1 §5), et la notification système au passage « appelé »
     * dépend de ce poll — un téléphone rangé dans la poche est exactement le
     * cas nominal.
     */
    pollInBackground?: boolean
  } = {},
) {
  return useQuery({
    queryKey: queueKeys.publicStatus(slug ?? '', locationId ?? ''),
    queryFn: async (): Promise<PublicQueueEntry[]> => {
      const { data, error } = await getSupabase().rpc('get_public_queue_status', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return (data ?? []) as PublicQueueEntry[]
    },
    enabled: Boolean(slug && locationId),
    refetchInterval: QUEUE_POLL_MS,
    refetchIntervalInBackground: options.pollInBackground ?? false,
    staleTime: 0,
  })
}

export function usePublicQueueServiceState(slug: string | null, locationId: string | null) {
  return useQuery({
    queryKey: queueKeys.publicServiceState(slug ?? '', locationId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_service_state', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(slug && locationId),
    refetchInterval: STATE_POLL_MS,
    staleTime: 30_000,
  })
}

/** Lieux publics du salon — résout `/q/:slug` sans paramètre `l`. */
export function useQueuePublicLocations(slug: string | null) {
  return useQuery({
    queryKey: queueKeys.publicLocations(slug ?? ''),
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

export function usePublicOrganizationName(slug: string | null) {
  return useQuery({
    queryKey: [...queueKeys.all, 'public-org', slug ?? ''] as const,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_organization', { p_slug: slug ?? '' })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(slug),
    staleTime: 300_000,
  })
}

/** Échec de `join_public_queue` : un des huit refus nommés, ou une erreur générique. */
export class QueueJoinRefusedError extends Error {
  readonly code: QueueRefusalCode
  constructor(code: QueueRefusalCode) {
    super(`queue join refused: ${code}`)
    this.name = 'QueueJoinRefusedError'
    this.code = code
  }
}

export interface JoinQueueInput {
  slug: string
  locationId: string
  customerName: string
  customerPhone?: string
  checkInToken: string | null
  latitude: number | null
  longitude: number | null
}

export interface JoinQueueResult {
  id: string
  status: string
  created_at: string
}

/**
 * Rejoindre la file. Le serveur tranche seul : le jeton et la position
 * partent bruts, jamais un verdict calculé côté client. Un refus nommé
 * devient `QueueJoinRefusedError` ; tout le reste suit `toAppError` en aval.
 */
export function useJoinQueue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: JoinQueueInput): Promise<JoinQueueResult> => {
      const { data, error } = await getSupabase().rpc('join_public_queue', {
        p_organization_slug: input.slug,
        p_location_id: input.locationId,
        p_customer_name: input.customerName,
        p_customer_phone: input.customerPhone ?? undefined,
        p_check_in_token: input.checkInToken ?? undefined,
        p_latitude: input.latitude ?? undefined,
        p_longitude: input.longitude ?? undefined,
      })
      if (error) {
        const refusal = parseQueueRefusal(error)
        if (refusal) throw new QueueJoinRefusedError(refusal)
        throw error
      }
      const row = data?.[0]
      if (!row) throw new Error('join_public_queue returned no row')
      return row as JoinQueueResult
    },
    onSuccess: (_result, input) => {
      // Jamais d'optimisme sur une entrée en file (contrat P1 §17) : on
      // invalide et la RPC publique fait autorité au prochain poll immédiat.
      void queryClient.invalidateQueries({ queryKey: queueKeys.publicStatus(input.slug, input.locationId) })
      void queryClient.invalidateQueries({ queryKey: queueKeys.mine() })
    },
  })
}

/** File active du client CONNECTÉ — `get_my_queue_status`, poll aligné sur la file publique. */
export function useMyQueueStatus(enabled: boolean) {
  return useQuery({
    queryKey: queueKeys.mine(),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_my_queue_status')
      if (error) throw error
      return data ?? []
    },
    enabled,
    refetchInterval: QUEUE_POLL_MS,
    // Même raison que le suivi public : l'appel doit atteindre un onglet caché.
    refetchIntervalInBackground: true,
    staleTime: 0,
  })
}
