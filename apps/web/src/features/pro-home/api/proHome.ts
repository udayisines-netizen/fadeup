import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys, queueKeys } from '@/shared/data/keys'
import { useChannel } from '@/shared/realtime/useChannel'
import { useSession } from '@/shared/hooks/useSession'

/**
 * P1PRO — les données RÉELLES de l'accueil pro. Aucun chiffre fabriqué :
 * l'agenda vient de `get_calendar_appointments`, la file de `queue_entries`
 * (RLS org), le revenu est CALCULÉ depuis les prix configurés des
 * prestations TERMINÉES du jour (MASTER_SPEC §14 — aucun montant encaissé
 * n'existe, par design).
 */

export interface TodayAppointment {
  id: string
  starts_at: string
  ends_at: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  resolution: string | null
  expires_at: string | null
  location_id: string
  location_name: string
  location_timezone: string
  barber_id: string | null
  barber_display_name: string | null
  service_id: string | null
  service_name: string | null
  price_cents: number | null
  currency: string
  customer_name: string
  customer_phone: string | null
  notes: string | null
  created_at: string
}

/** La journée LOCALE de l'appareil — le pro est physiquement au salon. */
function deviceDayRange(): { from: string; to: string; day: string } {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return { from: from.toISOString(), to: to.toISOString(), day: from.toISOString().slice(0, 10) }
}

export function useProToday(organizationId: string | null) {
  const { day, from, to } = deviceDayRange()
  return useQuery({
    queryKey: proKeys.today(organizationId ?? '', day),
    queryFn: async (): Promise<TodayAppointment[]> => {
      const { data, error } = await getSupabase().rpc('get_calendar_appointments', {
        p_organization_id: organizationId ?? '',
        p_from: from,
        p_to: to,
      })
      if (error) throw error
      return (data ?? []) as TodayAppointment[]
    },
    enabled: Boolean(organizationId),
    staleTime: 15_000,
  })
}

export interface QueueSummaryEntry {
  id: string
  status: 'waiting' | 'called' | 'in_service'
  customer_name: string
  created_at: string
}

export function useProQueueSummary(organizationId: string | null, enabled = true) {
  return useQuery({
    queryKey: proKeys.queueSummary(organizationId ?? ''),
    queryFn: async (): Promise<QueueSummaryEntry[]> => {
      const { data, error } = await getSupabase()
        .from('queue_entries')
        .select('id, status, customer_name, created_at')
        .eq('organization_id', organizationId ?? '')
        .in('status', ['waiting', 'called', 'in_service'])
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as QueueSummaryEntry[]
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: 15_000,
  })
}

/**
 * L'identité barber du compte CONNECTÉ dans cette organisation — pour que
 * l'accueil d'un barber salarié parle de SA journée. `null` = ce compte n'a
 * pas de fauteuil (owner non coiffeur, réceptionniste).
 */
export function useMyBarberId(organizationId: string | null) {
  const { session } = useSession()
  const userId = session?.user.id ?? null
  return useQuery({
    queryKey: [...proKeys.all, 'my-barber', organizationId ?? '', userId ?? ''] as const,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await getSupabase()
        .from('barbers')
        .select('id, staff_profiles!inner(user_id)')
        .eq('organization_id', organizationId ?? '')
        .eq('staff_profiles.user_id', userId ?? '')
        .limit(1)
      if (error) throw error
      return data?.[0]?.id ?? null
    },
    enabled: Boolean(organizationId && userId),
    staleTime: 300_000,
  })
}

/** « Terminé » en un geste (MASTER_SPEC §14). */
export function useCompleteAppointment(organizationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const { data, error } = await getSupabase().rpc('complete_appointment', {
        p_appointment_id: appointmentId,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: proKeys.all })
    },
  })
}

/**
 * Canal du CONTEXTE accueil : les rendez-vous et la file de l'organisation.
 * Invalidation de clés, jamais confiance au payload (P1 §17) — l'écriture
 * directe de cache reste le privilège exclusif de l'écran file (F1).
 */
export function useProHomeChannel(organizationId: string | null): void {
  const queryClient = useQueryClient()

  const invalidateAppointments = () => {
    void queryClient.invalidateQueries({ queryKey: proKeys.all })
  }
  const invalidateQueue = () => {
    if (organizationId) {
      void queryClient.invalidateQueries({ queryKey: proKeys.queueSummary(organizationId) })
      void queryClient.invalidateQueries({ queryKey: queueKeys.all })
    }
  }

  useChannel({
    name: organizationId ? `pro-home-appointments:${organizationId}` : null,
    table: 'appointments',
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    onInsert: invalidateAppointments,
    onUpdate: invalidateAppointments,
    onReconnect: invalidateAppointments,
  })
  useChannel({
    name: organizationId ? `pro-home-queue:${organizationId}` : null,
    table: 'queue_entries',
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    onInsert: invalidateQueue,
    onUpdate: invalidateQueue,
    onDelete: invalidateQueue,
    onReconnect: invalidateQueue,
  })
}
