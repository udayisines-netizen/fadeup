import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

export interface Location {
  id: string
  organizationId: string
  name: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  timezone: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface LocationRow {
  id: string
  organization_id: string
  name: string
  address_line1: string | null
  address_line2: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  timezone: string
  is_active: boolean
  created_at: string
  updated_at: string
}

const LOCATION_COLUMNS =
  'id, organization_id, name, address_line1, address_line2, city, region, postal_code, country, timezone, is_active, created_at, updated_at'

function mapLocation(row: LocationRow): Location {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    timezone: row.timezone,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Locations for the given org. `organizationId` must come from the caller's
 * real membership (see `useCurrentOrg`) — RLS also enforces membership
 * server-side, this filter just keeps the query itself tenant-scoped.
 */
export function useOrgLocations(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['locations', organizationId],
    queryFn: async (): Promise<Location[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('locations')
        .select(LOCATION_COLUMNS)
        .eq('organization_id', organizationId)
        .order('name', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as LocationRow[]).map(mapLocation)
    },
    enabled: Boolean(organizationId),
  })
}

export interface LocationInput {
  organizationId: string
  name: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  timezone: string
  isActive: boolean
}

function toRowPayload(input: LocationInput) {
  return {
    organization_id: input.organizationId,
    name: input.name,
    address_line1: input.addressLine1,
    address_line2: input.addressLine2,
    city: input.city,
    region: input.region,
    postal_code: input.postalCode,
    country: input.country,
    timezone: input.timezone,
    is_active: input.isActive,
  }
}

/** Create a location. RLS restricts this to owner/manager regardless of what the client sends. */
export function useCreateLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: LocationInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('locations').insert(toRowPayload(input))
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['locations', variables.organizationId] })
    },
  })
}

export interface UpdateLocationInput extends LocationInput {
  id: string
}

/** Update a location. RLS restricts this to owner/manager regardless of what the client sends. */
export function useUpdateLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateLocationInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('locations').update(toRowPayload(input)).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['locations', variables.organizationId] })
    },
  })
}
