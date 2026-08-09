import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Service catalog entry. `priceCents` is integer cents (never a float
 * dollar amount) — see db/migrations/20260809130100_services.sql. Forms
 * should accept a dollar amount and convert both ways at the UI boundary.
 */
export interface Service {
  id: string
  organizationId: string
  categoryId: string | null
  name: string
  description: string | null
  durationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  priceCents: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface ServiceRow {
  id: string
  organization_id: string
  category_id: string | null
  name: string
  description: string | null
  duration_minutes: number
  buffer_before_minutes: number
  buffer_after_minutes: number
  price_cents: number
  is_active: boolean
  created_at: string
  updated_at: string
}

const SERVICE_COLUMNS =
  'id, organization_id, category_id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, is_active, created_at, updated_at'

function mapService(row: ServiceRow): Service {
  return {
    id: row.id,
    organizationId: row.organization_id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    priceCents: row.price_cents,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** All services for the given org — readable by any org member. */
export function useOrgServices(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['services', organizationId],
    queryFn: async (): Promise<Service[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('services')
        .select(SERVICE_COLUMNS)
        .eq('organization_id', organizationId)
        .order('name', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as ServiceRow[]).map(mapService)
    },
    enabled: Boolean(organizationId),
  })
}

export interface ServiceInput {
  organizationId: string
  categoryId: string | null
  name: string
  description: string | null
  durationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  priceCents: number
  isActive: boolean
}

function toRowPayload(input: ServiceInput) {
  return {
    organization_id: input.organizationId,
    category_id: input.categoryId,
    name: input.name,
    description: input.description,
    duration_minutes: input.durationMinutes,
    buffer_before_minutes: input.bufferBeforeMinutes,
    buffer_after_minutes: input.bufferAfterMinutes,
    price_cents: input.priceCents,
    is_active: input.isActive,
  }
}

/** Create a service. RLS restricts this to owner/manager regardless of what the client sends. */
export function useCreateService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ServiceInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('services').insert(toRowPayload(input))
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['services', variables.organizationId] })
    },
  })
}

export interface UpdateServiceInput extends ServiceInput {
  id: string
}

/** Update a service. RLS restricts this to owner/manager regardless of what the client sends. */
export function useUpdateService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateServiceInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('services').update(toRowPayload(input)).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['services', variables.organizationId] })
    },
  })
}
