import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { bookingKeys, queueKeys } from '@/shared/data/keys'
import { useSession } from '@/shared/hooks/useSession'

/**
 * Signal d'activité RÉEL pour le badge de l'onglet Réservations : une
 * demande en attente ou une file active. Un point, pas un compteur (P1b §7),
 * et jamais une donnée fabriquée — sans session ou sans donnée, pas de badge.
 * P2 étoffera cette feature ; la clé de query est déjà la bonne.
 */
export function useBookingActivity(): { hasActivity: boolean } {
  const { session } = useSession()

  const appointments = useQuery({
    queryKey: bookingKeys.list({ scope: 'upcoming' }),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_my_appointments')
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(session),
    staleTime: 60_000,
  })

  const queue = useQuery({
    queryKey: queueKeys.mine(),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_my_queue_status')
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(session),
    staleTime: 30_000,
  })

  const hasPendingRequest = (appointments.data ?? []).some((row) => row.status === 'pending')
  const hasActiveQueue = (queue.data ?? []).some(
    (row) => row.status === 'waiting' || row.status === 'called' || row.status === 'in_service',
  )

  return { hasActivity: hasPendingRequest || hasActiveQueue }
}
