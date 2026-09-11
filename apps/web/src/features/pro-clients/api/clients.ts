import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys } from '@/shared/data/keys'
import type { CustomerSegment } from '@/features/pro-clients/lib/crm'

/**
 * OS-2 — la couche de données des fiches clients. Tout passe par les RPC
 * `SECURITY DEFINER` du CRM, bornées à UNE organisation côté serveur :
 * l'interface ne filtre rien, elle affiche ce que la base accepte de rendre.
 *
 * Les types générés (`database.types.ts`) déclarent les colonnes calculées
 * comme non-nullables ; la base, elle, renvoie `NULL` pour un client sans
 * historique (rythme, dernière visite, barber habituel). Les interfaces
 * ci-dessous disent la VÉRITÉ — `null` n'est pas `0`, et l'écran l'affiche
 * « — ».
 */

export const CUSTOMERS_PAGE_SIZE = 50

export interface CustomerListRow {
  customer_id: string
  display_name: string
  phone: string | null
  email: string | null
  /** Non nul = le client a une identité FadeUp. */
  user_id: string | null
  /** FAIT serveur : identité FadeUp + prestation délivrée. Jamais déduit ici. */
  is_verified_client: boolean
  completed_count: number
  first_completed_at: string | null
  last_completed_at: string | null
  days_since_last: number | null
  average_interval_days: number | null
  expected_return_at: string | null
  is_lapsed: boolean
  usual_barber_id: string | null
  usual_barber_name: string | null
  upcoming_at: string | null
  /** Total serveur de la requête, répété sur chaque ligne. */
  total_count: number
}

export interface CustomerDetail {
  customer_id: string
  organization_id: string
  display_name: string
  phone: string | null
  email: string | null
  user_id: string | null
  is_verified_client: boolean
  verified_since: string | null
  completed_count: number
  first_completed_at: string | null
  last_completed_at: string | null
  days_since_last: number | null
  average_interval_days: number | null
  expected_return_at: string | null
  is_lapsed: boolean
  usual_barber_id: string | null
  usual_barber_name: string | null
  note_count: number
  created_at: string
}

export interface CustomerHistoryRow {
  kind: string
  source_id: string
  occurred_at: string
  status: string
  service_id: string | null
  service_name: string | null
  barber_id: string | null
  barber_name: string | null
  /** Prix COURANT du catalogue, pas un encaissement. `null` = pas de prix. */
  price_cents: number | null
}

export interface CustomerNote {
  id: string
  body: string
  author_user_id: string | null
  author_display_name: string | null
  author_is_me: boolean
  /** Autorité serveur : l'auteur, ou owner/manager. Le front ne devine pas. */
  can_edit: boolean
  created_at: string
  updated_at: string
}

export interface CustomerListParams {
  search: string
  segment: CustomerSegment
  /** Page 0-indexée : l'offset est `page * CUSTOMERS_PAGE_SIZE`. */
  page: number
}

export interface CustomerListPage {
  rows: CustomerListRow[]
  totalCount: number
}

async function fetchCustomers(
  organizationId: string,
  segment: CustomerSegment,
  search: string,
  limit: number,
  offset: number,
): Promise<CustomerListPage> {
  const { data, error } = await getSupabase().rpc('list_organization_customers', {
    p_organization_id: organizationId,
    p_segment: segment,
    p_limit: limit,
    p_offset: offset,
    ...(search ? { p_search: search } : {}),
  })
  if (error) throw error
  const rows = (data ?? []) as unknown as CustomerListRow[]
  // Le total vient du serveur (répété sur chaque ligne) : aucune page vide
  // ne fabrique un total, elle en rend zéro.
  return { rows, totalCount: rows[0]?.total_count ?? 0 }
}

export function useOrganizationCustomers(organizationId: string | null, params: CustomerListParams) {
  return useQuery({
    queryKey: [...proKeys.clientList(organizationId ?? '', params.search, params.segment), params.page],
    queryFn: () =>
      fetchCustomers(
        organizationId ?? '',
        params.segment,
        params.search,
        CUSTOMERS_PAGE_SIZE,
        params.page * CUSTOMERS_PAGE_SIZE,
      ),
    enabled: Boolean(organizationId),
    staleTime: 30_000,
    // Changer de page ou affiner la recherche garde la liste précédente à
    // l'écran : pas de squelette qui clignote à chaque frappe.
    placeholderData: keepPreviousData,
  })
}

/**
 * Le compte des clients non revenus — une requête à UNE ligne dont on ne lit
 * que `total_count`. C'est ce compte SERVEUR qui décide du bloc d'appel ;
 * rien n'est déduit des lignes déjà chargées.
 */
export function useLapsedCustomerCount(organizationId: string | null) {
  return useQuery({
    queryKey: [...proKeys.clientList(organizationId ?? '', '', 'lapsed'), 'total'],
    queryFn: async (): Promise<number> => {
      const page = await fetchCustomers(organizationId ?? '', 'lapsed', '', 1, 0)
      return page.totalCount
    },
    enabled: Boolean(organizationId),
    staleTime: 60_000,
  })
}

export function useOrganizationCustomer(organizationId: string | null, customerId: string | null) {
  return useQuery({
    queryKey: proKeys.client(organizationId ?? '', customerId ?? ''),
    queryFn: async (): Promise<CustomerDetail | null> => {
      const { data, error } = await getSupabase().rpc('get_organization_customer', {
        p_customer_id: customerId ?? '',
      })
      if (error) throw error
      const rows = (data ?? []) as unknown as CustomerDetail[]
      return rows[0] ?? null
    },
    enabled: Boolean(organizationId && customerId),
    staleTime: 30_000,
    retry: false,
  })
}

export function useCustomerHistory(organizationId: string | null, customerId: string | null) {
  return useQuery({
    queryKey: proKeys.clientHistory(organizationId ?? '', customerId ?? ''),
    queryFn: async (): Promise<CustomerHistoryRow[]> => {
      const { data, error } = await getSupabase().rpc('get_organization_customer_history', {
        p_customer_id: customerId ?? '',
      })
      if (error) throw error
      return (data ?? []) as unknown as CustomerHistoryRow[]
    },
    enabled: Boolean(organizationId && customerId),
    staleTime: 30_000,
    retry: false,
  })
}

export function useCustomerNotes(organizationId: string | null, customerId: string | null) {
  return useQuery({
    queryKey: proKeys.clientNotes(organizationId ?? '', customerId ?? ''),
    queryFn: async (): Promise<CustomerNote[]> => {
      const { data, error } = await getSupabase().rpc('list_customer_notes', {
        p_customer_id: customerId ?? '',
      })
      if (error) throw error
      return (data ?? []) as unknown as CustomerNote[]
    },
    enabled: Boolean(organizationId && customerId),
    staleTime: 15_000,
    retry: false,
  })
}

function useInvalidateCustomer(organizationId: string | null, customerId: string | null) {
  const queryClient = useQueryClient()
  return () => {
    if (!organizationId || !customerId) return
    void queryClient.invalidateQueries({ queryKey: proKeys.clientNotes(organizationId, customerId) })
    // `note_count` vit sur la fiche : elle bouge avec les notes.
    void queryClient.invalidateQueries({ queryKey: proKeys.client(organizationId, customerId) })
  }
}

export function useAddCustomerNote(organizationId: string | null, customerId: string | null) {
  const invalidate = useInvalidateCustomer(organizationId, customerId)
  return useMutation({
    mutationFn: async (body: string) => {
      const { error } = await getSupabase().rpc('add_customer_note', {
        p_customer_id: customerId ?? '',
        p_body: body,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useUpdateCustomerNote(organizationId: string | null, customerId: string | null) {
  const invalidate = useInvalidateCustomer(organizationId, customerId)
  return useMutation({
    mutationFn: async (input: { noteId: string; body: string }) => {
      const { error } = await getSupabase().rpc('update_customer_note', {
        p_note_id: input.noteId,
        p_body: input.body,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteCustomerNote(organizationId: string | null, customerId: string | null) {
  const invalidate = useInvalidateCustomer(organizationId, customerId)
  return useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await getSupabase().rpc('delete_customer_note', { p_note_id: noteId })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
