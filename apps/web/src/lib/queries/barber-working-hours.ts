import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Regular weekly schedule per barber. `dayOfWeek` is 0=Sunday..6=Saturday
 * (Postgres `extract(dow)` convention) — see
 * db/migrations/20260809130500_barber_working_hours.sql. Intersection with
 * `location_hours` is the appointment engine's job (later lot), not this UI.
 */
export interface BarberWorkingHours {
  id: string
  organizationId: string
  barberId: string
  dayOfWeek: number
  isOff: boolean
  startTime: string | null
  endTime: string | null
  /** Optional afternoon interval, for a day split by a midday break. Null means one continuous window. */
  secondStartTime: string | null
  secondEndTime: string | null
  createdAt: string
  updatedAt: string
}

interface BarberWorkingHoursRow {
  id: string
  organization_id: string
  barber_id: string
  day_of_week: number
  is_off: boolean
  start_time: string | null
  end_time: string | null
  second_start_time: string | null
  second_end_time: string | null
  created_at: string
  updated_at: string
}

const BARBER_WORKING_HOURS_COLUMNS =
  'id, organization_id, barber_id, day_of_week, is_off, start_time, end_time, second_start_time, second_end_time, created_at, updated_at'

function mapBarberWorkingHours(row: BarberWorkingHoursRow): BarberWorkingHours {
  return {
    id: row.id,
    organizationId: row.organization_id,
    barberId: row.barber_id,
    dayOfWeek: row.day_of_week,
    isOff: row.is_off,
    startTime: row.start_time,
    endTime: row.end_time,
    secondStartTime: row.second_start_time,
    secondEndTime: row.second_end_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Weekly working hours for every barber in the org — readable by any org member. Filter by `barberId` client-side. */
export function useOrgBarberWorkingHours(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['barber-working-hours', organizationId],
    queryFn: async (): Promise<BarberWorkingHours[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('barber_working_hours')
        .select(BARBER_WORKING_HOURS_COLUMNS)
        .eq('organization_id', organizationId)
        .order('day_of_week', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as BarberWorkingHoursRow[]).map(mapBarberWorkingHours)
    },
    enabled: Boolean(organizationId),
  })
}

export interface UpsertBarberWorkingHoursInput {
  organizationId: string
  barberId: string
  dayOfWeek: number
  isOff: boolean
  startTime: string | null
  endTime: string | null
  secondStartTime?: string | null
  secondEndTime?: string | null
}

/**
 * Create or replace a barber's working hours for one day of the week. Uses
 * `upsert` on the (barber_id, day_of_week) unique constraint so callers
 * never need to know whether a row already exists for that day. RLS
 * restricts this to owner/manager regardless of what the client sends.
 */
export function useUpsertBarberWorkingHours() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpsertBarberWorkingHoursInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('barber_working_hours').upsert(
        {
          organization_id: input.organizationId,
          barber_id: input.barberId,
          day_of_week: input.dayOfWeek,
          is_off: input.isOff,
          start_time: input.startTime,
          end_time: input.endTime,
          // Always sent, so clearing a split shift genuinely clears it rather
          // than leaving yesterday's afternoon behind on the row.
          second_start_time: input.secondStartTime ?? null,
          second_end_time: input.secondEndTime ?? null,
        },
        { onConflict: 'barber_id,day_of_week' },
      )
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['barber-working-hours', variables.organizationId] })
      // Hours are an input to every slot calculation.
      void queryClient.invalidateQueries({ queryKey: ['available-slots'] })
      void queryClient.invalidateQueries({ queryKey: ['public-available-slots'] })
    },
  })
}
