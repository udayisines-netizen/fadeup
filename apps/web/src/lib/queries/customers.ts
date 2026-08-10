import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Real customer entity (LOT 12) — see db/migrations/20260809180000_customers.sql.
 * Populated both directly by staff here and automatically by the
 * `link_customer_from_contact_info` trigger on appointments/queue_entries
 * (matched by phone then email at booking time).
 */
export interface Customer {
  id: string
  organizationId: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface CustomerRow {
  id: string
  organization_id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

const CUSTOMER_COLUMNS = 'id, organization_id, name, phone, email, notes, created_at, updated_at'

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * All customers for the org, most-recently-updated first — readable by any
 * org member (barbers seeing who they're serving), matching `customers`
 * RLS. Search is a client-side filter over this list (see `app-customers-page.tsx`)
 * rather than a server-side query — shops run in the hundreds to low
 * thousands of customers, not a scale where that trade-off shows.
 */
export function useOrgCustomers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['customers', organizationId],
    queryFn: async (): Promise<Customer[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })

      if (error) throw error

      return ((data ?? []) as unknown as CustomerRow[]).map(mapCustomer)
    },
    enabled: Boolean(organizationId),
  })
}

export interface CreateCustomerInput {
  organizationId: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
}

/** Create a customer directly (not via the booking auto-link trigger). RLS restricts this to owner/manager/receptionist. */
export function useCreateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateCustomerInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('customers').insert({
        organization_id: input.organizationId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        notes: input.notes,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['customers', variables.organizationId] })
    },
  })
}

export interface UpdateCustomerInput {
  id: string
  organizationId: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
}

/** Update a customer's own fields. RLS restricts this to owner/manager/receptionist. */
export function useUpdateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateCustomerInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('customers')
        .update({
          name: input.name,
          phone: input.phone,
          email: input.email,
          notes: input.notes,
        })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['customers', variables.organizationId] })
    },
  })
}
