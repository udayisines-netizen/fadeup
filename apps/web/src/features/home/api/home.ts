import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { bookingKeys, profileKeys, queueKeys } from '@/shared/data/keys'
import type { Database } from '@/shared/lib/database.types'

/**
 * F3 — la couche data de l'accueil. RPC du contrat client (V2_DATA_CONTRACT
 * §1) : `get_my_queue_status`, `get_my_appointments`,
 * `list_my_followed_professionals` — plus le suivi F1b
 * `get_queue_entry_tracking` pour le client ANONYME dont l'entrée vit en
 * mémoire locale.
 *
 * Les clés sont PARTAGÉES avec les features existantes (mêmes fabriques,
 * mêmes RPC) : le badge Réservations du shell (features/bookings) et cet
 * écran lisent le même cache, et les invalidations F1b (rejoindre/quitter)
 * rafraîchissent l'accueil sans fil supplémentaire.
 */

const MY_QUEUE_POLL_MS = 10_000

export type MyQueueStatusRow =
  Database['public']['Functions']['get_my_queue_status']['Returns'][number]
export type MyAppointmentRow =
  Database['public']['Functions']['get_my_appointments']['Returns'][number]
export type FollowedProfessionalRow =
  Database['public']['Functions']['list_my_followed_professionals']['Returns'][number]

/** La file active du client CONNECTÉ — position réelle, poll court. */
export function useMyQueueStatus(enabled: boolean) {
  return useQuery({
    queryKey: queueKeys.mine(),
    queryFn: async (): Promise<MyQueueStatusRow[]> => {
      const { data, error } = await getSupabase().rpc('get_my_queue_status')
      if (error) throw error
      return data ?? []
    },
    enabled,
    refetchInterval: MY_QUEUE_POLL_MS,
    staleTime: 0,
  })
}

/**
 * Le suivi de l'entrée LOCALE d'un client anonyme (jointe par QR, F1b).
 * Même clé de cache que /q/:slug. En échec (entrée disparue), l'accueil ne
 * montre simplement rien — l'écran de file reste l'endroit qui explique.
 */
export interface AnonymousQueueTracking {
  status: 'waiting' | 'called' | 'in_service' | 'completed' | 'cancelled' | 'no_show'
  queue_position: number | null
}

export function useAnonymousQueueTracking(entryId: string | null) {
  return useQuery({
    queryKey: queueKeys.tracking(entryId ?? ''),
    queryFn: async (): Promise<AnonymousQueueTracking | null> => {
      const { data, error } = await getSupabase().rpc('get_queue_entry_tracking', {
        p_entry_id: entryId ?? '',
      })
      if (error) throw error
      return (data?.[0] as AnonymousQueueTracking | undefined) ?? null
    },
    enabled: Boolean(entryId),
    refetchInterval: MY_QUEUE_POLL_MS,
    staleTime: 0,
    retry: 1,
  })
}

/** Mes rendez-vous — même clé et même RPC que le badge du shell. */
export function useMyAppointments(enabled: boolean) {
  return useQuery({
    queryKey: bookingKeys.list({ scope: 'upcoming' }),
    queryFn: async (): Promise<MyAppointmentRow[]> => {
      const { data, error } = await getSupabase().rpc('get_my_appointments')
      if (error) throw error
      return data ?? []
    },
    enabled,
    staleTime: 60_000,
  })
}

/** Les professionnels suivis — même clé que le bouton Suivre de F2. */
export function useFollowedProfessionals(enabled: boolean) {
  return useQuery({
    queryKey: profileKeys.myFollowedProfessionals(),
    queryFn: async (): Promise<FollowedProfessionalRow[]> => {
      const { data, error } = await getSupabase().rpc('list_my_followed_professionals')
      if (error) throw error
      return data ?? []
    },
    enabled,
    staleTime: 60_000,
  })
}

/** Le prochain rendez-vous réel : confirmé ou en attente, dans le futur. */
export function nextAppointment(rows: MyAppointmentRow[] | undefined, now: Date): MyAppointmentRow | null {
  const upcoming = (rows ?? [])
    .filter(
      (row) =>
        (row.status === 'confirmed' || row.status === 'pending') && Date.parse(row.starts_at) > now.getTime(),
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  return upcoming[0] ?? null
}

/** Le dernier rendez-vous HONORÉ — la graine de « réserver à nouveau ». */
export function lastCompletedAppointment(rows: MyAppointmentRow[] | undefined): MyAppointmentRow | null {
  const completed = (rows ?? [])
    .filter((row) => row.status === 'completed')
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
  return completed[0] ?? null
}

/** La file active parmi les entrées du client (waiting/called/in_service). */
export function activeQueueEntry(rows: MyQueueStatusRow[] | undefined): MyQueueStatusRow | null {
  return (
    (rows ?? []).find(
      (row) => row.status === 'waiting' || row.status === 'called' || row.status === 'in_service',
    ) ?? null
  )
}
