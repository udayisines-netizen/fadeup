import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { ProspectSuppressionScope } from './types'

export interface ProspectSuppression {
  id: string
  scope: ProspectSuppressionScope
  prospectId: string | null
  value: string | null
  reason: string
  createdBy: string | null
  createdAt: string
}

interface ProspectSuppressionRow {
  id: string
  scope: ProspectSuppressionScope
  prospect_id: string | null
  value: string | null
  reason: string
  created_by: string | null
  created_at: string
}

function mapSuppression(row: ProspectSuppressionRow): ProspectSuppression {
  return {
    id: row.id,
    scope: row.scope,
    prospectId: row.prospect_id,
    value: row.value,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

const SUPPRESSION_COLUMNS = 'id, scope, prospect_id, value, reason, created_by, created_at'

/** Global Do Not Contact list — identifier-scoped rows block re-selection even under a freshly-discovered prospect id. */
export function useProspectSuppressions() {
  return useQuery({
    queryKey: ['acquisition', 'suppressions'],
    queryFn: async (): Promise<ProspectSuppression[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('prospect_suppressions').select(SUPPRESSION_COLUMNS).order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as ProspectSuppressionRow[]).map(mapSuppression)
    },
  })
}

export interface CreateSuppressionInput {
  scope: ProspectSuppressionScope
  prospectId: string | null
  value: string | null
  reason: string
}

/** Direct INSERT — RLS grants platform_owner/platform_admin write on this table, no RPC needed (see migration header). */
export function useCreateProspectSuppression() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateSuppressionInput) => {
      const supabase = getSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('prospect_suppressions').insert({
        scope: input.scope,
        prospect_id: input.prospectId,
        value: input.value,
        reason: input.reason,
        created_by: user?.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'suppressions'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospects'] })
    },
  })
}
