import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/** Structural inventory row — no occupancy/session state here, see db/migrations/20260809120200_chairs.sql. */
export interface Chair {
  id: string
  organizationId: string
  locationId: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface ChairRow {
  id: string
  organization_id: string
  location_id: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

function mapChair(row: ChairRow): Chair {
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** All chairs across every location in the org — readable by any org member. Group/filter by `locationId` client-side. */
export function useOrgChairs(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['chairs', organizationId],
    queryFn: async (): Promise<Chair[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('chairs')
        .select('id, organization_id, location_id, name, is_active, created_at, updated_at')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as ChairRow[]).map(mapChair)
    },
    enabled: Boolean(organizationId),
  })
}

export interface ChairInput {
  organizationId: string
  locationId: string
  name: string
  isActive: boolean
}

/** Create a chair. RLS restricts this to owner/manager regardless of what the client sends. */
export function useCreateChair() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ChairInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('chairs').insert({
        organization_id: input.organizationId,
        location_id: input.locationId,
        name: input.name,
        is_active: input.isActive,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['chairs', variables.organizationId] })
    },
  })
}

export interface UpdateChairInput extends ChairInput {
  id: string
}

/** Update a chair (rename or activate/deactivate). RLS restricts this to owner/manager regardless of what the client sends. */
export function useUpdateChair() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateChairInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('chairs')
        .update({
          location_id: input.locationId,
          name: input.name,
          is_active: input.isActive,
        })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['chairs', variables.organizationId] })
    },
  })
}
