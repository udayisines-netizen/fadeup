import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { queueKeys } from '@/shared/data/keys'
import { useChannel, type RealtimeChangePayload } from '@/shared/realtime/useChannel'

/**
 * Face pro de la Live Queue. Les écritures passent par `.from('queue_entries')`
 * sous RLS — c'est LE contrat (V2_DATA_CONTRACT §2 « File pro ») : les
 * triggers `enforce_queue_transition` (transitions avant uniquement,
 * horodatage serveur) et `restrict_queue_entry_self_update` (rôles) font
 * autorité, jamais le client.
 *
 * C'est aussi le SEUL endroit du produit où l'écriture directe dans le cache
 * Query est autorisée (P1 §17, F1 §4) : la latence compte quand un barber
 * appelle quelqu'un. Le canal `queue:<location_id>` écrit les payloads dans
 * la clé `queueKeys.pro(locationId)` ; la reconnexion invalide et refetch.
 */

export const ACTIVE_QUEUE_STATUSES = ['waiting', 'called', 'in_service'] as const

export interface ProQueueEntry {
  id: string
  location_id: string
  barber_id: string | null
  customer_name: string
  status: 'waiting' | 'called' | 'in_service' | 'completed' | 'cancelled' | 'no_show'
  created_at: string
  called_at: string | null
  service_started_at: string | null
}

const ENTRY_COLUMNS = 'id, location_id, barber_id, customer_name, status, created_at, called_at, service_started_at'

function isActive(status: string): boolean {
  return (ACTIVE_QUEUE_STATUSES as readonly string[]).includes(status)
}

function sortByCreation(rows: ProQueueEntry[]): ProQueueEntry[] {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export function useProQueue(locationId: string | null) {
  return useQuery({
    queryKey: queueKeys.pro(locationId ?? ''),
    queryFn: async (): Promise<ProQueueEntry[]> => {
      const { data, error } = await getSupabase()
        .from('queue_entries')
        .select(ENTRY_COLUMNS)
        .eq('location_id', locationId ?? '')
        .in('status', [...ACTIVE_QUEUE_STATUSES])
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as ProQueueEntry[]
    },
    enabled: Boolean(locationId),
    staleTime: 15_000,
  })
}

/** Écrit un événement realtime DIRECTEMENT dans le cache de la file. */
function applyChange(rows: ProQueueEntry[], change: RealtimeChangePayload): ProQueueEntry[] {
  if (change.eventType === 'DELETE') {
    const oldId = change.old?.id
    return typeof oldId === 'string' ? rows.filter((row) => row.id !== oldId) : rows
  }
  const next = change.new as unknown as ProQueueEntry | null
  if (!next || typeof next.id !== 'string') return rows
  const without = rows.filter((row) => row.id !== next.id)
  if (!isActive(next.status)) return without
  return sortByCreation([...without, next])
}

/**
 * Canal `queue:<location_id>` — UN canal pour l'écran, jamais par composant
 * (shared/realtime). Le démontage de l'écran ferme le canal (preuve e2e).
 */
export function useProQueueChannel(locationId: string | null): void {
  const queryClient = useQueryClient()

  const write = useCallback(
    (change: RealtimeChangePayload) => {
      if (!locationId) return
      queryClient.setQueryData<ProQueueEntry[]>(queueKeys.pro(locationId), (rows) =>
        applyChange(rows ?? [], change),
      )
    },
    [queryClient, locationId],
  )

  useChannel({
    name: locationId ? `queue:${locationId}` : null,
    table: 'queue_entries',
    filter: locationId ? `location_id=eq.${locationId}` : undefined,
    onInsert: write,
    onUpdate: write,
    onDelete: write,
    onReconnect: () => {
      // Les événements manqués pendant la coupure ne reviendront pas :
      // refetch complet, seule réponse honnête.
      if (locationId) void queryClient.invalidateQueries({ queryKey: queueKeys.pro(locationId) })
    },
  })
}

interface TransitionInput {
  entryId: string
  status: 'called' | 'in_service' | 'completed' | 'cancelled' | 'no_show'
}

async function transition(input: TransitionInput): Promise<ProQueueEntry> {
  const { data, error } = await getSupabase()
    .from('queue_entries')
    .update({ status: input.status })
    .eq('id', input.entryId)
    .select(ENTRY_COLUMNS)
    .single()
  if (error) throw error
  return data as ProQueueEntry
}

/**
 * Transition d'une entrée. Le résultat serveur (horodaté par le trigger)
 * est écrit directement dans le cache — pas d'optimisme : rien ne bouge
 * tant que la base n'a pas accepté.
 */
export function useQueueTransition(locationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: transition,
    onSuccess: (row) => {
      if (!locationId) return
      queryClient.setQueryData<ProQueueEntry[]>(queueKeys.pro(locationId), (rows) => {
        const without = (rows ?? []).filter((existing) => existing.id !== row.id)
        return isActive(row.status) ? sortByCreation([...without, row]) : without
      })
    },
  })
}

/**
 * « Terminé » libère le fauteuil et appelle IMPLICITEMENT le suivant
 * (F1 §4). Deux écritures serveur successives ; si la seconde échoue (file
 * vide entre-temps), le terminé reste acquis.
 */
export function useCompleteAndCallNext(locationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { entryId: string }): Promise<ProQueueEntry[]> => {
      const done = await transition({ entryId: input.entryId, status: 'completed' })
      const results: ProQueueEntry[] = [done]
      const { data: nextWaiting, error } = await getSupabase()
        .from('queue_entries')
        .select(ENTRY_COLUMNS)
        .eq('location_id', locationId ?? '')
        .eq('status', 'waiting')
        .order('created_at', { ascending: true })
        .limit(1)
      if (!error && nextWaiting?.[0]) {
        results.push(await transition({ entryId: (nextWaiting[0] as ProQueueEntry).id, status: 'called' }))
      }
      return results
    },
    onSuccess: (rows) => {
      if (!locationId) return
      queryClient.setQueryData<ProQueueEntry[]>(queueKeys.pro(locationId), (existing) => {
        let next = existing ?? []
        for (const row of rows) {
          next = next.filter((entry) => entry.id !== row.id)
          if (isActive(row.status)) next = [...next, row]
        }
        return sortByCreation(next)
      })
    },
  })
}

/** Jeton QR + les trois seuils du lieu — owner/manager/réceptionniste. */
export function useQueueCheckIn(locationId: string | null) {
  return useQuery({
    queryKey: queueKeys.checkIn(locationId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_location_queue_check_in', {
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(locationId),
    staleTime: 300_000,
    // Un rôle barber reçoit 42501 : pas un incident, l'écran dégrade
    // (pas de seuils, pas de QR) sans marteler la RPC.
    retry: false,
  })
}

export function useRegenerateCheckInToken(locationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await getSupabase().rpc('regenerate_location_queue_check_in_token', {
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      if (locationId) void queryClient.invalidateQueries({ queryKey: queueKeys.checkIn(locationId) })
    },
  })
}

/** État des modes côté pro (location + overrides barbers). */
export function useServiceModeState(locationId: string | null) {
  return useQuery({
    queryKey: queueKeys.proModes(locationId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_service_mode_state', {
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(locationId),
    staleTime: 30_000,
  })
}

export function useSetQueueOpen(locationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (queueOpen: boolean) => {
      const { data, error } = await getSupabase().rpc('set_location_queue_open', {
        p_location_id: locationId ?? '',
        p_queue_open: queueOpen,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      if (locationId) void queryClient.invalidateQueries({ queryKey: queueKeys.proModes(locationId) })
    },
  })
}

/** Un barber du lieu, avec l'état de SA file (F1b). */
export interface ProQueueBarber {
  id: string
  queue_enabled: boolean
  is_bookable: boolean
  display_name: string
}

/**
 * Les barbers du lieu, côté pro — lecture RLS directe (org member), y
 * compris les non publics : le comptoir déplace vers qui travaille vraiment.
 */
export function useProQueueBarbers(locationId: string | null) {
  return useQuery({
    queryKey: queueKeys.proBarbers(locationId ?? ''),
    queryFn: async (): Promise<ProQueueBarber[]> => {
      const { data, error } = await getSupabase()
        .from('barbers')
        .select('id, queue_enabled, is_bookable, staff_profiles!inner(display_name, location_id, is_active)')
        .eq('staff_profiles.location_id', locationId ?? '')
        .eq('staff_profiles.is_active', true)
      if (error) throw error
      return (data ?? [])
        .map((row) => ({
          id: row.id as string,
          queue_enabled: row.queue_enabled as boolean,
          is_bookable: row.is_bookable as boolean,
          display_name: (row.staff_profiles as unknown as { display_name: string }).display_name,
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
    },
    enabled: Boolean(locationId),
    staleTime: 60_000,
  })
}

/**
 * Déplacer un client vers une autre file (owner/manager/réceptionniste ET
 * barber — F1b §2). Le client garde son ancienneté ; la trace part en base
 * (queue_entry_moves). Pas d'optimisme : on invalide, le serveur fait foi.
 */
export function useMoveQueueEntry(locationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { entryId: string; toBarberId: string | null }) => {
      const { data, error } = await getSupabase().rpc('move_queue_entry', {
        p_entry_id: input.entryId,
        p_to_barber_id: input.toBarberId ?? undefined,
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    onSuccess: () => {
      if (locationId) void queryClient.invalidateQueries({ queryKey: queueKeys.pro(locationId) })
    },
  })
}

/** Couper ou rouvrir la file d'UN barber (owner/manager — F1b §2). */
export function useSetBarberQueueEnabled(locationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { barberId: string; enabled: boolean }) => {
      const { data, error } = await getSupabase().rpc('set_barber_queue_enabled', {
        p_barber_id: input.barberId,
        p_enabled: input.enabled,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      if (locationId) void queryClient.invalidateQueries({ queryKey: queueKeys.proBarbers(locationId) })
    },
  })
}

/** Balayage de grâce du lieu : off par défaut, décision du patron (F1b §6). */
export function useSetGraceSweep(locationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data, error } = await getSupabase().rpc('set_location_queue_grace_sweep', {
        p_location_id: locationId ?? '',
        p_enabled: enabled,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      if (locationId) void queryClient.invalidateQueries({ queryKey: queueKeys.checkIn(locationId) })
    },
  })
}

/** Transparence F1b : déclaré vs observé, par barber et par service. */
export interface DurationInsight {
  barber_id: string | null
  barber_display_name: string | null
  service_id: string
  service_name: string
  declared_minutes: number
  observed_minutes: number | null
  sample_count: number
  estimate_capped: boolean
}

export function useDurationInsights(locationId: string | null) {
  return useQuery({
    queryKey: queueKeys.durationInsights(locationId ?? ''),
    queryFn: async (): Promise<DurationInsight[]> => {
      const { data, error } = await getSupabase().rpc('get_service_duration_insights', {
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return (data ?? []) as DurationInsight[]
    },
    enabled: Boolean(locationId),
    staleTime: 60_000,
  })
}

export type ServiceMode = 'hybrid' | 'reservation_only' | 'queue_only' | 'unavailable'

export function useSetServiceMode(locationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (mode: ServiceMode) => {
      const { data, error } = await getSupabase().rpc('set_location_service_mode', {
        p_location_id: locationId ?? '',
        p_mode: mode,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      if (locationId) void queryClient.invalidateQueries({ queryKey: queueKeys.proModes(locationId) })
    },
  })
}
