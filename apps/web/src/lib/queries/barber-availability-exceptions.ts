import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Date-specific override of a barber's regular schedule (time off, holiday,
 * or an adjusted window). One row per (barber, date) — see
 * db/migrations/20260809130600_barber_availability_exceptions.sql.
 */
export interface BarberAvailabilityException {
  id: string
  organizationId: string
  barberId: string
  exceptionDate: string
  isUnavailable: boolean
  startTime: string | null
  endTime: string | null
  reason: string | null
  createdAt: string
  updatedAt: string
}

interface BarberAvailabilityExceptionRow {
  id: string
  organization_id: string
  barber_id: string
  exception_date: string
  is_unavailable: boolean
  start_time: string | null
  end_time: string | null
  reason: string | null
  created_at: string
  updated_at: string
}

const BARBER_AVAILABILITY_EXCEPTION_COLUMNS =
  'id, organization_id, barber_id, exception_date, is_unavailable, start_time, end_time, reason, created_at, updated_at'

function mapBarberAvailabilityException(row: BarberAvailabilityExceptionRow): BarberAvailabilityException {
  return {
    id: row.id,
    organizationId: row.organization_id,
    barberId: row.barber_id,
    exceptionDate: row.exception_date,
    isUnavailable: row.is_unavailable,
    startTime: row.start_time,
    endTime: row.end_time,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Availability exceptions for a single barber, soonest first — readable by any org member. */
export function useBarberAvailabilityExceptions(organizationId: string | undefined, barberId: string | undefined) {
  return useQuery({
    queryKey: ['barber-availability-exceptions', organizationId, barberId],
    queryFn: async (): Promise<BarberAvailabilityException[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('barber_availability_exceptions')
        .select(BARBER_AVAILABILITY_EXCEPTION_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('barber_id', barberId)
        .order('exception_date', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as BarberAvailabilityExceptionRow[]).map(mapBarberAvailabilityException)
    },
    enabled: Boolean(organizationId) && Boolean(barberId),
  })
}

export interface CreateBarberAvailabilityExceptionInput {
  organizationId: string
  barberId: string
  exceptionDate: string
  isUnavailable: boolean
  startTime: string | null
  endTime: string | null
  reason: string | null
}

/**
 * Create a date-specific override. RLS restricts this to owner/manager
 * regardless of what the client sends. The (barber_id, exception_date)
 * unique constraint means creating a second override for a date the barber
 * already has one for will fail — surfaced to the caller as a normal error.
 */
export function useCreateBarberAvailabilityException() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateBarberAvailabilityExceptionInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('barber_availability_exceptions').insert({
        organization_id: input.organizationId,
        barber_id: input.barberId,
        exception_date: input.exceptionDate,
        is_unavailable: input.isUnavailable,
        start_time: input.startTime,
        end_time: input.endTime,
        reason: input.reason,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['barber-availability-exceptions', variables.organizationId, variables.barberId],
      })
    },
  })
}

export interface DeleteBarberAvailabilityExceptionInput {
  id: string
  organizationId: string
  barberId: string
}

/** Delete a date-specific override. RLS restricts this to owner/manager regardless of what the client sends. */
export function useDeleteBarberAvailabilityException() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: DeleteBarberAvailabilityExceptionInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('barber_availability_exceptions').delete().eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['barber-availability-exceptions', variables.organizationId, variables.barberId],
      })
    },
  })
}
