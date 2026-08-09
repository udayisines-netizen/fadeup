import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Regular weekly opening hours per location. `dayOfWeek` is 0=Sunday..6=Saturday
 * (Postgres `extract(dow)` convention) — see
 * db/migrations/20260809130400_location_hours.sql. A day with no row is
 * treated as closed by convention.
 */
export interface LocationHours {
  id: string
  organizationId: string
  locationId: string
  dayOfWeek: number
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
  createdAt: string
  updatedAt: string
}

interface LocationHoursRow {
  id: string
  organization_id: string
  location_id: string
  day_of_week: number
  is_closed: boolean
  open_time: string | null
  close_time: string | null
  created_at: string
  updated_at: string
}

const LOCATION_HOURS_COLUMNS =
  'id, organization_id, location_id, day_of_week, is_closed, open_time, close_time, created_at, updated_at'

function mapLocationHours(row: LocationHoursRow): LocationHours {
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    dayOfWeek: row.day_of_week,
    isClosed: row.is_closed,
    openTime: row.open_time,
    closeTime: row.close_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Weekly hours for every location in the org — readable by any org member. Filter by `locationId` client-side. */
export function useOrgLocationHours(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['location-hours', organizationId],
    queryFn: async (): Promise<LocationHours[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('location_hours')
        .select(LOCATION_HOURS_COLUMNS)
        .eq('organization_id', organizationId)
        .order('day_of_week', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as LocationHoursRow[]).map(mapLocationHours)
    },
    enabled: Boolean(organizationId),
  })
}

export interface UpsertLocationHoursInput {
  organizationId: string
  locationId: string
  dayOfWeek: number
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
}

/**
 * Create or replace a location's hours for one day of the week. Uses
 * `upsert` on the (location_id, day_of_week) unique constraint so callers
 * never need to know whether a row already exists for that day. RLS
 * restricts this to owner/manager regardless of what the client sends.
 */
export function useUpsertLocationHours() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpsertLocationHoursInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('location_hours').upsert(
        {
          organization_id: input.organizationId,
          location_id: input.locationId,
          day_of_week: input.dayOfWeek,
          is_closed: input.isClosed,
          open_time: input.openTime,
          close_time: input.closeTime,
        },
        { onConflict: 'location_id,day_of_week' },
      )
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['location-hours', variables.organizationId] })
    },
  })
}
