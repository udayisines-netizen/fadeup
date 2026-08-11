import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { ProspectDuplicateStatus } from './types'

export interface ProspectDuplicatePair {
  id: string
  prospectId: string
  duplicateOfProspectId: string
  confidence: number
  reason: string
  status: ProspectDuplicateStatus
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
}

interface ProspectDuplicateRow {
  id: string
  prospect_id: string
  duplicate_of_prospect_id: string
  confidence: number
  reason: string
  status: ProspectDuplicateStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

function mapDuplicate(row: ProspectDuplicateRow): ProspectDuplicatePair {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    duplicateOfProspectId: row.duplicate_of_prospect_id,
    confidence: row.confidence,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  }
}

const DUPLICATE_COLUMNS =
  'id, prospect_id, duplicate_of_prospect_id, confidence, reason, status, reviewed_by, reviewed_at, created_at'

/** Duplicate candidate pairs — never auto-merged, always awaiting (or resolved by) platform-staff review. */
export function useProspectDuplicates(status?: ProspectDuplicateStatus) {
  return useQuery({
    queryKey: ['acquisition', 'duplicates', status ?? 'all'],
    queryFn: async (): Promise<ProspectDuplicatePair[]> => {
      const supabase = getSupabaseClient()
      let query = supabase.from('prospect_duplicates').select(DUPLICATE_COLUMNS).order('created_at', { ascending: false })
      if (status) query = query.eq('status', status)
      const { data, error } = await query
      if (error) throw error
      return ((data ?? []) as ProspectDuplicateRow[]).map(mapDuplicate)
    },
  })
}

/** Confirms or rejects a duplicate candidate — a plain UPDATE; prospect_duplicates_stamp_review auto-stamps reviewed_by/reviewed_at. Platform owner/admin only. */
export function useResolveProspectDuplicate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; status: 'confirmed_duplicate' | 'confirmed_distinct' }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('prospect_duplicates').update({ status: input.status }).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'duplicates'] })
    },
  })
}
