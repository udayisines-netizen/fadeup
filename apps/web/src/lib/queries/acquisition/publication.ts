import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { ProspectEntityKind, ProspectType } from './types'

/**
 * The external-profile publication queue.
 *
 * Reads `public.prospect_publication_queue`, a deliberately narrow view: name,
 * country, kind, domain and the gate's own evidence, and NONE of the commercial
 * score, contact details or sales pipeline state that live on the same prospect
 * row. The publication decision is about whether a business is real and
 * nameable, not whether it is a good lead, and the view exists so this screen
 * cannot widen its own projection.
 *
 * Writes go through `public.publish_external_professional`, which is
 * platform-admin only and re-checks the live gate. The `is_eligible` flag here
 * comes from a CACHE refreshed by the Worker, so it can be stale — a candidate
 * this screen offers may be refused at the moment of publishing. That is the
 * designed failure mode and the UI surfaces the reason rather than pretending
 * it cannot happen.
 */

/** The vocabulary of public.publication_block_reason. Not free text. */
export type PublicationBlockReason =
  | 'prospect_not_found'
  | 'do_not_contact'
  | 'suppressed_prospect'
  | 'suppressed_phone'
  | 'suppressed_email'
  | 'suppressed_domain'
  | 'already_converted'
  | 'already_customer'
  | 'entity_kind_not_publishable'
  | 'already_published'
  | 'name_not_publishable'
  | 'unresolved_duplicate'
  | 'insufficient_source_evidence'
  | 'no_corroborating_location'

export interface PublicationCandidate {
  prospectId: string
  canonicalName: string
  country: string
  entityKind: ProspectEntityKind
  prospectType: ProspectType
  websiteDomain: string | null
  firstDiscoveredAt: string
  isEligible: boolean
  blockReason: PublicationBlockReason | null
  distinctSourceCount: number
  hasTrustAnchor: boolean
  evaluatedAt: string
  professionalId: string | null
  isPublished: boolean
}

interface PublicationQueueRow {
  prospect_id: string
  canonical_name: string
  country: string
  entity_kind: ProspectEntityKind
  prospect_type: ProspectType
  website_domain: string | null
  first_discovered_at: string
  is_eligible: boolean
  block_reason: PublicationBlockReason | null
  distinct_source_count: number
  has_trust_anchor: boolean
  evaluated_at: string
  professional_id: string | null
  is_published: boolean
}

// One literal, deliberately not concatenated: supabase-js parses this string as
// a TYPE, and a concatenated expression degrades to GenericStringError[] — which
// then needs an `as unknown as` cast that would silence real mistakes too.
const QUEUE_COLUMNS =
  'prospect_id, canonical_name, country, entity_kind, prospect_type, website_domain, first_discovered_at, is_eligible, block_reason, distinct_source_count, has_trust_anchor, evaluated_at, professional_id, is_published'

function mapCandidate(row: PublicationQueueRow): PublicationCandidate {
  return {
    prospectId: row.prospect_id,
    canonicalName: row.canonical_name,
    country: row.country,
    entityKind: row.entity_kind,
    prospectType: row.prospect_type,
    websiteDomain: row.website_domain,
    firstDiscoveredAt: row.first_discovered_at,
    isEligible: row.is_eligible,
    blockReason: row.block_reason,
    distinctSourceCount: row.distinct_source_count,
    hasTrustAnchor: row.has_trust_anchor,
    evaluatedAt: row.evaluated_at,
    professionalId: row.professional_id,
    isPublished: row.is_published,
  }
}

export type PublicationFilter = 'eligible' | 'blocked' | 'published'

/**
 * One page of the queue.
 *
 * Paged rather than fetched whole: this table grows with every prospect the
 * Worker discovers, and a screen that loaded all of them would get slower every
 * day until somebody noticed.
 */
export function usePublicationQueue(filter: PublicationFilter, limit = 50) {
  return useQuery({
    queryKey: ['acquisition', 'publication-queue', filter, limit],
    queryFn: async (): Promise<PublicationCandidate[]> => {
      const supabase = getSupabaseClient()
      let query = supabase.from('prospect_publication_queue').select(QUEUE_COLUMNS).limit(limit)

      if (filter === 'published') {
        query = query.eq('is_published', true).order('evaluated_at', { ascending: false })
      } else if (filter === 'eligible') {
        // Oldest evaluation first: the review queue is a work queue, and the
        // candidate that has been waiting longest is the one to look at.
        query = query.eq('is_eligible', true).eq('is_published', false).order('evaluated_at', { ascending: true })
      } else {
        query = query
          .eq('is_eligible', false)
          .eq('is_published', false)
          .order('evaluated_at', { ascending: false })
      }

      const { data, error } = await query
      if (error) throw error
      return ((data ?? []) as PublicationQueueRow[]).map(mapCandidate)
    },
  })
}

/** Counts for the tab labels, so an operator can see there is work without opening the tab. */
export function usePublicationQueueCounts() {
  return useQuery({
    queryKey: ['acquisition', 'publication-queue', 'counts'],
    queryFn: async (): Promise<{ eligible: number; blocked: number; published: number }> => {
      const supabase = getSupabaseClient()

      const [eligible, blocked, published] = await Promise.all([
        supabase
          .from('prospect_publication_queue')
          .select('prospect_id', { count: 'exact', head: true })
          .eq('is_eligible', true)
          .eq('is_published', false),
        supabase
          .from('prospect_publication_queue')
          .select('prospect_id', { count: 'exact', head: true })
          .eq('is_eligible', false)
          .eq('is_published', false),
        supabase
          .from('prospect_publication_queue')
          .select('prospect_id', { count: 'exact', head: true })
          .eq('is_published', true),
      ])

      for (const result of [eligible, blocked, published]) {
        if (result.error) throw result.error
      }

      return {
        eligible: eligible.count ?? 0,
        blocked: blocked.count ?? 0,
        published: published.count ?? 0,
      }
    },
  })
}

/**
 * Mints the external unclaimed identity. Platform admin only — enforced in the
 * RPC body, not here; this component's role check only decides whether to
 * render the button.
 */
export function usePublishExternalProfessional() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { prospectId: string; note?: string }): Promise<string> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('publish_external_professional', {
        p_prospect_id: input.prospectId,
        p_note: input.note?.trim() ? input.note.trim() : null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'publication-queue'] })
    },
  })
}

/**
 * Recomputes one prospect's verdict from the live gate.
 *
 * The reason this button exists: the cache is refreshed by a Worker sweep, so
 * after an operator resolves a duplicate or a new source lands, the queue keeps
 * showing the old answer until the next sweep reaches that row. Re-checking is
 * the honest alternative to a screen that quietly disagrees with the database.
 */
export function useRefreshPublicationEligibility() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (prospectId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('refresh_prospect_publication_eligibility', {
        p_prospect_id: prospectId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'publication-queue'] })
    },
  })
}
