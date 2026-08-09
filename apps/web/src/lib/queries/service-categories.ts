import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/** Optional grouping for services (e.g. "Haircuts", "Beard"). See db/migrations/20260809130000_service_categories.sql. */
export interface ServiceCategory {
  id: string
  organizationId: string
  name: string
  displayOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface ServiceCategoryRow {
  id: string
  organization_id: string
  name: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

const SERVICE_CATEGORY_COLUMNS = 'id, organization_id, name, display_order, is_active, created_at, updated_at'

function mapServiceCategory(row: ServiceCategoryRow): ServiceCategory {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    displayOrder: row.display_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Service categories for the given org — readable by any org member. */
export function useOrgServiceCategories(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['service-categories', organizationId],
    queryFn: async (): Promise<ServiceCategory[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('service_categories')
        .select(SERVICE_CATEGORY_COLUMNS)
        .eq('organization_id', organizationId)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as ServiceCategoryRow[]).map(mapServiceCategory)
    },
    enabled: Boolean(organizationId),
  })
}

export interface ServiceCategoryInput {
  organizationId: string
  name: string
  displayOrder: number
  isActive: boolean
}

function toRowPayload(input: ServiceCategoryInput) {
  return {
    organization_id: input.organizationId,
    name: input.name,
    display_order: input.displayOrder,
    is_active: input.isActive,
  }
}

/** Create a service category. RLS restricts this to owner/manager regardless of what the client sends. */
export function useCreateServiceCategory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ServiceCategoryInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('service_categories').insert(toRowPayload(input))
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['service-categories', variables.organizationId] })
    },
  })
}

export interface UpdateServiceCategoryInput extends ServiceCategoryInput {
  id: string
}

/** Update a service category. RLS restricts this to owner/manager regardless of what the client sends. */
export function useUpdateServiceCategory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateServiceCategoryInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('service_categories').update(toRowPayload(input)).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['service-categories', variables.organizationId] })
    },
  })
}

export interface DeleteServiceCategoryInput {
  id: string
  organizationId: string
}

/**
 * Delete a service category. RLS restricts this to owner/manager regardless
 * of what the client sends. Services referencing this category have
 * `category_id` set to null by the database (`on delete set null`) rather
 * than being deleted themselves.
 */
export function useDeleteServiceCategory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: DeleteServiceCategoryInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('service_categories').delete().eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['service-categories', variables.organizationId] })
      void queryClient.invalidateQueries({ queryKey: ['services', variables.organizationId] })
    },
  })
}
