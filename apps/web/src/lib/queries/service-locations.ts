import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Explicit join: which locations offer a service. No rows for a service
 * means "offered nowhere yet," not "offered everywhere" — see
 * db/migrations/20260809130200_service_locations.sql.
 */
export interface ServiceLocation {
  organizationId: string
  serviceId: string
  locationId: string
  createdAt: string
}

interface ServiceLocationRow {
  organization_id: string
  service_id: string
  location_id: string
  created_at: string
}

function mapServiceLocation(row: ServiceLocationRow): ServiceLocation {
  return {
    organizationId: row.organization_id,
    serviceId: row.service_id,
    locationId: row.location_id,
    createdAt: row.created_at,
  }
}

/** All service/location assignments across the org — readable by any org member. Filter by `serviceId` client-side. */
export function useOrgServiceLocations(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['service-locations', organizationId],
    queryFn: async (): Promise<ServiceLocation[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('service_locations')
        .select('organization_id, service_id, location_id, created_at')
        .eq('organization_id', organizationId)

      if (error) throw error

      return ((data ?? []) as unknown as ServiceLocationRow[]).map(mapServiceLocation)
    },
    enabled: Boolean(organizationId),
  })
}

export interface ServiceLocationAssignmentInput {
  organizationId: string
  serviceId: string
  locationId: string
}

/** Assign a location to a service. RLS restricts this to owner/manager regardless of what the client sends. */
export function useAssignServiceLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ServiceLocationAssignmentInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('service_locations').insert({
        organization_id: input.organizationId,
        service_id: input.serviceId,
        location_id: input.locationId,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['service-locations', variables.organizationId] })
    },
  })
}

/** Unassign a location from a service. RLS restricts this to owner/manager regardless of what the client sends. */
export function useUnassignServiceLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ServiceLocationAssignmentInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('service_locations')
        .delete()
        .eq('service_id', input.serviceId)
        .eq('location_id', input.locationId)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['service-locations', variables.organizationId] })
    },
  })
}
