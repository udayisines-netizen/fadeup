import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/** Marks a `staff_profiles` row as a bookable barber. See db/migrations/20260809120100_barbers.sql. */
export interface Barber {
  id: string
  organizationId: string
  staffProfileId: string
  isBookable: boolean
  createdAt: string
  updatedAt: string
}

interface BarberRow {
  id: string
  organization_id: string
  staff_profile_id: string
  is_bookable: boolean
  created_at: string
  updated_at: string
}

function mapBarber(row: BarberRow): Barber {
  return {
    id: row.id,
    organizationId: row.organization_id,
    staffProfileId: row.staff_profile_id,
    isBookable: row.is_bookable,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** All barber rows for the given org — readable by any org member. */
export function useOrgBarbers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['barbers', organizationId],
    queryFn: async (): Promise<Barber[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('barbers')
        .select('id, organization_id, staff_profile_id, is_bookable, created_at, updated_at')
        .eq('organization_id', organizationId)

      if (error) throw error

      return ((data ?? []) as unknown as BarberRow[]).map(mapBarber)
    },
    enabled: Boolean(organizationId),
  })
}

export interface SetBarberBookableInput {
  organizationId: string
  staffProfileId: string
  /** The existing `barbers.id` for this staff member, or null if none exists yet. */
  barberId: string | null
  isBookable: boolean
}

/**
 * Toggle whether a staff member is a bookable barber.
 *
 * Design decision: revoking barber status sets `is_bookable = false` rather
 * than deleting the `barbers` row (a soft toggle, not a hard delete). Barber
 * -specific data added in later lots — service eligibility (LOT 7),
 * commission rules (LOT 17) — attaches to this row's `id`; deleting it the
 * moment a shop takes someone off the schedule would orphan/lose that state,
 * and re-granting later would mean recreating the row (and a new id) from
 * scratch. It also matches the `is_active`-style soft-state convention
 * already used by `locations`, `chairs` and `staff_profiles` elsewhere in
 * this lot. Granting for the first time still requires an insert, since a
 * `barbers` row is optional (unique per staff_profile) and most staff never
 * get one.
 */
export function useSetBarberBookable() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: SetBarberBookableInput) => {
      const supabase = getSupabaseClient()

      if (input.barberId) {
        const { error } = await supabase
          .from('barbers')
          .update({ is_bookable: input.isBookable })
          .eq('id', input.barberId)
        if (error) throw error
        return
      }

      // No barbers row exists yet. Turning "off" a barber that was never
      // bookable is a no-op; turning "on" requires creating the row.
      if (!input.isBookable) return

      const { error } = await supabase.from('barbers').insert({
        organization_id: input.organizationId,
        staff_profile_id: input.staffProfileId,
        is_bookable: true,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['barbers', variables.organizationId] })
    },
  })
}
