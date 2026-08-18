import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Explicit join: which services a barber is eligible to perform. No rows
 * means not eligible for anything yet — see
 * db/migrations/20260809130300_barber_services.sql.
 */
export interface BarberService {
  organizationId: string
  barberId: string
  serviceId: string
  createdAt: string
}

interface BarberServiceRow {
  organization_id: string
  barber_id: string
  service_id: string
  created_at: string
}

function mapBarberService(row: BarberServiceRow): BarberService {
  return {
    organizationId: row.organization_id,
    barberId: row.barber_id,
    serviceId: row.service_id,
    createdAt: row.created_at,
  }
}

/** All barber/service eligibility rows across the org — readable by any org member. Filter by `serviceId`/`barberId` client-side. */
export function useOrgBarberServices(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['barber-services', organizationId],
    queryFn: async (): Promise<BarberService[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('barber_services')
        .select('organization_id, barber_id, service_id, created_at')
        .eq('organization_id', organizationId)

      if (error) throw error

      return ((data ?? []) as unknown as BarberServiceRow[]).map(mapBarberService)
    },
    enabled: Boolean(organizationId),
  })
}

export interface BarberServiceAssignmentInput {
  organizationId: string
  barberId: string
  serviceId: string
}

/** Mark a barber eligible for a service. RLS restricts this to owner/manager regardless of what the client sends. */
export function useAssignBarberService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: BarberServiceAssignmentInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('barber_services').insert({
        organization_id: input.organizationId,
        barber_id: input.barberId,
        service_id: input.serviceId,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['barber-services', variables.organizationId] })
    },
  })
}

export interface BulkBarberServiceInput {
  organizationId: string
  barberId: string
  serviceIds: string[]
}

/**
 * Make one professional eligible for many services at once, idempotently.
 *
 * Used by onboarding when the owner says they take clients: the services step
 * has already created the catalog, and a bookable professional who performs
 * none of it can never produce a slot. Doing it here rather than asking the
 * owner to tick boxes twice is the point.
 *
 * `ignoreDuplicates` matters more than it looks. barber_services is keyed on
 * (barber_id, service_id), so a plain insert throws 23505 the second time —
 * and onboarding is explicitly resumable, so "the second time" is a normal
 * path, not an edge case. Nothing is overwritten: an existing link is left
 * exactly as it was.
 *
 * RLS restricts the write to owner/manager of that organization regardless of
 * what the client sends, and the tenant-consistency trigger rejects a barber
 * or service belonging to a different organization.
 */
export function useAssignBarberServices() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: BulkBarberServiceInput) => {
      if (input.serviceIds.length === 0) return
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('barber_services').upsert(
        input.serviceIds.map((serviceId) => ({
          organization_id: input.organizationId,
          barber_id: input.barberId,
          service_id: serviceId,
        })),
        { onConflict: 'barber_id,service_id', ignoreDuplicates: true },
      )
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['barber-services', variables.organizationId] })
    },
  })
}

/** Remove a barber's eligibility for a service. RLS restricts this to owner/manager regardless of what the client sends. */
export function useUnassignBarberService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: BarberServiceAssignmentInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('barber_services')
        .delete()
        .eq('barber_id', input.barberId)
        .eq('service_id', input.serviceId)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['barber-services', variables.organizationId] })
    },
  })
}
