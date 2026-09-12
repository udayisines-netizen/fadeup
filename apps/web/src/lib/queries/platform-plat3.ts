import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * PLAT-3 — LA couche de données des quatre écrans « défauts, promotions,
 * acquisition, worker ».
 *
 * Elle est séparée de `platform.ts` (socle PLAT-1) et de `platform-plat2.ts`
 * (écrans par rôle) pour la même raison qu'eux : les lots se relisent
 * séparément. L'architecture, elle, ne change pas — même client obtenu dans
 * la fonction, mêmes clés de cache préfixées `platform`, `if (error) throw
 * error` partout, interfaces de lignes exportées et cast unique en sortie.
 *
 * CE QUI SE JOUE ICI EST DU CONDITIONNEMENT, PAS DE L'AUTORISATION. Chaque
 * RPC appelée ci-dessous repose la question côté serveur
 * (`private.platform_can`, plafonds par rôle, bornes des réglages) ; si
 * l'interface se trompe, le serveur refuse et l'écran affiche le refus.
 */

/**
 * Les refus serveur portent un motif NOMMÉ (`fadeup_<famille>_refusal=…`),
 * dans `details`, parfois dans `hint`, parfois seulement dans le message.
 * Ce lecteur est commun aux quatre écrans : chacun traduit ensuite le jeton
 * qu'il connaît, et retombe sur `getErrorMessage` pour le reste.
 */
export function refusalToken(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const candidates = [
    'details' in error ? error.details : null,
    'hint' in error ? error.hint : null,
    'message' in error ? error.message : null,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const match = /fadeup_[a-z_]*refusal=([a-z_]+)/.exec(candidate)
    if (match) return match[1]!
  }
  return null
}

// ============================================================================
// 1. Les défauts plateforme — /platform/settings
// ============================================================================

export type PlatformSettingFamily = 'queue' | 'booking' | 'search' | 'notifications'
export type PlatformSettingSource = 'platform_settings' | 'feed_ranking_weights'

export interface PlatformSettingRow {
  key: string
  family: PlatformSettingFamily
  source: PlatformSettingSource
  value: number
  min_value: number
  max_value: number
  is_integer: boolean
  unit: string | null
  sort_order: number
  updated_at: string | null
  updated_by_email: string | null
}

/** Les défauts ET les poids du fil, en une liste, chacun avec sa source nommée. */
export function usePlatformSettings() {
  return useQuery({
    queryKey: ['platform', 'plat3', 'settings'],
    queryFn: async (): Promise<PlatformSettingRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_platform_settings')
      if (error) throw error
      return (data ?? []) as PlatformSettingRow[]
    },
  })
}

export interface PlatformSettingWriteResult {
  key: string
  value: number
  previous_value: number
  /**
   * Le nombre de salons qui suivaient le défaut et viennent d'être mis à
   * jour. Inconnaissable AVANT l'écriture (un salon peut surcharger entre
   * deux lectures) : l'écran ne le promet donc jamais, il le rapporte.
   */
  locations_propagated: number
}

export function useSetPlatformSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { key: string; value: number; reason?: string | null }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('set_platform_setting', {
        p_key: input.key,
        p_value: input.value,
        p_reason: input.reason?.trim() ? input.reason.trim() : null,
      })
      if (error) throw error
      const rows = (data ?? []) as PlatformSettingWriteResult[]
      return rows[0] ?? null
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'plat3', 'settings'] })
    },
  })
}

// ============================================================================
// 2. Les promotions — /platform/promotions
// ============================================================================

export type PromotionKind = 'percent' | 'amount'
export type PromotionDuration = 'once' | 'repeating' | 'forever'
export type PromotionStatus = 'active' | 'ended'
export type PromotionApplication = 'code' | 'staff'

export interface PromotionRow {
  id: string
  code: string
  kind: PromotionKind
  percent_off: number | null
  amount_off_minor: number | null
  duration: PromotionDuration
  duration_in_months: number | null
  starts_at: string
  ends_at: string | null
  max_redemptions: number | null
  redeemed_count: number
  active_redemptions: number
  eligible_plan_keys: string[]
  status: PromotionStatus
  stripe_coupon_id: string | null
  stripe_confirmed_at: string | null
  stripe_error: string | null
  note: string | null
  created_at: string
  created_by_email: string | null
}

export function usePromotions(includeEnded: boolean) {
  return useQuery({
    queryKey: ['platform', 'plat3', 'promotions', includeEnded],
    queryFn: async (): Promise<PromotionRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_promotions', { p_include_ended: includeEnded })
      if (error) throw error
      return (data ?? []) as PromotionRow[]
    },
  })
}

export interface PromotionRedemptionRow {
  id: string
  promotion_id: string
  code: string
  organization_id: string
  organization_name: string
  applied_via: PromotionApplication
  applied_at: string
  applied_by_email: string | null
  reason: string | null
  percent_off: number | null
  amount_off_minor: number | null
  status: PromotionStatus
  revoked_at: string | null
  revoke_reason: string | null
}

export function usePromotionRedemptions(promotionId: string | null) {
  return useQuery({
    queryKey: ['platform', 'plat3', 'promotion-redemptions', promotionId],
    queryFn: async (): Promise<PromotionRedemptionRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_promotion_redemptions', {
        p_promotion_id: promotionId,
      })
      if (error) throw error
      return (data ?? []) as PromotionRedemptionRow[]
    },
  })
}

/**
 * LE PLAFOND DU RÔLE DE L'APPELANT.
 *
 * Lu en clair sur `promotion_role_limits` : la RLS n'ouvre la table qu'aux
 * porteurs de `promotions.apply`, et un rôle absent n'accorde rien. C'est une
 * COMMODITÉ D'AFFICHAGE — le serveur revérifie à la création ET à
 * l'application, et c'est lui qui refuse.
 */
export interface PromotionRoleLimitRow {
  role: string
  max_percent_off: number
  max_amount_off_minor: number
  max_duration_months: number
  may_grant_forever: boolean
}

export function usePromotionRoleLimits() {
  return useQuery({
    queryKey: ['platform', 'plat3', 'promotion-role-limits'],
    queryFn: async (): Promise<PromotionRoleLimitRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('promotion_role_limits')
        .select('role, max_percent_off, max_amount_off_minor, max_duration_months, may_grant_forever')
      if (error) throw error
      return (data ?? []) as PromotionRoleLimitRow[]
    },
  })
}

/**
 * Le catalogue des plans, pour la multi-sélection d'éligibilité.
 *
 * `get_billing_catalog()` est la RPC de B3 et la seule source de vérité des
 * plans ; aucun hook ne l'exposait encore côté interface (vérifié dans
 * `src/lib/queries/`). Les PRIX ne sont jamais affichés ici : cet écran
 * choisit des plans éligibles, il ne présente pas la grille tarifaire.
 */
export interface BillingPlanRow {
  plan_key: string
  display_name: string
  price_minor: number
  price_currency: string
  is_available: boolean
  tier: number
}

export function useBillingCatalog() {
  return useQuery({
    queryKey: ['platform', 'plat3', 'billing-catalog'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BillingPlanRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_billing_catalog')
      if (error) throw error
      return (data ?? []) as BillingPlanRow[]
    },
  })
}

function useInvalidatePromotions() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['platform', 'plat3', 'promotions'] })
    void queryClient.invalidateQueries({ queryKey: ['platform', 'plat3', 'promotion-redemptions'] })
  }
}

export interface CreatePromotionInput {
  code: string
  kind: PromotionKind
  percentOff?: number | null
  amountOffMinor?: number | null
  duration: PromotionDuration
  durationInMonths?: number | null
  startsAt?: string | null
  endsAt?: string | null
  maxRedemptions?: number | null
  eligiblePlanKeys: string[]
  note?: string | null
}

export function useCreatePromotion() {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: async (input: CreatePromotionInput) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('create_promotion', {
        p_code: input.code,
        p_kind: input.kind,
        p_percent_off: input.percentOff ?? null,
        p_amount_off_minor: input.amountOffMinor ?? null,
        p_duration: input.duration,
        p_duration_in_months: input.durationInMonths ?? null,
        p_starts_at: input.startsAt ?? null,
        p_ends_at: input.endsAt ?? null,
        p_max_redemptions: input.maxRedemptions ?? null,
        p_eligible_plan_keys: input.eligiblePlanKeys,
        p_note: input.note?.trim() ? input.note.trim() : null,
      })
      if (error) throw error
      return data as unknown as PromotionRow
    },
    onSuccess: invalidate,
  })
}

/** Relit la réponse Stripe réelle. Tant qu'elle n'a pas répondu, rien n'est « actif ». */
export function useVerifyPromotionSync() {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: async (promotionId: string) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('verify_promotion_sync', { p_promotion_id: promotionId })
      if (error) throw error
      return data as unknown as PromotionRow
    },
    onSuccess: invalidate,
  })
}

export function useEndPromotion() {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: async (input: { promotionId: string; reason: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('end_promotion', {
        p_promotion_id: input.promotionId,
        p_reason: input.reason,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useApplyPromotion() {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: async (input: { organizationId: string; promotionId: string; reason: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('apply_promotion', {
        p_organization_id: input.organizationId,
        p_promotion_id: input.promotionId,
        p_reason: input.reason,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useRevokePromotionRedemption() {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: async (input: { redemptionId: string; reason: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('revoke_promotion_redemption', {
        p_redemption_id: input.redemptionId,
        p_reason: input.reason,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

// ============================================================================
// 3. Le tunnel d'acquisition — /platform/funnel
// ============================================================================

export type FunnelGroupBy = 'none' | 'zone' | 'origin'
export type FunnelStage = 'published' | 'requests' | 'emails' | 'claims' | 'trials' | 'subscriptions'

export interface AcquisitionFunnelRow {
  bucket_key: string
  bucket_label: string
  stage: FunnelStage
  stage_order: number
  /** NULL quand l'étape n'est pas rattachable au seau demandé. JAMAIS zéro. */
  total: number | null
  attributable: boolean
  /** NULL quand l'échantillon précédent est sous le seuil, ou incomparable. */
  conversion_rate: number | null
  rate_suppressed: boolean
  /** Le seuil VIENT DU SERVEUR — l'écran ne recopie aucune constante. */
  min_sample: number
  window_from: string
  window_to: string
}

export function useAcquisitionFunnel(input: { from: string; to: string; groupBy: FunnelGroupBy }) {
  return useQuery({
    queryKey: ['platform', 'plat3', 'funnel', input.from, input.to, input.groupBy],
    queryFn: async (): Promise<AcquisitionFunnelRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_platform_acquisition_funnel', {
        p_from: input.from,
        p_to: input.to,
        p_group_by: input.groupBy,
      })
      if (error) throw error
      return (data ?? []) as AcquisitionFunnelRow[]
    },
  })
}

// ============================================================================
// 4. Le worker d'acquisition — /platform/worker
// ============================================================================

export interface ProspectWorkerState {
  is_paused: boolean
  paused_at: string | null
  paused_by_email: string | null
  pause_reason: string | null
  last_poll_at: string | null
  seconds_since_last_poll: number | null
  last_poll_worker_id: string | null
  last_claim_at: string | null
  last_successful_pass_at: string | null
  jobs_queued: number
  jobs_running: number
  jobs_failed: number
  prospects_total: number
  prospects_last_7_days: number
  /** Mesuré sur le battement (un sondage dans les 60 s), jamais déclaré. */
  is_live: boolean
}

/**
 * L'ÉTAT DU WORKER, RAFRAÎCHI TOUTES LES DIX SECONDES — ONGLET VISIBLE SEULEMENT.
 *
 * `refetchIntervalInBackground: false` est le défaut de TanStack Query, il est
 * écrit ICI parce que ce dépôt s'est déjà fait prendre : un sondage qui
 * continue dans un onglet caché entretient une charge que personne ne regarde
 * (F1, la file publique). `is_live` se lit sur un battement de 60 s : dix
 * secondes suffisent à voir une panne, et rien n'oblige à sonder plus vite.
 */
export function useProspectWorkerState() {
  return useQuery({
    queryKey: ['platform', 'plat3', 'worker-state'],
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<ProspectWorkerState | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_prospect_worker_state')
      if (error) throw error
      const rows = (data ?? []) as ProspectWorkerState[]
      return rows[0] ?? null
    },
  })
}

export type ProspectJobType =
  | 'discovery'
  | 'enrichment'
  | 'dedup_scan'
  | 'scoring'
  | 'website_crawl'
  | 'instagram_enrich'

export interface ProspectWorkerPassRow {
  id: string
  job_type: ProspectJobType
  status: string
  priority: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
  attempts: number
  worker_id: string | null
  launched_by_email: string | null
  /** NULL quand le résultat ne portait pas le compteur. Jamais rendu « 0 ». */
  candidates_found: number | null
  prospects_created: number | null
  sources_total: number
  sources_failed: number
  last_error: string | null
}

export function useProspectWorkerPasses(limit = 50) {
  return useQuery({
    queryKey: ['platform', 'plat3', 'worker-passes', limit],
    queryFn: async (): Promise<ProspectWorkerPassRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_prospect_worker_passes', { p_limit: limit })
      if (error) throw error
      return (data ?? []) as ProspectWorkerPassRow[]
    },
  })
}

function useInvalidateWorker() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['platform', 'plat3', 'worker-state'] })
    void queryClient.invalidateQueries({ queryKey: ['platform', 'plat3', 'worker-passes'] })
  }
}

export function useSetProspectWorkerPaused() {
  const invalidate = useInvalidateWorker()
  return useMutation({
    mutationFn: async (input: { paused: boolean; reason?: string | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('set_prospect_worker_paused', {
        p_paused: input.paused,
        p_reason: input.reason?.trim() ? input.reason.trim() : null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useCreateProspectDiscoveryJob() {
  const invalidate = useInvalidateWorker()
  return useMutation({
    mutationFn: async (input: { jobType: ProspectJobType; priority?: number }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('create_prospect_discovery_job', {
        p_job_type: input.jobType,
        p_payload: {},
        p_source_keys: null,
        p_priority: input.priority ?? 100,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
