import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys } from '@/shared/data/keys'
import type { CampaignKind, Preview } from '@/features/pro-notifications/lib/campaigns'

/**
 * OS-3 — la couche de données des sollicitations.
 *
 * Quatre RPC, toutes `SECURITY DEFINER`, toutes gardées par
 * `private.has_org_role(owner, manager)` côté serveur. L'ENVOI, lui, ne fait
 * qu'écrire des lignes `email_outbox` : aucun second système d'envoi n'existe,
 * et cette couche n'en crée pas non plus (ni fetch vers un tiers, ni fonction
 * Edge d'envoi).
 */

export interface CampaignQuota {
  period_month: string
  used: number
  /** `null` = illimité. */
  monthly_allowance: number | null
  remaining: number | null
  plan_key: string
  plan_display_name: string
  /** Le plan disponible le moins cher qui apporte strictement plus. */
  next_plan_key: string | null
  next_plan_display_name: string | null
  next_plan_price_minor: number | null
  next_plan_price_currency: string | null
  next_plan_allowance: number | null
}

export interface CampaignHistoryRow {
  campaign_id: string
  kind: CampaignKind
  headline: string
  created_at: string
  scheduled_at: string
  recipient_count: number
  deferred_count: number
  suppressed_count: number
  sent_count: number
  delivered_count: number
  opened_count: number
  booked_count: number
  total_count: number
}

export interface SendResult {
  campaign_id: string
  recipient_count: number
  deferred_count: number
  suppressed_count: number
  scheduled_at: string
  used: number
  monthly_allowance: number | null
}

export interface CampaignParams {
  threshold_days?: number
  service_id?: string
  offer?: string
  valid_from?: string
  valid_until?: string
}

export function useCampaignQuota(organizationId: string | null, enabled = true) {
  return useQuery({
    queryKey: proKeys.campaignQuota(organizationId ?? ''),
    queryFn: async (): Promise<CampaignQuota | null> => {
      const { data, error } = await getSupabase().rpc('get_campaign_quota', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      const rows = (data ?? []) as unknown as CampaignQuota[]
      return rows[0] ?? null
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: 30_000,
    retry: false,
  })
}

export function useCampaignHistory(organizationId: string | null, enabled = true) {
  return useQuery({
    queryKey: proKeys.campaignHistory(organizationId ?? ''),
    queryFn: async (): Promise<CampaignHistoryRow[]> => {
      const { data, error } = await getSupabase().rpc('list_notification_campaigns', {
        p_organization_id: organizationId ?? '',
        p_limit: 20,
      })
      if (error) throw error
      return (data ?? []) as unknown as CampaignHistoryRow[]
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: 30_000,
    retry: false,
  })
}

/**
 * L'aperçu de l'audience. Il lit la MÊME `private.campaign_audience` que
 * l'envoi : le professionnel ne peut pas voir « 14 destinataires » et n'en
 * voir partir que 9.
 */
export function useCampaignPreview(organizationId: string | null, kind: CampaignKind | null, params: CampaignParams) {
  const serialized = JSON.stringify(params)
  return useQuery({
    queryKey: proKeys.campaignPreview(organizationId ?? '', kind ?? '', serialized),
    queryFn: async (): Promise<Preview | null> => {
      const { data, error } = await getSupabase().rpc('preview_notification_campaign', {
        p_organization_id: organizationId ?? '',
        p_kind: kind as CampaignKind,
        p_params: params as never,
      })
      if (error) throw error
      const rows = (data ?? []) as unknown as Preview[]
      return rows[0] ?? null
    },
    enabled: Boolean(organizationId) && kind !== null,
    staleTime: 15_000,
    retry: false,
  })
}

export function useSendCampaign(organizationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { kind: CampaignKind; headline: string; params: CampaignParams }): Promise<SendResult> => {
      const { data, error } = await getSupabase().rpc('send_notification_campaign', {
        p_organization_id: organizationId ?? '',
        p_kind: input.kind,
        p_headline: input.headline,
        p_params: input.params as never,
      })
      if (error) throw error
      const rows = (data ?? []) as unknown as SendResult[]
      const row = rows[0]
      if (!row) throw new Error('send_notification_campaign returned no row')
      return row
    },
    onSuccess: () => {
      // Un envoi change le compteur, l'historique ET les aperçus (le plafond
      // de fréquence d'un client vient de bouger) : invalidation par préfixe.
      void queryClient.invalidateQueries({ queryKey: proKeys.campaigns(organizationId ?? '') })
    },
  })
}

/** Les prestations actives, pour le modèle « créneaux libres demain ». */
export function useCampaignServices(organizationId: string | null) {
  return useQuery({
    queryKey: [...proKeys.campaigns(organizationId ?? ''), 'services'] as const,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await getSupabase().rpc('list_organization_services', {
        p_organization_id: organizationId ?? '',
        p_include_archived: false,
      })
      if (error) throw error
      const rows = (data ?? []) as unknown as Array<{ id: string; name: string; is_active: boolean }>
      return rows.filter((row) => row.is_active).map((row) => ({ id: row.id, name: row.name }))
    },
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/** Le désabonnement, appelé par la page publique sans session. */
export async function unsubscribeCustomerMarketing(token: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('unsubscribe_customer_marketing', { p_token: token })
  if (error) throw error
  const rows = (data ?? []) as unknown as Array<{ unsubscribed: boolean }>
  return rows[0]?.unsubscribed ?? false
}
