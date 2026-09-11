import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys } from '@/shared/data/keys'
import { useChannel } from '@/shared/realtime/useChannel'
import { parseBookingRefusal, type BookingRefusalCode } from '@/shared/lib/bookingRefusals'
import type { AgendaStatus } from '@/features/pro-agenda/lib/layout'

/**
 * OS-1 — la couche de données de l'agenda. Une fenêtre [from, to) lue par
 * `get_calendar_appointments` (RPC, SECURITY DEFINER, membre de
 * l'organisation ; le prix est NULL pour qui ne voit pas le revenu) et par
 * `time_blocks` (table, RLS org). Aucun chiffre fabriqué, aucune donnée
 * simulée.
 *
 * Écritures : toutes par RPC quand la base l'exige (déplacement, création,
 * terminé, absent, annulation, revenu) ; les blocages par INSERT/DELETE
 * directs sous RLS, une série en UN insert multi-lignes.
 *
 * Realtime : UN canal par table pour le contexte agenda, invalidation de
 * clés — le serveur reste l'autorité (P1 §17).
 */

export interface AgendaAppointmentRow {
  id: string
  starts_at: string
  ends_at: string
  status: AgendaStatus
  resolution: string | null
  expires_at: string | null
  location_id: string
  location_name: string
  location_timezone: string
  barber_id: string | null
  barber_display_name: string | null
  service_id: string | null
  service_name: string | null
  /** NULL quand le rôle ne voit pas le revenu (jamais zéro). */
  price_cents: number | null
  currency: string
  customer_name: string
  customer_phone: string | null
  notes: string | null
  created_at: string
  buffer_before_minutes: number
  buffer_after_minutes: number
  overlap_forced_at: string | null
  overlap_forced_reason: string | null
  completed_at: string | null
}

export interface TimeBlockRow {
  id: string
  organization_id: string
  location_id: string | null
  barber_id: string
  starts_at: string
  ends_at: string
  reason: string | null
  series_id: string | null
}

export class AgendaActionError extends Error {
  readonly code: BookingRefusalCode | 'unknown'
  readonly raw: unknown
  constructor(code: BookingRefusalCode | 'unknown', raw: unknown) {
    super(`agenda action refused: ${code}`)
    this.name = 'AgendaActionError'
    this.code = code
    this.raw = raw
  }
}

function throwAgendaError(error: unknown): never {
  throw new AgendaActionError(parseBookingRefusal(error) ?? 'unknown', error)
}

export interface AgendaScope {
  /** Le lieu affiché (OS-1 : le premier lieu de l'organisation). */
  locationId: string | null
  /**
   * Borne barber : un rôle `barber` ne demande que SON agenda (P1PRO §8 :
   * sa journée ; OS-1 §4 : l'accès aux autres dépend du rôle). `undefined`
   * = pas encore connu (la requête attend) ; `null` = pas de borne.
   */
  barberId: string | null | undefined
}

export function useAgendaAppointments(organizationId: string | null, fromIso: string, toIso: string, scope: AgendaScope) {
  return useQuery({
    queryKey: proKeys.agenda(organizationId ?? '', fromIso, toIso, scope.locationId ?? '', scope.barberId ?? ''),
    queryFn: async (): Promise<AgendaAppointmentRow[]> => {
      const { data, error } = await getSupabase().rpc('get_calendar_appointments', {
        p_organization_id: organizationId ?? '',
        p_from: fromIso,
        p_to: toIso,
        ...(scope.locationId ? { p_location_id: scope.locationId } : {}),
        ...(scope.barberId ? { p_barber_id: scope.barberId } : {}),
      })
      if (error) throw error
      return (data ?? []) as AgendaAppointmentRow[]
    },
    enabled: Boolean(organizationId) && scope.barberId !== undefined,
    staleTime: 15_000,
    // Changer de jour garde la grille précédente à l'écran jusqu'à l'arrivée
    // des données : pas de squelette plein écran à chaque flèche.
    placeholderData: keepPreviousData,
    // Une demande expire sur l'horloge serveur sans événement propre avant le
    // balayage : la fenêtre se rafraîchit d'elle-même de temps en temps.
    refetchInterval: 120_000,
  })
}

export function useAgendaTimeBlocks(organizationId: string | null, fromIso: string, toIso: string) {
  return useQuery({
    queryKey: proKeys.timeBlocks(organizationId ?? '', fromIso, toIso),
    queryFn: async (): Promise<TimeBlockRow[]> => {
      // Chevauchement, pas inclusion : un blocage commencé la veille compte.
      const { data, error } = await getSupabase()
        .from('time_blocks')
        .select('id, organization_id, location_id, barber_id, starts_at, ends_at, reason, series_id')
        .eq('organization_id', organizationId ?? '')
        .lt('starts_at', toIso)
        .gt('ends_at', fromIso)
        .order('starts_at')
      if (error) throw error
      return (data ?? []) as TimeBlockRow[]
    },
    enabled: Boolean(organizationId),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  })
}

export interface AgendaService {
  id: string
  name: string
  duration_minutes: number
  buffer_before_minutes: number
  buffer_after_minutes: number
  price_cents: number
  /** Les barbers aptes à ce service (barber_services). */
  barber_ids: string[]
}

/** Services actifs proposés au lieu, avec leurs barbers aptes — la réservation manuelle. */
export function useAgendaServices(organizationId: string | null, locationId: string | null) {
  return useQuery({
    queryKey: proKeys.services(organizationId ?? '', locationId ?? ''),
    queryFn: async (): Promise<AgendaService[]> => {
      const supabase = getSupabase()
      const [{ data: services, error }, { data: links, error: linksError }] = await Promise.all([
        supabase
          .from('services')
          .select('id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, service_locations!inner(location_id)')
          .eq('organization_id', organizationId ?? '')
          .eq('is_active', true)
          .eq('service_locations.location_id', locationId ?? '')
          .order('name'),
        supabase.from('barber_services').select('barber_id, service_id').eq('organization_id', organizationId ?? ''),
      ])
      if (error) throw error
      if (linksError) throw linksError
      const barbersByService = new Map<string, string[]>()
      for (const link of links ?? []) {
        const list = barbersByService.get(link.service_id) ?? []
        list.push(link.barber_id)
        barbersByService.set(link.service_id, list)
      }
      return (services ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        duration_minutes: s.duration_minutes,
        buffer_before_minutes: s.buffer_before_minutes,
        buffer_after_minutes: s.buffer_after_minutes,
        price_cents: s.price_cents,
        barber_ids: barbersByService.get(s.id) ?? [],
      }))
    },
    enabled: Boolean(organizationId && locationId),
    staleTime: 60_000,
  })
}

function useInvalidateAgenda(organizationId: string | null) {
  const queryClient = useQueryClient()
  return () => {
    if (!organizationId) return
    void queryClient.invalidateQueries({ queryKey: proKeys.agendas(organizationId) })
    void queryClient.invalidateQueries({ queryKey: [...proKeys.all, 'time-blocks', organizationId] })
    // L'accueil (TODAY/NOW/NEXT) lit la même journée.
    void queryClient.invalidateQueries({ queryKey: [...proKeys.all, 'today', organizationId] })
  }
}

export interface RescheduleInput {
  appointmentId: string
  startsAt: string
  barberId?: string | null
  force?: boolean
  forceReason?: string
}

/** Déplacer — dans le temps et entre barbers. `force` : owner/manager, motif obligatoire. */
export function useRescheduleAppointment(organizationId: string | null) {
  const invalidate = useInvalidateAgenda(organizationId)
  return useMutation({
    mutationFn: async (input: RescheduleInput) => {
      const { data, error } = await getSupabase().rpc('reschedule_appointment', {
        p_appointment_id: input.appointmentId,
        p_starts_at: input.startsAt,
        ...(input.barberId ? { p_barber_id: input.barberId } : {}),
        ...(input.force ? { p_force: true, p_force_reason: input.forceReason ?? '' } : {}),
      })
      if (error) throwAgendaError(error)
      return data
    },
    onSettled: invalidate,
  })
}

export interface CreateAppointmentInput {
  locationId: string
  barberId: string
  serviceId: string
  startsAt: string
  customerName: string
  customerPhone?: string
  customerEmail?: string
  notes?: string
  force?: boolean
  forceReason?: string
}

/** Le client qui appelle : création confirmée par le comptoir (RPC). */
export function useCreateAppointment(organizationId: string | null) {
  const invalidate = useInvalidateAgenda(organizationId)
  return useMutation({
    mutationFn: async (input: CreateAppointmentInput) => {
      const { data, error } = await getSupabase().rpc('create_appointment_as_business', {
        p_location_id: input.locationId,
        p_barber_id: input.barberId,
        p_service_id: input.serviceId,
        p_starts_at: input.startsAt,
        p_customer_name: input.customerName,
        ...(input.customerPhone ? { p_customer_phone: input.customerPhone } : {}),
        ...(input.customerEmail ? { p_customer_email: input.customerEmail } : {}),
        ...(input.notes ? { p_notes: input.notes } : {}),
        ...(input.force ? { p_force: true, p_force_reason: input.forceReason ?? '' } : {}),
      })
      if (error) throwAgendaError(error)
      return data
    },
    onSettled: invalidate,
  })
}

export function useCompleteAppointment(organizationId: string | null) {
  const invalidate = useInvalidateAgenda(organizationId)
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const { data, error } = await getSupabase().rpc('complete_appointment', { p_appointment_id: appointmentId })
      if (error) throwAgendaError(error)
      return data
    },
    onSettled: invalidate,
  })
}

/** Absent : enregistré, le créneau est libéré — AUCUNE restriction du client (MASTER_SPEC §6). */
export function useMarkNoShow(organizationId: string | null) {
  const invalidate = useInvalidateAgenda(organizationId)
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const { data, error } = await getSupabase().rpc('mark_appointment_no_show', { p_appointment_id: appointmentId })
      if (error) throwAgendaError(error)
      return data
    },
    onSettled: invalidate,
  })
}

/** Annuler côté salon : la RPC notifie le client (notification + e-mail). */
export function useCancelAppointment(organizationId: string | null) {
  const invalidate = useInvalidateAgenda(organizationId)
  return useMutation({
    mutationFn: async (input: { appointmentId: string; note?: string }) => {
      const { data, error } = await getSupabase().rpc('cancel_appointment_as_business', {
        p_appointment_id: input.appointmentId,
        ...(input.note ? { p_note: input.note } : {}),
      })
      if (error) throwAgendaError(error)
      return data
    },
    onSettled: invalidate,
  })
}

export interface TimeBlockInsert {
  organization_id: string
  location_id: string | null
  barber_id: string
  starts_at: string
  ends_at: string
  reason: string | null
  series_id: string | null
}

/** Bloquer du temps : ponctuel (1 ligne) ou récurrent (N lignes, un seul INSERT atomique). */
export function useCreateTimeBlocks(organizationId: string | null) {
  const invalidate = useInvalidateAgenda(organizationId)
  return useMutation({
    mutationFn: async (rows: TimeBlockInsert[]) => {
      const { error } = await getSupabase().from('time_blocks').insert(rows)
      if (error) throwAgendaError(error)
    },
    onSettled: invalidate,
  })
}

/** Retirer un blocage, ou toute sa série. */
export function useDeleteTimeBlocks(organizationId: string | null) {
  const invalidate = useInvalidateAgenda(organizationId)
  return useMutation({
    mutationFn: async (input: { id: string; seriesId?: string | null; scope: 'one' | 'series' }) => {
      const query = getSupabase().from('time_blocks').delete()
      const { error } =
        input.scope === 'series' && input.seriesId ? await query.eq('series_id', input.seriesId) : await query.eq('id', input.id)
      if (error) throwAgendaError(error)
    },
    onSettled: invalidate,
  })
}

/** Le patron règle, barber par barber, qui voit le revenu (owner seulement). */
export function useSetRevenueVisibility(organizationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { membershipId: string; visible: boolean }) => {
      const { data, error } = await getSupabase().rpc('set_membership_revenue_visibility', {
        p_membership_id: input.membershipId,
        p_visible: input.visible,
      })
      if (error) throwAgendaError(error)
      return data
    },
    onSettled: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: proKeys.barbers(organizationId) })
    },
  })
}

/**
 * Canal du CONTEXTE agenda : rendez-vous et blocages de l'organisation.
 * Invalidation par préfixe (toute fenêtre montée refetch) — jamais confiance
 * au payload. `memberships` aussi : un réglage de revenu se propage.
 */
export function useAgendaChannel(organizationId: string | null): void {
  const queryClient = useQueryClient()
  const invalidateAppointments = () => {
    if (!organizationId) return
    void queryClient.invalidateQueries({ queryKey: proKeys.agendas(organizationId) })
    void queryClient.invalidateQueries({ queryKey: [...proKeys.all, 'today', organizationId] })
  }
  const invalidateBlocks = () => {
    if (organizationId) void queryClient.invalidateQueries({ queryKey: [...proKeys.all, 'time-blocks', organizationId] })
  }
  const invalidateMembers = () => {
    if (organizationId) void queryClient.invalidateQueries({ queryKey: proKeys.barbers(organizationId) })
  }
  useChannel({
    name: organizationId ? `pro-agenda-appointments:${organizationId}` : null,
    table: 'appointments',
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    onInsert: invalidateAppointments,
    onUpdate: invalidateAppointments,
    onDelete: invalidateAppointments,
    onReconnect: invalidateAppointments,
  })
  useChannel({
    name: organizationId ? `pro-agenda-blocks:${organizationId}` : null,
    table: 'time_blocks',
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    onInsert: invalidateBlocks,
    onUpdate: invalidateBlocks,
    onDelete: invalidateBlocks,
    onReconnect: invalidateBlocks,
  })
  useChannel({
    name: organizationId ? `pro-agenda-members:${organizationId}` : null,
    table: 'memberships',
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    onUpdate: invalidateMembers,
    onReconnect: invalidateMembers,
  })
}
