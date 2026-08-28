import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * The professional-claim review queue.
 *
 * R1B shipped the whole lifecycle — submit, withdraw, review — and no interface
 * at all, so every claim filed since has rested in `pending` with nobody able to
 * see it. This is that interface.
 *
 * WHAT THE REVIEWER IS ACTUALLY DECIDING
 *
 * Approving is the ONLY path in the system that moves a professional identity
 * from `unclaimed` to `claimed`, and there is no reverse edge except account
 * erasure. R1B made taking over a claimed profile unrepresentable rather than
 * merely difficult, which means an approval is effectively permanent — so the
 * UI must not present it as a routine two-click action.
 *
 * R1B also deliberately built NO verification engine: a claim rests in pending
 * until a human decides, because shipping weak self-service verification would
 * let someone assert they are a professional whose profile they merely found.
 * The reviewer IS the verification. The screen's job is to give them the
 * evidence and then get out of the way.
 *
 * WHAT IS NOT HERE, ON PURPOSE
 *
 * There is no internal reviewer note, because `professional_claims` has no such
 * column. R1A had to close exactly that leak on
 * professional_applications.internal_note, where a row-level policy plus a
 * table-wide SELECT grant handed the applicant the reviewer's private
 * assessment. `decision_note` is written FOR the claimant and they can read it;
 * the UI says so next to the field, so nobody types a private assessment into
 * a box the subject will read.
 */

export type ProfessionalClaimState = 'pending' | 'approved' | 'rejected' | 'withdrawn'

export interface ProfessionalClaim {
  id: string
  professionalId: string
  claimantUserId: string
  state: ProfessionalClaimState
  /** The claimant's own account of why this identity is theirs. Free text; R1B stores it and verifies nothing. */
  evidence: string | null
  submittedAt: string
  decidedAt: string | null
  /** Written FOR the claimant, and readable by them. There is deliberately no second, hidden note. */
  decisionNote: string | null
}

interface ProfessionalClaimRow {
  id: string
  professional_id: string
  claimant_user_id: string
  state: ProfessionalClaimState
  evidence: string | null
  submitted_at: string
  decided_at: string | null
  decision_note: string | null
}

const CLAIM_COLUMNS =
  'id, professional_id, claimant_user_id, state, evidence, submitted_at, decided_at, decision_note'

function mapClaim(row: ProfessionalClaimRow): ProfessionalClaim {
  return {
    id: row.id,
    professionalId: row.professional_id,
    claimantUserId: row.claimant_user_id,
    state: row.state,
    evidence: row.evidence,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  }
}

/**
 * Claims by state. RLS restricts this to the caller's own claims or, for
 * platform staff, all of them — so the same hook serves both audiences and the
 * database decides which.
 */
export function useProfessionalClaims(state?: ProfessionalClaimState) {
  return useQuery({
    queryKey: ['professional-claims', state ?? 'all'],
    queryFn: async (): Promise<ProfessionalClaim[]> => {
      const supabase = getSupabaseClient()
      let query = supabase.from('professional_claims').select(CLAIM_COLUMNS)

      if (state === 'pending') {
        // Oldest first: a review queue, and somebody has been waiting.
        query = query.eq('state', 'pending').order('submitted_at', { ascending: true })
      } else {
        if (state) query = query.eq('state', state)
        query = query.order('submitted_at', { ascending: false })
      }

      const { data, error } = await query
      if (error) throw error
      return ((data ?? []) as ProfessionalClaimRow[]).map(mapClaim)
    },
  })
}

export interface ClaimedIdentity {
  id: string
  displayName: string
  handle: string | null
  claimState: 'unclaimed' | 'claimed'
  source: string | null
  createdAt: string
}

interface ClaimedIdentityRow {
  id: string
  display_name: string
  handle: string | null
  claim_state: 'unclaimed' | 'claimed'
  source: string | null
  created_at: string
}

/**
 * The identities a set of claims points at, in one request.
 *
 * Batched deliberately: a per-card lookup would issue one round trip per claim
 * and turn a twenty-row queue into twenty-one requests.
 */
export function useProfessionalsByIds(ids: string[]) {
  const unique = [...new Set(ids)].sort()

  return useQuery({
    queryKey: ['professionals', 'by-ids', unique],
    enabled: unique.length > 0,
    queryFn: async (): Promise<Map<string, ClaimedIdentity>> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('professionals')
        .select('id, display_name, handle, claim_state, source, created_at')
        .in('id', unique)
      if (error) throw error

      const map = new Map<string, ClaimedIdentity>()
      for (const row of (data ?? []) as ClaimedIdentityRow[]) {
        map.set(row.id, {
          id: row.id,
          displayName: row.display_name,
          handle: row.handle,
          claimState: row.claim_state,
          source: row.source,
          createdAt: row.created_at,
        })
      }
      return map
    },
  })
}

/**
 * Approves or rejects a claim. Platform staff only, enforced in the RPC body.
 *
 * The RPC does considerably more than flip a state: it locks the identity so
 * two simultaneous approvals produce exactly one winner, closes every sibling
 * claim on the same identity, writes platform_audit_log, and derives any
 * prospect conversion from the claimant's own single owner membership rather
 * than trusting a caller-supplied organization. None of that is replicated
 * here, and none of it should be.
 */
export function useReviewProfessionalClaim() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { claimId: string; decision: 'approve' | 'reject'; note?: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('review_professional_claim', {
        p_claim_id: input.claimId,
        p_decision: input.decision,
        p_note: input.note?.trim() ? input.note.trim() : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['professional-claims'] })
      void queryClient.invalidateQueries({ queryKey: ['professionals'] })
    },
  })
}
